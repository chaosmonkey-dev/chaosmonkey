<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use App\Models\ToolCostConfig;

class SpendController extends Controller
{
    /**
     * Canonical cost tool IDs allowed for persistence.
     * Must match frontend COST_SUPPORTED_TOOLS.
     */
    private const ALLOWED_TOOL_IDS = [
        'cursor', 'devin', 'vscode', 'claude-code', 'github-copilot',
    ];

    /**
     * Resolve the acting user from the request's authenticated_user (set by SimpleTokenAuth).
     */
    private function resolveActingUser(Request $request)
    {
        return $request->get('authenticated_user');
    }

    /**
     * GET /api/org/spend/config — return all tool cost configs for the authenticated org.
     */
    public function index(Request $request)
    {
        try {
            $user = $this->resolveActingUser($request);

            if (!$user || !$user->organization_id) {
                return response()->json([
                    'error' => 'User not found or has no organization',
                    'message' => 'Cannot determine organization for spend configuration'
                ], 403);
            }

            $configs = ToolCostConfig::where('organization_id', $user->organization_id)
                ->orderBy('tool_id')
                ->get();

            return response()->json([
                'organization_id' => $user->organization_id,
                'configs' => $configs,
                'total_monthly_spend' => $configs->sum(function ($c) {
                    return (float) $c->monthly_spend;
                }),
            ]);
        } catch (\Throwable $e) {
            Log::error('[SpendController] Failed to retrieve spend configs', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'error' => 'Internal server error',
                'message' => 'Failed to retrieve spend configurations'
            ], 500);
        }
    }

    /**
     * PUT /api/org/spend/config — upsert a tool cost config for the org.
     */
    public function update(Request $request)
    {
        try {
            $validated = $request->validate([
                'tool_id' => 'required|string|in:cursor,devin,vscode,claude-code,github-copilot,codex',
                'tool_name' => 'nullable|string',
                'seat_count' => 'integer|min:0',
                'cost_per_seat_monthly' => 'numeric|min:0',
            ]);

            $user = $this->resolveActingUser($request);

            if (!$user || !$user->organization_id) {
                return response()->json([
                    'error' => 'User not found or has no organization',
                    'message' => 'Cannot determine organization for spend configuration'
                ], 403);
            }

            // Pilot Ops 12: cost configuration is admin-only
            if (($user->role ?? 'member') !== 'admin') {
                return response()->json([
                    'error' => 'ADMIN_REQUIRED',
                    'message' => 'Only organization admins can configure costs.',
                ], 403);
            }

            $seatCount = (int) ($validated['seat_count'] ?? 0);
            $costPerSeat = (float) ($validated['cost_per_seat_monthly'] ?? 0);
            $monthlySpend = round($seatCount * $costPerSeat, 2);

            $config = ToolCostConfig::updateOrCreate(
                [
                    'organization_id' => $user->organization_id,
                    'tool_id' => $validated['tool_id'],
                ],
                [
                    'tool_name' => $validated['tool_name'] ?? null,
                    'seat_count' => $seatCount,
                    'cost_per_seat_monthly' => $costPerSeat,
                    'monthly_spend' => $monthlySpend,
                    'configured_at' => now(),
                    'configured_by' => $user->id,
                ]
            );

            Log::info('[SpendController] Upserted tool cost config', [
                'organization_id' => $user->organization_id,
                'tool_id' => $validated['tool_id'],
                'seat_count' => $seatCount,
                'cost_per_seat_monthly' => $costPerSeat,
                'monthly_spend' => $monthlySpend,
                'configured_by' => $user->id,
            ]);

            return response()->json([
                'message' => 'Tool cost configuration saved',
                'config' => $config,
            ], 200);
        } catch (\Illuminate\Validation\ValidationException $e) {
            return response()->json([
                'error' => 'Validation failed',
                'message' => 'Invalid spend configuration provided',
                'errors' => $e->errors()
            ], 422);
        } catch (\Throwable $e) {
            Log::error('[SpendController] Failed to upsert spend config', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'error' => 'Internal server error',
                'message' => 'Failed to save spend configuration'
            ], 500);
        }
    }

    /**
     * DELETE /api/org/spend/config/{tool_id} — delete a tool cost config.
     */
    public function destroy(Request $request, $tool_id)
    {
        try {
            $user = $this->resolveActingUser($request);

            if (!$user || !$user->organization_id) {
                return response()->json([
                    'error' => 'User not found or has no organization',
                    'message' => 'Cannot determine organization for spend configuration'
                ], 403);
            }

            // Pilot Ops 12: cost configuration is admin-only
            if (($user->role ?? 'member') !== 'admin') {
                return response()->json([
                    'error' => 'ADMIN_REQUIRED',
                    'message' => 'Only organization admins can configure costs.',
                ], 403);
            }

            $deleted = ToolCostConfig::where('organization_id', $user->organization_id)
                ->where('tool_id', $tool_id)
                ->delete();

            if (!$deleted) {
                return response()->json([
                    'error' => 'Not found',
                    'message' => 'No tool cost configuration found for tool_id: ' . $tool_id
                ], 404);
            }

            Log::info('[SpendController] Deleted tool cost config', [
                'organization_id' => $user->organization_id,
                'tool_id' => $tool_id,
                'deleted_by' => $user->id,
            ]);

            return response()->json([
                'message' => 'Tool cost configuration deleted',
                'tool_id' => $tool_id,
            ]);
        } catch (\Throwable $e) {
            Log::error('[SpendController] Failed to delete spend config', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'error' => 'Internal server error',
                'message' => 'Failed to delete spend configuration'
            ], 500);
        }
    }

    /**
     * DELETE /api/org/spend/config — clear ALL tool cost configs for the authenticated org.
     */
    public function destroyAll(Request $request)
    {
        try {
            $user = $this->resolveActingUser($request);

            if (!$user || !$user->organization_id) {
                return response()->json([
                    'error' => 'User not found or has no organization',
                    'message' => 'Cannot determine organization for spend configuration'
                ], 403);
            }

            // Pilot Ops 12: cost configuration is admin-only
            if (($user->role ?? 'member') !== 'admin') {
                return response()->json([
                    'error' => 'ADMIN_REQUIRED',
                    'message' => 'Only organization admins can configure costs.',
                ], 403);
            }

            $deleted = ToolCostConfig::where('organization_id', $user->organization_id)->delete();

            Log::info('[SpendController] Cleared all tool cost configs', [
                'organization_id' => $user->organization_id,
                'deleted_count' => $deleted,
                'deleted_by' => $user->id,
            ]);

            return response()->json([
                'message' => 'All tool cost configurations deleted',
                'deleted_count' => $deleted,
            ]);
        } catch (\Throwable $e) {
            Log::error('[SpendController] Failed to clear all spend configs', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'error' => 'Internal server error',
                'message' => 'Failed to clear spend configurations'
            ], 500);
        }
    }
}
