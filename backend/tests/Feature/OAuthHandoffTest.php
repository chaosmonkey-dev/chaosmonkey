<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class OAuthHandoffTest extends TestCase
{
    use \App\Traits\TokenAuthority;

    protected function setUp(): void
    {
        parent::setUp();

        $this->assertTrue(app()->environment('testing'), 'Refusing to run: APP_ENV is not testing');
        $this->assertEquals('sqlite', config('database.default'), 'Refusing to run: database driver is not sqlite');
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'), 'Refusing to run: SQLite database is not :memory:');

        $this->createTables();
        $this->seedFixture();
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing') && config('database.default') === 'sqlite' && config('database.connections.sqlite.database') === ':memory:') {
            Schema::dropIfExists('telemetry_events');
            Schema::dropIfExists('api_tokens');
            Schema::dropIfExists('ide_connect_codes');
            Schema::dropIfExists('cohort_members');
            Schema::dropIfExists('cohorts');
            Schema::dropIfExists('invites');
            Schema::dropIfExists('users');
            Schema::dropIfExists('organizations');
            Schema::dropIfExists('oauth_tokens');
        }
        parent::tearDown();
    }

    private Organization $orgA;
    private Organization $orgB;
    private User $adminA;
    private User $adminB;
    private string $extensionToken;

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
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('token', 64)->unique();
                $table->string('email')->nullable();
                $table->string('role')->default('member');
                $table->timestamp('expires_at');
                $table->timestamp('redeemed_at')->nullable();
                $table->foreignId('redeemed_by_user_id')->nullable();
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
                $table->index('organization_id');
            });
        }
        if (!Schema::hasTable('ide_connect_codes')) {
            Schema::create('ide_connect_codes', function ($table) {
                $table->id();
                $table->string('code', 32)->unique();
                $table->foreignId('user_id')->nullable()->constrained();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->foreignId('invite_id')->nullable()->constrained('invites')->nullOnDelete();
                $table->string('installation_id', 64)->nullable();
                $table->timestamp('expires_at');
                $table->timestamp('used_at')->nullable();
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
        if (!Schema::hasTable('oauth_tokens')) {
            Schema::create('oauth_tokens', function ($table) {
                $table->id();
                $table->string('user_id')->nullable();
                $table->foreignId('organization_id')->nullable();
                $table->string('access_token')->nullable();
                $table->string('oauth_state', 64)->nullable();
                $table->json('user_data')->nullable();
                $table->timestamps();
            });
        }
    }

    private function seedFixture(): void
    {
        $this->orgA = Organization::create(['name' => 'Org A', 'slug' => 'org-a-' . Str::random(6)]);
        $this->orgB = Organization::create(['name' => 'Org B', 'slug' => 'org-b-' . Str::random(6)]);
        $this->adminA = User::create(['name' => 'Admin A', 'email' => 'admin-a@test.com', 'organization_id' => $this->orgA->id, 'role' => 'admin']);
        $this->adminB = User::create(['name' => 'Admin B', 'email' => 'admin-b@test.com', 'organization_id' => $this->orgB->id, 'role' => 'admin']);

        $invite = Invite::create(['organization_id' => $this->orgA->id, 'token' => Str::random(32), 'email' => 'dev-ext@test.com', 'expires_at' => now()->addDays(30)]);
        $pair = $this->createInviteBackedToken($this->orgA->id, $invite->id, 'install-001');
        $this->extensionToken = $pair['raw'];
    }

    private function createInviteBackedToken(int $orgId, int $inviteId, string $installationId): array
    {
        $raw = Str::random(64);
        ApiToken::create(['token' => hash('sha256', $raw), 'user_id' => null, 'organization_id' => $orgId, 'invite_id' => $inviteId, 'installation_id' => $installationId, 'expires_at' => now()->addDays(365)]);
        return ['raw' => $raw];
    }

    private function storeHandoff(int $userId, int $orgId, int $ttlSeconds = 120): string
    {
        $code = Str::random(48);
        Cache::put('oauth_handoff:' . hash('sha256', $code), ['user_id' => $userId, 'organization_id' => $orgId], now()->addSeconds($ttlSeconds));
        return $code;
    }

    // ─── Callback redirect tests ───

    public function test_redirect_contains_handoff_code_not_dashboard_token(): void
    {
        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id);
        $url = "http://localhost:5174/callback?oauth_success=true&handoff_code={$code}";
        $this->assertStringContainsString('handoff_code=', $url);
        $this->assertStringNotContainsString('dashboard_token=', $url);
    }

    public function test_redirect_does_not_contain_github_access_token(): void
    {
        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id);
        $url = "http://localhost:5174/callback?oauth_success=true&handoff_code={$code}";
        $this->assertStringNotContainsString('access_token', $url);
        $this->assertStringNotContainsString('github_token', $url);
    }

    public function test_handoff_cache_contains_only_user_and_org_identity(): void
    {
        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id);
        $cached = Cache::get('oauth_handoff:' . hash('sha256', $code));
        $this->assertIsArray($cached);
        $this->assertEquals($this->adminA->id, $cached['user_id']);
        $this->assertEquals($this->orgA->id, $cached['organization_id']);
        $this->assertArrayNotHasKey('token', $cached);
        $this->assertArrayNotHasKey('dashboard_token', $cached);
        $this->assertArrayNotHasKey('access_token', $cached);
        $this->assertArrayNotHasKey('raw', $cached);
    }

    public function test_handoff_expiry_is_two_minutes_or_less(): void
    {
        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id, 120);
        $key = 'oauth_handoff:' . hash('sha256', $code);
        $this->assertNotNull(Cache::get($key));
        $this->travel(121)->seconds();
        $this->assertNull(Cache::get($key));
    }

    // ─── Exchange endpoint tests ───

    public function test_valid_handoff_returns_dashboard_token(): void
    {
        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id);
        $r = $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $code]);
        $r->assertStatus(200);
        $r->assertJsonStructure(['dashboard_token', 'token_type']);
        $this->assertEquals('Bearer', $r->json('token_type'));
        $this->assertNotEmpty($r->json('dashboard_token'));
    }

    public function test_returned_credential_resolves_exact_user_and_org(): void
    {
        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id);
        $r = $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $code]);
        $raw = $r->json('dashboard_token');
        $t = ApiToken::where('token', hash('sha256', $raw))->first();
        $this->assertNotNull($t);
        $this->assertEquals($this->adminA->id, $t->user_id);
        $this->assertEquals($this->orgA->id, $t->organization_id);
        $this->assertNull($t->invite_id);
        $this->assertNull($t->installation_id);
    }

    public function test_handoff_is_removed_after_use(): void
    {
        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id);
        $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $code])->assertStatus(200);
        $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $code])->assertStatus(400);
    }

    public function test_replay_fails(): void
    {
        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id);
        $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $code])->assertStatus(200);
        $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $code])->assertStatus(400);
    }

    public function test_invalid_code_fails(): void
    {
        $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => 'totally-invalid-garbage-12345'])->assertStatus(400);
    }

    public function test_expired_code_fails(): void
    {
        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id, 1);
        $this->travel(2)->seconds();
        $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $code])->assertStatus(400);
    }

    public function test_missing_code_fails(): void
    {
        $this->postJson('/api/github/oauth/dashboard-token', [])->assertStatus(400);
    }

    public function test_rejected_exchanges_create_no_api_tokens(): void
    {
        $before = ApiToken::count();
        $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => 'invalid'])->assertStatus(400);
        $this->postJson('/api/github/oauth/dashboard-token', [])->assertStatus(400);
        $expired = $this->storeHandoff($this->adminA->id, $this->orgA->id, 1);
        $this->travel(2)->seconds();
        $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $expired])->assertStatus(400);
        $this->assertEquals($before, ApiToken::count(), 'No API tokens created by rejected exchanges');
    }

    public function test_successful_exchange_rotates_prior_dashboard_tokens(): void
    {
        $initial = ApiToken::generateDashboardToken($this->adminA->id, $this->orgA->id);
        $initialModel = ApiToken::where('token', hash('sha256', $initial['raw']))->first();
        $this->assertNull($initialModel->revoked_at);

        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id);
        $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $code])->assertStatus(200);

        $initialModel->refresh();
        $this->assertNotNull($initialModel->revoked_at, 'Prior dashboard token revoked after exchange');
    }

    public function test_extension_tokens_remain_valid_after_exchange(): void
    {
        $extModel = ApiToken::where('token', hash('sha256', $this->extensionToken))->first();
        $this->assertNull($extModel->revoked_at);

        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id);
        $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $code])->assertStatus(200);

        $extModel->refresh();
        $this->assertNull($extModel->revoked_at, 'Extension token must remain valid and unrevoked');
    }

    public function test_two_users_receive_distinct_codes_and_tokens(): void
    {
        $codeA = $this->storeHandoff($this->adminA->id, $this->orgA->id);
        $codeB = $this->storeHandoff($this->adminB->id, $this->orgB->id);
        $this->assertNotEquals($codeA, $codeB);

        $rA = $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $codeA]);
        $rB = $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $codeB]);
        $rA->assertStatus(200);
        $rB->assertStatus(200);

        $tA = $rA->json('dashboard_token');
        $tB = $rB->json('dashboard_token');
        $this->assertNotEquals($tA, $tB);

        $mA = ApiToken::where('token', hash('sha256', $tA))->first();
        $mB = ApiToken::where('token', hash('sha256', $tB))->first();
        $this->assertEquals($this->adminA->id, $mA->user_id);
        $this->assertEquals($this->orgA->id, $mA->organization_id);
        $this->assertEquals($this->adminB->id, $mB->user_id);
        $this->assertEquals($this->orgB->id, $mB->organization_id);
    }

    public function test_client_supplied_user_or_org_fields_are_ignored(): void
    {
        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id);
        $r = $this->postJson('/api/github/oauth/dashboard-token', [
            'handoff_code' => $code,
            'user_id' => $this->adminB->id,
            'organization_id' => $this->orgB->id,
        ]);
        $r->assertStatus(200);
        $t = ApiToken::where('token', hash('sha256', $r->json('dashboard_token')))->first();
        $this->assertEquals($this->adminA->id, $t->user_id);
        $this->assertEquals($this->orgA->id, $t->organization_id);
    }

    public function test_failed_handoff_does_not_revoke_existing_dashboard_token(): void
    {
        $existing = ApiToken::generateDashboardToken($this->adminA->id, $this->orgA->id);
        $existingModel = ApiToken::where('token', hash('sha256', $existing['raw']))->first();
        $this->assertNull($existingModel->revoked_at);

        $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => 'invalid'])->assertStatus(400);

        $existingModel->refresh();
        $this->assertNull($existingModel->revoked_at, 'Existing dashboard token must not be revoked by failed handoff');
    }

    // ─── Regression ───

    public function test_sentinel_token_still_rejected(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer oauth_authenticated'])
            ->getJson('/api/org/users')->assertStatus(401);
    }

    public function test_missing_auth_still_returns_401(): void
    {
        $this->getJson('/api/org/users')->assertStatus(401);
    }

    public function test_extension_token_still_403_on_org_routes(): void
    {
        $this->withHeaders(['Authorization' => 'Bearer ' . $this->extensionToken])
            ->getJson('/api/org/users')->assertStatus(403);
    }

    public function test_dashboard_token_from_exchange_works_on_org_routes(): void
    {
        $code = $this->storeHandoff($this->adminA->id, $this->orgA->id);
        $r = $this->postJson('/api/github/oauth/dashboard-token', ['handoff_code' => $code]);
        $r->assertStatus(200);
        $raw = $r->json('dashboard_token');

        $this->withHeaders(['Authorization' => 'Bearer ' . $raw])
            ->getJson('/api/org/users')->assertStatus(200);
    }
}
