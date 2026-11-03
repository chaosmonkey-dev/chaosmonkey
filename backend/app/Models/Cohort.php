<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Organization-scoped developer cohort (K1A).
 *
 * Cohorts group invite-backed developer identities (invite:<id>) for
 * organization-level analytics scoping. Membership is resolved at query
 * time from cohort_members; no telemetry row carries cohort identity.
 */
class Cohort extends Model
{
    protected $fillable = [
        'organization_id',
        'name',
        'description',
        'created_by',
        'archived_at',
    ];

    protected $casts = [
        'archived_at' => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function members(): HasMany
    {
        return $this->hasMany(CohortMember::class);
    }

    public function invites(): BelongsToMany
    {
        return $this->belongsToMany(Invite::class, 'cohort_members')
            ->withPivot('organization_id', 'assigned_by')
            ->withTimestamps();
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isArchived(): bool
    {
        return $this->archived_at !== null;
    }

    public function scopeForOrganization(Builder $query, int $organizationId): Builder
    {
        return $query->where('organization_id', $organizationId);
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->whereNull('archived_at');
    }
}
