<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Auth;
use App\Models\Cohort;
use App\Models\CohortMember;
use App\Models\CursorUsage;
use App\Models\Invite;
use App\Models\TelemetryEvent;
use App\Models\ApiToken;
use App\Support\DemoAnalyticsFilter;
use App\Traits\TokenAuthority;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Validation\ValidationException;
use Carbon\Carbon;

class TelemetryController extends Controller
{
    use TokenAuthority;
    /**
     * Sanitize and normalize a single telemetry event
     */
    private function sanitizeEvent(array $event, string $source): ?array
    {
        $eventType = $event['event_type'] ?? null;
        if (!$eventType) {
            return null;
        }

        $sanitized = [
            'event_type' => (string) $eventType,
        ];

        // Preserve count with bounds checking
        if (isset($event['count'])) {
            $count = (int) $event['count'];
            $sanitized['count'] = max(0, min($count, 1000000)); // Clamp to reasonable bounds
        }

        // Preserve duration with bounds checking
        if (isset($event['duration_ms'])) {
            $duration = (int) $event['duration_ms'];
            $sanitized['duration_ms'] = max(0, min($duration, 86400000)); // Max 24 hours
        }

        // Validate and normalize timestamp
        if (!empty($event['timestamp'])) {
            try {
                $timestamp = new Carbon($event['timestamp']);
                // Reject timestamps too far in future or past
                if ($timestamp->gt(now()->addHour()) || $timestamp->lt(now()->subYears(5))) {
                    throw new \InvalidArgumentException('Timestamp out of acceptable range');
                }
                $sanitized['timestamp'] = $timestamp->toISOString();
            } catch (\Throwable $e) {
                Log::warning('[TELEMETRY] Invalid timestamp', [
                    'event_type' => $eventType,
                    'timestamp' => $event['timestamp'],
                    'error' => $e->getMessage()
                ]);
                $sanitized['timestamp'] = now()->toISOString(); // Fallback to now
            }
        } else {
            $sanitized['timestamp'] = now()->toISOString();
        }

        // Sanitize metadata
        if (!empty($event['metadata']) && is_array($event['metadata'])) {
            // Remove potentially large or sensitive fields
            $metadata = $event['metadata'];
            
            // Limit metadata size
            $metadataJson = json_encode($metadata);
            if (strlen($metadataJson) > 10000) { // 10KB limit
                $metadata = array_slice($metadata, 0, 50, true); // Keep first 50 fields
                Log::info('[TELEMETRY] Metadata truncated due to size limit', [
                    'event_type' => $eventType,
                    'original_size' => strlen($metadataJson)
                ]);
            }
            
            $sanitized['metadata'] = $metadata;
        }

        return $sanitized;
    }

    /**
     * Multi-field tool resolver for telemetry events
     *
     * Precedence order for workflow attribution:
     * 1. uriScheme === "devin" → devin
     * 2. appName contains "Devin" → devin
     * 3. appName contains "Windsurf" → windsurf
     * 4. appName contains "Cursor" → cursor
     * 5. appName contains "Claude Code" → claude_code
     * 6. appName contains "GitHub Copilot" → github_copilot
     * 7. editor_source/tool/ide/source fields (fallback)
     */
    private function resolveTool(array $event): ?string
    {
        // Check uriScheme first (highest precedence for Devin)
        $uriScheme = $this->getNestedValue($event, 'uriScheme') ?? 
                     $this->getNestedValue($event, 'metadata.uriScheme') ??
                     $this->getNestedValue($event, 'context.uriScheme');
        
        if ($uriScheme && is_string($uriScheme)) {
            $uriScheme = strtolower(trim($uriScheme));
            if ($uriScheme === 'devin') {
                return 'devin';
            }
        }
        
        // Check appName second
        $appName = $this->getNestedValue($event, 'appName') ??
                   $this->getNestedValue($event, 'metadata.appName') ??
                   $this->getNestedValue($event, 'context.appName');
        
        if ($appName && is_string($appName)) {
            $appNameLower = strtolower(trim($appName));
            
            if (strpos($appNameLower, 'devin') !== false) {
                return 'devin';
            }
            if (strpos($appNameLower, 'windsurf') !== false) {
                return 'windsurf';
            }
            if (strpos($appNameLower, 'cursor') !== false) {
                return 'cursor';
            }
            if (strpos($appNameLower, 'claude code') !== false) {
                return 'claude_code';
            }
            if (strpos($appNameLower, 'github copilot') !== false) {
                return 'github_copilot';
            }
        }
        
        // Fallback to standard fields
        $fields = [
            'tool', 'editor_source', 'source', 'ide', 'editor', 'client', 'app',
            'context.tool', 'context.source', 'context.editor_source',
            'metadata.tool', 'metadata.source', 'metadata.editor_source'
        ];
        
        foreach ($fields as $field) {
            $value = $this->getNestedValue($event, $field);
            if ($value && is_string($value) && !empty(trim($value))) {
                return trim($value);
            }
        }
        
        return null;
    }
    
    /**
     * Get nested value from array using dot notation
     */
    private function getNestedValue(array $array, string $key)
    {
        $keys = explode('.', $key);
        $value = $array;
        
        foreach ($keys as $k) {
            if (!is_array($value) || !array_key_exists($k, $value)) {
                return null;
            }
            $value = $value[$k];
        }
        
        return $value;
    }

    /**
     * Resolve primary tool/workflow from metadata and DB columns
     * 
     * Product doctrine: Primary tool = what produced the coding assistance
     * Host editor = shell/editor where it ran (preserved separately)
     * 
     * Precedence:
     * 1. Claude Code signals (highest priority)
     * 2. Devin/Windsurf/Cursor signals
     * 3. GitHub Copilot signals
     * 4. Plain IDE fallback
     * 5. unknown
     * 
     * @param array $metadata Event metadata
     * @param string|null $dbTool DB tool column
     * @param string|null $dbSource DB source column
     * @param string|null $dbEditorSource DB editor_source column
     * @return string Canonical tool name
     */
    private function resolvePrimaryTool(array $metadata, ?string $dbTool, ?string $dbSource, ?string $dbEditorSource): string
    {
        // 1. Check explicit Claude Code signals (highest precedence)
        if ($dbTool === 'claude_code') {
            return 'claude_code';
        }
        
        if (isset($metadata['tool']) && $metadata['tool'] === 'claude_code') {
            return 'claude_code';
        }
        
        if (isset($metadata['vscode_version']) && $metadata['vscode_version'] === 'claude-code') {
            return 'claude_code';
        }
        
        if (isset($metadata['extension_version']) && str_contains($metadata['extension_version'], 'cc-bridge')) {
            return 'claude_code';
        }
        
        $appName = $this->getNestedValue($metadata, 'appName') ?? $this->getNestedValue($metadata, 'context.appName');
        if ($appName && str_contains(strtolower($appName), 'claude code')) {
            return 'claude_code';
        }
        
        // 2. Check explicit Devin/Windsurf/Cursor signals
        $uriScheme = $this->getNestedValue($metadata, 'uriScheme') ?? $this->getNestedValue($metadata, 'context.uriScheme');
        if ($uriScheme) {
            $uriScheme = strtolower(trim($uriScheme));
            if ($uriScheme === 'devin') {
                return 'devin';
            }
        }
        
        if ($appName) {
            $appNameLower = strtolower(trim($appName));
            if (strpos($appNameLower, 'devin') !== false) {
                return 'devin';
            }
            if (strpos($appNameLower, 'windsurf') !== false) {
                return 'windsurf';
            }
            if (strpos($appNameLower, 'cursor') !== false) {
                return 'cursor';
            }
        }
        
        // 3. Check Copilot signal
        if ($appName && str_contains(strtolower($appName), 'github copilot')) {
            return 'github_copilot';
        }
        
        // 4. Plain IDE fallback
        $fallback = $dbEditorSource ?? $dbSource ?? $dbTool ?? 'unknown';
        return $this->normalizeToolName($fallback);
    }

    /**
     * Resolve host editor (shell/editor where primary tool ran)
     * 
     * Preserves host context separately from primary tool.
     * For Claude Code inside VS Code, primary tool = claude_code, host_editor = vscode.
     * 
     * @param array $metadata Event metadata
     * @param string|null $dbSource DB source column
     * @param string|null $dbEditorSource DB editor_source column
     * @return string Canonical host editor name
     */
    private function resolveHostEditor(array $metadata, ?string $dbSource, ?string $dbEditorSource): string
    {
        $source = $dbEditorSource ?? $dbSource ?? $this->getNestedValue($metadata, 'source') ?? $this->getNestedValue($metadata, 'editor_source') ?? 'unknown';
        return $this->normalizeToolName($source);
    }
    
    /**
     * Compute time to first commit for a session
     */
    private function computeTimeToFirstCommit(?string $sessionId, ?int $existingValue): ?int
    {
        // If already has value, return it
        if ($existingValue !== null && $existingValue > 0) {
            return $existingValue;
        }
        
        // If no session_id, cannot compute
        if ($sessionId === null) {
            return null;
        }
        
        if (config('services.chaosmonkey.pi_debug')) {
            Log::info('[PI_DEBUG][TTFC] Computing TTFC', [
                'session_id' => $sessionId,
                'existing_value' => $existingValue
            ]);
        }
        
        // Find session start time
        $sessionQuery = TelemetryEvent::where('session_id', $sessionId)
            ->where('event_type', 'session');
        $session = DemoAnalyticsFilter::apply($sessionQuery)->first();
            
        if (!$session) {
            if (config('services.chaosmonkey.pi_debug')) {
                Log::info('[PI_DEBUG][TTFC] No session event found', ['session_id' => $sessionId]);
            }
            return null;
        }
        
        $sessionStart = $session->timestamp;
        
        if (config('services.chaosmonkey.pi_debug')) {
            Log::info('[PI_DEBUG][TTFC] Session found', [
                'session_id' => $sessionId,
                'session_start' => $sessionStart->toISOString()
            ]);
        }
        
        // Find first commit for this session
        $firstCommitQuery = TelemetryEvent::where('session_id', $sessionId)
            ->where('event_type', 'commit')
            ->orderBy('timestamp', 'asc');
        $firstCommit = DemoAnalyticsFilter::apply($firstCommitQuery)->first();
            
        if (!$firstCommit) {
            if (config('services.chaosmonkey.pi_debug')) {
                Log::info('[PI_DEBUG][TTFC] No commit event found', ['session_id' => $sessionId]);
            }
            return null;
        }
        
        $commitTime = $firstCommit->timestamp;
        
        if (config('services.chaosmonkey.pi_debug')) {
            Log::info('[PI_DEBUG][TTFC] Commit found', [
                'session_id' => $sessionId,
                'commit_time' => $commitTime->toISOString()
            ]);
        }
        
        // Calculate difference in milliseconds (commit - session start)
        $diff = $sessionStart->diffInMilliseconds($commitTime);
        
        if (config('services.chaosmonkey.pi_debug')) {
            Log::info('[PI_DEBUG][TTFC] TTFC computed', [
                'session_id' => $sessionId,
                'diff_ms' => $diff,
                'session_start' => $sessionStart->toISOString(),
                'commit_time' => $commitTime->toISOString()
            ]);
        }
        
        return $diff >= 0 ? $diff : null;
    }
    
    /**
     * Compute AI burst count for a session
     */
    private function computeAIBurstCount(?string $sessionId, ?int $existingValue): ?int
    {
        // If already has value, return it
        if ($existingValue !== null && $existingValue > 0) {
            return $existingValue;
        }
        
        // If no session_id, cannot compute
        if ($sessionId === null) {
            return null;
        }
        
        // Get ai_accept events for this session
        $aiAcceptQuery = TelemetryEvent::where('session_id', $sessionId)
            ->where('event_type', 'ai_accept');
        $aiAcceptCount = DemoAnalyticsFilter::apply($aiAcceptQuery)->count();
            
        return $aiAcceptCount > 0 ? $aiAcceptCount : null;
    }
    
    /**
     * Compute active coding duration for a session
     */
    private function computeActiveCodingDuration(?string $sessionId, ?int $existingValue): ?int
    {
        // If already has value, return it
        if ($existingValue !== null && $existingValue > 0) {
            return $existingValue;
        }
        
        // If no session_id, cannot compute
        if ($sessionId === null) {
            return null;
        }
        
        // Get file_edit events for this session
        $fileEditQuery = TelemetryEvent::where('session_id', $sessionId)
            ->where('event_type', 'file_edit')
            ->orderBy('timestamp', 'asc');
        $fileEdits = DemoAnalyticsFilter::apply($fileEditQuery)->get();
            
        if ($fileEdits->count() < 2) {
            return null;
        }
        
        $firstEdit = $fileEdits->first();
        $lastEdit = $fileEdits->last();
        
        // Calculate span between first and last edit
        $duration = $lastEdit->timestamp->diffInMilliseconds($firstEdit->timestamp);
        
        return $duration > 0 ? $duration : null;
    }
    
    /**
     * Resolve editor source with proper Devin/Windsurf/Cursor classification
     * 
     * Priority: product-specific signals > generic source field
     * Rules:
     * - If uriScheme === "devin" OR appName contains "Devin" OR extensionPath contains ".devin", classify as "devin"
     * - If appName/uriScheme/extensionPath indicates Windsurf, classify as "windsurf"
     * - If appName/uriScheme/extensionPath indicates Cursor, classify as "cursor"
     * - Only classify as "vscode" when no stronger host signal exists
     * - Do not let the generic VS Code extension host override product-specific hosts
     */
    private function resolveEditorSource(array $metadata, string $fallbackSource): string
    {
        // Check for Devin signals
        $uriScheme = $metadata['uriScheme'] ?? null;
        $appName = $metadata['appName'] ?? null;
        $extensionPath = $metadata['extensionPath'] ?? null;
        
        if ($uriScheme === 'devin' || 
            (is_string($appName) && stripos($appName, 'devin') !== false) ||
            (is_string($extensionPath) && strpos($extensionPath, '.devin') !== false)) {
            return 'devin';
        }
        
        // Check for Windsurf signals
        if ($uriScheme === 'windsurf' || 
            (is_string($appName) && stripos($appName, 'windsurf') !== false) ||
            (is_string($extensionPath) && strpos($extensionPath, 'windsurf') !== false)) {
            return 'windsurf';
        }
        
        // Check for Cursor signals
        if ($uriScheme === 'cursor' || 
            (is_string($appName) && stripos($appName, 'cursor') !== false) ||
            (is_string($extensionPath) && strpos($extensionPath, 'cursor') !== false)) {
            return 'cursor';
        }
        
        // Fall back to generic source field
        return $fallbackSource;
    }
    public function upload(Request $request)
    {
        Log::info('Telemetry upload endpoint hit');
        // Check if a file was uploaded with 'telemetry' field name
        $file = $request->file('telemetry');

        if (!$file) {
            Log::error('No file uploaded in request.');
            return response()->json(['error' => 'No file uploaded.'], 400);
        }

        $fileContents = file_get_contents($file);
        Log::info('Uploaded file contents', ['contents' => $fileContents]);

        // Attempt to parse uploaded JSON
        $data = json_decode($fileContents, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            Log::error('Invalid JSON format', ['error' => json_last_error_msg(), 'contents' => $fileContents]);
            return response()->json(['error' => 'Invalid JSON format.'], 400);
        }

        // Log data so we can confirm it's received
        Log::info('Telemetry uploaded', $data);

        // Store telemetry data in CursorUsage model
        try {
            $cursorUsage = CursorUsage::create([
                'developer_id' => $data['developer_id'] ?? 'unknown',
                'file_name' => $data['file_name'] ?? $file->getClientOriginalName(),
                'timestamp' => $data['timestamp'] ?? now(),
                'copilot_insertions' => $data['copilot_insertions'] ?? 0,
                'claude_insertions' => $data['claude_insertions'] ?? 0,
            ]);

            Log::info('Telemetry data stored in database', ['cursor_usage_id' => $cursorUsage->id]);

            return response()->json([
                'message' => 'Telemetry uploaded and stored successfully.',
                'data' => $cursorUsage,
                'original_telemetry' => $data
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to store telemetry data', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Failed to store telemetry data.'], 500);
        }
    }

    public function store(Request $request)
    {
        try {
            // PUBLIC ACCESS: No user authentication for eng leader deployments
            // LOCAL DEV: Allow missing user_id for seamless local development
            $userId = $request->input('user_id');
            if (!$userId) {
                // For local development, provide a default user_id
                // This allows developers to test telemetry without complex authentication
                $userId = 'dev-user-' . str_replace(['http://', 'https://', 'localhost', '127.0.0.1', ':'], '', $request->input('source', 'unknown'));
                
                Log::info('[TELEMETRY] Using default user_id for local development', [
                    'default_user_id' => $userId,
                    'source' => $request->input('source'),
                    'ip' => $request->ip(),
                    'note' => 'This is normal for local development testing'
                ]);
            }
            
            // Server-authoritative org resolution.
            // Do NOT default to a fixed org id — a past production incident
            // showed the default can silently mis-attribute one tenant's
            // events to another tenant's org.  When the client sends no
            // organization_id, fall through to user_id→org resolution below.
            $organizationId = $request->input('organization_id');
            
            Log::info('[TELEMETRY] Ingestion started', [
                'request_id' => $request->header('X-Request-Id', uniqid()),
                'content_type' => $request->header('Content-Type'),
                'has_events' => $request->has('events'),
                'has_event_type' => $request->has('event_type'),
                'user_id' => $userId,
                'organization_id' => $organizationId
            ]);

            // Validate base payload structure
            $baseValidation = $request->validate([
                'source' => 'required|string|max:50',
                'user_id' => 'nullable|string|max:255',
                'organization_id' => 'nullable|integer|exists:organizations,id',
                'events' => 'required|array|min:1|max:1000', // Prevent overload
                'events.*.event_type' => 'required|string|max:50',
                'events.*.count' => 'nullable|integer|min:0|max:1000000',
                'events.*.duration_ms' => 'nullable|integer|min:0|max:86400000', // Max 24 hours
                'events.*.timestamp' => 'nullable|date|before:now+1 hour',
                'events.*.metadata' => 'nullable|array|max:10000', // 10KB limit
            ], [
                'source.required' => 'Source field is required (cursor, windsurf, vscode)',
                'events.required' => 'Events array is required',
                'events.*.event_type.required' => 'Each event must have an event_type field',
                'events.max' => 'Cannot process more than 1000 events per request'
            ]);

            $events = $request->input('events', []);
            $source = $request->input('source');
            
            // Override with request values if provided (for flexibility)
            if ($request->input('user_id')) {
                $userId = $request->input('user_id');
            }
            if ($request->input('organization_id')) {
                $organizationId = $request->input('organization_id');
            }

            // Validate event types
            $allowedEventTypes = ['file_edit', 'session', 'ai_accept', 'commit', 'test_init'];
            foreach ($events as $index => $event) {
                $eventType = $event['event_type'] ?? null;
                if (!in_array($eventType, $allowedEventTypes)) {
                    throw ValidationException::withMessages([
                        "events.$index.event_type" => "Invalid event_type '{$eventType}'. Allowed: " . implode(', ', $allowedEventTypes)
                    ]);
                }
            }

            Log::info('[TELEMETRY] Validation passed', [
                'source' => $source,
                'user_id' => $userId,
                'event_count' => count($events),
                'event_types' => array_count_values(array_column($events, 'event_type'))
            ]);

        } catch (ValidationException $e) {
            Log::warning('[TELEMETRY] Validation failed', [
                'errors' => $e->errors(),
                'request_data' => $request->except(['events.*.metadata']) // Don't log large metadata
            ]);
            throw $e;
        }

        // Sanitize and normalize events
        $sanitizedEvents = [];
        foreach ($events as $index => $event) {
            try {
                $sanitizedEvent = $this->sanitizeEvent($event, $source);
                if ($sanitizedEvent) {
                    $sanitizedEvents[] = $sanitizedEvent;
                }
            } catch (\Throwable $e) {
                Log::warning('[TELEMETRY] Event sanitization failed', [
                    'event_index' => $index,
                    'event_type' => $event['event_type'] ?? 'unknown',
                    'error' => $e->getMessage()
                ]);
                // Continue processing other events
            }
        }

        if (empty($sanitizedEvents)) {
            Log::warning('[TELEMETRY] No valid events after sanitization');
            return response()->json([
                'status' => 'error',
                'message' => 'No valid events to process',
                'received' => 0
            ], 400);
        }

        // Add proof logging for event types before/after sanitization
        if (config('services.chaosmonkey.pi_debug')) {
            $incomingEventTypes = array_map(fn($e) => $e['event_type'] ?? $e['type'] ?? 'unknown', $events);
            $sanitizedEventTypes = array_map(fn($e) => $e['event_type'], $sanitizedEvents);
            
            Log::info('[PI_DEBUG][TELEMETRY] EVENT TYPE PROOF', [
                'incoming_event_types' => array_count_values($incomingEventTypes),
                'sanitized_event_types' => array_count_values($sanitizedEventTypes),
                'total_events' => count($events)
            ]);
        }

        Log::info('Sanitized telemetry events', ['events' => $sanitizedEvents]);

        $firstEvent = $sanitizedEvents[0] ?? [];
        $metadata = $firstEvent['metadata'] ?? [];
        if (!is_array($metadata)) {
            $metadata = [];
        }

        $sessionId = $metadata['session_id'] ?? null;

        if (config('services.chaosmonkey.telemetry_ingest_log')) {
            $requestId = $request->header('X-Request-Id') ?: bin2hex(random_bytes(8));
            Log::info('[CM][telemetry][ingest]', [
                'requestId' => $requestId,
                'sessionId' => $sessionId,
                'ide' => $source,
                'userAgent' => $request->userAgent(),
            ]);
        }

        $batchHash = $request->input('batch_hash');
        if (!$batchHash) {
            $batchHash = hash('sha256', json_encode([
                'source' => $source,
                'user_id' => $userId ?? null,
                'events' => $sanitizedEvents,
            ]));
        }

        // Check for duplicates using batch hash
        try {
            $existing = TelemetryEvent::where('batch_hash', $batchHash)->first();
            if ($existing) {
                Log::info('[TELEMETRY] Duplicate batch detected', [
                    'source' => $source,
                    'user_id' => $userId ?? 'unknown',
                    'event_count' => count($sanitizedEvents),
                    'batch_hash' => substr($batchHash, 0, 8) . '...'
                ]);

                return response()->json([
                    'status' => 'ok',
                    'received' => 0,
                    'duplicate' => true,
                    'message' => 'Batch already processed'
                ]);
            }
        } catch (\Throwable $e) {
            Log::error('[TELEMETRY] Duplicate check failed', [
                'error' => $e->getMessage(),
                'batch_hash' => substr($batchHash, 0, 8) . '...'
            ]);
            // Continue processing - better to duplicate than to lose data
        }

        // P0-G Part D / CR-X Tranche 1A: Per-event idempotency via event_id.
        // Extract event_id from the first event's metadata for storage.
        // Historical events without event_id remain compatible (NULL event_id).
        //
        // RACE-SAFETY: The pre-check (where('event_id')->first()) was removed
        // because it was (a) TOCTOU-vulnerable and (b) not scoped by
        // organization_id. The DB composite unique index
        // uniq_telemetry_org_event_id on (organization_id, event_id) is the
        // final authority. Duplicate replays are caught in the insert catch
        // block below and converted to idempotent success.
        $eventId = null;
        $firstEventForId = $sanitizedEvents[0] ?? [];
        $firstEventMetaForId = $firstEventForId['metadata'] ?? [];
        if (is_array($firstEventMetaForId) && !empty($firstEventMetaForId['event_id'])) {
            $eventId = $firstEventMetaForId['event_id'];
        }

        // Extract session_id and editor_source from first event
        $firstEvent = $sanitizedEvents[0] ?? [];
        $metadata = $firstEvent['metadata'] ?? [];
        $sessionId = $metadata['session_id'] ?? null;

        // Extract editor_source with proper Devin/Windsurf/Cursor classification
        // Priority: product-specific signals > generic source field
        $editorSource = $this->resolveEditorSource($metadata, $source);

        // PHASE 2+3: SERVER-AUTHORITATIVE IDENTITY
        // Initialize session metadata from first event BEFORE applying identity
        $firstEventMeta = $sanitizedEvents[0]['metadata'] ?? [];
        if (!is_array($firstEventMeta)) {
            $firstEventMeta = [];
        }
        $sessionMetadata = $firstEventMeta;

        // Resolve bearer token using shared authority
        $tokenResolvedOrganizationId = null;
        $tokenResolvedDeveloperId = null;
        $tokenResolvedInstallationId = null;
        $bearerToken = $request->bearerToken();
        $resolvedApiToken = null;

        if ($bearerToken) {
            try {
                $resolvedApiToken = $this->resolveToken($bearerToken);

                if ($resolvedApiToken) {
                    $tokenResolvedOrganizationId = $resolvedApiToken->organization_id;
                    $tokenResolvedDeveloperId = $this->deriveDeveloperId($resolvedApiToken);
                    $tokenResolvedInstallationId = $resolvedApiToken->installation_id;

                    Log::info('[TELEMETRY] Resolved identity from API token', [
                        'token_id' => $resolvedApiToken->id,
                        'developer_id' => $tokenResolvedDeveloperId,
                        'organization_id' => $tokenResolvedOrganizationId,
                    ]);
                } else {
                    Log::warning('[TELEMETRY] Invalid or expired API token');
                }
            } catch (\Throwable $e) {
                Log::error('[TELEMETRY] Failed to resolve API token', [
                    'error' => $e->getMessage()
                ]);
            }
        }

        // PHASE 3: Version authority — inspect top-level and ALL event metadata versions
        $extensionVersion = $request->input('extension_version');
        if (!$extensionVersion) {
            $extensionVersion = $firstEventMeta['extension_version'] ?? null;
        }
        // Also inspect all event metadata for version declarations
        $anyEventV040 = false;
        foreach ($sanitizedEvents as $evt) {
            $evtMeta = $evt['metadata'] ?? [];
            if (is_array($evtMeta) && isset($evtMeta['extension_version'])) {
                if (version_compare($evtMeta['extension_version'], '0.4.0', '>=')) {
                    $anyEventV040 = true;
                }
            }
        }
        $declaredV040 = ($extensionVersion && version_compare($extensionVersion, '0.4.0', '>=')) || $anyEventV040;

        // FAIL CLOSED: 0.4.0+ without valid token must be rejected
        if (!$resolvedApiToken && $declaredV040) {
            Log::warning('[TELEMETRY] Rejecting unauthenticated 0.4.0+ telemetry', [
                'extension_version' => $extensionVersion,
                'any_event_v040' => $anyEventV040,
                'source' => $source,
            ]);
            return response()->json([
                'status' => 'error',
                'message' => 'Authentication required for extension version 0.4.0+. Provide a valid bearer token.',
                'error_code' => 'AUTH_REQUIRED_V040'
            ], 401);
        }

        // SERVER-AUTHORITATIVE IDENTITY OVERRIDE (applied exactly once)
        if ($resolvedApiToken) {
            // PHASE 3: Fail-closed installation rules
            $topLevelInstallationId = $request->input('installation_id');
            $firstEventInstallationId = $firstEventMeta['installation_id'] ?? null;

            // Both top-level and first event installation_id are required for 0.4.0+
            if ($tokenResolvedInstallationId) {
                if (!$topLevelInstallationId || !$firstEventInstallationId) {
                    Log::warning('[TELEMETRY] Missing installation_id for authenticated 0.4.0+ telemetry', [
                        'has_top_level' => !empty($topLevelInstallationId),
                        'has_first_event' => !empty($firstEventInstallationId),
                    ]);
                    return response()->json([
                        'status' => 'error',
                        'message' => 'Installation ID is required for authenticated telemetry.',
                        'error_code' => 'INSTALLATION_ID_MISMATCH'
                    ], 403);
                }
                if ($topLevelInstallationId !== $tokenResolvedInstallationId || $firstEventInstallationId !== $tokenResolvedInstallationId) {
                    Log::warning('[TELEMETRY] Installation ID mismatch — rejecting', [
                        'top_level_matches' => $topLevelInstallationId === $tokenResolvedInstallationId,
                        'first_event_matches' => $firstEventInstallationId === $tokenResolvedInstallationId,
                    ]);
                    return response()->json([
                        'status' => 'error',
                        'message' => 'Installation ID mismatch',
                        'error_code' => 'INSTALLATION_ID_MISMATCH'
                    ], 403);
                }
            }

            // Override organization_id
            $targetOrganizationId = $tokenResolvedOrganizationId;

            // Override record user_id to canonical developer_id
            $userId = $tokenResolvedDeveloperId;

            // Apply server-authoritative identity to session metadata exactly once
            $sessionMetadata['developer_id'] = $tokenResolvedDeveloperId;
            $sessionMetadata['organization_id'] = $tokenResolvedOrganizationId;
            $sessionMetadata['team_id'] = null;
            $sessionMetadata['identity_source'] = 'backend_claimed';
            $sessionMetadata['identity_schema_version'] = 1;
            $sessionMetadata['installation_id'] = $tokenResolvedInstallationId;

            // Write authoritative identity into every sanitized event metadata
            foreach ($sanitizedEvents as &$evt) {
                if (!isset($evt['metadata']) || !is_array($evt['metadata'])) {
                    $evt['metadata'] = [];
                }
                $evt['metadata']['developer_id'] = $tokenResolvedDeveloperId;
                $evt['metadata']['organization_id'] = $tokenResolvedOrganizationId;
                $evt['metadata']['team_id'] = null;
                $evt['metadata']['identity_source'] = 'backend_claimed';
                $evt['metadata']['identity_schema_version'] = 1;
                $evt['metadata']['installation_id'] = $tokenResolvedInstallationId;
            }
            unset($evt);

            Log::info('[TELEMETRY] Applied server-authoritative identity', [
                'developer_id' => $tokenResolvedDeveloperId,
                'organization_id' => $tokenResolvedOrganizationId,
            ]);
        } elseif ($organizationId) {
            // Option A: organization_id provided (preferred for testing)
            $targetOrganizationId = $organizationId;
            Log::info('[TELEMETRY] Using provided organization_id', [
                'organization_id' => $organizationId,
                'user_id' => $userId
            ]);
        } elseif ($userId) {
            // Option C: user_id provided → find user and use their organization
            $user = DB::table('users')->where('github_id', $userId)->first();
            if ($user && $user->organization_id) {
                $targetOrganizationId = $user->organization_id;
                Log::info('[TELEMETRY] Resolved organization from user', [
                    'user_id' => $userId,
                    'organization_id' => $targetOrganizationId
                ]);
            } else {
                // User not found or has no org → fallback to ChaosMonkey
                $chaosMonkeyOrg = DB::table('organizations')->where('slug', 'chaosmonkey')->first();
                if (!$chaosMonkeyOrg) {
                    // Fresh installs have no legacy fallback org, so
                    // unauthenticated telemetry cannot be attributed.
                    // Deny it instead of failing with a 500.
                    Log::warning('[TELEMETRY] Rejecting unauthenticated telemetry: no fallback organization', [
                        'user_id' => $userId,
                    ]);

                    return response()->json([
                        'status' => 'error',
                        'message' => 'Telemetry ingestion requires a valid bearer token.',
                        'error_code' => 'AUTH_REQUIRED'
                    ], 401);
                }
                $targetOrganizationId = $chaosMonkeyOrg->id;
                Log::warning('[TELEMETRY] User not found, fell back to ChaosMonkey', [
                    'user_id' => $userId,
                    'fallback_organization_id' => $targetOrganizationId
                ]);
            }
        } else {
            // Option D: Neither provided → resolve sole organization for single-tenant pilot
            $orgCount = DB::table('organizations')->count();
            if ($orgCount === 1) {
                $soleOrg = DB::table('organizations')->first();
                $targetOrganizationId = $soleOrg->id;
                Log::info('[TELEMETRY] Using sole organization (single-tenant pilot fallback)', [
                    'organization_id' => $targetOrganizationId,
                    'organization_name' => $soleOrg->name,
                    'source' => $source
                ]);
            } elseif ($orgCount === 0) {
                Log::error('[TELEMETRY] No organizations found, cannot attribute telemetry', [
                    'source' => $source,
                ]);
                return response()->json([
                    'status' => 'error',
                    'message' => 'No organizations available for telemetry attribution',
                    'error_code' => 'NO_ORGANIZATIONS'
                ], 500);
            } else {
                Log::error('[TELEMETRY] Multiple organizations found but no org context provided', [
                    'org_count' => $orgCount,
                    'source' => $source,
                ]);
                return response()->json([
                    'status' => 'error',
                    'message' => 'Multiple organizations exist but no organization context was provided. Supply an API token, organization_id, or user_id.',
                    'error_code' => 'AMBIGUOUS_ORGANIZATION'
                ], 400);
            }
        }

        // Prepare database record
        $recordData = [
            'user_id' => $userId,
            'organization_id' => $targetOrganizationId, // ALWAYS set (never NULL)
            'session_id' => $sessionId,
            'source' => $source,
            'editor_source' => $editorSource,
            'event_type' => $firstEvent['event_type'] ?? 'unknown',
            'count' => $firstEvent['count'] ?? 0,
            'duration_ms' => $firstEvent['duration_ms'] ?? null,
            'timestamp' => $firstEvent['timestamp'] ?? now(),
            'metadata' => $sessionMetadata,
            'payload' => $sanitizedEvents,
            'batch_hash' => $batchHash,
            'event_id' => $eventId, // P0-G: nullable for historical compatibility
            'session_prs_created' => $sessionMetadata['session_prs_created'] ?? 0,
            'session_prs_merged' => $sessionMetadata['session_prs_merged'] ?? 0,
            'session_pr_reopen_count' => $sessionMetadata['session_pr_reopen_count'] ?? 0,
            'session_deployment_successes' => $sessionMetadata['session_deployment_successes'] ?? 0,
        ];

        // Insert with comprehensive error handling
        try {
            $record = TelemetryEvent::create($recordData);
            
            Log::info('[TELEMETRY] Successfully stored', [
                'source' => $source,
                'user_id' => $userId ?? 'unknown',
                'session_id' => $sessionId,
                'event_count' => count($sanitizedEvents),
                'record_id' => $record->id,
                'batch_hash' => substr($batchHash, 0, 8) . '...'
            ]);

            return response()->json([
                'status' => 'ok',
                'received' => count($sanitizedEvents),
                'duplicate' => false,
                'record_id' => $record->id,
                'session_id' => $sessionId
            ]);

        } catch (\Illuminate\Database\QueryException $e) {
            Log::error('[TELEMETRY] Database insertion failed', [
                'error' => $e->getMessage(),
                'sql_state' => $e->getCode(),
                'source' => $source,
                'event_count' => count($sanitizedEvents),
                'batch_hash' => substr($batchHash, 0, 8) . '...'
            ]);

            // Distinguish unique constraint (duplicate) from foreign key violation.
            // CR-X Tranche 1A: The DB composite unique index
            // uniq_telemetry_org_event_id on (organization_id, event_id) is the
            // race-safe authority. We distinguish event_id duplicates from
            // batch_hash duplicates by inspecting the SQLite error message.
            $isForeignKeyViolation = str_contains($e->getMessage(), 'FOREIGN KEY constraint failed')
                || str_contains($e->getMessage(), 'foreign key constraint');
            $isUniqueConstraint = str_contains($e->getMessage(), 'UNIQUE constraint failed');
            $isEventIdUnique = $isUniqueConstraint
                && str_contains($e->getMessage(), 'event_id')
                && !$isForeignKeyViolation;

            if ($isEventIdUnique) {
                Log::info('[TELEMETRY] Duplicate event_id caught by DB unique constraint', [
                    'event_id' => $eventId,
                    'organization_id' => $targetOrganizationId ?? null,
                ]);
                return response()->json([
                    'status' => 'ok',
                    'received' => 0,
                    'duplicate' => true,
                    'message' => 'Event already processed (event_id idempotency)'
                ]);
            }

            if ($isUniqueConstraint && !$isForeignKeyViolation) {
                return response()->json([
                    'status' => 'ok',
                    'received' => 0,
                    'duplicate' => true,
                    'message' => 'Duplicate batch detected'
                ]);
            }

            if ($isForeignKeyViolation) {
                Log::error('[TELEMETRY] Foreign key constraint failed — organization_id or user_id does not exist', [
                    'organization_id' => $targetOrganizationId ?? null,
                    'user_id' => $userId ?? null,
                ]);
                return response()->json([
                    'status' => 'error',
                    'message' => 'Foreign key constraint failed: referenced organization or user does not exist',
                    'received' => 0,
                    'error_code' => 'FOREIGN_KEY_VIOLATION'
                ], 422);
            }

            return response()->json([
                'status' => 'error',
                'message' => 'Database insertion failed',
                'received' => 0,
                'error_code' => 'DB_ERROR'
            ], 500);

        } catch (\Throwable $e) {
            Log::error('[TELEMETRY] Unexpected error during insertion', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
                'source' => $source,
                'event_count' => count($sanitizedEvents)
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'Unexpected error during processing',
                'received' => 0,
                'error_code' => 'UNEXPECTED_ERROR'
            ], 500);
        }
    }

    /**
     * CR-X P0.2: Telemetry-attributed repository identities.
     *
     * Returns unique git_repo_url values from telemetry_events metadata.
     * This is the TELEMETRY REPO AUTHORITY — distinct from GitHub
     * engineering-evidence repos returned by /api/repositories.
     *
     * A pilot does NOT need GitHub engineering integration to filter
     * IDE telemetry by repository. This endpoint serves those repos.
     *
     * Public (no auth): telemetry repo identity is derived from IDE
     * extension attribution, not GitHub OAuth scope.
     */
    public function repos(Request $request)
    {
        try {
            // CR-X 2C: Org-scoped telemetry-derived repository inventory.
            // Uses buildCanonicalQuery for org isolation (SimpleTokenAuth resolves
            // the acting user's organization).  No GitHub OAuth required —
            // repo identity comes from telemetry metadata git_repo_url.
            $query = $this->buildCanonicalQuery($request);

            // Canonical sessions derive git_repo_url from payload[0].metadata
            // merged over row metadata (see returnSessionFormat). This endpoint
            // must use the same authority or the header count diverges from the
            // PI repository insight (13 vs 21 on Local).
            $rawRepos = (clone $query)
                ->selectRaw("DISTINCT COALESCE(
                    json_extract(payload, '$[0].metadata.git_repo_url'),
                    json_extract(metadata, '$.git_repo_url')
                ) as repo_url")
                ->pluck('repo_url')
                ->filter(fn($v) => is_string($v) && $v !== '')
                ->unique()
                ->values()
                ->all();

            // Normalize each raw URL to canonical owner/repo form
            $normalized = [];
            $seen = [];
            foreach ($rawRepos as $raw) {
                $norm = $this->normalizeRepoUrlForCanonical($raw);
                if ($norm && !isset($seen[$norm])) {
                    $seen[$norm] = true;
                    $normalized[] = $norm;
                }
            }

            usort($normalized, fn($a, $b) => strcmp($a, $b));

            return response()->json([
                'repositories' => $normalized,
                'total_count' => count($normalized),
                'source' => 'telemetry',
            ]);
        } catch (HttpResponseException $e) {
            // K1B: intentional HTTP rejections (e.g. INVALID_COHORT) must
            // reach the client — never collapse into a 500.
            throw $e;
        } catch (\Throwable $e) {
            Log::error('[TELEMETRY_REPOS] Query failed', [
                'error' => $e->getMessage(),
            ]);
            return response()->json([
                'repositories' => [],
                'total_count' => 0,
                'source' => 'telemetry',
                'error' => 'Internal server error',
            ], 500);
        }
    }

    /**
     * Apply the canonical read-side organization scope to a telemetry query.
     *
     * Mirrors the org filter in buildCanonicalQuery(): in Local Lab mode
     * (APP_ENV=local) all organizations are visible; otherwise the request
     * is constrained to the authenticated user's organization (resolved by
     * SimpleTokenAuth) and fails closed when no organization can be proven.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query
     */
    private function applyReadOrgScope($query, Request $request): void
    {
        if (config('app.env') === 'local') {
            // Local Lab: include all organizations — full historical population
            return;
        }

        $organizationId = $request->get('authenticated_user')?->organization_id;
        if ($organizationId) {
            $query->where('organization_id', $organizationId);
        } else {
            // Fail closed: no provable organization → empty result set
            $query->whereRaw('1 = 0');
        }
    }

    public function index(Request $request)
    {
        try {
            // Auth required via SimpleTokenAuth; results are org-scoped below.
            $limit = (int) $request->query('limit', 100);
            $limit = max(1, min($limit, 500)); // Cap at 500 to prevent overload
            $source = $request->query('source');
            $since = $request->query('since');
            $eventType = $request->query('event_type');
            $from = $request->query('from'); // ISO date string
            $to = $request->query('to'); // ISO date string
            
            // Validate date parameters to prevent errors
            if (!empty($from)) {
                try {
                    Carbon::parse($from);
                } catch (\Throwable $e) {
                    return response()->json(['error' => 'Invalid from date format'], 400);
                }
            }
            
            if (!empty($to)) {
                try {
                    Carbon::parse($to);
                } catch (\Throwable $e) {
                    return response()->json(['error' => 'Invalid to date format'], 400);
                }
            }
        
        // Session analytics mode: only return session-eligible events (session_id IS NOT NULL)
        // This prevents orphan events from polluting session dashboards
        // Can be overridden with ?include_orphans=true for debugging
        $sessionAnalyticsMode = $request->query('session_analytics', 'true') === 'true';
        $includeOrphans = $request->query('include_orphans', 'false') === 'true';

        // Start with all telemetry events, ordered by newest first
        // CRITICAL: When event_type is NOT provided, we return ALL event types (file_edit, ai_accept, commit, session, etc.)
        // Only filter by event_type if explicitly requested via query parameter
        $query = TelemetryEvent::query()->orderByDesc('timestamp');

        // Organization scope — same rules as buildCanonicalQuery():
        // Local Lab sees all orgs; otherwise constrained to the
        // authenticated user's organization (fails closed).
        $this->applyReadOrgScope($query, $request);

        if (!empty($source)) {
            $query->where('source', $source);
        }

        // Only filter by event_type if explicitly provided in the request
        // If event_type is NOT provided, all event types are returned (including session events)
        if (!empty($eventType)) {
            $query->where('event_type', $eventType);
            
            // For session events, automatically filter out legacy interval segments
            // NOTE: Older extension versions emitted 30-second "interval" session events.
            // As of extension 0.3.0, we only use metadata.segment_type = "session" for session metrics.
            // Legacy "interval" segments are ignored.
            // NOTE: sessionEvents() scope now also applies sessionEligible() internally
            if ($eventType === 'session') {
                $query->sessionEvents();
            }
        }
        // NOTE: If event_type is NOT provided, no event_type filter is applied,
        // so the query returns ALL event types (file_edit, ai_accept, commit, session, etc.)

        // CRITICAL: Use explicit from/to date range if provided (respects user-selected time filter)
        // Otherwise fall back to 'since' parameter for backward compatibility
        if (!empty($from) && !empty($to)) {
            try {
                $fromDate = Carbon::parse($from);
                $toDate = Carbon::parse($to);
                $query->whereBetween('timestamp', [$fromDate, $toDate]);
                
                Log::info('Telemetry query using explicit date range', [
                    'from' => $fromDate->toISOString(),
                    'to' => $toDate->toISOString(),
                ]);
            } catch (\Throwable $e) {
                Log::warning('Failed to parse from/to dates, falling back to since parameter', [
                    'from' => $from,
                    'to' => $to,
                    'error' => $e->getMessage(),
                ]);
                // Fall through to 'since' parameter handling
                $sinceTimestamp = $this->resolveSinceParameter($since);
                if ($sinceTimestamp) {
                    $query->where('timestamp', '>=', $sinceTimestamp);
                }
            }
        } else {
            // Backward compatibility: use 'since' parameter if from/to not provided
            $sinceTimestamp = $this->resolveSinceParameter($since);
            if ($sinceTimestamp) {
                $query->where('timestamp', '>=', $sinceTimestamp);
            }
        }

        // Execute query and get events
        $events = $query
            ->limit($limit)
            ->get();

        // CRITICAL: Count event types BEFORE mapping to verify what's being returned
        // This helps diagnose if session events are being excluded
        $eventTypeCounts = $events
            ->groupBy('event_type')
            ->map->count()
            ->toArray();

        \Log::debug('TelemetryController@index event_type counts', [
            'source' => $request->get('source'),
            'from' => $request->get('from'),
            'to' => $request->get('to'),
            'event_type_param' => $request->get('event_type'),
            'event_type_counts' => $eventTypeCounts,
            'total' => $events->count(),
            'limit' => $limit,
        ]);

        // Map events to response format
        $mappedEvents = $events->map(function (TelemetryEvent $event) {
            $metadata = $this->sanitizeMetadata($event->metadata ?? []);

            // Debug logging: Log metadata keys for visibility (does not change response)
            Log::info('Telemetry metadata keys', [
                'id' => $event->id ?? null,
                'event_type' => $event->event_type ?? null,
                'session_id' => $event->session_id ?? null,
                'keys' => is_array($event->metadata ?? null)
                    ? array_keys($event->metadata)
                    : null,
            ]);

            return [
                'id' => $event->id,
                'organization_id' => $event->organization_id,
                'source' => $event->source,
                'user_id' => $event->user_id,
                'session_id' => $event->session_id,  // Primary join key for session correlation
                'event_type' => $event->event_type,
                'count' => $event->count,
                'duration_ms' => $event->duration_ms,
                'timestamp' => optional($event->timestamp)->toISOString(),
                'metadata' => $metadata,
                'tool' => $this->resolvePrimaryTool($metadata ?? [], $event->tool, $event->source, $event->editor_source),
                'host_editor' => $this->resolveHostEditor($metadata ?? [], $event->source, $event->editor_source),
            ];
        });

        // Log read with session analytics info
        Log::info('Telemetry read', [
            'count' => $mappedEvents->count(),
            'source' => $source,
            'since' => $since,
            'limit' => $limit,
            'session_analytics_mode' => $sessionAnalyticsMode && !$includeOrphans,
            'include_orphans' => $includeOrphans,
        ]);

        return response()->json($mappedEvents);
        
        } catch (\Throwable $e) {
            Log::error('Telemetry index endpoint error', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            return response()->json([
                'error' => 'Internal server error',
                'message' => 'Failed to fetch telemetry events'
            ], 500);
        }
    }

    /**
     * Get orphan rate statistics for monitoring/admin dashboards
     * 
     * Query parameters:
     * - days: Time window in days (default: 7, options: 7, 30, "all")
     * 
     * Returns:
     * - stats.orphan_count: Number of events without session_id in the window
     * - stats.total_count: Total number of events in the window
     * - stats.session_eligible_count: Events that can be used in session analytics
     * - stats.orphan_rate_percent: Percentage of orphan events
     * - stats.exceeds_threshold: Whether orphan rate exceeds warning threshold (5%)
     * - stats.window_days: The time window used (7, 30, or "all")
     * - stats.calculated_at: Timestamp of calculation
     * - breakdown: Count of orphan events by event_type (windowed)
     * - recommendations: Actionable recommendations based on the orphan rate
     * 
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function orphanStats(Request $request)
    {
        // Parse days parameter
        // Default: 7 days
        // Options: 7, 30, "all" (null internally)
        $daysParam = $request->query('days', '7');
        
        if ($daysParam === 'all') {
            $days = null;
        } else {
            $days = (int) $daysParam;
            // Validate: only allow 7 or 30 as explicit values
            if (!in_array($days, [7, 30], true)) {
                $days = 7; // Default to 7 if invalid
            }
        }
        
        // Organization scope — same rules as buildCanonicalQuery():
        // Local Lab may pass an explicit organization_id; otherwise the
        // scope comes from the authenticated user only. Never trust a
        // client-supplied organization_id outside Local Lab, and fail
        // closed to an impossible org id when none can be proven.
        if (config('app.env') === 'local') {
            $organizationId = $request->input('organization_id');
        } else {
            $organizationId = $request->get('authenticated_user')?->organization_id ?? -1;
        }
        $stats = TelemetryEvent::getOrphanRateStats($days, $organizationId);
        $breakdown = TelemetryEvent::getOrphanBreakdown($days, $organizationId);

        Log::debug('[TelemetryController] Orphan stats requested', [
            'organization_id' => $organizationId
        ]);
        
        Log::info('[TelemetryController] Orphan stats requested', [
            'window_days' => $stats['window_days'],
            'orphan_rate_percent' => $stats['orphan_rate_percent'],
            'exceeds_threshold' => $stats['exceeds_threshold'],
        ]);
        
        return response()->json([
            'stats' => $stats,
            'breakdown' => $breakdown,
            'recommendations' => $this->getOrphanRecommendations($stats),
        ]);
    }

    /**
     * Get normalized session data for dashboards and analytics
     * 
     * Returns one row per session (event_type=session only) with a stable,
     * flattened schema. Missing fields are safely defaulted.
     * 
     * Query params:
     * - days: 7|30|all (default: all)
     * - user_id: optional filter
     * - git_repo_url: optional exact match (in metadata)
     * - git_branch: optional exact match (in metadata)
     * - quality_band: high|medium|low (optional, in metadata)
     * - flow_profile: idle-heavy|debug-heavy|terminal-heavy|coding-heavy|mixed (optional)
     * - has_ai: true|false (optional, based on ai_burst_count > 0)
     * - page: default 1
     * - per_page: default 50, max 200
     * - include_raw_metadata: true|false (default false)
     * 
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function sessions(Request $request)
    {
        try {
            // Parse query parameters
            $daysParam = $request->query('days', 'all');
            $userId = $request->query('user_id');
            $gitRepoUrl = $request->query('git_repo_url');
            $gitBranch = $request->query('git_branch');
            $qualityBand = $request->query('quality_band');
            $flowProfile = $request->query('flow_profile');
            $hasAi = $request->query('has_ai');
            $page = max(1, (int) $request->query('page', 1));
            $perPage = min(1000, max(1, (int) $request->query('per_page', 50))); // CR-X Phase 3: increased cap from 200 to 1000
            $includeRawMetadata = $request->query('include_raw_metadata', 'false') === 'true';
        
        // Authenticated user is resolved by SimpleTokenAuth. The org scope
        // below is the tenant boundary; an explicit ?user_id= remains a
        // caller-chosen filter but the caller is never silently narrowed
        // to their own rows (that legacy behavior only made sense while
        // the endpoint was unauthenticated).
        $authenticatedUserId = $request->get('authenticated_user')?->id;

        // Build base query: session events only, excluding orphans
        $query = TelemetryEvent::where('event_type', 'session');

        // Organization scope — same rules as buildCanonicalQuery():
        // Local Lab sees all orgs; otherwise constrained to the
        // authenticated user's organization (fails closed).
        $this->applyReadOrgScope($query, $request);

        Log::debug('[TelemetryController] Sessions access', [
            'authenticated_user_id' => $authenticatedUserId,
            'query_user_id' => $userId,
            'final_user_id' => $userId
        ]);
        
        // Apply time window filter
        if ($daysParam !== 'all') {
            $days = (int) $daysParam;
            if (!in_array($days, [7, 30], true)) {
                $days = 7;
            }
            $query->where('timestamp', '>=', now()->subDays($days));
        }
        // If days=all, no time filter applied (all data)
        
        // Apply user_id filter (column)
        if ($userId !== null && $userId !== '') {
            $query->where('user_id', $userId);
        }
        
        // Apply metadata filters using JSON extraction
        // Note: Using whereRaw for SQLite/MySQL JSON compatibility
        if ($gitRepoUrl !== null && $gitRepoUrl !== '') {
            $query->whereRaw("json_extract(metadata, '$.git_repo_url') = ?", [$gitRepoUrl]);
        }
        
        if ($gitBranch !== null && $gitBranch !== '') {
            $query->whereRaw("json_extract(metadata, '$.git_branch') = ?", [$gitBranch]);
        }
        
        if ($qualityBand !== null && in_array($qualityBand, ['high', 'medium', 'low'], true)) {
            $query->whereRaw("json_extract(metadata, '$.session_quality_band') = ?", [$qualityBand]);
        }
        
        if ($flowProfile !== null && in_array($flowProfile, ['idle-heavy', 'debug-heavy', 'terminal-heavy', 'coding-heavy', 'mixed'], true)) {
            $query->whereRaw("json_extract(metadata, '$.flow_profile') = ?", [$flowProfile]);
        }
        
        if ($hasAi !== null) {
            if ($hasAi === 'true') {
                $query->whereRaw("COALESCE(json_extract(metadata, '$.ai_burst_count'), 0) > 0");
            } else {
                $query->whereRaw("COALESCE(json_extract(metadata, '$.ai_burst_count'), 0) = 0");
            }
        }
        
        // Sort newest first
        $query->orderBy('timestamp', 'desc');
        
        // Get total count before pagination
        $total = $query->count();
        
        // Apply pagination
        $offset = ($page - 1) * $perPage;
        $sessions = $query->skip($offset)->take($perPage)->get();
        
        // Map to normalized schema
        $normalizedSessions = $sessions->map(function ($session) use ($includeRawMetadata, $authenticatedUserId) {
            return $this->normalizeSessionRow($session, $includeRawMetadata, $authenticatedUserId);
        });
        
        // Build definitions object (consolidated from metadata definition fields)
        $definitions = [
            'ai_usage_duration_definition' => 'span_between_first_and_last_ai_burst',
            'ai_intensity_definition' => 'ai_burst_chars_total divided by ai_active_span_ms (span between first/last AI burst)',
            'rework_definition' => 'removed/added using chars_removed_total_est (range-based estimate) over chars_added_total (exact)',
            'change_magnitude_definition' => 'added: exact_from_inserted_text; removed: estimated_from_change_range',
            'terminal_definition' => 'active_time approximated via onDidChangeActiveTerminal intervals; no commands/titles/cwd captured',
            'save_format_definition' => 'format_likely inferred when a text edit occurs within 250ms after onWillSave (max 1 per will-save)',
            'flow_definition' => 'profile chosen by ordered rules: idle>debug>terminal>coding>mixed using ratios of duration_ms',
        ];
        
        Log::info('[TelemetryController] Sessions query', [
            'days' => $daysParam,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'returned' => $normalizedSessions->count(),
        ]);
        
        return response()->json([
            'data' => $normalizedSessions,
            'definitions' => $definitions,
            'pagination' => [
                'current_page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'last_page' => (int) ceil($total / $perPage),
            ],
            'filters_applied' => [
                'days' => $daysParam,
                'user_id' => $userId,
                'git_repo_url' => $gitRepoUrl,
                'git_branch' => $gitBranch,
                'quality_band' => $qualityBand,
                'flow_profile' => $flowProfile,
                'has_ai' => $hasAi,
            ],
        ]);
        
        } catch (\Throwable $e) {
            Log::error('Telemetry sessions endpoint error', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            return response()->json([
                'error' => 'Internal server error',
                'message' => 'Failed to fetch session data'
            ], 500);
        }
    }
    
    /**
     * Normalize a session row to a stable, flattened schema
     * 
     * Missing fields are safely defaulted per type:
     * - Numbers: 0 (except nullable ones which are null)
     * - Arrays: []
     * - Objects: {}
     * - Strings: null
     * - Bands: null if score missing, else appropriate default
     * 
     * @param TelemetryEvent $session
     * @param bool $includeRawMetadata
     * @param int|null $authenticatedUserId
     * @return array
     */
    private function normalizeSessionRow(TelemetryEvent $session, bool $includeRawMetadata, ?int $authenticatedUserId = null): array
    {
        // Extract metadata from enriched payload first, fallback to metadata field
        $payloadMetadata = [];
        if ($session->payload) {
            // payload is already an array from Laravel casting
            $payload = is_string($session->payload) ? json_decode($session->payload, true) : $session->payload;
            if (isset($payload[0]['metadata'])) {
                $payloadMetadata = $payload[0]['metadata'];
            }
        }
        
        $metadata = array_merge(($session->metadata ?? []), $payloadMetadata);
        if (!is_array($metadata)) {
            $metadata = [];
        }
        
        // Helper to safely get metadata values with defaults
        $get = function ($key, $default = null) use ($metadata) {
            return $metadata[$key] ?? $default;
        };
        
        // Use shared resolver for primary tool and host editor
        $tool = $this->resolvePrimaryTool($metadata, $session->tool, $session->source, $session->editor_source);
        $hostEditor = $this->resolveHostEditor($metadata, $session->source, $session->editor_source);
        
        // CR-X P0: Determine operational mode from the resolved tool.
        // Delegated-agent sessions (claude_code, devin) do NOT produce
        // human IDE metrics (active_coding_duration_ms, file_edit events).
        // Skip per-session DB derivation queries for these workflows to
        // prevent N+1 query amplification on the sessions endpoint.
        $isDelegatedAgent = in_array($tool, ['claude_code', 'devin', 'windsurf'], true)
            // Agent-authored Cursor sessions (cursor-agent bridge) produce
            // verified agent edit spans, not human IDE activity — they must
            // never enter the human active-coding derivation path.
            || $session->source === 'cursor-agent';
        
        // Preserve source field for compatibility
        $source = $session->source ?? $get('source') ?? $hostEditor;
        $editorSource = $hostEditor;

        // Priority: authenticated user > database user_id > null
        // This ensures "anonymous" is never returned when user is authenticated
        $finalUserId = $authenticatedUserId;
        if ($finalUserId === null) {
            $finalUserId = $session->user_id;
            // Only return "anonymous" if no authenticated user and DB has "anonymous"
            // Otherwise, return null for unknown users
            if ($finalUserId === 'anonymous') {
                $finalUserId = 'anonymous';
            }
        }

        $normalized = [
            // DB columns
            'id' => $session->id,
            'organization_id' => $session->organization_id,
            'session_id' => $session->session_id ?? $get('session_id'),
            'timestamp' => optional($session->timestamp)->toISOString(),
            'duration_ms' => $session->duration_ms ?? 0,
            'user_id' => $finalUserId,
            
            // Tool identity fields (promoted to top-level for V2 normalization)
            'editor_source' => $editorSource,
            'source' => $source,
            'tool' => $tool,  // Primary tool/workflow (what produced the coding assistance)
            'host_editor' => $hostEditor,  // Host editor/shell where primary tool ran

            // Segment provenance — Cursor Agent bridge emits one row per
            // completed agent turn; session_id is the stable conversation ID.
            // Consumers can distinguish segments from conversations via these.
            'session_segment' => (bool) $get('session_segment', false),
            'segment_ordinal' => $get('segment_ordinal'),
            'is_final_segment' => (bool) $get('is_final_segment', false),
            'cursor_session_duration_ms' => $get('cursor_session_duration_ms'),
            'ai_authored' => $get('ai_authored'),
            'agent_verified' => $get('agent_verified'),

            // Common git context
            'git_repo_url' => $get('git_repo_url'),
            'git_branch' => $get('git_branch'),
            'session_commits' => $get('session_commits'),
            'session_has_commit_outcome' => $get('session_has_commit_outcome', false),
            
            // Core durations
            // CR-X P0: Skip computeActiveCodingDuration for delegated-agent sessions.
            // Terminal/delegated workflows (claude_code, devin) do not produce
            // human IDE file-edit events. Calling computeActiveCodingDuration
            // issues a per-session DB query that returns nothing, creating an
            // N+1 scalability problem at scale.
            'active_coding_duration_ms' => $isDelegatedAgent
                ? ($get('active_coding_duration_ms') ?? null)
                : $this->computeActiveCodingDuration($session->session_id, $get('active_coding_duration_ms')),
            'idle_time_ms' => (int) $get('idle_time_ms', 0),
            
            // AI fields (compute ai_burst_count if null)
            // CR-X P0: Skip computeAIBurstCount for delegated-agent sessions
            // when metadata already has a value. The metadata from the bridge
            // is authoritative for terminal sessions.
            'ai_burst_count' => $isDelegatedAgent
                ? ($get('ai_burst_count') ?? null)
                : $this->computeAIBurstCount($session->session_id, $get('ai_burst_count')),
            'ai_active_span_ms' => $get('ai_active_span_ms'), // null if no AI
            'ai_burst_chars_total' => (int) $get('ai_burst_chars_total', 0),
            'ai_burst_lines_total' => (int) $get('ai_burst_lines_total', 0),
            'ai_first_burst_at_ms' => $get('ai_first_burst_at_ms'),
            'ai_last_burst_at_ms' => $get('ai_last_burst_at_ms'),
            'ai_usage_duration_ms' => (int) $get('ai_usage_duration_ms', 0),
            'ai_chars_per_min' => $get('ai_chars_per_min'), // null if no AI
            'ai_intensity_band' => $get('ai_intensity_band', 'none'),
            
            // Time to first commit (compute if null)
            // CR-X P0: Skip computeTimeToFirstCommit for delegated-agent sessions
            // when metadata already has a value. Delegated agents may not have
            // commit events in the same way as IDE sessions.
            'time_to_first_commit_ms' => $isDelegatedAgent
                ? ($get('time_to_first_commit_ms') ?? null)
                : $this->computeTimeToFirstCommit($session->session_id, $get('time_to_first_commit_ms')),
            
            // Rework fields
            'session_rework_ratio_est' => $get('rework_ratio_est', 0),
            'rework_band' => $get('rework_band'),
            
            // Change magnitude
            'chars_added_total' => (int) $get('chars_added_total', 0),
            'chars_removed_total_est' => (int) $get('chars_removed_total_est', 0),
            'lines_added_total' => (int) $get('lines_added_total', 0),
            'lines_removed_total_est' => (int) $get('lines_removed_total_est', 0),
            'change_magnitude_clamped' => (bool) $get('change_magnitude_clamped', false),
            
            // Language mix
            'language_id_counts' => $get('language_id_counts', []),
            
            // Debug/terminal
            'debug_session_count' => (int) $get('debug_session_count', 0),
            'debug_time_ms' => (int) $get('debug_time_ms', 0),
            'terminal_open_count' => (int) $get('terminal_open_count', 0),
            'terminal_active_time_ms' => (int) $get('terminal_active_time_ms', 0),
            
            // Save fields
            // CR5 WS2 #12 P0-1: Preserve null for missing file_save_count.
            // (int) $get('file_save_count', 0) coerces absent to 0, conflating
            // "session saved zero files" with "field not instrumented".
            // Return null when absent so the frontend enrichment can distinguish.
            'file_save_count' => $get('file_save_count') !== null ? (int) $get('file_save_count') : null,
            'will_save_total_count' => (int) $get('will_save_total_count', 0),
            'will_save_format_likely_count' => (int) $get('will_save_format_likely_count', 0),
            
            // Workspace context
            'is_remote_workspace' => (bool) $get('is_remote_workspace', false),
            'remote_name' => $get('remote_name'),
            'is_multi_root_workspace' => (bool) $get('is_multi_root_workspace', false),
            'workspace_folder_count' => (int) $get('workspace_folder_count', 0),
            
            // Git diagnostics
            'git_context_status' => $get('git_context_status'),
            'git_context_reason' => $get('git_context_reason'),
            'git_context_resolution_ms' => $get('git_context_resolution_ms'),
            'git_context_attempts' => (int) $get('git_context_attempts', 0),
            'git_context_resolved_before_end' => $get('git_context_resolved_before_end'),
            
            // Quality
            'session_quality_score' => $get('session_quality_score'),
            'session_quality_band' => $get('session_quality_band'),
            'session_quality_factors' => $get('session_quality_factors', []),
            
            // Flow profile
            'focus_ratio' => $get('focus_ratio', 0),
            'debug_ratio' => $get('debug_ratio', 0),
            'terminal_ratio' => $get('terminal_ratio', 0),
            'idle_ratio' => $get('idle_ratio', 0),
            'flow_profile' => $get('flow_profile', 'mixed'),
            
            // Session end reason
            'end_reason' => $get('end_reason'),
            
            // Extension info
            'extension_version' => $get('extension_version'),
            'vscode_version' => $get('vscode_version'),
            
            // Simulation flags
            'simulated' => $get('simulated', false),
            'sim_dev' => $get('sim_dev'),
            'sim_email' => $get('sim_email'),
            
            // Time to first commit
            'time_to_first_commit_ms' => $get('time_to_first_commit_ms'),

            // Identity contract v1 — stable installation identity
            'installation_id' => $get('installation_id'),
            'developer_id' => $get('developer_id'),
            'team_id' => $get('team_id'),
            'identity_schema_version' => $get('identity_schema_version', 0),
            'identity_source' => $get('identity_source', 'legacy_unknown'),
        ];
        
        // Include raw metadata if requested
        if ($includeRawMetadata) {
            $normalized['raw_metadata'] = $metadata;
        }
        
        return $normalized;
    }

    /**
     * Get recommendations based on orphan rate
     * Recommendations reference the time window for actionability.
     * 
     * @param array $stats Orphan rate statistics (must include window_description)
     * @return array List of recommendations
     */
    private function getOrphanRecommendations(array $stats): array
    {
        $recommendations = [];
        $window = $stats['window_description'] ?? 'the selected period';
        
        if ($stats['orphan_count'] === 0) {
            $recommendations[] = "No orphan events detected in the {$window}. All events are session-eligible.";
            return $recommendations;
        }
        
        if ($stats['exceeds_threshold']) {
            $recommendations[] = "Orphan rate in the {$window} exceeds threshold ({$stats['threshold_percent']}%). Consider:";
            $recommendations[] = '- Investigating extension regressions that may have caused session_id to be missing';
            $recommendations[] = '- Running the session_id backfill migration for older events';
            $recommendations[] = '- Checking for older extension versions (< 0.3.0) still in the field';
            $recommendations[] = '- Archiving legacy events without session_id if they are no longer needed';
        } else {
            $recommendations[] = "Orphan rate in the {$window} is within acceptable threshold ({$stats['threshold_percent']}%).";
            $recommendations[] = 'Orphan events are excluded from session analytics by default.';
            $recommendations[] = 'No immediate action required.';
        }
        
        return $recommendations;
    }

    private function resolveSinceParameter(?string $since): ?Carbon
    {
        if (empty($since)) {
            return null;
        }

        try {
            if (preg_match('/^(\\d+)(d)$/i', $since, $matches)) {
                return Carbon::now()->subDays((int) $matches[1]);
            }

            if (preg_match('/^(\\d+)(h)$/i', $since, $matches)) {
                return Carbon::now()->subHours((int) $matches[1]);
            }

            if (preg_match('/^(\\d+)(m)$/i', $since, $matches)) {
                return Carbon::now()->subMinutes((int) $matches[1]);
            }

            return Carbon::parse($since);
        } catch (\Throwable $e) {
            Log::warning('Failed to parse since parameter for telemetry read', [
                'input' => $since,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    private function sanitizeMetadata($metadata): array
    {
        if (!is_array($metadata)) {
            return [];
        }

        $sensitiveKeys = [
            'file_path',
            'file',
            'path',
            'content',
            'code',
            'file_contents',
            'raw',
        ];

        $cleaned = Arr::except($metadata, $sensitiveKeys);

        foreach ($cleaned as $key => $value) {
            if (is_string($value)) {
                $cleaned[$key] = mb_substr($value, 0, 512);
            } elseif (is_array($value)) {
                $cleaned[$key] = $this->sanitizeMetadata($value);
            } else {
                $cleaned[$key] = $value;
            }
        }

        return $cleaned;
    }

    /**
     * Canonical Telemetry Analytics Layer
     * 
     * Returns aggregated telemetry metrics per tool and period.
     * This endpoint performs SQL aggregation on the backend to avoid
     * the 500-row limit and newest-first truncation issues.
     * 
     * This is the canonical analytics layer for:
     * - Productivity By Tool V3
     * - Productivity By Tool Classic (live mode)
     * - Future ROI calculations
     * - Future executive dashboards
     * 
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function aggregated(Request $request)
    {
        $startTime = microtime(true);
        
        try {
            // Validate and parse parameters
            $from = $request->query('from');
            $to = $request->query('to');
            $period = $request->query('period', 'week'); // day, week, month
            $tools = $request->query('tools'); // comma-separated list, or 'all'
            
            // Default to all historical data if no date range specified
            // Use 2020-01-01 for consistency with AI Ops, Performance Insights, and Productivity V3
            if (!$from || !$to) {
                $from = '2020-01-01';
                $to = Carbon::now()->toIso8601String();
            }
            
            $fromDate = Carbon::parse($from);
            $toDate = Carbon::parse($to);
            
            // Determine date grouping based on period
            // SQLite uses strftime instead of DATE_FORMAT
            $dateFormat = match($period) {
                'day' => '%Y-%m-%d',
                'month' => '%Y-%m',
                default => '%Y-%W', // week (ISO week)
            };
            
            // SQLite-compatible date format string
            $sqliteDateFormat = match($period) {
                'day' => '%Y-%m-%d',
                'month' => '%Y-%m',
                default => '%Y-%W', // week (ISO week)
            };
            
            // Build base query for session events only
            $query = TelemetryEvent::where('event_type', 'session')
                ->whereBetween('timestamp', [$fromDate, $toDate]);

            // Organization scope — same rules as buildCanonicalQuery():
            // Local Lab sees all orgs; otherwise constrained to the
            // authenticated user's organization (fails closed).
            $this->applyReadOrgScope($query, $request);

            // Count total records scanned (for metadata)
            $recordsScanned = (clone $query)->count();
            $sessionRowsScanned = $recordsScanned; // Same for session-only query
            
            // Apply tool filter if specified
            if ($tools && $tools !== 'all') {
                $toolList = explode(',', $tools);
                $query->where(function($q) use ($toolList) {
                    foreach ($toolList as $tool) {
                        $tool = trim($tool);
                        // Match either source or editor_source for tool attribution
                        $q->orWhere('source', $tool)
                          ->orWhere('editor_source', $tool);
                    }
                });
            }
            
            // Perform SQL aggregation with metadata-aware tool resolution
            // Use SQLite's strftime function for date formatting
            // SQL CASE for Claude Code detection: checks metadata.vscode_version, metadata.extension_version
            // Note: telemetry_events table has no 'tool' column, only source/editor_source
            $aggregated = $query->select([
                    DB::raw("CASE
                        WHEN json_extract(metadata, '$.tool') = 'claude_code'
                          OR json_extract(metadata, '$.vscode_version') = 'claude-code'
                          OR json_extract(metadata, '$.extension_version') LIKE '%cc-bridge%'
                          OR json_extract(metadata, '$.appName') LIKE '%Claude Code%'
                          OR COALESCE(editor_source, source) = 'claude-code'
                        THEN 'claude_code'
                        ELSE COALESCE(editor_source, source)
                    END as tool"),
                    DB::raw("strftime('{$sqliteDateFormat}', timestamp) as period"),
                    DB::raw('COUNT(*) as session_count'),
                    DB::raw('SUM(duration_ms) / 60000 as total_session_minutes'),
                    DB::raw('AVG(duration_ms) / 60000 as average_session_length_minutes'),
                    DB::raw('SUM(CASE WHEN duration_ms > 0 THEN duration_ms ELSE 0 END) / 60000 as total_duration_minutes'),
                ])
                ->groupBy('tool', 'period')
                ->orderBy('period', 'desc')
                ->orderBy('tool', 'asc')
                ->get();
            
            // Extract additional metrics from metadata (AI usage, active coding, etc.)
            // These require JSON extraction from the metadata column
            $results = [];
            $toolsReturned = [];
            
            foreach ($aggregated as $row) {
                $tool = $row->tool;
                
                // Normalize tool attribution: "extension" is not a tool
                // If source is "extension", use editor_source instead
                if ($tool === 'extension') {
                    // Skip extension as a tool - it's the transport layer
                    continue;
                }
                
                // Normalize tool names to canonical form
                $canonicalTool = $this->normalizeToolName($tool);
                
                if (!in_array($canonicalTool, $toolsReturned)) {
                    $toolsReturned[] = $canonicalTool;
                }
                
                // Query additional metrics for this tool+period combination
                // Pass the original tool value (before normalization) for accurate querying
                $additionalMetrics = $this->fetchAdditionalMetrics($tool, $row->period, $fromDate, $toDate, $sqliteDateFormat);
                
                $results[] = [
                    'tool' => $canonicalTool,
                    'period' => $row->period,
                    'session_count' => (int) $row->session_count,
                    'average_session_length_minutes' => round((float) $row->average_session_length_minutes, 2),
                    'total_session_minutes' => round((float) $row->total_session_minutes, 2),
                    'active_coding_time_minutes' => $additionalMetrics['active_coding_time_minutes'] ?? 0,
                    'ai_usage_duration_minutes' => $additionalMetrics['ai_usage_duration_minutes'] ?? 0,
                    'time_to_first_commit_minutes' => $additionalMetrics['time_to_first_commit_minutes'] ?? 0,
                    'ai_suggestions_accepted' => $additionalMetrics['ai_suggestions_accepted'] ?? 0,
                    'files_edited_per_session' => $additionalMetrics['files_edited_per_session'] ?? 0,
                    'commits_per_session' => $additionalMetrics['commits_per_session'] ?? 0,
                    'idle_time_minutes' => $additionalMetrics['idle_time_minutes'] ?? 0,
                    'focus_ratio' => $additionalMetrics['focus_ratio'] ?? 0,
                    'event_count' => $additionalMetrics['event_count'] ?? 0,
                    'coverage_pct' => $additionalMetrics['coverage_pct'] ?? 100,
                ];
            }
            
            $periodsReturned = array_unique(array_column($results, 'period'));
            
            $queryExecutionMs = round((microtime(true) - $startTime) * 1000, 2);
            
            Log::info('[TELEMETRY_AGGREGATED] Query executed', [
                'records_scanned' => $recordsScanned,
                'session_rows_scanned' => $sessionRowsScanned,
                'tools_returned' => count($toolsReturned),
                'periods_returned' => count($periodsReturned),
                'query_execution_ms' => $queryExecutionMs,
                'from' => $from,
                'to' => $to,
                'period' => $period,
            ]);
            
            return response()->json([
                'data' => $results,
                'metadata' => [
                    'records_scanned' => $recordsScanned,
                    'session_rows_scanned' => $sessionRowsScanned,
                    'tools_returned' => count($toolsReturned),
                    'periods_returned' => count($periodsReturned),
                    'query_execution_ms' => $queryExecutionMs,
                    'tools' => $toolsReturned,
                    'periods' => array_values($periodsReturned),
                    'from' => $from,
                    'to' => $to,
                    'period_granularity' => $period,
                ],
            ]);
            
        } catch (\Throwable $e) {
            Log::error('[TELEMETRY_AGGREGATED] Query failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            
            return response()->json([
                'error' => 'Internal server error',
                'message' => 'Failed to fetch aggregated telemetry data',
            ], 500);
        }
    }
    
    /**
     * Normalize tool name to canonical form
     * 
     * Maps various tool identifiers to canonical names:
     * - extension + editor_source -> editor_source
     * - vscode, visual-studio-code -> vscode
     * - cursor -> cursor
     * - windsurf -> windsurf
     * - claude-code -> claude_code
     * 
     * @param string $tool
     * @return string
     */
    private function normalizeToolName(string $tool): string
    {
        $tool = strtolower(trim($tool));
        
        // Skip extension as a tool
        if ($tool === 'extension') {
            return 'unknown';
        }
        
        // Normalize known tools
        $canonicalMap = [
            'devin' => 'devin',
            'cursor' => 'cursor',
            'windsurf' => 'windsurf',
            'vscode' => 'vscode',
            'visual-studio-code' => 'vscode',
            'claude-code' => 'claude_code',
            'claude_code' => 'claude_code',
            'codex' => 'codex',
            'codex-cli' => 'codex',
            'codex_cli' => 'codex',
            'openai-codex' => 'codex',
            'github-copilot' => 'github_copilot',
            'github_copilot' => 'github_copilot',
        ];
        
        return $canonicalMap[$tool] ?? $tool;
    }
    
    /**
     * Fetch additional metrics from metadata for a specific tool+period
     * 
     * This extracts metrics that are stored in the metadata JSON field:
     * - active_coding_duration_ms
     * - ai_usage_duration_ms
     * - time_to_first_commit_ms
     * - ai_burst_count
     * - file_save_count
     * - commit events (for commits_per_session)
     * - idle_time_ms
     * - focus_ratio
     * 
     * @param string $tool
     * @param string $period
     * @param Carbon $fromDate
     * @param Carbon $toDate
     * @param string $sqliteDateFormat
     * @return array
     */
    private function fetchAdditionalMetrics(string $tool, string $period, Carbon $fromDate, Carbon $toDate, string $sqliteDateFormat): array
    {
        try {
            $query = TelemetryEvent::where('event_type', 'session')
                ->whereBetween('timestamp', [$fromDate, $toDate])
                ->where(function($q) use ($tool) {
                    $q->where('source', $tool)
                      ->orWhere('editor_source', $tool);
                });
            
            // Add period filter
            $query->whereRaw("strftime('{$sqliteDateFormat}', timestamp) = ?", [$period]);
            
            $sessions = $query->get();
            
            if ($sessions->isEmpty()) {
                return [
                    'active_coding_time_minutes' => 0,
                    'ai_usage_duration_minutes' => 0,
                    'time_to_first_commit_minutes' => 0,
                    'ai_suggestions_accepted' => 0,
                    'files_edited_per_session' => 0,
                    'commits_per_session' => 0,
                    'idle_time_minutes' => 0,
                    'focus_ratio' => 0,
                    'event_count' => 0,
                    'coverage_pct' => 0,
                ];
            }
            
            $sessionCount = $sessions->count();
            $eventCount = TelemetryEvent::whereBetween('timestamp', [$fromDate, $toDate])
                ->where(function($q) use ($tool) {
                    $q->where('source', $tool)
                      ->orWhere('editor_source', $tool);
                })
                ->whereRaw("strftime('{$sqliteDateFormat}', timestamp) = ?", [$period])
                ->count();
            
            // Extract metrics from metadata using correct field names
            $activeCodingTotal = 0;
            $aiUsageTotal = 0;
            $ttfcTotal = 0;
            $ttfcCount = 0;
            $aiBurstTotal = 0;
            $filesEditedTotal = 0;
            $idleTimeTotal = 0;
            $focusRatioTotal = 0;
            $focusRatioCount = 0;
            
            foreach ($sessions as $session) {
                $metadata = [];
                if ($session->payload) {
                    $payload = is_string($session->payload) ? json_decode($session->payload, true) : $session->payload;
                    if (isset($payload[0]['metadata'])) {
                        $metadata = $payload[0]['metadata'];
                    }
                }
                $metadata = array_merge(($session->metadata ?? []), $metadata);
                
                $activeCodingTotal += $metadata['active_coding_duration_ms'] ?? 0;
                $aiUsageTotal += $metadata['ai_usage_duration_ms'] ?? 0;
                
                $ttfc = $metadata['time_to_first_commit_ms'] ?? null;
                if ($ttfc && $ttfc > 0) {
                    $ttfcTotal += $ttfc;
                    $ttfcCount++;
                }
                
                $aiBurstTotal += $metadata['ai_burst_count'] ?? 0;
                $filesEditedTotal += $metadata['file_save_count'] ?? 0;
                $idleTimeTotal += $metadata['idle_time_ms'] ?? 0;
                
                // Calculate focus_ratio if not directly stored
                $focusRatio = $metadata['focus_ratio'] ?? null;
                if ($focusRatio === null) {
                    $activeCoding = $metadata['active_coding_duration_ms'] ?? 0;
                    $idleTime = $metadata['idle_time_ms'] ?? 0;
                    $totalTime = $activeCoding + $idleTime;
                    if ($totalTime > 0) {
                        $focusRatio = $activeCoding / $totalTime;
                    }
                }
                if ($focusRatio !== null) {
                    $focusRatioTotal += $focusRatio;
                    $focusRatioCount++;
                }
            }
            
            // Count commit events for this tool+period to calculate commits_per_session
            $commitCount = TelemetryEvent::where('event_type', 'commit')
                ->whereBetween('timestamp', [$fromDate, $toDate])
                ->where(function($q) use ($tool) {
                    $q->where('source', $tool)
                      ->orWhere('editor_source', $tool);
                })
                ->whereRaw("strftime('{$sqliteDateFormat}', timestamp) = ?", [$period])
                ->count();
            
            return [
                'active_coding_time_minutes' => $sessionCount > 0 ? round($activeCodingTotal / $sessionCount / 60000, 2) : 0,
                'ai_usage_duration_minutes' => $sessionCount > 0 ? round($aiUsageTotal / $sessionCount / 60000, 2) : 0,
                'time_to_first_commit_minutes' => $ttfcCount > 0 ? round($ttfcTotal / $ttfcCount / 60000, 2) : 0,
                'ai_suggestions_accepted' => $sessionCount > 0 ? round($aiBurstTotal / $sessionCount, 2) : 0,
                'files_edited_per_session' => $sessionCount > 0 ? round($filesEditedTotal / $sessionCount, 2) : 0,
                'commits_per_session' => $sessionCount > 0 ? round($commitCount / $sessionCount, 2) : 0,
                'idle_time_minutes' => $sessionCount > 0 ? round($idleTimeTotal / $sessionCount / 60000, 2) : 0,
                'focus_ratio' => $focusRatioCount > 0 ? round($focusRatioTotal / $focusRatioCount, 2) : 0,
                'event_count' => $eventCount,
                'coverage_pct' => $eventCount > 0 ? round(($sessionCount / $eventCount) * 100, 2) : 0,
            ];
            
        } catch (\Throwable $e) {
            Log::warning('[TELEMETRY_AGGREGATED] Failed to fetch additional metrics', [
                'tool' => $tool,
                'period' => $period,
                'error' => $e->getMessage(),
            ]);
            
            return [
                'active_coding_time_minutes' => 0,
                'ai_usage_duration_minutes' => 0,
                'time_to_first_commit_minutes' => 0,
                'ai_suggestions_accepted' => 0,
                'files_edited_per_session' => 0,
                'commits_per_session' => 0,
                'idle_time_minutes' => 0,
                'focus_ratio' => 0,
                'event_count' => 0,
                'coverage_pct' => 0,
            ];
        }
    }

    /**
     * Canonical Telemetry Endpoint
     * 
     * Single canonical endpoint that serves all dashboard surfaces with consistent telemetry data.
     * Both response formats (sessions and aggregated) operate on the EXACT SAME canonical population.
     * 
     * Query parameters:
     * - from: ISO 8601 start date (required)
     * - to: ISO 8601 end date (required)
     * - period: 'day' | 'week' | 'month' (default: 'week')
     * - tools: comma-separated tool list or 'all' (default: 'all')
     * - user_id: filter by user ID (optional)
     * - git_repo_url: filter by repository (optional)
     * - git_branch: filter by branch (optional)
     * - has_ai: 'true' | 'false' (optional)
     * - format: 'sessions' | 'aggregated' (default: 'aggregated')
     * - include_raw_metadata: 'true' | 'false' (default: 'false')
     * - page: page number for sessions format (default: 1)
     * - per_page: per page for sessions format (default: 200, max 200)
     * - reporting_timezone: IANA timezone (e.g. America/New_York) for local-calendar
     *   date interpretation and bucket labeling. When present, from/to are treated
     *   as date-only strings in this timezone. When absent, UTC behavior is preserved.
     * 
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function canonical(Request $request)
    {
        $startTime = microtime(true);
        
        try {
            // CR-X P0 microfix: Optional reporting timezone for local-calendar scoping.
            // When present, from/to are interpreted as date-only strings in this
            // timezone, and daily/weekly buckets are labeled in local calendar dates.
            // When absent, existing UTC behavior is preserved (backward compatible).
            $reportingTimezone = $request->query('reporting_timezone');

            // Build canonical query (SHARED by both formats)
            $query = $this->buildCanonicalQuery($request, $reportingTimezone);
            
            // Count total records in canonical population
            $canonicalPopulationCount = (clone $query)->count();
            
            // Get format parameter
            $format = $request->query('format', 'aggregated');
            $includeRawMetadata = $request->query('include_raw_metadata', 'false') === 'true';
            $period = $request->query('period', 'week');
            
            // Parse time window for metadata
            $from = $request->query('from');
            $to = $request->query('to');
            if (!$from || !$to) {
                $from = Carbon::now()->subYears(5)->toIso8601String();
                $to = Carbon::now()->toIso8601String();
            }
            
            // Return based on format
            $groupBy = $request->query('group_by');
            if ($groupBy && ($format !== 'aggregated' || $groupBy !== 'developer')) {
                return response()->json(['error' => 'Unsupported canonical grouping'], 422);
            }

            if ($format === 'sessions') {
                return $this->returnSessionFormat($query, $canonicalPopulationCount, $includeRawMetadata, $from, $to);
            } elseif ($groupBy === 'developer') {
                return $this->returnDeveloperAggregatedFormat($query, $canonicalPopulationCount, $period, $from, $to, $reportingTimezone);
            } else {
                return $this->returnAggregatedFormat($query, $canonicalPopulationCount, $period, $from, $to, $includeRawMetadata, $reportingTimezone);
            }
            
        } catch (HttpResponseException $e) {
            // K1B: intentional HTTP rejections (e.g. INVALID_COHORT) must
            // reach the client — never collapse into a 500.
            throw $e;
        } catch (\Throwable $e) {
            Log::error('[TELEMETRY_CANONICAL] Query failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);

            return response()->json([
                'error' => 'Internal server error',
                'message' => 'Failed to fetch canonical telemetry data',
            ], 500);
        }
    }

    /**
     * Build the canonical telemetry query
     * 
     * This method constructs the base query that is used by BOTH response formats.
     * Any deviation between formats would create two different telemetry realities.
     * 
     * Canonical Population Definition:
     * - event_type = session
     * - segment_type = session (metadata)
     * - exclude segment_type = interval
     * - same from/to time window
     * - same organization scope behavior as current endpoints
     * - same user_id filtering
     * - same git_repo_url filtering
     * - same git_branch filtering
     * - same tools filtering
     * - same has_ai filtering
     * - same tool normalization
     * - same AI activity definition: ai_burst_count > 0
     * 
     * @param Request $request
     * @return Builder
     */
    /**
     * CR-X 2B.1: Canonical repository URL normalization.
     *
     * Mirrors frontend/src/lib/repoNormalization.ts normalizeRepoUrl().
     * Normalizes git repository URLs into canonical owner/repo identity.
     *
     * Handles:
     * - HTTPS with optional user: https://[user@]host/owner/repo.git
     * - SSH: git@host:owner/repo.git
     * - SCP-style: host:owner/repo.git
     * - Azure DevOps: https://[user@]dev.azure.com/org/project/_git/repo
     * - trailing .git suffix
     * - casing (lowercased for canonical identity, except Azure)
     *
     * @param string|null $repoUrl
     * @return string|null Canonical identity (e.g. "owner/repo" or "azure:org/repo")
     */
    private function normalizeRepoUrlForCanonical(?string $repoUrl): ?string
    {
        if (!$repoUrl) return null;
        $url = trim($repoUrl);
        if ($url === '') return null;

        // Azure DevOps: https://[user@]dev.azure.com/org/project/_git/repo
        if (preg_match('#^https?://(?:[^@/]+@)?dev\.azure\.com/([^/]+)/[^/]+/_git/([^/]+)#i', $url, $m)) {
            return "azure:{$m[1]}/{$m[2]}";
        }

        // HTTPS with optional user: https://[user@]host/owner/repo.git
        // Must be exactly 2 path segments after host (owner/repo).
        // URLs with 3+ segments (e.g. team/owner/repo) are NOT valid
        // git repo URLs and must not be normalized to owner/repo.
        if (preg_match('#^https?://(?:[^@/?]+@)?[^/]+/([^/]+)/([^/]+?)(?:\.git)?$#i', $url, $m)) {
            return strtolower("{$m[1]}/{$m[2]}");
        }

        // SSH: git@host:owner/repo.git or user@host:owner/repo.git
        // Must be exactly 2 path segments after host:.
        if (preg_match('/^[^@:\/]+@[^:]+:([^\/]+)\/([^\/]+?)(?:\.git)?$/', $url, $m)) {
            return strtolower("{$m[1]}/{$m[2]}");
        }

        // SCP-style without user: host:owner/repo.git
        // Must be exactly 2 path segments after host:.
        if (preg_match('/^[^:\/]+:([^\/]+)\/([^\/]+?)(?:\.git)?$/', $url, $m)) {
            return strtolower("{$m[1]}/{$m[2]}");
        }

        // Fallback: for URLs that don't match any known pattern, return null.
        // This is safer than taking the last 2 path segments, which can create
        // false positives (e.g. "team/owner/repo" → "owner/repo").
        // The specific patterns above handle all valid git URL forms.
        return null;
    }

    /**
     * CR-X 2B.1: Resolve the repos filter to matching raw git_repo_url values.
     *
     * Fetches all distinct raw git_repo_url values from the DB, normalizes
     * each in PHP, and returns those that exactly match the canonical filter
     * values. Returns null if no repos filter is active.
     *
     * @param Request $request
     * @return array|null Array of matching raw URLs, or null if no filter.
     */
    private function resolveRepoFilterMatchingUrls(Request $request): ?array
    {
        if (!$request->query('repos')) return null;

        $repoList = array_map('trim', explode(',', $request->query('repos')));
        $repoList = array_filter($repoList, fn($r) => !empty($r));
        if (empty($repoList)) return null;

        // Fetch all distinct raw repo URLs from the DB
        $distinctRawRepos = \DB::table('telemetry_events')
            ->whereNotNull('session_id')
            ->whereRaw("json_extract(metadata, '$.git_repo_url') IS NOT NULL")
            ->whereRaw("json_extract(metadata, '$.git_repo_url') != ''")
            ->selectRaw("DISTINCT json_extract(metadata, '$.git_repo_url') as repo_url")
            ->pluck('repo_url')
            ->toArray();

        // Normalize each raw URL and match exactly against the filter values
        $canonicalFilterSet = array_map('strtolower', $repoList);
        $matchingRawRepos = [];
        foreach ($distinctRawRepos as $rawRepo) {
            $normalized = $this->normalizeRepoUrlForCanonical($rawRepo);
            if ($normalized && in_array(strtolower($normalized), $canonicalFilterSet)) {
                $matchingRawRepos[] = $rawRepo;
            }
        }

        return $matchingRawRepos;
    }

    /**
     * CR-X P0-B: Build a DST-correct SQL strftime expression for local-calendar bucketing.
     *
     * Uses PHP's authoritative DateTimeZone::getTransitions() to obtain the
     * exact UTC transition instants and offsets within the query range.  Each
     * transition produces a segment boundary at the exact UTC timestamp the
     * offset changes.  The resulting SQL CASE expression applies the offset
     * that is actually in force at each timestamp.
     *
     * Required invariant: every telemetry timestamp uses the offset actually
     * in force at that timestamp.  No daily sampling.  No hardcoded US
     * transition dates.  No fixed range-wide offset.  No stored data alteration.
     *
     * @param string $sqliteDateFormat  strftime format (e.g. '%Y-%m-%d')
     * @param string $from              Query range start (date-only or ISO)
     * @param string $to                Query range end (date-only or ISO)
     * @param string $reportingTimezone IANA timezone (e.g. 'America/New_York')
     * @return string                   SQL expression for the period column
     */
    private function buildDstCorrectPeriodExpression(string $sqliteDateFormat, string $from, string $to, string $reportingTimezone): string
    {
        $tz = new \DateTimeZone($reportingTimezone);

        // Parse the query range as UTC instants.  For date-only strings,
        // interpret them in the reporting timezone (matching buildCanonicalQuery).
        $fromUtc = Carbon::parse($from, $tz)->startOfDay()->utc();
        $toUtc = Carbon::parse($to, $tz)->endOfDay()->utc();

        // Use PHP's authoritative timezone transition data to find exact
        // transition instants within the query range.  getTransitions()
        // returns an array of transition records, each with 'ts' (Unix
        // timestamp), 'offset' (seconds from UTC), and 'isdst'.
        //
        // We request transitions for the range [fromUtc, toUtc].  The first
        // element is the state at the beginning of the range; subsequent
        // elements are transition points.
        $transitions = $tz->getTransitions($fromUtc->getTimestamp(), $toUtc->getTimestamp());

        // Build segments from the transition data.  Each segment has a
        // start UTC timestamp and the offset in force from that point.
        $segments = [];
        if (is_array($transitions)) {
            foreach ($transitions as $i => $trans) {
                // The first transition record describes the state at the
                // start of the range, not an actual transition.  Use the
                // range start as its segment start so timestamps before the
                // first real transition are correctly scoped.
                $segStartTs = $i === 0 ? $fromUtc->getTimestamp() : $trans['ts'];
                $segments[] = [
                    'start' => gmdate('Y-m-d\TH:i:s', $segStartTs),
                    'offset' => $trans['offset'],
                ];
            }
        }

        // Fallback: if getTransitions returned nothing useful, use the
        // offset at the range start as a single segment.
        if (empty($segments)) {
            $offset = $tz->getOffset($fromUtc);
            $segments[] = [
                'start' => $fromUtc->format('Y-m-d\TH:i:s'),
                'offset' => $offset,
            ];
        }

        // If only one segment (no DST transition in range), use a simple modifier.
        if (count($segments) === 1) {
            $offsetHours = $segments[0]['offset'] / 3600;
            $modifier = ($offsetHours >= 0 ? '+' : '') . $offsetHours . ' hours';
            return "strftime('{$sqliteDateFormat}', timestamp, '{$modifier}')";
        }

        // Build a CASE expression with one WHEN clause per segment.
        // Each segment applies its own offset modifier.
        // Segments are ordered by start time, so the first matching WHEN wins.
        $caseParts = [];
        for ($i = 0; $i < count($segments); $i++) {
            $seg = $segments[$i];
            $offsetHours = $seg['offset'] / 3600;
            $modifier = ($offsetHours >= 0 ? '+' : '') . $offsetHours . ' hours';
            $segStart = $seg['start'];

            if ($i < count($segments) - 1) {
                $nextStart = $segments[$i + 1]['start'];
                $caseParts[] = "WHEN timestamp >= '{$segStart}' AND timestamp < '{$nextStart}' THEN strftime('{$sqliteDateFormat}', timestamp, '{$modifier}')";
            } else {
                $caseParts[] = "WHEN timestamp >= '{$segStart}' THEN strftime('{$sqliteDateFormat}', timestamp, '{$modifier}')";
            }
        }

        $caseBody = implode(' ', $caseParts);
        return "CASE {$caseBody} END";
    }

    /**
     * K1B: Resolve the optional cohort_id query parameter into a scope.
     *
     * Semantics (locked):
     *  - absent / 'all'    → no cohort scope (eligible org population)
     *  - <integer>         → active same-org cohort; resolved to the
     *                        'invite:N' user_ids of current members.
     *                        Zero members → empty scope (truthful zero).
     *  - 'unassigned'      → the org's unredeemed invites with no
     *                        cohort_members row.
     *  - invalid / cross-org / archived → error payload (fail closed;
     *    never silently dropped, never org-wide).
     *
     * Cohorts resolve against the AUTHENTICATED organization only —
     * even in Local Lab mode (telemetry rows may span orgs, but cohort
     * authority is the acting admin's org).
     *
     * @return array{mode:string, user_ids:?array, cohort:?Cohort, proof:?array, error:?JsonResponse}
     */
    private function resolveCohortScope(Request $request): array
    {
        $raw = $request->query('cohort_id');

        if ($raw === null || $raw === '' || $raw === 'all') {
            return ['mode' => 'all', 'user_ids' => null, 'cohort' => null, 'proof' => null, 'error' => null];
        }

        $invalid = [
            'mode' => 'invalid',
            'user_ids' => null,
            'cohort' => null,
            'proof' => null,
            'error' => response()->json([
                'error' => 'Invalid cohort',
                'error_code' => 'INVALID_COHORT',
            ], 422),
        ];

        $organizationId = $request->get('authenticated_user')?->organization_id;
        if (!$organizationId) {
            return $invalid;
        }

        if ($raw === 'unassigned') {
            $memberInviteIds = CohortMember::where('organization_id', $organizationId)
                ->pluck('invite_id');
            $inviteIds = Invite::where('organization_id', $organizationId)
                ->whereNull('redeemed_at')
                ->whereNotIn('id', $memberInviteIds)
                ->pluck('id');
            $userIds = $inviteIds->map(fn ($id) => "invite:{$id}")->all();

            return [
                'mode' => 'unassigned',
                'user_ids' => $userIds,
                'cohort' => null,
                'proof' => [
                    'mode' => 'unassigned',
                    'resolved_developer_count' => count($userIds),
                    'membership_semantics' => 'current',
                ],
                'error' => null,
            ];
        }

        if (!is_scalar($raw) || !ctype_digit((string) $raw)) {
            return $invalid;
        }

        $cohort = Cohort::forOrganization((int) $organizationId)->active()->find((int) $raw);
        if (!$cohort) {
            // Unknown, cross-org, or archived — identical rejection; the
            // response reveals nothing about other organizations.
            return $invalid;
        }

        $inviteIds = CohortMember::where('cohort_id', $cohort->id)->pluck('invite_id');
        $resolver = new \App\Services\LocalDeveloperResolver();
        $userIds = $resolver->resolveCohortUserIds($inviteIds->all());

        return [
            'mode' => 'cohort',
            'user_ids' => $userIds,
            'cohort' => $cohort,
            'proof' => [
                'id' => $cohort->id,
                'name' => $cohort->name,
                'member_count' => $inviteIds->count(),
                'resolved_developer_count' => $inviteIds->count(),
                'identity_resolution' => $resolver->isAliasEnabled()
                    ? 'invite_backed_with_local_aliases'
                    : 'invite_backed',
                'membership_semantics' => 'current',
            ],
            'error' => null,
        ];
    }

    /**
     * K1B: memoized cohort scope for this request — resolved once, shared
     * by buildCanonicalQuery, returnAggregatedFormat, and
     * buildCanonicalMetadata so population and proof can never diverge.
     */
    private function cohortScopeForRequest(Request $request): array
    {
        $scope = $request->attributes->get('cohort_scope');
        if ($scope === null) {
            $scope = $this->resolveCohortScope($request);
            $request->attributes->set('cohort_scope', $scope);
        }
        return $scope;
    }

    /**
     * K1B: apply a resolved cohort scope to a telemetry_events query.
     * Empty membership → matches nothing (truthful zero), never widened.
     */
    private function applyCohortScope($query, array $cohortScope): void
    {
        if ($cohortScope['mode'] === 'all' || $cohortScope['mode'] === 'invalid') {
            return;
        }
        $userIds = $cohortScope['user_ids'] ?? [];
        if (empty($userIds)) {
            $query->whereRaw('1 = 0');
        } else {
            $query->whereIn('user_id', $userIds);
        }
    }

    private function buildCanonicalQuery(Request $request, ?string $reportingTimezone = null)
    {
        // 1. EVENT TYPE FILTER
        // Only session events are included in the canonical population
        $query = TelemetryEvent::where('event_type', 'session');
        
        // 2. SEGMENT TYPE FILTER
        // Only real session events (segment_type: "session") are included
        // Legacy interval events (segment_type: "interval") are EXCLUDED
        $query->whereRaw("json_extract(metadata, '$.segment_type') = 'session'");
        
        // 3. TIME WINDOW FILTER
        // Both formats MUST use the same time window
        $from = $request->query('from');
        $to = $request->query('to');

        // Default to all historical data if no date range specified
        // Use 2020-01-01 for consistency with AI Ops, Performance Insights, and Productivity V3
        if (!$from || !$to) {
            $from = '2020-01-01';
            $to = Carbon::now()->toIso8601String();
        }
        
        // CR-X P0 microfix: When reporting_timezone is supplied, interpret
        // from/to as date-only strings in the reporting timezone and convert
        // to UTC instants.  This ensures a local-calendar window like
        // from=2026-08-30 to=2026-09-06 in America/New_York includes all
        // telemetry through 2026-09-06 23:59:59.999 EDT (= 2026-09-07 03:59:59Z),
        // not just through UTC midnight.
        // When reporting_timezone is absent, preserve existing UTC behavior.
        if ($reportingTimezone) {
            $tz = new \DateTimeZone($reportingTimezone);
            $fromDate = Carbon::parse($from, $tz)->startOfDay()->utc();
            $toDate = Carbon::parse($to, $tz)->endOfDay()->utc();
        } else {
            $fromDate = Carbon::parse($from);
            $toDate = Carbon::parse($to);
        }
        
        $query->whereBetween('timestamp', [$fromDate, $toDate]);
        
        // 4. ORGANIZATION SCOPE
        // Organization-scoped: only return telemetry belonging to the
        // authenticated user's organization (resolved from dashboard token
        // by SimpleTokenAuth middleware).  Never trust client-supplied
        // organization_id.
        //
        // CR5 P0.6: In Local Lab mode (APP_ENV=local), include ALL
        // organizations.  Local is the product-development environment
        // where the founder's full historical telemetry may span multiple
        // organization IDs due to org transitions, repointing, or
        // environment rebuilds.  Excluding older orgs would silently drop
        // legitimate historical session-level telemetry that the PI
        // engine needs for longitudinal comparisons.
        //
        // This is generic: it applies to any user in Local Lab mode,
        // not to any specific individual.
        $isLocalLab = config('app.env') === 'local';
        $authenticatedUser = $request->get('authenticated_user');
        $organizationId = $authenticatedUser?->organization_id;
        if ($isLocalLab) {
            // Local Lab: include all organizations — full historical population
        } elseif ($organizationId) {
            $query->where('organization_id', $organizationId);
        } else {
            // Fail closed: no provable organization → return empty result set
            $query->whereRaw('1 = 0');
        }
        
        // 5. USER SCOPE
        // Optional filter by user_id (single) or developer_ids (comma-separated array).
        // In Local Lab mode, the logical `local-developer` ID is resolved to
        // the full verified set of Matt's genuine Local telemetry identities
        // (static verified IDs + dynamic invite resolution). This is a
        // read-only resolver — no telemetry rows are modified. See
        // config/local_developer.php and LocalDeveloperResolver.
        // P0-H: Accept developer_ids array for multi-developer filtering.
        if ($request->query('developer_ids')) {
            $devIds = array_map('trim', explode(',', $request->query('developer_ids')));
            $devIds = array_filter($devIds, fn($id) => !empty($id));
            if (!empty($devIds)) {
                $query->where(function ($q) use ($devIds) {
                    $resolver = new \App\Services\LocalDeveloperResolver();
                    foreach ($devIds as $devId) {
                        if ($resolver->isLocalDeveloper($devId) && $resolver->isAliasEnabled()) {
                            $rawIds = $resolver->resolveRawIdentities();
                            if (!empty($rawIds)) {
                                $q->orWhereIn('user_id', $rawIds);
                            } else {
                                // Unresolved local-developer: fail closed (matches nothing)
                                $q->orWhereRaw('1 = 0');
                            }
                        } else {
                            // Literal user_id filter (including local-developer
                            // when alias is disabled — matches literal rows only)
                            $q->orWhere('user_id', $devId);
                        }
                    }
                });
            }
        } elseif ($request->query('user_id')) {
            $userId = $request->query('user_id');
            $resolver = new \App\Services\LocalDeveloperResolver();
            $resolver->applyUserFilter($query, $userId);
        }

        // 5.5 COHORT SCOPE (K1B)
        // Optional cohort_id narrows the population to invite-backed
        // developer identities holding CURRENT membership — resolved at
        // query time; no telemetry row carries cohort identity. cohort_id
        // intersects (ANDs) with developer_ids/user_id: an empty
        // intersection is a truthful zero, never an org-wide fallback.
        // Invalid/cross-org/archived → 422 INVALID_COHORT (fail closed).
        $cohortScope = $this->cohortScopeForRequest($request);
        if ($cohortScope['error'] !== null) {
            throw new HttpResponseException($cohortScope['error']);
        }
        $this->applyCohortScope($query, $cohortScope);

        // 6. REPO SCOPE
        // Optional filter by git_repo_url (single) or repos (comma-separated array).
        // P0-H: Accept repos array for multi-repo filtering.
        // CR-X 2B.1: Deterministic canonical repo identity matching.
        // The frontend sends canonical normalized repo IDs (e.g. "owner/repo"
        // or "azure:org/repo"). The raw git_repo_url in metadata may be HTTPS,
        // SSH, SCP, or have user prefixes and .git suffixes.
        //
        // ALGORITHM:
        // 1. Fetch all distinct raw git_repo_url values from the DB
        // 2. Normalize each in PHP using normalizeRepoUrlForCanonical()
        // 3. Match exactly against the canonical filter values
        // 4. Use whereIn with the matching raw URLs
        //
        // This avoids LIKE wildcard false positives (e.g. "owner/repo" matching
        // "another/owner/repo" or "owner/repo-suffix") and prevents user-supplied
        // LIKE-significant characters (%, _) from broadening the match.
        $matchingRawRepos = $this->resolveRepoFilterMatchingUrls($request);
        if ($matchingRawRepos !== null) {
            if (!empty($matchingRawRepos)) {
                $query->where(function ($q) use ($matchingRawRepos) {
                    foreach ($matchingRawRepos as $rawRepo) {
                        $q->orWhereRaw("json_extract(metadata, '$.git_repo_url') = ?", [$rawRepo]);
                    }
                });
            } else {
                // No matching repos — return empty result set
                $query->whereRaw('1 = 0');
            }
        } elseif ($request->query('git_repo_url')) {
            $query->whereRaw("json_extract(metadata, '$.git_repo_url') = ?", [$request->query('git_repo_url')]);
        }
        
        // 7. BRANCH SCOPE
        // Optional filter by git_branch
        if ($request->query('git_branch')) {
            $query->whereRaw("json_extract(metadata, '$.git_branch') = ?", [$request->query('git_branch')]);
        }
        
        // 8. TOOL FILTER
        // Optional filter by tools (comma-separated list or 'all')
        // Note: telemetry_events has no 'tool' column; resolve via source/editor_source
        $tools = $request->query('tools', 'all');
        if ($tools && $tools !== 'all') {
            $toolList = array_map('trim', explode(',', $tools));
            $query->where(function($q) use ($toolList) {
                foreach ($toolList as $tool) {
                    if ($tool === 'claude_code') {
                        $q->orWhere(function($q2) {
                            $q2->whereRaw("json_extract(metadata, '$.tool') = 'claude_code'")
                              ->orWhereRaw("json_extract(metadata, '$.vscode_version') = 'claude-code'")
                              ->orWhereRaw("json_extract(metadata, '$.extension_version') LIKE '%cc-bridge%'")
                              ->orWhereRaw("json_extract(metadata, '$.appName') LIKE '%Claude Code%'")
                              ->orWhereRaw("COALESCE(editor_source, source) = 'claude-code'")
                              ->orWhereRaw("COALESCE(editor_source, source) = 'claude_code'");
                        });
                    } else {
                        $q->orWhere('editor_source', $tool)
                          ->orWhere('source', $tool);
                    }
                }
            });

            // Pilot Ops 17G.3: `tools=X` must mean the canonical workflow X,
            // not the raw host surface. Hosted Claude Code sessions
            // (editor_source='vscode' + bridge metadata) are canonically
            // attributed to claude_code by the aggregated CASE; they must not
            // leak into a non-claude tools filter. Exclude them unless
            // claude_code itself was requested.
            if (!in_array('claude_code', $toolList)) {
                $query->where(function($q) {
                    $q->whereRaw("COALESCE(json_extract(metadata, '$.tool'), '') != 'claude_code'")
                      ->whereRaw("COALESCE(json_extract(metadata, '$.vscode_version'), '') != 'claude-code'")
                      ->whereRaw("COALESCE(json_extract(metadata, '$.extension_version'), '') NOT LIKE '%cc-bridge%'")
                      ->whereRaw("COALESCE(json_extract(metadata, '$.appName'), '') NOT LIKE '%Claude Code%'")
                      ->whereRaw("COALESCE(editor_source, source) NOT IN ('claude-code', 'claude_code')");
                });
            }
        }
        
        // 9. AI ACTIVITY FILTER
        // Optional filter by AI activity
        if ($request->query('has_ai') === 'true') {
            $query->whereRaw("COALESCE(json_extract(metadata, '$.ai_burst_count'), 0) > 0");
        } elseif ($request->query('has_ai') === 'false') {
            $query->whereRaw("COALESCE(json_extract(metadata, '$.ai_burst_count'), 0) = 0");
        }
        
        // 10. EXCLUDED EVENTS
        // Events with segment_type = "interval" are EXCLUDED (already filtered above)
        // Events with event_type != "session" are EXCLUDED (already filtered above)
        // No other exclusions
        
        return $query;
    }

    /**
     * Build shared metadata for canonical response
     * 
     * This metadata is identical for both sessions and aggregated formats.
     * It proves that both formats operate on the same canonical population.
     * 
     * @param Builder $query
     * @param int $canonicalPopulationCount
     * @param string $from
     * @param string $to
     * @return array
     */
    private function buildCanonicalMetadata($query, int $canonicalPopulationCount, string $from, string $to): array
    {
        // Calculate session count by tool (from canonical population)
        // Use same SQL CASE for Claude Code detection as aggregated format
        // Note: telemetry_events table has no 'tool' column, only source/editor_source
        $sessionCountByTool = (clone $query)
            ->select([
                DB::raw("CASE
                    WHEN json_extract(metadata, '$.tool') = 'claude_code'
                      OR json_extract(metadata, '$.vscode_version') = 'claude-code'
                      OR json_extract(metadata, '$.extension_version') LIKE '%cc-bridge%'
                      OR json_extract(metadata, '$.appName') LIKE '%Claude Code%'
                      OR COALESCE(editor_source, source) = 'claude-code'
                    THEN 'claude_code'
                    ELSE COALESCE(editor_source, source)
                END as tool"),
                DB::raw('COUNT(*) as session_count')
            ])
            ->groupBy('tool')
            ->pluck('session_count', 'tool')
            ->reduce(function (array $counts, $count, $tool) {
                $normalized = $this->normalizeToolName($tool);
                $counts[$normalized] = ($counts[$normalized] ?? 0) + $count;
                return $counts;
            }, []);

        // Conversation granularity alongside segment counts: Cursor Agent
        // bridge rows are per-turn reporting segments sharing a stable
        // conversation session_id. session_count stays the reporting-segment
        // count; conversation_count is COUNT(DISTINCT session_id).
        $conversationCountByTool = (clone $query)
            ->select([
                DB::raw("CASE
                    WHEN json_extract(metadata, '$.tool') = 'claude_code'
                      OR json_extract(metadata, '$.vscode_version') = 'claude-code'
                      OR json_extract(metadata, '$.extension_version') LIKE '%cc-bridge%'
                      OR json_extract(metadata, '$.appName') LIKE '%Claude Code%'
                      OR COALESCE(editor_source, source) = 'claude-code'
                    THEN 'claude_code'
                    ELSE COALESCE(editor_source, source)
                END as tool"),
                DB::raw('COUNT(DISTINCT session_id) as conversation_count')
            ])
            ->groupBy('tool')
            ->pluck('conversation_count', 'tool')
            ->reduce(function (array $counts, $count, $tool) {
                $normalized = $this->normalizeToolName($tool);
                $counts[$normalized] = ($counts[$normalized] ?? 0) + $count;
                return $counts;
            }, []);

        $canonicalConversationCount = (clone $query)
            ->whereNotNull('session_id')
            ->distinct()
            ->count('session_id');

        // Get unique tools in population
        $toolsInPopulation = array_keys($sessionCountByTool);

        // CR-X (C): Derive latest_observed_at from the SAME canonical filtered
        // population (clone the query BEFORE any grouped aggregation mutates it).
        // Uses the telemetry observation `timestamp` field, not row `created_at`.
        // This preserves sessions/aggregated population parity — no second population.
        $latestObservedAt = (clone $query)->max('timestamp');

        // CR-X Day 1B S1 P0-A: Derive invite_backed_count from the SAME canonical
        // filtered population. This guarantees the coverage numerator and
        // denominator describe the exact same scoped population — no divergent
        // frontend identity resolution. The backend's LocalDeveloperResolver
        // is the sole authority for alias expansion.
        $inviteBackedCount = (clone $query)
            ->whereRaw("user_id LIKE 'invite:%'")
            ->count();

        // LOCAL demo only: the Local Lab attribution authority is
        // LocalDeveloperResolver, whose fixture identity map proves
        // non-invite-shaped user_ids belong to known local developers —
        // The operator's verified alias identities (local-developer, 4, 41001234)
        // and the six simulated demo personas (90001-90006). Counting only
        // invite:* rows would misreport a fully developer-resolved local
        // population as unattributed. Persona rows qualify only when
        // explicitly marked simulated=true; unknown raw ids remain
        // unattributed. Outside APP_ENV=local this block never runs and
        // invite:* remains the sole attribution authority.
        if (config('app.env') === 'local') {
            $localResolver = new \App\Services\LocalDeveloperResolver();
            $localPersonaIds = config('local_developer.sample_persona_ids', []);
            $inviteBackedCount += (clone $query)
                ->whereRaw("user_id NOT LIKE 'invite:%'")
                ->where(function ($q) use ($localResolver, $localPersonaIds) {
                    $q->whereIn('user_id', $localResolver->resolveRawIdentities())
                        ->orWhere(function ($q2) use ($localPersonaIds) {
                            $q2->whereIn('user_id', $localPersonaIds)
                                ->whereRaw("json_extract(metadata, '$.simulated') = 1");
                        });
                })
                ->count();
        }

        // CR-X Day 2 X1: Derive total_commit_count from the SAME canonical
        // filtered population. The denominator for cost-per-commit is the
        // count of event_type='commit' events within the canonical scope.
        // Commit events are associated with sessions via session_id, so we
        // collect the session_ids from the canonical session population and
        // count commit events sharing those session_ids. This ensures the
        // commit count is scoped to the same developer/repo/time window as
        // the canonical session population without duplicating filter logic.
        //
        // CR-X Day 2 X1 HARDENING: Explicit tenant isolation against the
        // CURRENT AUTHENTICATED ORGANIZATION — not a transitive constraint
        // derived from canonical row membership. The commit count query is
        // constrained by the same authoritative authenticated org identity
        // used by buildCanonicalQuery() (authenticated_user.organization_id),
        // applying the identical Local Lab / fail-closed semantics. This
        // prevents any cross-org session_id collision from leaking commit
        // evidence: an Org B commit sharing session_id X with Org A's
        // canonical population contributes ZERO to Org A's total_commit_count.
        // No second concept of org identity is introduced; org is never
        // inferred from payload metadata; canonical row org IDs are not used
        // as the security boundary.
        $canonicalSessionIds = (clone $query)
            ->whereNotNull('session_id')
            ->pluck('session_id')
            ->unique()
            ->values()
            ->all();
        $totalCommitCount = 0;
        if (!empty($canonicalSessionIds)) {
            // Re-derive the authoritative authenticated org identity using
            // the SAME source as buildCanonicalQuery() step 4.
            $commitIsLocalLab = config('app.env') === 'local';
            $commitAuthenticatedUser = request()->get('authenticated_user');
            $commitOrganizationId = $commitAuthenticatedUser?->organization_id;

            $commitQuery = TelemetryEvent::where('event_type', 'commit')
                ->whereIn('session_id', $canonicalSessionIds);
            if ($commitIsLocalLab) {
                // Local Lab: include all organizations — matches canonical
                // population scope (no org constraint).
            } elseif ($commitOrganizationId) {
                // Production: explicit constraint to the single authenticated
                // organization. This is the primary security boundary.
                $commitQuery->where('organization_id', $commitOrganizationId);
            } else {
                // Fail closed: no provable organization → zero commits.
                $commitQuery->whereRaw('1 = 0');
            }
            $totalCommitCount = $commitQuery->count();
        }

        // K1B: cohort proof — resolved once per request; the same scope
        // that constrained the population is reported verbatim so the UI
        // can prove which cohort the numbers describe.
        $cohortScope = $this->cohortScopeForRequest(request());

        // Build query hash for cache key
        // K1B: cohort_id participates in the hash. 'all'/absent normalize
        // to the same identity (identical population must share a hash).
        $queryHash = md5(json_encode([
            'from' => $from,
            'to' => $to,
            'filters' => [
                'user_id' => request()->query('user_id'),
                'developer_ids' => request()->query('developer_ids'),
                'cohort_id' => $cohortScope['mode'] === 'all' ? null : request()->query('cohort_id'),
                'git_repo_url' => request()->query('git_repo_url'),
                'repos' => request()->query('repos'),
                'git_branch' => request()->query('git_branch'),
                'tools' => request()->query('tools'),
                'has_ai' => request()->query('has_ai'),
            ]
        ]));
        
        return [
            'canonical_population_count' => $canonicalPopulationCount,
            'canonical_conversation_count' => $canonicalConversationCount,
            'conversation_count_by_tool' => $conversationCountByTool,
            'invite_backed_count' => $inviteBackedCount,
            'total_commit_count' => $totalCommitCount,
            'session_count_by_tool' => $sessionCountByTool,
            'time_range' => [
                'from' => $from,
                'to' => $to,
            ],
            'tools_in_population' => $toolsInPopulation,
            'filters_applied' => [
                'user_id' => request()->query('user_id'),
                'developer_ids' => request()->query('developer_ids'),
                'cohort_id' => request()->query('cohort_id'),
                'cohort' => $cohortScope['proof'],
                'git_repo_url' => request()->query('git_repo_url'),
                'repos' => request()->query('repos'),
                'git_branch' => request()->query('git_branch'),
                'tools' => request()->query('tools'),
                'has_ai' => request()->query('has_ai'),
            ],
            'query_hash' => $queryHash,
            'source_table' => 'telemetry_events',
            'generated_at' => Carbon::now()->toIso8601String(),
            'latest_observed_at' => $latestObservedAt,
        ];
    }

    /**
     * Return session format response
     * 
     * Returns raw session primitives (for Performance Insights and AI Ops)
     * 
     * @param Builder $query
     * @param int $canonicalPopulationCount
     * @param bool $includeRawMetadata
     * @param string $from
     * @param string $to
     * @return \Illuminate\Http\JsonResponse
     */
    private function returnSessionFormat($query, int $canonicalPopulationCount, bool $includeRawMetadata, string $from, string $to)
    {
        // Apply pagination
        $page = max(1, (int) request()->query('page', 1));
        $perPage = min(1000, max(1, (int) request()->query('per_page', 200)));
        
        // CR-X P0-B: buildCanonicalMetadata plucks ALL session IDs and runs a
        // WHERE IN commit count — invariant work that describes the entire
        // canonical population, not the current page.  Recomputing it on
        // every page multiplies expensive queries by the page count and is
        // the root cause of pagination stalls (page 2+ hangs).  Compute the
        // full shared metadata ONLY on page 1.  Subsequent pages receive
        // lightweight pagination metadata (page/per_page/total_pages) and
        // reuse the population count already passed in.
        if ($page === 1) {
            $sharedMetadata = $this->buildCanonicalMetadata($query, $canonicalPopulationCount, $from, $to);
        } else {
            $sharedMetadata = [
                'canonical_population_count' => $canonicalPopulationCount,
                'session_count_by_tool' => [],
                'time_range' => ['from' => $from, 'to' => $to],
                'tools_in_population' => [],
                'filters_applied' => [],
                'query_hash' => '',
                'source_table' => 'telemetry_events',
                'generated_at' => now()->toIso8601String(),
                'invite_backed_count' => 0,
                'total_commit_count' => 0,
                'latest_observed_at' => null,
            ];
        }
        
        $sessions = $query->orderBy('timestamp', 'desc')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();
        
        $sessionData = [];
        foreach ($sessions as $session) {
            $metadata = [];
            if ($session->payload) {
                $payload = is_string($session->payload) ? json_decode($session->payload, true) : $session->payload;
                if (isset($payload[0]['metadata'])) {
                    $metadata = $payload[0]['metadata'];
                }
            }
            $metadata = array_merge(($session->metadata ?? []), $metadata);
            
            $tool = $this->resolvePrimaryTool($metadata, $session->tool, $session->source, $session->editor_source);
            $hostEditor = $this->resolveHostEditor($metadata, $session->source, $session->editor_source);
            
            $sessionData[] = [
                'session_id' => $session->id,
                'tool' => $tool,
                'host_editor' => $hostEditor,
                'duration_ms' => $session->duration_ms,
                'timestamp' => $session->timestamp,
                'ai_burst_count' => $metadata['ai_burst_count'] ?? 0,
                'active_coding_duration_ms' => $metadata['active_coding_duration_ms'] ?? 0,
                'time_to_first_commit_ms' => $metadata['time_to_first_commit_ms'] ?? null,
                'lines_added_total' => $metadata['lines_added_total'] ?? 0,
                'lines_removed_total_est' => $metadata['lines_removed_total_est'] ?? 0,
                'commit_count' => $metadata['session_commits'] ?? $metadata['commit_count'] ?? 0,
                'files_edited' => $metadata['file_save_count'] ?? $metadata['files_edited'] ?? 0,
                'git_repo_url' => $metadata['git_repo_url'] ?? null,
                'git_branch' => $metadata['git_branch'] ?? null,
                // Identity contract v1
                'installation_id' => $metadata['installation_id'] ?? null,
                'developer_id' => $metadata['developer_id'] ?? null,
                'team_id' => $metadata['team_id'] ?? null,
                'identity_schema_version' => $metadata['identity_schema_version'] ?? 0,
                'identity_source' => $metadata['identity_source'] ?? 'legacy_unknown',
                'metadata' => $includeRawMetadata ? $metadata : null,
            ];
        }
        
        return response()->json([
            'data' => $sessionData,
            'metadata' => array_merge($sharedMetadata, [
                'page' => $page,
                'per_page' => $perPage,
                'total_pages' => ceil($canonicalPopulationCount / $perPage),
                'format' => 'sessions',
            ]),
        ]);
    }

    private function returnDeveloperAggregatedFormat($query, int $canonicalPopulationCount, string $period, string $from, string $to, ?string $reportingTimezone = null)
    {
        $sharedMetadata = $this->buildCanonicalMetadata($query, $canonicalPopulationCount, $from, $to);
        $authenticatedUser = request()->get('authenticated_user');
        $resolver = new \App\Services\LocalDeveloperResolver();
        $identityMap = $resolver->resolveAuthoritativeIdentityMap($authenticatedUser?->organization_id);

        $sqliteDateFormat = match($period) {
            'day' => '%Y-%m-%d',
            'month' => '%Y-%m',
            default => '%Y-%W',
        };
        $periodExpression = "strftime('{$sqliteDateFormat}', timestamp)";
        if ($reportingTimezone) {
            $periodExpression = $this->buildDstCorrectPeriodExpression($sqliteDateFormat, $from, $to, $reportingTimezone);
        }

        $tools = array_values(array_filter(array_map('trim', explode(',', request()->query('tools', 'all')))));
        $canonicalTools = array_values(array_unique(array_map(fn($tool) => $this->normalizeToolName($tool), $tools)));
        $toolContext = count($canonicalTools) === 1 ? $canonicalTools[0] : 'all';

        $results = [];
        $sessionCountByGroup = [];
        if (!empty($identityMap)) {
            $caseParts = [];
            $bindings = [];
            foreach ($identityMap as $rawId => $logicalId) {
                $caseParts[] = 'WHEN user_id = ? THEN ?';
                $bindings[] = $rawId;
                $bindings[] = $logicalId;
            }
            $developerExpression = 'CASE ' . implode(' ', $caseParts) . ' END';

            $aggregated = (clone $query)
                ->selectRaw("{$developerExpression} as developer", $bindings)
                ->selectRaw("{$periodExpression} as period")
                ->selectRaw('COUNT(*) as session_count')
                // Distinct conversation sessions — differs from session_count
                // when a source emits per-turn segments (cursor-agent bridge).
                ->selectRaw('COUNT(DISTINCT session_id) as conversation_count')
                // Observation planes feeding this bucket — IDE extension rows
                // (source=cursor) and agent-bridge rows (source=cursor-agent)
                // can co-observe the same work; the list makes mixing visible.
                ->selectRaw("GROUP_CONCAT(DISTINCT COALESCE(source, editor_source)) as observation_sources")
                ->selectRaw('SUM(duration_ms) / 60000 as total_session_minutes')
                ->selectRaw('AVG(duration_ms) / 60000 as average_session_length_minutes')
                ->selectRaw('AVG(CAST(json_extract(metadata, "$.active_coding_duration_ms") AS INTEGER)) / 60000 as active_coding_time_minutes')
                ->selectRaw('AVG(CAST(json_extract(metadata, "$.ai_usage_duration_ms") AS INTEGER)) / 60000 as ai_usage_duration_minutes')
                ->selectRaw('AVG(CAST(json_extract(metadata, "$.time_to_first_commit_ms") AS INTEGER)) / 60000 as time_to_first_commit_minutes')
                ->selectRaw('AVG(CAST(json_extract(metadata, "$.ai_burst_count") AS INTEGER)) as ai_suggestions_accepted')
                ->selectRaw('AVG(CAST(json_extract(metadata, "$.file_save_count") AS INTEGER)) as files_edited_per_session')
                ->selectRaw('AVG(CAST(json_extract(metadata, "$.session_commits") AS INTEGER)) as commits_per_session')
                ->selectRaw('AVG(CAST(json_extract(metadata, "$.idle_time_ms") AS INTEGER)) / 60000 as idle_time_minutes')
                ->whereIn('user_id', array_keys($identityMap))
                ->groupBy('developer', 'period')
                ->orderBy('period', 'desc')
                ->orderBy('developer', 'asc')
                ->get();

            foreach ($aggregated as $row) {
                $activeCoding = (float) ($row->active_coding_time_minutes ?? 0);
                $idleTime = (float) ($row->idle_time_minutes ?? 0);
                $totalTime = $activeCoding + $idleTime;
                $sessionCount = (int) $row->session_count;
                $sessionCountByGroup[$row->developer] = ($sessionCountByGroup[$row->developer] ?? 0) + $sessionCount;
                $results[] = [
                    'tool' => $toolContext,
                    'developer' => $row->developer,
                    'period' => $this->sqliteWeekPeriodToIso($row->period, $period),
                    'session_count' => $sessionCount,
                    'conversation_count' => (int) ($row->conversation_count ?? $sessionCount),
                    'observation_sources' => $row->observation_sources ? explode(',', $row->observation_sources) : [],
                    'average_session_length_minutes' => round((float) $row->average_session_length_minutes, 2),
                    'total_session_minutes' => round((float) $row->total_session_minutes, 2),
                    'active_coding_time_minutes' => round($activeCoding, 2),
                    'ai_usage_duration_minutes' => round((float) ($row->ai_usage_duration_minutes ?? 0), 2),
                    'time_to_first_commit_minutes' => round((float) ($row->time_to_first_commit_minutes ?? 0), 2),
                    'ai_suggestions_accepted' => round((float) ($row->ai_suggestions_accepted ?? 0), 2),
                    'files_edited_per_session' => round((float) ($row->files_edited_per_session ?? 0), 2),
                    'commits_per_session' => round((float) ($row->commits_per_session ?? 0), 2),
                    'idle_time_minutes' => round($idleTime, 2),
                    'focus_ratio' => $totalTime > 0 ? round($activeCoding / $totalTime, 2) : 0,
                ];
            }
        }

        ksort($sessionCountByGroup);
        $developerAttributedSessions = array_sum($sessionCountByGroup);

        return response()->json([
            'data' => $results,
            'metadata' => array_merge($sharedMetadata, [
                'group_by' => 'developer',
                'groups_in_population' => array_keys($sessionCountByGroup),
                'session_count_by_group' => $sessionCountByGroup,
                'developer_attributed_sessions' => $developerAttributedSessions,
                'developer_unattributed_sessions' => $canonicalPopulationCount - $developerAttributedSessions,
                'tools_returned' => count(array_unique(array_column($results, 'tool'))),
                'periods_returned' => count(array_unique(array_column($results, 'period'))),
                'period' => $period,
                'format' => 'aggregated',
            ]),
        ]);
    }

    /**
     * Return aggregated format response
     * 
     * Returns aggregated time series data (for AI Tool Performance V3)
     * 
     * @param Builder $query
     * @param int $canonicalPopulationCount
     * @param string $period
     * @param string $from
     * @param string $to
     * @param bool $includeRawMetadata
     * @return \Illuminate\Http\JsonResponse
     */
    private function returnAggregatedFormat($query, int $canonicalPopulationCount, string $period, string $from, string $to, bool $includeRawMetadata, ?string $reportingTimezone = null)
    {
        // Build shared metadata (identical to sessions format)
        $sharedMetadata = $this->buildCanonicalMetadata($query, $canonicalPopulationCount, $from, $to);

        // Determine date format
        $sqliteDateFormat = match($period) {
            'day' => '%Y-%m-%d',
            'month' => '%Y-%m',
            default => '%Y-%W', // week
        };

        // CR-X P0-B: DST-correct bucketing.  The prior fixed-offset approach
        // (one `+N hours` for the entire range) is only correct when the
        // range does not span a DST transition.  All Time, Last Quarter, and
        // Last Month can all span DST, so we must apply the offset that is
        // correct for each individual timestamp.
        //
        // Strategy: compute the set of UTC offset segments that exist within
        // the query range for the given timezone, then build a SQL CASE
        // expression that applies the correct `+N hours` modifier per
        // segment.  Each segment is a [start, end) UTC interval with a
        // constant offset.  This is genuinely DST-correct because each
        // timestamp falls into exactly one segment and gets that segment's
        // offset.
        //
        // This is bounded: at most 2 segments for any non-year-spanning range
        // (DST transitions happen at most twice per year), and at most
        // ~2*N segments for an N-year range.  No stored data is altered.
        $periodExpression = "strftime('{$sqliteDateFormat}', timestamp)";
        if ($reportingTimezone) {
            $periodExpression = $this->buildDstCorrectPeriodExpression($sqliteDateFormat, $from, $to, $reportingTimezone);
        }

        // Parse time window for the aggregated query's whereBetween.
        // Must match buildCanonicalQuery's time window logic.
        if ($reportingTimezone) {
            $tz = new \DateTimeZone($reportingTimezone);
            $fromDate = Carbon::parse($from, $tz)->startOfDay()->utc();
            $toDate = Carbon::parse($to, $tz)->endOfDay()->utc();
        } else {
            $fromDate = Carbon::parse($from);
            $toDate = Carbon::parse($to);
        }

        // Get tool filter from request to apply to aggregated query
        $request = request();
        $tools = $request->query('tools', 'all');

        // PERFORMANCE FIX: Single SQL grouped aggregate query instead of N+1 per tool-period
        // This computes all metrics in one query, avoiding the 50-75s latency from fetchAdditionalMetrics loop
        // Use same SQL CASE for Claude Code detection as other canonical queries
        // Note: telemetry_events table has no 'tool' column, only source/editor_source
        $aggregatedQuery = DB::table('telemetry_events')
            ->select([
                DB::raw("CASE
                    WHEN json_extract(metadata, '$.tool') = 'claude_code'
                      OR json_extract(metadata, '$.vscode_version') = 'claude-code'
                      OR json_extract(metadata, '$.extension_version') LIKE '%cc-bridge%'
                      OR json_extract(metadata, '$.appName') LIKE '%Claude Code%'
                      OR COALESCE(editor_source, source) = 'claude-code'
                    THEN 'claude_code'
                    ELSE COALESCE(editor_source, source)
                END as tool"),
                DB::raw("{$periodExpression} as period"),
                DB::raw('COUNT(*) as session_count'),
                DB::raw('COUNT(DISTINCT session_id) as conversation_count'),
                DB::raw("GROUP_CONCAT(DISTINCT COALESCE(source, editor_source)) as observation_sources"),
                DB::raw('SUM(duration_ms) / 60000 as total_session_minutes'),
                DB::raw('AVG(duration_ms) / 60000 as average_session_length_minutes'),
                // Extract metrics from JSON metadata in a single query
                DB::raw('AVG(CAST(json_extract(metadata, "$.active_coding_duration_ms") AS INTEGER)) / 60000 as active_coding_time_minutes'),
                DB::raw('AVG(CAST(json_extract(metadata, "$.ai_usage_duration_ms") AS INTEGER)) / 60000 as ai_usage_duration_minutes'),
                DB::raw('AVG(CAST(json_extract(metadata, "$.time_to_first_commit_ms") AS INTEGER)) / 60000 as time_to_first_commit_minutes'),
                DB::raw('AVG(CAST(json_extract(metadata, "$.ai_burst_count") AS INTEGER)) as ai_suggestions_accepted'),
                DB::raw('AVG(CAST(json_extract(metadata, "$.file_save_count") AS INTEGER)) as files_edited_per_session'),
                DB::raw('AVG(CAST(json_extract(metadata, "$.session_commits") AS INTEGER)) as commits_per_session'),
                DB::raw('AVG(CAST(json_extract(metadata, "$.idle_time_ms") AS INTEGER)) / 60000 as idle_time_minutes'),
            ])
            ->where('event_type', 'session')
            ->whereRaw("json_extract(metadata, '$.segment_type') = 'session'")
            ->whereBetween('timestamp', [$fromDate, $toDate])
            ->where(function($q) {
                $q->whereNotNull('source')
                  ->orWhereNotNull('editor_source');
            });

        // Organization scoping — must match buildCanonicalQuery filter
        // CR5 P0.6: In Local Lab mode, include ALL organizations (see buildCanonicalQuery).
        $isLocalLab = config('app.env') === 'local';
        $authenticatedUser = request()->get('authenticated_user');
        $orgId = $authenticatedUser?->organization_id;
        if ($isLocalLab) {
            // Local Lab: include all organizations — full historical population
        } elseif ($orgId) {
            $aggregatedQuery->where('organization_id', $orgId);
        } else {
            $aggregatedQuery->whereRaw('1 = 0');
        }

        // User scope — must match buildCanonicalQuery filter
        // Use the same LocalDeveloperResolver as buildCanonicalQuery so the
        // logical `local-developer` ID expands to all verified Matt identities.
        // CR-X Phase 3: Honor developer_ids (multi-developer) as well as user_id (single).
        if (request()->query('developer_ids')) {
            $devIds = array_map('trim', explode(',', request()->query('developer_ids')));
            $devIds = array_filter($devIds, fn($id) => !empty($id));
            if (!empty($devIds)) {
                $aggregatedQuery->where(function ($q) use ($devIds) {
                    $resolver = new \App\Services\LocalDeveloperResolver();
                    foreach ($devIds as $devId) {
                        if ($resolver->isLocalDeveloper($devId) && $resolver->isAliasEnabled()) {
                            $rawIds = $resolver->resolveRawIdentities();
                            if (!empty($rawIds)) {
                                $q->orWhereIn('user_id', $rawIds);
                            } else {
                                $q->orWhereRaw('1 = 0');
                            }
                        } else {
                            $q->orWhere('user_id', $devId);
                        }
                    }
                });
            }
        } elseif (request()->query('user_id')) {
            $resolver = new \App\Services\LocalDeveloperResolver();
            $resolver->applyUserFilter($aggregatedQuery, request()->query('user_id'));
        }

        // Cohort scope — must match buildCanonicalQuery filter (K1B).
        // Resolved once per request; intersects with the developer scope
        // above. Empty membership → truthful zero, never org-wide.
        $this->applyCohortScope($aggregatedQuery, $this->cohortScopeForRequest($request));

        // Repo scope — must match buildCanonicalQuery filter
        // CR-X 2B.1: Apply the same deterministic canonical repo matching
        // to the aggregated query as buildCanonicalQuery.
        $aggregatedMatchingRepos = $this->resolveRepoFilterMatchingUrls(request());
        if ($aggregatedMatchingRepos !== null) {
            if (!empty($aggregatedMatchingRepos)) {
                $aggregatedQuery->where(function ($q) use ($aggregatedMatchingRepos) {
                    foreach ($aggregatedMatchingRepos as $rawRepo) {
                        $q->orWhereRaw("json_extract(metadata, '$.git_repo_url') = ?", [$rawRepo]);
                    }
                });
            } else {
                $aggregatedQuery->whereRaw('1 = 0');
            }
        } elseif (request()->query('git_repo_url')) {
            $aggregatedQuery->whereRaw("json_extract(metadata, '$.git_repo_url') = ?", [request()->query('git_repo_url')]);
        }

        // Branch scope — must match buildCanonicalQuery filter
        if (request()->query('git_branch')) {
            $aggregatedQuery->whereRaw("json_extract(metadata, '$.git_branch') = ?", [request()->query('git_branch')]);
        }

        // Apply tool filter to aggregated query
        // Cannot use SELECT alias 'tool' in WHERE (SQLite limitation).
        // Replicate the CASE logic for matching.
        if ($tools && $tools !== 'all') {
            $toolList = array_map('trim', explode(',', $tools));
            $aggregatedQuery->where(function($q) use ($toolList) {
                foreach ($toolList as $tool) {
                    if ($tool === 'claude_code') {
                        $q->orWhere(function($q2) {
                            $q2->whereRaw("json_extract(metadata, '$.tool') = 'claude_code'")
                              ->orWhereRaw("json_extract(metadata, '$.vscode_version') = 'claude-code'")
                              ->orWhereRaw("json_extract(metadata, '$.extension_version') LIKE '%cc-bridge%'")
                              ->orWhereRaw("json_extract(metadata, '$.appName') LIKE '%Claude Code%'")
                              ->orWhereRaw("COALESCE(editor_source, source) = 'claude-code'")
                              ->orWhereRaw("COALESCE(editor_source, source) = 'claude_code'");
                        });
                    } else {
                        $q->orWhere('editor_source', $tool)
                          ->orWhere('source', $tool);
                    }
                }
            });
        }

        // AI activity filter — must match buildCanonicalQuery filter
        // CR-X Phase 3: Apply has_ai filter to aggregated query for filter reconciliation.
        if (request()->query('has_ai') === 'true') {
            $aggregatedQuery->whereRaw("COALESCE(json_extract(metadata, '$.ai_burst_count'), 0) > 0");
        } elseif (request()->query('has_ai') === 'false') {
            $aggregatedQuery->whereRaw("COALESCE(json_extract(metadata, '$.ai_burst_count'), 0) = 0");
        }

        $aggregated = $aggregatedQuery
            ->groupBy('tool', 'period')
            ->orderBy('period', 'desc')
            ->orderBy('tool', 'asc')
            ->get();

        // Process results without additional queries
        $results = [];
        foreach ($aggregated as $row) {
            $tool = $row->tool;

            if ($tool === 'extension' || !$tool) {
                continue;
            }

            $canonicalTool = $this->normalizeToolName($tool);

            // Convert SQLite %W week label to ISO year-week for frontend compatibility.
            // SQL grouping/filters still use the original $row->period SQLite key.
            $displayPeriod = $this->sqliteWeekPeriodToIso($row->period, $period);

            // Calculate focus_ratio from active_coding and idle_time
            $activeCoding = (float) ($row->active_coding_time_minutes ?? 0);
            $idleTime = (float) ($row->idle_time_minutes ?? 0);
            $totalTime = $activeCoding + $idleTime;
            $focusRatio = $totalTime > 0 ? round($activeCoding / $totalTime, 2) : 0;

            $results[] = [
                'tool' => $canonicalTool,
                'period' => $displayPeriod,
                'session_count' => (int) $row->session_count,
                'conversation_count' => (int) ($row->conversation_count ?? $row->session_count),
                'observation_sources' => $row->observation_sources ? explode(',', $row->observation_sources) : [],
                'average_session_length_minutes' => round((float) $row->average_session_length_minutes, 2),
                'total_session_minutes' => round((float) $row->total_session_minutes, 2),
                'active_coding_time_minutes' => round((float) ($row->active_coding_time_minutes ?? 0), 2),
                'ai_usage_duration_minutes' => round((float) ($row->ai_usage_duration_minutes ?? 0), 2),
                'time_to_first_commit_minutes' => round((float) ($row->time_to_first_commit_minutes ?? 0), 2),
                'ai_suggestions_accepted' => round((float) ($row->ai_suggestions_accepted ?? 0), 2),
                'files_edited_per_session' => round((float) ($row->files_edited_per_session ?? 0), 2),
                'commits_per_session' => round((float) ($row->commits_per_session ?? 0), 2),
                'idle_time_minutes' => round((float) ($row->idle_time_minutes ?? 0), 2),
                'focus_ratio' => $focusRatio,
            ];
        }

        return response()->json([
            'data' => $results,
            'metadata' => array_merge($sharedMetadata, [
                'tools_returned' => count(array_unique(array_column($results, 'tool'))),
                'periods_returned' => count(array_unique(array_column($results, 'period'))),
                'period' => $period,
                'format' => 'aggregated',
            ]),
        ]);
    }

    /**
     * Convert a SQLite strftime('%Y-%W') period key to an ISO 8601 year-week label.
     *
     * SQLite %W numbers weeks from the first Monday of the calendar year.
     * It is NOT ISO week numbering (ISO 8601 week 1 contains the first Thursday).
     * This function derives the actual Monday of the SQLite week, then returns
     * that Monday's ISO year-week (format 'o-W') so the accepted frontend can
     * render the correct chart date without a rebuild.
     *
     * @param string $sqlitePeriod 'YYYY-WW' from SQLite strftime('%Y-%W') when week
     * @param string $period one of 'week', 'day', 'month'
     * @return string ISO 8601 year-week label, or original if not week format
     */
    private function sqliteWeekPeriodToIso(string $sqlitePeriod, string $period): string
    {
        if ($period !== 'week' || !preg_match('/^(\d{4})-(\d{2})$/', $sqlitePeriod, $matches)) {
            return $sqlitePeriod;
        }

        $year = (int) $matches[1];
        $week = (int) $matches[2];

        $jan1 = new \DateTimeImmutable("{$year}-01-01", new \DateTimeZone('UTC'));

        // SQLite week 00 is the partial week before the first Monday.
        // Use Jan 1 itself to determine the ISO week label for that partial period.
        if ($week === 0) {
            return $jan1->format('o-W');
        }

        // First Monday of the calendar year; SQLite week 01 starts here.
        $jan1Weekday = (int) $jan1->format('N'); // 1=Mon ... 7=Sun
        $offset = (8 - $jan1Weekday) % 7;
        $firstMonday = $jan1->modify("+{$offset} days");

        // Monday of the requested SQLite week.
        $weekStart = $firstMonday->modify('+' . (($week - 1) * 7) . ' days');

        // ISO 8601 year-week of that Monday (handles year-boundaries correctly).
        return $weekStart->format('o-W');
    }

    public function identityCoverage(Request $request): JsonResponse
    {
        $request->validate([
            'organization_id' => 'required|integer|exists:organizations,id',
        ]);

        $orgId = (int) $request->input('organization_id');

        $totalSessions = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereNotNull('session_id')
            ->distinct()
            ->count('session_id');

        $byIdentitySource = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereNotNull('session_id')
            ->selectRaw("json_extract(metadata, '$.identity_source') as identity_source, COUNT(DISTINCT session_id) as session_count")
            ->groupBy('identity_source')
            ->get();

        $withInstallationId = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereNotNull('session_id')
            ->whereNotNull(DB::raw("json_extract(metadata, '$.installation_id')"))
            ->distinct()
            ->count('session_id');

        $withDeveloperId = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereNotNull('session_id')
            ->whereNotNull(DB::raw("json_extract(metadata, '$.developer_id')"))
            ->distinct()
            ->count('session_id');

        $withBackendClaimed = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereNotNull('session_id')
            ->whereRaw("json_extract(metadata, '$.identity_source') = ?", ['backend_claimed'])
            ->distinct()
            ->count('session_id');

        $uniqueInstallationIds = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereNotNull('session_id')
            ->selectRaw("json_extract(metadata, '$.installation_id') as installation_id")
            ->distinct()
            ->whereNotNull(DB::raw("json_extract(metadata, '$.installation_id')"))
            ->count('installation_id');

        $uniqueDeveloperIds = DB::table('telemetry_events')
            ->where('organization_id', $orgId)
            ->whereNotNull('session_id')
            ->selectRaw("json_extract(metadata, '$.developer_id') as developer_id")
            ->distinct()
            ->whereNotNull(DB::raw("json_extract(metadata, '$.developer_id')"))
            ->count('developer_id');

        return response()->json([
            'organization_id' => $orgId,
            'total_sessions' => $totalSessions,
            'sessions_with_installation_id' => $withInstallationId,
            'sessions_with_developer_id' => $withDeveloperId,
            'sessions_with_backend_claimed_identity' => $withBackendClaimed,
            'unique_installation_ids' => $uniqueInstallationIds,
            'unique_developer_ids' => $uniqueDeveloperIds,
            'by_identity_source' => $byIdentitySource->mapWithKeys(function ($row) {
                $source = $row->identity_source ?? 'null';
                return [$source => (int) $row->session_count];
            }),
            'coverage_percentage' => $totalSessions > 0
                ? round(($withBackendClaimed / $totalSessions) * 100, 1)
                : 0,
        ]);
    }
}
