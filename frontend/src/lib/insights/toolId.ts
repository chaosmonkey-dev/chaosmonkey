/**
 * Normalize a tool label/id coming from multiple pipelines into a canonical tool id.
 *
 * Canonical ids are lower-case and match what the rest of the insights pipeline expects:
 * - cursor | windsurf | vscode | claude_code | codex | github_copilot | jetbrains | sublime | vim | neovim | intellij | webstorm
 */
export function normalizeToolId(raw?: string | null): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null

  const key = s.toLowerCase()

  // Priority check for Devin (must come before VS Code since Devin runs on VS Code)
  // Check for uriScheme, appName, or path indicators
  if (key.includes('devin') || s.includes('Devin')) {
    return 'devin'
  }

  const mapping: Record<string, string> = {
    // Cursor
    'cursor': 'cursor',

    // Windsurf
    'windsurf': 'windsurf',

    // Devin (explicit mapping after priority check)
    'devin': 'devin',

    // VS Code (after Devin check since Devin runs on VS Code)
    'vscode': 'vscode',
    'vs code': 'vscode',
    'visual studio code': 'vscode',

    // Claude Code (from canonical telemetry)
    'claude_code': 'claude_code',
    'claude-code': 'claude_code',
    'claudecode': 'claude_code',

    // Codex (from canonical telemetry — codex bridge emits source='codex')
    'codex': 'codex',
    'codex-cli': 'codex',
    'codex_cli': 'codex',
    'openai-codex': 'codex',
    'openai codex': 'codex',

    // GitHub Copilot (from canonical telemetry)
    'github_copilot': 'github_copilot',
    'github-copilot': 'github_copilot',
    'githubcopilot': 'github_copilot',
    'copilot': 'github_copilot',

    // JetBrains family
    'jetbrains': 'jetbrains',
    'jetbrains ides': 'jetbrains',
    'intellij': 'intellij',
    'idea': 'intellij',
    'webstorm': 'webstorm',

    // Editors
    'sublime': 'sublime',
    'sublime text': 'sublime',
    'vim': 'vim',
    'vim/neovim': 'vim',
    'neovim': 'neovim',
  }

  if (mapping[key]) return mapping[key]

  // If input is already a plausible id, keep it (lower-cased)
  if (/^[a-z0-9_-]+$/.test(key)) return key

  return null
}

