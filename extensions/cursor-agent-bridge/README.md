# ChaosMonkey Cursor Agent Bridge

**Version:** 0.4.2-cursor-bridge

A Node.js bridge that sends pseudonymous, aggregate-only telemetry from
Cursor's native agent hooks to a ChaosMonkey backend. It is **not** a VS
Code/Cursor extension — it runs as hook commands registered in the
user-scoped `~/.cursor/hooks.json`, so it also observes the standalone
Agents Window (no IDE extension host required).

## Prerequisites

- Node.js >= 18 (`node --version` — macOS: `brew install node`)
- Cursor with agent hooks support (verified on Cursor 3.25.9)
- A connect code from your ChaosMonkey admin

## Install (customer — from ChaosMonkey download)

One command — your ChaosMonkey admin will give you the expected SHA-256
for this release. Paste it in place of `<SHA256>`:

```bash
cd "$(mktemp -d)" \
  && curl -fsSLJO "https://chaosmonkey.example.com/api/cursor-agent-bridge/download/latest" \
  && echo "<SHA256>  chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz" | shasum -a 256 -c - \
  && tar -xzf chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz \
  && node package/install.js
```

What this does:

- Downloads the package over HTTPS. `-f` makes curl fail on server errors;
  `-J` uses the server's declared filename, so the checksum and extraction
  steps reference a fixed name.
- Verifies the SHA-256 **before** anything is extracted or run. If the
  checksum does not match, the command stops — nothing is installed.
- Extracts to a temporary directory and runs the installer.

**Integrity note:** the checksum is only trustworthy if it reaches you
through a channel separate from the download itself (e.g. directly from
your ChaosMonkey admin). A checksum fetched from the same server as the
package would not be independent proof.

The installer asks for your ChaosMonkey API base URL
(`https://chaosmonkey.example.com`) and your connect code, then finishes the
setup automatically. Existing `~/.cursor/hooks.json` entries are preserved;
no IDE extension changes are required.

The installer copies its runtime into `~/.chaosmonkey-cursor-bridge/runtime/`
and registers hooks against that durable path — the downloaded/extracted
directory may be deleted afterwards without affecting telemetry.

Non-interactive enrollment is supported via environment variables (useful
for scripted installs; keeps the connect code out of shell history):

```bash
CM_API_BASE_URL="https://chaosmonkey.example.com" CM_CONNECT_CODE="YOUR-CODE" node package/install.js
```

## Install (developer — from source)

From this directory:

```bash
node install.js
```

The installer prompts for your ChaosMonkey API base URL and connect code,
exchanges the code for an auth token, merges ChaosMonkey hook commands into
`~/.cursor/hooks.json` (preserving any existing non-ChaosMonkey hooks), and
validates connectivity with a real test event. If validation fails it
restores the pre-install hooks/config state automatically.

## Uninstall

```bash
node ~/.chaosmonkey-cursor-bridge/runtime/uninstall.js
```

(Or `node uninstall.js` from an installation directory that still exists.)

Removes only ChaosMonkey-owned hook entries from `~/.cursor/hooks.json`
(identified by the `chaosmonkey-cursor-bridge` marker in the command) and
deletes `~/.chaosmonkey-cursor-bridge/` (config, state, queue, logs, and
the installed runtime). It does not touch other hooks, project-level
`.cursor/hooks.json` files, `~/.claude/settings.json`, or Cursor itself.

## Telemetry scope

Aggregate only:

- Turn-segment session events (duration, edit counts, change magnitude,
  language mix) emitted at each agent-turn boundary (`stop` hook) with a
  stable parent Cursor conversation ID.
- Agent mode (`composer_mode`, `is_background_agent`), model id when
  provided.
- Commit counts, time-to-first-commit, git branch/repo URL (sanitized).
- Shell invocation COUNTS — command text is never captured or transmitted.

The bridge does **not** transmit file contents, diffs, prompts, agent
messages, shell commands/output, transcripts, file paths, user email, or
personal identity.

## Local files

All state lives under `~/.chaosmonkey-cursor-bridge/`:

- `runtime/` — durable copy of `bridge.js`, `install.js`, `uninstall.js`,
  `package.json`; all registered hooks point here
- `config.json` — endpoint, auth token, identity, `enabled` flag
- `state.json` — per-session segment state (durable across restarts)
- `queue.json` — retry queue for failed deliveries
- `bridge.log` — diagnostic log (payload key names only; no content)

To disable telemetry without uninstalling: set `"enabled": false` in
`config.json`.

## Hooks registered

`sessionStart`, `sessionEnd`, `afterFileEdit`, `afterShellExecution`,
`stop`. Each hook spawns a short-lived `node bridge.js <hook-name>`
process; all handlers fail safe and exit 0 so Cursor's normal execution is
never blocked. Failed deliveries are queued and retried on later
invocations.

## Claude Code interoperability

If the Claude Code bridge (`extensions/claude-code-bridge`) is also
installed, it suppresses Cursor-originated imported-hook events **only**
when this bridge is genuinely armed (valid enabled config + live hook
entries pointing at an existing `bridge.js`). Otherwise those events are
relabelled `source=cursor-agent` and delivered — no telemetry is silently
dropped.
