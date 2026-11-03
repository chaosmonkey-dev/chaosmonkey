# ChaosMonkey Technical Overview

---

## 1. What ChaosMonkey Measures

ChaosMonkey is an engineering telemetry and AI-assisted development
measurement platform that observes engineering workflow metadata from IDE
extensions and connects those signals with delivery outcomes. It operates on
the **developer / engineering-workflow side** of the software development
lifecycle.

The platform collects activity metadata from supported IDE extensions during
normal development, ingests it via an authenticated API, and presents
aggregated performance, AI-usage, and delivery insights on a leadership
dashboard.

**What it measures:**

- Coding session duration, active coding time, and idle gaps
- File edit counts (distinct files touched, not file names or contents)
- Characters and lines added/removed (counts only, not content)
- AI-assisted coding activity (burst counts, timing, magnitude — detected
  via local heuristics, not by accessing AI tool APIs)
- Language mix (IDE language IDs such as `typescript`, `python` — not file
  names or paths)
- Debug session counts and durations
- Terminal open counts and active time (not commands or output)
- File save counts and format-on-save inference
- Git context: sanitized repository URL, branch, commit SHA
- Workspace context: remote/local flag, remote type, folder count
- Optional delivery evidence via admin-initiated GitHub integration

**What it does NOT measure:**

Source code, file contents, diffs, AI prompt/completion text, keystroke text,
terminal commands/output, file names, file paths, workspace folder names,
commit messages, or Git author identity. ChaosMonkey does not intentionally
collect developer name/email/username as developer identity or authentication
credentials from Git; repository remote strings are subject to the documented
sanitizer behavior. See the
[Telemetry Data Dictionary](./CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md) for
the full field-level inventory and exclusion list.

---

## 2. Position in the SDLC

ChaosMonkey sits at the **developer workstation** during the Plan, Code, and
Commit phases. It observes what happens inside the IDE while engineers work.
An optional admin-side GitHub integration extends visibility into the Review,
Merge, and Deploy phases by correlating developer activity with pull
requests, reviews, and deployment outcomes.

```
Plan ─→ Code ─→ Commit ─→ Review ─→ Merge ─→ Deploy ─→ Operate
  └─────────── ChaosMonkey IDE extension ──────────┘
                    + optional GitHub integration ──────┘
```

---

## 3. High-Level Architecture

```
+----------------------+     +-------------------+     +-----------------------------+
| Developer            |     | IDE Extension     |     | Customer ChaosMonkey API    |
| Workstation          |────>| Host              |────>| (outbound, HTTPS in prod)   |
|  - Supported IDE     |     |  - Outbound only  |     |  - /api/ide/connect/exchange|
|  - ChaosMonkey ext.  |     |  - No listener    |     |  - /api/telemetry           |
+----------------------+     +-------------------+     +--------------+--------------+
                                                                      |
                                                                      v
                                                      +--------------+--------------+
                                                      | Dedicated Customer          |
                                                      | Application / Database      |
                                                      |  - Organization-scoped data |
                                                      |  - No cross-customer sharing|
                                                      +--------------+--------------+
                                                                      |
                                                                      v
                                                      +--------------+--------------+
                                                      | Leadership Dashboard        |
                                                      |  - Performance insights     |
                                                      |  - AI-usage signals         |
                                                      |  - Delivery metrics         |
                                                      +-----------------------------+
```

**Data flow:** Developer workstation → IDE extension host → outbound network
→ customer's ChaosMonkey API → dedicated customer application/database →
leadership dashboard.

Each customer receives a dedicated environment with its own application, API,
database, and configuration. Telemetry is scoped to the customer's
organization at ingestion time. No cross-customer data sharing occurs.

---

## 4. IDE Extension → Authenticated API → Customer Data Boundary → Analytics

1. **IDE extension** runs inside the IDE's extension host process. It observes
   editor activity events through the IDE extension API and creates telemetry
   events.

2. **Authenticated API.** Events are sent to the customer's ChaosMonkey API
   endpoint (`POST /api/telemetry`). Each batch is authenticated with a
   bearer credential issued during enrollment. The server authoritatively
   determines organization, developer, and installation identity from the
   credential — client-supplied identity fields do not override the
   credential's authority.

3. **Customer data boundary.** Telemetry is ingested into the customer's
   dedicated database, scoped to the customer's organization. The credential
   presented by the extension authoritatively determines the organization.

4. **Analytics.** A leadership dashboard reads from the same dedicated
   customer environment and presents aggregated performance insights, AI-usage
   signals, and delivery metrics.

---

## 5. Relationship to Optional GitHub / Delivery Evidence

GitHub and other delivery-system integration is **separate from the developer
extension** and is **optional** for initial telemetry collection.

- **Not required for extension operation.** Developer telemetry collection and
  dashboard insights operate without any delivery integration.
- **Admin/leadership initiated.** The integration is configured by a
  leadership or engineering-management dashboard user, not by developers. It
  is not part of the developer onboarding flow.
- **Enables delivery correlation.** When connected, it enables correlation of
  developer activity with pull requests, reviews, and delivery outcomes.
- **Server-side.** The integration runs server-side against the customer
  environment.

---

## 6. Leadership vs Developer Experience

**Developers** install the extension, connect once using an enrollment code,
and then work normally. They do not need dashboard access. The extension
operates in the background during normal development. No developer-facing
dashboard or daily interaction is required.

**Leadership and engineering managers** view aggregated insights on the
dashboard — performance insights, AI-usage patterns, delivery metrics. The
dashboard reads from the customer's dedicated environment.

This separation is intentional: the developer experience is minimal
(install, connect, work normally), and the analytical value is delivered to
leadership.

---

## 7. Extension Runtime Characteristics

- **Runs inside the IDE extension host.** The extension executes only within
  the IDE's extension host process and only while the IDE is running.
- **No background daemon.** No persistent system service or daemon is
  installed or started.
- **No local server or listener.** The extension opens no inbound network
  ports and accepts no incoming connections.
- **No kernel or privileged component.** No kernel driver, no privileged
  OS service, no native binary requiring administrator installation.
- **No Git CLI subprocess.** Git context (repository URL, branch, commit SHA)
  is obtained through the IDE's built-in Git extension API, not by spawning
  the `git` command-line tool.
- **No filesystem scanning.** The extension observes IDE editor activity
  events through the IDE extension API. It does not perform general
  filesystem traversal.
- **No direct communication with AI model providers.** AI activity is inferred
  locally from edit patterns and reported as counts/durations only.

---

## 8. Outbound-Only Network Model

The extension's network surface is minimal and strictly outbound:

- **Network communication is outbound-only.** The extension sends telemetry
  to the configured ChaosMonkey API endpoint. No inbound listener is opened.
- **Canonical/customer production deployments are configured for HTTPS/TLS.**
  The extension sends to whatever API base URL is configured during
  enrollment. The extension does not itself cryptographically enforce an
  `https://` scheme.
- **No developer-machine inbound ports.** The extension opens no listeners.
- **No local server.** No local HTTP/HTTPS server is started.
- **No peer-to-peer communication.** The extension does not communicate with
  other developer machines or extensions.
- **Single destination.** The extension communicates only with the configured
  ChaosMonkey environment. No other endpoints are contacted.

Two endpoints are used:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/ide/connect/exchange` | POST | Enrollment: exchanges an enrollment code for an extension credential |
| `/api/telemetry` | POST | Telemetry ingestion: submits a batch of activity events |

---

## 9. VS Code-Compatible Editor Model

ChaosMonkey's IDE extension is built on the standard VS Code-compatible
extension API and is designed to operate across VS Code-compatible editors
and forks that expose the required extension APIs.

**Declared/tested examples:**

- **Visual Studio Code** 1.85+
- **Cursor** 1.0+
- **Devin Desktop** (formerly Windsurf) 1.0+

**Architectural compatibility model:** The extension relies on the
VS Code-compatible extension host and standard extension APIs (editor
events, Git extension API, SecretStorage, globalState). Editors and forks
that expose these APIs are architecturally compatible; ChaosMonkey does not
guarantee that every VS Code fork or version will work without validation.

The extension activates on `onStartupFinished` (after the IDE loads) and
operates within the extension host process. No separate runtime is required.

Historical telemetry may still contain the `windsurf` identifier for
installations enrolled before the Devin Desktop rename; this is an internal
telemetry identifier and is not rewritten.

---

## 9.1 Development Surfaces

ChaosMonkey collects workflow metadata through two distinct collection paths:

### A. VS Code-Compatible IDEs

The standard ChaosMonkey IDE extension observes editor activity, AI-assisted
coding patterns, Git context, and session metadata inside supported
VS Code-compatible editors.

Examples:
- Visual Studio Code
- Cursor
- Devin Desktop (formerly Windsurf)
- other compatible VS Code-derived editors/forks where required APIs are
  available

### B. Claude Code Terminal

ChaosMonkey supports Claude Code workflows in terminal environments through
a separate hook-based telemetry adapter. This allows ChaosMonkey to observe
supported workflow metadata for developers using Claude Code directly from
a terminal rather than requiring the AI coding workflow to occur inside an
IDE.

These are separate collection paths. The IDE extension does not collect
terminal Claude Code telemetry, and the terminal adapter does not run
through the IDE extension host.

ChaosMonkey can cover Claude Code used in both IDE-based and terminal-based
development workflows through these different collection paths.

> **Scope note:** The detailed field dictionary and extension architecture
> documents describe the standard VS Code-compatible IDE extension contract.
> The Claude Code terminal adapter is a separate collection path whose exact
> field availability depends on the adapter and available hooks.

---

## 10. Security and Privacy Posture

**Authentication:** All telemetry requires a valid bearer credential issued
during enrollment. Unauthenticated requests are rejected. Credentials are
scoped to telemetry ingestion only — they cannot access dashboard or
administrative endpoints.

**Server-authoritative identity:** The server determines organization,
developer, and installation identity from the credential. Client-supplied
identity fields do not override credential authority. Installation ID
mismatch is rejected (HTTP 403).

**Credential storage:** The raw credential is stored client-side using the
IDE-provided SecretStorage API. ChaosMonkey does not persist the raw token
in its own plaintext configuration or state. The server stores only a
cryptographic hash (SHA-256).

**Data isolation:** Each customer receives a dedicated environment.
Telemetry is scoped to the customer's organization. No cross-customer data
sharing.

**Repository URL sanitization:** Repository remote URLs are processed by a
sanitizer before transmission. For HTTP/HTTPS URLs, embedded userinfo
(username and password/token in the userinfo component) is stripped using
the WHATWG URL parser. The host, path, and query string are preserved for
repository correlation. SSH/scp-style remotes (e.g.,
`git@host:org/repo.git`) are not parseable by the URL parser and are
returned unchanged. See the
[Telemetry Data Dictionary](./CHAOSMONKEY_TELEMETRY_DATA_DICTIONARY.md) for
details on current sanitizer behavior and limitations.

**No source code or content collection:** The extension is designed to
collect activity metadata (counts, durations, identifiers) — not source code,
file contents, diffs, prompts, or terminal output. ChaosMonkey does not
intentionally collect authentication credentials or developer identity from
Git; repository remote strings are subject to the documented sanitizer
behavior.

**Telemetry disable:** Extension telemetry can be disabled at any time
through the IDE setting. Uninstalling the extension stops all ChaosMonkey
execution — no independent daemon remains.

---

## 11. Boundary Between Developer Workflow Telemetry and Runtime Observability

ChaosMonkey observes **how software was produced** — the developer-side
workflow, AI usage, coding patterns, and delivery evidence that lead to a
change being made and committed.

It does **not** observe **what happened when that software ran** — runtime
traces, errors, latency, logs, server behavior, production regressions, or
monitoring signals. That is the domain of runtime observability platforms.

This boundary is clean and complementary. ChaosMonkey's telemetry schema
contains no runtime, infrastructure, or production-telemetry fields.
ChaosMonkey provides developer-workflow context that is typically outside
the native scope of runtime observability platforms.

---

## 12. Relationship to Runtime and Delivery Observability

Connecting developer-workflow signals with runtime outcomes creates a
development-to-production evidence chain that neither platform can provide
alone.

**ChaosMonkey provides:**
- Which pseudonymous developer/session context was associated with a change
- Whether AI assistance was used and how intensively
- Coding session duration, active coding time, rework patterns
- Language mix, debug activity, terminal activity
- Repository, branch, and commit SHA context
- Time-to-first-commit and delivery cadence

**Runtime observability platforms provide:**
- What happened when that change reached production
- Error rates, latency, regressions
- Trace context and service behavior
- Production monitors and alerts

**Potential combined value:** Correlating how software was produced with what
happened when it ran — for example, associating an AI-assisted development
workflow with the commit that later produced a runtime regression, or
comparing runtime reliability for changes produced under different coding
workflows.

See [ChaosMonkey Integration Surfaces](./CHAOSMONKEY_INTEGRATION_SURFACES.md)
for specific available data and potential integration directions.

---

## 13. OpenTelemetry Note

ChaosMonkey currently uses its own authenticated event schema for telemetry
ingestion. It does **not** currently emit native OpenTelemetry, use the
OpenTelemetry GenAI semantic conventions, or expose an OTLP endpoint.

Mapping ChaosMonkey context into OpenTelemetry is a potential integration
direction, clearly labeled as not implemented today. See the
[Integration Surfaces](./CHAOSMONKEY_INTEGRATION_SURFACES.md) document for
details.
