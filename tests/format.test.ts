import { describe, expect, it } from 'vitest';
import { formatCount, formatDuration, formatMoney } from '../src/ui/format';

describe('formatMoney', () => {
  it.each([
    [0, '$0'],
    [999, '$999'],
    [1000, '$1,000'],
    [1500, '$1,500'],
    [12_500, '$12,500'],
    [99_950, '$99,950'],
    [100_000, '$100,000'],
    [999_999, '$999,999'],
    [1_000_000, '$1M'],
    [1_250_000, '$1.25M'],
    [12_500_000, '$12.5M'],
    [99_950_000, '$100M'],
    [100_000_000, '$100M'],
    [250_000_000, '$250M'],
    [999_400_000, '$999M'],
    [999_500_000, '$1B'],
    [1_000_000_000, '$1B'],
    [1_200_000_000, '$1.2B'],
    [10_000_000_000, '$10B'],
    [250_000_000_000, '$250B'],
    [999_500_000_000, '$1T'],
    [1e12, '$1T'],
    [2.5e12, '$2.5T'],
    [NaN, '$0'],
    [Infinity, '$0'],
    [-Infinity, '$0'],
    [-1500, '-$1,500'],
    [-100_000_000, '-$100M'],
    [-0.2, '$0'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatMoney(value)).toBe(expected);
  });
});

describe('formatCount / formatDuration', () => {
  it('formats counts and durations', () => {
    expect(formatCount(12_345.4)).toBe('12,345');
    expect(formatDuration(30)).toBe('30 s');
    expect(formatDuration(80 * 60)).toBe('1 h 20 min');
  });
});
