<?php

namespace App\Mail;

use App\Models\IDEConnectCode;
use App\Models\Invite;
use Illuminate\Mail\Mailable;

class BulkInviteEmail extends Mailable
{
    public function __construct(
        public string $recipientEmail,
        public string $organizationName,
        public Invite $invite,
        public IDEConnectCode $code,
        public string $frontendUrl,
    ) {
    }

    public function build(): self
    {
        $inviteUrl = rtrim($this->frontendUrl, '/') . '/invite/' . $this->invite->token;

        $organizationName = e($this->organizationName);
        $code = e($this->code->code);
        $expiresAt = e((string) $this->invite->expires_at);

        $body = "Hello!\n\n" .
            "You've been invited to join {$organizationName} on ChaosMonkey.\n\n" .
            "No dashboard account is required. Use this link to download ChaosMonkey 0.4.0 and get your Connect instructions:\n" .
            "{$inviteUrl}\n\n" .
            "Your personal enrollment code is: {$code}\n" .
            "You can use the same enrollment code in VS Code, Cursor, and Devin. Each editor will receive its own secure installation connection.\n\n" .
            "This invite will expire on {$expiresAt}.\n\n" .
            "Thanks,\n" .
            "The ChaosMonkey Team";

        return $this
            ->to($this->recipientEmail)
            ->from('noreply@chaosmonkey.dev', 'ChaosMonkey Team')
            ->subject("You've been invited to join {$organizationName} on ChaosMonkey")
            ->html(nl2br($body, false));
    }
}
