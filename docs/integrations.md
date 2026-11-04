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

Terminal bridge that reports Claude Code sessions.

```bash
npm install -g <downloaded tgz>
chaosmonkey-cc-bridge install
```

Enrolls via connect code; sessions attribute as `claude-code`.

## Cursor Agents Window bridge (0.4.2-cursor-bridge)

Cursor's **standalone Agents Window** is separate from the Cursor IDE — it has
its own agent hooks. This bridge installs into `~/.cursor/hooks.json` and runs
a durable runtime under `~/.chaosmonkey-cursor-bridge/`. Requires Node.js >= 18.

```bash
npm install -g <downloaded tgz>
chaosmonkey-cursor-agent-bridge install
```

Sessions attribute as `cursor-agent` — kept distinct from Cursor IDE
telemetry. This is the verified 0.4.2 implementation (sha-256
`972acbc5c02efccac995484c80534e34f28de837a1e65a72520286353d2bbe21`).

## Codex CLI bridge (0.4.1-codex-bridge)

Reports OpenAI Codex CLI sessions; source variants (`codex-cli`, `codex_cli`,
`openai-codex`) normalize to canonical `codex`. Install flow matches the other
bridges.

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

## Explicitly not supported

- **Windsurf, Zed, other AI IDEs** — no client ships today; the ingest API is
  documented in `docs/reference/` if you want to build one.
- **GitLab / Bitbucket delivery evidence** — GitHub only, for now.
- **Real billing data** — spend figures are configured estimates, never usage
  billing.
