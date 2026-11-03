// src/ui/insights/format.ts
export function formatTeamPrefix(entityId?: string | null): string {
  const raw = (entityId ?? '').toString().trim();
  const lc = raw.toLowerCase();
  if (!raw || lc === 'unknown' || lc === 'all') return '';
  // Don't add "Team" prefix for IDE/tool names (cursor, vscode, windsurf, jetbrains, sublime, vim, etc.)
  const toolNames = ['cursor', 'vscode', 'windsurf', 'jetbrains', 'sublime', 'vim', 'ide'];
  if (toolNames.includes(lc)) return '';
  return `Team ${raw}: `;
}
