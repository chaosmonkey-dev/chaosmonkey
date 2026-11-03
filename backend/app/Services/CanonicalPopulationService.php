<?php

namespace App\Services;

use App\Models\TelemetryEvent;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

/**
 * CR-X Gate B: Shared canonical population authority.
 *
 * This service provides the SINGLE canonical product-health population
 * used by both /api/telemetry/canonical (PBT/dashboard) and
 * /api/pilot/health (Pilot Health Product Availability).
 *
 * Membership semantics (must be identical across all consumers):
 *   1. event_type = 'session'
 *   2. json_extract(metadata, '$.segment_type') = 'session'
 *   3. Time window: 2020-01-01 to now (all historical by default)
 *   4. Organization scope: all orgs in Local Lab mode, org-scoped otherwise
 *
 * Workflow normalization for canonical workflow COUNT:
 *   - windsurf → devin (shared bucket)
 *   - unknown, extension, test-browser → excluded
 *   - claude-code/claude_code → claude_code
 *   - visual-studio-code → vscode
 *   - GitHub Copilot variants → github_copilot
 *
 * Active Sources and Telemetry Freshness intentionally use RAW counts
 * (no normalization, no exclusion) and may differ from canonical.
 */
class CanonicalPopulationService
{
    /**
     * Build the canonical session population query (shared authority).
     *
     * @param int|null $orgId Organization ID (null for Local Lab all-orgs mode)
     * @param string|null $from ISO date or null for 2020-01-01
     * @param string|null $to ISO date or null for now
     * @return Builder
     */
    public function buildCanonicalSessionQuery(?int $orgId = null, ?string $from = null, ?string $to = null): Builder
    {
        $query = DB::table('telemetry_events')
            ->where('event_type', 'session')
            ->whereRaw("json_extract(metadata, '$.segment_type') = 'session'");

        // Time window
        $fromDate = $from ? Carbon::parse($from) : Carbon::parse('2020-01-01');
        $toDate = $to ? Carbon::parse($to) : Carbon::now();
        $query->whereBetween('timestamp', [$fromDate, $toDate]);

        // Organization scope
        $isLocalLab = config('app.env') === 'local';
        if ($isLocalLab) {
            // Local Lab: include all organizations
        } elseif ($orgId) {
            $query->where('organization_id', $orgId);
        } else {
            // Fail closed
            $query->whereRaw('1 = 0');
        }

        return $query;
    }

    /**
     * Get the canonical session population count.
     * This is the SAME count as /api/telemetry/canonical canonical_population_count.
     *
     * @param int|null $orgId
     * @return int
     */
    public function getCanonicalSessionCount(?int $orgId = null): int
    {
        return (int) $this->buildCanonicalSessionQuery($orgId)->count();
    }

    /**
     * Get the canonical workflow count (normalized, excluding non-canonical sources).
     *
     * @param int|null $orgId
     * @return int
     */
    public function getCanonicalWorkflowCount(?int $orgId = null): int
    {
        $sources = $this->buildCanonicalSessionQuery($orgId)
            ->whereNotNull('editor_source')
            ->select('editor_source')
            ->distinct()
            ->pluck('editor_source');

        $canonicalWorkflows = [];
        foreach ($sources as $source) {
            $normalized = $this->normalizeCanonicalWorkflow($source);
            if ($normalized !== null && !in_array($normalized, $canonicalWorkflows)) {
                $canonicalWorkflows[] = $normalized;
            }
        }

        return count($canonicalWorkflows);
    }

    /**
     * Get both canonical session count and workflow count in one call.
     *
     * @param int|null $orgId
     * @return array{session_count: int, workflow_count: int}
     */
    public function getCanonicalPopulation(?int $orgId = null): array
    {
        return [
            'session_count' => $this->getCanonicalSessionCount($orgId),
            'workflow_count' => $this->getCanonicalWorkflowCount($orgId),
        ];
    }

    /**
     * Normalize a raw editor_source to a canonical workflow ID.
     * Returns null for sources that are NOT canonical product workflows.
     *
     * @param string|null $source
     * @return string|null
     */
    public function normalizeCanonicalWorkflow(?string $source): ?string
    {
        if (!$source) return null;

        $lower = strtolower(trim($source));

        // Exclude non-canonical sources
        $excluded = ['unknown', 'extension', 'test-browser', 'test_browser', 'testbrowser'];
        if (in_array($lower, $excluded)) return null;

        // Empty or generic
        if ($lower === '' || $lower === 'null') return null;

        // Windsurf → Devin (shared bucket)
        if ($lower === 'windsurf') return 'devin';

        // Claude Code variants
        if (in_array($lower, ['claude-code', 'claude_code', 'claudecode'])) return 'claude_code';

        // VS Code variants
        if (in_array($lower, ['visual-studio-code', 'vs-code', 'vscode'])) return 'vscode';

        // GitHub Copilot variants
        if (in_array($lower, ['github-copilot', 'github_copilot', 'copilot', 'github copilot'])) return 'github_copilot';

        // Cursor, Devin, and other known workflows pass through
        if (in_array($lower, ['cursor', 'devin'])) return $lower;

        // Unknown but non-empty: exclude from canonical
        return null;
    }
}
