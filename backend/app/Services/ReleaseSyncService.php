<?php

namespace App\Services;

use App\Models\Release;
use Illuminate\Support\Facades\Log;
use DB;
use App\Traits\PilotAwareTokenHelper;

class ReleaseSyncService
{
    use PilotAwareTokenHelper;
    private $githubApiService;

    public function __construct()
    {
        $this->githubApiService = new GitHubApiService();
    }

    /**
     * Fetch releases for a repository using GitHub Releases API
     *
     * @param string      $token  GitHub OAuth token
     * @param string      $owner  Repo owner
     * @param string      $repo   Repo name
     * @param string|null $since  Optional cutoff date (YYYY-MM-DD)
     * @return array Normalized release data
     */
    public function fetchReleases($token, $owner, $repo, $since = null)
    {
        $endpoint = "repos/{$owner}/{$repo}/releases?per_page=100";
        $releases = $this->githubApiService->makeApiCall($token, $endpoint);

        if (!$releases || !is_array($releases)) {
            Log::warning('No releases found for repo', ['owner' => $owner, 'repo' => $repo]);
            return [];
        }

        // Filter by time window if provided
        if ($since) {
            $cutoffTimestamp = strtotime($since);
            $releases = array_filter($releases, function ($release) use ($cutoffTimestamp) {
                $publishedAt = $release['published_at'] ?? $release['created_at'] ?? null;
                return $publishedAt && strtotime($publishedAt) >= $cutoffTimestamp;
            });
        }

        // Normalize release data — do NOT persist release body/text
        $normalized = array_map(function ($release) use ($owner, $repo) {
            return [
                'repo_name'     => "{$owner}/{$repo}",
                'release_id'    => $release['id'] ?? null,
                'tag_name'      => $release['tag_name'] ?? '',
                'release_name'  => $release['name'] ?? null,
                'published_at'  => $release['published_at'] ?? null,
                'author_login'  => $release['author']['login'] ?? null,
                'metadata'      => [
                    'data_source'        => 'github_api_sync',
                    'draft'              => $release['draft'] ?? false,
                    'prerelease'         => $release['prerelease'] ?? false,
                    'target_commitish'   => $release['target_commitish'] ?? null,
                    'url'                => $release['html_url'] ?? null,
                ],
            ];
        }, $releases);

        Log::info('Fetched releases for repo', [
            'owner'    => $owner,
            'repo'     => $repo,
            'total'    => count($releases),
            'filtered' => count($normalized),
        ]);

        return array_values($normalized);
    }

    /**
     * Persist releases to the releases table (upsert by repo_name + release_id)
     *
     * @param string $repoFullName  Full repo name (owner/repo)
     * @param array  $releases      Normalized release data from fetchReleases()
     * @return int Number of releases upserted
     */
    public function persistReleases($repoFullName, $releases)
    {
        $upserted = 0;

        foreach ($releases as $releaseData) {
            $releaseId = $releaseData['release_id'] ?? null;

            if ($releaseId === null) {
                Log::warning('Release missing release_id, skipping', ['repo' => $repoFullName]);
                continue;
            }

            $existing = Release::where('repo_name', $repoFullName)
                ->where('release_id', $releaseId)
                ->first();

            if ($existing) {
                $existing->update($releaseData);
            } else {
                Release::create($releaseData);
            }

            $upserted++;
        }

        Log::info('Persisted releases', [
            'repo'      => $repoFullName,
            'upserted'  => $upserted,
        ]);

        return $upserted;
    }

    /**
     * Get latest release for a repository
     */
    public function getLatestRelease($repoName)
    {
        return Release::where('repo_name', $repoName)
            ->whereNotNull('published_at')
            ->orderBy('published_at', 'desc')
            ->first();
    }

    /**
     * Get OAuth token from database (pilot-aware)
     */
    private function getOAuthToken()
    {
        return $this->getMetricsSafeOAuthToken();
    }
}
