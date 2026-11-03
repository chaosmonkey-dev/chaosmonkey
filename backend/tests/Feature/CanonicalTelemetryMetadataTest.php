<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Organization;
use App\Models\TelemetryEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class CanonicalTelemetryMetadataTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $org = Organization::create([
            'name' => 'ChaosMonkey',
            'slug' => 'chaosmonkey',
        ]);
        $user = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);
        $this->dashboardToken = ApiToken::generateDashboardToken($user->id, $org->id)['raw'];
    }

    private string $dashboardToken;

    private function createSessionEvent(string $source, ?string $editorSource = null, array $metadata = []): TelemetryEvent
    {
        $org = Organization::where('slug', 'chaosmonkey')->first();
        return TelemetryEvent::create([
            'user_id' => 'test-user',
            'organization_id' => $org?->id,
            'source' => $source,
            'editor_source' => $editorSource,
            'event_type' => 'session',
            'duration_ms' => 60000,
            'timestamp' => now()->subDay(),
            'metadata' => array_merge(['segment_type' => 'session'], $metadata),
            'payload' => [],
            'batch_hash' => hash('sha256', Str::random(64)),
        ]);
    }

    public function test_claude_code_bridge_sessions_counted_in_claude_code_metadata(): void
    {
        $this->createSessionEvent('vscode', 'claude-code', ['extension_version' => '0.3.7-cc-bridge']);
        $this->createSessionEvent('vscode', 'claude_code');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        $this->assertEquals(2, $meta['canonical_population_count']);
        $this->assertArrayHasKey('claude_code', $meta['session_count_by_tool']);
        $this->assertEquals(2, $meta['session_count_by_tool']['claude_code']);
    }

    public function test_claude_code_bridge_sessions_excluded_from_vscode_metadata(): void
    {
        $this->createSessionEvent('vscode', 'claude-code', ['extension_version' => '0.3.7-cc-bridge']);
        $this->createSessionEvent('vscode', 'vscode');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        $this->assertEquals(2, $meta['canonical_population_count']);
        $this->assertEquals(1, $meta['session_count_by_tool']['claude_code']);
        $this->assertEquals(1, $meta['session_count_by_tool']['vscode']);
    }

    public function test_native_vscode_remains_present(): void
    {
        $this->createSessionEvent('vscode', 'vscode');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        $this->assertArrayHasKey('vscode', $meta['session_count_by_tool']);
        $this->assertEquals(1, $meta['session_count_by_tool']['vscode']);
    }

    public function test_native_devin_remains_separate_from_windsurf(): void
    {
        $this->createSessionEvent('devin', 'devin');
        $this->createSessionEvent('windsurf', 'windsurf');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        $this->assertArrayHasKey('devin', $meta['session_count_by_tool']);
        $this->assertArrayHasKey('windsurf', $meta['session_count_by_tool']);
        $this->assertEquals(1, $meta['session_count_by_tool']['devin']);
        $this->assertEquals(1, $meta['session_count_by_tool']['windsurf']);
    }

    public function test_population_count_equals_sum_of_session_count_by_tool(): void
    {
        $this->createSessionEvent('vscode', 'claude-code');
        $this->createSessionEvent('vscode', 'vscode');
        $this->createSessionEvent('cursor', 'cursor');
        $this->createSessionEvent('devin', 'devin');
        $this->createSessionEvent('windsurf', 'windsurf');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        $sum = array_sum($meta['session_count_by_tool']);
        $this->assertEquals($meta['canonical_population_count'], $sum);
    }

    public function test_sessions_and_aggregated_metadata_agree(): void
    {
        $this->createSessionEvent('vscode', 'claude-code');
        $this->createSessionEvent('vscode', 'vscode');

        $sessResponse = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=sessions&tools=all&per_page=200');
        $aggResponse = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all');

        $sessResponse->assertStatus(200);
        $aggResponse->assertStatus(200);

        $sessMeta = $sessResponse->json('metadata');
        $aggMeta = $aggResponse->json('metadata');

        $this->assertEquals($sessMeta['canonical_population_count'], $aggMeta['canonical_population_count']);
        $this->assertEquals($sessMeta['session_count_by_tool'], $aggMeta['session_count_by_tool']);
        $this->assertEquals($sessMeta['tools_in_population'], $aggMeta['tools_in_population']);
    }

    public function test_tools_in_population_contains_only_positive_count_tools(): void
    {
        $this->createSessionEvent('vscode', 'vscode');
        $this->createSessionEvent('cursor', 'cursor');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        foreach ($meta['tools_in_population'] as $tool) {
            $this->assertGreaterThan(0, $meta['session_count_by_tool'][$tool]);
        }
    }

    public function test_no_session_counted_twice(): void
    {
        $this->createSessionEvent('vscode', 'claude-code');
        $this->createSessionEvent('vscode', 'claude_code');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        $this->assertEquals(2, $meta['canonical_population_count']);
        $this->assertEquals(2, $meta['session_count_by_tool']['claude_code']);
        $sum = array_sum($meta['session_count_by_tool']);
        $this->assertEquals(2, $sum);
    }

    public function test_filtered_request_preserves_invariant(): void
    {
        $this->createSessionEvent('vscode', 'claude-code');
        $this->createSessionEvent('vscode', 'vscode');
        $this->createSessionEvent('cursor', 'cursor');

        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=claude_code');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        $sum = array_sum($meta['session_count_by_tool']);
        $this->assertEquals($meta['canonical_population_count'], $sum);
    }

    public function test_empty_population_returns_zero_and_empty_tool_list(): void
    {
        $response = $this->withHeaders(['Authorization' => 'Bearer ' . $this->dashboardToken])->getJson('/api/telemetry/canonical?from=2000-01-01&to=2099-12-31&format=aggregated&period=week&tools=all');

        $response->assertStatus(200);
        $meta = $response->json('metadata');
        $this->assertEquals(0, $meta['canonical_population_count']);
        $this->assertEquals([], $meta['tools_in_population']);
        $this->assertEquals([], $meta['session_count_by_tool']);
    }
}
