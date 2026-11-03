# ChaosMonkey Claude Code Bridge

**Version:** 0.4.1-cc-bridge

A Node.js bridge that sends pseudonymous coding telemetry from Claude Code
(terminal) to a ChaosMonkey backend. It is **not** a VS Code extension — it
runs as a set of Claude Code hooks.

## Prerequisites

- Node.js >= 18
- A ChaosMonkey backend running (Local: `http://localhost:8010`)
- A connect code from your ChaosMonkey admin (Settings → Team → Generate Code)

---

## Recipient Installation (from distributed tarball)

If you received `chaosmonkey-cc-bridge-0.4.1-cc-bridge.tgz`, follow these
steps. You do **not** need the ChaosMonkey source repository.

### 1. Verify the tarball SHA-256

Before extracting, verify the tarball has not been tampered with:

```bash
shasum -a 256 chaosmonkey-cc-bridge-0.4.1-cc-bridge.tgz
```

Compare the output against the published SHA-256 value for this release
(see release notes or ask your ChaosMonkey admin). If the hash does not
match, do not proceed.

### 2. Extract the tarball

```bash
tar -xzf chaosmonkey-cc-bridge-0.4.1-cc-bridge.tgz
cd package
```

This extracts the bridge files into a `package/` directory containing:
- `bridge.js` — the hook handler
- `install.js` — the installer
- `uninstall.js` — the uninstaller
- `package.json` — metadata
- `README.md` — this file

### 3. Verify extracted file SHA-256 values

```bash
shasum -a 256 bridge.js install.js uninstall.js
```

Expected values for version 0.4.1-cc-bridge:

```
ee472efc164642ddcac3170f8dcb69ce771baacd68c6a7b7c817d62580cd2720  bridge.js
cc45a2c1812a63025fe3c279ac36ee5d608f43068228f561891eeee247805bf9  install.js
7e0f22fdfd4a95c57cf40470c545e43073f85d4a8f374821d439e683f853998c  uninstall.js
```

### 4. Run the installer

```bash
node install.js
```

The installer will prompt for:
1. **API base URL** — your ChaosMonkey backend URL (e.g. `http://localhost:8010` for Local)
2. **Connect code** — the per-developer code from your admin

The installer:
- Exchanges the connect code for a bearer token
- Generates a pseudonymous `installation_id`
- Merges hook commands into `~/.claude/settings.json` (preserving existing hooks)
- Sends a `test_init` event and validates the response
- On failure, restores the previous settings and config

### 5. Verify installation

Check that hooks are registered:

```bash
cat ~/.claude/settings.json | grep chaosmonkey
```

You should see hook entries for `session-start`, `session-end`, `post-edit`, and `post-bash`.

Start a Claude Code session — the bridge will send telemetry automatically.
Check the ChaosMonkey dashboard (Productivity by Tool) for Claude Code data.

### 6. Uninstall (if needed)

From the extracted `package/` directory:

```bash
node uninstall.js
```

This removes only ChaosMonkey hook commands from `~/.claude/settings.json`
and deletes `~/.chaosmonkey-cc-bridge/` (config, state, log).

---

## Source Development Instructions

If you have the ChaosMonkey source repository and want to develop or
repackage the bridge:

### Install from source

```bash
cd extensions/claude-code-bridge
node install.js
```

### Package for distribution

```bash
cd extensions/claude-code-bridge
npm pack
```

This produces `chaosmonkey-cc-bridge-0.4.1-cc-bridge.tgz`.

### Verify source file SHA-256

```bash
shasum -a 256 bridge.js install.js uninstall.js
```

Compare the output against the published SHA-256 values above.

### Uninstall from source

```bash
cd extensions/claude-code-bridge
node uninstall.js
```

---

## Privacy

See the header comment in `bridge.js` for the full privacy/security contract.
Raw file paths, edit text, and command output are never transmitted.
Only aggregate telemetry (counts, durations, language IDs) is sent.
Git remote URLs are sanitized (credentials stripped) before transmission.
Transport is HTTPS (HTTP only for localhost development).
