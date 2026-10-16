import { describe, expect, it } from 'vitest';
import { carryView } from '../src/ui/CarryMeter';

describe('carry meter (0.9.3)', () => {
  it('shows carried out of capacity', () => {
    const v = carryView(3, 8);
    expect(v.text).toBe('3 / 8');
    expect(v.fill).toBeCloseTo(3 / 8);
    expect(v.full).toBe(false);
    expect(v.label).toBe('Carrying 3 of 8');
  });

  it('is full at capacity', () => {
    const v = carryView(8, 8);
    expect(v.full).toBe(true);
    expect(v.fill).toBe(1);
    expect(v.label).toContain('full');
  });

  it('keeps the bar in range when a capacity drop leaves the arms over it', () => {
    const v = carryView(10, 8);
    expect(v.text).toBe('10 / 8');
    expect(v.fill).toBe(1);
    expect(v.full).toBe(true);
  });

  it('copes with empty arms and a zero capacity', () => {
    expect(carryView(0, 8)).toMatchObject({ text: '0 / 8', fill: 0, full: false });
    expect(carryView(0, 0)).toMatchObject({ text: '0 / 0', fill: 0, full: false });
  });
});
