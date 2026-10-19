/**
 * 0.9.12 bigger towns (Dino: "the town areas should be much larger, with more areas to build on … In area 2 there's
 * one square field where you can't build anything"): every region builds on every paved machine cell, every district
 * has twice the 0.9.11 lots on a bigger plot, an older save grows into both without losing anything, and the
 * settlement levels still ask for the 0.9.11 populations.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, DISTRICT_LOTS, REGION_SLOTS } from '../src/core/types';
import { mergeState, migrateState, MIGRATIONS } from '../src/core/Save';
import { SETTLEMENT_BASIS, settlementAnchors, settlementThresholds } from '../src/core/demand';
import { CITY_EAST, DISTRICTS, MAX_ERA, REGIONS, ROADS } from '../src/eras/data';
import { regionLayout } from '../src/eras/layout';
import { districtGrid, districtLots, maxFootprint, rectsOverlap } from '../src/city/rules';

const ERA_NS = Array.from({ length: MAX_ERA - 1 }, (_, i) => i + 2);

describe('bigger towns (0.9.12)', () => {
  it('every region builds on every cell its plot paves (no empty square)', () => {
    for (const n of ERA_NS) {
      expect(REGIONS[n]!.slots, `era ${n}`).toBe(REGIONS[n]!.room);
      expect(REGION_SLOTS[n], `era ${n}`).toBe(REGIONS[n]!.room);
      expect(regionLayout(n).slots).toHaveLength(REGIONS[n]!.room);
    }
  });

  it('every district has 1.5-2× its 0.9.11 lots on a full grid, and every lot keeps a full-size footprint', () => {
    for (const n of ERA_NS) {
      expect(DISTRICTS[n]!.lots, `era ${n}`).toBeGreaterThanOrEqual(1.5 * SETTLEMENT_BASIS.lots[n]!);
      // a full grid: no paved cell is left without a lot (the empty-square bug, in the city)
      const { cols, rows } = districtGrid(DISTRICTS[n]!.lots);
      expect(cols * rows, `era ${n}`).toBe(DISTRICTS[n]!.lots);
      expect(DISTRICT_LOTS[n]).toBe(DISTRICTS[n]!.lots);
      const lots = districtLots(n);
      const max = maxFootprint(n);
      for (const f of lots) {
        // no squeezed lots: at least 85 % of the era's widest footprint across, and room to stand in front
        expect(f.w, `era ${n} lot ${f.index}`).toBeGreaterThanOrEqual(0.85 * max.w);
        expect(f.d, `era ${n} lot ${f.index}`).toBeGreaterThanOrEqual(Math.min(max.d, 5));
      }
      for (const a of lots) for (const b of lots) if (a !== b) expect(rectsOverlap(a.cell, b.cell)).toBe(false);
    }
  });

  it('the city grid streets run between the districts, never through one', () => {
    const streets = ROADS.filter((r) => r.id.startsWith('city'));
    for (const s of streets) for (const n of ERA_NS) expect(rectsOverlap(s.rect, DISTRICTS[n]!.rect), `${s.id} vs district ${n}`).toBe(false);
    for (const n of ERA_NS) {
      expect(DISTRICTS[n]!.rect.maxX).toBeLessThanOrEqual(CITY_EAST);
      // clear of R2 and of every region
      expect(DISTRICTS[n]!.rect.maxZ).toBeLessThan(128);
      for (const k of ERA_NS) expect(rectsOverlap(DISTRICTS[n]!.rect, REGIONS[k]!.rect), `district ${n} vs region ${k}`).toBe(false);
    }
  });

  it('settlement levels keep the 0.9.11 basis', () => {
    // anchors from the 0.9.11 counts, whatever the live slot / lot counts are
    expect(settlementAnchors()).toEqual(settlementAnchors((n) => SETTLEMENT_BASIS.slots[n]!, (n) => SETTLEMENT_BASIS.lots[n]!));
    expect(settlementThresholds()[10]).toBeGreaterThan(0);
  });

  it('a 0.9.11 save (7-9 slots, 6-12 lots) loads into the bigger plots with every machine and building kept', () => {
    const old = createGameState();
    old.eras.age = 3;
    old.eras.regions.forEach((r, n) => (r.slots.length = SETTLEMENT_BASIS.slots[n] ?? 0));
    old.city.districts.forEach((d, n) => (d.lots.length = SETTLEMENT_BASIS.lots[n] ?? 0));
    old.eras.regions[2]!.slots[6] = { machine: 'quarry', tier: 0, cash: 0, extra: 0 };
    old.city.districts[2]!.lots[5] = { building: 'frontierHome', tier: 0, cash: 0, extra: 0 };
    const saved = JSON.parse(JSON.stringify(old));
    const state = createGameState();
    mergeState(state, saved);
    migrateState(state, false, { salesRate: 0 }, MIGRATIONS.filter((m) => m.id === '0.9.12-bigger-towns'));
    for (const n of ERA_NS) {
      expect(state.eras.regions[n]!.slots).toHaveLength(REGION_SLOTS[n]!);
      expect(state.city.districts[n]!.lots).toHaveLength(DISTRICT_LOTS[n]!);
    }
    expect(state.eras.regions[2]!.slots[6]).toMatchObject({ machine: 'quarry', tier: 0 });
    expect(state.eras.regions[2]!.slots[7]).toMatchObject({ machine: '', tier: -1 });
    expect(state.city.districts[2]!.lots[5]).toMatchObject({ building: 'frontierHome', tier: 0 });
    expect(state.city.districts[2]!.lots[11]).toMatchObject({ building: '', tier: -1 });
    expect(state.migrations['0.9.12-bigger-towns']).toBe(true);
  });
});
