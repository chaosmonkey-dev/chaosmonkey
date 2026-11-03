<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use App\Services\LocalDeveloperResolver;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Local Developer Identity Resolution — regression coverage for the
 * LocalDeveloperResolver that expands the logical `local-developer` ID into
 * Matt's full verified set of genuine Local telemetry identities.
 *
 * Guarantees:
 *  1. Sample personas (90001-90006) remain independent
 *  2. simulated=true telemetry never enters Matt
 *  3. Old verified Matt identities resolve to local-developer
 *  4. Later historical Matt identity (18269556) resolves to local-developer
 *  5. Current invite/installation-backed Matt identity resolves to local-developer
 *  6. Unknown real identity does not automatically become Matt
 *  7. user_id=90001 returns Jordan only (not Matt)
 *  8. user_id=local-developer returns the union without duplication
 *  9. All Developers population is unchanged by the source-code fix
 *
 * All fixtures are ephemeral (:memory: SQLite). No DB writes to any real DB.
 */
class LocalDeveloperIdentityResolutionTest extends TestCase
{
    private string $dashboardToken;
    private int $organizationId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->assertTrue(
            app()->environment('testing'),
            'Refusing to run: APP_ENV is not testing'
        );
        $this->assertEquals('sqlite', config('database.default'),
            'Refusing to run: database driver is not sqlite'
        );
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'),
            'Refusing to run: SQLite database is not :memory:'
        );

        // Ensure required tables exist (ephemeral)
        if (!Schema::hasTable('organizations')) {
            Schema::create('organizations', function ($table) {
                $table->id();
                $table->string('name');
                $table->string('slug')->unique();
                $table->timestamps();
            });
        }
        if (!Schema::hasTable('users')) {
            Schema::create('users', function ($table) {
                $table->id();
                $table->string('name')->nullable();
                $table->string('email')->unique();
                $table->string('password')->nullable();
                $table->string('github_id')->nullable();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->string('role')->default('member');
                $table->timestamps();
            });
        }
        if (!Schema::hasTable('invites')) {
            Schema::create('invites', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained();
                $table->string('token');
                $table->string('email')->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('redeemed_at')->nullable();
                $table->unsignedBigInteger('redeemed_by_user_id')->nullable();
                $table->string('role')->default('member');
                $table->timestamps();
            });
        }
        if (!Schema::hasTable('api_tokens')) {
            Schema::create('api_tokens', function ($table) {
                $table->id();
                $table->string('token', 64)->unique();
                $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->unsignedBigInteger('invite_id')->nullable();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('revoked_at')->nullable();
                $table->timestamps();
                $table->index('token');
                $table->index('user_id');
            });
        }
        if (!Schema::hasTable('telemetry_events')) {
            Schema::create('telemetry_events', function ($table) {
                $table->id();
                $table->string('user_id')->nullable();
                $table->foreignId('organization_id')->nullable()->index();
                $table->string('session_id')->nullable();
                $table->string('source');
                $table->string('editor_source', 32)->nullable();
                $table->string('event_type')->nullable();
                $table->integer('count')->default(0);
                $table->integer('duration_ms')->nullable();
                $table->timestamp('timestamp')->nullable();
                $table->json('metadata')->nullable();
                $table->json('payload');
                $table->string('batch_hash', 64)->unique();
                $table->integer('session_prs_created')->default(0);
                $table->integer('session_prs_merged')->default(0);
                $table->integer('session_pr_reopen_count')->default(0);
                $table->integer('session_deployment_successes')->default(0);
                $table->string('event_id', 64)->nullable();
                $table->timestamps();
            });
        }

        $org = Organization::create(['name' => 'Test Org', 'slug' => 'test-' . uniqid()]);
        $this->organizationId = $org->id;
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-' . Str::random(8) . '@test.com',
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);
        $this->dashboardToken = ApiToken::generateDashboardToken($admin->id, $org->id)['raw'];
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('api_tokens');
            Schema::dropIfExists('telemetry_events');
            Schema::dropIfExists('invites');
            Schema::dropIfExists('users');
            Schema::dropIfExists('organizations');
        }
        parent::tearDown();
    }

    /**
     * Create a session event with given metadata.
     */
    private function createSessionEvent(
        string $userId,
        string $source,
        ?string $editorSource,
        int $organizationId,
        array $extraMeta = []
    ): TelemetryEvent {
        $meta = array_merge(['segment_type' => 'session'], $extraMeta);
        return TelemetryEvent::create([
            'user_id' => $userId,
            'organization_id' => $organizationId,
            'source' => $source,
            'editor_source' => $editorSource,
            'event_type' => 'session',
            'duration_ms' => 60000,
            'timestamp' => now()->subDay(),
            'metadata' => $meta,
            'payload' => [],
            'batch_hash' => Str::random(40),
        ]);
    }

    /**
     * Set up the Matt identity fixtures: static IDs + invite with Matt's email.
     */
    private function setupMattIdentities(): array
    {
        // Create Matt's invite with his verified email
        $mattInvite = Invite::create([
            'organization_id' => $this->organizationId,
            'token' => Str::random(20),
            'email' => config('local_developer.matt_email'),
            'expires_at' => now()->addMonth(),
            'role' => 'member',
        ]);

        // Create session events for each verified Matt identity
        $this->createSessionEvent('local-developer', 'windsurf', 'windsurf', $this->organizationId);
        $this->createSessionEvent('local-developer', 'cursor', 'cursor', $this->organizationId);
        $this->createSessionEvent('4', 'vscode', 'vscode', $this->organizationId);
        $this->createSessionEvent('18269556', 'devin', 'devin', $this->organizationId);
        $this->createSessionEvent("invite:{$mattInvite->id}", 'vscode', 'vscode', $this->organizationId);

        return ['mattInviteId' => $mattInvite->id];
    }

    /**
     * Set up a sample persona with simulated=true.
     */
    private function setupSamplePersona(string $personaId, string $source): void
    {
        $this->createSessionEvent(
            $personaId,
            $source,
            $source,
            $this->organizationId,
            ['simulated' => true]
        );
    }

    private function callCanonical(?string $userId = null)
    {
        $qs = 'from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all';
        if ($userId !== null) {
            $qs .= '&user_id=' . urlencode($userId);
        }
        return $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/telemetry/canonical?' . $qs);
    }

    // ── Resolver unit tests ──────────────────────────────────────────

    public function test_resolver_returns_static_identities(): void
    {
        $resolver = new LocalDeveloperResolver();
        $ids = $resolver->resolveRawIdentities();

        $this->assertContains('local-developer', $ids);
        $this->assertContains('4', $ids);
        $this->assertContains('18269556', $ids);
    }

    public function test_resolver_includes_invite_matching_matt_email(): void
    {
        $mattInvite = Invite::create([
            'organization_id' => $this->organizationId,
            'token' => Str::random(20),
            'email' => config('local_developer.matt_email'),
            'expires_at' => now()->addMonth(),
            'role' => 'member',
        ]);

        $resolver = new LocalDeveloperResolver();
        $ids = $resolver->resolveRawIdentities();

        $this->assertContains("invite:{$mattInvite->id}", $ids);
    }

    public function test_resolver_excludes_sample_persona_ids(): void
    {
        $resolver = new LocalDeveloperResolver();
        $ids = $resolver->resolveRawIdentities();

        foreach (config('local_developer.sample_persona_ids') as $personaId) {
            $this->assertNotContains($personaId, $ids, "Sample persona {$personaId} leaked into Matt identities");
        }
    }

    public function test_resolver_excludes_simulated_identities(): void
    {
        // Create a simulated event for user_id='4' (a verified Matt static ID)
        $this->createSessionEvent('4', 'cursor', 'cursor', $this->organizationId, ['simulated' => true]);

        $resolver = new LocalDeveloperResolver();
        $ids = $resolver->resolveRawIdentities();

        // user_id='4' now has simulated telemetry → must be excluded
        $this->assertNotContains('4', $ids, 'Identity with simulated=true telemetry was not excluded from Matt');
    }

    public function test_resolver_does_not_include_unknown_real_identity(): void
    {
        // Create a non-simulated event for an unknown identity
        $this->createSessionEvent('invite:999', 'cursor', 'cursor', $this->organizationId);

        $resolver = new LocalDeveloperResolver();
        $ids = $resolver->resolveRawIdentities();

        $this->assertNotContains('invite:999', $ids, 'Unknown real identity was auto-included as Matt');
    }

    public function test_is_local_developer_recognizes_logical_id(): void
    {
        $resolver = new LocalDeveloperResolver();
        $this->assertTrue($resolver->isLocalDeveloper('local-developer'));
        $this->assertFalse($resolver->isLocalDeveloper('90001'));
        $this->assertFalse($resolver->isLocalDeveloper('invite:122'));
    }

    public function test_resolver_includes_declared_demo_overlay_identity(): void
    {
        // The declared continuity-overlay raw id is fixture authority: it
        // resolves to Matt even though all of its rows are simulated=true.
        // This is the deliberate LOCAL-only carve-out — declared, not inferred.
        $this->createSessionEvent('local-demo-matt-overlay', 'cursor', 'cursor', $this->organizationId, ['simulated' => true]);

        $resolver = new LocalDeveloperResolver();
        $ids = $resolver->resolveRawIdentities();

        $this->assertContains('local-demo-matt-overlay', $ids,
            'Declared demo overlay identity must resolve to Matt in Local');
    }

    public function test_overlay_identity_does_not_weaken_simulated_exclusion_for_others(): void
    {
        // An UNDECLARED identity with simulated=true telemetry must still be
        // excluded — the overlay carve-out only applies to the configured list.
        $this->createSessionEvent('random-synthetic-user', 'cursor', 'cursor', $this->organizationId, ['simulated' => true]);

        $resolver = new LocalDeveloperResolver();
        $ids = $resolver->resolveRawIdentities();

        $this->assertNotContains('random-synthetic-user', $ids,
            'Undeclared simulated identity must not resolve to Matt');
    }

    // ── Canonical endpoint integration tests ─────────────────────────

    public function test_local_developer_returns_union_of_all_matt_identities(): void
    {
        $fixtures = $this->setupMattIdentities();

        $response = $this->callCanonical('local-developer');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        // 5 sessions: local-developer(2) + 4(1) + 18269556(1) + invite:N(1)
        $this->assertEquals(5, $meta['canonical_population_count']);
        $this->assertArrayHasKey('windsurf', $meta['session_count_by_tool']);
        $this->assertArrayHasKey('cursor', $meta['session_count_by_tool']);
        $this->assertArrayHasKey('vscode', $meta['session_count_by_tool']);
        $this->assertArrayHasKey('devin', $meta['session_count_by_tool']);
    }

    public function test_sample_persona_90001_returns_jordan_only(): void
    {
        $this->setupMattIdentities();
        $this->setupSamplePersona('90001', 'cursor');

        $response = $this->callCanonical('90001');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $this->assertEquals(1, $meta['canonical_population_count'], 'Jordan leaked Matt data');
        $this->assertEquals(['cursor' => 1], $meta['session_count_by_tool']);
    }

    public function test_simulated_telemetry_never_enters_matt(): void
    {
        $this->setupMattIdentities();
        // Add a simulated event under user_id='4' (Matt's static ID)
        $this->createSessionEvent('4', 'cursor', 'cursor', $this->organizationId, ['simulated' => true]);

        $response = $this->callCanonical('local-developer');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        // user_id='4' now has simulated telemetry → the entire identity is
        // excluded (conservative: no simulated row may resolve to Matt).
        // Original 5 sessions minus user_id='4's 1 non-simulated session = 4.
        $this->assertEquals(4, $meta['canonical_population_count'],
            'Simulated telemetry leaked into Matt via user_id=4');
    }

    public function test_all_developers_population_unchanged_by_resolver(): void
    {
        // The resolver only affects how user_id=local-developer is expanded.
        // The unfiltered canonical population must remain identical.
        $this->setupMattIdentities();
        $this->setupSamplePersona('90001', 'cursor');
        $this->setupSamplePersona('90002', 'vscode');

        $response = $this->callCanonical(null);
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        // 5 Matt + 2 sample = 7 total
        $this->assertEquals(7, $meta['canonical_population_count']);
    }

    public function test_unknown_real_identity_does_not_become_matt(): void
    {
        $this->setupMattIdentities();
        $this->createSessionEvent('invite:999', 'cursor', 'cursor', $this->organizationId);

        // Querying local-developer should NOT include invite:999
        $response = $this->callCanonical('local-developer');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        $this->assertEquals(5, $meta['canonical_population_count'],
            'Unknown real identity was auto-attributed to Matt');

        // Querying invite:999 directly should return only its own data
        $response2 = $this->callCanonical('invite:999');
        $response2->assertStatus(200);
        $meta2 = $response2->json('metadata');
        $this->assertEquals(1, $meta2['canonical_population_count']);
    }

    public function test_future_matt_invite_auto_resolves(): void
    {
        $this->setupMattIdentities();

        // Create a NEW invite for Matt (same email) — simulates a future reconnect
        $newInvite = Invite::create([
            'organization_id' => $this->organizationId,
            'token' => Str::random(20),
            'email' => config('local_developer.matt_email'),
            'expires_at' => now()->addMonth(),
            'role' => 'member',
        ]);
        $this->createSessionEvent("invite:{$newInvite->id}", 'devin', 'devin', $this->organizationId);

        $response = $this->callCanonical('local-developer');
        $response->assertStatus(200);

        $meta = $response->json('metadata');
        // 5 original + 1 new = 6
        $this->assertEquals(6, $meta['canonical_population_count'],
            'Future Matt invite did not auto-resolve to local-developer');
    }

    // ── Release-boundary gate tests ──────────────────────────────────

    public function test_alias_disabled_when_env_is_not_local(): void
    {
        // Simulate a production environment by temporarily overriding app.env.
        // The resolver must disable the alias path and treat
        // `local-developer` as a literal user_id (no Matt expansion).
        $originalEnv = config('app.env');
        config(['app.env' => 'production']);
        // Also disable the testing flag to prove the gate is env-based
        config(['local_developer.enabled_for_testing' => false]);

        try {
            $this->setupMattIdentities();

            $resolver = new LocalDeveloperResolver();
            $this->assertFalse($resolver->isAliasEnabled(),
                'Alias path was enabled in production environment — RELEASE BOUNDARY DEFECT');

            // Querying local-developer should return ONLY literal rows
            // (local-developer has 2 sessions), NOT the full Matt union (5).
            $response = $this->callCanonical('local-developer');
            $response->assertStatus(200);

            $meta = $response->json('metadata');
            $this->assertEquals(2, $meta['canonical_population_count'],
                'Matt alias expanded in production environment — RELEASE BOUNDARY DEFECT');
        } finally {
            config(['app.env' => $originalEnv]);
            config(['local_developer.enabled_for_testing' => true]);
        }
    }

    public function test_alias_enabled_in_local_env(): void
    {
        $originalEnv = config('app.env');
        config(['app.env' => 'local']);

        try {
            $resolver = new LocalDeveloperResolver();
            $this->assertTrue($resolver->isAliasEnabled(),
                'Alias path was disabled in local environment');
        } finally {
            config(['app.env' => $originalEnv]);
        }
    }

    public function test_ordinary_user_id_filter_unaffected_by_gate(): void
    {
        // Even with alias disabled, ordinary user_id filters must work
        $originalEnv = config('app.env');
        config(['app.env' => 'production']);
        config(['local_developer.enabled_for_testing' => false]);

        try {
            $this->createSessionEvent('invite:55', 'cursor', 'cursor', $this->organizationId);
            $this->createSessionEvent('invite:55', 'vscode', 'vscode', $this->organizationId);
            $this->createSessionEvent('invite:66', 'devin', 'devin', $this->organizationId);

            $response = $this->callCanonical('invite:55');
            $response->assertStatus(200);

            $meta = $response->json('metadata');
            $this->assertEquals(2, $meta['canonical_population_count'],
                'Ordinary user_id filter broken when alias is disabled');
        } finally {
            config(['app.env' => $originalEnv]);
            config(['local_developer.enabled_for_testing' => true]);
        }
    }
}
