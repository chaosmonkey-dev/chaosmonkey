<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Server-authoritative cohort membership (K1A).
 *
 * invite_id is unique at the schema level: one developer belongs to at
 * most one cohort. organization_id is a denormalized tenant guard that
 * must equal the cohort's organization_id; cohort writes enforce this
 * invariant at the service/controller layer inside a transaction.
 */
class CohortMember extends Model
{
    protected $table = 'cohort_members';

    protected $fillable = [
        'cohort_id',
        'invite_id',
        'organization_id',
        'assigned_by',
    ];

    public function cohort(): BelongsTo
    {
        return $this->belongsTo(Cohort::class);
    }

    public function invite(): BelongsTo
    {
        return $this->belongsTo(Invite::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function assigner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_by');
    }
}
