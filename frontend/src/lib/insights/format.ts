// frontend/src/lib/insights/format.ts
export const fmtNumber = (n?: number, d = 0) =>
  typeof n === 'number' && isFinite(n) ? n.toFixed(d) : '—';

export const fmtPct = (n?: number, d = 0) =>
  typeof n === 'number' && isFinite(n)
    ? `${(n > 1 ? n : n * 100).toFixed(d)}%`
    : '—';

export const fmtHours = (h?: number, d = 1) =>
  typeof h === 'number' && isFinite(h) ? `${h.toFixed(d)}h` : '—';

export const fmtDelta = (n?: number, d = 0) => {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(d)}`;
};


