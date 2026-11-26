# Integrations

Packaged clients are served directly by your backend, so the client version
always matches the server. Download links appear in the app's connect flows;
they can also be fetched directly:

| Endpoint | Artifact |
|---|---|
| `GET /api/extension/download/latest` | VS Code/Cursor VSIX |
| `GET /api/bridge/download/latest` | Claude Code bridge (tgz) |
| `GET /api/cursor-agent-bridge/download/latest` | Cursor Agents bridge (tgz) |
| `GET /api/codex-bridge/download/latest` | Codex bridge (tgz) |
| `GET /api/cursor-agent-bridge/capability` | Cursor-agent capability manifest |

## IDE extension — VS Code, Cursor, Windsurf, Devin Desktop (`chaosmonkey-telemetry` 0.4.1)

1. Download the `.vsix` from your instance.
2. `code --install-extension chaosmonkey-telemetry-0.4.1.vsix`
   (or the editor's extension UI → Install from VSIX — `cursor`,
   `windsurf`, and `devin-desktop` support the same command).
3. In the app, generate a **connect code** and paste it into the extension
   when prompted — this enrolls the editor against your organization.

Captures editor activity, AI suggestion events, and session boundaries.
The extension detects the host product from `vscode.env.appName`, so one
VSIX serves every VS Code-fork editor. Distinct sources: `vscode`,
`cursor`, `windsurf`, `devin`.

**Devin Desktop vs. Devin (the agent product):** the extension covers the
Devin *Desktop IDE* — a VS Code fork whose sessions attribute as `devin`.
It does not instrument the separate autonomous Devin cloud-agent product;
there is no client for that today. Telemetry recorded historically under
`windsurf` (before the rebrand) remains valid canonical data — both source
names are first-class tools.

## Claude Code bridge (0.4.2-cc-bridge)

Terminal bridge that reports Claude Code sessions. Requires Node.js >= 18.

```bash
npm install -g <downloaded tgz>
chaosmonkey-cc-bridge-install        # interactive prompts for URL + connect code
```

Headless install (CI, remote hosts):

```bash
CM_API_BASE_URL=https://your-instance CM_CONNECT_CODE=XXXX-XXXX \
  chaosmonkey-cc-bridge-install
```

The installer merges hooks into `~/.claude/settings.json` (existing hooks are
preserved; a backup is written). Sessions attribute as `claude-code`.
Remove with `chaosmonkey-cc-bridge-uninstall`.

## Cursor Agents Window bridge (0.4.2-cursor-bridge)

Cursor's **standalone Agents Window** is separate from the Cursor IDE — it has
its own agent hooks. This bridge installs into `~/.cursor/hooks.json` and runs
a durable runtime under `~/.chaosmonkey-cursor-bridge/`. Requires Node.js >= 18.

```bash
npm install -g <downloaded tgz>
chaosmonkey-cursor-bridge-install
```

`CM_API_BASE_URL` / `CM_CONNECT_CODE` environment variables enable
non-interactive installs, same as the Claude Code bridge. Sessions attribute
as `cursor-agent` — kept distinct from Cursor IDE telemetry. This is the
verified 0.4.2 implementation (sha-256
`972acbc5c02efccac995484c80534e34f28de837a1e65a72520286353d2bbe21`).

## Codex CLI bridge (0.4.1-codex-bridge)

Reports OpenAI Codex CLI sessions; source variants (`codex-cli`, `codex_cli`,
`openai-codex`) normalize to canonical `codex`. Requires Node.js >= 18 and the
Codex CLI.

```bash
npm install -g <downloaded tgz>
chaosmonkey-codex-bridge-install \
  --api-base-url https://your-instance --connect-code XXXX-XXXX
```

The installer writes `~/.codex/hooks.json`. **Codex requires you to trust the
hook**: start Codex, open `/hooks`, review the ChaosMonkey hook, and trust it —
the bridge deliberately never uses `--dangerously-bypass-hook-trust`, so it
reports nothing until you grant trust. Remove with
`chaosmonkey-codex-bridge-uninstall`.

## GitHub OAuth (optional — delivery evidence)

Correlates telemetry sessions with PRs, reviews, and deployments.

1. Create an OAuth app at <https://github.com/settings/applications/new>
   with callback `<APP_URL>/api/github/oauth/callback`.
2. Set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

Per-user consent; tokens stay in your instance.

## GitHub App (optional — org delivery evidence)

For organization-level delivery evidence without per-user OAuth. The App is
customer-owned: create **your own** GitHub App in your GitHub organization —
never reuse another install's app or private key.

| Variable | Purpose |
|---|---|
| `GITHUB_APP_ID` | Your app's ID |
| `GITHUB_APP_INSTALLATION_ID` | Installation on the target org |
| `GITHUB_APP_PRIVATE_KEY` | PEM private key (multi-line; use `\n` escapes) |
| `GITHUB_APP_WEBHOOK_SECRET` | Webhook signature secret |

Webhooks arrive at `POST /api/github/app/webhook` (signature-verified).

### Create the App

GitHub → your organization → Developer Settings → GitHub Apps → New.

- **Webhook URL:** `https://<your-host>/api/github/app/webhook` (requires the
  public HTTPS hostname — GitHub will not deliver to plain HTTP)
- **Webhook secret:** generate a strong random secret → `GITHUB_APP_WEBHOOK_SECRET`

Permissions and what each unlocks:

| Permission | Required for |
|---|---|
| Metadata (read) | Always — installation identity |
| Pull requests (read) | PR evidence + merge/cycle metrics |
| Contents (read) | Release evidence (`release_count`; without it releases report *unavailable*, not zero) |
| Deployments (read) | Deployment history + failure-rate metrics |
| Issues (read) | Per-review timeline / reopen-cycle evidence (optional — without it those fields report *unavailable*) |

**Subscribe to events:** pull request, pull request review, deployment,
release. After creating, **install** the app on the organization and record
the installation ID → `GITHUB_APP_INSTALLATION_ID`.

### Verify configuration

```bash
docker exec chaosmonkey php /var/www/backend/artisan github:app-sync --dry-run
```

Inventories the installation's repositories via the installation token —
no writes, no ingestion. `GITHUB_APP_INSTALLATION_ID not configured` means the
env vars are not set; a 401/404 means the ID or key is wrong.

### Initial historical sync

Webhooks only cover events *after* the app is installed. Backfill history
once:

```bash
docker exec chaosmonkey php /var/www/backend/artisan github:app-sync \
  --all --days=365 --enrich-reviews --include-deployments --include-releases
```

Idempotent upserts — safe to interrupt and re-run; existing rows are updated,
never duplicated. Useful options: `--repo=`/`--repos=` subset,
`--from-repo=` resume, `--days=` window, `--dry-run` inventory.

### Ongoing synchronization + missed-event recovery

New events arrive by webhook in real time. The App can also recover any gap —
missed deliveries while the endpoint was down, events before the webhook was
configured — because `github:app-sync` re-fetches from the API rather than
replaying deliveries. Run it periodically for gap insurance, e.g. host cron:

```cron
*/30 * * * * docker exec chaosmonkey php /var/www/backend/artisan github:app-sync --days=2 --enrich-reviews
```

### Diagnostics

| Symptom | Check |
|---|---|
| No PR/deploy rows appear | `--dry-run` inventories repos? → if not, App creds/installation wrong |
| Webhook deliveries show 4xx in GitHub's delivery log | `GITHUB_APP_WEBHOOK_SECRET` mismatch |
| Reviews count stays 0 | `--enrich-reviews` has not run; `review_count` counts submitted reviews only |
| Releases show "unavailable" | App lacks Contents (read) — expected `null`, not an error |
| Sync is slow | Normal on first backfill; use `--days=`, `--repo=`, `--sleep-ms=` to pace API usage |

## Verification status

Each client is validated in CI, but end-to-end coverage differs:

| Client | Package & download | Hook/install lifecycle | Real client session |
|---|---|---|---|
| VS Code/Cursor extension | Verified — sha-checked vsix served by backend | Verified via connect-code exchange + ingest | Not exercised in a GUI session — historically production-observed |
| VSIX on VS Code forks (Windsurf, Devin Desktop) | Verified — `--install-extension` + `--uninstall-extension` exercised on a real Windsurf binary | Fork detection (`appName` → `editor_source`) covered by backend tests; same connect-code flow as VS Code | Fork GUI session not exercised; source classification verified end-to-end via ingest |
| Claude Code bridge | Verified | Verified end-to-end against a self-hosted instance (install → hooks → session → ingest → attribution) | Simulated hook lifecycle; `claude` CLI session not yet exercised |
| Cursor Agents bridge | Verified — sha-pinned artifact + capability endpoint | Verified end-to-end (install → hooks → session lifecycle → ingest) | Simulated hook lifecycle; Agents Window not yet exercised |
| Codex bridge | Verified | Verified end-to-end (install → hooks.json → session → ingest) | Requires manual hook-trust in Codex `/hooks`; real `codex` session not yet exercised |
| GitHub OAuth | Config + callback handling covered by backend tests | — | Not exercised with live GitHub credentials |
| GitHub App | Webhook signature handling covered by backend tests | — | Not exercised against a live GitHub App installation |

"Not exercised" means the packaged client is verified against the self-hosted
instance but a real vendor tool session hasn't been run in the release
environment — the boundaries above are deliberate, not unknowns.

## Explicitly not supported

- **Zed, JetBrains IDEs, other non-VS Code editors** — they cannot run the
  VSIX client; the ingest API is documented in `docs/reference/` if you
  want to build one.
- **Devin autonomous cloud agent** — see the note above; only the Devin
  Desktop editor is instrumented.
- **GitLab / Bitbucket delivery evidence** — GitHub only, for now.
- **Real billing data** — spend figures are configured estimates, never usage
  billing.
