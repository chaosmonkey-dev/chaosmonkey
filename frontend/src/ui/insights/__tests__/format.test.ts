import { formatTeamPrefix } from '@/ui/insights/format';

describe('formatTeamPrefix', () => {
  test('should return empty string for null/undefined', () => {
    expect(formatTeamPrefix(null)).toBe('');
    expect(formatTeamPrefix(undefined)).toBe('');
  });

  test('should return empty string for "unknown"', () => {
    expect(formatTeamPrefix('unknown')).toBe('');
    expect(formatTeamPrefix('Unknown')).toBe('');
    expect(formatTeamPrefix('UNKNOWN')).toBe('');
  });

  test('should return empty string for "all"', () => {
    expect(formatTeamPrefix('all')).toBe('');
    expect(formatTeamPrefix('All')).toBe('');
    expect(formatTeamPrefix('ALL')).toBe('');
  });

  test('should return empty string for empty/whitespace', () => {
    expect(formatTeamPrefix('')).toBe('');
    expect(formatTeamPrefix('   ')).toBe('');
  });

  test('should return formatted prefix for valid team names', () => {
    expect(formatTeamPrefix('Frontend')).toBe('Team Frontend: ');
    expect(formatTeamPrefix('backend')).toBe('Team backend: ');
    expect(formatTeamPrefix('Data Science')).toBe('Team Data Science: ');
  });

  test('should trim whitespace', () => {
    expect(formatTeamPrefix('  Frontend  ')).toBe('Team Frontend: ');
  });
});
