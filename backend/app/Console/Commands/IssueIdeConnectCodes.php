<?php

namespace App\Console\Commands;

use App\Models\IDEConnectCode;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

class IssueIdeConnectCodes extends Command
{
    protected $signature = 'chaosmonkey:issue-ide-connect-codes
                            {--organization= : Organization ID}
                            {--pending-invites : Generate codes for pending unredeemed invites only}
                            {--output= : Output CSV file path (required)}
                            {--rotate : Revoke existing live codes before issuing new ones}';

    protected $description = 'Issue reusable IDE connect codes for pending invites in an organization (operations-only)';

    public function handle(): int
    {
        $orgId = (int) $this->option('organization');
        if (!$orgId) {
            $this->error('--organization is required');
            return self::FAILURE;
        }

        $organization = Organization::find($orgId);
        if (!$organization) {
            $this->error("Organization {$orgId} not found");
            return self::FAILURE;
        }

        $outputPath = $this->option('output');
        $rotate = $this->option('rotate');

        // Phase 8: Output file is required
        if (!$outputPath) {
            $this->error('--output is required (CSV file path for code delivery)');
            return self::FAILURE;
        }

        // Select pending, unredeemed invites in the organization
        $query = Invite::where('organization_id', $orgId)
            ->whereNull('redeemed_at');

        if (!$this->option('pending-invites')) {
            $this->error('--pending-invites is required for this command');
            return self::FAILURE;
        }

        $invites = $query->get();
        if ($invites->isEmpty()) {
            $this->info("No pending invites found for organization {$orgId}");
            return self::SUCCESS;
        }

        // Verify all invites belong to the specified organization (cross-org safety)
        foreach ($invites as $invite) {
            if ((int) $invite->organization_id !== $orgId) {
                $this->error("Cross-organization rejection: invite {$invite->id} does not belong to org {$orgId}");
                return self::FAILURE;
            }
        }

        if ($rotate) {
            $revoked = IDEConnectCode::where('organization_id', $orgId)
                ->where('expires_at', '>', now())
                ->update(['expires_at' => IDEConnectCode::revokedExpiresAt()]);
            $this->info("Revoked {$revoked} existing live codes");
        }

        $created = 0;
        $skipped = 0;
        $rows = [];

        $issuerUserId = User::where('organization_id', $orgId)
            ->where('role', 'admin')
            ->orderBy('id')
            ->first()
            ?->id
            ?? User::orderBy('id')->first()?->id;

        foreach ($invites as $invite) {
            $code = IDEConnectCode::issueForInvite(
                $invite,
                $issuerUserId,
                (bool) $rotate
            );

            if ($code->wasRecentlyCreated) {
                $created++;
            } else {
                $skipped++;
            }

            $rows[] = [
                'email' => $invite->email,
                'code' => $code->code,
                'expires_at' => $code->expires_at->toISOString(),
            ];
        }

        // Output CSV — only email, code, expiry (no status, no logs, no terminal printing of codes)
        $csv = "email,code,expires_at\n";
        foreach ($rows as $row) {
            $csv .= "{$row['email']},{$row['code']},{$row['expires_at']}\n";
        }
        File::put($outputPath, $csv);
        chmod($outputPath, 0600);
        $this->info("CSV written to {$outputPath} (0600 permissions)");

        $this->info("Created: {$created}, Skipped: {$skipped}");
        return self::SUCCESS;
    }
}
