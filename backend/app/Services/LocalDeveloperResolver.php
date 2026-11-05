<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Local Developer Identity Resolver
 *
 * Resolves the logical `local-developer` identity into the full verified set of
 * Matt's genuine Local telemetry raw user_ids. This is a READ-ONLY resolver —
 * it never modifies telemetry rows, never reattributes events, and never
 * touches the database schema.
 *
 * Resolution rules (see config/local_developer.php):
 *  1. Static verified identities (local-developer, 4, 41001234)
 *  2. Dynamic: any invite:<id> whose Invite email matches Matt's verified email
 *  3. EXCLUDES any user_id that has simulated=true telemetry
 *  4. EXCLUDES the six sample persona IDs (90001-90006)
 *
 * No broad "all non-simulated" heuristic. No org-only inference.
 */
class LocalDeveloperResolver
{
    /**
     * The logical developer ID (e.g. 'local-developer').
     */
    private string $logicalId;

    /**
     * Verified static raw user_ids.
     *
     * @var array<string>
     */
    private array $staticIdentities;

    /**
     * Matt's verified email for dynamic invite resolution.
     */
    private string $mattEmail;

    /**
     * Sample persona IDs that are always excluded.
     *
     * @var array<string>
     */
    private array $samplePersonaIds;

    /**
     * Whether the Matt-specific alias expansion is enabled.
     *
     * The alias path is LOCAL DEMO ONLY. It may execute only when
     * APP_ENV=local, or when explicitly enabled for tests via
     * config('local_developer.enabled_for_testing', true). In any other
     * environment (staging, production, customer), the resolver is a no-op
     * and `local-developer` is treated as a literal user_id — no Matt
     * identity expansion occurs.
     */
    private bool $aliasEnabled;

    public function __construct()
    {
        $this->logicalId = config('local_developer.logical_id', 'local-developer');
        $this->staticIdentities = config('local_developer.static_identities', []);
        $this->mattEmail = config('local_developer.matt_email', '');
        $this->samplePersonaIds = config('local_developer.sample_persona_ids', []);

        // Gate: alias expansion is Local-only.
        // - APP_ENV=local → enabled (Local Lab development)
        // - APP_ENV=testing → enabled only if config flag is true (default true
        //   so the resolver unit/integration tests can exercise the alias path)
        // - Any other APP_ENV (staging, production, customer) → DISABLED
        $env = config('app.env');
        $this->aliasEnabled = ($env === 'local')
            || ($env === 'testing' && config('local_developer.enabled_for_testing', true));
    }

    /**
     * Check whether a given user_id value is the logical local-developer ID.
     */
    public function isLocalDeveloper(string $userId): bool
    {
        return $userId === $this->logicalId;
    }

    /**
     * Whether the Matt-specific alias expansion is enabled in the current
     * environment. Returns false in staging/production/customer environments.
     */
    public function isAliasEnabled(): bool
    {
        return $this->aliasEnabled;
    }

    /**
     * Resolve the logical local-developer ID into its full set of verified
     * raw user_ids.
     *
     * Returns the union of:
     *  - static verified identities
     *  - invite:<id> values whose Invite email matches Matt's verified email
     *
     * Excludes:
     *  - sample persona IDs (90001-90006)
     *  - any user_id that has simulated=true telemetry
     *
     * @return array<string>  List of raw user_id values (may include the
     *                        logical ID itself if it exists as a literal row).
     */
    public function resolveRawIdentities(): array
    {
        // Start with static verified identities
        $identities = $this->staticIdentities;

        // Dynamic: find invite:<id> values matching Matt's email
        $mattInviteIds = DB::table('invites')
            ->where('email', $this->mattEmail)
            ->pluck('id')
            ->toArray();

        foreach ($mattInviteIds as $inviteId) {
            $identities[] = "invite:{$inviteId}";
        }

        // Deduplicate
        $identities = array_values(array_unique($identities));

        // Exclude sample persona IDs (defense in depth — they should never
        // appear in the static list, but this guarantees correctness)
        $identities = array_values(array_diff($identities, $this->samplePersonaIds));

        // Exclude any identity that has simulated=true telemetry.
        // This is a hard guarantee: no synthetic row may resolve to Matt.
        if (!empty($identities)) {
            $simulatedIds = DB::table('telemetry_events')
                ->select('user_id')
                ->distinct()
                ->whereRaw("json_extract(metadata, '$.simulated') = 1")
                ->whereIn('user_id', $identities)
                ->pluck('user_id')
                ->toArray();

            $simulatedIds = array_map('strval', $simulatedIds);
            $identities = array_values(array_diff($identities, $simulatedIds));
        }

        // Declared LOCAL demo continuity overlays (e.g. local-demo-matt-overlay).
        // These raw identities carry EXPLICITLY synthetic overlay telemetry for
        // Matt, so they are appended AFTER the simulated-telemetry exclusion —
        // they are declared fixture authority, not inferred identity. The
        // exclusion guarantee for every other identity is unchanged.
        if ($this->aliasEnabled) {
            $overlays = config('local_developer.demo_overlay_identities', []);
            $identities = array_values(array_unique(array_merge(
                $identities,
                array_map('strval', $overlays)
            )));
        }

        return $identities;
    }

    /**
     * Resolve invite-backed cohort member IDs into raw telemetry user_ids.
     *
     * Production/customer behavior remains strictly invite-backed: each member
     * resolves only to invite:{id}. In Local Lab only, explicit fixture mapping
     * may additionally resolve a verified Matt invite to the existing
     * local-developer identity set, or a demo persona invite to its proven
     * simulated 900xx identity. No telemetry row is rewritten or inferred.
     *
     * @param  array<int>  $inviteIds
     * @return array<string>
     */
    public function resolveCohortUserIds(array $inviteIds): array
    {
        $inviteIds = array_values(array_unique(array_map('intval', $inviteIds)));
        $fallbackIds = array_map(fn ($inviteId) => "invite:{$inviteId}", $inviteIds);

        if (!$this->aliasEnabled || empty($inviteIds)) {
            return $fallbackIds;
        }

        $personaByEmail = array_change_key_case(
            config('local_developer.local_demo_persona_invites', []),
            CASE_LOWER
        );
        $invitesById = DB::table('invites')
            ->whereIn('id', $inviteIds)
            ->get(['id', 'email'])
            ->keyBy('id');
        $resolved = [];

        foreach ($inviteIds as $inviteId) {
            $inviteIdKey = "invite:{$inviteId}";
            $resolved[] = $inviteIdKey;

            $invite = $invitesById->get($inviteId);
            $email = strtolower((string) ($invite->email ?? ''));
            if ($email === '') {
                continue;
            }

            if ($email === strtolower($this->mattEmail)) {
                foreach ($this->resolveRawIdentities() as $rawId) {
                    $resolved[] = (string) $rawId;
                }
                continue;
            }

            $personaId = isset($personaByEmail[$email])
                ? (string) $personaByEmail[$email]
                : null;
            if (!$personaId || !in_array($personaId, $this->samplePersonaIds, true)) {
                continue;
            }

            $hasSimulatedTelemetry = DB::table('telemetry_events')
                ->where('user_id', $personaId)
                ->whereRaw("json_extract(metadata, '$.simulated') = 1")
                ->exists();
            if ($hasSimulatedTelemetry) {
                $resolved[] = $personaId;
            }
        }

        return array_values(array_unique($resolved));
    }

    /**
     * Apply the resolved identity set as a whereIn filter on a query builder.
     *
     * If the given userId IS the logical local-developer ID, the query is
     * filtered to all resolved raw identities. Otherwise the query is filtered
     * to the literal userId (preserving existing behavior for all other
     * developers, including the six sample personas).
     *
     * @param  mixed  $query  Eloquent Builder or DB query builder
     * @param  string|null  $userId  The user_id filter value from the request
     * @return void  The query is modified in place.
     */
    public function resolveAuthoritativeIdentityMap(?int $organizationId): array
    {
        $candidates = [];

        if ($this->aliasEnabled) {
            $candidates[$this->logicalId] = $this->resolveRawIdentities();

            foreach ($this->samplePersonaIds as $personaId) {
                $personaId = (string) $personaId;
                $query = DB::table('telemetry_events')
                    ->where('user_id', $personaId)
                    ->whereRaw("json_extract(metadata, '$.simulated') = 1");
                if ($query->exists()) {
                    $candidates[$personaId] = [$personaId];
                }
            }
        }

        if ($organizationId && config('app.env') !== 'local') {
            $inviteIds = DB::table('invites')
                ->where('organization_id', $organizationId)
                ->pluck('id');
            foreach ($inviteIds as $inviteId) {
                $rawId = "invite:{$inviteId}";
                $candidates[$rawId] = [$rawId];
            }
        }

        $map = [];
        $ambiguous = [];
        foreach ($candidates as $logicalId => $rawIds) {
            foreach (array_unique(array_map('strval', $rawIds)) as $rawId) {
                if (isset($map[$rawId]) && $map[$rawId] !== (string) $logicalId) {
                    $ambiguous[$rawId] = true;
                    continue;
                }
                $map[$rawId] = (string) $logicalId;
            }
        }
        foreach (array_keys($ambiguous) as $rawId) {
            unset($map[$rawId]);
        }

        return $map;
    }

    public function applyUserFilter($query, ?string $userId): void
    {
        if (!$userId) {
            return;
        }

        // RELEASE BOUNDARY: The Matt-specific alias expansion is LOCAL DEMO
        // ONLY. In staging/production/customer environments, the alias is
        // disabled and `local-developer` is treated as a literal user_id
        // (which will match zero rows on a real customer DB — the correct,
        // fail-closed behavior). This guarantees Matt's identity resolution
        // can never leak into a pilot/customer environment.
        if ($this->isLocalDeveloper($userId) && $this->aliasEnabled) {
            $rawIds = $this->resolveRawIdentities();
            if (!empty($rawIds)) {
                $query->whereIn('user_id', $rawIds);
            } else {
                // No verified identities — return empty result set
                $query->whereRaw('1 = 0');
            }
        } else {
            // Non-local-developer OR alias disabled: literal filter (existing
            // behavior). In non-Local environments, `local-developer` falls
            // through here and matches only literal rows (none on a real DB).
            $query->where('user_id', $userId);
        }
    }
}
