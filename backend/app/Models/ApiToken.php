<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;

class ApiToken extends Model
{
    use HasFactory;

    protected $fillable = [
        'token',
        'user_id',
        'organization_id',
        'invite_id',
        'installation_id',
        'expires_at',
        'revoked_at',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];

    /**
     * Get the user that owns the API token.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the organization that owns the API token.
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * Get the invite that backs this token (if invite-backed).
     */
    public function invite(): BelongsTo
    {
        return $this->belongsTo(Invite::class);
    }

    /**
     * Check if the token is expired.
     */
    public function isExpired(): bool
    {
        return $this->expires_at && $this->expires_at->isPast();
    }

    /**
     * Check if the token is revoked.
     */
    public function isRevoked(): bool
    {
        return !is_null($this->revoked_at);
    }

    /**
     * Check if the token is valid (not expired and not revoked).
     */
    public function isValid(): bool
    {
        return !$this->isExpired() && !$this->isRevoked();
    }

    /**
     * Revoke the token.
     */
    public function revoke(): bool
    {
        if ($this->isRevoked()) {
            return false;
        }

        $this->revoked_at = now();
        return $this->save();
    }

    /**
     * Generate a new token for an organization, revoking all existing tokens for that org.
     */
    public static function generateForOrganization(int $organizationId, int $userId): self
    {
        return DB::transaction(function () use ($organizationId, $userId) {
            // Revoke ALL existing tokens for this organization
            self::where('organization_id', $organizationId)
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);

            // Create new token (hashed)
            $rawToken = Str::random(64);
            return self::create([
                'token' => hash('sha256', $rawToken),
                'user_id' => $userId,
                'organization_id' => $organizationId,
                'expires_at' => null,
            ]);
        });
    }

    /**
     * Generate a dashboard credential bound to a specific user and organization.
     * Revokes only prior dashboard tokens (invite_id IS NULL AND installation_id IS NULL)
     * for that user, leaving extension installation tokens untouched.
     *
     * @return array{token: ApiToken, raw: string}
     */
    public static function generateDashboardToken(int $userId, int $organizationId): array
    {
        return DB::transaction(function () use ($userId, $organizationId) {
            // Revoke only prior dashboard tokens for this user
            self::where('user_id', $userId)
                ->whereNull('invite_id')
                ->whereNull('installation_id')
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);

            $rawToken = Str::random(64);
            $token = self::create([
                'token' => hash('sha256', $rawToken),
                'user_id' => $userId,
                'organization_id' => $organizationId,
                'invite_id' => null,
                'installation_id' => null,
                'expires_at' => null,
            ]);

            return ['token' => $token, 'raw' => $rawToken];
        });
    }

    /**
     * Find a valid token by its raw value.
     * Tries SHA-256 hash first, then legacy raw match for backward compatibility.
     */
    public static function findValidToken(string $token): ?self
    {
        $hashed = hash('sha256', $token);

        $record = self::where('token', $hashed)
            ->whereNull('revoked_at')
            ->where(function ($query) {
                $query->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now());
            })
            ->first();

        if ($record) {
            return $record;
        }

        // Legacy fallback: raw token match (for pre-hashing tokens)
        return self::where('token', $token)
            ->whereNull('revoked_at')
            ->where(function ($query) {
                $query->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now());
            })
            ->first();
    }

    /**
     * Get the active token for an organization.
     */
    public static function getActiveForOrganization(int $organizationId): ?self
    {
        return self::where('organization_id', $organizationId)
            ->whereNull('revoked_at')
            ->where(function ($query) {
                $query->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now());
            })
            ->first();
    }

    /**
     * Check if this is an installation-bound token (invite-backed, has installation_id).
     *
     * @return bool
     */
    public function isInstallationToken(): bool
    {
        return !is_null($this->invite_id) && !is_null($this->installation_id);
    }

    /**
     * Renew this token in-place by extending expires_at.
     *
     * Preserves the token secret, organization/user/invite/installation identity.
     * Only valid (non-expired, non-revoked) installation tokens may renew.
     *
     * If the token already has more than $minRemainingDays left, this is a no-op
     * and returns ['renewed' => false, 'expires_at' => existing].
     *
     * @param  int  $expiresDays  New total lifetime from now (default 90)
     * @param  int  $minRemainingDays  Only renew if fewer than this many days remain (default 14)
     * @return array{renewed: bool, expires_at: \Illuminate\Support\Carbon}
     * @throws \RuntimeException if token is expired, revoked, or not an installation token
     */
    public function renewInPlace(int $expiresDays = 90, int $minRemainingDays = 14): array
    {
        if ($this->isExpired()) {
            throw new \RuntimeException('Cannot renew an expired token');
        }

        if ($this->isRevoked()) {
            throw new \RuntimeException('Cannot renew a revoked token');
        }

        if (!$this->isInstallationToken()) {
            throw new \RuntimeException('Only installation-bound tokens can be renewed');
        }

        // Idempotent: if the token still has plenty of lifetime, don't extend.
        // diffInDays returns a signed value (negative when expires_at is in the future)
        $remainingDays = abs($this->expires_at->diffInDays(now()));
        if ($remainingDays > $minRemainingDays) {
            return ['renewed' => false, 'expires_at' => $this->expires_at];
        }

        $this->expires_at = now()->addDays($expiresDays);
        $this->save();

        return ['renewed' => true, 'expires_at' => $this->expires_at];
    }
}
