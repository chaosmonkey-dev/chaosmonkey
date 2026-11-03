<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

/**
 * CR-X Track A — GitHub App Installation Token Service.
 *
 * Mints short-lived installation tokens for a GitHub App installation.
 * Uses JWT signed with the App's private key to authenticate as the App,
 * then exchanges the JWT for an installation-scoped access token.
 *
 * MULTI-TENANT ARCHITECTURE:
 * Each installation is scoped to a specific GitHub organization/installation.
 * There is NO global installation ID. Tokens are cached per installation_id
 * so different pilot orgs never share token authority.
 *
 * The OAuth App remains for identity login. This service is ONLY for
 * engineering-evidence ingestion via the GitHub App installation.
 *
 * No DB writes. Token caching uses Laravel's cache (configured separately).
 */
class GitHubAppTokenService
{
    /**
     * Mint a JWT for the GitHub App (app-level authentication).
     * The JWT is signed with the App's private key (RS256).
     *
     * @return string|null  JWT string or null if config is missing.
     */
    public function mintAppJwt(): ?string
    {
        $appId = config('services.github_app.id');
        $privateKeyPem = config('services.github_app.private_key');

        if (!$appId || !$privateKeyPem) {
            Log::info('GitHubAppTokenService: GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY not configured');
            return null;
        }

        // Normalize PEM: handle escaped newlines from .env
        $privateKeyPem = str_replace('\\n', "\n", $privateKeyPem);

        $privateKey = openssl_pkey_get_private($privateKeyPem);
        if (!$privateKey) {
            Log::error('GitHubAppTokenService: invalid private key');
            return null;
        }

        $now = time();
        $payload = [
            'iat' => $now - 60,           // issued 60s ago (clock skew tolerance)
            'exp' => $now + (10 * 60),    // expires in 10 min (GitHub max)
            'iss' => $appId,
        ];

        $payloadJson = json_encode($payload);
        if ($payloadJson === false) {
            Log::error('GitHubAppTokenService: failed to encode JWT payload');
            return null;
        }

        $header = json_encode(['alg' => 'RS256', 'typ' => 'JWT']);
        $encodedHeader = $this->base64UrlEncode($header);
        $encodedPayload = $this->base64UrlEncode($payloadJson);
        $signatureInput = $encodedHeader . '.' . $encodedPayload;

        $signature = '';
        if (!openssl_sign($signatureInput, $signature, $privateKey, 'sha256WithRSAEncryption')) {
            Log::error('GitHubAppTokenService: failed to sign JWT');
            return null;
        }

        openssl_free_key($privateKey);

        return $signatureInput . '.' . $this->base64UrlEncode($signature);
    }

    /**
     * Mint (or retrieve from cache) an installation-scoped access token.
     *
     * Installation tokens are short-lived (1 hour default). They are cached
     * per installation_id so multiple requests within the same window reuse
     * the same token without hitting the GitHub API.
     *
     * @param int $installationId  The GitHub App installation ID (per-org).
     * @return string|null  Installation token or null if minting fails.
     */
    public function getInstallationToken(int $installationId): ?string
    {
        if ($installationId <= 0) {
            return null;
        }

        $cacheKey = "github_app_token:{$installationId}";

        // Check cache first
        $cached = Cache::get($cacheKey);
        if ($cached && is_string($cached) && strlen($cached) > 0) {
            return $cached;
        }

        // Mint a new token
        $jwt = $this->mintAppJwt();
        if (!$jwt) {
            return null;
        }

        $token = $this->requestInstallationToken($installationId, $jwt);
        if (!$token) {
            return null;
        }

        // Cache for 50 minutes (token expires in 60 min, leave 10 min buffer)
        Cache::put($cacheKey, $token, now()->addMinutes(50));

        return $token;
    }

    /**
     * Request an installation token from the GitHub API.
     *
     * @param int $installationId
     * @param string $jwt  App JWT for authentication.
     * @return string|null
     */
    private function requestInstallationToken(int $installationId, string $jwt): ?string
    {
        $url = "https://api.github.com/app/installations/{$installationId}/access_tokens";

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_USERAGENT, 'chaosmonkey-engineering-evidence');
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Authorization: Bearer {$jwt}",
            'Accept: application/vnd.github.v3+json',
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($error) {
            Log::error('GitHubAppTokenService: curl error minting installation token', [
                'installation_id' => $installationId,
                'error' => $error,
            ]);
            return null;
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            Log::error('GitHubAppTokenService: GitHub API error minting installation token', [
                'installation_id' => $installationId,
                'status' => $httpCode,
                'response' => substr($response, 0, 200),
            ]);
            return null;
        }

        $data = json_decode($response, true);
        if (!isset($data['token'])) {
            Log::error('GitHubAppTokenService: no token in response', [
                'installation_id' => $installationId,
            ]);
            return null;
        }

        return $data['token'];
    }

    /**
     * Verify a GitHub App webhook signature using HMAC-SHA256.
     *
     * @param string $payload  Raw request body.
     * @param string $signature  X-Hub-Signature-256 header value.
     * @return bool  True if signature matches.
     */
    public function verifyWebhookSignature(string $payload, string $signature): bool
    {
        $secret = config('services.github_app.webhook_secret');
        if (!$secret) {
            Log::warning('GitHubAppTokenService: GITHUB_APP_WEBHOOK_SECRET not configured');
            return false;
        }

        if (empty($signature) || !str_starts_with($signature, 'sha256=')) {
            return false;
        }

        $expected = 'sha256=' . hash_hmac('sha256', $payload, $secret);
        return hash_equals($expected, $signature);
    }

    /**
     * Resolve the installation ID for a given organization.
     *
     * In multi-pilot architecture, each pilot org has its own installation.
     * This resolves the installation ID from the org's configuration.
     *
     * For now, this reads from env (single-pilot). In multi-pilot, this
     * would read from a per-org installation map (requires DB table —
     * deferred to DB TASK).
     *
     * @param string|null $orgSlug  Organization slug (null for default).
     * @return int|null  Installation ID or null if not configured.
     */
    public function resolveInstallationId(?string $orgSlug = null): ?int
    {
        // Multi-pilot: per-org installation map would go here.
        // For now, single-pilot env var.
        $installationId = config('services.github_app.installation_id');
        if (!$installationId) {
            return null;
        }
        return (int) $installationId;
    }

    /**
     * Base64URL-encode a string (JWT encoding).
     */
    private function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
