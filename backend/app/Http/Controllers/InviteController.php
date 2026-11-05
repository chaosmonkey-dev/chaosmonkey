<?php

namespace App\Http\Controllers;

use App\Models\Cohort;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use App\Services\CohortMembershipService;
use App\Mail\BulkInviteEmail;
use App\Models\IDEConnectCode;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;
use App\Traits\PilotAwareTokenHelper;

class InviteController extends Controller
{
    use PilotAwareTokenHelper;

    /**
     * Resolve the acting user from the request's authenticated_user (set by SimpleTokenAuth).
     * No fallbacks — the middleware must supply a valid request-bound credential.
     */
    private function resolveActingUser(Request $request)
    {
        return $request->get('authenticated_user');
    }

    /**
     * CR-X multi-admin: Require admin role for invite management operations.
     * Returns a 403 JsonResponse if the user is not an admin.
     * Returns null if the user is an admin (caller should proceed).
     */
    private function requireAdmin(Request $request): ?JsonResponse
    {
        $user = $this->resolveActingUser($request);
        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }
        if (($user->role ?? 'admin') !== 'admin') {
            return response()->json([
                'error' => 'Insufficient permissions',
                'message' => 'Only organization admins can manage invites'
            ], 403);
        }
        return null;
    }

    /**
     * K1A: cohort mutations fail closed — a supplied cohort_id requires an
     * explicitly-admin role (the shared requireAdmin defaults a missing
     * role to admin and is intentionally not reused here). Returns a 403
     * response when denied, null when allowed.
     */
    private function requireCohortAdmin(Request $request): ?JsonResponse
    {
        $user = $this->resolveActingUser($request);
        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }
        if ($user->role !== 'admin') {
            return response()->json([
                'error' => 'Insufficient permissions',
                'message' => 'Only organization admins can manage cohort assignments',
            ], 403);
        }
        return null;
    }

    /**
     * K1A: resolve an optional cohort_id request parameter against the
     * authenticated organization. Only active cohorts in the caller's org
     * resolve; anything else returns null → caller responds 422.
     */
    private function resolveRequestedCohort(Request $request, int $organizationId): ?Cohort
    {
        $cohortId = $request->input('cohort_id');
        if ($cohortId === null) {
            return null;
        }

        return Cohort::forOrganization($organizationId)->active()->find($cohortId);
    }

    /**
     * Create a new invite for the authenticated user's organization.
     */
    public function create(Request $request): JsonResponse
    {
        // CR-X: Only admins can create invites
        $adminGuard = $this->requireAdmin($request);
        if ($adminGuard) return $adminGuard;

        $user = $this->resolveActingUser($request);
        Log::info('[InviteController::create] resolved user', [
            'user_id' => $user?->id,
            'organization_id' => $user?->organization_id,
            'auth_user' => Auth::id(),
            'merged_user' => $request->get('authenticated_user')?->id,
        ]);

        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }

        // PILOT OPS 18H: developer enrollments never expire on their own; only
        // an admin cancel/regenerate closes them. Dashboard-account invites
        // keep their ordinary time-bounded expiry.
        $isDeveloperEnrollment = $request->input('purpose') === 'developer_enrollment';

        $validator = Validator::make($request->all(), [
            // Pilot Ops 27: a developer enrollment MUST carry the developer's
            // email as its roster identity — anonymous enrollments render as
            // "Pending invitation" forever. Ordinary dashboard invites remain
            // nullable-email (shareable links).
            'email' => [$isDeveloperEnrollment ? 'required' : 'nullable', 'email', 'max:255'],
            'expires_hours' => 'integer|min:1|max:168', // Max 7 days
            'send_email' => 'boolean',
            'purpose' => 'nullable|string|in:developer_enrollment',
            'cohort_id' => 'nullable|integer',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()], 422);
        }

        // K1A: optional cohort assignment — org-scoped, active cohorts
        // only; invalid/cross-org/archived → 422 before anything is written.
        $cohort = null;
        if ($request->filled('cohort_id')) {
            if ($guard = $this->requireCohortAdmin($request)) return $guard;
            $cohort = $this->resolveRequestedCohort($request, (int) $user->organization_id);
            if (!$cohort) {
                return response()->json([
                    'error' => 'Invalid cohort',
                    'error_code' => 'INVALID_COHORT',
                ], 422);
            }
        }

        $email = $request->input('email');
        $role = $request->input('role', 'member');
        // When false, the email is stored only as a roster/admin label and no
        // mail delivery is attempted. Defaults to true for backward compatibility.
        $sendEmail = $request->boolean('send_email', true);

        // Duplicate protection is purpose-scoped: a developer enrollment and a
        // dashboard invite are separate capabilities for the same email and
        // must never block each other.
        if ($email) {
            if ($isDeveloperEnrollment) {
                // Enrolling an existing dashboard user is allowed — reject
                // only a true second pending enrollment for this email.
                $existingEnrollment = DB::table('invites')
                    ->where('organization_id', $user->organization_id)
                    ->where('email', $email)
                    ->where('redeemed_at', null)
                    ->where('expires_at', Invite::ENROLLMENT_NEVER_EXPIRES)
                    ->first();

                if ($existingEnrollment) {
                    return response()->json([
                        'error' => 'Enrollment already exists',
                        'message' => 'A developer enrollment already exists for this email.'
                    ], 422);
                }
            } else {
                // Dashboard invite: an existing dashboard account or another
                // pending dashboard invite is a true duplicate. A pending
                // developer enrollment (non-expiring sentinel) is unrelated.
                $existingUser = DB::table('users')
                    ->where('organization_id', $user->organization_id)
                    ->where('email', $email)
                    ->first();

                if ($existingUser) {
                    return response()->json([
                        'error' => 'Email already exists',
                        'message' => 'A user with this email already exists in your organization.'
                    ], 422);
                }

                $existingInvite = DB::table('invites')
                    ->where('organization_id', $user->organization_id)
                    ->where('email', $email)
                    ->where('redeemed_at', null) // Not redeemed
                    ->where('expires_at', '>', now()) // Not expired
                    ->where('expires_at', '!=', Invite::ENROLLMENT_NEVER_EXPIRES) // Not an enrollment
                    ->first();

                if ($existingInvite) {
                    return response()->json([
                        'error' => 'Invite already sent',
                        'message' => 'An invite has already been sent to this email. You can resend it from the team management page.'
                    ], 422);
                }
            }
        }

        $inviteId = DB::table('invites')->insertGetId([
            'organization_id' => $user->organization_id,
            'email' => $email,
            'role' => $role,
            'token' => bin2hex(random_bytes(16)),
            'expires_at' => $isDeveloperEnrollment
                ? Invite::enrollmentNeverExpires()
                : now()->addHours($request->input('expires_hours', 24)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $invite = DB::table('invites')->where('id', $inviteId)->first();
        $shareableUrl = url("/invite/{$invite->token}");

        // Get organization for email logging
        $organization = DB::table('organizations')->where('id', $user->organization_id)->first();

        // Try to send actual email for MVP (unless caller opted out — email as
        // roster label only, e.g. the Settings > Team developer-enrollment flow).
        if ($invite->email && $sendEmail) {
            $frontendUrl = config('app.frontend_url', 'http://localhost:5174');
            $shareableUrl = url("{$frontendUrl}/invite/{$invite->token}");
            $acceptUrl = url("{$frontendUrl}/accept-invite/{$invite->token}");
            
            // Try to send actual email for MVP
            try {
                \Mail::raw(
                    "Hello!\n\n" .
                    "You've been invited to join {$organization->name} on ChaosMonkey.\n\n" .
                    "Click here to create your account and join the team:\n{$acceptUrl}\n\n" .
                    "Or use the shareable link for direct access:\n{$shareableUrl}\n\n" .
                    "This invite will expire on {$invite->expires_at}.\n\n" .
                    "If you have any questions, please contact us.\n\n" .
                    "Thanks,\n" .
                    "The ChaosMonkey Team",
                    function ($message) use ($invite, $organization) {
                        $message->to($invite->email)
                            ->subject("You've been invited to join {$organization->name} on ChaosMonkey")
                            ->from('noreply@chaosmonkey.dev', 'ChaosMonkey Team');
                    }
                );
                
                \Log::info("=== EMAIL INVITE SENT ===");
                \Log::info("To: {$invite->email}");
                \Log::info("From: ChaosMonkey Team");
                \Log::info("Subject: You've been invited to join {$organization->name} on ChaosMonkey");
                \Log::info("Organization: " . ($organization ? $organization->name : 'Unknown'));
                \Log::info("Invited by: {$user->name} (" . ($user->email ?? 'N/A') . ")");
                \Log::info("Expires At: {$invite->expires_at}");
                \Log::info("=== END EMAIL INVITE SENT ===");
                
            } catch (\Exception $e) {
                \Log::error("Failed to send email invite", [
                    'email' => $invite->email,
                    'error' => $e->getMessage(),
                    'trace' => $e->getTraceAsString()
                ]);
                
                // Fallback to logging only
                \Log::info("=== EMAIL INVITE (LOG ONLY - SEND FAILED) ===");
                \Log::info("To: {$invite->email}");
                \Log::info("From: ChaosMonkey Team");
                \Log::info("Subject: You've been invited to join {$organization->name} on ChaosMonkey");
                \Log::info("Organization: " . ($organization ? $organization->name : 'Unknown'));
                \Log::info("Invited by: {$user->name} (" . ($user->email ?? 'N/A') . ")");
                \Log::info("Expires At: {$invite->expires_at}");
                \Log::info("Send Error: " . $e->getMessage());
                \Log::info("=== END EMAIL INVITE (LOG ONLY) ===");
            }
        }

        if ($cohort) {
            app(CohortMembershipService::class)->assign($cohort, Invite::find($inviteId), $user->id);
        }

        $response = [
            'invite' => $invite,
            'shareable_url' => $shareableUrl,
            'message' => ($invite->email && $sendEmail)
                ? 'Invite sent successfully'
                : 'Developer enrollment created successfully'
        ];
        if ($cohort) {
            $response['cohort'] = ['id' => $cohort->id, 'name' => $cohort->name];
        }

        return response()->json($response);
    }

    /**
     * Create or reuse one pending invite and one IDE connect code per email.
     */
    public function bulk(Request $request): JsonResponse
    {
        // CR-X: Only admins can create bulk invites
        $adminGuard = $this->requireAdmin($request);
        if ($adminGuard) return $adminGuard;

        $user = $this->resolveActingUser($request);

        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }

        $organizationId = (int) $user->organization_id;
        $organization = Organization::find($organizationId);

        $rawEmails = $request->input('emails');

        if (!is_array($rawEmails)) {
            return response()->json(['error' => 'emails must be an array'], 422);
        }

        // Pre-process: trim, lowercase, validate, dedupe
        $seen = [];
        $validEmails = [];
        $invalidEmails = [];

        foreach ($rawEmails as $raw) {
            $trimmed = trim((string) $raw);
            $email = strtolower($trimmed);

            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $invalidEmails[] = $trimmed;
                continue;
            }

            if (!in_array($email, $seen, true)) {
                $seen[] = $email;
                $validEmails[] = $email;
            }
        }

        if (count($validEmails) === 0) {
            return response()->json([
                'error' => 'No valid email addresses provided',
                'summary' => [
                    'requested' => count($rawEmails),
                    'sent' => 0,
                    'reused' => 0,
                    'skipped_active' => 0,
                    'failed' => count($invalidEmails),
                ],
                'results' => array_map(fn ($e) => [
                    'email' => $e,
                    'status' => 'failed',
                    'invite_id' => null,
                ], $invalidEmails),
            ], 422);
        }

        if (count($validEmails) > 50) {
            return response()->json([
                'error' => 'No more than 50 unique email addresses allowed',
                'summary' => [
                    'requested' => count($rawEmails),
                    'sent' => 0,
                    'reused' => 0,
                    'skipped_active' => 0,
                    'failed' => count($validEmails) - 50 + count($invalidEmails),
                ],
                'results' => array_map(fn ($e) => [
                    'email' => $e,
                    'status' => 'failed',
                    'invite_id' => null,
                ], $invalidEmails),
            ], 422);
        }

        $deliveryMode = $request->input('delivery_mode', 'email');

        if (!in_array($deliveryMode, ['email', 'shared_link'])) {
            return response()->json(['error' => 'Invalid delivery_mode'], 422);
        }

        // K1A: optional cohort assignment. The cohort must be an active
        // cohort in the authenticated organization; an invalid,
        // cross-organization, or archived cohort rejects the entire
        // request before any invite or membership is written.
        $cohort = null;
        if ($request->filled('cohort_id')) {
            if ($guard = $this->requireCohortAdmin($request)) return $guard;
            $cohort = $this->resolveRequestedCohort($request, $organizationId);
            if (!$cohort) {
                return response()->json([
                    'error' => 'Invalid cohort',
                    'error_code' => 'INVALID_COHORT',
                ], 422);
            }
        }

        $sharedInviteIds = [];

        $sharedSummary = [
            'requested' => count($rawEmails),
            'created' => 0,
            'reused' => 0,
            'skipped' => 0,
            'failed' => count($invalidEmails),
        ];

        $summary = [
            'requested' => count($rawEmails),
            'sent' => 0,
            'reused' => 0,
            'skipped_active' => 0,
            'failed' => count($invalidEmails),
        ];
        $results = array_map(fn ($e) => [
            'email' => $e,
            'status' => 'failed',
            'invite_id' => null,
        ], $invalidEmails);

        $cohortAssigned = 0;

        if ($deliveryMode === 'shared_link') {
            try {
                $result = DB::transaction(function () use ($request, $organizationId, $validEmails, $sharedSummary, $user, $cohort) {
                    $sharedInviteIds = [];
                    $cohortAssigned = 0;
                    $sharedSummary['requested'] = count($request->input('emails'));
                    $sharedExpiresAt = Invite::enrollmentNeverExpires();

                    foreach ($validEmails as $email) {
                        // An existing dashboard user may still need a
                        // developer enrollment — dashboard access and
                        // enrollment are separate capabilities. Reuse only a
                        // pending enrollment for this email; a pending
                        // dashboard invite belongs to the other capability.
                        $existingInvite = Invite::where('organization_id', $organizationId)
                            ->whereRaw('LOWER(email) = ?', [$email])
                            ->whereNull('redeemed_at')
                            ->where('expires_at', Invite::ENROLLMENT_NEVER_EXPIRES)
                            ->first();

                        $wasReused = false;

                        if ($existingInvite) {
                            $wasReused = true;
                            DB::table('invites')
                                ->where('id', $existingInvite->id)
                                ->update([
                                    'token' => bin2hex(random_bytes(16)),
                                    'expires_at' => $sharedExpiresAt,
                                    'updated_at' => now(),
                                ]);
                            $invite = Invite::find($existingInvite->id);
                        } else {
                            $inviteId = DB::table('invites')->insertGetId([
                                'organization_id' => $organizationId,
                                'token' => bin2hex(random_bytes(16)),
                                'email' => $email,
                                'role' => $request->input('role', 'member'),
                                'expires_at' => $sharedExpiresAt,
                                'created_at' => now(),
                                'updated_at' => now(),
                            ]);
                            $invite = Invite::find($inviteId);
                        }

                        IDEConnectCode::issueForInvite($invite, $user->id);
                        $sharedInviteIds[] = $invite->id;

                        // K1A: assign created and reused invites alike —
                        // reuse is an explicit (re)assignment request.
                        if ($cohort) {
                            app(CohortMembershipService::class)->assign($cohort, $invite, $user->id);
                            $cohortAssigned++;
                        }

                        $sharedSummary[$wasReused ? 'reused' : 'created']++;
                    }

                    if (empty($sharedInviteIds)) {
                        return ['empty' => true, 'summary' => $sharedSummary];
                    }

                    $rolloutUrl = $this->createRolloutUrl($organizationId, $sharedInviteIds, $sharedExpiresAt->toISOString());

                    return ['rollout_url' => $rolloutUrl, 'summary' => $sharedSummary, 'cohort_assigned' => $cohortAssigned];
                });

                if ($result['empty'] ?? false) {
                    return response()->json([
                        'error' => 'No eligible invites for shared rollout',
                        'summary' => $result['summary'],
                    ], 422);
                }

                $response = [
                    'delivery_mode' => 'shared_link',
                    'summary' => $result['summary'],
                    'rollout_url' => $result['rollout_url'],
                ];
                if ($cohort) {
                    $response['cohort'] = [
                        'id' => $cohort->id,
                        'name' => $cohort->name,
                        'assigned_count' => $result['cohort_assigned'] ?? 0,
                    ];
                }

                return response()->json($response);
            } catch (\Throwable $e) {
                Log::error('Shared rollout transaction failed', ['error' => $e->getMessage()]);

                return response()->json(['error' => 'Failed to generate shared rollout'], 500);
            }
        }

        foreach ($validEmails as $email) {
            try {
                // An existing dashboard user may still need a developer
                // enrollment — the capabilities are separate. Reuse only a
                // pending enrollment for this email; a pending dashboard
                // invite belongs to the other capability.
                $existingInvite = Invite::where('organization_id', $organizationId)
                    ->where('email', $email)
                    ->whereNull('redeemed_at')
                    ->where('expires_at', Invite::ENROLLMENT_NEVER_EXPIRES)
                    ->first();

                $wasReused = false;

                // PILOT OPS 18H: bulk email invites always carry a connect
                // code below, so every invite here is a developer enrollment
                // and gets the non-expiring enrollment sentinel.
                $enrollmentExpiresAt = Invite::enrollmentNeverExpires();

                if ($existingInvite) {
                    $wasReused = true;
                    DB::table('invites')
                        ->where('id', $existingInvite->id)
                        ->update([
                            'token' => bin2hex(random_bytes(16)),
                            'expires_at' => $enrollmentExpiresAt,
                            'updated_at' => now(),
                        ]);
                    $invite = Invite::find($existingInvite->id);
                } else {
                    $inviteId = DB::table('invites')->insertGetId([
                        'organization_id' => $organizationId,
                        'token' => bin2hex(random_bytes(16)),
                        'email' => $email,
                        'role' => $request->input('role', 'member'),
                        'expires_at' => $enrollmentExpiresAt,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                    $invite = Invite::find($inviteId);
                }

                // Issue or reuse a connect code for this invite
                $code = IDEConnectCode::issueForInvite($invite, $user->id);

                // Send personalized invitation email
                $frontendUrl = config('app.frontend_url', 'http://localhost:5174');

                Mail::to($email)->send(new BulkInviteEmail(
                    $email,
                    $organization->name,
                    $invite,
                    $code,
                    $frontendUrl
                ));

                // Only count as sent/reused after email dispatch succeeds
                if ($wasReused) {
                    $summary['reused']++;
                } else {
                    $summary['sent']++;
                }

                // K1A: assign created and reused invites alike — reuse is
                // an explicit (re)assignment request.
                if ($cohort) {
                    app(CohortMembershipService::class)->assign($cohort, $invite, $user->id);
                    $cohortAssigned++;
                }

                $results[] = [
                    'email' => $email,
                    'status' => $wasReused ? 'reused' : 'sent',
                    'invite_id' => $invite->id,
                ];
            } catch (\Exception $e) {
                Log::error('Bulk invite processing failed for email', [
                    'email' => $email,
                    'organization_id' => $organizationId,
                    'error' => $e->getMessage(),
                ]);

                $summary['failed']++;
                $results[] = [
                    'email' => $email,
                    'status' => 'failed',
                    'invite_id' => null,
                ];
            }
        }

        $response = [
            'summary' => $summary,
            'results' => $results,
        ];
        if ($cohort) {
            $response['cohort'] = [
                'id' => $cohort->id,
                'name' => $cohort->name,
                'assigned_count' => $cohortAssigned,
            ];
        }

        return response()->json($response);
    }

    /**
     * Resend an existing invite (bypasses duplicate validation)
     * 
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function resend(Request $request): JsonResponse
    {
        // CR-X: Only admins can resend invites
        $adminGuard = $this->requireAdmin($request);
        if ($adminGuard) return $adminGuard;

        $user = $this->resolveActingUser($request);

        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }

        $validator = Validator::make($request->all(), [
            'email' => 'required|email|max:255',
            'role' => 'string|in:member,admin',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()], 422);
        }

        $email = $request->input('email');
        $role = $request->input('role', 'member');

        // Find the existing pending DASHBOARD invite. Developer enrollments
        // carry the non-expiring sentinel, never need resend, and share the
        // invites table — without this scope an email holding both
        // capabilities could resend the wrong record.
        $existingInvite = DB::table('invites')
            ->where('organization_id', $user->organization_id)
            ->where('email', $email)
            ->where('redeemed_at', null) // Not redeemed
            ->where('expires_at', '>', now()) // Not expired
            ->where('expires_at', '!=', Invite::ENROLLMENT_NEVER_EXPIRES)
            ->first();

        if (!$existingInvite) {
            return response()->json([
                'error' => 'No pending invite found',
                'message' => 'No pending invite found for this email. Please send a new invite.'
            ], 404);
        }

        // Update the existing invite with new expiration and token.
        // PILOT OPS 18H: a code-backed invite is a developer enrollment and
        // must not lapse on resend; dashboard invites reset to 24 hours.
        $newToken = bin2hex(random_bytes(16));
        $newExpiresAt = IDEConnectCode::where('invite_id', $existingInvite->id)->exists()
            ? Invite::enrollmentNeverExpires()
            : now()->addHours(24);

        DB::table('invites')
            ->where('id', $existingInvite->id)
            ->update([
                'token' => $newToken,
                'expires_at' => $newExpiresAt,
                'updated_at' => now(),
            ]);

        // Get updated invite
        $updatedInvite = DB::table('invites')->where('id', $existingInvite->id)->first();
        $shareableUrl = url("/invite/{$newToken}");

        // Get organization for email logging
        $organization = DB::table('organizations')->where('id', $user->organization_id)->first();

        // Try to send actual email for MVP
        try {
            $frontendUrl = config('app.frontend_url', 'http://localhost:5174');
            $acceptUrl = url("{$frontendUrl}/accept-invite/{$newToken}");
            $shareableUrl = url("{$frontendUrl}/invite/{$newToken}");
            
            \Mail::raw(
                "Hello!\n\n" .
                "You've been invited to join {$organization->name} on ChaosMonkey.\n\n" .
                "Click here to create your account and join the team:\n{$acceptUrl}\n\n" .
                "Or use the shareable link for direct access:\n{$shareableUrl}\n\n" .
                "This invite will expire on {$newExpiresAt}.\n\n" .
                "If you have any questions, please contact us.\n\n" .
                "Thanks,\n" .
                "The ChaosMonkey Team",
                function ($message) use ($email, $organization) {
                    $message->to($email)
                        ->subject("You've been invited to join {$organization->name} on ChaosMonkey (Resent)")
                        ->from('noreply@chaosmonkey.dev', 'ChaosMonkey Team');
                }
            );
            
            // Log the resend
            \Log::info("=== EMAIL INVITE RESENT ===");
            \Log::info("To: {$email}");
            \Log::info("From: ChaosMonkey Team");
            \Log::info("Subject: You've been invited to join {$organization->name} on ChaosMonkey (Resent)");
            \Log::info("Organization: " . ($organization ? $organization->name : 'Unknown'));
            \Log::info("Invited by: {$user->name} (" . ($user->email ?? 'N/A') . ")");
            \Log::info("Expires At: {$newExpiresAt}");
            \Log::info("=== END EMAIL INVITE RESENT ===");

        } catch (\Exception $e) {
            \Log::error("Failed to resend email invite", [
                'email' => $email,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            // Fallback to logging only
            \Log::info("=== EMAIL INVITE RESENT (LOG ONLY - SEND FAILED) ===");
            \Log::info("To: {$email}");
            \Log::info("From: ChaosMonkey Team");
            \Log::info("Subject: You've been invited to join {$organization->name} on ChaosMonkey (Resent)");
            \Log::info("Organization: " . ($organization ? $organization->name : 'Unknown'));
            \Log::info("Invited by: {$user->name} (" . ($user->email ?? 'N/A') . ")");
            \Log::info("Expires At: {$newExpiresAt}");
            \Log::info("Send Error: " . $e->getMessage());
            \Log::info("=== END EMAIL INVITE RESENT (LOG ONLY) ===");
        }

        return response()->json([
            'invite' => $updatedInvite,
            'shareable_url' => url("{$frontendUrl}/invite/{$newToken}"),
            'message' => 'Invite resent successfully'
        ]);
    }

    /**
     * Reissue a pending invite: rotate the token and refresh expiry so an
     * admin can recover when the original acceptance link was lost. The
     * previous token is invalidated atomically — exactly one pending token
     * is ever valid for a given invite row.
     */
    public function reissue(Request $request, Invite $invite): JsonResponse
    {
        $adminGuard = $this->requireAdmin($request);
        if ($adminGuard) return $adminGuard;

        $user = $this->resolveActingUser($request);

        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }

        if ((int) $invite->organization_id !== (int) $user->organization_id) {
            return response()->json(['error' => 'Invite does not belong to your organization'], 403);
        }

        if ($invite->isRedeemed()) {
            return response()->json([
                'error' => 'Invite already accepted',
                'message' => 'This invite has already been used. Invite a new user instead.'
            ], 422);
        }

        if ($invite->expires_at->toDateTimeString() === IDEConnectCode::REVOKED_EXPIRES_AT) {
            return response()->json([
                'error' => 'Invite cancelled',
                'message' => 'This invite was cancelled and cannot be reissued. Create a new invite.'
            ], 422);
        }

        $hours = (int) $request->input('expires_hours', 168);
        $hours = max(1, min(168, $hours));

        // Code-backed invites are developer enrollments and keep the
        // non-expiring sentinel; dashboard invites get a fresh time box.
        $isEnrollment = $invite->isDeveloperEnrollment()
            || IDEConnectCode::where('invite_id', $invite->id)->exists();
        $newExpiresAt = $isEnrollment
            ? Invite::enrollmentNeverExpires()
            : now()->addHours($hours);

        $newToken = bin2hex(random_bytes(16));

        // Atomic rotate: the update only applies while the invite is still
        // unredeemed, so a concurrent acceptance or reissue loses safely.
        $updated = DB::table('invites')
            ->where('id', $invite->id)
            ->whereNull('redeemed_at')
            ->update([
                'token' => $newToken,
                'expires_at' => $newExpiresAt,
                'updated_at' => now(),
            ]);

        if ($updated === 0) {
            return response()->json([
                'error' => 'Invite state changed',
                'message' => 'This invite was just accepted or cancelled. Refresh and try again.'
            ], 409);
        }

        $frontendUrl = config('app.frontend_url', 'http://localhost:5174');

        Log::info('[InviteController::reissue] invite rotated', [
            'invite_id' => $invite->id,
            'organization_id' => $invite->organization_id,
            'actor_user_id' => $user->id,
            'expires_at' => $newExpiresAt,
        ]);

        return response()->json([
            'invite' => [
                'id' => $invite->id,
                'email' => $invite->email,
                'role' => $invite->role,
                'expires_at' => $newExpiresAt,
            ],
            'shareable_url' => "{$frontendUrl}/invite/{$newToken}",
            'message' => 'Invite reissued. The previous link no longer works — share the new link.'
        ]);
    }

    /**
     * Reveal the current acceptance link for a pending invite without
     * rotating it. Admin recovery path for a link that was created but not
     * captured — the token is only exposed to an org admin on demand, never
     * in list payloads.
     */
    public function acceptLink(Request $request, Invite $invite): JsonResponse
    {
        $adminGuard = $this->requireAdmin($request);
        if ($adminGuard) return $adminGuard;

        $user = $this->resolveActingUser($request);

        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }

        if ((int) $invite->organization_id !== (int) $user->organization_id) {
            return response()->json(['error' => 'Invite does not belong to your organization'], 403);
        }

        if ($invite->isRedeemed()) {
            return response()->json([
                'error' => 'Invite already accepted',
                'message' => 'This invite has already been used.'
            ], 422);
        }

        if ($invite->isExpired()) {
            return response()->json([
                'error' => 'Invite expired',
                'message' => 'This invite has expired. Reissue it to generate a fresh link.'
            ], 422);
        }

        $frontendUrl = config('app.frontend_url', 'http://localhost:5174');

        return response()->json([
            'shareable_url' => "{$frontendUrl}/invite/{$invite->token}",
            'expires_at' => $invite->expires_at,
        ]);
    }

    /**
     * Cancel an invite (soft-close: invite + its codes are revoked, the row
     * is retained so installation-bound tokens stay intact).
     */
    public function destroy(Request $request, $id)
    {
        // CR-X: Only admins can delete invites
        $adminGuard = $this->requireAdmin($request);
        if ($adminGuard) return $adminGuard;

        try {
            $user = $this->resolveActingUser($request);

            $invite = Invite::findOrFail($id);
            
            if ($invite->redeemed_at) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot delete a redeemed invite'
                ], 400);
            }
            
            if ($invite->organization_id !== $user->organization_id) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot delete invite from different organization'
                ], 403);
            }
            
            // PILOT OPS 18H: cancel = close, not delete. Deleting the invite
            // row would null invite_id on live installation-bound api_tokens
            // (FK nullOnDelete) and silently destroy their renew path. The
            // invite is instead closed with the revoked sentinel — it drops
            // out of the pending roster, blocks every invite-gated flow, and
            // its connect codes are explicitly revoked — while existing
            // installation tokens keep working unchanged.
            IDEConnectCode::revokeForInvite($invite);
            $invite->update(['expires_at' => IDEConnectCode::revokedExpiresAt()]);
            
            return response()->json([
                'success' => true,
                'message' => 'Invite cancelled and connect codes revoked'
            ]);
        } catch (Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete invite: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Issue or return the active IDE connect code for an invite.
     */
    public function issueConnectCode(Request $request, Invite $invite): JsonResponse
    {
        // Pilot Ops 12: connect-code management is admin-only
        $adminGuard = $this->requireAdmin($request);
        if ($adminGuard) return $adminGuard;

        $user = $this->resolveActingUser($request);
        Log::info('[InviteController::issueConnectCode] resolved user', [
            'user_id' => $user?->id,
            'user_org' => $user?->organization_id,
            'auth_user' => Auth::id(),
            'merged_user' => $request->get('authenticated_user')?->id,
            'invite_id' => $invite->id,
            'invite_org' => $invite->organization_id,
        ]);

        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }

        if ((int) $invite->organization_id !== (int) $user->organization_id) {
            return response()->json(['error' => 'Invite does not belong to your organization'], 403);
        }

        // regenerate=true is the single regeneration path: every live code is
        // revoked first, then a genuinely new code is issued.
        $code = IDEConnectCode::issueForInvite($invite, $user->id, forceNew: $request->boolean('regenerate'));

        return response()->json([
            'connect_code' => $code->code,
            'expires_at' => $code->expires_at->toISOString(),
            'invite_id' => $invite->id,
        ]);
    }

    /**
     * Revoke the active IDE connect code for an invite.
     */
    public function revokeConnectCode(Request $request, Invite $invite): JsonResponse
    {
        // Pilot Ops 12: connect-code management is admin-only
        $adminGuard = $this->requireAdmin($request);
        if ($adminGuard) return $adminGuard;

        $user = $this->resolveActingUser($request);

        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }

        if ((int) $invite->organization_id !== (int) $user->organization_id) {
            return response()->json(['error' => 'Invite does not belong to your organization'], 403);
        }

        IDEConnectCode::revokeForInvite($invite);

        return response()->json(['success' => true, 'message' => 'Connect code revoked']);
    }

    /**
     * Get invite details by token (public endpoint).
     */
    public function show(string $token): JsonResponse
    {
        $invite = Invite::with('organization')
            ->where('token', $token)
            ->first();

        if (!$invite) {
            return response()->json(['error' => 'Invite not found'], 404);
        }

        return response()->json($this->buildInviteResponse($invite));
    }

    /**
     * Build the public invite/setup response for a valid invite.
     */
    private function buildInviteResponse(Invite $invite): array
    {
        $isExpired = $invite->isExpired();
        $isRedeemed = $invite->isRedeemed();

        $response = [
            'invite' => [
                'organization_name' => $invite->organization?->name,
                'email' => $invite->email,
                'expires_at' => $invite->expires_at,
                'is_expired' => $isExpired,
                'is_redeemed' => $isRedeemed,
                'role' => $invite->role ?? 'member',
            ],
        ];

        // Only expose setup for valid, unredeemed, unexpired invites
        if (!$isExpired && !$isRedeemed) {
            $code = IDEConnectCode::where('invite_id', $invite->id)
                ->where('organization_id', $invite->organization_id)
                ->where('expires_at', '>', now())
                ->first();

            if ($code) {
                $apiBaseUrl = rtrim(config('app.url', 'http://localhost:8010'), '/');

                $response['setup'] = [
                    'extension_version' => '0.4.1',
                    'api_base_url' => $apiBaseUrl,
                    'vsix_download_url' => $apiBaseUrl . '/api/extension/download/latest',
                    'connect_code' => $code->code,
                ];

                // Cursor Agent bridge is advertised only through the same
                // authoritative capability contract as the public
                // /api/cursor-agent-bridge/capability endpoint — promoted
                // route + hash-verified immutable artifact + canonicalization
                // support — fail-closed on any other pilot.
                $cursorBridgeManifest = \App\Http\Controllers\ExtensionController::cursorAgentBridgeManifest();
                if ($cursorBridgeManifest !== null) {
                    $response['setup']['cursor_agent_bridge'] = $cursorBridgeManifest + [
                        'download_url' => $apiBaseUrl . '/api/cursor-agent-bridge/download/latest',
                    ];
                }
            }
        }

        return $response;
    }

    /**
     * Create a stateless encrypted rollout URL for an organization.
     */
    private function createRolloutUrl(int $organizationId, array $inviteIds, ?string $expiresAt = null): string
    {
        $payload = [
            'purpose' => 'developer_rollout',
            'organization_id' => $organizationId,
            'invite_ids' => array_values(array_map('intval', $inviteIds)),
            'expires_at' => $expiresAt ?? now()->addHours(48)->toISOString(),
        ];

        $encrypted = Crypt::encryptString(json_encode($payload));
        $encoded = rtrim(strtr($encrypted, '+/', '-_'), '=');
        $frontendUrl = rtrim(config('app.frontend_url', 'http://localhost:5174'), '/');

        return "{$frontendUrl}/enroll/{$encoded}";
    }

    /**
     * Decrypt and validate a rollout token.
     */
    private function decryptRolloutToken(string $encoded): array
    {
        $encrypted = strtr($encoded, '-_', '+/');
        $padding = 4 - (strlen($encrypted) % 4);

        if ($padding !== 4) {
            $encrypted .= str_repeat('=', $padding);
        }

        $payload = json_decode(Crypt::decryptString($encrypted), true);

        if (
            !is_array($payload)
            || ($payload['purpose'] ?? null) !== 'developer_rollout'
            || !isset($payload['organization_id'])
            || !isset($payload['expires_at'])
            || !isset($payload['invite_ids'])
            || !is_array($payload['invite_ids'])
            || empty($payload['invite_ids'])
            || array_filter($payload['invite_ids'], fn ($v) => !is_int($v)) !== []
        ) {
            throw new \RuntimeException('Invalid rollout token');
        }

        return $payload;
    }

    /**
     * Public claim of a shared rollout link (throttled).
     */
    public function claimRollout(Request $request, string $token): JsonResponse
    {
        $reject = fn () => response()->json(['error' => 'Invalid or expired rollout link.'], 400);

        try {
            $payload = $this->decryptRolloutToken($token);
        } catch (\Throwable) {
            return $reject();
        }

        if (now()->greaterThan($payload['expires_at'])) {
            return $reject();
        }

        $email = strtolower(trim((string) $request->input('email')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return $reject();
        }

        $invite = Invite::where('organization_id', (int) $payload['organization_id'])
            ->whereIn('id', $payload['invite_ids'])
            ->whereRaw('LOWER(email) = ?', [$email])
            ->whereNull('redeemed_at')
            ->where('expires_at', '>', now())
            ->first();

        if (!$invite) {
            return $reject();
        }

        $code = IDEConnectCode::where('invite_id', $invite->id)
            ->where('organization_id', $invite->organization_id)
            ->where('expires_at', '>', now())
            ->first();

        if (!$code) {
            return $reject();
        }

        return response()->json($this->buildInviteResponse($invite));
    }

    /**
     * Public invite acceptance - creates user account and assigns to organization
     */
    public function accept(Request $request, string $token): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            'password' => 'required|string|min:8|confirmed',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()], 422);
        }

        // Find the invite
        $invite = DB::table('invites')
            ->where('token', $token)
            ->first();

        if (!$invite) {
            return response()->json(['error' => 'Invite not found'], 404);
        }

        // Check if invite is still valid
        if ($invite->redeemed_at) {
            return response()->json([
                'error' => 'Invite has already been redeemed',
                'message' => 'This invite was already used to create an account. If you already have an account, please log in. If you need a new invite, contact your organization administrator.',
                'suggestion' => 'Try logging in with your existing account or request a fresh invite from your admin.'
            ], 400);
        }

        if (strtotime($invite->expires_at) < time()) {
            return response()->json([
                'error' => 'Invite has expired',
                'message' => 'This invite expired on ' . $invite->expires_at . '. Please contact your organization administrator for a fresh invite.',
                'suggestion' => 'Request a new invite from your organization administrator.'
            ], 400);
        }

        // Check if user with this email already exists
        $existingUser = DB::table('users')
            ->where('email', $invite->email)
            ->first();

        if ($existingUser) {
            return response()->json(['error' => 'An account with this email already exists'], 400);
        }

        // Get organization details
        $organization = DB::table('organizations')
            ->where('id', $invite->organization_id)
            ->first();

        if (!$organization) {
            return response()->json(['error' => 'Organization not found'], 404);
        }

        // Create the new user
        $userId = DB::table('users')->insertGetId([
            'name' => $request->input('name'),
            'email' => $invite->email,
            'password' => bcrypt($request->input('password')),
            'organization_id' => $invite->organization_id,
            'role' => $invite->role ?? 'member', // Use role from invite or default to member
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Mark the invite as redeemed
        DB::table('invites')
            ->where('id', $invite->id)
            ->update([
                'redeemed_at' => now(),
                'redeemed_by_user_id' => $userId,
                'updated_at' => now(),
            ]);

        // Log the successful user creation and invite redemption
        \Log::info("=== USER CREATED VIA INVITE ===");
        \Log::info("User ID: {$userId}");
        \Log::info("Name: " . $request->input('name'));
        \Log::info("Email: {$invite->email}");
        \Log::info("Organization: {$organization->name} (ID: {$invite->organization_id})");
        \Log::info("Invited by: User ID from invite creation");
        \Log::info("=== END USER CREATION ===");

        // Check if this invite has a connect code (developer enrollment) or not (dashboard user)
        $hasConnectCode = IDEConnectCode::where('invite_id', $invite->id)->exists();

        return response()->json([
            'message' => 'Account created successfully! You can now log in.',
            'user' => [
                'id' => $userId,
                'name' => $request->input('name'),
                'email' => $invite->email,
                'organization_id' => $invite->organization_id,
                'role' => $invite->role ?? 'member',
            ],
            'organization' => [
                'id' => $invite->organization_id,
                'name' => $organization->name,
            ],
            'is_developer_enrollment' => $hasConnectCode,
        ]);
    }

    /**
     * Redeem an invite token (requires authentication).
     */
    public function redeem(string $token): JsonResponse
    {
        $user = Auth::user();
        if (!$user) {
            return response()->json(['error' => 'Authentication required'], 401);
        }

        $invite = Invite::where('token', $token)->first();

        if (!$invite) {
            return response()->json(['error' => 'Invite not found'], 404);
        }

        if (!$invite->isValid()) {
            $reason = $invite->isExpired() ? 'expired' : 'already redeemed';
            return response()->json(['error' => "Invite is {$reason}"], 400);
        }

        if ($invite->email && $invite->email !== $user->email) {
            return response()->json(['error' => 'This invite is for a different email address'], 403);
        }

        if ($invite->redeem($user)) {
            return response()->json([
                'message' => 'Invite redeemed successfully',
                'organization' => [
                    'id' => $invite->organization->id,
                    'name' => $invite->organization->name,
                ]
            ]);
        }

        return response()->json(['error' => 'Failed to redeem invite'], 500);
    }

    /**
     * List invites for the authenticated user's organization.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $this->resolveActingUser($request);
        
        if (!$user || !$user->organization_id) {
            return response()->json(['error' => 'User not associated with an organization'], 403);
        }

        // Tokens are invitation secrets — never returned in list payloads.
        // Admins recover a pending link via the single-purpose reissue and
        // accept-link endpoints, which are the only paths that emit one.
        $invites = DB::table('invites')
            ->where('organization_id', $user->organization_id)
            ->select([
                'id', 'organization_id', 'email', 'role',
                'expires_at', 'redeemed_at', 'redeemed_by_user_id',
                'created_at', 'updated_at',
            ])
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json(['invites' => $invites]);
    }
}
