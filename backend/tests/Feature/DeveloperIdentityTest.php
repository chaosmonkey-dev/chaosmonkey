<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CR2 Ed Distribution Path — /api/developers must expose human-readable
 * identified developers (invite-backed) and exclude anonymous/opaque legacy
 * identifiers (raw numeric GitHub IDs, cm-dev-*, dev-user-*, "anonymous")
 * from the selectable-people list.
 */
class DeveloperIdentityTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Fail closed: only allow Schema operations in an isolated test DB
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

        $this->createTables();
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('api_tokens');
            Schema::dropIfExists('pull_requests');
            Schema::dropIfExists('cursor_usage');
            Schema::dropIfExists('telemetry_events');
            Schema::dropIfExists('cohort_members');
            Schema::dropIfExists('cohorts');
            Schema::dropIfExists('invites');
            Schema::dropIfExists('users');
            Schema::dropIfExists('organizations');
        }

        parent::tearDown();
    }

    private function createTables(): void
    {
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
                $table->string('github_id')->nullable();
                $table->string('role')->nullable();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('invites')) {
            Schema::create('invites', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('token', 64)->unique();
                $table->string('email');
                $table->timestamp('expires_at');
                $table->timestamp('redeemed_at')->nullable();
                $table->foreignId('redeemed_by_user_id')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('pull_requests')) {
            Schema::create('pull_requests', function ($table) {
                $table->id();
                $table->string('developer_id')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('cohorts')) {
            Schema::create('cohorts', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->timestamp('archived_at')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('cohort_members')) {
            Schema::create('cohort_members', function ($table) {
                $table->id();
                $table->foreignId('cohort_id')->constrained('cohorts')->cascadeOnDelete();
                $table->foreignId('invite_id')->unique()->constrained('invites')->cascadeOnDelete();
                $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
                $table->foreignId('assigned_by')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('cursor_usage')) {
            Schema::create('cursor_usage', function ($table) {
                $table->id();
                $table->string('user_id')->nullable();
                $table->timestamps();
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
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('api_tokens')) {
            Schema::create('api_tokens', function ($table) {
                $table->id();
                $table->string('token', 64)->unique();
                $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->foreignId('invite_id')->nullable()->constrained('invites')->nullOnDelete();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamp('revoked_at')->nullable();
                $table->timestamps();
                $table->index('token');
                $table->index('user_id');
            });
        }
    }

    private string $dashboardToken;

    private function seedMixedIdentityCorpus(): Invite
    {
        $org = Organization::create([
            'name' => 'Acme Org',
            'slug' => 'acme-org-' . uniqid(),
        ]);

        // Create an admin user and dashboard token for SimpleTokenAuth
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-' . Str::random(8) . '@acme.com',
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);
        $this->dashboardToken = ApiToken::generateDashboardToken($admin->id, $org->id)['raw'];

        $invite = Invite::create([
            'organization_id' => $org->id,
            'token' => bin2hex(random_bytes(16)),
            'email' => 'dev11@example.com',
            'expires_at' => now()->addDays(7),
        ]);

        // Real invite-backed identity (should be identified and human-readable)
        DB::table('telemetry_events')->insert([
            'user_id' => "invite:{$invite->id}",
            'organization_id' => $org->id,
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'event_type' => 'session',
            'metadata' => json_encode(['segment_type' => 'session']),
            'payload' => json_encode([]),
            'batch_hash' => hash('sha256', 'invite-batch'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Opaque legacy / anonymous identifiers (should be excluded from selectable people)
        $legacyRows = ['anonymous', 'cm-dev-17830249', 'cm-dev-17833694', 'dev-user-vscode'];
        foreach ($legacyRows as $i => $userId) {
            DB::table('telemetry_events')->insert([
                'user_id' => $userId,
                'organization_id' => $org->id,
                'source' => 'vscode',
                'editor_source' => 'vscode',
                'event_type' => 'session',
                'metadata' => json_encode(['segment_type' => 'session']),
                'payload' => json_encode([]),
                'batch_hash' => hash('sha256', "legacy-batch-{$i}"),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        // Raw numeric GitHub ID (should be excluded)
        DB::table('pull_requests')->insert([
            'developer_id' => '41001234',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $invite;
    }

    public function test_invite_backed_developer_is_human_readable(): void
    {
        $invite = $this->seedMixedIdentityCorpus();

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/developers');
        $response->assertStatus(200);

        $developers = $response->json('developers');
        $this->assertIsArray($developers);

        $inviteEntry = collect($developers)->firstWhere('id', "invite:{$invite->id}");
        $this->assertNotNull($inviteEntry, 'invite-backed developer must be present in /api/developers');
        $this->assertEquals('dev11@example.com', $inviteEntry['label']);
        $this->assertEquals('invite', $inviteEntry['source']);
    }

    public function test_anonymous_and_opaque_legacy_ids_are_excluded_from_selectable_people(): void
    {
        $this->seedMixedIdentityCorpus();

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])
            ->getJson('/api/developers');
        $response->assertStatus(200);

        $developerIds = collect($response->json('developers'))->pluck('id')->all();

        $this->assertNotContains('anonymous', $developerIds);
        $this->assertNotContains('cm-dev-17830249', $developerIds);
        $this->assertNotContains('cm-dev-17833694', $developerIds);
        $this->assertNotContains('dev-user-vscode', $developerIds);
        $this->assertNotContains('41001234', $developerIds);

        $excluded = $response->json('excluded_legacy_ids');
        $this->assertContains('anonymous', $excluded);
        $this->assertContains('cm-dev-17830249', $excluded);
        $this->assertContains('dev-user-vscode', $excluded);
        // Note: 41001234 (raw numeric GitHub ID from pull_requests) is NOT in
        // excluded_legacy_ids because getDevelopers() fail-closed skips
        // pull_requests entirely (no organization_id column on that table).
    }

    public function test_orphan_invite_id_is_excluded_not_surfaced(): void
    {
        $org = Organization::create([
            'name' => 'Orphan Org',
            'slug' => 'orphan-org-' . uniqid(),
        ]);

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-' . Str::random(8) . '@orphan.com',
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);
        $orphanToken = ApiToken::generateDashboardToken($admin->id, $org->id)['raw'];

        // Telemetry references an invite id that no longer exists (e.g. deleted invite)
        DB::table('telemetry_events')->insert([
            'user_id' => 'invite:9999',
            'organization_id' => $org->id,
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'event_type' => 'session',
            'metadata' => json_encode(['segment_type' => 'session']),
            'payload' => json_encode([]),
            'batch_hash' => hash('sha256', 'orphan-invite-batch'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $orphanToken])
            ->getJson('/api/developers');
        $response->assertStatus(200);

        // Orphan invite:9999 has no matching Invite row, so it must be
        // excluded from selectable developers and placed in excluded_legacy_ids
        $developerIds = collect($response->json('developers'))->pluck('id')->all();
        $this->assertNotContains('invite:9999', $developerIds);

        $excluded = $response->json('excluded_legacy_ids');
        $this->assertContains('invite:9999', $excluded);
    }

    public function test_organization_isolation_no_cross_org_leakage(): void
    {
        // Org A with its own admin, invite, and telemetry
        $orgA = Organization::create([
            'name' => 'Org A',
            'slug' => 'org-a-' . uniqid(),
        ]);
        $adminA = User::create([
            'name' => 'Admin A',
            'email' => 'admin-a-' . Str::random(8) . '@orga.com',
            'role' => 'admin',
            'organization_id' => $orgA->id,
        ]);
        $inviteA = Invite::create([
            'organization_id' => $orgA->id,
            'token' => bin2hex(random_bytes(16)),
            'email' => 'dev-a@example.com',
            'expires_at' => now()->addDays(7),
        ]);
        DB::table('telemetry_events')->insert([
            'user_id' => "invite:{$inviteA->id}",
            'organization_id' => $orgA->id,
            'source' => 'vscode',
            'editor_source' => 'vscode',
            'event_type' => 'session',
            'metadata' => json_encode(['segment_type' => 'session']),
            'payload' => json_encode([]),
            'batch_hash' => hash('sha256', 'orga-batch'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Org B with its own admin, invite, and telemetry
        $orgB = Organization::create([
            'name' => 'Org B',
            'slug' => 'org-b-' . uniqid(),
        ]);
        $adminB = User::create([
            'name' => 'Admin B',
            'email' => 'admin-b-' . Str::random(8) . '@orgb.com',
            'role' => 'admin',
            'organization_id' => $orgB->id,
        ]);
        $inviteB = Invite::create([
            'organization_id' => $orgB->id,
            'token' => bin2hex(random_bytes(16)),
            'email' => 'dev-b@example.com',
            'expires_at' => now()->addDays(7),
        ]);
        DB::table('telemetry_events')->insert([
            'user_id' => "invite:{$inviteB->id}",
            'organization_id' => $orgB->id,
            'source' => 'cursor',
            'editor_source' => 'cursor',
            'event_type' => 'session',
            'metadata' => json_encode(['segment_type' => 'session']),
            'payload' => json_encode([]),
            'batch_hash' => hash('sha256', 'orgb-batch'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Act as Org A's admin via dashboard token
        $tokenA = ApiToken::generateDashboardToken($adminA->id, $orgA->id)['raw'];
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $tokenA])
            ->getJson('/api/developers');
        $response->assertStatus(200);

        $developers = collect($response->json('developers'));
        $developerIds = $developers->pluck('id')->all();

        // Org A must see its own invite-backed developer
        $this->assertContains("invite:{$inviteA->id}", $developerIds);
        $entryA = $developers->firstWhere('id', "invite:{$inviteA->id}");
        $this->assertEquals('dev-a@example.com', $entryA['label']);

        // Org A must NOT see Org B's invite-backed developer
        $this->assertNotContains("invite:{$inviteB->id}", $developerIds);

        // Org B's invite email must not appear anywhere in the response
        $allLabels = $developers->pluck('label')->all();
        $this->assertNotContains('dev-b@example.com', $allLabels);
    }
}
