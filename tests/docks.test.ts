/** 0.9.2: the delivery docks (Tricycle Dock, Truck Dock): bigger counters and more, faster customers. */
import { describe, expect, it } from 'vitest';
import { LAYOUT, UPGRADES } from '../src/config';
import { valueAt } from '../src/core/ladder';
import { dockRoom } from '../src/level/Level';

describe('delivery docks', () => {
  it('are shop upgrades (Sales tab), unlocked with the processor and the mega saw', () => {
    expect(UPGRADES.trikeDock).toMatchObject({ group: 'sales', requires: { unlocked: 'processor' } });
    expect(UPGRADES.truckDock).toMatchObject({ group: 'sales', requires: { unlocked: 'megaSaw' } });
    for (const d of [UPGRADES.trikeDock, UPGRADES.truckDock]) expect(valueAt(d, 0)).toBe(1);
  });

  it('grow the counter from its base room up to double, never past the grid', () => {
    const se = LAYOUT.seCounter;
    const tc = LAYOUT.expansion.truckCounter;
    expect(dockRoom(se.baseRoom, 1)).toBe(12);
    expect(dockRoom(se.baseRoom, 1.4)).toBe(17);
    expect(dockRoom(se.baseRoom, 6)).toBe(24);
    expect(dockRoom(tc.baseRoom, 6)).toBe(48);
    expect(se.grid.cols * se.grid.rows * se.grid.layers).toBeGreaterThanOrEqual(24);
    expect(tc.grid.cols * tc.grid.rows * tc.grid.layers).toBeGreaterThanOrEqual(48);
  });
});
