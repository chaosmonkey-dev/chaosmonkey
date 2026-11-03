<?php

namespace App\Traits;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use App\Services\GitHubApiService;

/**
 * Provides org-scoped, support-login-safe OAuth token retrieval.
 *
 * When PILOT_SINGLE_TENANT_ORG_SLUG is set, token lookups are constrained
 * to the configured pilot org and support GitHub logins (PILOT_SUPPORT_GITHUB_LOGINS) are excluded.
 * When unset, normal dev/local behavior is preserved (latest global token).
 */
trait PilotAwareTokenHelper
{
    /**
     * Get the configured pilot org slug, or null when not in single-tenant mode.
     */
    protected function pilotOrgSlug(): ?string
    {
        // CR-X P0-0: Read via config() to survive Laravel config:cache.
        $slug = config('services.pilot.single_tenant_org_slug');
        return $slug ? trim($slug) : null;
    }

    /**
     * Get the list of support GitHub logins that must never be used for customer metrics.
     */
    protected function supportGitHubLogins(): array
    {
        $raw = config('services.pilot.support_github_logins', '');
        if (!$raw) {
            return [];
        }
        return array_filter(array_map('trim', explode(',', $raw)), fn($v) => $v !== '');
    }

    /**
     * Check if a GitHub login is a support login.
     */
    protected function isSupportLogin(?string $login): bool
    {
        if (!$login) {
            return false;
        }
        $support = $this->supportGitHubLogins();
        if (empty($support)) {
            return false;
        }
        return in_array(strtolower($login), array_map('strtolower', $support));
    }

    /**
     * Check if the instance is running in pilot (single-tenant) mode.
     */
    protected function isPilotMode(): bool
    {
        return $this->pilotOrgSlug() !== null;
    }

    /**
     * R3 Fail-Closed Evidence Authority (CRX-P0-6D-SECURITY-R3).
     *
     * Positive authorization: ONLY token_purpose === 'engineering_integration'
     * may supply GitHub engineering evidence.  All other purposes
     * (identity_only, missing, null, unknown, legacy, malformed) fail closed.
     *
     * This is the SINGLE central eligibility rule for all GitHub evidence
     * consumption.  Every callsite that feeds GitHub API data into customer-
     * visible metrics MUST call this before using the token.
     *
     * @param array|null $oauthUser  Decoded oauth_tokens.user_data JSON.
     * @return bool  True ONLY when explicit engineering_integration purpose is present.
     */
    protected function isEngineeringEvidenceEligible(?array $oauthUser): bool
    {
        return $oauthUser !== null
            && isset($oauthUser['login'])
            && ($oauthUser['token_purpose'] ?? null) === 'engineering_integration';
    }

    /**
     * CR-X 18B.2: Resolve the authoritative customer repo allow-list.
     *
     * Authority = non-empty intersection between:
     *   A. repos whose normalized identity appears in this org's canonical telemetry
     *   B. repos visible through the GitHub engineering token
     *
     * This is generic and does not hardcode customer names. The customer repo
     * universe is derived from the organization's own canonical telemetry.
     */
    protected function resolveCustomerRepoAllowList(?string $oauthToken, ?array $oauthUser, int $organizationId): array
    {
        if ($organizationId <= 0
            || !$oauthToken
            || !$this->isEngineeringEvidenceEligible($oauthUser)
            || $this->isSupportLogin($oauthUser['login'] ?? null)) {
            return [];
        }

        $customerRepoSet = array_values(array_filter(
            array_unique($this->getOrganizationCanonicalRepoSet($organizationId)),
            fn($repo) => $this->isGitHubRepoIdentity($repo)
        ));
        sort($customerRepoSet);

        if (empty($customerRepoSet)) {
            return [];
        }

        $tokenRepoNames = [];
        $cached = $oauthUser['repositories'] ?? null;
        if (is_array($cached)) {
            foreach ($cached as $repo) {
                $tokenRepoNames[] = is_array($repo) ? ($repo['full_name'] ?? null) : $repo;
            }
        }

        $authoritativeRepos = $this->authoritativeCustomerRepoOverlap(
            $customerRepoSet,
            array_filter($tokenRepoNames),
            $oauthToken,
            false
        );

        if (empty($authoritativeRepos)) {
            $tokenRepoNames = $this->fetchTokenVisibleRepoNames($oauthToken);
            $authoritativeRepos = $this->authoritativeCustomerRepoOverlap(
                $customerRepoSet,
                $tokenRepoNames,
                $oauthToken,
                true
            );
        }

        // A bounded direct check covers repos outside the token's first
        // /user/repos pages without treating arbitrary public repos as customer
        // evidence. Candidates are still limited to this org's telemetry set.
        if (empty($authoritativeRepos)) {
            foreach (array_slice($customerRepoSet, 0, 100) as $customerRepo) {
                if ($this->verifyDirectCustomerRepoAccess($oauthToken, $customerRepo)) {
                    $authoritativeRepos[] = $customerRepo;
                }
            }
        }

        Log::info('Resolved customer repo authority', [
            'organization_id' => $organizationId,
            'customer_telemetry_repos' => count($customerRepoSet),
            'token_visible_repos' => count($tokenRepoNames),
            'authoritative_overlap' => count($authoritativeRepos),
        ]);

        return array_values(array_unique($authoritativeRepos));
    }

    protected function authoritativeCustomerRepoOverlap(
        array $customerRepoSet,
        array $tokenRepoNames,
        string $oauthToken,
        bool $requireOrganizationMembership
    ): array {
        $tokenRepoSet = [];
        foreach ($tokenRepoNames as $name) {
            if (is_string($name) && $this->isGitHubRepoIdentity($name)) {
                $tokenRepoSet[strtolower($name)] = $name;
            }
        }

        $authoritativeRepos = [];
        $membershipByOwner = [];
        foreach ($customerRepoSet as $customerRepo) {
            $key = strtolower($customerRepo);
            if (!isset($tokenRepoSet[$key])) {
                continue;
            }

            if ($requireOrganizationMembership) {
                $owner = explode('/', $customerRepo)[0] ?? '';
                if (!array_key_exists($owner, $membershipByOwner)) {
                    $membershipByOwner[$owner] = $this->isCustomerOrganizationMember($oauthToken, $customerRepo);
                }
                if (!$membershipByOwner[$owner]) {
                    continue;
                }
            }

            $authoritativeRepos[] = $tokenRepoSet[$key];
        }

        return $authoritativeRepos;
    }

    protected function fetchTokenVisibleRepoNames(string $oauthToken): array
    {
        $names = [];

        for ($page = 1; $page <= 5; $page++) {
            $reposResponse = $this->fetchGitHubAuthorityApiCall(
                $oauthToken,
                "user/repos?per_page=100&affiliation=owner,collaborator,organization_member&page={$page}"
            );

            if (!is_array($reposResponse)) {
                break;
            }

            foreach ($reposResponse as $repo) {
                $fullName = is_array($repo) ? ($repo['full_name'] ?? null) : null;
                if ($fullName) {
                    $names[] = $fullName;
                }
            }

            if (count($reposResponse) < 100) {
                break;
            }
        }

        return array_values(array_unique($names));
    }

    protected function verifyDirectCustomerRepoAccess(string $oauthToken, string $repoName): bool
    {
        if (!$this->isGitHubRepoIdentity($repoName)) {
            return false;
        }

        $repo = $this->fetchGitHubAuthorityApiCall($oauthToken, "repos/{$repoName}");
        $fullName = is_array($repo) ? ($repo['full_name'] ?? null) : null;
        $ownerType = $repo['owner']['type'] ?? null;

        return $fullName
            && strtolower($fullName) === strtolower($repoName)
            && $ownerType === 'Organization'
            && $this->isCustomerOrganizationMember($oauthToken, $repoName);
    }

    protected function isCustomerOrganizationMember(string $oauthToken, string $repoName): bool
    {
        $owner = explode('/', $repoName)[0] ?? null;
        if (!$owner) {
            return false;
        }

        $membership = $this->fetchGitHubAuthorityApiCall($oauthToken, "user/memberships/orgs/{$owner}");
        return is_array($membership) && ($membership['state'] ?? null) === 'active';
    }

    protected function isGitHubRepoIdentity(?string $repoName): bool
    {
        return is_string($repoName)
            && preg_match('/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/', $repoName) === 1;
    }

    protected function fetchGitHubAuthorityApiCall(string $oauthToken, string $endpoint): ?array
    {
        try {
            $response = (new GitHubApiService())->makeApiCall($oauthToken, $endpoint);
            return is_array($response) ? $response : null;
        } catch (\Exception $e) {
            Log::warning('Failed to resolve customer repo authority from GitHub', [
                'endpoint' => $endpoint,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    protected function resolveCustomerRepoAuthority(?string $oauthToken, ?array $oauthUser, int $organizationId): bool
    {
        return !empty($this->resolveCustomerRepoAllowList($oauthToken, $oauthUser, $organizationId));
    }

    /**
     * CR-X 18B.2: Build the set of canonical customer repo identities from
     * this org's canonical telemetry sessions. Repo identity is stored in
     * metadata.git_repo_url, not a top-level column.
     */
    protected function getOrganizationCanonicalRepoSet(int $organizationId): array
    {
        $rawUrls = DB::table('telemetry_events')
            ->where('organization_id', $organizationId)
            ->where('event_type', 'session')
            ->whereRaw("json_extract(metadata, '$.segment_type') = 'session'")
            ->whereRaw("json_extract(metadata, '$.git_repo_url') IS NOT NULL")
            ->whereRaw("json_extract(metadata, '$.git_repo_url') != ''")
            ->selectRaw("DISTINCT json_extract(metadata, '$.git_repo_url') as repo_url")
            ->pluck('repo_url')
            ->toArray();

        $set = [];
        foreach ($rawUrls as $url) {
            $normalized = $this->normalizeRepoUrlForAuthority($url);
            if ($normalized) {
                $set[$normalized] = true;
            }
        }

        return array_keys($set);
    }

    /**
     * CR-X 18B.2: Mirror of TelemetryController::normalizeRepoUrlForCanonical.
     * Normalizes git repository URLs into canonical owner/repo identity.
     */
    protected function normalizeRepoUrlForAuthority(?string $repoUrl): ?string
    {
        if (!$repoUrl) return null;
        $url = trim($repoUrl);
        if ($url === '') return null;

        // Azure DevOps: https://[user@]dev.azure.com/org/project/_git/repo
        if (preg_match('#^https?://(?:[^@/]+@)?dev\.azure\.com/([^/]+)/[^/]+/_git/([^/]+)#i', $url, $m)) {
            return "azure:{$m[1]}/{$m[2]}";
        }

        // HTTPS with optional user: https://[user@]host/owner/repo.git
        if (preg_match('#^https?://(?:[^@/?]+@)?[^/]+/([^/]+)/([^/]+?)(?:\.git)?$#i', $url, $m)) {
            return strtolower("{$m[1]}/{$m[2]}");
        }

        // SSH: git@host:owner/repo.git or user@host:owner/repo.git
        if (preg_match('/^[^@:\/]+@[^:]+:([^\/]+)\/([^\/]+?)(?:\.git)?$/', $url, $m)) {
            return strtolower("{$m[1]}/{$m[2]}");
        }

        // SCP-style without user: host:owner/repo.git
        if (preg_match('/^[^:\/]+:([^\/]+)\/([^\/]+?)(?:\.git)?$/', $url, $m)) {
            return strtolower("{$m[1]}/{$m[2]}");
        }

        return null;
    }

    /**
     * Get an org-scoped OAuth token safe for customer metrics.
     *
     * - In pilot mode: only returns tokens whose owner is NOT a support login
     *   and whose organization_id matches the pilot org exactly.
     *   Null organization_id tokens are NEVER allowed in pilot mode.
     * - In dev mode (no PILOT_SINGLE_TENANT_ORG_SLUG): returns latest valid token
     *   (preserves existing local/dev behavior).
     *
     * @return string|null  Access token or null if no safe token exists.
     */
    protected function getMetricsSafeOAuthToken(): ?string
    {
        $pilotSlug = $this->pilotOrgSlug();
        $supportLogins = $this->supportGitHubLogins();

        // Dev/local mode: preserve existing behavior
        if (!$pilotSlug && empty($supportLogins)) {
            $token = DB::table('oauth_tokens')
                ->where('access_token', '!=', 'pending')
                ->whereNotNull('access_token')
                ->latest('updated_at')
                ->first();
            return $token ? $token->access_token : null;
        }

        // Pilot mode: filter out support logins and require exact pilot org match
        $query = DB::table('oauth_tokens')
            ->where('access_token', '!=', 'pending')
            ->whereNotNull('access_token');

        // Require exact organization_id match — no null org fallback in pilot mode
        if ($pilotSlug) {
            $pilotOrg = DB::table('organizations')->where('slug', $pilotSlug)->first();
            if ($pilotOrg) {
                $query->where('organization_id', $pilotOrg->id);
            } else {
                // Pilot org doesn't exist yet — no safe token possible
                Log::info('PilotAwareTokenHelper: pilot org not found, no safe token', [
                    'pilot_slug' => $pilotSlug,
                ]);
                return null;
            }
        }

        $tokens = $query->orderBy('updated_at', 'desc')->limit(10)->get();

        foreach ($tokens as $tokenRow) {
            $userData = json_decode($tokenRow->user_data ?? '{}', true);
            $login = $userData['login'] ?? null;

            if ($this->isSupportLogin($login)) {
                Log::info('PilotAwareTokenHelper: skipping support login token', [
                    'login' => $login,
                    'token_id' => $tokenRow->id ?? null,
                ]);
                continue;
            }

            return $tokenRow->access_token;
        }

        Log::info('PilotAwareTokenHelper: no safe customer metrics token found', [
            'pilot_slug' => $pilotSlug,
            'support_logins' => $supportLogins,
            'tokens_checked' => $tokens->count(),
        ]);

        return null;
    }

    /**
     * Get the pilot organization model (firstOrCreate) when in pilot mode.
     * Returns null when not in pilot mode.
     */
    protected function getPilotOrg(): ?object
    {
        $slug = $this->pilotOrgSlug();
        if (!$slug) {
            return null;
        }

        $name = config('services.pilot.single_tenant_org_name', ucfirst(str_replace('-', ' ', $slug)));
        $org = DB::table('organizations')->where('slug', $slug)->first();

        if (!$org) {
            $id = DB::table('organizations')->insertGetId([
                'name' => $name,
                'slug' => $slug,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $org = DB::table('organizations')->where('id', $id)->first();
        }

        return $org;
    }

    /**
     * CR-X 2C: Resolve the organization's engineering integration token.
     *
     * Selects the org's engineering_integration token — NOT the current
     * viewer's token.  This is the org-level authority: any authorized
     * dashboard viewer in the same org sees the same customer GitHub
     * evidence, sourced from the customer user who connected GitHub.
     *
     * Support login tokens are never returned, even if they exist for the org.
     * Cross-org leakage is impossible: the query is scoped to one organization_id.
     *
     * @param int|null  $organizationId  The acting user's organization.
     * @return string|null  Access token or null if no eligible integration exists.
     */
    protected function getOrgEngineeringToken(?int $organizationId): ?string
    {
        if (!$organizationId) {
            return null;
        }

        $tokens = DB::table('oauth_tokens')
            ->where('organization_id', $organizationId)
            ->where('access_token', '!=', 'pending')
            ->whereNotNull('access_token')
            ->orderBy('updated_at', 'desc')
            ->get();

        foreach ($tokens as $tokenRow) {
            $userData = json_decode($tokenRow->user_data ?? '{}', true);
            $login = $userData['login'] ?? null;

            // Never use support login tokens as customer evidence authority
            if ($this->isSupportLogin($login)) {
                continue;
            }

            // Only engineering_integration tokens are eligible
            if (($userData['token_purpose'] ?? null) === 'engineering_integration') {
                return $tokenRow->access_token;
            }
        }

        return null;
    }

    /**
     * CR-X 2C: Resolve the organization's engineering integration user_data.
     *
     * Returns the decoded user_data JSON for the org's engineering_integration
     * token, or null if no eligible integration exists.
     *
     * @param int|null  $organizationId
     * @return array|null
     */
    protected function getOrgEngineeringUser(?int $organizationId): ?array
    {
        if (!$organizationId) {
            return null;
        }

        $tokens = DB::table('oauth_tokens')
            ->where('organization_id', $organizationId)
            ->where('access_token', '!=', 'pending')
            ->whereNotNull('access_token')
            ->orderBy('updated_at', 'desc')
            ->get();

        foreach ($tokens as $tokenRow) {
            $userData = json_decode($tokenRow->user_data ?? '{}', true);
            $login = $userData['login'] ?? null;

            if ($this->isSupportLogin($login)) {
                continue;
            }

            if (($userData['token_purpose'] ?? null) === 'engineering_integration') {
                return $userData;
            }
        }

        return null;
    }

    /**
     * PILOT OPS 18G: Persist a GitHub OAuth credential into a purpose-scoped
     * oauth_tokens row.
     *
     * Identity and engineering credentials are independently persistent:
     * one user may simultaneously hold an identity_only row and an
     * engineering_integration row.  The write target is selected by
     * (user_id, user_data.token_purpose):
     *
     *   - engineering writes only ever match an existing
     *     engineering_integration row (reconnect refreshes it in place);
     *     otherwise a new row is inserted.  Identity rows are never touched.
     *   - identity writes only ever match a non-engineering row for the
     *     user (purpose missing, null, or any non-engineering value —
     *     which includes legacy pre-purpose rows); otherwise a new row is
     *     inserted.  Engineering rows are never touched.
     *
     * token_purpose lives inside the user_data JSON column, so the match
     * uses json_extract guarded by json_valid (malformed JSON is treated
     * as non-engineering and falls into the identity bucket).  No schema
     * change is required: every reader already selects rows by decoded
     * user_data.token_purpose.
     *
     * @param int        $userId          Local users.id of the credential owner.
     * @param int|null   $organizationId  Org the credential is bound to.
     * @param string     $accessToken     GitHub OAuth access token.
     * @param string     $tokenPurpose    'engineering_integration' or 'identity_only'.
     * @param array      $userData        Decoded GitHub /user payload (token_purpose included).
     */
    protected function upsertOAuthCredential(
        int $userId,
        ?int $organizationId,
        string $accessToken,
        string $tokenPurpose,
        array $userData
    ): void {
        $query = DB::table('oauth_tokens')->where('user_id', $userId);

        if ($tokenPurpose === 'engineering_integration') {
            $query->whereRaw(
                "json_valid(user_data) = 1 AND json_extract(user_data, '$.token_purpose') = ?",
                ['engineering_integration']
            );
        } else {
            $query->whereRaw(
                "(json_valid(user_data) = 0 OR COALESCE(json_extract(user_data, '$.token_purpose'), '') != ?)",
                ['engineering_integration']
            );
        }

        $existing = $query->orderBy('updated_at', 'desc')->first();

        $payload = [
            'organization_id' => $organizationId,
            'access_token' => $accessToken,
            'user_data' => json_encode($userData),
            'updated_at' => now(),
        ];

        if ($existing) {
            DB::table('oauth_tokens')->where('id', $existing->id)->update($payload);
        } else {
            DB::table('oauth_tokens')->insert($payload + [
                'user_id' => $userId,
                'created_at' => now(),
            ]);
        }
    }
}
