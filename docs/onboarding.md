# Onboarding your organization

This walkthrough takes a fresh self-hosted install from first login to
developers sending telemetry. Everything here is done by an administrator in
the dashboard UI — no server access is needed after the install.

**Prerequisite:** a running instance with an admin account
(see [installation.md](installation.md) → "Create the first administrator").

---

## 1. Your organization already exists

`chaosmonkey:create-admin` creates the admin user **and** a default
organization (named "Primary Organization" unless you pass `--org=`). The
admin lands in that org at first login.

If you run multiple organizations on one install, create additional orgs from
the admin UI — each org is its own authority: separate developers, invites,
tokens, and telemetry.

## 2. Invite developers

Dashboard → **Settings / Team** → invite by email (single or bulk).

Each invite produces an enrollment path for one developer. Invites are
org-scoped — a code minted for org A cannot enroll into org B.

You can also create developer entries directly and assign them to teams
later; invites are the self-service path.

## 3. Issue a connect code

For each enrolled developer, generate a **connect code** (the UI exposes this
per developer/invite). A connect code is a one-time exchange credential — it
is *not* the ingest token.

The developer's client trades it for a per-installation bearer token:

```
POST /api/ide/connect/exchange
  { installation_id, extension_version, connect_code }
→ bearer token (bound to org + developer + installation)
```

After exchange, the token identifies everything the client sends —
`developer_id`, `organization_id`, and `installation_id` come from the token,
not from client claims. Clients cannot impersonate each other.

## 4. Install a client on the developer's machine

Each client is downloaded **from your instance** so versions always match the
server (see [integrations.md](integrations.md) for the full matrix):

| Tool | Install | Endpoint it needs |
|---|---|---|
| VS Code / Cursor IDE | `.vsix` from `GET /api/extension/download/latest` → `code --install-extension` | Your `APP_URL` + connect code (prompted) |
| Claude Code | `npm i -g` the `…-cc-bridge.tgz` → `chaosmonkey-cc-bridge-install` | `CM_API_BASE_URL` + `CM_CONNECT_CODE` |
| Cursor Agents Window | `npm i -g` the `…-cursor-bridge.tgz` → `chaosmonkey-cursor-bridge-install` | same env vars |
| Codex CLI | `npm i -g` the `…-codex-bridge.tgz` → `chaosmonkey-codex-bridge-install` | `--api-base-url` + `--connect-code` |

All clients post events to `POST <APP_URL>/api/telemetry` with their
installation bearer token. If your instance moves hostnames later, only this
endpoint URL changes — tokens stay valid.

Codex-specific: the hook must be **trusted** inside Codex (`/hooks`) before it
reports — the bridge deliberately never bypasses hook trust.

## 5. Confirm telemetry is arriving

In the dashboard:

- **Pilot Health / Setup view** — lists enrolled installations and last-seen
  activity; a developer appears here as soon as their first event lands.
- **Productivity by Tool** — per-workflow session series; sessions appear
  within the first client heartbeat/session boundary.

From the server (optional):

```bash
docker exec chaosmonkey sqlite3 /data/database.sqlite \
  "SELECT COUNT(*) FROM telemetry_events;"
```

## 6. What the dashboard shows before data accumulates

This is deliberate, not broken:

- **Insights render honestly-gated states** — Performance Insights only show
  findings backed by measured evidence; with little data you see diagnostic
  "needs more telemetry" cards, not synthetic numbers.
- **PBT shows real, possibly sparse, series** — zero sessions is rendered as
  zero only where the window actually contains sessions; empty windows show
  as missing, not zero.
- Most findings need **≥30 sessions** org-wide; cross-workflow comparisons
  need **≥25 sessions per workflow**. Plan for several days of normal use
  before judging insight coverage.
- GitHub-dependent metrics stay "unavailable" (not zero) until the GitHub
  integration is configured — see
  [integrations.md → GitHub App](integrations.md#github-app-optional--org-delivery-evidence).

## 7. Teams and permissions

- **Admins** create invites, connect codes, org settings, and can clear data.
- **Members** see the dashboard scoped to their organization.
- Assign developers to teams/cohorts from the Team view — cohort
  membership drives the cohort filters on PBT and PI.

## 8. Common first-week issues

| Symptom | Cause | Fix |
|---|---|---|
| Client installs but nothing arrives | Endpoint URL wrong or firewall blocks it | Client log shows `POST …/api/telemetry` status; verify `APP_URL` reachable from dev machines |
| 401 on telemetry | Bad/expired connect code or token | Reissue a connect code; check token not revoked |
| Developer shows wrong tool name | Source normalization | `codex-cli`/`openai-codex` normalize to `codex`; IDE vs bridge are distinct sources by design |
| Everything shows "needs more data" | Below minimum samples | Expected until ~30+ sessions accumulate |
| GitHub metrics "unavailable" | No GitHub App configured | Optional — configure per integrations.md |
| Sessions attributed to wrong developer | Shared connect code | One code per installation — issue separate codes |
