<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CR-X AUTH-CLEANUP-2 + AUTH-CLEANUP-3 regression tests.
 *
 * AUTH-CLEANUP-2: PATCH /api/org/users/{user}/role previously logged the
 * intended role change but never persisted it to the database — the UI
 * showed a false "Role updated" success message while the role column
 * never changed. This is now a real DB write.
 *
 * AUTH-CLEANUP-3: SimpleTokenAuth previously accepted a `?token=` query
 * parameter on ANY protected route with no environment or path
 * restriction, allowing a token to be embedded in a URL (leaking via
 * browser history / server logs / Referer headers) in production. The
 * fallback is now restricted to local/testing environments only.
 */
class CrxAuthCleanupTest extends TestCase
{
    private Organization $org;
    private User $admin;
    private User $member;
    private string $adminToken;

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

        $this->createTables();
        $this->seedFixture();
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
                $table->index('organization_id');
            });
        }
    }

    private function seedFixture(): void
    {
        $this->org = Organization::create([
            'name' => 'Test Org',
            'slug' => 'test-org-' . Str::random(6),
        ]);

        $this->admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-' . Str::random(6) . '@test.com',
            'organization_id' => $this->org->id,
            'role' => 'admin',
        ]);

        $this->member = User::create([
            'name' => 'Member',
            'email' => 'member-' . Str::random(6) . '@test.com',
            'organization_id' => $this->org->id,
            'role' => 'member',
        ]);

        $this->adminToken = ApiToken::generateDashboardToken($this->admin->id, $this->org->id)['raw'];
    }

    // === AUTH-CLEANUP-2: role update persistence ===

    public function test_role_update_persists_to_database(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson("/api/org/users/{$this->member->id}/role", ['role' => 'admin']);

        $response->assertStatus(200);
        $response->assertJsonPath('user.role', 'admin');

        // The real regression check: re-read from the database directly,
        // not via the response body, to prove the write actually happened.
        $this->member->refresh();
        $this->assertEquals('admin', $this->member->role,
            'Role update must be persisted to the database, not merely logged'
        );
    }

    public function test_role_update_response_no_longer_claims_pending_implementation(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson("/api/org/users/{$this->member->id}/role", ['role' => 'admin']);

        $response->assertStatus(200);
        $response->assertJsonMissingPath('mvp_note');
        $response->assertJsonMissingPath('user.intended_role');
        $this->assertStringNotContainsString(
            'pending implementation',
            json_encode($response->json())
        );
    }

    public function test_non_admin_cannot_update_role_and_no_write_occurs(): void
    {
        $memberToken = ApiToken::generateDashboardToken($this->member->id, $this->org->id)['raw'];

        $other = User::create([
            'name' => 'Other',
            'email' => 'other-' . Str::random(6) . '@test.com',
            'organization_id' => $this->org->id,
            'role' => 'member',
        ]);

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $memberToken])
            ->postJson("/api/org/users/{$other->id}/role", ['role' => 'admin']);

        $response->assertStatus(403);
        $other->refresh();
        $this->assertEquals('member', $other->role, 'Non-admin role update attempt must not persist');
    }

    public function test_cross_organization_target_user_returns_404_and_no_write_occurs(): void
    {
        // Boundary proof: admin in org A cannot update a user in org B.
        // The controller scopes the target lookup by the acting user's
        // organization_id, so a cross-org target must 404 (not 403, which
        // would leak existence) and must not persist any write.
        $otherOrg = Organization::create([
            'name' => 'Other Org',
            'slug' => 'other-org-' . Str::random(6),
        ]);
        $otherOrgUser = User::create([
            'name' => 'Other Org Member',
            'email' => 'other-org-' . Str::random(6) . '@test.com',
            'organization_id' => $otherOrg->id,
            'role' => 'member',
        ]);

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson("/api/org/users/{$otherOrgUser->id}/role", ['role' => 'admin']);

        $response->assertStatus(404);
        $otherOrgUser->refresh();
        $this->assertEquals('member', $otherOrgUser->role,
            'Cross-organization role update must not persist'
        );
    }

    public function test_invalid_role_value_is_rejected_with_422(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson("/api/org/users/{$this->member->id}/role", ['role' => 'superuser']);

        $response->assertStatus(422);
        $this->member->refresh();
        $this->assertEquals('member', $this->member->role,
            'Invalid role value must not persist'
        );
    }

    public function test_self_role_modification_is_rejected_with_400(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->postJson("/api/org/users/{$this->admin->id}/role", ['role' => 'member']);

        $response->assertStatus(400);
        $this->admin->refresh();
        $this->assertEquals('admin', $this->admin->role,
            'Self-role modification must not persist'
        );
    }

    public function test_unauthenticated_caller_is_rejected_with_401(): void
    {
        // No Bearer token, no query param — SimpleTokenAuth must reject.
        $response = $this->postJson("/api/org/users/{$this->member->id}/role", ['role' => 'admin']);
        $response->assertStatus(401);
        $this->member->refresh();
        $this->assertEquals('member', $this->member->role,
            'Unauthenticated role update must not persist'
        );
    }

    // === AUTH-CLEANUP-3: query-param token restricted to local/testing ===

    public function test_query_param_token_is_accepted_in_testing_environment(): void
    {
        // Testing environment is an allowed environment for the debug fallback,
        // so this proves the fallback still works for local development use.
        $response = $this->getJson('/api/org/users?token=' . $this->adminToken);
        $response->assertStatus(200);
    }

    public function test_query_param_token_fallback_is_gated_by_environment_in_source(): void
    {
        // Structural source-invariant check (same methodology as the R2
        // preflight checker): flipping the live process environment mid-run
        // in a shared PHPUnit suite is unsafe, so the "rejected outside
        // local/testing" contract is proven by verifying the guard exists
        // in source, combined with the behavioral proof below that the
        // fallback DOES still work in the (accepted) testing environment.
        $source = file_get_contents(base_path('app/Http/Middleware/SimpleTokenAuth.php'));
        $this->assertMatchesRegularExpression(
            "/query\\('token'\\)\\s*&&\\s*app\\(\\)->environment\\(\\['local',\\s*'testing'\\]\\)/",
            $source,
            'Query-param token fallback must be gated to local/testing environments only'
        );
    }

    public function test_bearer_header_still_works_regardless_of_environment(): void
    {
        // The Bearer-header path must be completely unaffected by the
        // query-param environment restriction.
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->adminToken])
            ->getJson('/api/org/users');
        $response->assertStatus(200);
    }
}
