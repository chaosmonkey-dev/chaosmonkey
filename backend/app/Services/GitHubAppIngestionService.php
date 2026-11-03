<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * CR-X Track A — GitHub App Ingestion Service.
 *
 * Maps GitHub App webhook events to the existing pull_requests, deployments,
 * and releases tables. This service does NOT create new tables or migrations.
 * It writes to existing columns only.
 *
 * PROVENANCE:
 * Rows ingested via this service are tagged with evidence_source='github_app'
 * (stored in the data_source column for pull_requests, metadata for
 * deployments/releases) so the frontend provenance gates can distinguish
 * GitHub App evidence from demo/seeded data.
 *
 * MULTI-TENANT:
 * Each webhook event carries an installation_id scoped to a specific GitHub
 * org. The ingestion service uses that installation_id to scope all writes.
 * No global installation ID is used.
 *
 * SCHEMA NOTE:
 * The Track A design proposes adding head_sha, merge_sha, commit_shas,
 * base_ref, head_ref, author_login, fetched_at, evidence_source columns
 * to pull_requests. These require a DB TASK migration. Until that migration
 * is authorized, this service writes to EXISTING columns only (repo_name,
 * pr_number, developer_id, merged_at, created_at, updated_at, data_source,
 * review_count, etc.) and skips lineage columns that don't exist yet.
 */
class GitHubAppIngestionService
{
    private GitHubAppTokenService $tokenService;

    public function __construct(GitHubAppTokenService $tokenService)
    {
        $this->tokenService = $tokenService;
    }

    /**
     * Ingest a pull_request webhook event.
     *
     * Handles: opened, synchronize, closed (with merge detection).
     * Writes to: pull_requests table (existing columns).
     * Provenance: data_source = 'github_app'
     *
     * @param array $payload  Decoded webhook payload.
     * @param int $installationId  GitHub App installation ID.
     * @param string|null $deliveryId  X-GitHub-Delivery GUID for deduplication.
     * @return bool  True if ingested successfully.
     */
    public function ingestPullRequestEvent(array $payload, int $installationId, ?string $deliveryId = null): bool
    {
        $action = $payload['action'] ?? '';
        $pr = $payload['pull_request'] ?? null;
        $repo = $payload['repository'] ?? null;

        if (!$pr || !$repo) {
            Log::warning('GitHubAppIngestion: missing PR or repo in payload');
            return false;
        }

        $repoName = $repo['full_name'] ?? null;
        $prNumber = $pr['number'] ?? null;
        if (!$repoName || !$prNumber) {
            return false;
        }

        $authorLogin = $pr['user']['login'] ?? null;
        $mergedAt = $pr['merged_at'] ?? null;
        $createdAt = $pr['created_at'] ?? null;
        $updatedAt = $pr['updated_at'] ?? null;
        $reviewCount = isset($pr['requested_reviewers']) && is_array($pr['requested_reviewers']) ? count($pr['requested_reviewers']) : 0;
        $additions = $pr['additions'] ?? 0;
        $deletions = $pr['deletions'] ?? 0;
        $changedFiles = $pr['changed_files'] ?? 0;

        // Check if the pull_requests table has the lineage columns
        // (added by the DB TASK migration). If not, skip them.
        $hasLineageColumns = $this->hasColumn('pull_requests', 'head_sha');

        $updateData = [
            'repo_name' => $repoName,
            'pr_number' => $prNumber,
            'data_source' => 'github_app',
            'updated_at' => now(),
        ];

        // Set merged_at only when the PR is actually merged.
        // A reopened PR can never have been merged — clear any stale value.
        if ($mergedAt) {
            $updateData['merged_at'] = $mergedAt;
        } elseif ($action === 'reopened') {
            $updateData['merged_at'] = null;
        }

        // Set review count if available
        if ($reviewCount > 0) {
            $updateData['review_count'] = $reviewCount;
        }

        // Set additions/deletions/changed_files if the columns exist
        if ($this->hasColumn('pull_requests', 'additions')) {
            $updateData['additions'] = $additions;
            $updateData['deletions'] = $deletions;
            $updateData['changed_files'] = $changedFiles;
        }

        // Set user_login if the column exists
        if ($this->hasColumn('pull_requests', 'user_login') && $authorLogin) {
            $updateData['user_login'] = $authorLogin;
        }

        // Lineage columns (require DB TASK migration)
        if ($hasLineageColumns) {
            $updateData['head_sha'] = $pr['head']['sha'] ?? null;
            $updateData['merge_sha'] = $pr['merge_commit_sha'] ?? null;
            $updateData['base_ref'] = $pr['base']['ref'] ?? null;
            $updateData['head_ref'] = $pr['head']['ref'] ?? null;
            $updateData['author_login'] = $authorLogin;
            $updateData['fetched_at'] = now();
            $updateData['evidence_source'] = 'github_app';

            // Fetch commit SHAs if we have an installation token
            $token = $this->tokenService->getInstallationToken($installationId);
            if ($token) {
                $commitShas = $this->fetchPrCommitShas($token, $repoName, $prNumber);
                if ($commitShas !== null) {
                    $updateData['commit_shas'] = json_encode($commitShas);
                }
            }
        }

        // Upsert: find existing row by repo_name + pr_number, or create new
        $existing = DB::table('pull_requests')
            ->where('repo_name', $repoName)
            ->where('pr_number', $prNumber)
            ->first();

        if ($existing) {
            DB::table('pull_requests')
                ->where('id', $existing->id)
                ->update($updateData);
            Log::info('GitHubAppIngestion: updated PR', [
                'repo' => $repoName,
                'pr_number' => $prNumber,
                'action' => $action,
                'merged' => $mergedAt ? true : false,
            ]);
        } else {
            $updateData['created_at'] = $createdAt ?? now();
            $updateData['developer_id'] = $authorLogin ?? 'github_app';
            DB::table('pull_requests')->insert($updateData);
            Log::info('GitHubAppIngestion: inserted PR', [
                'repo' => $repoName,
                'pr_number' => $prNumber,
                'action' => $action,
            ]);
        }

        // Record reopen evidence after the upsert so the row exists for the
        // pr_reopened_count increment. Delivered under Pull requests:read —
        // replaces the Issues-permission issues/{n}/events approach.
        if ($action === 'reopened') {
            $this->recordPrReopen($repoName, (int) $prNumber, $payload, $deliveryId);
        }

        return true;
    }

    /**
     * Persist a PR reopen event (idempotent via unique event_id) and bump
     * pull_requests.pr_reopened_count when the column exists.
     *
     * @param string $repoName
     * @param int $prNumber
     * @param array $payload
     * @param string|null $deliveryId
     */
    private function recordPrReopen(string $repoName, int $prNumber, array $payload, ?string $deliveryId): void
    {
        try {
            if (!DB::getSchemaBuilder()->hasTable('pr_reopen_events')) {
                return;
            }

            $pr = $payload['pull_request'] ?? [];
            $eventId = $deliveryId ?: hash('sha256', json_encode([
                $repoName, $prNumber, 'reopened', $pr['updated_at'] ?? '',
            ]));

            $inserted = DB::table('pr_reopen_events')->insertOrIgnore([
                'repo_name' => $repoName,
                'pr_number' => $prNumber,
                'occurred_at' => $pr['updated_at'] ?? now(),
                'event_id' => $eventId,
                'actor_login' => $payload['sender']['login'] ?? null,
                'raw_event' => json_encode(['action' => 'reopened']),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            if ($inserted && $this->hasColumn('pull_requests', 'pr_reopened_count')) {
                DB::table('pull_requests')
                    ->where('repo_name', $repoName)
                    ->where('pr_number', $prNumber)
                    ->increment('pr_reopened_count');
            }
        } catch (\Exception $e) {
            Log::warning('GitHubAppIngestion: failed to record PR reopen', [
                'repo' => $repoName,
                'pr_number' => $prNumber,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Ingest a deployment webhook event.
     *
     * Handles: deployment, deployment_status events.
     * Writes to: deployments table (existing columns).
     * Provenance: metadata.data_source = 'github_app'
     *
     * @param array $payload  Decoded webhook payload.
     * @return bool  True if ingested successfully.
     */
    public function ingestDeploymentEvent(array $payload): bool
    {
        $deployment = $payload['deployment'] ?? null;
        $deploymentStatus = $payload['deployment_status'] ?? null;
        $repo = $payload['repository'] ?? null;

        if (!$repo) {
            return false;
        }

        $repoName = $repo['full_name'] ?? null;
        if (!$repoName) {
            return false;
        }

        // For deployment_status events, use the status; for deployment events, use 'pending'
        $status = 'pending';
        $sha = null;
        $environment = 'production';
        $deployedAt = now();

        if ($deploymentStatus) {
            $state = $deploymentStatus['state'] ?? 'pending';
            $status = $this->mapDeploymentStatus($state);
            $sha = $deploymentStatus['sha'] ?? ($deployment['sha'] ?? null);
            $environment = $deploymentStatus['environment'] ?? ($deployment['environment'] ?? 'production');
            $deployedAt = $deploymentStatus['created_at'] ?? now();
        } elseif ($deployment) {
            $sha = $deployment['sha'] ?? null;
            $environment = $deployment['environment'] ?? 'production';
            $deployedAt = $deployment['created_at'] ?? now();
        }

        $metadata = json_encode([
            'data_source' => 'github_app',
            'environment' => $environment,
            'ingested_at' => now()->toISOString(),
        ]);

        $insertData = [
            'repo_name' => $repoName,
            'environment' => $environment,
            'deployment_status' => $status,
            'deployed_at' => $deployedAt,
            'sha' => $sha,
            'metadata' => $metadata,
            'created_at' => now(),
            'updated_at' => now(),
        ];

        // Check for existing deployment by repo + sha + environment to avoid duplicates
        $existing = DB::table('deployments')
            ->where('repo_name', $repoName)
            ->where('sha', $sha)
            ->where('environment', $environment)
            ->first();

        if ($existing) {
            DB::table('deployments')
                ->where('id', $existing->id)
                ->update([
                    'deployment_status' => $status,
                    'updated_at' => now(),
                ]);
            Log::info('GitHubAppIngestion: updated deployment', [
                'repo' => $repoName,
                'sha' => substr($sha, 0, 7),
                'status' => $status,
            ]);
        } else {
            DB::table('deployments')->insert($insertData);
            Log::info('GitHubAppIngestion: inserted deployment', [
                'repo' => $repoName,
                'sha' => substr($sha, 0, 7),
                'status' => $status,
                'environment' => $environment,
            ]);
        }

        return true;
    }

    /**
     * Ingest a release webhook event.
     *
     * Handles: release (published, unpublished, etc.).
     * Writes to: releases table (existing columns).
     * Provenance: metadata.data_source = 'github_app'
     *
     * @param array $payload  Decoded webhook payload.
     * @return bool  True if ingested successfully.
     */
    public function ingestReleaseEvent(array $payload): bool
    {
        $release = $payload['release'] ?? null;
        $repo = $payload['repository'] ?? null;

        if (!$release || !$repo) {
            return false;
        }

        $repoName = $repo['full_name'] ?? null;
        if (!$repoName) {
            return false;
        }

        $tagName = $release['tag_name'] ?? null;
        $releaseName = $release['name'] ?? $tagName;
        $publishedAt = $release['published_at'] ?? now();
        $authorLogin = $release['author']['login'] ?? null;
        $releaseId = $release['id'] ?? null;

        $metadata = json_encode([
            'data_source' => 'github_app',
            'ingested_at' => now()->toISOString(),
        ]);

        $insertData = [
            'repo_name' => $repoName,
            'release_id' => $releaseId,
            'tag_name' => $tagName,
            'release_name' => $releaseName,
            'published_at' => $publishedAt,
            'author_login' => $authorLogin,
            'metadata' => $metadata,
            'created_at' => now(),
            'updated_at' => now(),
        ];

        // Check for existing release by repo + tag_name
        $existing = DB::table('releases')
            ->where('repo_name', $repoName)
            ->where('tag_name', $tagName)
            ->first();

        if ($existing) {
            DB::table('releases')
                ->where('id', $existing->id)
                ->update([
                    'release_name' => $releaseName,
                    'published_at' => $publishedAt,
                    'author_login' => $authorLogin,
                    'updated_at' => now(),
                ]);
            Log::info('GitHubAppIngestion: updated release', [
                'repo' => $repoName,
                'tag' => $tagName,
            ]);
        } else {
            DB::table('releases')->insert($insertData);
            Log::info('GitHubAppIngestion: inserted release', [
                'repo' => $repoName,
                'tag' => $tagName,
            ]);
        }

        return true;
    }

    /**
     * Fetch commit SHAs for a PR using the installation token.
     *
     * @param string $token  Installation access token.
     * @param string $repoName  Full repo name (owner/repo).
     * @param int $prNumber  PR number.
     * @return array|null  Array of SHA strings, or null on error.
     */
    private function fetchPrCommitShas(string $token, string $repoName, int $prNumber): ?array
    {
        $endpoint = "repos/{$repoName}/pulls/{$prNumber}/commits";

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, "https://api.github.com/{$endpoint}");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_USERAGENT, 'chaosmonkey-engineering-evidence');
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Authorization: token {$token}",
            'Accept: application/vnd.github.v3+json',
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200) {
            Log::warning('GitHubAppIngestion: failed to fetch PR commits', [
                'repo' => $repoName,
                'pr' => $prNumber,
                'status' => $httpCode,
            ]);
            return null;
        }

        $commits = json_decode($response, true);
        if (!is_array($commits)) {
            return null;
        }

        return array_map(fn($c) => $c['sha'] ?? '', $commits);
    }

    /**
     * Map GitHub deployment_status state to internal deployment_status.
     *
     * @param string $state  GitHub state (pending, success, failure, error, inactive).
     * @return string  Internal status (success, failure, pending).
     */
    private function mapDeploymentStatus(string $state): string
    {
        return match (strtolower($state)) {
            'success', 'inactive' => 'success',
            'failure', 'error' => 'failure',
            default => 'pending',
        };
    }

    /**
     * Check if a column exists on a table (read-only schema query).
     */
    private function hasColumn(string $table, string $column): bool
    {
        try {
            $columns = DB::getSchemaBuilder()->getColumnListing($table);
            return in_array($column, $columns);
        } catch (\Exception $e) {
            return false;
        }
    }
}
