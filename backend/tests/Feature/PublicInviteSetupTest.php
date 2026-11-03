<?php

namespace Tests\Feature;

use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class PublicInviteSetupTest extends TestCase
{
    private Organization $organization;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->assertTrue(app()->environment('testing'), 'Refusing to run: APP_ENV is not testing');
        $this->assertEquals('sqlite', config('database.default'), 'Refusing to run: database driver is not sqlite');
        $this->assertEquals(':memory:', config('database.connections.sqlite.database'), 'Refusing to run: SQLite database is not :memory:');

        $this->createTables();

        config(['app.url' => 'http://test.test:8010']);

        $this->organization = Organization::create([
            'name' => 'Setup Test Org',
            'slug' => 'setup-test-' . Str::random(6),
        ]);

        $this->admin = User::create([
            'name' => 'Setup Admin',
            'email' => 'admin-' . Str::random(8) . '@setup.test',
            'password' => bcrypt('password'),
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);
    }

    protected function tearDown(): void
    {
        if (app()->environment('testing')
            && config('database.default') === 'sqlite'
            && config('database.connections.sqlite.database') === ':memory:'
        ) {
            Schema::dropIfExists('ide_connect_codes');
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
                $table->string('password')->nullable();
                $table->string('github_id')->nullable();
                $table->foreignId('organization_id')->nullable()->constrained();
                $table->string('role')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('invites')) {
            Schema::create('invites', function ($table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('token', 64)->unique();
                $table->string('email')->nullable();
                $table->string('role')->nullable();
                $table->timestamp('expires_at');
                $table->timestamp('redeemed_at')->nullable();
                $table->foreignId('redeemed_by_user_id')->nullable();
                $table->timestamps();
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
    }

    private function createInviteForOrg(Organization $org, string $email, ?string $expiresAt = null, ?string $redeemedAt = null): Invite
    {
        return Invite::create([
            'organization_id' => $org->id,
            'email' => $email,
            'expires_at' => $expiresAt ?? now()->addDay(),
            'redeemed_at' => $redeemedAt,
        ]);
    }

    private function createCodeForInvite(Invite $invite): IDEConnectCode
    {
        return IDEConnectCode::create([
            'code' => strtoupper(Str::random(4) . '-' . Str::random(4)),
            'user_id' => $this->admin->id,
            'organization_id' => $invite->organization_id,
            'invite_id' => $invite->id,
            'expires_at' => now()->addDays(7),
        ]);
    }

    public function test_valid_invite_returns_setup_and_connect_code(): void
    {
        $invite = $this->createInviteForOrg($this->organization, 'dev@example.com');
        $code = $this->createCodeForInvite($invite);

        $response = $this->getJson('/api/invites/' . $invite->token);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertArrayHasKey('invite', $body);
        $this->assertArrayHasKey('setup', $body);

        $this->assertEquals('Setup Test Org', $body['invite']['organization_name']);
        $this->assertEquals('dev@example.com', $body['invite']['email']);
        $this->assertFalse($body['invite']['is_expired']);
        $this->assertFalse($body['invite']['is_redeemed']);

        $this->assertEquals('0.4.1', $body['setup']['extension_version']);
        $this->assertEquals('http://test.test:8010', $body['setup']['api_base_url']);
        $this->assertEquals('http://test.test:8010/api/extension/download/latest', $body['setup']['vsix_download_url']);
        $this->assertEquals($code->code, $body['setup']['connect_code']);

        $this->assertArrayNotHasKey('token', $body['invite']);
        $this->assertEquals('member', $body['invite']['role']);
        $this->assertArrayNotHasKey('id', $body['invite']);
    }

    public function test_expired_invite_returns_no_setup(): void
    {
        $invite = $this->createInviteForOrg($this->organization, 'expired@example.com', now()->subDay());
        $this->createCodeForInvite($invite);

        $response = $this->getJson('/api/invites/' . $invite->token);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertTrue($body['invite']['is_expired']);
        $this->assertArrayNotHasKey('setup', $body);
        $this->assertArrayNotHasKey('connect_code', $body);
    }

    public function test_redeemed_invite_returns_no_setup(): void
    {
        $invite = $this->createInviteForOrg($this->organization, 'redeemed@example.com', now()->addDay(), now());
        $this->createCodeForInvite($invite);

        $response = $this->getJson('/api/invites/' . $invite->token);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertTrue($body['invite']['is_redeemed']);
        $this->assertArrayNotHasKey('setup', $body);
        $this->assertArrayNotHasKey('connect_code', $body);
    }

    public function test_unknown_token_returns_404(): void
    {
        $response = $this->getJson('/api/invites/' . bin2hex(random_bytes(16)));

        $response->assertStatus(404);
    }

    public function test_get_performs_no_database_writes(): void
    {
        $invite = $this->createInviteForOrg($this->organization, 'readonly@example.com');
        $this->createCodeForInvite($invite);

        $invitesBefore = DB::table('invites')->count();
        $codesBefore = DB::table('ide_connect_codes')->count();

        $this->getJson('/api/invites/' . $invite->token);
        $this->getJson('/api/invites/' . $invite->token);

        $this->assertEquals($invitesBefore, DB::table('invites')->count());
        $this->assertEquals($codesBefore, DB::table('ide_connect_codes')->count());
    }

    public function test_setup_advertises_cursor_agent_bridge_when_capability_present(): void
    {
        $invite = $this->createInviteForOrg($this->organization, 'cursor@example.com');
        $this->createCodeForInvite($invite);

        $response = $this->getJson('/api/invites/' . $invite->token);

        $response->assertStatus(200);
        $body = $response->json();

        $this->assertArrayHasKey('cursor_agent_bridge', $body['setup']);
        $cb = $body['setup']['cursor_agent_bridge'];
        $this->assertEquals('0.4.2-cursor-bridge', $cb['version']);
        $this->assertEquals('chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz', $cb['filename']);
        $this->assertEquals('972acbc5c02efccac995484c80534e34f28de837a1e65a72520286353d2bbe21', $cb['sha256']);
        $this->assertEquals('http://test.test:8010/api/cursor-agent-bridge/download/latest', $cb['download_url']);
        // Capability must not leak enrollment secrets beyond the shared code
        $this->assertArrayNotHasKey('auth_token', $cb);
        $this->assertArrayNotHasKey('token', $cb);
    }

    public function test_setup_omits_cursor_agent_bridge_when_artifact_absent(): void
    {
        $invite = $this->createInviteForOrg($this->organization, 'nocursor@example.com');
        $this->createCodeForInvite($invite);

        $tgzPath = resource_path('extensions/chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz');
        $hiddenPath = $tgzPath . '.test-hidden';
        $this->assertFileExists($tgzPath);
        rename($tgzPath, $hiddenPath);

        try {
            $response = $this->getJson('/api/invites/' . $invite->token);
            $response->assertStatus(200);
            $body = $response->json();
            // Fail closed: no capability advertisement without the verified artifact
            $this->assertArrayHasKey('setup', $body);
            $this->assertArrayNotHasKey('cursor_agent_bridge', $body['setup']);
            $this->assertArrayHasKey('vsix_download_url', $body['setup']);
        } finally {
            rename($hiddenPath, $tgzPath);
        }
    }

    public function test_cross_organization_code_leakage_is_impossible(): void
    {
        $orgA = $this->organization;
        $orgB = Organization::create([
            'name' => 'Other Setup Org',
            'slug' => 'other-setup-' . Str::random(6),
        ]);

        $inviteA = $this->createInviteForOrg($orgA, 'a@example.com');
        $codeA = $this->createCodeForInvite($inviteA);

        $inviteB = $this->createInviteForOrg($orgB, 'b@example.com');
        $codeB = $this->createCodeForInvite($inviteB);

        $responseA = $this->getJson('/api/invites/' . $inviteA->token);
        $bodyA = $responseA->json();
        $this->assertEquals($codeA->code, $bodyA['setup']['connect_code']);
        $this->assertEquals('Setup Test Org', $bodyA['invite']['organization_name']);

        $responseB = $this->getJson('/api/invites/' . $inviteB->token);
        $bodyB = $responseB->json();
        $this->assertEquals($codeB->code, $bodyB['setup']['connect_code']);
        $this->assertEquals('Other Setup Org', $bodyB['invite']['organization_name']);
    }
}
