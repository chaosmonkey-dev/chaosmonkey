<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Organization extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'slug',
    ];

    /**
     * Get the users that belong to the organization.
     */
    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    /**
     * Get the OAuth tokens that belong to the organization.
     */
    public function oauthTokens(): HasMany
    {
        return $this->hasMany(OAuthToken::class);
    }

    /**
     * Get the telemetry events that belong to the organization.
     */
    public function telemetryEvents(): HasMany
    {
        return $this->hasMany(TelemetryEvent::class);
    }

    /**
     * Get the invites for the organization.
     */
    public function invites(): HasMany
    {
        return $this->hasMany(Invite::class);
    }
}
