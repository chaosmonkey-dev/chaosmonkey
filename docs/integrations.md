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

## IDE extension — VS Code and Cursor (`chaosmonkey-telemetry` 0.4.1)

1. Download the `.vsix` from your instance.
2. `code --install-extension chaosmonkey-telemetry-0.4.1.vsix`
   (or Cursor's extension UI → Install from VSIX).
3. In the app, generate a **connect code** and paste it into the extension
   when prompted — this enrolls the editor against your organization.

Captures editor activity, AI suggestion events, and session boundaries.
Distinct source: `vscode` / `cursor`.

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

For organization-level delivery evidence without per-user OAuth:

| Variable | Purpose |
|---|---|
| `GITHUB_APP_ID` | Your app's ID |
| `GITHUB_APP_INSTALLATION_ID` | Installation on the target org |
| `GITHUB_APP_PRIVATE_KEY` | PEM private key (multi-line; use `\n` escapes) |
| `GITHUB_APP_WEBHOOK_SECRET` | Webhook signature secret |

Webhooks arrive at `POST /api/github/app/webhook` (signature-verified).
Create the app at GitHub → Developer Settings → GitHub Apps.

## Verification status

Each client is validated in CI, but end-to-end coverage differs:

| Client | Package & download | Hook/install lifecycle | Real client session |
|---|---|---|---|
| VS Code/Cursor extension | Verified — sha-checked vsix served by backend | Verified via connect-code exchange + ingest | Not exercised in a GUI session — historically production-observed |
| Claude Code bridge | Verified | Verified end-to-end against a self-hosted instance (install → hooks → session → ingest → attribution) | Simulated hook lifecycle; `claude` CLI session not yet exercised |
| Cursor Agents bridge | Verified — sha-pinned artifact + capability endpoint | Verified end-to-end (install → hooks → session lifecycle → ingest) | Simulated hook lifecycle; Agents Window not yet exercised |
| Codex bridge | Verified | Verified end-to-end (install → hooks.json → session → ingest) | Requires manual hook-trust in Codex `/hooks`; real `codex` session not yet exercised |
| GitHub OAuth | Config + callback handling covered by backend tests | — | Not exercised with live GitHub credentials |
| GitHub App | Webhook signature handling covered by backend tests | — | Not exercised against a live GitHub App installation |

"Not exercised" means the packaged client is verified against the self-hosted
instance but a real vendor tool session hasn't been run in the release
environment — the boundaries above are deliberate, not unknowns.

## Explicitly not supported

- **Windsurf, Zed, other AI IDEs** — no client ships today; the ingest API is
  documented in `docs/reference/` if you want to build one.
- **GitLab / Bitbucket delivery evidence** — GitHub only, for now.
- **Real billing data** — spend figures are configured estimates, never usage
  billing.
