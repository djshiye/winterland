/** 0.9.2: the delivery docks (one per place goods wait for customers): bigger counters and more, faster customers. */
import { describe, expect, it } from 'vitest';
import { LAYOUT, UPGRADES } from '../src/config';
import { introEra, valueAt } from '../src/core/ladder';
import { dockRoom } from '../src/level/Level';

const DOCKS = [
  { id: 'shopDock', unlock: { villageLevel: 1 }, counter: LAYOUT.walkInCounter, base: 36 },
  { id: 'trikeDock', unlock: { unlocked: 'processor' }, counter: LAYOUT.seCounter, base: 12 },
  { id: 'truckDock', unlock: { unlocked: 'megaSaw' }, counter: LAYOUT.expansion.truckCounter, base: 24 },
  { id: 'sledDock', unlock: { unlocked: 'workshop' }, counter: LAYOUT.ridge.sledCounter, base: 18 },
  { id: 'railDock', unlock: { unlocked: 'treeFeller' }, counter: LAYOUT.ridge.platform, base: 30 },
] as const;

describe('delivery docks', () => {
  it.each(DOCKS)('$id: an era-1 shop upgrade (Sales tab) unlocked with its dock, ×1 at level 0', (k) => {
    const d = UPGRADES[k.id];
    expect(d).toMatchObject({ group: 'sales', display: 'boost', requires: k.unlock });
    expect(introEra(d)).toBe(1);
    expect(valueAt(d, 0)).toBe(1);
  });

  it.each(DOCKS)('$id: grows its counter from the old room up to double, never past the grid', (k) => {
    const c = k.counter;
    expect(c.baseRoom).toBe(k.base);
    expect(dockRoom(c.baseRoom, 1)).toBe(k.base);
    expect(dockRoom(c.baseRoom, 1.4)).toBe(Math.round(k.base * 1.4));
    expect(dockRoom(c.baseRoom, 6)).toBe(2 * k.base);
    expect(c.grid.cols * c.grid.rows * c.grid.layers).toBeGreaterThanOrEqual(2 * k.base);
  });
});
