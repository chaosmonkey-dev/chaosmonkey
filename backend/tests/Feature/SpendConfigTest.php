<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\ToolCostConfig;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

/**
 * CR-X ECON-1: Spend config backend authority tests.
 *
 * Verifies:
 * - Authentication required for all endpoints
 * - Organization scoping (no cross-org reads/writes)
 * - Canonical tool_id validation
 * - Save/read round trip (upsert semantics)
 * - Clear/reset semantics (single + all)
 */
class SpendConfigTest extends TestCase
{
    use RefreshDatabase;

    private function createDashboardToken(Organization $org, string $role = 'admin'): string
    {
        $user = User::factory()->create([
            'organization_id' => $org->id,
            'role' => $role,
        ]);
        return ApiToken::generateDashboardToken($user->id, $org->id)['raw'];
    }

    // ── Authentication ──────────────────────────────────────────────

    public function test_get_requires_auth(): void
    {
        $this->getJson('/api/org/spend/config')->assertStatus(401);
    }

    public function test_put_requires_auth(): void
    {
        $this->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor',
            'seat_count' => 10,
            'cost_per_seat_monthly' => 20,
        ])->assertStatus(401);
    }

    public function test_delete_single_requires_auth(): void
    {
        $this->deleteJson('/api/org/spend/config/cursor')->assertStatus(401);
    }

    public function test_delete_all_requires_auth(): void
    {
        $this->deleteJson('/api/org/spend/config')->assertStatus(401);
    }

    // ── GET: empty and populated ───────────────────────────────────

    public function test_get_returns_empty_for_org_with_no_configs(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->getJson('/api/org/spend/config');

        $response->assertStatus(200);
        $response->assertJsonPath('organization_id', $org->id);
        $response->assertJsonPath('configs', []);
        $response->assertJsonPath('total_monthly_spend', 0);
    }

    public function test_get_returns_persisted_configs(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        ToolCostConfig::create([
            'organization_id' => $org->id,
            'tool_id' => 'cursor',
            'tool_name' => 'Cursor',
            'seat_count' => 10,
            'cost_per_seat_monthly' => 20,
            'monthly_spend' => 200,
            'configured_at' => now(),
            'configured_by' => 1,
        ]);

        $response = $this->withToken($token)->getJson('/api/org/spend/config');

        $response->assertStatus(200);
        $response->assertJsonPath('configs.0.tool_id', 'cursor');
        $response->assertJsonPath('configs.0.seat_count', 10);
        $response->assertJsonPath('configs.0.monthly_spend', "200.00");
        $response->assertJsonPath('total_monthly_spend', 200);
    }

    // ── PUT: upsert, validation, org scoping ────────────────────────

    public function test_put_creates_new_config(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor',
            'seat_count' => 10,
            'cost_per_seat_monthly' => 20,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('config.tool_id', 'cursor');
        $response->assertJsonPath('config.seat_count', 10);
        $response->assertJsonPath('config.cost_per_seat_monthly', "20.00");
        $response->assertJsonPath('config.monthly_spend', "200.00");

        $this->assertDatabaseHas('tool_cost_configs', [
            'organization_id' => $org->id,
            'tool_id' => 'cursor',
            'seat_count' => 10,
            'monthly_spend' => 200,
        ]);
    }

    public function test_put_updates_existing_config(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Create initial
        $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor',
            'seat_count' => 10,
            'cost_per_seat_monthly' => 20,
        ]);

        // Update
        $response = $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor',
            'seat_count' => 50,
            'cost_per_seat_monthly' => 30,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('config.seat_count', 50);
        $response->assertJsonPath('config.monthly_spend', "1500.00");

        // Only one row (upsert, not insert)
        $this->assertEquals(1, ToolCostConfig::where('organization_id', $org->id)->count());
    }

    public function test_put_accepts_codex_tool_id(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'codex',
            'tool_name' => 'Codex',
            'seat_count' => 4,
            'cost_per_seat_monthly' => 20,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('config.tool_id', 'codex');
        $response->assertJsonPath('config.seat_count', 4);
        $response->assertJsonPath('config.monthly_spend', "80.00");

        $this->assertDatabaseHas('tool_cost_configs', [
            'organization_id' => $org->id,
            'tool_id' => 'codex',
            'seat_count' => 4,
            'monthly_spend' => 80,
        ]);
    }

    public function test_put_rejects_invalid_tool_id(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'invalid-tool',
            'seat_count' => 10,
            'cost_per_seat_monthly' => 20,
        ]);

        $response->assertStatus(422);
    }

    public function test_put_rejects_negative_values(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor',
            'seat_count' => -5,
            'cost_per_seat_monthly' => -10,
        ]);

        $response->assertStatus(422);
    }

    public function test_put_does_not_cross_orgs(): void
    {
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $tokenA = $this->createDashboardToken($orgA);
        $tokenB = $this->createDashboardToken($orgB);

        // Org A saves a config
        $this->withToken($tokenA)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor',
            'seat_count' => 10,
            'cost_per_seat_monthly' => 20,
        ]);

        // Org B should NOT see Org A's config
        $response = $this->withToken($tokenB)->getJson('/api/org/spend/config');
        $response->assertJsonPath('configs', []);

        // Org B saving cursor should create its own row, not update Org A's
        $this->withToken($tokenB)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor',
            'seat_count' => 5,
            'cost_per_seat_monthly' => 10,
        ]);

        $this->assertEquals(2, ToolCostConfig::count());
        $this->assertEquals(1, ToolCostConfig::where('organization_id', $orgA->id)->count());
        $this->assertEquals(1, ToolCostConfig::where('organization_id', $orgB->id)->count());
    }

    // ── DELETE single ──────────────────────────────────────────────

    public function test_delete_single_removes_config(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor',
            'seat_count' => 10,
            'cost_per_seat_monthly' => 20,
        ]);

        $response = $this->withToken($token)->deleteJson('/api/org/spend/config/cursor');
        $response->assertStatus(200);

        $this->assertEquals(0, ToolCostConfig::where('organization_id', $org->id)->count());
    }

    public function test_delete_single_does_not_cross_orgs(): void
    {
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $tokenA = $this->createDashboardToken($orgA);
        $tokenB = $this->createDashboardToken($orgB);

        // Both orgs have cursor config
        $this->withToken($tokenA)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor', 'seat_count' => 10, 'cost_per_seat_monthly' => 20,
        ]);
        $this->withToken($tokenB)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor', 'seat_count' => 5, 'cost_per_seat_monthly' => 10,
        ]);

        // Org A deletes cursor — Org B must still have it
        $this->withToken($tokenA)->deleteJson('/api/org/spend/config/cursor');

        $this->assertEquals(0, ToolCostConfig::where('organization_id', $orgA->id)->count());
        $this->assertEquals(1, ToolCostConfig::where('organization_id', $orgB->id)->count());
    }

    // ── DELETE all ─────────────────────────────────────────────────

    public function test_delete_all_clears_all_configs_for_org(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor', 'seat_count' => 10, 'cost_per_seat_monthly' => 20,
        ]);
        $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'devin', 'seat_count' => 5, 'cost_per_seat_monthly' => 100,
        ]);

        $response = $this->withToken($token)->deleteJson('/api/org/spend/config');
        $response->assertStatus(200);
        $response->assertJsonPath('deleted_count', 2);

        $this->assertEquals(0, ToolCostConfig::where('organization_id', $org->id)->count());
    }

    public function test_delete_all_does_not_cross_orgs(): void
    {
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();
        $tokenA = $this->createDashboardToken($orgA);
        $tokenB = $this->createDashboardToken($orgB);

        $this->withToken($tokenA)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor', 'seat_count' => 10, 'cost_per_seat_monthly' => 20,
        ]);
        $this->withToken($tokenB)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor', 'seat_count' => 5, 'cost_per_seat_monthly' => 10,
        ]);

        // Org A clears all — Org B must be untouched
        $this->withToken($tokenA)->deleteJson('/api/org/spend/config');

        $this->assertEquals(0, ToolCostConfig::where('organization_id', $orgA->id)->count());
        $this->assertEquals(1, ToolCostConfig::where('organization_id', $orgB->id)->count());
    }

    public function test_delete_all_when_empty_returns_zero(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $response = $this->withToken($token)->deleteJson('/api/org/spend/config');
        $response->assertStatus(200);
        $response->assertJsonPath('deleted_count', 0);
    }

    // ── Round trip ─────────────────────────────────────────────────

    public function test_save_read_round_trip(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        // Save multiple configs
        $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor', 'seat_count' => 10, 'cost_per_seat_monthly' => 20,
        ]);
        $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'devin', 'seat_count' => 5, 'cost_per_seat_monthly' => 500,
        ]);

        // Read back
        $response = $this->withToken($token)->getJson('/api/org/spend/config');
        $response->assertStatus(200);

        $configs = $response->json('configs');
        $this->assertCount(2, $configs);

        $total = $response->json('total_monthly_spend');
        $this->assertEquals(2700, $total); // 200 + 2500
    }

    public function test_second_admin_in_same_org_sees_persisted_configs(): void
    {
        $org = Organization::factory()->create();
        $adminToken = $this->createDashboardToken($org, 'admin');

        // First admin saves a config
        $this->withToken($adminToken)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor', 'seat_count' => 10, 'cost_per_seat_monthly' => 20,
        ]);

        // Second admin in the same organization reads the same config
        $secondAdminToken = $this->createDashboardToken($org, 'admin');
        $response = $this->withToken($secondAdminToken)->getJson('/api/org/spend/config');
        $response->assertStatus(200);
        $response->assertJsonPath('configs.0.tool_id', 'cursor');
        $response->assertJsonPath('configs.0.seat_count', 10);
        $response->assertJsonPath('configs.0.cost_per_seat_monthly', '20.00');
        $response->assertJsonPath('configs.0.monthly_spend', '200.00');
        $response->assertJsonPath('total_monthly_spend', 200);
    }

    public function test_clear_then_read_returns_empty(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org);

        $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor', 'seat_count' => 10, 'cost_per_seat_monthly' => 20,
        ]);

        $this->withToken($token)->deleteJson('/api/org/spend/config');

        $response = $this->withToken($token)->getJson('/api/org/spend/config');
        $response->assertJsonPath('configs', []);
        $response->assertJsonPath('total_monthly_spend', 0);
    }

    // ── Role gates ──────────────────────────────────────────────────

    public function test_member_cannot_create_spend_config(): void
    {
        $org = Organization::factory()->create();
        $token = $this->createDashboardToken($org, 'member');

        $this->withToken($token)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor',
            'seat_count' => 10,
            'cost_per_seat_monthly' => 20,
        ])->assertStatus(403)
          ->assertJsonPath('error', 'ADMIN_REQUIRED');

        $this->assertEquals(0, ToolCostConfig::count());
    }

    public function test_member_cannot_delete_spend_config(): void
    {
        $org = Organization::factory()->create();
        $adminToken = $this->createDashboardToken($org, 'admin');
        $memberToken = $this->createDashboardToken($org, 'member');

        $this->withToken($adminToken)->putJson('/api/org/spend/config', [
            'tool_id' => 'cursor',
            'seat_count' => 10,
            'cost_per_seat_monthly' => 20,
        ])->assertStatus(200);

        $this->withToken($memberToken)->deleteJson('/api/org/spend/config/cursor')
            ->assertStatus(403)
            ->assertJsonPath('error', 'ADMIN_REQUIRED');

        $this->assertEquals(1, ToolCostConfig::where('organization_id', $org->id)->count());
    }
}
