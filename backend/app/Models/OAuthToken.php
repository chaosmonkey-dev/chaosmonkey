<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OAuthToken extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'organization_id',
        'access_token',
        'user_data',
        'oauth_state',
    ];

    protected $casts = [
        'user_data' => 'json',
    ];

    /**
     * Get the user that owns the OAuth token.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the organization that owns the OAuth token.
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
