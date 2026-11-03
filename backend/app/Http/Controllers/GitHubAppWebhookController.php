<?php

namespace App\Http\Controllers;

use App\Services\GitHubAppTokenService;
use App\Services\GitHubAppIngestionService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

/**
 * CR-X Track A — GitHub App Webhook Controller.
 *
 * Receives and processes GitHub App webhook events for PR, deployment,
 * and release lifecycle. Verifies webhook signature before any processing.
 *
 * MULTI-TENANT:
 * Each webhook event carries an installation_id scoped to a specific GitHub
 * org. The controller uses that installation_id to scope all ingestion.
 * No global installation ID is used.
 *
 * SECURITY:
 * - Webhook signature is verified using GITHUB_APP_WEBHOOK_SECRET.
 * - If signature verification fails, the request is rejected with 401.
 * - If the App is not configured (missing env vars), returns 503 so GitHub
 *   retries later.
 *
 * NO DB SCHEMA CHANGES:
 * This controller writes to existing tables only. Lineage columns
 * (head_sha, merge_sha, etc.) are written only if the DB TASK migration
 * has been applied (checked at runtime via hasColumn).
 */
class GitHubAppWebhookController extends Controller
{
    private GitHubAppTokenService $tokenService;
    private GitHubAppIngestionService $ingestionService;

    public function __construct(
        GitHubAppTokenService $tokenService,
        GitHubAppIngestionService $ingestionService
    ) {
        $this->tokenService = $tokenService;
        $this->ingestionService = $ingestionService;
    }

    /**
     * Handle incoming GitHub App webhook.
     *
     * POST /api/github/app/webhook
     *
     * @param Request $request
     * @return JsonResponse
     */
    public function handleWebhook(Request $request): JsonResponse
    {
        // 1. Verify the App is configured
        if (!config('services.github_app.id') || !config('services.github_app.private_key')) {
            Log::info('GitHubAppWebhook: App not configured, returning 503');
            return response()->json(['error' => 'GitHub App not configured'], 503);
        }

        // 2. Verify webhook signature
        $signature = $request->header('X-Hub-Signature-256', '');
        $payload = $request->getContent();

        if (!$this->tokenService->verifyWebhookSignature($payload, $signature)) {
            Log::warning('GitHubAppWebhook: signature verification failed');
            return response()->json(['error' => 'Invalid signature'], 401);
        }

        // 3. Parse the event
        $event = $request->header('X-GitHub-Event', '');
        $data = json_decode($payload, true);

        if (!$data || !is_array($data)) {
            Log::warning('GitHubAppWebhook: invalid JSON payload');
            return response()->json(['error' => 'Invalid payload'], 400);
        }

        // 4. Extract installation ID (multi-tenant scoping)
        $installationId = $data['installation']['id'] ?? null;
        if (!$installationId) {
            Log::warning('GitHubAppWebhook: no installation_id in payload');
            return response()->json(['error' => 'No installation ID'], 400);
        }

        // 4b. Per-pilot isolation: only the pilot's own configured
        // installation may ingest. Fail closed (503 -> GitHub retries)
        // until the customer installation ID is provisioned. The `ping`
        // handshake carries no repository data and is allowed through so
        // installs/verifications succeed before provisioning.
        if ($event !== 'ping') {
            $expectedInstallationId = config('services.github_app.installation_id');
            if (!$expectedInstallationId) {
                Log::info('GitHubAppWebhook: no GITHUB_APP_INSTALLATION_ID configured, returning 503');
                return response()->json(['error' => 'Installation not provisioned'], 503);
            }
            if ((int) $installationId !== (int) $expectedInstallationId) {
                Log::warning('GitHubAppWebhook: installation_id mismatch', [
                    'installation_id' => $installationId,
                ]);
                return response()->json(['error' => 'Unknown installation'], 403);
            }
        }

        Log::info('GitHubAppWebhook: received event', [
            'event' => $event,
            'action' => $data['action'] ?? '',
            'installation_id' => $installationId,
            'repo' => $data['repository']['full_name'] ?? '',
        ]);

        // 5. Route to the appropriate ingestion handler
        try {
            $result = match ($event) {
                'pull_request' => $this->ingestionService->ingestPullRequestEvent(
                    $data, (int) $installationId, $request->header('X-GitHub-Delivery')
                ),
                'pull_request_review' => $this->handlePullRequestReview($data, (int) $installationId),
                'deployment', 'deployment_status' => $this->ingestionService->ingestDeploymentEvent($data),
                'release' => $this->ingestionService->ingestReleaseEvent($data),
                'ping' => true, // GitHub sends ping on webhook setup
                default => $this->handleUnsupportedEvent($event),
            };

            if ($result) {
                return response()->json(['status' => 'processed', 'event' => $event], 200);
            }

            return response()->json(['status' => 'skipped', 'event' => $event], 200);
        } catch (\Exception $e) {
            Log::error('GitHubAppWebhook: ingestion error', [
                'event' => $event,
                'error' => $e->getMessage(),
            ]);
            return response()->json(['error' => 'Ingestion failed'], 500);
        }
    }

    /**
     * Handle pull_request_review events.
     * Currently a no-op — review data is captured via the PR event's
     * review_count field. Full review ingestion would require a
     * pull_request_reviews table (future DB TASK).
     *
     * @param array $data
     * @param int $installationId
     * @return bool
     */
    private function handlePullRequestReview(array $data, int $installationId): bool
    {
        // Log for audit; full review ingestion deferred to future DB TASK
        Log::info('GitHubAppWebhook: pull_request_review event received', [
            'installation_id' => $installationId,
            'action' => $data['action'] ?? '',
            'repo' => $data['repository']['full_name'] ?? '',
        ]);
        return true;
    }

    /**
     * Handle unsupported events gracefully.
     *
     * @param string $event
     * @return bool
     */
    private function handleUnsupportedEvent(string $event): bool
    {
        Log::info('GitHubAppWebhook: unsupported event type', ['event' => $event]);
        return false;
    }
}
