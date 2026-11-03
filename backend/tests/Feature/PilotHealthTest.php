<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * CR-X Pass 1 (F): Pilot Health endpoint tests.
 *
 * Verifies the read-only /api/pilot/health endpoint provides:
 * - telemetry freshness (NO_DATA / AGING / STALE / HEALTHY)
 * - active sources/workflows
 * - installation population
 * - developer identity coverage
 * - repository attribution coverage
 * - GitHub engineering-evidence eligibility state
 * - auth/credential health
 * - no-data vs stale-data distinction
 * - tenant-agnostic (no customer-specific hardcoding)
 */
class PilotHealthTest extends TestCase
{
    use RefreshDatabase;

    private function createDashboardToken(Organization $org): string
    {
        $user = User::factory()->create(['organization_id' => $org->id]);
        return ApiToken::generateDashboardToken($user->id, $org->id)['raw'];
    }

    private function insertTelemetryEvent(Organization $org, array $overrides = []): void
    {
        TelemetryEvent::create(array_merge([
            'user_id' => 'invite:1',
            'organization_id' => $org->id,
            'session_id' => 'session_' . Str::random(8),
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'event_type' => 'session',
            'count' => 1,
            'timestamp' => now(),
            'metadata' => ['segment_type' => 'session'],
            'payload' => [],
            'batch_hash' => hash('sha256', Str::random(16)),
        ], $overrides));
    }

    public function test_no_data_pilot_returns_no_data_state(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('telemetry.state', 'NO_DATA');
        $response->assertJsonPath('telemetry.event_count', 0);
        $response->assertJsonPath('telemetry.latest_event_at', null);
        $response->assertJsonPath('severity', 'YELLOW');
    }

    public function test_healthy_pilot_returns_fresh_telemetry(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['created_at' => now()->subHours(2)]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('telemetry.state', 'HEALTHY');
        $response->assertJsonPath('telemetry.event_count', 1);
        $response->assertJsonPath('severity', 'GREEN');
    }

    public function test_stale_pilot_returns_stale_state(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Use DB::insert to bypass Eloquent's auto-timestamps
        DB::table('telemetry_events')->insert([
            'user_id' => 'invite:1',
            'organization_id' => $org->id,
            'session_id' => 'session_stale',
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'event_type' => 'file_edit',
            'count' => 1,
            'timestamp' => now()->subHours(100),
            'metadata' => json_encode([]),
            'payload' => json_encode([]),
            'batch_hash' => hash('sha256', 'batch_stale'),
            'created_at' => now()->subHours(100),
            'updated_at' => now()->subHours(100),
        ]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('telemetry.state', 'STALE');
        $response->assertJsonPath('severity', 'RED');
    }

    public function test_active_sources_lists_editor_distribution(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['editor_source' => 'vscode', 'session_id' => 's1']);
        $this->insertTelemetryEvent($org, ['editor_source' => 'vscode', 'session_id' => 's2']);
        $this->insertTelemetryEvent($org, ['editor_source' => 'cursor', 'session_id' => 's3']);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $sources = $response->json('active_sources');
        $this->assertCount(2, $sources);
        $vscode = collect($sources)->firstWhere('editor_source', 'vscode');
        $this->assertEquals(2, $vscode['session_count']);
    }

    public function test_identity_coverage_fails_closed_with_legacy_identities(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // CR-X Pilot Ops 3: presence of any non-invite-backed identity class
        // makes person-level coverage unavailable; invite-backed count is still
        // reported truthfully.
        $this->insertTelemetryEvent($org, ['user_id' => 'invite:1', 'session_id' => 's1', 'event_type' => 'session', 'metadata' => ['segment_type' => 'session']]);
        $this->insertTelemetryEvent($org, ['user_id' => 'invite:2', 'session_id' => 's2', 'event_type' => 'session', 'metadata' => ['segment_type' => 'session']]);
        $this->insertTelemetryEvent($org, ['user_id' => 'legacy_user_99', 'session_id' => 's3', 'event_type' => 'session', 'metadata' => ['segment_type' => 'session']]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('identity_coverage.person_level_identity_coverage', 'UNAVAILABLE');
        $response->assertJsonPath('identity_coverage.total_identities', 3);
        $response->assertJsonPath('identity_coverage.invite_backed', 2);
        $response->assertJsonPath('identity_coverage.total_developers', null);
        $response->assertJsonPath('identity_coverage.legacy_or_unknown', 1);
        $response->assertJsonPath('identity_coverage.invite_backed_coverage_pct', null);
        $this->assertStringNotContainsString('2.6%', $response->json('identity_coverage.message'));
        $this->assertStringContainsString('Person-level coverage is unavailable', $response->json('identity_coverage.message'));
    }

    public function test_identity_coverage_available_for_invite_only_population(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['user_id' => 'invite:1', 'session_id' => 's1', 'event_type' => 'session', 'metadata' => ['segment_type' => 'session']]);
        $this->insertTelemetryEvent($org, ['user_id' => 'invite:2', 'session_id' => 's2', 'event_type' => 'session', 'metadata' => ['segment_type' => 'session']]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('identity_coverage.person_level_identity_coverage', 'AVAILABLE');
        $response->assertJsonPath('identity_coverage.total_identities', 2);
        $response->assertJsonPath('identity_coverage.invite_backed', 2);
        $response->assertJsonPath('identity_coverage.total_developers', 2);
        $this->assertEquals(100.0, $response->json('identity_coverage.invite_backed_coverage_pct'));
    }

    public function test_identity_coverage_unavailable_for_mixed_ed_like_legacy_population(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Reproduce the Ed-like mix: 360 pd-session-*, 9 cm-dev-*, 4 numeric
        // ids, 1 dev-user-*, and 10 invite-backed.
        for ($i = 1; $i <= 10; $i++) {
            $this->insertTelemetryEvent($org, [
                'user_id' => "invite:{$i}",
                'session_id' => "inv_{$i}",
                'event_type' => 'session',
                'metadata' => ['segment_type' => 'session'],
            ]);
        }

        for ($i = 1; $i <= 4; $i++) {
            $this->insertTelemetryEvent($org, [
                'user_id' => (string) (90000 + $i),
                'session_id' => "num_{$i}",
                'event_type' => 'session',
                'metadata' => ['segment_type' => 'session'],
            ]);
        }

        for ($i = 1; $i <= 9; $i++) {
            $this->insertTelemetryEvent($org, [
                'user_id' => "cm-dev-{$i}",
                'session_id' => "cm_{$i}",
                'event_type' => 'session',
                'metadata' => ['segment_type' => 'session'],
            ]);
        }

        for ($i = 1; $i <= 360; $i++) {
            $this->insertTelemetryEvent($org, [
                'user_id' => "pd-session-{$i}",
                'session_id' => "pd_{$i}",
                'event_type' => 'session',
                'metadata' => ['segment_type' => 'session'],
            ]);
        }

        $this->insertTelemetryEvent($org, [
            'user_id' => 'dev-user-vscode',
            'session_id' => 'du_1',
            'event_type' => 'session',
            'metadata' => ['segment_type' => 'session'],
        ]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('identity_coverage.person_level_identity_coverage', 'UNAVAILABLE');
        $response->assertJsonPath('identity_coverage.total_identities', 384);
        $response->assertJsonPath('identity_coverage.invite_backed', 10);
        $response->assertJsonPath('identity_coverage.total_developers', null);
        $response->assertJsonPath('identity_coverage.invite_backed_coverage_pct', null);
        $this->assertStringNotContainsString('10/384', $response->json('identity_coverage.message'));
        $this->assertStringNotContainsString('2.6%', $response->json('identity_coverage.message'));
        $this->assertStringContainsString('10 invite-backed identities observed', $response->json('identity_coverage.message'));
        $this->assertStringNotContainsString('pd-session-*', $response->json('identity_coverage.message'));
        $this->assertStringNotContainsString('cm-dev-*', $response->json('identity_coverage.message'));
        $this->assertStringNotContainsString('numeric-id', $response->json('identity_coverage.message'));
        $this->assertStringContainsString('Person-level coverage is unavailable', $response->json('identity_coverage.message'));
    }

    public function test_identity_coverage_unavailable_for_legacy_session_only_population(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, [
            'user_id' => 'pd-session-abc',
            'session_id' => 's1',
            'event_type' => 'session',
            'metadata' => ['segment_type' => 'session'],
        ]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('identity_coverage.person_level_identity_coverage', 'UNAVAILABLE');
        $response->assertJsonPath('identity_coverage.invite_backed', 0);
        $response->assertJsonPath('identity_coverage.total_identities', 1);
        $response->assertJsonPath('identity_coverage.total_developers', null);
        $response->assertJsonPath('identity_coverage.invite_backed_coverage_pct', null);
    }

    public function test_github_not_connected_when_no_oauth_tokens(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('github_engineering_evidence.state', 'NOT_CONNECTED');
        $response->assertJsonPath('github_engineering_evidence.engineering_evidence_eligible', false);
    }

    public function test_github_login_only_when_identity_only_token(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_test',
            'user_data' => json_encode(['token_purpose' => 'identity_only']),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('github_engineering_evidence.state', 'LOGIN_ONLY');
        $response->assertJsonPath('github_engineering_evidence.engineering_evidence_eligible', false);
    }

    public function test_github_partial_when_missing_token_purpose(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_legacy',
            'user_data' => json_encode(['login' => 'testuser']),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('github_engineering_evidence.state', 'PARTIAL');
        $response->assertJsonPath('github_engineering_evidence.engineering_evidence_eligible', false);
    }

    public function test_github_connected_when_engineering_integration_token(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        DB::table('oauth_tokens')->insert([
            'organization_id' => $org->id,
            'user_id' => 1,
            'access_token' => 'gho_test',
            'user_data' => json_encode(['token_purpose' => 'engineering_integration']),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('github_engineering_evidence.state', 'CONNECTED');
        $response->assertJsonPath('github_engineering_evidence.engineering_evidence_eligible', true);
    }

    public function test_auth_health_detects_expired_tokens(): void
    {
        $org = Organization::factory()->create();

        $user = User::factory()->create(['organization_id' => $org->id]);
        $raw = Str::random(64);
        ApiToken::create([
            'token' => hash('sha256', $raw),
            'user_id' => $user->id,
            'organization_id' => $org->id,
            'invite_id' => null,
            'installation_id' => null,
            'expires_at' => now()->subDays(1),
        ]);

        $response = $this->withToken($raw)->getJson('/api/pilot/health');

        $response->assertStatus(401);
    }

    public function test_auth_health_reports_active_tokens(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('auth_credentials.state', 'HEALTHY');
        $response->assertJsonPath('auth_credentials.active_tokens', 1);
    }

    public function test_auth_health_detects_expiring_within_7d(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Add a token expiring in 3 days (within 7d window)
        $user = User::factory()->create(['organization_id' => $org->id]);
        $raw = Str::random(64);
        ApiToken::create([
            'token' => hash('sha256', $raw),
            'user_id' => $user->id,
            'organization_id' => $org->id,
            'invite_id' => null,
            'installation_id' => null,
            'expires_at' => now()->addDays(3),
        ]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('auth_credentials.state', 'EXPIRING_SOON');
        $response->assertJsonPath('auth_credentials.expiring_within_7d', 1);
        $response->assertJsonPath('auth_credentials.active_tokens', 2);
    }

    public function test_auth_health_detects_expiring_within_24h(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Add a token expiring in 12 hours (within 7d window, also within 24h)
        $user = User::factory()->create(['organization_id' => $org->id]);
        $raw = Str::random(64);
        ApiToken::create([
            'token' => hash('sha256', $raw),
            'user_id' => $user->id,
            'organization_id' => $org->id,
            'invite_id' => null,
            'installation_id' => null,
            'expires_at' => now()->addHours(12),
        ]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('auth_credentials.state', 'EXPIRING_SOON');
        $response->assertJsonPath('auth_credentials.expiring_within_7d', 1);
    }

    public function test_auth_health_healthy_when_expires_beyond_7d(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // The dashboard token from createDashboardToken has a long expiry (months)
        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('auth_credentials.state', 'HEALTHY');
        $response->assertJsonPath('auth_credentials.expiring_within_7d', 0);
    }

    public function test_auth_health_revoked_token_not_counted_as_expiring(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Add a revoked token that would have expired within 7d
        $user = User::factory()->create(['organization_id' => $org->id]);
        $raw = Str::random(64);
        ApiToken::create([
            'token' => hash('sha256', $raw),
            'user_id' => $user->id,
            'organization_id' => $org->id,
            'invite_id' => null,
            'installation_id' => null,
            'expires_at' => now()->addDays(3),
            'revoked_at' => now(),
        ]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        // Revoked token with near expiry should NOT trigger EXPIRING_SOON
        // (it's already revoked, not "expiring soon")
        $response->assertJsonPath('auth_credentials.expiring_within_7d', 0);
    }

    public function test_org_isolation_prevents_cross_tenant_visibility(): void
    {
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $tokenA = $this->createDashboardToken($orgA);
        $tokenB = $this->createDashboardToken($orgB);

        $this->insertTelemetryEvent($orgA);

        $responseA = $this->withToken($tokenA)->getJson('/api/pilot/health');
        $responseB = $this->withToken($tokenB)->getJson('/api/pilot/health');

        $responseA->assertJsonPath('telemetry.state', 'HEALTHY');
        $responseA->assertJsonPath('telemetry.event_count', 1);
        $responseB->assertJsonPath('telemetry.state', 'NO_DATA');
        $responseB->assertJsonPath('telemetry.event_count', 0);
    }

    public function test_repository_attribution_coverage(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // CR-X Phase 3: Correct field name is git_repo_url (not git_repo)
        $this->insertTelemetryEvent($org, [
            'metadata' => ['git_repo_url' => 'https://github.com/org/repo-a.git'],
            'session_id' => 's1',
        ]);
        $this->insertTelemetryEvent($org, [
            'metadata' => ['git_repo_url' => 'https://github.com/org/repo-a.git'],
            'session_id' => 's2',
        ]);
        $this->insertTelemetryEvent($org, [
            'metadata' => [],
            'session_id' => 's3',
        ]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('repository_attribution.events_with_repo', 2);
        $response->assertJsonPath('repository_attribution.total_events', 3);
        $response->assertJsonPath('repository_attribution.distinct_repos', 1);
    }

    // ── EXTENSION dimension ──────────────────────────────────────────

    public function test_extension_unknown_when_no_version_metadata(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['metadata' => []]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('extension.state', 'UNKNOWN');
        $response->assertJsonPath('extension.expected_versions.0', '0.4.1');
        $response->assertJsonPath('extension.observed_versions', []);
    }

    public function test_extension_up_to_date_when_matching_expected(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['metadata' => ['extension_version' => '0.4.1']]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('extension.state', 'UP_TO_DATE');
        $response->assertJsonPath('extension.expected_versions.0', '0.4.1');
    }

    public function test_extension_outdated_when_no_match(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['metadata' => ['extension_version' => '0.3.1']]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('extension.state', 'OUTDATED');
    }

    public function test_extension_mixed_when_multiple_versions(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['metadata' => ['extension_version' => '0.4.1'], 'session_id' => 's1']);
        $this->insertTelemetryEvent($org, ['metadata' => ['extension_version' => '0.3.1'], 'session_id' => 's2']);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('extension.state', 'MIXED');
    }

    // ── Claude Code bridge version recognition ─────────────────────

    public function test_extension_up_to_date_for_cc_bridge(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['metadata' => ['extension_version' => '0.4.1-cc-bridge']]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('extension.state', 'UP_TO_DATE');
        $response->assertJsonPath('extension.expected_versions.1', '0.4.1-cc-bridge');
    }

    // ── PILOT OPS 14-C: Installation authority parity ────────────────

    public function test_installations_telemetry_count_uses_metadata_installation_id_authority(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Three distinct installation_ids in event metadata, each current.
        // The top-level installation_id column is intentionally left NULL to
        // prove the Installations card no longer undercounts via the column.
        $this->insertTelemetryEvent($org, ['metadata' => ['extension_version' => '0.4.1', 'installation_id' => 'install-A']]);
        $this->insertTelemetryEvent($org, ['metadata' => ['extension_version' => '0.4.1', 'installation_id' => 'install-B']]);
        $this->insertTelemetryEvent($org, ['metadata' => ['extension_version' => '0.4.1', 'installation_id' => 'install-C']]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        // Installations card Telemetry count must use the same metadata
        // installation_id authority as the Extension Versions card.
        $response->assertJsonPath('installations.telemetry_installations', 3);
        $response->assertJsonPath('extension.installation_summary.total', 3);
        $response->assertJsonPath('extension.installation_summary.current', 3);
        $response->assertJsonPath('installations.authority_note', fn ($v) => $v !== null && $v !== '');
    }

    public function test_installations_telemetry_count_ignores_null_metadata_installation_id(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // One real installation_id in metadata; two events without it.
        $this->insertTelemetryEvent($org, ['metadata' => ['extension_version' => '0.4.1', 'installation_id' => 'install-A']]);
        $this->insertTelemetryEvent($org, ['metadata' => ['extension_version' => '0.4.1']]);
        $this->insertTelemetryEvent($org, ['metadata' => ['segment_type' => 'session']]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('installations.telemetry_installations', 1);
    }

    // ── COST dimension ───────────────────────────────────────────────

    public function test_cost_returns_unknown_client_local(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('cost.state', 'UNKNOWN');
        $response->assertJsonPath('cost.authority', 'BACKEND_PERSISTED');
        $response->assertJsonPath('cost.reason_code', 'NO_PERSISTED_COST_CONFIGS');
    }

    // ── PRODUCT dimension ────────────────────────────────────────────

    public function test_product_blocked_when_no_telemetry(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('product.pi.state', 'BLOCKED');
        $response->assertJsonPath('product.pbt.state', 'BLOCKED');
    }

    public function test_product_available_with_single_workflow(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['editor_source' => 'vscode', 'session_id' => 's1']);
        $this->insertTelemetryEvent($org, ['editor_source' => 'vscode', 'session_id' => 's2']);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('product.pi.state', 'AVAILABLE');
        $response->assertJsonPath('product.pbt.state', 'AVAILABLE');
        $response->assertJsonPath('product.pbt.comparison_available', false);
        $response->assertJsonPath('product.pbt.observable_workflows', 1);
    }

    public function test_product_available_with_comparison_when_multiple_workflows(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['editor_source' => 'vscode', 'session_id' => 's1']);
        $this->insertTelemetryEvent($org, ['editor_source' => 'cursor', 'session_id' => 's2']);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('product.pbt.state', 'AVAILABLE');
        $response->assertJsonPath('product.pbt.comparison_available', true);
        $response->assertJsonPath('product.pbt.observable_workflows', 2);
    }

    // ── CR-X Day 1B S2: Remediation contract tests ────────────────────────────

    public function test_no_data_telemetry_has_remediation(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('telemetry.remediation.action', 'Install the extension and complete invite-backed IDE enrollment for at least one developer.');
        $response->assertJsonPath('telemetry.remediation.url', '/settings?tab=team');
        $response->assertJsonPath('telemetry.remediation.runbook_ref', 'CANONICAL##14,CANONICAL##15');
    }

    public function test_healthy_telemetry_has_null_remediation(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['created_at' => now()->subHours(2)]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('telemetry.state', 'HEALTHY');
        $response->assertJsonMissingPath('telemetry.remediation.action');
    }

    public function test_stale_telemetry_has_remediation(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        DB::table('telemetry_events')->insert([
            'user_id' => 'invite:1',
            'organization_id' => $org->id,
            'session_id' => 'session_stale',
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'event_type' => 'file_edit',
            'count' => 1,
            'timestamp' => now()->subHours(100),
            'metadata' => json_encode([]),
            'payload' => json_encode([]),
            'batch_hash' => hash('sha256', 'batch_stale2'),
            'created_at' => now()->subHours(100),
            'updated_at' => now()->subHours(100),
        ]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('telemetry.state', 'STALE');
        $response->assertJsonPath('telemetry.remediation.action', 'Urgent: verify the extension is installed and running. Renew or re-enroll the installation.');
    }

    public function test_github_not_connected_has_remediation(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('github_engineering_evidence.state', 'NOT_CONNECTED');
        $response->assertJsonPath('github_engineering_evidence.remediation.url', '/settings?tab=integrations');
    }

    public function test_identity_coverage_unavailable_with_low_invite_backed_has_no_remediation(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // 1 invite-backed, 2 legacy — person-level coverage is unavailable; no
        // percentage or remediation is rendered because the denominator is not
        // authoritative.
        $this->insertTelemetryEvent($org, ['user_id' => 'invite:1', 'session_id' => 's1', 'event_type' => 'session', 'metadata' => ['segment_type' => 'session']]);
        $this->insertTelemetryEvent($org, ['user_id' => 'legacy_a', 'session_id' => 's2', 'event_type' => 'session', 'metadata' => ['segment_type' => 'session']]);
        $this->insertTelemetryEvent($org, ['user_id' => 'legacy_b', 'session_id' => 's3', 'event_type' => 'session', 'metadata' => ['segment_type' => 'session']]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('identity_coverage.person_level_identity_coverage', 'UNAVAILABLE');
        $response->assertJsonPath('identity_coverage.invite_backed', 1);
        $response->assertJsonPath('identity_coverage.invite_backed_coverage_pct', null);
        $response->assertJsonMissingPath('identity_coverage.remediation.action');
    }

    public function test_identity_coverage_unavailable_with_good_invite_backed_has_no_remediation(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // 2 invite-backed, 1 legacy — still unavailable because of the legacy
        // presence, and no remediation is rendered.
        $this->insertTelemetryEvent($org, ['user_id' => 'invite:1', 'session_id' => 's1', 'event_type' => 'session', 'metadata' => ['segment_type' => 'session']]);
        $this->insertTelemetryEvent($org, ['user_id' => 'invite:2', 'session_id' => 's2', 'event_type' => 'session', 'metadata' => ['segment_type' => 'session']]);
        $this->insertTelemetryEvent($org, ['user_id' => 'legacy_a', 'session_id' => 's3', 'event_type' => 'session', 'metadata' => ['segment_type' => 'session']]);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('identity_coverage.person_level_identity_coverage', 'UNAVAILABLE');
        $response->assertJsonPath('identity_coverage.invite_backed', 2);
        $response->assertJsonPath('identity_coverage.invite_backed_coverage_pct', null);
        $response->assertJsonMissingPath('identity_coverage.remediation.action');
    }

    public function test_cost_unknown_has_remediation(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('cost.state', 'UNKNOWN');
        // CR-X Day 1B S2: cost remediation url is null — PUT /api/org/spend/config
        // is a mutation endpoint, not a browser-navigable GET URL.
        $response->assertJsonPath('cost.remediation.url', null);
    }

    public function test_product_blocked_has_remediation(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('product.pi.state', 'BLOCKED');
        $response->assertJsonPath('product.pi.remediation.url', '/settings?tab=team');
        $response->assertJsonPath('product.pbt.state', 'BLOCKED');
        $response->assertJsonPath('product.pbt.remediation.url', '/settings?tab=team');
    }

    public function test_decision_intelligence_blocked_has_remediation(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('product.decision_intelligence.state', 'BLOCKED');
        $response->assertJsonPath('product.decision_intelligence.remediation.action', 'Enroll developers and send canonical sessions to enable decision intelligence.');
    }

    public function test_remediation_urls_are_implemented_not_invented(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/pilot/health');
        $data = $response->json();

        // Collect all remediation urls across all dimensions
        $allUrls = [];
        $dimensions = ['telemetry', 'extension', 'identity_coverage', 'repository_attribution',
                       'github_engineering_evidence', 'auth_credentials', 'cost'];
        foreach ($dimensions as $dim) {
            if (isset($data[$dim]['remediation']['url']) && $data[$dim]['remediation']['url'] !== null) {
                $allUrls[] = $data[$dim]['remediation']['url'];
            }
        }
        if (isset($data['product']['pi']['remediation']['url'])) {
            $allUrls[] = $data['product']['pi']['remediation']['url'];
        }
        if (isset($data['product']['pbt']['remediation']['url'])) {
            $allUrls[] = $data['product']['pbt']['remediation']['url'];
        }
        if (isset($data['product']['decision_intelligence']['remediation']['url'])) {
            $allUrls[] = $data['product']['decision_intelligence']['remediation']['url'];
        }

        // Every url must be a browser-navigable GET URL (page or download)
        // Mutation endpoints (PUT/POST) must have url: null
        $validPrefixes = ['/settings', '/api/extension/download', '/api/telemetry/canonical'];
        foreach ($allUrls as $url) {
            $valid = false;
            foreach ($validPrefixes as $prefix) {
                if (str_starts_with($url, $prefix)) {
                    $valid = true;
                    break;
                }
            }
            $this->assertTrue($valid, "Remediation url '{$url}' is not a valid browser-navigable GET URL");
        }

        // Verify cost remediation has url: null (PUT endpoint, not navigable)
        $this->assertArrayHasKey('url', $data['cost']['remediation']);
        $this->assertNull($data['cost']['remediation']['url'],
            'Cost remediation url must be null — PUT /api/org/spend/config is not browser-navigable');
    }

    // ====================================================================
    // CR-X Day 2 X3: Pilot Health failure-state expansion
    //   - connect_code_expiry: expired/expiring unredeemed connect codes
    //   - installation_failures: install_failure telemetry events
    // Both dimensions must be present in the health response and fail
    // closed (HEALTHY) when no failure evidence exists.
    // ====================================================================

    public function test_connect_code_expiry_present_in_health_response(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('connect_code_expiry.state', 'HEALTHY');
        $response->assertJsonPath('connect_code_expiry.expired_unredeemed', 0);
        $response->assertJsonPath('connect_code_expiry.expiring_within_7d', 0);
    }

    public function test_connect_code_expiry_detects_expired_unredeemed(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Insert an expired unredeemed enrollment invite (code-backed).
        // PILOT OPS 18H: connect_code_expiry scopes to developer enrollments;
        // a code-less invite is a dashboard invite and is not counted.
        $inviteId = DB::table('invites')->insertGetId([
            'organization_id' => $org->id,
            'token' => 'expired-token-' . Str::random(8),
            'email' => 'dev@example.com',
            'expires_at' => now()->subDays(5),
            'redeemed_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('ide_connect_codes')->insert([
            'code' => 'EXPIRED-' . Str::random(8),
            'user_id' => User::where('organization_id', $org->id)->first()->id,
            'organization_id' => $org->id,
            'invite_id' => $inviteId,
            'expires_at' => now()->subDays(5),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('connect_code_expiry.state', 'EXPIRED_UNREDEEMED');
        $response->assertJsonPath('connect_code_expiry.expired_unredeemed', 1);
        $response->assertJsonPath('connect_code_expiry.remediation.action', 'Issue new connect codes for unredeemed expired invites. The developer cannot enroll with an expired code.');
    }

    public function test_connect_code_expiry_detects_expiring_soon(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Insert an enrollment invite (code-backed) expiring within 7 days
        $inviteId = DB::table('invites')->insertGetId([
            'organization_id' => $org->id,
            'token' => 'expiring-token-' . Str::random(8),
            'email' => 'dev@example.com',
            'expires_at' => now()->addDays(3),
            'redeemed_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('ide_connect_codes')->insert([
            'code' => 'EXPIRING-' . Str::random(8),
            'user_id' => User::where('organization_id', $org->id)->first()->id,
            'organization_id' => $org->id,
            'invite_id' => $inviteId,
            'expires_at' => now()->addDays(3),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('connect_code_expiry.state', 'EXPIRING_SOON');
        $response->assertJsonPath('connect_code_expiry.expiring_within_7d', 1);
    }

    public function test_connect_code_expiry_healthy_when_redeemed(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Insert a redeemed invite (even if expired, it was redeemed)
        DB::table('invites')->insert([
            'organization_id' => $org->id,
            'token' => 'redeemed-token-' . Str::random(8),
            'email' => 'dev@example.com',
            'expires_at' => now()->subDays(5),
            'redeemed_at' => now()->subDays(10),
            'created_at' => now()->subDays(15),
            'updated_at' => now(),
        ]);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('connect_code_expiry.state', 'HEALTHY');
        $response->assertJsonPath('connect_code_expiry.expired_unredeemed', 0);
    }

    public function test_installation_failures_present_in_health_response(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('installation_failures.state', 'HEALTHY');
        $response->assertJsonPath('installation_failures.failure_count', 0);
    }

    public function test_installation_failures_detects_failures(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Insert an install_failure telemetry event
        DB::table('telemetry_events')->insert([
            'user_id' => 'invite:1',
            'organization_id' => $org->id,
            'session_id' => null,
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'event_type' => 'install_failure',
            'count' => 1,
            'timestamp' => now()->subHour(),
            'metadata' => json_encode(['failure_reason' => 'validation_failed']),
            'payload' => json_encode([]),
            'batch_hash' => Str::random(40),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('installation_failures.state', 'FAILURES_DETECTED');
        $response->assertJsonPath('installation_failures.failure_count', 1);
        $response->assertJsonPath('installation_failures.remediation.action', 'Review installation failure details with the affected developer. Reinstall the extension or Claude Code bridge from the latest artifact.');
    }

    public function test_failure_state_sections_label_present(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $sections = $response->json('sections');
        $this->assertArrayHasKey('failure_state_health', $sections,
            'sections must include failure_state_health label for X3 dimensions');
    }

    // ── Cohort readiness (Pilot Ops Nov 2026) ────────────────────────────

    public function test_cohort_readiness_none_without_canonical_identities(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('cohort_readiness.telemetry_recency', 'NONE');
        $response->assertJsonPath('cohort_readiness.identities_all_time', 0);
        $response->assertJsonPath('cohort_readiness.identities_active_7d', 0);
    }

    public function test_cohort_readiness_active_recent_with_7d_identity(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['user_id' => 'invite:9', 'timestamp' => now()->subDays(2)]);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('cohort_readiness.telemetry_recency', 'ACTIVE_RECENT');
        $response->assertJsonPath('cohort_readiness.identities_active_7d', 1);
        $response->assertJsonPath('cohort_readiness.identities_all_time', 1);
    }

    public function test_cohort_readiness_historical_only_not_telemetry_ready(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Canonical history exists, but the only identity is 20 days stale —
        // historical sessions must NOT read as current telemetry coverage.
        $this->insertTelemetryEvent($org, ['user_id' => 'invite:4', 'timestamp' => now()->subDays(20)]);
        $this->insertTelemetryEvent($org, ['user_id' => 'invite:4', 'timestamp' => now()->subDays(15)]);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('cohort_readiness.telemetry_recency', 'HISTORICAL_ONLY');
        $response->assertJsonPath('cohort_readiness.identities_active_7d', 0);
        $response->assertJsonPath('cohort_readiness.identities_active_30d', 1);
        $response->assertJsonPath('cohort_readiness.identities_all_time', 1);
    }

    public function test_cohort_readiness_reports_invite_funnel_and_delivery_rows(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->insertTelemetryEvent($org, ['user_id' => 'invite:2']);

        DB::table('invites')->insert([
            'organization_id' => $org->id,
            'token' => Str::random(24),
            'email' => 'dev@example.com',
            'expires_at' => now()->addDays(7),
            'redeemed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/pilot/health');

        $response->assertStatus(200);
        $response->assertJsonPath('cohort_readiness.invites_issued', 1);
        $response->assertJsonPath('cohort_readiness.invites_redeemed', 1);
        $response->assertJsonPath('cohort_readiness.delivery_evidence.pull_requests', 0);
        $response->assertJsonPath('cohort_readiness.delivery_evidence.deployments', 0);
        $response->assertJsonPath('cohort_readiness.delivery_evidence.releases', 0);
    }
}
