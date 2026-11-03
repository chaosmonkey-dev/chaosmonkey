<?php

namespace App\Console\Commands;

use App\Models\IDEConnectCode;
use App\Models\Invite;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * PILOT OPS 18H — one-shot, idempotent reconciliation for pre-18H rows.
 *
 * Upgrades every unredeemed developer-enrollment invite and every
 * invite-backed connect code that still carries a natural expiry to the
 * non-expiring enrollment sentinel.
 *
 * Never touched:
 * - revoked/cancelled rows (revoked sentinel '2000-01-01 00:00:00')
 * - rows already at the non-expiring sentinel
 * - redeemed invites
 * - code-less invites (dashboard-account invites keep time-bounded expiry)
 * - invites cancelled under the revoked sentinel
 * - api_tokens, oauth_tokens, telemetry, users
 *
 * Idempotent: a second run matches zero rows. Audit with --dry-run first.
 */
class ReconcileEnrollmentExpiry extends Command
{
    protected $signature = 'chaosmonkey:reconcile-enrollment-expiry
                            {--organization= : Restrict to a single organization ID}
                            {--dry-run : Report affected rows without changing anything}';

    protected $description = 'Upgrade legacy naturally-expiring developer enrollments and connect codes to the non-expiring sentinel (PILOT OPS 18H)';

    public function handle(): int
    {
        $orgId = $this->option('organization') ? (int) $this->option('organization') : null;
        $dryRun = (bool) $this->option('dry-run');
        $sentinel = Invite::ENROLLMENT_NEVER_EXPIRES;
        $revoked = IDEConnectCode::REVOKED_EXPIRES_AT;

        $inviteQuery = DB::table('invites')
            ->whereNull('redeemed_at')
            ->whereNotIn('expires_at', [$sentinel, $revoked])
            ->whereExists(function ($q) {
                $q->select(DB::raw(1))
                    ->from('ide_connect_codes')
                    ->whereColumn('ide_connect_codes.invite_id', 'invites.id');
            });
        if ($orgId) {
            $inviteQuery->where('organization_id', $orgId);
        }
        $inviteIds = $inviteQuery->pluck('id');

        $codeQuery = DB::table('ide_connect_codes')
            ->whereNotNull('invite_id')
            ->whereNotIn('expires_at', [$sentinel, $revoked])
            ->whereExists(function ($q) use ($revoked) {
                $q->select(DB::raw(1))
                    ->from('invites')
                    ->whereColumn('invites.id', 'ide_connect_codes.invite_id')
                    ->whereNull('invites.redeemed_at')
                    ->where('invites.expires_at', '!=', $revoked);
            });
        if ($orgId) {
            $codeQuery->where('organization_id', $orgId);
        }
        $codeIds = $codeQuery->pluck('id');

        $this->info(($dryRun ? '[DRY RUN] ' : '') . "Enrollment invites to upgrade: {$inviteIds->count()}"
            . ($inviteIds->isNotEmpty() ? ' — ids ' . $inviteIds->implode(',') : ''));
        $this->info(($dryRun ? '[DRY RUN] ' : '') . "Connect codes to upgrade: {$codeIds->count()}"
            . ($codeIds->isNotEmpty() ? ' — ids ' . $codeIds->implode(',') : ''));

        if ($dryRun) {
            $this->info('No changes made. Re-run without --dry-run to apply.');
            return self::SUCCESS;
        }

        if ($inviteIds->isEmpty() && $codeIds->isEmpty()) {
            $this->info('Nothing to reconcile — all enrollment rows already non-expiring or closed.');
            return self::SUCCESS;
        }

        DB::transaction(function () use ($inviteIds, $codeIds, $sentinel) {
            DB::table('invites')->whereIn('id', $inviteIds)
                ->update(['expires_at' => $sentinel, 'updated_at' => now()]);
            DB::table('ide_connect_codes')->whereIn('id', $codeIds)
                ->update(['expires_at' => $sentinel, 'updated_at' => now()]);
        });

        $this->info("Reconciled {$inviteIds->count()} invite(s) and {$codeIds->count()} code(s) to {$sentinel}.");
        return self::SUCCESS;
    }
}
