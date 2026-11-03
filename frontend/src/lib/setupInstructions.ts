/**
 * CR-X P1-1: Setup instructions text generation for enrolled developers.
 *
 * Extracted from ManageTeams.vue so the actual generation path is testable
 * without component mounting. The function derives all URLs from the
 * runtime API base — no hardcoded customer hostnames.
 *
 * URL contract:
 * - apiBaseUrl (input) = `${BASE_URL}/api` (includes /api prefix)
 * - Download URLs use apiBaseUrl directly (routes are under /api/...)
 * - Pilot API base URL shown to developer is the ROOT URL (without /api)
 *   because both the IDE extension and Claude Code bridge installer append
 *   /api/... themselves (e.g., /api/ide/connect/exchange)
 */

/**
 * Immutable Cursor Agent bridge release manifest.
 * The tarball is a source-controlled artifact at
 * backend/resources/extensions/ — SHA-256 is the release authority.
 */
export const CURSOR_AGENT_BRIDGE = {
  version: '0.4.2-cursor-bridge',
  filename: 'chaosmonkey-cursor-agent-bridge-0.4.2-cursor-bridge.tgz',
  sha256: '972acbc5c02efccac995484c80534e34f28de837a1e65a72520286353d2bbe21',
} as const

/**
 * Cursor Agent bridge capability probe — default-disabled, fail-closed.
 *
 * The card/instructions section is enabled only when THIS pilot's backend
 * actually serves the immutable artifact: the canonical route exists and
 * the controller streams the source-controlled tarball (it aborts 500
 * when the artifact is absent). A HEAD request is a live capability
 * advertisement — no frontend version inference, no resource-file
 * assumptions. Cached per API base for the page session.
 */
/**
 * The backend-verified capability manifest, or null when this pilot does
 * not advertise the Cursor Agent bridge. The payload is produced by the
 * same server-side check that guards the invite setup response and the
 * download route — HTTP 200 alone is never treated as proof.
 */
export interface CursorAgentBridgeManifest {
  version: string
  filename: string
  sha256: string
}

const cursorBridgeProbeCache = new Map<string, Promise<CursorAgentBridgeManifest | null>>()
export function probeCursorAgentBridge(apiBaseUrl: string): Promise<CursorAgentBridgeManifest | null> {
  // apiBaseUrl follows the same contract as buildSetupInstructions:
  // it includes the /api prefix (e.g. https://pilot.example/api).
  const key = apiBaseUrl.replace(/\/$/, '')
  let probe = cursorBridgeProbeCache.get(key)
  if (!probe) {
    probe = fetch(`${key}/cursor-agent-bridge/capability`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body?.available !== true) return null
        if (typeof body.filename !== 'string' || typeof body.sha256 !== 'string') return null
        return { version: String(body.version ?? ''), filename: body.filename, sha256: body.sha256 }
      })
      .catch(() => null)
    cursorBridgeProbeCache.set(key, probe)
  }
  return probe
}

export function buildSetupInstructions(
  apiBaseUrl: string,
  connectCode: string,
  options?: { cursorAgentBridge?: boolean },
): string {
  const downloadUrl = `${apiBaseUrl}/extension/download/latest`
  const bridgeUrl = `${apiBaseUrl}/bridge/download/latest`
  const codexUrl = `${apiBaseUrl}/codex-bridge/download/latest`
  const cursorAgentUrl = `${apiBaseUrl}/cursor-agent-bridge/download/latest`
  // IDE extension and both bridges expect ROOT URL (without /api)
  const pilotApiBaseUrl = apiBaseUrl.replace(/\/api$/, '')

  const cursorAgentSection = options?.cursorAgentBridge
    ? `

Cursor Agents companion (Cursor's standalone Agents Window)
The IDE extension captures supported Cursor editor activity. If you also
use Cursor's separate Agents Window, install this companion to capture
that activity. It is separate from the Cursor IDE extension — install it
alongside the extension, not instead of it.
1. Download the Cursor Agents companion:
   ${cursorAgentUrl}
2. Verify the download SHA-256:
   ${CURSOR_AGENT_BRIDGE.sha256}
3. Extract the archive, then from the extraction directory run:
   CM_API_BASE_URL="${pilotApiBaseUrl}" CM_CONNECT_CODE="${connectCode}" node package/install.js
4. The installer sends a connectivity test event. Genuine Cursor agent
   activity is still required before agent coverage is verified.`
    : ''

  return `ChaosMonkey 0.4.1 setup

Your personal enrollment code: ${connectCode}
API base URL: ${pilotApiBaseUrl}

Install the client for each tool you actually use.
Your enrollment code is personal to you — do not share it with other
developers. The same enrollment code works for every supported client you
install, and each client gets its own secure installation connection.

IDE extension — VS Code, Cursor, or Devin Desktop
1. Download the ChaosMonkey 0.4.1 VSIX:
   ${downloadUrl}
2. Install it in your editor (Extensions -> Install from VSIX...).
3. Open the Command Palette and run: ChaosMonkey: Connect
4. Enter the API base URL above when prompted.
5. Enter your enrollment code above when prompted.${cursorAgentSection}

Claude Code
1. Download the Claude Code bridge:
   ${bridgeUrl}
2. Extract the archive.
3. Run: node install.js
4. Enter the API base URL above when prompted.
5. Enter the SAME enrollment code above when prompted.
6. Start Claude Code normally.

Codex CLI
1. Download the Codex bridge:
   ${codexUrl}
2. Extract the archive.
3. Run: node install.js
4. Enter the API base URL above when prompted.
5. Enter the SAME enrollment code above when prompted.
6. Start Codex, open /hooks, review the ChaosMonkey hook, and trust it.`
}
