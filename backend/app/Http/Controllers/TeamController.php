<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

class TeamController extends Controller
{
    /**
     * Get users belonging to the authenticated user's organization.
     *
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function index(Request $request): JsonResponse
    {
        $user = Auth::user();
        if (!$user || !$user->organization_id) {
            Log::warning('TeamController: User not associated with organization', [
                'user_id' => $user?->id,
                'organization_id' => $user?->organization_id
            ]);
            
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }

        try {
            $members = User::where('organization_id', $user->organization_id)
                ->select(['id', 'name', 'email', 'created_at'])
                ->orderBy('created_at', 'desc')
                ->paginate($request->input('per_page', 20));

            Log::info('TeamController: Retrieved organization members', [
                'organization_id' => $user->organization_id,
                'member_count' => $members->total()
            ]);

            return response()->json([
                'members' => $members->items(),
                'pagination' => [
                    'current_page' => $members->currentPage(),
                    'per_page' => $members->perPage(),
                    'total' => $members->total(),
                    'last_page' => $members->lastPage(),
                ]
            ]);
        } catch (\Throwable $e) {
            Log::error('TeamController: Failed to retrieve organization members', [
                'organization_id' => $user->organization_id,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json(['error' => 'Failed to retrieve team members'], 500);
        }
    }
}
