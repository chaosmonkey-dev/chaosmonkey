<?php

namespace App\Http\Controllers;

use App\Models\Cohort;
use App\Models\CohortMember;
use App\Models\Invite;
use App\Services\CohortMembershipService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * Organization-scoped cohort management (K1A).
 *
 * Cohorts group invite-backed developer identities (invite:<id>) for
 * organization analytics. All organization authority derives from the
 * authenticated user — never from request parameters. Mutations require
 * an explicitly-admin role and fail closed on missing/null role (this
 * intentionally does NOT reuse InviteController::requireAdmin, which
 * defaults a missing role to admin).
 */
class CohortController extends Controller
{
    private function resolveActingUser(Request $request): mixed
    {
        return $request->get('authenticated_user');
    }

    /**
     * Fail-closed admin guard for cohort mutations: only role === 'admin'
     * passes; missing/null/unknown roles are denied.
     */
    private function requireCohortAdmin(Request $request): ?JsonResponse
    {
        $user = $this->resolveActingUser($request);
        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }
        if ($user->role !== 'admin') {
            return response()->json([
                'error' => 'Insufficient permissions',
                'message' => 'Only organization admins can manage cohorts',
            ], 403);
        }
        return null;
    }

    /**
     * Org-scoped cohort lookup. Cross-organization identifiers resolve to
     * null → 404, so cohort existence in another org is never revealed.
     */
    private function findOrgCohort(int $organizationId, int|string $cohortId): ?Cohort
    {
        return Cohort::forOrganization($organizationId)->where('id', $cohortId)->first();
    }

    private function cohortNameTaken(int $organizationId, string $name, ?int $exceptCohortId = null): bool
    {
        return Cohort::forOrganization($organizationId)
            ->when($exceptCohortId, fn ($q) => $q->where('id', '!=', $exceptCohortId))
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
            ->exists();
    }

    private function serializeCohort(Cohort $cohort): array
    {
        return [
            'id' => $cohort->id,
            'name' => $cohort->name,
            'description' => $cohort->description,
            'archived_at' => $cohort->archived_at?->toISOString(),
            'member_count' => $cohort->members()->count(),
            'created_at' => $cohort->created_at?->toISOString(),
            'updated_at' => $cohort->updated_at?->toISOString(),
        ];
    }

    /**
     * GET /api/org/cohorts — list all cohorts (active + archived) for the
     * authenticated user's organization. Any authenticated org member may
     * read; this is dashboard metadata, not telemetry.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $this->resolveActingUser($request);
        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }

        $cohorts = Cohort::forOrganization((int) $user->organization_id)
            ->orderByRaw('LOWER(name)')
            ->get()
            ->map(fn (Cohort $c) => $this->serializeCohort($c));

        return response()->json(['cohorts' => $cohorts]);
    }

    /**
     * POST /api/org/cohorts — create a cohort (admin only).
     */
    public function store(Request $request): JsonResponse
    {
        if ($guard = $this->requireCohortAdmin($request)) return $guard;

        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            'description' => 'nullable|string|max:1000',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()], 422);
        }

        $user = $this->resolveActingUser($request);
        $organizationId = (int) $user->organization_id;
        $name = trim($request->input('name'));

        if ($this->cohortNameTaken($organizationId, $name)) {
            return response()->json([
                'error' => 'A cohort with this name already exists',
                'error_code' => 'DUPLICATE_COHORT_NAME',
            ], 422);
        }

        $cohort = Cohort::create([
            'organization_id' => $organizationId,
            'name' => $name,
            'description' => $request->input('description'),
            'created_by' => $user->id,
        ]);

        return response()->json(['cohort' => $this->serializeCohort($cohort)], 201);
    }

    /**
     * PATCH /api/org/cohorts/{cohort} — rename/update (admin only).
     * Archived cohorts are frozen and reject updates.
     */
    public function update(Request $request, int|string $cohort): JsonResponse
    {
        if ($guard = $this->requireCohortAdmin($request)) return $guard;

        $user = $this->resolveActingUser($request);
        $cohort = $this->findOrgCohort((int) $user->organization_id, $cohort);
        if (!$cohort) {
            return response()->json(['error' => 'Cohort not found'], 404);
        }
        if ($cohort->isArchived()) {
            return response()->json([
                'error' => 'Archived cohorts cannot be modified',
                'error_code' => 'COHORT_ARCHIVED',
            ], 422);
        }

        $validator = Validator::make($request->all(), [
            'name' => 'sometimes|required|string|max:255',
            'description' => 'nullable|string|max:1000',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()], 422);
        }

        if ($request->has('name')) {
            $name = trim($request->input('name'));
            if ($this->cohortNameTaken((int) $user->organization_id, $name, $cohort->id)) {
                return response()->json([
                    'error' => 'A cohort with this name already exists',
                    'error_code' => 'DUPLICATE_COHORT_NAME',
                ], 422);
            }
            $cohort->name = $name;
        }
        if ($request->has('description')) {
            $cohort->description = $request->input('description');
        }
        $cohort->save();

        return response()->json(['cohort' => $this->serializeCohort($cohort)]);
    }

    /**
     * POST /api/org/cohorts/{cohort}/archive — archive (admin only).
     * Membership rows persist (audit); the cohort can no longer receive
     * assignments or be selected as an active filter. Idempotent.
     */
    public function archive(Request $request, int|string $cohort): JsonResponse
    {
        if ($guard = $this->requireCohortAdmin($request)) return $guard;

        $user = $this->resolveActingUser($request);
        $cohort = $this->findOrgCohort((int) $user->organization_id, $cohort);
        if (!$cohort) {
            return response()->json(['error' => 'Cohort not found'], 404);
        }

        if (!$cohort->isArchived()) {
            $cohort->archived_at = now();
            $cohort->save();
        }

        return response()->json(['cohort' => $this->serializeCohort($cohort)]);
    }

    /**
     * GET /api/org/cohorts/{cohort}/members — membership listing
     * (authenticated org member read; same visibility as the admin roster).
     */
    public function members(Request $request, int|string $cohort): JsonResponse
    {
        $user = $this->resolveActingUser($request);
        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }

        $cohort = $this->findOrgCohort((int) $user->organization_id, $cohort);
        if (!$cohort) {
            return response()->json(['error' => 'Cohort not found'], 404);
        }

        $members = CohortMember::where('cohort_id', $cohort->id)
            ->with('invite:id,email')
            ->orderBy('created_at')
            ->get()
            ->map(fn (CohortMember $m) => [
                'invite_id' => $m->invite_id,
                'developer_id' => 'invite:' . $m->invite_id,
                'email' => $m->invite?->email,
                'assigned_by' => $m->assigned_by,
                'assigned_at' => $m->created_at?->toISOString(),
            ]);

        return response()->json([
            'cohort' => $this->serializeCohort($cohort),
            'members' => $members,
        ]);
    }

    /**
     * POST /api/org/cohorts/{cohort}/members — assign or reassign invites
     * to this cohort (admin only). Body: { invite_ids: int[] }.
     *
     * All invites must belong to the authenticated organization; any
     * foreign/unknown invite id fails the whole request atomically.
     */
    public function addMembers(Request $request, int|string $cohort): JsonResponse
    {
        if ($guard = $this->requireCohortAdmin($request)) return $guard;

        $user = $this->resolveActingUser($request);
        $cohort = $this->findOrgCohort((int) $user->organization_id, $cohort);
        if (!$cohort) {
            return response()->json(['error' => 'Cohort not found'], 404);
        }
        if ($cohort->isArchived()) {
            return response()->json([
                'error' => 'Archived cohorts cannot receive membership',
                'error_code' => 'COHORT_ARCHIVED',
            ], 422);
        }

        $validator = Validator::make($request->all(), [
            'invite_ids' => 'required|array|min:1|max:100',
            'invite_ids.*' => 'integer',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()], 422);
        }

        $inviteIds = array_values(array_unique(array_map('intval', $request->input('invite_ids'))));
        $organizationId = (int) $user->organization_id;

        $invites = Invite::where('organization_id', $organizationId)
            ->whereIn('id', $inviteIds)
            ->get()
            ->keyBy('id');

        if ($invites->count() !== count($inviteIds)) {
            return response()->json([
                'error' => 'One or more invites are invalid for this organization',
                'error_code' => 'INVALID_INVITES',
            ], 422);
        }

        $service = app(CohortMembershipService::class);

        $result = DB::transaction(function () use ($invites, $inviteIds, $cohort, $user, $service) {
            $assigned = 0;
            $reassigned = 0;
            foreach ($inviteIds as $inviteId) {
                $prior = CohortMember::where('invite_id', $inviteId)->first();
                if ($prior && (int) $prior->cohort_id === (int) $cohort->id) {
                    continue;
                }
                $service->assign($cohort, $invites[$inviteId], $user->id);
                $prior ? $reassigned++ : $assigned++;
            }

            return [
                'assigned' => $assigned,
                'reassigned' => $reassigned,
            ];
        });

        return response()->json([
            'cohort' => $this->serializeCohort($cohort->fresh()),
            'assigned' => $result['assigned'],
            'reassigned' => $result['reassigned'],
        ]);
    }

    /**
     * DELETE /api/org/cohorts/{cohort}/members/{invite} — remove a
     * membership; the developer becomes unassigned (admin only).
     */
    public function removeMember(Request $request, int|string $cohort, int|string $invite): JsonResponse
    {
        if ($guard = $this->requireCohortAdmin($request)) return $guard;

        $user = $this->resolveActingUser($request);
        $cohort = $this->findOrgCohort((int) $user->organization_id, $cohort);
        if (!$cohort) {
            return response()->json(['error' => 'Cohort not found'], 404);
        }

        $membership = CohortMember::where('cohort_id', $cohort->id)
            ->where('invite_id', $invite)
            ->first();

        if (!$membership) {
            return response()->json(['error' => 'Membership not found'], 404);
        }

        $membership->delete();

        return response()->json([
            'cohort' => $this->serializeCohort($cohort->fresh()),
            'removed_invite_id' => (int) $invite,
        ]);
    }
}
