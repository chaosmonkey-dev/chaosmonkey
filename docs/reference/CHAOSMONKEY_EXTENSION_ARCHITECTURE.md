# ChaosMonkey Extension Architecture

---

## 1. Standard IDE-Extension Runtime

The ChaosMonkey extension is a standard VS Code-compatible extension. It
executes inside the IDE's extension host process — the extension-host
runtime/process provided by the IDE for extensions, separate from the
editor renderer/UI. It does not install any separate
process, daemon, or system service.

**VS Code-Compatible Editor Model (declared in `package.json` engines):**

This document describes the **standard IDE extension path**. The extension
is built on the VS Code-compatible extension API and is designed to operate
across VS Code-compatible editors and forks that expose the required
extension APIs.

**Declared/tested examples:**
- Visual Studio Code 1.85+
- Cursor 1.0+
- Devin Desktop (formerly Windsurf) 1.0+

Claude Code terminal workflows are supported through a separate hook-based
adapter and are not executed through the IDE extension host.

---

## 2. Activation / Lifecycle

**Activation event:** `onStartupFinished`

The extension activates after the IDE finishes loading. On activation:

1. Initialize stable installation identity (UUID v4, persisted in IDE
   globalState)
2. Create output channel for developer-visible logging
3. Load configuration from IDE settings (API base URL, enabled flag, flush
   interval)
4. Restore connection state from SecretStorage (if a token was previously
   stored)
5. Initialize telemetry queue and reliable-delivery state
6. Register commands (Connect, Flush Now, Record AI Accept, Record Commit,
   Test Git Capture, Send Test Event)
7. Register event listeners (file edit, AI detection, debug, save, terminal,
   Git commit)
8. Start flush timer and idle timeout timer (if connected and enabled)

**Deactivation:** On `deactivate()`, the extension ends any active session
(with `end_reason = "shutdown"`) and flushes the queue synchronously before
the IDE kills the extension host.

---

## 3. No Separate Daemon / Listener / Native Service

Verified from source:

- **No background daemon.** No persistent system service is installed or
  started. The extension runs only while the IDE is running.
- **No local server or listener.** No inbound network ports are opened.
- **No kernel or privileged component.** No kernel driver, no privileged OS
  service, no native binary.
- **No filesystem scanning.** The extension observes IDE editor activity
  events through the IDE extension API. It does not perform general
  filesystem traversal.

---

## 4. Enrollment / Connect-Code Process

### 4.1 Admin-Side Setup

1. A platform administrator creates an **invite** for a developer, bound to
   the customer's organization. One invite represents one developer identity.
2. The admin issues a **connect code** for that invite. Connect codes are
   16-character uppercase strings (format: `XXXXXXXX-XXXXXXXX`), short-lived
   (default 7 days), and rate-limited at the API (10 requests per minute).
3. A connect code is **reusable across distinct editor installations** for
   the same invite. The same developer may enroll multiple supported editor
   installations (e.g., VS Code on laptop, Cursor on desktop), and each
   installation receives its own token.

### 4.2 Developer-Side Connect Flow

```
  Developer                Extension                 Backend
     |                        |                        |
     |  Run "Connect" cmd     |                        |
     |----------------------->|                        |
     |  Enter API URL         |                        |
     |----------------------->|                        |
     |  Enter connect code    |                        |
     |----------------------->|                        |
     |                        |  POST /api/ide/        |
     |                        |  connect/exchange      |
     |                        |  {code, installation_id,|
     |                        |   extension_version}   |
     |                        |----------------------->|
     |                        |                        |
     |                        |     Validate code      |
     |                        |     Check not expired   |
     |                        |     Resolve invite+org  |
     |                        |     Create per-install  |
     |                        |     token (SHA-256      |
     |                        |     hashed server-side) |
     |                        |                        |
     |                        |  {token, developer_id,  |
     |                        |   organization_id,      |
     |                        |   team_id, installation |
     |                        |   _id, identity_source, |
     |                        |   expires_at}           |
     |                        |<-----------------------|
     |                        |                        |
     |                        |  Store token in         |
     |                        |  SecretStorage          |
     |                        |  Store profile in       |
     |                        |  globalState            |
     |                        |  Set isConnected=true   |
     |                        |  Start timers           |
     |                        |                        |
     |  "Connected" message   |                        |
     |<-----------------------|                        |
     |                        |                        |
```

### 4.3 Request / Response Contract

**Request (POST `/api/ide/connect/exchange`):**
```json
{
  "code": "ABCDEFGH-12345678",
  "installation_id": "uuid-v4-string",
  "extension_version": "<current-version>"
}
```

**Response:**
```json
{
  "token": "64-char-cryptographically-random-string",
  "developer_id": "invite:42",
  "organization_id": 1,
  "team_id": null,
  "installation_id": "uuid-v4-string",
  "identity_source": "backend_claimed",
  "expires_at": "2026-11-25T12:00:00Z"
}
```

---

## 5. SecretStorage / Token Handling

- **Client-side storage:** The raw token is stored using the IDE-provided
  SecretStorage API. ChaosMonkey does not persist the raw token in its own
  plaintext configuration or state. The specific operating-system backing
  store depends on the IDE and platform.
- **Server-side storage:** The server stores only a SHA-256 hash of the
  token. The raw token is returned to the extension once at enrollment and
  is not retained in retrievable form server-side.
- **Token expiry:** 90 days from issuance.
- **Token revocation:** Administrators can revoke tokens. Revoked tokens are
  rejected at the API.
- **Token scoping:** Invite-backed tokens are restricted to telemetry
  ingestion endpoints only (`/api/telemetry`). They cannot access dashboard,
  administrative, or other read endpoints (HTTP 403 on non-telemetry paths).

---

## 6. Pseudonymous Developer Identity

- **Installation ID:** UUID v4, generated locally on first activation,
  persisted in IDE globalState. Not a human identifier.
- **Developer ID:** Backend-issued pseudonymous identifier (format:
  `invite:{invite_id}` or `user:{user_id}`). Null before connect. Not a
  human identifier.
- **Team ID:** Backend-issued, reserved for future use. Currently null.
- **Identity source:** Classification of how identity was established
  (`generated_installation`, `backend_claimed`, `legacy_unknown`, etc.).

**ChaosMonkey does not intentionally collect developer name/email/username
as first-class developer identity fields.** Developer identity used by
telemetry is pseudonymous (UUID + backend-issued ID). Git author name/email
is not collected. Repository remote strings are separately collected for
correlation and remain subject to the documented sanitizer limitations
(see the
[Telemetry Data Dictionary](./CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md)).

---

## 7. Installation Identity and One Developer / Multiple Installations

- Each editor installation generates its own `installation_id` (UUID v4).
- One invite (one developer) can enroll multiple installations.
- Each installation receives its own token, bound to that installation's
  `installation_id`.
- The same connect code can be used across installations for the same invite
  (codes stay active after first use).

---

## 8. Token Authority and Server-Authoritative Organization Association

When telemetry is submitted with a valid bearer token:

1. The server resolves the token to determine `organization_id`,
   `developer_id`, and `installation_id`.
2. The server **overrides** client-supplied `organization_id` and
   `user_id`/`developer_id` with the token-resolved values.
3. The server writes `identity_source = 'backend_claimed'` into every
   event's metadata.
4. Client-supplied identity fields **do not** override credential authority.

Without a token (local development/testing), client-supplied identity is
accepted.

---

## 9. Telemetry-Only Credential Restrictions

Invite-backed installation tokens are restricted to:
- `POST /api/telemetry`
- `POST /api/telemetry/upload`

Any attempt to use an invite-backed token on a non-telemetry endpoint returns
HTTP 403 with `error_code: TELEMETRY_ONLY_TOKEN`.

---

## 10. Event Creation

The extension creates telemetry events from IDE activity:

- **Session events:** One per continuous activity window. A session starts
  on first meaningful activity (file edit, AI accept, or commit) and ends
  after 10 minutes of idle or on extension shutdown. Rich metadata is
  emitted at session end (see the
  [Telemetry Data Dictionary](./CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md)).
- **File edit events:** Aggregated edit counts, emitted at flush.
- **AI accept events:** Emitted on manual command.
- **Commit events:** Emitted when commit hash changes (detected via IDE Git
  API, not Git CLI).
- **Test events:** Manual, for support/debugging.

Each event receives a deterministic `event_id` (hash of stable properties)
for backend deduplication.

---

## 11. Local Queue / Batching

- Events are queued in an in-memory array before delivery.
- **Maximum queue size:** 5,000 events. If exceeded, oldest events are
  dropped (with logging).
- **Flush interval:** Configurable (default 30 seconds).
- **Flush-time enrichment:** Best-effort population of `session_id` and Git
  context into events that were queued before context resolved.
- **Batch size:** Up to 1,000 events per API request (backend limit).

---

## 12. Retry / Backoff Behavior

- **Requeue-on-failure:** Failed batches are prepended back to the queue.
- **Exponential backoff:** Delay = min(2^failures × 5s, 2 minutes).
  - Failure 1: 5s
  - Failure 2: 10s
  - Failure 3: 20s
  - ...capped at 120s
- **Success:** Backoff state reset.
- **Token revocation (HTTP 401/403):** Collection stops, connection
  disconnected, re-connect required. No retry on auth failure.
- **Timeout:** 5-second request timeout via AbortController.

---

## 13. Queue Bounds

| Parameter | Value |
|---|---|
| Max queue events | 5,000 |
| Backoff base | 5,000 ms |
| Backoff max | 120,000 ms (2 minutes) |
| Request timeout | 5,000 ms |
| Flush interval (default) | 30 seconds |
| Max events per batch | 1,000 (backend limit) |

---

## 14. Outbound Network Transport

- **Protocol:** The extension uses the `fetch()` API to send to the
  configured `apiBaseUrl`. The extension does not itself enforce an
  `https://` scheme — it sends to whatever URL is configured during
  enrollment. Canonical/customer production deployments are configured for
  HTTPS/TLS.
- **Method:** POST
- **Endpoint:** `{apiBaseUrl}/api/telemetry`
- **Content-Type:** `application/json`
- **Authentication:** `Authorization: Bearer {token}` header
- **No other endpoints contacted.** The extension communicates only with
  the configured ChaosMonkey environment.

---

## 15. Behavior When Disconnected / Unauthorized

- **No token (disconnected):** Telemetry collection does not start. The
  extension waits for the developer to run the Connect command.
- **Token revoked (HTTP 401/403):** Collection stops. The extension
  disconnects. The developer must re-connect with a new connect code.
- **Network failure:** Events are queued with exponential backoff retry.
  Queue bounds prevent unbounded memory growth.
- **Disabled setting:** If `chaosmonkey.enabled` is false, no telemetry is
  collected or sent.

---

## 16. Installation Mismatch Behavior

When a valid token is present, the server enforces strict installation ID
matching:

1. `installation_id` must be present in the request body (top-level)
2. `installation_id` must be present in the first event's metadata
3. Both must exactly match the `installation_id` bound to the API token

Any mismatch returns HTTP 403 with `error_code: INSTALLATION_ID_MISMATCH`.

This prevents token theft/abuse across different editor installations.

---

## 17. Disable Behavior

- Setting `chaosmonkey.enabled` to `false` stops all telemetry collection
  and sending.
- The extension remains loaded but inactive for telemetry purposes.
- Re-enabling resumes collection (if connected).

---

## 18. Uninstall Behavior

Uninstalling the extension stops all ChaosMonkey execution on that
workstation. No independent daemon or background service remains — the
extension runs only inside the IDE host process.

The SecretStorage token and globalState identity are managed by the IDE and
may persist until the IDE removes extension data.

---

## 19. Use of IDE Git API (Not Git CLI)

The extension obtains Git context through the IDE's built-in Git extension
API (`vscode.git`), not by spawning the `git` command-line tool as a
subprocess.

- Accesses `git.repositories` array
- Finds the repository for the active editor's file
- Extracts branch from `state.HEAD.name`
- Extracts remote URL from `state.remotes`
- Detects commits by watching `repo.onDidChange` events (with 15-second
  polling fallback for lazy-loading race conditions)
- Deduplicates by tracking last known commit hash per repository

**No child-process invocation of Git CLI.**

---

## 20. Git Context Sanitization

Repository remote URLs are processed by a sanitizer before any telemetry
emission:

- **HTTP/HTTPS URLs:** Embedded userinfo (username and password/token in
  the userinfo component) is stripped using the WHATWG URL parser. Host,
  path, and query string are preserved for repository correlation.
- **SSH/scp-style remotes** (e.g., `git@host:org/repo.git`): Not parseable
  by the URL parser. Returned unchanged.
- **Query string preservation:** The current sanitizer does not strip query
  parameters. If a repository remote URL contains query parameters, they
  are preserved in the transmitted URL.
- **Sanitization chokepoint:** A single function (`sanitizeRepoUrl`) is the
  only path through which repo URLs are processed before emission.

---

## 21. Sequence Diagram: Telemetry Delivery

```
  Developer                Extension                 Backend
     |                        |                        |
     |  Normal coding         |                        |
     |  activity              |                        |
     |----------------------->|                        |
     |                        |                        |
     |                        |  Create events         |
     |                        |  Queue locally         |
     |                        |  (max 5000, backoff)   |
     |                        |                        |
     |                        |  Flush interval        |
     |                        |  (default 30s)         |
     |                        |                        |
     |                        |  POST /api/telemetry   |
     |                        |  Authorization: Bearer |
     |                        |  {source, events,      |
     |                        |   installation_id,     |
     |                        |   developer_id, ...}   |
     |                        |----------------------->|
     |                        |                        |
     |                        |     Validate token     |
     |                        |     Override identity  |
     |                        |     (server-           |
     |                        |     authoritative)     |
     |                        |     Check installation |
     |                        |     ID match           |
     |                        |     Store events       |
     |                        |                        |
     |                        |  200 OK                |
     |                        |<-----------------------|
     |                        |                        |
     |                        |  Reset backoff         |
     |                        |  Clear sent events     |
     |                        |  from queue            |
     |                        |                        |
```

**On failure:** Requeue events, apply exponential backoff, retry on next
flush interval. On auth failure (401/403): stop collection, disconnect.
