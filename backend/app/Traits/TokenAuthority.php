<?php

namespace App\Traits;

use App\Models\ApiToken;
use Illuminate\Support\Str;

/**
 * Shared token authority — unified creation and validation for API tokens.
 *
 * New tokens: ≥32 cryptographically random bytes, stored as SHA-256 hex digest.
 * Validation: hash-first, then legacy raw fallback for backward compatibility.
 */
trait TokenAuthority
{
    /**
     * Generate a raw token and return both the raw value and its SHA-256 digest.
     *
     * @return array{raw: string, hash: string}
     */
    protected function generateTokenPair(): array
    {
        $raw = Str::random(64); // 64 chars ≥ 32 bytes of entropy
        return [
            'raw' => $raw,
            'hash' => hash('sha256', $raw),
        ];
    }

    /**
     * Resolve a bearer token to a valid ApiToken model.
     * Tries SHA-256 hash first, then legacy raw match.
     */
    protected function resolveToken(string $rawToken): ?ApiToken
    {
        return ApiToken::findValidToken($rawToken);
    }

    /**
     * Create a per-installation token bound to an invite.
     *
     * @return array{token: ApiToken, raw: string}
     */
    protected function createInviteBackedToken(
        int $organizationId,
        int $inviteId,
        string $installationId,
        ?int $userId = null,
        int $expiresDays = 90,
    ): array {
        $pair = $this->generateTokenPair();

        $token = ApiToken::create([
            'token' => $pair['hash'],
            'user_id' => $userId,
            'organization_id' => $organizationId,
            'invite_id' => $inviteId,
            'installation_id' => $installationId,
            'expires_at' => now()->addDays($expiresDays),
        ]);

        return [
            'token' => $token,
            'raw' => $pair['raw'],
        ];
    }

    /**
     * Derive the canonical developer_id from a resolved token.
     *
     * @return string e.g. "invite:42" or "user:7"
     */
    protected function deriveDeveloperId(ApiToken $token): string
    {
        if ($token->invite_id) {
            return "invite:{$token->invite_id}";
        }

        if ($token->user_id) {
            return "user:{$token->user_id}";
        }

        return 'unknown';
    }
}
