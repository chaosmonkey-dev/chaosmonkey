<?php

namespace App\Http\Controllers;

use App\Models\TelemetryEvent;
use App\Models\ApiToken;
use App\Models\IDEConnectCode;
use App\Models\Organization;
use App\Services\CanonicalPopulationService;
use App\Traits\PilotAwareTokenHelper;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * CR-X Pass 1 (F): Pilot Health — read-only operational visibility.
 *
 * Provides a tenant-agnostic operational health contract so that a pilot
 * does not require Matt to manually open logs to discover that telemetry
 * has stopped, GitHub is disconnected, or credentials are stale.
 *
 * Contract:
 * - Read-only (no DB writes, no mutations)
 * - Tenant-agnostic (no customer-specific hardcoding)
 * - Org-scoped (resolves the caller's org from token/session)
 * - Distinguishes: no-data vs stale-data vs healthy
 * - Surfaces: telemetry freshness, active sources, identity coverage,
 *   GitHub engineering-evidence eligibility, auth/credential health
 *
 * Provenance: all fields are derived from server-side DB state. No
 * client-supplied claims are trusted.
 */
class PilotHealthController extends Controller
{
    use PilotAwareTokenHelper;

    /**
     * Freshness thresholds (hours). Configurable via config('pilot.health.*').
     */
    private const FRESH_HOURS = 24;
    private const STALE_HOURS = 72;

    /**
     * GET /api/pilot/health — operational pilot health snapshot.
     *
     * Requires SimpleTokenAuth (org-scoped bearer token).
     */
    public function show(Request $request): JsonResponse
    {
        $org = $this->resolveOrganization($request);
        if (!$org) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'ORG_UNRESOLVED',
                'message' => 'Could not resolve organization from request context.',
            ], 400);
        }

        $orgId = $org->id;

        // Telemetry freshness
        $telemetryHealth = $this->computeTelemetryHealth($orgId);

        // Active sources/workflows
        $activeSources = $this->computeActiveSources($orgId);

        // Installation population
        $installationCount = $this->computeInstallationCount($orgId);

        // Developer identity coverage
        $identityCoverage = $this->computeIdentityCoverage($orgId);

        // Repository attribution coverage
        $repoCoverage = $this->computeRepoAttributionCoverage($orgId);

        // GitHub engineering-evidence eligibility
        $githubState = $this->computeGithubEligibilityState($orgId);

        // Auth/credential health
        $authHealth = $this->computeAuthHealth($orgId);

        // Extension version health
        $extensionHealth = $this->computeExtensionHealth($orgId);

        // Cost configuration state
        $costState = $this->computeCostState($orgId);

        // Product readiness (factual prerequisites, not a second eligibility engine)
        $productState = $this->computeProductState($orgId);

        // CR-X Day 2 X3: Pilot Health failure-state expansion.
        // Two new customer-success dimensions:
        //   - connect_code_expiry: connect codes (invites) that have expired
        //     without being redeemed, blocking new developer enrollment.
        //   - installation_failures: extension/bridge installation failures
        //     reported via event_type='install_failure' telemetry events.
        // Both dimensions fail closed (HEALTHY) when no failure evidence exists.
        $connectCodeExpiry = $this->computeConnectCodeExpiry($orgId);
        $installationFailures = $this->computeInstallationFailures($orgId);

        // Pilot Ops Nov 2026: cohort readiness — distinguishes recent-active
        // developers from historical-only identities, reports the enrollment
        // funnel, and counts persisted delivery-evidence rows. A tenant with
        // stale-but-nonzero history must not read as telemetry-ready.
        $cohortReadiness = $this->computeCohortReadiness($orgId);

        // Overall status
        $overall = $this->computeOverallStatus($telemetryHealth, $githubState, $authHealth, $extensionHealth);

        return response()->json([
            'status' => $overall['status'],
            'severity' => $overall['severity'],
            'checked_at' => now()->toISOString(),
            'checked_at_timezone' => 'UTC',
            'organization' => [
                'id' => $orgId,
                'slug' => $org->slug ?? null,
                'name' => $org->name ?? null,
            ],
            // P0-C: Explicit authority section labels.
            // The operator must never confuse canonical product health with
            // raw ingest health, or customer GitHub with Local demo authority.
            'sections' => [
                'canonical_product_health' => 'Canonical sessions, presented workflows, PI/PBT availability, repo attribution',
                'ingest_raw_telemetry_health' => 'Raw events, raw source IDs, latest ingest, installation coverage',
                'engineering_evidence' => 'GitHub customer integration state, Local demo delivery authority',
                'identity_health' => 'Authoritative/invite-backed coverage vs inferred/legacy population',
                'failure_state_health' => 'Connect-code expiry and installation-failure signals for customer success',
                'cohort_readiness' => 'Recent-active vs historical-only developer identities, invite funnel, and delivery-evidence row presence',
            ],
            'telemetry' => $telemetryHealth,
            'extension' => $extensionHealth,
            'active_sources' => $activeSources,
            'active_sources_authority_note' => 'Raw source IDs (unnormalized). Use canonical_product_health for the canonical workflow universe.',
            'installations' => $installationCount,
            'identity_coverage' => $identityCoverage,
            'repository_attribution' => $repoCoverage,
            'github_engineering_evidence' => $githubState,
            'auth_credentials' => $authHealth,
            'cost' => $costState,
            'product' => $productState,
            // CR-X Day 2 X3: failure-state expansion
            'connect_code_expiry' => $connectCodeExpiry,
            'installation_failures' => $installationFailures,
            'cohort_readiness' => $cohortReadiness,
        ]);
    }

    /**
     * CR-X Day 1B S2: Remediation contract builder.
     *
     * Returns a remediation object for degraded/warning states, or null for
     * healthy states. Each remediation includes:
     * - action: truthful next action text
     * - url: browser-navigable GET URL (page or download), or null for API
     *   mutation/config endpoints that cannot safely be navigated with <a href>
     * - runbook_ref: documentation section reference
     *
     * Only implemented Local routes/actions are referenced. No nonexistent
     * product surfaces are linked. URL semantics:
     *   /settings?tab=... → browser-navigable page → url
     *   /api/extension/download/latest → GET download → url
     *   /api/telemetry/canonical → GET read endpoint → url
     *   /api/org/spend/config → PUT mutation endpoint → url: null
     */
    private function buildRemediation(string $dimension, string $state): ?array
    {
        $remediations = [
            'telemetry' => [
                'NO_DATA' => [
                    'action' => 'Install the extension and complete invite-backed IDE enrollment for at least one developer.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##14,CANONICAL##15',
                ],
                'AGING' => [
                    'action' => 'Check extension connectivity; confirm the developer IDE is online and sending events. Reissue the connect code if the token or connection was lost.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##14,ONBOARDING##9',
                ],
                'STALE' => [
                    'action' => 'Urgent: verify the extension is installed and running. Renew or re-enroll the installation.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##14,ONBOARDING##9',
                ],
            ],
            'extension' => [
                'UNKNOWN' => [
                    'action' => 'Reinstall the extension from the latest VSIX so extension_version and installation_id are sent in telemetry.',
                    'url' => '/api/extension/download/latest',
                    'runbook_ref' => 'CANONICAL##14,ONBOARDING##4',
                ],
                'OUTDATED' => [
                    'action' => 'Download and install the current VSIX for all outdated installations.',
                    'url' => '/api/extension/download/latest',
                    'runbook_ref' => 'CANONICAL##14',
                ],
                'MIXED' => [
                    'action' => 'Update the outdated installations to the current VSIX version.',
                    'url' => '/api/extension/download/latest',
                    'runbook_ref' => 'CANONICAL##14',
                ],
            ],
            'identity_coverage' => [
                'LOW' => [
                    'action' => 'Convert remaining developers to invite-backed identity by re-enrolling with personal connect codes.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##13,CANONICAL##14,ONBOARDING##4',
                ],
                'NONE' => [
                    'action' => 'Create per-developer invite-backed enrollments to establish developer identity.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##13,CANONICAL##14,ONBOARDING##4',
                ],
            ],
            'repository_attribution' => [
                'LOW' => [
                    'action' => 'Ensure IDE Git integration is enabled so git_repo_url metadata appears in telemetry. This is a client-side IDE configuration — no server-side endpoint can fix it.',
                    'url' => null,
                    'runbook_ref' => 'ONBOARDING##6,ONBOARDING##9',
                ],
            ],
            'github_engineering_evidence' => [
                'NOT_CONNECTED' => [
                    'action' => 'Connect GitHub Engineering Data via the integrations settings tab.',
                    'url' => '/settings?tab=integrations',
                    'runbook_ref' => 'CANONICAL##13,CANONICAL##16,ONBOARDING##7',
                ],
                'LOGIN_ONLY' => [
                    'action' => 'Re-authorize with the engineering-integration scope to enable engineering evidence eligibility.',
                    'url' => '/settings?tab=integrations',
                    'runbook_ref' => 'CANONICAL##13,CANONICAL##16',
                ],
                'PARTIAL' => [
                    'action' => 'Re-authorize to set token_purpose=engineering_integration.',
                    'url' => '/settings?tab=integrations',
                    'runbook_ref' => 'CANONICAL##13,CANONICAL##16',
                ],
            ],
            'auth_credentials' => [
                'ALL_EXPIRED' => [
                    'action' => 'Re-enroll installations: issue new per-developer connect codes from the team settings tab.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##14',
                ],
                'EXPIRING_SOON' => [
                    'action' => 'The extension should auto-renew. If it does not, reissue the connect code before expiry from the team settings tab.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##14',
                ],
            ],
            'cost' => [
                'UNKNOWN' => [
                    'action' => 'Configure tool costs in PBT. Cost configuration is persisted for the organization through the backend spend configuration API.',
                    'url' => null,
                    'runbook_ref' => null,
                ],
            ],
            'product_pi' => [
                'BLOCKED' => [
                    'action' => 'Enroll developers and send telemetry to enable PI generation.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##15',
                ],
                'UNKNOWN' => [
                    'action' => 'Wait or refresh the canonical population; verify telemetry shape via the canonical telemetry endpoint.',
                    'url' => '/api/telemetry/canonical?format=sessions',
                    'runbook_ref' => 'CANONICAL##15',
                ],
            ],
            'product_pbt' => [
                'BLOCKED' => [
                    'action' => 'Enroll developers and send telemetry to enable PBT workflow trends.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##15',
                ],
                'UNKNOWN' => [
                    'action' => 'Send more canonical sessions/workflows to populate PBT data.',
                    'url' => '/api/telemetry/canonical',
                    'runbook_ref' => 'CANONICAL##15',
                ],
            ],
            'decision_intelligence' => [
                'BLOCKED' => [
                    'action' => 'Enroll developers and send canonical sessions to enable decision intelligence.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##14,CANONICAL##15',
                ],
                'PARTIAL' => [
                    'action' => 'Resolve the blocked or unknown sub-dimension: invite-backed enrollment, telemetry, or cost configuration.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##13,CANONICAL##14,CANONICAL##15',
                ],
            ],
            // CR-X Day 2 X3: failure-state remediation contracts
            'connect_code_expiry' => [
                'EXPIRED_UNREDEEMED' => [
                    'action' => 'Issue new connect codes for unredeemed expired invites. The developer cannot enroll with an expired code.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##13,CANONICAL##14,ONBOARDING##4',
                ],
                'EXPIRING_SOON' => [
                    'action' => 'Notify developers with expiring unredeemed connect codes to complete enrollment before expiry.',
                    'url' => '/settings?tab=team',
                    'runbook_ref' => 'CANONICAL##13,CANONICAL##14,ONBOARDING##4',
                ],
            ],
            'installation_failures' => [
                'FAILURES_DETECTED' => [
                    'action' => 'Review installation failure details with the affected developer. Reinstall the extension or Claude Code bridge from the latest artifact.',
                    'url' => '/api/extension/download/latest',
                    'runbook_ref' => 'CANONICAL##14,ONBOARDING##4',
                ],
            ],
        ];

        return $remediations[$dimension][$state] ?? null;
    }

    /**
     * Telemetry freshness: latest timestamp, staleness, no-data distinction.
     */
    private function computeTelemetryHealth(int $orgId): array
    {
        $latest = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->max('created_at');

        $eventCount = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->count();

        $sessionCount = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereNotNull('session_id')
            ->distinct()
            ->count('session_id');

        if ($eventCount === 0) {
            return [
                'state' => 'NO_DATA',
                'latest_event_at' => null,
                'latest_event_timezone' => 'UTC',
                'event_count' => 0,
                'session_count' => 0,
                'freshness_hours' => null,
                'freshness_human' => null,
                'message' => 'No telemetry events received yet.',
                'remediation' => $this->buildRemediation('telemetry', 'NO_DATA'),
            ];
        }

        // P0-B: Parse the DB timestamp as UTC and serialize as ISO8601 with Z.
        // The DB stores naive `YYYY-MM-DD HH:mm:ss` (no timezone marker).
        // Without explicit UTC serialization, JavaScript's new Date() interprets
        // the value as browser-local time, causing a multi-hour display offset.
        $latestCarbon = $latest ? \Carbon\Carbon::parse($latest) : null;
        $latestIso = $latestCarbon ? $latestCarbon->toISOString() : null;

        $freshnessHours = $latestCarbon ? abs(now()->diffInHours($latestCarbon)) : null;

        $state = 'HEALTHY';
        if ($freshnessHours !== null && $freshnessHours > self::STALE_HOURS) {
            $state = 'STALE';
        } elseif ($freshnessHours !== null && $freshnessHours > self::FRESH_HOURS) {
            $state = 'AGING';
        }

        // P0-E: Human-readable freshness (bounded copy, not raw decimal hours).
        $freshnessHuman = $this->humanizeFreshnessHours($freshnessHours);

        return [
            'state' => $state,
            'latest_event_at' => $latestIso,
            'latest_event_timezone' => 'UTC',
            'event_count' => $eventCount,
            'session_count' => $sessionCount,
            'freshness_hours' => $freshnessHours !== null ? round($freshnessHours, 1) : null,
            'freshness_human' => $freshnessHuman,
            'freshness_threshold_hours' => self::FRESH_HOURS,
            'stale_threshold_hours' => self::STALE_HOURS,
            'message' => $state === 'HEALTHY'
                ? "Telemetry flowing (last event {$freshnessHuman})."
                : ($state === 'STALE'
                    ? "Telemetry stale (last event {$freshnessHuman}, exceeds " . self::STALE_HOURS . "h threshold)."
                    : "Telemetry aging (last event {$freshnessHuman})."),
            'remediation' => $this->buildRemediation('telemetry', $state),
        ];
    }

    /**
     * Active telemetry sources/workflows (editor_source distribution).
     */
    private function computeActiveSources(int $orgId): array
    {
        $sources = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->select('editor_source', DB::raw('count(*) as event_count'), DB::raw('count(distinct session_id) as session_count'))
            ->groupBy('editor_source')
            ->orderByDesc('session_count')
            ->get();

        $extensionVersions = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->select('source', DB::raw('MAX(created_at) as last_seen'))
            ->groupBy('source')
            ->get()
            ->keyBy('source');

        return $sources->map(function ($s) use ($extensionVersions) {
            $lastSeen = $extensionVersions->has($s->editor_source)
                ? $extensionVersions->get($s->editor_source)->last_seen
                : null;
            // P0-B: Serialize as ISO8601 with Z (UTC), not raw naive datetime.
            $lastSeenIso = $lastSeen ? \Carbon\Carbon::parse($lastSeen)->toISOString() : null;
            return [
                'editor_source' => $s->editor_source,
                'event_count' => $s->event_count,
                'session_count' => $s->session_count,
                'last_seen' => $lastSeenIso,
                'last_seen_timezone' => 'UTC',
            ];
        })->values()->toArray();
    }

    /**
     * Installation population (distinct installation_id values).
     *
     * PILOT OPS 14-C: the "Telemetry" count uses the SAME installation-identity
     * authority as the Extension Versions card — the installation_id carried in
     * telemetry event metadata (json_extract(metadata, '$.installation_id')).
     * The top-level telemetry_events.installation_id column is sparsely
     * populated and undercounted (e.g. 1 vs 18 on Ed), which made the
     * Installations card contradict Extension Versions. "Tokens" counts
     * distinct installations with active auth tokens (enrolled; may not have
     * sent telemetry yet), so Telemetry ≤ Tokens is expected and not a
     * contradiction.
     */
    private function computeInstallationCount(int $orgId): array
    {
        $installIds = (int) DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereNotNull('metadata')
            ->whereNotNull(DB::raw("json_extract(metadata, '$.installation_id')"))
            ->selectRaw("COUNT(DISTINCT json_extract(metadata, '$.installation_id')) as cnt")
            ->value('cnt');

        $tokenInstallations = DB::table('api_tokens')
            ->where('organization_id', $orgId)
            ->whereNotNull('installation_id')
            ->distinct()
            ->count('installation_id');

        return [
            'telemetry_installations' => $installIds,
            'token_installations' => $tokenInstallations,
            'message' => $installIds === 0
                ? 'No installations have sent telemetry.'
                : "{$installIds} installation(s) have sent telemetry.",
            'authority_note' => 'Telemetry = distinct installation IDs observed in telemetry event metadata (same authority as Extension Versions). Tokens = distinct installations with active auth tokens (enrolled; may not have sent telemetry yet). Telemetry ≤ Tokens is expected.',
        ];
    }

    /**
     * Developer identity coverage: how many distinct user_ids, and what
     * fraction have invite-backed identity vs legacy/unknown.
     */
    private function computeIdentityCoverage(int $orgId): array
    {
        // CR-X Phase 3: Use canonical session population (event_type='session',
        // segment_type='session') for identity coverage, consistent with
        // buildCanonicalQuery. Non-session rows can inflate the denominator
        // and make coverage percentages inconsistent with the canonical population.
        //
        // CR-X Pilot Ops 3: Fail closed on person-level coverage whenever the
        // observed identity population contains classes that cannot be
        // authoritatively resolved to people (pd-session-*, cm-dev-*,
        // dev-user-*, raw numeric ids, etc.). Invite-backed identities are
        // still reported as observed count, but the coverage percentage is
        // null/unavailable unless every observed identity is authoritative.
        $userIds = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->where('event_type', 'session')
            ->whereRaw("json_extract(metadata, '$.segment_type') = 'session'")
            ->whereNotNull('user_id')
            ->distinct()
            ->pluck('user_id');

        $totalIdentities = $userIds->count();

        $inviteBackedCount = 0;
        $unresolvedCount = 0;
        $unresolvedClasses = [];

        foreach ($userIds as $userId) {
            $userId = (string) $userId;

            if (preg_match('/^invite:\d+$/', $userId)) {
                $inviteBackedCount++;
                continue;
            }

            $unresolvedCount++;
            $class = $this->classifyUnresolvedIdentity($userId);
            if ($class && !in_array($class, $unresolvedClasses, true)) {
                $unresolvedClasses[] = $class;
            }
        }

        // Empty population: preserve existing truthful no-data semantics.
        if ($totalIdentities === 0) {
            return [
                'person_level_identity_coverage' => 'UNAVAILABLE',
                'total_identities' => 0,
                'invite_backed' => 0,
                'total_developers' => 0,
                'legacy_or_unknown' => 0,
                'unresolved_identity_classes' => [],
                'invite_backed_coverage_pct' => 0,
                'message' => 'No developer identities observed.',
                'remediation' => $this->buildRemediation('identity_coverage', 'NONE'),
            ];
        }

        // If any observed identity class cannot be authoritatively resolved
        // to a person, person-level coverage is unavailable. We still report
        // the observed invite-backed identity count, but we never fabricate a
        // developer count or percentage. Raw implementation-class names are
        // kept in unresolved_identity_classes for diagnostics/tests only and
        // are not enumerated in the customer-facing message.
        if ($unresolvedCount > 0) {
            sort($unresolvedClasses);
            $identityWord = $inviteBackedCount === 1 ? 'identity' : 'identities';

            return [
                'person_level_identity_coverage' => 'UNAVAILABLE',
                'total_identities' => $totalIdentities,
                'invite_backed' => $inviteBackedCount,
                'total_developers' => null,
                'legacy_or_unknown' => $unresolvedCount,
                'unresolved_identity_classes' => $unresolvedClasses,
                'invite_backed_coverage_pct' => null,
                'message' => "{$inviteBackedCount} invite-backed {$identityWord} observed. Person-level coverage is unavailable while legacy identity formats are present.",
                'remediation' => null,
            ];
        }

        // All observed identities are invite-backed: authoritative person count.
        return [
            'person_level_identity_coverage' => 'AVAILABLE',
            'total_identities' => $totalIdentities,
            'invite_backed' => $inviteBackedCount,
            'total_developers' => $totalIdentities,
            'legacy_or_unknown' => 0,
            'unresolved_identity_classes' => [],
            'invite_backed_coverage_pct' => 100.0,
            'message' => "{$inviteBackedCount}/{$totalIdentities} developers have invite-backed identity (100%).",
            'remediation' => null,
        ];
    }

    /**
     * Classify a raw user_id that is not invite-backed into a compact
     * provenance class. Returns null if the value is already authoritative.
     */
    private function classifyUnresolvedIdentity(string $userId): ?string
    {
        if (str_starts_with($userId, 'pd-session-')) {
            return 'pd-session-*';
        }

        if (str_starts_with($userId, 'cm-dev-')) {
            return 'cm-dev-*';
        }

        if (str_starts_with($userId, 'dev-user-')) {
            return 'dev-user-*';
        }

        if (preg_match('/^\d+$/', $userId)) {
            return 'numeric-id';
        }

        if (in_array(strtolower($userId), ['unknown', 'anonymous', 'test'], true)) {
            return 'opaque/unknown';
        }

        return 'legacy/other';
    }

    /**
     * Cohort readiness (Pilot Ops Nov 2026 audit finding).
     *
     * Historical canonical sessions do not by themselves establish current
     * telemetry coverage. This block reports:
     *   - distinct canonical-session identities observed all-time
     *   - distinct identities active within the last 7 and 30 days
     *   - the invite enrollment funnel (issued / redeemed / telemetry-backed)
     *   - persisted delivery-evidence rows (PRs, deployments, releases)
     *
     * `telemetry_recency` is the headline distinction:
     *   ACTIVE_RECENT  — at least one canonical-session identity in last 7d
     *   HISTORICAL_ONLY — canonical history exists but no identity in last 7d
     *   NONE           — no canonical-session identities at all
     *
     * Fails closed on schema variance: invite/evidence counts are reported
     * as null rather than guessed when a table is absent.
     */
    private function computeCohortReadiness(int $orgId): array
    {
        $canonicalQuery = function () use ($orgId) {
            return DB::table('telemetry_events')
                ->where('organization_id', $orgId)
                ->where('event_type', 'session')
                ->whereRaw("json_extract(metadata, '$.segment_type') = 'session'")
                ->whereNotNull('user_id')
                ->where('user_id', '!=', '');
        };

        $allTime = (clone $canonicalQuery())->distinct()->count('user_id');
        $active7d = (clone $canonicalQuery())
            ->where('timestamp', '>=', now()->subDays(7)->toDateTimeString())
            ->distinct()->count('user_id');
        $active30d = (clone $canonicalQuery())
            ->where('timestamp', '>=', now()->subDays(30)->toDateTimeString())
            ->distinct()->count('user_id');

        $telemetryRecency = $allTime === 0
            ? 'NONE'
            : ($active7d > 0 ? 'ACTIVE_RECENT' : 'HISTORICAL_ONLY');

        // Invite funnel — schema-guarded; null means unavailable, not zero.
        $invitesIssued = null;
        $invitesRedeemed = null;
        try {
            $invitesIssued = DB::table('invites')
                ->where('organization_id', $orgId)
                ->count();
            $invitesRedeemed = DB::table('invites')
                ->where('organization_id', $orgId)
                ->whereNotNull('redeemed_at')
                ->count();
        } catch (\Throwable $e) {
            // leave null — unavailable, not zero
        }

        // Delivery-evidence rows — org-wide tables (evidence is org-level,
        // not session-attributed). Null means unavailable, not zero.
        $delivery = ['pull_requests' => null, 'deployments' => null, 'releases' => null];
        foreach (array_keys($delivery) as $table) {
            try {
                $delivery[$table] = DB::table($table)
                    ->where('organization_id', $orgId)
                    ->count();
            } catch (\Throwable $e) {
                // leave null — table/column absent on this tenant
            }
        }

        $message = match ($telemetryRecency) {
            'NONE' => 'No canonical-session identities observed.',
            'HISTORICAL_ONLY' => "{$allTime} historical identit" . ($allTime === 1 ? 'y' : 'ies') . " but none active in the last 7 days — coverage is not current.",
            default => "{$active7d} developer identit" . ($active7d === 1 ? 'y' : 'ies') . " active in the last 7 days ({$active30d} in 30d, {$allTime} all-time).",
        };

        return [
            'telemetry_recency' => $telemetryRecency,
            'identities_all_time' => $allTime,
            'identities_active_7d' => $active7d,
            'identities_active_30d' => $active30d,
            'invites_issued' => $invitesIssued,
            'invites_redeemed' => $invitesRedeemed,
            'delivery_evidence' => $delivery,
            'message' => $message,
        ];
    }

    /**
     * Repository attribution coverage: fraction of events with git_repo_url metadata.
     * CR-X Phase 3: Use the correct telemetry field name 'git_repo_url' (not 'git_repo').
     * Telemetry-derived repo identity is independent of GitHub OAuth status.
     */
    private function computeRepoAttributionCoverage(int $orgId): array
    {
        $totalEvents = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->count();

        // CR-X Phase 3: Correct field name is git_repo_url, not git_repo.
        $withRepo = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereRaw("json_extract(metadata, '$.git_repo_url') IS NOT NULL")
            ->whereRaw("json_extract(metadata, '$.git_repo_url') != ''")
            ->count();

        $coveragePct = $totalEvents > 0
            ? round(($withRepo / $totalEvents) * 100, 1)
            : 0;

        $distinctRepos = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereRaw("json_extract(metadata, '$.git_repo_url') IS NOT NULL")
            ->whereRaw("json_extract(metadata, '$.git_repo_url') != ''")
            ->distinct()
            ->count(DB::raw("json_extract(metadata, '$.git_repo_url')"));

        return [
            'events_with_repo' => $withRepo,
            'total_events' => $totalEvents,
            'attribution_coverage_pct' => $coveragePct,
            'distinct_repos' => $distinctRepos,
            'message' => $totalEvents === 0
                ? 'No events to assess repository attribution.'
                : "{$withRepo}/{$totalEvents} events have repo attribution ({$coveragePct}%, {$distinctRepos} distinct repos).",
            'remediation' => ($totalEvents === 0 || $coveragePct < 50)
                ? $this->buildRemediation('repository_attribution', 'LOW')
                : null,
        ];
    }

    /**
     * GitHub engineering-evidence eligibility state.
     *
     * Distinguishes login identity OAuth from engineering-evidence authorization.
     * Uses the same isEngineeringEvidenceEligible gate as the evidence consumers.
     */
    private function computeGithubEligibilityState(int $orgId): array
    {
        $oauthTokens = DB::table('oauth_tokens')
            ->where('organization_id', $orgId)
            ->get();

        if ($oauthTokens->isEmpty()) {
            return [
                'state' => 'NOT_CONNECTED',
                'login_connected' => false,
                'engineering_evidence_eligible' => false,
                'token_purposes' => [],
                'message' => 'No GitHub OAuth tokens for this organization.',
                'remediation' => $this->buildRemediation('github_engineering_evidence', 'NOT_CONNECTED'),
            ];
        }

        // token_purpose is stored inside the user_data JSON column
        $purposes = [];
        $engineeringEligible = false;
        foreach ($oauthTokens as $token) {
            $userData = is_string($token->user_data) ? json_decode($token->user_data, true) : ($token->user_data ?? []);
            $purpose = $userData['token_purpose'] ?? null;
            if ($purpose) {
                $purposes[] = $purpose;
            }
            if ($purpose === 'engineering_integration') {
                $engineeringEligible = true;
            }
        }

        $purposes = array_values(array_unique($purposes));
        $hasIdentityOnly = in_array('identity_only', $purposes);
        $hasMissing = empty($purposes) || in_array('missing', $purposes, true);

        $state = 'NOT_CONNECTED';
        if ($engineeringEligible) {
            $state = 'CONNECTED';
        } elseif ($hasIdentityOnly) {
            $state = 'LOGIN_ONLY';
        } elseif ($hasMissing) {
            $state = 'PARTIAL';
        }

        $message = match ($state) {
            'CONNECTED' => 'GitHub engineering evidence is eligible (token_purpose=engineering_integration).',
            'LOGIN_ONLY' => 'GitHub login connected but engineering evidence is NOT eligible. Only identity OAuth is connected; engineering integration requires a separate explicit authorization.',
            'PARTIAL' => 'GitHub token exists but purpose is missing/unknown. Re-authorization recommended.',
            'NOT_CONNECTED' => 'No GitHub connection.',
            default => 'Unknown GitHub state.',
        };

        return [
            'state' => $state,
            'login_connected' => true,
            'engineering_evidence_eligible' => $engineeringEligible,
            'token_purposes' => $purposes,
            'historical_evidence_available' => $this->computeHistoricalEvidenceAvailability($orgId),
            'message' => $message,
            'remediation' => $this->buildRemediation('github_engineering_evidence', $state),
        ];
    }

    /**
     * Historical evidence availability — reuses the same provenance authority
     * as PullRequestController's github_provenance.historical_data_available.
     *
     * Real evidence requires data_source = 'db_sync' (not seeded/demo/simulated).
     * Seeded/demo data (cm_activity_sim, demo, realism_seeder) is NOT real
     * historical evidence.
     *
     * This is distinct from:
     * - login connected (OAuth token exists)
     * - engineering integration authorized (token_purpose = engineering_integration)
     * - current eligible data available (live fetch succeeded)
     */
    private function computeHistoricalEvidenceAvailability(int $orgId): bool
    {
        // Check if pull_requests table exists (may not in fresh test DB)
        if (!DB::getSchemaBuilder()->hasTable('pull_requests')) {
            return false;
        }

        // Real evidence requires data_source indicating actual GitHub API sync,
        // not seeded/demo/simulated data. This mirrors PullRequestController's
        // github_data_source === 'db_sync' provenance rule.
        $realPrCount = DB::table('pull_requests')
            ->whereNotIn('data_source', ['cm_activity_sim', 'demo', 'realism_seeder', 'fixture_fallback', 'seeded', 'simulated'])
            ->count();

        if ($realPrCount > 0) {
            return true;
        }

        // Check deployments if table exists
        if (DB::getSchemaBuilder()->hasTable('deployments')) {
            $realDeployCount = DB::table('deployments')
                ->whereNotIn('data_source', ['cm_activity_sim', 'demo', 'realism_seeder', 'fixture_fallback', 'seeded', 'simulated'])
                ->count();
            if ($realDeployCount > 0) {
                return true;
            }
        }

        return false;
    }

    /**
     * Auth/credential health: token expiration, valid token count.
     */
    private function computeAuthHealth(int $orgId): array
    {
        $now = now();

        // CR-X fix: Exclude revoked tokens from all counts.
        // A revoked token is no longer active, no longer "expired" (it's revoked),
        // and no longer "expiring soon" (it's already invalidated).
        $activeTokens = DB::table('api_tokens')
            ->where('organization_id', $orgId)
            ->whereNull('revoked_at')
            ->where(function ($q) use ($now) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', $now);
            })
            ->count();

        $expiredTokens = DB::table('api_tokens')
            ->where('organization_id', $orgId)
            ->whereNull('revoked_at')
            ->where('expires_at', '<=', $now)
            ->count();

        $expiringSoon = DB::table('api_tokens')
            ->where('organization_id', $orgId)
            ->whereNull('revoked_at')
            ->where('expires_at', '>', $now)
            ->where('expires_at', '<', $now->copy()->addDays(7))
            ->count();

        $state = 'HEALTHY';
        if ($activeTokens === 0 && $expiredTokens > 0) {
            $state = 'ALL_EXPIRED';
        } elseif ($expiringSoon > 0) {
            $state = 'EXPIRING_SOON';
        }

        return [
            'state' => $state,
            'active_tokens' => $activeTokens,
            'expired_tokens' => $expiredTokens,
            'expiring_within_7d' => $expiringSoon,
            'message' => match ($state) {
                'ALL_EXPIRED' => 'All API tokens have expired. Re-enrollment required.',
                'EXPIRING_SOON' => "{$expiringSoon} token(s) expire within 7 days. Proactive renewal recommended.",
                'HEALTHY' => $activeTokens === 0
                    ? 'No active tokens (pre-enrollment).'
                    : "{$activeTokens} active token(s).",
                default => 'Unknown auth state.',
            },
            'remediation' => $this->buildRemediation('auth_credentials', $state),
        ];
    }

    /**
     * CR-X Day 2 X3: Connect-code expiry health.
     *
     * Scans the invites table for connect codes (invites) that have expired
     * without being redeemed. An expired unredeemed connect code blocks new
     * developer enrollment — the developer cannot use it to connect.
     *
     * States:
     *   HEALTHY              — no expired/expiring unredeemed codes
     *   EXPIRING_SOON        — ≥1 unredeemed code expires within 7 days
     *   EXPIRED_UNREDEEMED   — ≥1 unredeemed code has already expired
     *
     * Fails closed (HEALTHY) when the invites table does not exist or has
     * no unredeemed codes.
     */
    private function computeConnectCodeExpiry(int $orgId): array
    {
        if (!DB::getSchemaBuilder()->hasTable('invites')) {
            return [
                'state' => 'HEALTHY',
                'expired_unredeemed' => 0,
                'expiring_within_7d' => 0,
                'total_unredeemed' => 0,
                'message' => 'Invites table not available — no connect-code expiry signal.',
                'remediation' => null,
            ];
        }

        $now = now();
        $sevenDaysFromNow = $now->copy()->addDays(7);

        // PILOT OPS 18H: this dimension reports on developer enrollments
        // (code-backed invites), not dashboard-account invites. Enrollment
        // invites carry the non-expiring sentinel, so any expired/expiring
        // row here is a legacy natural-expiry row awaiting reconciliation.
        // Admin-cancelled invites (revoked sentinel on the invite row) are
        // excluded here and reported under 'revoked' instead.
        $enrollmentScope = fn ($query) => $query
            ->whereExists(function ($q) {
                $q->select(DB::raw(1))
                    ->from('ide_connect_codes')
                    ->whereColumn('ide_connect_codes.invite_id', 'invites.id');
            })
            ->where('invites.expires_at', '!=', IDEConnectCode::REVOKED_EXPIRES_AT);

        // Unredeemed = redeemed_at IS NULL
        $expiredUnredeemed = $enrollmentScope(
            DB::table('invites')
                ->where('organization_id', $orgId)
                ->whereNull('redeemed_at')
                ->where('expires_at', '<=', $now)
        )->count();

        $expiringSoon = $enrollmentScope(
            DB::table('invites')
                ->where('organization_id', $orgId)
                ->whereNull('redeemed_at')
                ->where('expires_at', '>', $now)
                ->where('expires_at', '<', $sevenDaysFromNow)
        )->count();

        $totalUnredeemed = $enrollmentScope(
            DB::table('invites')
                ->where('organization_id', $orgId)
                ->whereNull('redeemed_at')
        )->count();

        // Admin-closed enrollments, reported truthfully as revoked — never as
        // expired. Two forms: (a) invite soft-closed with the revoked marker
        // (cancel enrollment), (b) invite with a revoked-marker code and no
        // live code (revoke/regenerate connect code).
        $revokedCount = DB::table('invites')
            ->where('organization_id', $orgId)
            ->whereNull('redeemed_at')
            ->where(function ($outer) use ($now) {
                $outer->where('invites.expires_at', IDEConnectCode::REVOKED_EXPIRES_AT)
                    ->orWhere(function ($inner) use ($now) {
                        $inner->whereExists(function ($q) {
                            $q->select(DB::raw(1))
                                ->from('ide_connect_codes')
                                ->whereColumn('ide_connect_codes.invite_id', 'invites.id')
                                ->where('ide_connect_codes.expires_at', IDEConnectCode::REVOKED_EXPIRES_AT);
                        })->whereNotExists(function ($q) use ($now) {
                            $q->select(DB::raw(1))
                                ->from('ide_connect_codes')
                                ->whereColumn('ide_connect_codes.invite_id', 'invites.id')
                                ->where('ide_connect_codes.expires_at', '>', $now);
                        });
                    });
            })
            ->count();

        $state = 'HEALTHY';
        if ($expiredUnredeemed > 0) {
            $state = 'EXPIRED_UNREDEEMED';
        } elseif ($expiringSoon > 0) {
            $state = 'EXPIRING_SOON';
        }

        $revokedNote = $revokedCount > 0 ? " {$revokedCount} enrollment(s) were revoked by an admin." : '';

        return [
            'state' => $state,
            'expired_unredeemed' => $expiredUnredeemed,
            'expiring_within_7d' => $expiringSoon,
            'total_unredeemed' => $totalUnredeemed,
            'revoked' => $revokedCount,
            'message' => match ($state) {
                'EXPIRED_UNREDEEMED' => "{$expiredUnredeemed} connect code(s) expired without redemption. New codes must be issued." . $revokedNote,
                'EXPIRING_SOON' => "{$expiringSoon} unredeemed connect code(s) expire within 7 days." . $revokedNote,
                'HEALTHY' => $totalUnredeemed === 0
                    ? 'No unredeemed connect codes.' . $revokedNote
                    : "{$totalUnredeemed} unredeemed connect code(s), none expired or expiring soon." . $revokedNote,
                default => 'Unknown connect-code expiry state.',
            },
            'remediation' => $this->buildRemediation('connect_code_expiry', $state),
        ];
    }

    /**
     * CR-X Day 2 X3: Installation-failure health.
     *
     * Scans telemetry_events for event_type='install_failure' events.
     * The extension/bridge reports an install_failure event when the
     * installation or upgrade process fails (e.g. validation failure,
     * settings restore, bridge install). This gives customer success
     * visibility into developers who attempted but failed to install.
     *
     * States:
     *   HEALTHY             — no install_failure events
     *   FAILURES_DETECTED   — ≥1 install_failure event observed
     *
     * Fails closed (HEALTHY) when no install_failure events exist.
     */
    private function computeInstallationFailures(int $orgId): array
    {
        if (!DB::getSchemaBuilder()->hasTable('telemetry_events')) {
            return [
                'state' => 'HEALTHY',
                'failure_count' => 0,
                'latest_failure_at' => null,
                'message' => 'Telemetry table not available — no installation-failure signal.',
                'remediation' => null,
            ];
        }

        $failureCount = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->where('event_type', 'install_failure')
            ->count();

        $latestFailureAt = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->where('event_type', 'install_failure')
            ->max('timestamp');

        $state = $failureCount > 0 ? 'FAILURES_DETECTED' : 'HEALTHY';

        return [
            'state' => $state,
            'failure_count' => $failureCount,
            'latest_failure_at' => $latestFailureAt,
            'message' => match ($state) {
                'FAILURES_DETECTED' => "{$failureCount} installation failure(s) detected. Review with affected developers.",
                'HEALTHY' => 'No installation failures detected.',
                default => 'Unknown installation-failure state.',
            },
            'remediation' => $this->buildRemediation('installation_failures', $state),
        ];
    }

    /**
     * Extension version health: LATEST observed version per identified
     * installation/source — NOT historical distribution.
     *
     * P0-D: If version health scans all historical event versions, it can
     * remain MIXED forever after every developer has upgraded. The primary
     * version-health authority is the latest observed version per
     * installation. Historical version distribution remains secondary context.
     *
     * CR-X WAVE 2: Recognizes both the main VS Code extension (0.4.1) and
     * the Claude Code bridge (0.4.1-cc-bridge) as current/expected versions.
     * The bridge is a separate artifact with its own version string — it
     * is NOT outdated just because it doesn't match the main extension version.
     */
    private function computeExtensionHealth(int $orgId): array
    {
        // Expected versions from canonical release artifacts.
        $expectedVersions = ['0.4.1', '0.4.1-cc-bridge', '0.4.2-cc-bridge'];

        // P0-D: Get the LATEST observed version per installation_id.
        // This prevents a legacy historical event from making a current
        // installation appear outdated forever.
        $perInstall = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereNotNull('metadata')
            ->whereNotNull(DB::raw("json_extract(metadata, '$.extension_version')"))
            ->whereNotNull(DB::raw("json_extract(metadata, '$.installation_id')"))
            ->select(
                DB::raw("json_extract(metadata, '$.installation_id') as installation_id"),
                DB::raw("json_extract(metadata, '$.extension_version') as version"),
                DB::raw('MAX(created_at) as last_seen')
            )
            ->groupBy('installation_id', 'version')
            ->get();

        if ($perInstall->isEmpty()) {
            // Fallback: no installation_id metadata — use source-level latest
            return $this->computeExtensionHealthFallback($orgId, $expectedVersions);
        }

        // For each installation, find the LATEST observed version
        $latestPerInstall = [];
        foreach ($perInstall as $row) {
            $installId = $row->installation_id;
            if (!isset($latestPerInstall[$installId]) ||
                \Carbon\Carbon::parse($row->last_seen)->gt(\Carbon\Carbon::parse($latestPerInstall[$installId]['last_seen_raw']))) {
                $latestPerInstall[$installId] = [
                    'version' => $row->version,
                    'last_seen_raw' => $row->last_seen,
                ];
            }
        }

        // Classify each installation
        $installations = [];
        $current = 0;
        $outdated = 0;
        foreach ($latestPerInstall as $installId => $info) {
            $version = $info['version'];
            $isBridge = str_contains($version, 'cc-bridge');
            $canonical = $isBridge ? '0.4.2-cc-bridge' : '0.4.1';

            $status = version_compare($version, $canonical, '>=') ? 'CURRENT' : 'OUTDATED';
            if ($status === 'CURRENT') $current++;
            else $outdated++;

            $installations[] = [
                'installation_id' => $installId,
                'latest_version' => $version,
                'canonical_version' => $canonical,
                'status' => $status,
                'is_bridge' => $isBridge,
                'last_seen' => \Carbon\Carbon::parse($info['last_seen_raw'])->toISOString(),
                'last_seen_timezone' => 'UTC',
            ];
        }

        // Overall summary based on latest-per-installation
        $totalInstalls = count($installations);
        $state = 'UNKNOWN';
        if ($totalInstalls === 0) {
            $state = 'UNKNOWN';
        } elseif ($current === $totalInstalls) {
            $state = 'UP_TO_DATE';
        } elseif ($outdated === $totalInstalls) {
            $state = 'OUTDATED';
        } else {
            $state = 'MIXED';
        }

        $message = match ($state) {
            'UP_TO_DATE' => "All {$totalInstalls} installation(s) are running a current version (" . implode(' or ', $expectedVersions) . ").",
            'MIXED' => "{$current}/{$totalInstalls} installations are current; {$outdated} need updating.",
            'OUTDATED' => "All {$totalInstalls} installation(s) need updating to a current version (" . implode(' or ', $expectedVersions) . ").",
            default => 'No extension version metadata found in telemetry.',
        };

        // Also include historical version distribution as secondary context
        $historicalVersions = $this->computeHistoricalVersionDistribution($orgId);

        return [
            'state' => $state,
            'expected_versions' => $expectedVersions,
            'observed_versions' => $historicalVersions,
            'installations' => $installations,
            'installation_summary' => [
                'total' => $totalInstalls,
                'current' => $current,
                'outdated' => $outdated,
            ],
            'authority_note' => 'Version health is based on LATEST observed version per installation, not historical distribution. A legacy event does not mean a current installation is old.',
            'message' => $message,
            'remediation' => $this->buildRemediation('extension', $state),
        ];
    }

    /**
     * Historical version distribution (secondary context for P0-D).
     */
    private function computeHistoricalVersionDistribution(int $orgId): array
    {
        $observed = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereNotNull('metadata')
            ->select(
                DB::raw("json_extract(metadata, '$.extension_version') as version"),
                DB::raw('COUNT(*) as event_count'),
                DB::raw('MAX(created_at) as last_seen')
            )
            ->whereNotNull(DB::raw("json_extract(metadata, '$.extension_version')"))
            ->groupBy('version')
            ->orderByDesc('last_seen')
            ->get();

        return $observed->map(fn ($r) => [
            'version' => $r->version,
            'event_count' => $r->event_count,
            'last_seen' => $r->last_seen ? \Carbon\Carbon::parse($r->last_seen)->toISOString() : null,
            'last_seen_timezone' => 'UTC',
        ])->toArray();
    }

    /**
     * Fallback for installations without installation_id metadata.
     */
    private function computeExtensionHealthFallback(int $orgId, array $expectedVersions): array
    {
        $observed = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereNotNull('metadata')
            ->select(
                DB::raw("json_extract(metadata, '$.extension_version') as version"),
                DB::raw('COUNT(*) as event_count'),
                DB::raw('MAX(created_at) as last_seen')
            )
            ->whereNotNull(DB::raw("json_extract(metadata, '$.extension_version')"))
            ->groupBy('version')
            ->orderByDesc('last_seen')
            ->get();

        if ($observed->isEmpty()) {
            return [
                'state' => 'UNKNOWN',
                'expected_versions' => $expectedVersions,
                'observed_versions' => [],
                'installations' => [],
                'installation_summary' => ['total' => 0, 'current' => 0, 'outdated' => 0],
                'authority_note' => 'No installation_id metadata available; using source-level version distribution.',
                'message' => 'No extension version metadata found in telemetry.',
                'remediation' => $this->buildRemediation('extension', 'UNKNOWN'),
            ];
        }

        $versions = $observed->map(fn ($r) => [
            'version' => $r->version,
            'event_count' => $r->event_count,
            'last_seen' => $r->last_seen ? \Carbon\Carbon::parse($r->last_seen)->toISOString() : null,
            'last_seen_timezone' => 'UTC',
        ])->toArray();

        $versionStrings = array_column($versions, 'version');
        $hasExpected = false;
        foreach ($expectedVersions as $expected) {
            if (in_array($expected, $versionStrings, true)) {
                $hasExpected = true;
                break;
            }
        }
        $isMixed = count($versionStrings) > 1;

        $state = 'OUTDATED';
        if ($hasExpected && !$isMixed) {
            $state = 'UP_TO_DATE';
        } elseif ($hasExpected && $isMixed) {
            $state = 'MIXED';
        }

        return [
            'state' => $state,
            'expected_versions' => $expectedVersions,
            'observed_versions' => $versions,
            'installations' => [],
            'installation_summary' => ['total' => 0, 'current' => 0, 'outdated' => 0],
            'authority_note' => 'No installation_id metadata available; using source-level version distribution (historical, not latest-per-installation).',
            'message' => match ($state) {
                'UP_TO_DATE' => 'All observed extensions are at a current version (' . implode(' or ', $expectedVersions) . ').',
                'MIXED' => 'Multiple extension versions observed. Some installations may need updating.',
                'OUTDATED' => 'No installations are running a current version (' . implode(' or ', $expectedVersions) . ').',
                default => 'Unknown extension state.',
            },
            'remediation' => $this->buildRemediation('extension', $state),
        ];
    }

    /**
     * Cost configuration state.
     *
     * Queries the org-scoped tool_cost_configs table (CR-X Track C2).
     * Reports AVAILABLE when authoritative configs with positive monthly
     * spend exist. Falls back to UNKNOWN when no persisted configs are found.
     */
    private function computeCostState(int $orgId): array
    {
        try {
            $configuredCount = DB::table('tool_cost_configs')
                ->where('organization_id', $orgId)
                ->where('monthly_spend', '>', 0)
                ->count();

            if ($configuredCount > 0) {
                $totalMonthly = DB::table('tool_cost_configs')
                    ->where('organization_id', $orgId)
                    ->where('monthly_spend', '>', 0)
                    ->sum('monthly_spend');

                return [
                    'state' => 'AVAILABLE',
                    'authority' => 'BACKEND_PERSISTED',
                    'reason_code' => null,
                    'message' => "{$configuredCount} configured tool(s) with positive monthly spend (total $" . number_format((float) $totalMonthly, 2) . "/mo).",
                    'configured_count' => $configuredCount,
                    'total_monthly_spend' => (float) $totalMonthly,
                    'remediation' => null,
                ];
            }

            return [
                'state' => 'UNKNOWN',
                'authority' => 'BACKEND_PERSISTED',
                'reason_code' => 'NO_PERSISTED_COST_CONFIGS',
                'message' => 'No persisted tool cost configurations found. Configure tool costs in PBT to enable cost readiness.',
                'configured_count' => 0,
                'total_monthly_spend' => 0,
                'remediation' => $this->buildRemediation('cost', 'UNKNOWN'),
            ];
        } catch (\Throwable $e) {
            // Table may not exist in Local environments where the migration
            // has not been run. Report UNKNOWN with explicit fallback state.
            return [
                'state' => 'UNKNOWN',
                'authority' => 'BACKEND_UNAVAILABLE',
                'reason_code' => 'COST_CONFIG_TABLE_UNAVAILABLE',
                'message' => 'Backend cost config storage unavailable. Local fallback may be active in PBT.',
                'configured_count' => 0,
                'total_monthly_spend' => 0,
                'remediation' => $this->buildRemediation('cost', 'UNKNOWN'),
            ];
        }
    }

    /**
     * Product readiness: factual prerequisites derived from the same telemetry
     * data the PI/PBT engines consume. NOT a second eligibility engine.
     *
     * Single workflow does NOT block PBT — within-workflow longitudinal analysis
     * remains AVAILABLE; cross-workflow comparison is unavailable.
     */
    private function computeProductState(int $orgId): array
    {
        $eventCount = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->count();

        // CR-X Gate B: Use the SHARED canonical population authority — the same
        // membership semantics as /api/telemetry/canonical (event_type='session',
        // segment_type='session', all historical, org-scoped). This eliminates
        // duplicated canonical-population logic and guarantees parity.
        $canonicalService = new CanonicalPopulationService();
        $isLocalLab = config('app.env') === 'local';
        $canonicalOrgId = $isLocalLab ? null : $orgId;
        $population = $canonicalService->getCanonicalPopulation($canonicalOrgId);

        $sessionCount = $population['session_count'];
        $workflowCount = $population['workflow_count'];

        // PI: factual prerequisite — telemetry exists or it doesn't
        $piState = 'UNKNOWN';
        $piReasons = [];
        if ($eventCount === 0) {
            $piState = 'BLOCKED';
            $piReasons[] = 'No telemetry events: PI generation cannot produce findings.';
        } elseif ($eventCount > 0 && $sessionCount > 0) {
            $piState = 'AVAILABLE';
        } else {
            $piState = 'UNKNOWN';
            $piReasons[] = 'Telemetry exists but session data is incomplete.';
        }

        // PBT: factual prerequisite — at least one workflow with longitudinal data
        $pbtState = 'UNKNOWN';
        $pbtReasons = [];
        $comparisonAvailable = $workflowCount >= 2;

        if ($eventCount === 0) {
            $pbtState = 'BLOCKED';
            $pbtReasons[] = 'No telemetry events: PBT cannot produce workflow trends.';
        } elseif ($workflowCount >= 1 && $sessionCount > 0) {
            $pbtState = 'AVAILABLE';
            if (!$comparisonAvailable) {
                $pbtReasons[] = 'Single workflow: within-workflow longitudinal analysis available; cross-workflow comparison unavailable.';
            }
        } else {
            $pbtState = 'UNKNOWN';
            $pbtReasons[] = 'Telemetry exists but workflow/session data is incomplete.';
        }

        return [
            'pi' => [
                'state' => $piState,
                'observable_sessions' => $sessionCount,
                'observable_workflows' => $workflowCount,
                'reasons' => $piReasons,
                'remediation' => $this->buildRemediation('product_pi', $piState),
            ],
            'pbt' => [
                'state' => $pbtState,
                'observable_sessions' => $sessionCount,
                'observable_workflows' => $workflowCount,
                'comparison_available' => $comparisonAvailable,
                'reasons' => $pbtReasons,
                'remediation' => $this->buildRemediation('product_pbt', $pbtState),
            ],
            // P0-F: Decision intelligence state — developer×workflow×metric×cost.
            'decision_intelligence' => $this->computeDecisionIntelligenceState($orgId, $sessionCount, $workflowCount),
        ];
    }

    /**
     * P0-F: Decision intelligence state — developer×workflow×metric×cost.
     *
     * NEVER mark as CLOSED/COMPLETE. The four dimensions are:
     *   1. Developer identity (invite-backed vs legacy/inferred)
     *   2. Workflow (canonical, normalized)
     *   3. Metric (telemetry-derived: duration, active coding, TTFC, etc.)
     *   4. Cost (configured monthly spend — client-side, not billing)
     *
     * State values:
     *   - BLOCKED: no telemetry or no sessions
     *   - PARTIAL: some dimensions have authority, others don't
     *   - AVAILABLE: all four dimensions have authoritative evidence
     */
    private function computeDecisionIntelligenceState(int $orgId, int $sessionCount, int $workflowCount): array
    {
        if ($sessionCount === 0) {
            return [
                'state' => 'BLOCKED',
                'dimensions' => [
                    'developer_identity' => 'UNKNOWN',
                    'workflow' => 'UNKNOWN',
                    'metric' => 'UNKNOWN',
                    'cost' => 'UNKNOWN',
                ],
                'reasons' => ['No sessions: decision intelligence cannot produce developer×workflow×metric×cost analysis.'],
                'authority_note' => 'Decision intelligence is PARTIAL by design — it becomes AVAILABLE only when all four dimensions (developer, workflow, metric, cost) have authoritative evidence. It is never marked CLOSED/COMPLETE.',
                'remediation' => $this->buildRemediation('decision_intelligence', 'BLOCKED'),
            ];
        }

        // Dimension 1: Developer identity — invite-backed coverage
        $inviteBackedSessions = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->where('event_type', 'session')
            ->whereNotNull('session_id')
            ->where('user_id', 'like', 'invite:%')
            ->count();

        $developerState = 'PARTIAL';
        if ($inviteBackedSessions === 0) {
            $developerState = 'BLOCKED';
        } elseif ($inviteBackedSessions >= $sessionCount * 0.5) {
            $developerState = 'AVAILABLE';
        }

        // Dimension 2: Workflow — canonical normalization
        $workflowState = $workflowCount >= 1 ? 'AVAILABLE' : 'BLOCKED';

        // Dimension 3: Metric — telemetry-derived (always available if sessions exist)
        $metricState = 'AVAILABLE';

        // Dimension 4: Cost — check persisted tool_cost_configs (CR-X Gate B)
        try {
            $costConfigCount = DB::table('tool_cost_configs')
                ->where('organization_id', $orgId)
                ->where('monthly_spend', '>', 0)
                ->count();
            $costState = $costConfigCount > 0 ? 'AVAILABLE' : 'UNKNOWN';
            $costReason = $costConfigCount > 0
                ? "{$costConfigCount} persisted tool cost config(s) with positive monthly spend."
                : 'No persisted tool cost configurations found.';
        } catch (\Throwable $e) {
            $costState = 'UNKNOWN';
            $costReason = 'Backend cost config storage unavailable.';
        }

        // Overall state: PARTIAL unless all four dimensions are AVAILABLE
        $dimensions = [
            'developer_identity' => $developerState,
            'workflow' => $workflowState,
            'metric' => $metricState,
            'cost' => $costState,
        ];

        $reasons = [];
        if ($developerState === 'BLOCKED') {
            $reasons[] = 'No invite-backed developer identity: efficiency frontier cannot attribute to authoritative developers.';
        } elseif ($developerState === 'PARTIAL') {
            $reasons[] = "Partial invite-backed identity: {$inviteBackedSessions}/{$sessionCount} sessions have invite-backed developer identity.";
        }
        if ($costState !== 'AVAILABLE') {
            $reasons[] = $costReason;
        }
        $reasons[] = 'Cost-delivery comparison is FAIL CLOSED: no authoritative workflow-level delivery attribution exists.';

        $overallState = 'PARTIAL';
        $availableCount = count(array_filter($dimensions, fn($s) => $s === 'AVAILABLE'));
        if ($availableCount === 4) {
            $overallState = 'AVAILABLE';
        } elseif ($availableCount === 0) {
            $overallState = 'BLOCKED';
        }

        return [
            'state' => $overallState,
            'dimensions' => $dimensions,
            'invite_backed_sessions' => $inviteBackedSessions,
            'total_sessions' => $sessionCount,
            'reasons' => $reasons,
            'authority_note' => 'Decision intelligence is PARTIAL by design — it becomes AVAILABLE only when all four dimensions (developer, workflow, metric, cost) have authoritative evidence. It is never marked CLOSED/COMPLETE. Cost-delivery comparison is FAIL CLOSED until authoritative workflow-level delivery attribution exists.',
            'remediation' => $overallState !== 'AVAILABLE'
                ? $this->buildRemediation('decision_intelligence', $overallState)
                : null,
        ];
    }

    /**
     * Overall status aggregation.
     */
    private function computeOverallStatus(array $telemetry, array $github, array $auth, array $extension = []): array
    {
        $issues = [];

        if ($telemetry['state'] === 'STALE') {
            $issues[] = 'TELEMETRY_STALE';
        } elseif ($telemetry['state'] === 'NO_DATA') {
            $issues[] = 'TELEMETRY_NO_DATA';
        }

        if ($auth['state'] === 'ALL_EXPIRED') {
            $issues[] = 'AUTH_ALL_EXPIRED';
        }

        if (!empty($extension) && ($extension['state'] ?? '') === 'OUTDATED') {
            $issues[] = 'EXTENSION_OUTDATED';
        }

        $severity = 'GREEN';
        if (in_array('AUTH_ALL_EXPIRED', $issues) || in_array('TELEMETRY_STALE', $issues)) {
            $severity = 'RED';
        } elseif (
            $telemetry['state'] === 'AGING'
            || $auth['state'] === 'EXPIRING_SOON'
            || $github['state'] === 'PARTIAL'
            || in_array('EXTENSION_OUTDATED', $issues)
        ) {
            $severity = 'YELLOW';
        } elseif ($telemetry['state'] === 'NO_DATA') {
            $severity = 'YELLOW';
        }

        return [
            'status' => $severity === 'GREEN' ? 'ok' : ($severity === 'RED' ? 'critical' : 'warning'),
            'severity' => $severity,
            'issues' => $issues,
        ];
    }

    /**
     * Check if a token purpose is eligible for engineering evidence.
     * Mirrors PilotAwareTokenHelper::isEngineeringEvidenceEligible but
     * accepts a raw token_purpose string (for DB-queried tokens).
     */
    private function isEngineeringEvidenceEligibleFromTokenPurpose(string $purpose): bool
    {
        return $purpose === 'engineering_integration';
    }

    /**
     * P0-E: Humanize freshness hours into bounded human-readable copy.
     *
     *   <1 min ago
     *   8 min ago
     *   2h ago
     *   3d ago
     *
     * Replaces raw decimal hours like "0.0048839377777778h ago".
     */
    private function humanizeFreshnessHours(?float $hours): ?string
    {
        if ($hours === null) return null;

        $seconds = $hours * 3600;
        $minutes = (int) floor($seconds / 60);
        $hrs = (int) floor($hours);
        $days = (int) floor($hours / 24);

        if ($minutes < 1) return '<1 min ago';
        if ($minutes < 60) return "{$minutes} min ago";
        if ($hrs < 24) return "{$hrs}h ago";
        if ($days < 30) return "{$days}d ago";

        $months = (int) floor($days / 30);
        if ($months < 12) return "{$months}mo ago";
        return (int) floor($months / 12) . "y ago";
    }

    /**
     * Resolve the organization from the request context.
     * Uses the same PilotAwareTokenHelper resolution as telemetry ingestion.
     */
    private function resolveOrganization(Request $request): ?Organization
    {
        // Try token-based resolution first (supports both hashed and legacy raw tokens)
        $token = $request->bearerToken();
        if ($token) {
            $apiToken = ApiToken::findValidToken($token);
            if ($apiToken) {
                return Organization::find($apiToken->organization_id);
            }
        }

        // Fallback: single-tenant sole org
        $orgCount = Organization::count();
        if ($orgCount === 1) {
            return Organization::first();
        }

        return null;
    }
}
