<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use App\Models\User;
use App\Models\Organization;
use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Traits\PilotAwareTokenHelper;

class OrganizationController extends Controller
{
    use PilotAwareTokenHelper;

    /**
     * Resolve the acting user from the request's authenticated_user (set by SimpleTokenAuth).
     * No fallbacks — the middleware must supply a valid request-bound credential.
     */
    private function resolveActingUser(Request $request)
    {
        return $request->get('authenticated_user');
    }

    /**
     * Get users in current organization
     * 
     * Returns users in the authenticated user's organization
     * MVP: Simple implementation without complex permissions
     * 
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function users(Request $request)
    {
        try {
            // Resolve the acting user from the request or fall back to the pilot admin
            $user = $this->resolveActingUser($request);
            
            if (!$user || !$user->organization_id) {
                return response()->json([
                    'error' => 'User not found or has no organization',
                    'message' => 'Cannot determine organization for user management'
                ], 403);
            }

            // Get organization info
            $organization = DB::table('organizations')
                ->where('id', $user->organization_id)
                ->first();

            if (!$organization) {
                return response()->json([
                    'error' => 'Organization not found',
                    'message' => 'Organization does not exist'
                ], 404);
            }

            // Get users in the organization (active users)
            $activeUsers = DB::table('users')
                ->where('organization_id', $user->organization_id)
                ->select([
                    'id',
                    'name',
                    'email',
                    'github_id',
                    'role',
                    'created_at',
                    'updated_at'
                ])
                ->orderBy('name')
                ->get();

            // Get pending invites for the organization.
            // NOTE: token is intentionally NOT selected — invite secrets are
            // never emitted in roster payloads. Recovery goes through the
            // admin-only reissue/accept-link endpoints on InviteController.
            $pendingInvites = DB::table('invites')
                ->where('organization_id', $user->organization_id)
                ->where('redeemed_at', null) // Only unredeemed invites
                ->where('expires_at', '>', now()) // Only non-expired invites
                ->select([
                    'id',
                    'email',
                    'role',
                    'expires_at',
                    'created_at'
                ])
                ->orderBy('created_at', 'desc')
                ->get();

            // Preload connect codes and installation counts for pending invites.
            // PILOT OPS 18H: used_at is non-authoritative legacy state and plays
            // no part in lifecycle. Closed codes split into revoked (explicit
            // admin action — the revoked sentinel) vs expired (legacy natural
            // expiry on pre-18H rows).
            $validCodes = collect([]);
            $expiredCodes = collect([]);
            $revokedCodes = collect([]);
            if ($pendingInvites->isNotEmpty()) {
                $allCodes = IDEConnectCode::whereIn('invite_id', $pendingInvites->pluck('id')->toArray())
                    ->get();

                $now = now();
                $validCodes = $allCodes->filter(fn ($c) => $c->expires_at !== null && $c->expires_at > $now)->keyBy('invite_id');
                $closedCodes = $allCodes->filter(fn ($c) => $c->expires_at !== null && $c->expires_at <= $now)->sortBy('id')->keyBy('invite_id');
                $revokedCodes = $closedCodes->filter(fn ($c) => $c->isRevoked());
                $expiredCodes = $closedCodes->reject(fn ($c) => $c->isRevoked());

                $installationCounts = DB::table('api_tokens')
                    ->select('invite_id', DB::raw('COUNT(DISTINCT installation_id) as installation_count'))
                    ->whereIn('invite_id', $pendingInvites->pluck('id')->toArray())
                    ->whereNull('revoked_at')
                    ->groupBy('invite_id')
                    ->get()
                    ->keyBy('invite_id');
            } else {
                $installationCounts = collect([]);
            }

            // K1B: cohort membership for pending (invite-backed) developers.
            // Server-authoritative; scoped to this organization only.
            $cohortMemberships = collect([]);
            if ($pendingInvites->isNotEmpty()) {
                $cohortMemberships = \App\Models\CohortMember::whereIn('invite_id', $pendingInvites->pluck('id')->toArray())
                    ->with('cohort:id,name')
                    ->get()
                    ->keyBy('invite_id');
            }

            // Combine active users and pending invites
            $allMembers = [];

            // Add active users
            foreach ($activeUsers as $activeUser) {
                $allMembers[] = [
                    'id' => $activeUser->id,
                    'name' => $activeUser->name,
                    'email' => $activeUser->email,
                    'github_id' => $activeUser->github_id,
                    'role' => $activeUser->role ?? 'member',
                    'status' => 'active',
                    'cohort_id' => null,
                    'cohort_name' => null,
                    'created_at' => $activeUser->created_at,
                    'updated_at' => $activeUser->updated_at
                ];
            }

            // Add pending invites
            foreach ($pendingInvites as $invite) {
                $validCode = $validCodes->get($invite->id);
                $revokedCode = $revokedCodes->get($invite->id);
                $expiredCode = $expiredCodes->get($invite->id);
                // Prefer the valid code for display; fall back to the closed code
                // so the admin can see that a code was issued but is closed.
                $code = $validCode ?? $revokedCode ?? $expiredCode;
                $installationCount = (int) ($installationCounts->get($invite->id)?->installation_count ?? 0);

                // PILOT OPS 18H: enrollment-status authority
                //   connected     — ≥1 active (non-revoked) installation linked to the invite
                //   ready         — a live (non-expired) connect code exists
                //   revoked       — the code was explicitly revoked by an admin
                //   expired       — legacy natural expiry (pre-18H rows only;
                //                   new enrollment codes never expire)
                //   not_generated — no connect code has ever been issued
                if ($installationCount > 0) {
                    $enrollmentStatus = 'connected';
                } elseif ($validCode) {
                    $enrollmentStatus = 'ready';
                } elseif ($revokedCode) {
                    $enrollmentStatus = 'revoked';
                } elseif ($expiredCode) {
                    $enrollmentStatus = 'expired';
                } else {
                    $enrollmentStatus = 'not_generated';
                }

                // Pending dashboard invites and pending developer enrollments
                // share the invites table. A code-backed invite or one carrying
                // the non-expiring enrollment sentinel is a developer
                // enrollment; anything else is a dashboard-user invite and must
                // render in the Dashboard Users section, not the enrollment
                // roster, where "Generate code" would wrongly convert it.
                $isEnrollmentInvite = $code !== null
                    || $invite->expires_at === Invite::ENROLLMENT_NEVER_EXPIRES;

                $allMembers[] = [
                    'id' => null, // No user ID yet
                    'name' => $invite->email, // Use email as name for pending users
                    'email' => $invite->email ?? 'Pending invitation',
                    'github_id' => null,
                    'role' => $invite->role ?? 'member', // Intended role from the invite
                    'status' => 'pending',
                    'invite_id' => $invite->id,
                    'invite_kind' => $isEnrollmentInvite ? 'enrollment' : 'dashboard',
                    'cohort_id' => $cohortMemberships->get($invite->id)?->cohort_id,
                    'cohort_name' => $cohortMemberships->get($invite->id)?->cohort?->name,
                    'invite_expires_at' => $invite->expires_at,
                    'has_connect_code' => $code !== null,
                    'has_valid_connect_code' => $validCode !== null,
                    'connect_code_expired' => $validCode === null && $revokedCode === null && $expiredCode !== null,
                    'connect_code_revoked' => $validCode === null && $revokedCode !== null,
                    'connect_code_expires_at' => $code?->expires_at?->toISOString() ?? null,
                    'installation_count' => $installationCount,
                    'enrollment_status' => $enrollmentStatus,
                    'created_at' => $invite->created_at,
                    'updated_at' => $invite->created_at
                ];
            }

            Log::info('[OrganizationController] Retrieved organization users and pending invites', [
                'organization_id' => $user->organization_id,
                'active_users' => $activeUsers->count(),
                'pending_invites' => $pendingInvites->count(),
                'total_members' => count($allMembers),
                'requesting_user_id' => $user->id
            ]);

            return response()->json([
                'organization' => [
                    'id' => $organization->id,
                    'name' => $organization->name,
                    'slug' => $organization->slug,
                ],
                'users' => $allMembers,
                'current_user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'organization_id' => $user->organization_id,
                    'role' => $user->role ?? 'admin'
                ],
                'meta' => [
                    'total_users' => $activeUsers->count(),
                    'pending_invites' => $pendingInvites->count(),
                    'total_members' => count($allMembers),
                    'current_user_role' => $user->role ?? 'admin',
                    'permissions' => [
                        'can_manage_users' => ($user->role ?? 'admin') === 'admin',
                        'can_view_analytics' => true,
                        'can_manage_billing' => false, // MVP: not implemented
                    ]
                ]
            ]);

        } catch (\Throwable $e) {
            Log::error('[OrganizationController] Failed to retrieve organization users', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'error' => 'Internal server error',
                'message' => 'Failed to retrieve organization users'
            ], 500);
        }
    }

    /**
     * Delete a user from organization.
     */
    public function destroy($id)
    {
        try {
            $user = User::findOrFail($id);
            
            if ($user->organization_id !== auth()->user()->organization_id) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot delete user from different organization'
                ], 403);
            }
            
            // Don't allow users to delete themselves
            if ($user->id === auth()->user()->id) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot delete yourself from organization'
                ], 400);
            }
            
            $user->delete();
            
            return response()->json([
                'success' => true,
                'message' => 'User deleted successfully'
            ]);
        } catch (Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete user: ' . $e->getMessage()
            ], 500);
        }
    }
/**
     * Update user role in organization
     * 
     * MVP: Simple role updates (admin/member)
     * TODO: Implement proper role system in database
     * 
     * @param Request $request
     * @param int $targetUserId
     * @return \Illuminate\Http\JsonResponse
     */
    public function updateUserRole(Request $request, int $targetUserId)
    {
        try {
            // Validate request
            $validated = $request->validate([
                'role' => 'required|string|in:admin,member',
            ], [
                'role.required' => 'Role is required',
                'role.in' => 'Role must be either admin or member'
            ]);

            // Resolve the acting user from the request or fall back to the pilot admin
            $currentUser = $this->resolveActingUser($request);
            
            if (!$currentUser || !$currentUser->organization_id) {
                return response()->json([
                    'error' => 'User not found or has no organization',
                    'message' => 'Cannot determine organization for role management'
                ], 403);
            }

            // Only admins can manage roles
            if (($currentUser->role ?? 'admin') !== 'admin') {
                return response()->json([
                    'error' => 'Insufficient permissions',
                    'message' => 'Only organization admins can update user roles'
                ], 403);
            }

            // Find target user in same organization
            $targetUser = DB::table('users')
                ->where('id', $targetUserId)
                ->where('organization_id', $currentUser->organization_id)
                ->first();

            if (!$targetUser) {
                return response()->json([
                    'error' => 'User not found',
                    'message' => 'Target user does not exist or is not in your organization'
                ], 404);
            }

            // MVP: Prevent self-role modification
            if ($targetUser->id === $currentUser->id) {
                return response()->json([
                    'error' => 'Cannot modify own role',
                    'message' => 'Users cannot modify their own role'
                ], 400);
            }

            // CR-X: Last-admin guard — prevent demoting the last admin
            if (($targetUser->role ?? 'member') === 'admin' && $validated['role'] !== 'admin') {
                $adminCount = DB::table('users')
                    ->where('organization_id', $currentUser->organization_id)
                    ->where('role', 'admin')
                    ->count();
                if ($adminCount <= 1) {
                    return response()->json([
                        'error' => 'Last admin',
                        'message' => 'Cannot demote the last admin of the organization'
                    ], 400);
                }
            }

            // CR-X: role column exists (2026_03_24_172551_add_role_to_users_table).
            // Persist the role change — this was previously log-only, which meant
            // the UI showed a false "Role updated" success message while the
            // database (and thus the actual permission) never changed.
            DB::table('users')
                ->where('id', $targetUser->id)
                ->update(['role' => $validated['role']]);

            Log::info('[OrganizationController] Role updated', [
                'organization_id' => $currentUser->organization_id,
                'current_user_id' => $currentUser->id,
                'target_user_id' => $targetUser->id,
                'target_user_name' => $targetUser->name,
                'new_role' => $validated['role'],
            ]);

            return response()->json([
                'message' => 'Role updated',
                'user' => [
                    'id' => $targetUser->id,
                    'name' => $targetUser->name,
                    'email' => $targetUser->email,
                    'role' => $validated['role'],
                ],
                'organization_id' => $currentUser->organization_id,
            ]);

        } catch (\Illuminate\Validation\ValidationException $e) {
            Log::warning('[OrganizationController] Role update validation failed', [
                'errors' => $e->errors(),
                'target_user_id' => $targetUserId
            ]);

            return response()->json([
                'error' => 'Validation failed',
                'message' => 'Invalid role provided',
                'errors' => $e->errors()
            ], 422);

        } catch (\Throwable $e) {
            Log::error('[OrganizationController] Failed to update user role', [
                'error' => $e->getMessage(),
                'target_user_id' => $targetUserId,
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'error' => 'Internal server error',
                'message' => 'Failed to update user role'
            ], 500);
        }
    }

    /**
     * Delete a user from organization.
     * CR-X multi-admin: fixed signature, added admin-role check and last-admin guard.
     */
    public function deleteUser(Request $request, $id)
    {
        try {
            $currentUser = $this->resolveActingUser($request);

            if (!$currentUser || !$currentUser->organization_id) {
                return response()->json([
                    'success' => false,
                    'message' => 'User not found or has no organization'
                ], 403);
            }

            // CR-X: Only admins can delete users
            if (($currentUser->role ?? 'admin') !== 'admin') {
                return response()->json([
                    'success' => false,
                    'message' => 'Only organization admins can remove users'
                ], 403);
            }

            $user = User::findOrFail($id);

            if ($user->organization_id !== $currentUser->organization_id) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot delete user from different organization'
                ], 403);
            }

            // Don't allow users to delete themselves
            if ($user->id === $currentUser->id) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot delete yourself from organization'
                ], 400);
            }

            // CR-X: Last-admin guard — prevent removing the last admin
            if (($user->role ?? 'member') === 'admin') {
                $adminCount = DB::table('users')
                    ->where('organization_id', $currentUser->organization_id)
                    ->where('role', 'admin')
                    ->count();
                if ($adminCount <= 1) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Cannot remove the last admin of the organization'
                    ], 400);
                }
            }

            $user->delete();

            return response()->json([
                'success' => true,
                'message' => 'User deleted successfully'
            ]);
        } catch (Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete user: ' . $e->getMessage()
            ], 500);
        }
    }
}
