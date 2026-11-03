# ChaosMonkey Claude Code Bridge — Quickstart

**Version:** 0.4.1-cc-bridge  
**Artifact:** `chaosmonkey-cc-bridge-0.4.1-cc-bridge.tgz`  
**SHA-256:** `c07a0f864f177dd1ae4286b4d4e4284fe3794cde8b7fcdd3d2d4fd910b89022f`

---

## 1. Prerequisites

- **Node.js >= 18** (`node --version`)
- **Claude Code** installed and working (`claude --version`)
- A **ChaosMonkey connect code** from your admin (see step 2)

## 2. Get your connect code

Ask your ChaosMonkey admin to generate a connect code for you from
**Settings → Team → Generate Code**. The code looks like a short alphanumeric
string. The connect code is valid until its expiration time and may be used for
distinct editor installations while it remains valid.

## 3. Verify the tarball

```bash
shasum -a 256 chaosmonkey-cc-bridge-0.4.1-cc-bridge.tgz
```

Expected: `c07a0f864f177dd1ae4286b4d4e4284fe3794cde8b7fcdd3d2d4fd910b89022f`

If the hash does not match, do not proceed.

## 4. Extract

```bash
tar -xzf chaosmonkey-cc-bridge-0.4.1-cc-bridge.tgz
cd package
```

## 5. Install

```bash
node install.js
```

The installer will prompt for:

1. **API base URL** — your ChaosMonkey backend URL  
   (e.g. `https://prioritydispatch.chaosmonkey.dev`)
2. **Connect code** — the code from step 2

The installer:
- Exchanges the connect code for a bearer token
- Generates a pseudonymous `installation_id`
- Registers Claude Code hooks in `~/.claude/settings.json`
- Sends a test event and validates the response
- On failure, restores prior state and reports the error

## 6. Claude Code hook registration

The installer automatically merges hooks into `~/.claude/settings.json` for:
- `session-start`
- `session-end`
- `post-edit` (Edit/Write/MultiEdit/NotebookEdit)
- `post-bash`

No manual hook editing is required.

## 7. Restart / reload

No restart is needed. The hooks take effect on the next Claude Code session.
Start a new Claude Code session and the bridge will send telemetry automatically.

## 8. Verify installation

```bash
cat ~/.claude/settings.json | grep chaosmonkey
```

You should see hook entries containing `chaosmonkey-cc-bridge`.

Start a Claude Code session, make an edit, end the session. Check the
ChaosMonkey dashboard (Productivity by Tool) — Claude Code data should appear
within a few minutes.

## 9. What successful first telemetry looks like

- A `test_init` event is sent during installation (validated by the installer)
- On your first Claude Code session: a `session` event with `duration_ms`,
  `session_commits`, and AI burst metrics
- On each edit: a `file_edit` event with `language_id`, `chars_added`,
  `lines_added` (counts only — no file paths or content)
- On each bash command: a counter increment (command text is NOT captured)

## 10. Troubleshooting

**Install fails with "connect code exchange failed"**
- Check the API base URL is correct (HTTPS, no trailing slash issues)
- Check the connect code is valid and not expired
- Ask your admin to generate a new code

**No telemetry appears after a session**
- Check `~/.chaosmonkey-cc-bridge/bridge.log` for errors
- Verify `~/.chaosmonkey-cc-bridge/config.json` exists and has `api_base_url`
- Confirm your network can reach the ChaosMonkey backend HTTPS endpoint

**Hooks not registered**
- Check `~/.claude/settings.json` exists and is valid JSON
- If it was malformed before install, the installer refuses to proceed
- Manually verify: `cat ~/.claude/settings.json | grep chaosmonkey`

## 11. Uninstall / rollback

From the extracted `package/` directory:

```bash
node uninstall.js
```

This removes only ChaosMonkey hook commands from `~/.claude/settings.json`
and deletes `~/.chaosmonkey-cc-bridge/` (config, state, log). Your other
Claude Code settings are preserved.

## 12. What telemetry the bridge collects and does NOT collect

**Collected (transmitted to ChaosMonkey):**
- Event type (session, file_edit, test_init)
- Timestamp and session duration
- Aggregate counts: edit count, bash count, chars added/removed, lines added/removed
- Language IDs (e.g. `typescript`, `python`) — derived from file extension
- AI burst metrics (count, chars, lines, active span)
- Git repo URL (sanitized: credentials, query, fragment stripped)
- Git branch name
- Session commit count and time-to-first-commit
- Pseudonymous identity (installation_id UUID, backend-issued developer_id)
- Bridge version and source (`claude-code`)

**NOT collected (never transmitted, persisted, or logged):**
- Raw file paths
- File contents or edit text (old_string, new_string)
- Terminal command text or output
- Working directory (used transiently for local git commands only)
- Names, email addresses, or other direct identifiers

The bridge does not intentionally transmit names, email addresses, raw file
paths, file contents, edit text, or terminal command text. Repository URL and
branch name are transmitted as repository context. Coding-activity details are
otherwise sent as aggregate counts such as edits, characters, lines, language
IDs, and session duration.

## 13. Canonical HTTPS endpoint

The bridge enforces HTTPS for all remote endpoints. HTTP is permitted
only when the hostname is exactly `127.0.0.1` or `::1` (loopback).
Substring spoofing (e.g. `127.0.0.1.evil.example`) is rejected.

Your admin will provide the correct HTTPS endpoint URL.

## 14. Upgrading from an earlier community hook

Some developers installed an earlier community Claude Code hook (sometimes
called the "Bruce" hook) before the official bridge existed. The official
0.4.1 bridge is separate from that community hook — installing the official
bridge does **not** remove or modify the community hook.

To switch cleanly:
1. Install the official bridge (steps 4–5 above). It registers its own hooks
   under a distinct `chaosmonkey-cc-bridge` command path.
2. Remove the community hook entries from `~/.claude/settings.json` manually
   (or run the community hook's own uninstaller if it provided one).
3. Keep only the official bridge hooks to avoid double-counting telemetry.

Running both temporarily will inflate session counts until the community hook
is removed.
