function safeJson(value: any): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

import { formatPIValue, inferMetricUnit } from './piValueFormatter'

export function presentOneLine(value: any, title: string = '', id: string = ''): string {
  if (value == null) return '—';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    const unit = inferMetricUnit(title, id)
    return formatPIValue(value, unit)
  }
  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    const n = value.length;
    if (n === 0) return '[]';
    const first = value[0];
    if (first && typeof first === 'object') {
      // Common case: arrays of objects with tool/period keys
      const toolish = (first as any).tool ?? (first as any).period ?? (first as any).key;
      return `Array(${n})${toolish != null ? ` e.g. ${String(toolish)}` : ''}`;
    }
    return `Array(${n})`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    return `Object(${keys.length}) keys: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''}`;
  }

  return String(value);
}

export function presentDetails(value: any): string {
  if (value == null) return '';
  return safeJson(value);
}
