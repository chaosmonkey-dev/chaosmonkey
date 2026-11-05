# Release manifest — v0.1.1 (Community Preview)

The server distributes its own client artifacts, so the files below are the
authoritative bytes for this release. All checksums are SHA-256 of the files
in `backend/resources/extensions/`, which are the same bytes served by the
`/api/*/download/latest` routes.

## Server

| Item | Value |
|---|---|
| Release tag | `v0.1.1` (Community Preview) |
| Container image | `ghcr.io/chaosmonkey-dev/chaosmonkey:0.1.1` |
| Also tagged | `ghcr.io/chaosmonkey-dev/chaosmonkey:0.1` |
| Platforms | `linux/amd64`, `linux/arm64` |
| Database | SQLite at `/data` (persistent volume required) |
| Provenance | SLSA provenance + SBOM attached by the release workflow |

## Client artifacts

| Integration | Package | Version | SHA-256 | Served at | Validation level |
|---|---|---|---|---|---|
| VS Code / Cursor IDE | `chaosmonkey-telemetry-0.4.1.vsix` (54,685 B) | 0.4.1 | `7f434439a6cfb5b0da39e10a49c7f9724c225b25d27857146076ee5a5e4c7626` | `GET /api/extension/download/latest` | Package + authenticated ingest verified; GUI session historically production-observed |
| Claude Code bridge | `chaosmonkey-cc-bridge-0.4.2-cc-bridge.tgz` (18,033 B) | 0.4.2 | `700122fbf079834591c2eb789d869238c7bf4e82872df4453e03ab312201c6ab` | `GET /api/bridge/download/latest` | End-to-end: install → hooks → session lifecycle → ingest |
| Cursor Agents bridge | `chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz` (22,325 B) | 0.4.2 | `972acbc5c02efccac995484c80534e34f28de837a1e65a72520286353d2bbe21` | `GET /api/cursor-agent-bridge/download/latest` | End-to-end: install → hooks → session lifecycle → ingest |
| Codex bridge | `chaosmonkey-codex-bridge-0.4.1-codex-bridge.tgz` (8,997 B) | 0.4.1 | `43cfda1b6767db0d18ce44cf79497e57c0f4d54eecd997852d6cc1f954274b16` | `GET /api/codex-bridge/download/latest` | End-to-end: install → hooks.json → hook invocations → ingest; requires manual hook-trust in Codex |

Capability discovery for the Cursor Agents bridge:
`GET /api/cursor-agent-bridge/capability` — advertises availability only when
the sha-pinned artifact above is present.

## Repackaging

Tarballs are gzip-compressed and are **not** byte-reproducible. Repackaging
produces a different digest even when contents are identical. After any
repackage, update the SHA-256 pins here and in the frozen-hash tests:

```bash
cd extensions/<bridge-dir> && npm pack --pack-destination ../../backend/resources/extensions
sha256sum backend/resources/extensions/<new-file>.tgz   # update manifest + tests
```

Test suites pinning these digests:
`backend/tests/Feature/CcBridgeDownloadTest.php`,
`backend/tests/Feature/CodexBridgeDownloadTest.php`,
`backend/tests/Feature/HermeticDualInstallRolloutTest.php`,
`extensions/claude-code-bridge/test/hermetic-bridge-install.test.js`.
