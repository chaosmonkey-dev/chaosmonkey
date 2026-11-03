<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

class IDEConnectCode extends Model
{
    use HasFactory;

    protected $table = 'ide_connect_codes';

    /**
     * PILOT OPS 18H: revocation marker written by revokeForInvite().
     *
     * expires_at carries two meanings for enrollment codes: "closed by the
     * passage of time" (legacy rows only — new codes never expire) and
     * "closed by an admin". A fixed past sentinel distinguishes the admin
     * action so health/Team surfaces can report revoked vs expired truthfully
     * without a schema change.
     *
     * used_at is non-authoritative legacy state: enrollment codes are
     * intentionally reusable and exchange never marks them used. No
     * lifecycle decision may depend on it.
     */
    public const REVOKED_EXPIRES_AT = '2000-01-01 00:00:00';

    public static function revokedExpiresAt(): Carbon
    {
        return Carbon::parse(self::REVOKED_EXPIRES_AT, 'UTC');
    }

    /**
     * Issue (or return) the invite's live enrollment code.
     *
     * Codes never expire on their own: a new code carries the enrollment
     * non-expiry sentinel. forceNew = regenerate: every currently-live code
     * for the invite is explicitly revoked before a genuinely new code is
     * created, so a regenerated code always differs from and replaces the
     * prior one.
     */
    public static function issueForInvite(Invite $invite, ?int $issuerUserId = null, bool $forceNew = false): self
    {
        $neverExpires = Invite::enrollmentNeverExpires();

        if ($forceNew) {
            self::revokeForInvite($invite);
        } else {
            $existing = self::where('invite_id', $invite->id)
                ->where('organization_id', $invite->organization_id)
                ->where('expires_at', '>', now())
                ->first();

            if ($existing) {
                // A reused legacy code that still carries a natural expiry is
                // upgraded to the non-expiring enrollment contract on contact.
                if ($existing->expires_at->lt($neverExpires)) {
                    $existing->update(['expires_at' => $neverExpires]);
                }
                return $existing;
            }
        }

        $issuerUserId = $issuerUserId ?? User::orderBy('id')->first()?->id;

        // An invite that carries a connect code is a developer enrollment:
        // it must remain usable for as long as its code does.
        if ($invite->expires_at === null || $invite->expires_at->lt($neverExpires)) {
            $invite->update(['expires_at' => $neverExpires]);
        }

        return self::create([
            'user_id' => $issuerUserId,
            'organization_id' => $invite->organization_id,
            'invite_id' => $invite->id,
            'expires_at' => $neverExpires,
        ]);
    }

    /**
     * Revoke every currently-live code for the invite. The revoked marker
     * keeps the row auditable and distinguishable from legacy natural expiry.
     */
    public static function revokeForInvite(Invite $invite): void
    {
        self::where('invite_id', $invite->id)
            ->where('organization_id', $invite->organization_id)
            ->where('expires_at', '>', now())
            ->update(['expires_at' => self::revokedExpiresAt()]);
    }

    protected $fillable = [
        'code',
        'user_id',
        'organization_id',
        'invite_id',
        'installation_id',
        'expires_at',
        'used_at',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'used_at' => 'datetime',
    ];

    /**
     * Boot the model and generate code on creation.
     */
    protected static function boot()
    {
        parent::boot();

        static::creating(function ($connectCode) {
            if (empty($connectCode->code)) {
                $connectCode->code = strtoupper(Str::random(8) . '-' . Str::random(8));
            }
        });
    }

    /**
     * Get the user that owns the connect code.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the organization that owns the connect code.
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * Get the invite that backs this connect code (if invite-backed).
     */
    public function invite(): BelongsTo
    {
        return $this->belongsTo(Invite::class);
    }

    /**
     * Check if the connect code is closed (expired or revoked).
     */
    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    /**
     * Check if the connect code was explicitly revoked by an admin.
     */
    public function isRevoked(): bool
    {
        return $this->expires_at !== null
            && $this->expires_at->toDateTimeString() === self::REVOKED_EXPIRES_AT;
    }

    /**
     * Check if the connect code is used.
     */
    public function isUsed(): bool
    {
        return !is_null($this->used_at);
    }

    /**
     * Check if the connect code is valid (not expired and not used).
     */
    public function isValid(): bool
    {
        return !$this->isExpired() && !$this->isUsed();
    }

    /**
     * Mark the connect code as used.
     */
    public function markAsUsed(): bool
    {
        if (!$this->isValid()) {
            return false;
        }

        $this->used_at = now();
        $this->save();

        return true;
    }
}
