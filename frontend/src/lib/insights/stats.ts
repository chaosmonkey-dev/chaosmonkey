// Statistical helpers for performance insights

// Basic statistical functions
export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

export function pearson(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;
  
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  return denominator === 0 ? 0 : numerator / denominator;
}

export function zscore(value: number, arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((sum, val) => sum + val, 0) / arr.length;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  const stdDev = Math.sqrt(variance);
  return stdDev === 0 ? 0 : (value - mean) / stdDev;
}

export function lag(arr: number[], periods: number = 1): number[] {
  if (periods <= 0) return [...arr];
  return [...Array(periods).fill(undefined), ...arr.slice(0, -periods)];
}

export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function standardDeviation(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - m, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

// two-tailed p-value for Pearson r with n points
export function pValueFromR(r: number, n: number): number {
  try {
    if (!isFinite(r) || n < 3) return 1;
    const t = Math.abs(r) * Math.sqrt((n - 2) / (1 - r * r));
    // Approx via survival of Student's t (df = n-2), use simple tail ~ 1/(1+t^2) exponent
    // NOTE: fast, not perfect; good enough for gating. Safer clamp:
    const df = n - 2;
    const approx = 2 * Math.min(1, Math.exp(-0.5 * t * t)); // crude but monotone
    return Math.max(0, Math.min(1, approx));
  } catch { return 1; }
}