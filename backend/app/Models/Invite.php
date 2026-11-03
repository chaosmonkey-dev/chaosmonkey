<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

class Invite extends Model
{
    use HasFactory;

    /**
     * PILOT OPS 18H: developer-enrollment lifecycle authority.
     *
     * A developer enrollment never silently lapses: its invite stays usable
     * until an admin explicitly cancels it (row deleted) or the invite is
     * redeemed. This fixed far-future sentinel encodes "does not expire" while
     * keeping expires_at non-null for every existing gate and query.
     *
     * Pure dashboard-account invites keep ordinary time-bounded expiry and
     * must never use this value.
     */
    public const ENROLLMENT_NEVER_EXPIRES = '2099-12-31 23:59:59';

    public static function enrollmentNeverExpires(): Carbon
    {
        return Carbon::parse(self::ENROLLMENT_NEVER_EXPIRES, 'UTC');
    }

    /**
     * True when this invite is a developer enrollment (non-expiring sentinel).
     */
    public function isDeveloperEnrollment(): bool
    {
        return $this->expires_at !== null
            && $this->expires_at->toDateTimeString() === self::ENROLLMENT_NEVER_EXPIRES;
    }

    protected $fillable = [
        'organization_id',
        'token',
        'email',
        'expires_at',
        'redeemed_at',
        'redeemed_by_user_id',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'redeemed_at' => 'datetime',
    ];

    /**
     * Boot the model and generate token on creation.
     */
    protected static function boot()
    {
        parent::boot();

        static::creating(function ($invite) {
            if (empty($invite->token)) {
                $invite->token = Str::random(32);
            }
        });
    }

    /**
     * Get the organization that owns the invite.
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * Get the user who redeemed the invite.
     */
    public function redeemedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'redeemed_by_user_id');
    }

    /**
     * Check if the invite is expired.
     */
    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    /**
     * Check if the invite is redeemed.
     */
    public function isRedeemed(): bool
    {
        return !is_null($this->redeemed_at);
    }

    /**
     * Check if the invite is valid (not expired and not redeemed).
     */
    public function isValid(): bool
    {
        return !$this->isExpired() && !$this->isRedeemed();
    }

    /**
     * Redeem the invite for a user.
     */
    public function redeem(User $user): bool
    {
        if (!$this->isValid()) {
            return false;
        }

        $this->redeemed_at = now();
        $this->redeemed_by_user_id = $user->id;
        $this->save();

        // Attach user to organization
        $user->update(['organization_id' => $this->organization_id]);

        return true;
    }
}
