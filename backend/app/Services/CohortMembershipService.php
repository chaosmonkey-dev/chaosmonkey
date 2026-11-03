<?php

namespace App\Services;

use App\Models\Cohort;
use App\Models\CohortMember;
use App\Models\Invite;
use Illuminate\Database\QueryException;
use InvalidArgumentException;

/**
 * Server-authoritative cohort membership (K1A).
 *
 * Invariants enforced here (never delegated to clients):
 *  - cohort must be active (archived_at IS NULL) to receive membership
 *  - invite must belong to the cohort's organization
 *  - one invite belongs to zero or one cohort (UNIQUE(invite_id) backs this)
 *
 * Callers inside an existing transaction (e.g. bulk enrollment) stay
 * atomic with that transaction; standalone callers should wrap assigns in
 * DB::transaction when touching multiple invites.
 */
class CohortMembershipService
{
    public const ERR_ARCHIVED = 'COHORT_ARCHIVED';

    public const ERR_ORG_MISMATCH = 'COHORT_ORG_MISMATCH';

    /**
     * Assign (or reassign) an invite to a cohort. Reassignment removes any
     * existing membership in another cohort before writing the new row.
     *
     * Returns the authoritative membership row.
     *
     * @throws InvalidArgumentException code = ERR_ARCHIVED | ERR_ORG_MISMATCH
     */
    public function assign(Cohort $cohort, Invite $invite, ?int $assignedBy = null): CohortMember
    {
        if ($cohort->isArchived()) {
            throw new InvalidArgumentException('Archived cohorts cannot receive membership', 0);
        }

        if ((int) $cohort->organization_id !== (int) $invite->organization_id) {
            throw new InvalidArgumentException('Invite and cohort belong to different organizations', 0);
        }

        try {
            return CohortMember::updateOrCreate(
                ['invite_id' => $invite->id],
                [
                    'cohort_id' => $cohort->id,
                    'organization_id' => $cohort->organization_id,
                    'assigned_by' => $assignedBy,
                ]
            );
        } catch (QueryException $e) {
            // UNIQUE(invite_id) raced: re-resolve to preserve zero-or-one.
            CohortMember::where('invite_id', $invite->id)->delete();

            return CohortMember::create([
                'cohort_id' => $cohort->id,
                'invite_id' => $invite->id,
                'organization_id' => $cohort->organization_id,
                'assigned_by' => $assignedBy,
            ]);
        }
    }

    /**
     * Remove an invite's membership in a specific cohort. No-op if the
     * invite is not currently a member of this cohort.
     */
    public function remove(Cohort $cohort, Invite $invite): bool
    {
        return CohortMember::where('cohort_id', $cohort->id)
            ->where('invite_id', $invite->id)
            ->delete() > 0;
    }

    /**
     * The single cohort an invite currently belongs to, or null.
     */
    public function cohortForInvite(int $inviteId): ?Cohort
    {
        $member = CohortMember::where('invite_id', $inviteId)->first();

        return $member?->cohort;
    }
}
