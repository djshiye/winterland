/**
 * 0.9.7 era resources v2: a 0.9.6 save (pig iron, data shards, era 5 coal, era 10 power cells and Fusion Plants) loads
 * with nothing lost. Goods change kind one for one, levels and pad payments follow, built Fusion Plants become Helium
 * Skimmers except the last of two or more, which stays as the Fusion Reactor (a full plot keeps its whole chain), and
 * the conversion runs once.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeState, migrateState, parseSave, sanitizeState, type MigrationReport, type SaveData } from '../src/core/Save';
import { createGameState, type GameState } from '../src/core/types';

const fixture = (name: string): SaveData => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));

/** The era 10 fixture dressed as a 0.9.6 save: the stand-in kinds everywhere a player can hold them. */
function save096(): SaveData {
  const s = fixture('save-v9-0.9.4-era10-mastery.json');
  const st = s.state as unknown as Record<string, Record<string, unknown>>;
  Object.assign(st.upgrades!, { pigIronQuality: 7, dataShardQuality: 4, fusionPlant: 6 });
  st.padPaid = { 'pad:fusionPlant': 500, 'pad:pigIronQuality': 200 };
  st.flags = { ...st.flags, 'reveal:levelPad:fusionPlant': true };
  st.market = { ...st.market, holdings: { pigIron: 10, dataShard: 4 }, basis: { pigIron: 100, dataShard: 5000 }, index: { pigIron: 1.2 } };
  st.contract = { kind: 'dataShard', target: 20, progress: 5, left: 100, bonus: 1000 };
  const w = s.world as unknown as { arms: Record<string, number>; eras: { slots: { in: Record<string, number>; out: number }[]; dock: Record<string, number>; market?: unknown }[] };
  w.arms = { ...w.arms, pigIron: 3, dataShard: 2 };
  w.eras[5]!.slots[2]!.in = { pigIron: 2, coal: 3 };
  w.eras[5]!.dock = { pigIron: 6 };
  w.eras[4]!.dock = { coal: 5 };
  w.eras[10]!.slots[2]!.in = { dataShard: 1, power: 2 };
  w.eras[10]!.dock = { dataShard: 5, power: 4 };
  w.eras[10]!.market = { dock: { dataShard: 3 }, stall: { power: 1, aiCore: 2 }, cash: 0 };
  return s;
}

function load(s: SaveData): { state: GameState; data: SaveData; report: MigrationReport } {
  const r = parseSave(JSON.stringify(s));
  if (r.kind !== 'ok') throw new Error('fixture did not parse');
  const state = createGameState();
  mergeState(state, r.data.state);
  sanitizeState(state);
  const report = migrateState(state, false, { salesRate: r.data.salesRate, upgrades: r.data.state.upgrades, saved: r.data.state, world: r.data.world });
  return { state, data: r.data, report };
}

describe('0.9.7 migration: era resources v2 (nothing a player owns is lost)', () => {
  it('converts every pig iron, data shard, era-5 coal and era-10 power cell one for one', () => {
    const { data } = load(save096());
    const w = data.world;
    expect(w.arms.pellets).toBe(3);
    expect(w.arms.rareEarth).toBe(2);
    expect(w.eras[5]!.slots[2]!.in).toEqual({ pellets: 2, coke: 3 });
    expect(w.eras[5]!.dock).toEqual({ pellets: 6 });
    expect(w.eras[4]!.dock).toEqual({ coal: 5 }); // era 4's coal stays coal
    expect(w.eras[10]!.slots[2]!.in).toEqual({ rareEarth: 1, fusionCell: 2 });
    expect(w.eras[10]!.market!.dock).toEqual({ rareEarth: 3 });
    expect(w.eras[10]!.market!.stall).toEqual({ fusionCell: 1, aiCore: 2 });
    // the converted Fusion Plant's power cells (slot 0's out pile) go to the dock as fusion cells; slot 4 stays the
    // Reactor, so its out pile is fusion cells already
    expect(w.eras[10]!.dock).toEqual({ rareEarth: 5, fusionCell: 4 + 12 });
    expect(w.eras[10]!.slots[0]).toEqual({ in: {}, out: 0 });
    expect(w.eras[10]!.slots[4]!.out).toBe(12);
    for (const r of w.eras) for (const s of r.slots) for (const k of Object.keys(s.in)) expect(['pigIron', 'dataShard']).not.toContain(k);
  });

  it('two Fusion Plants on a full plot: the first becomes a Helium Skimmer, the last stays as the Fusion Reactor', () => {
    const saved = save096();
    const had = (saved.state as unknown as { eras: { regions: { slots: unknown[] }[] } }).eras.regions[10]!.slots.length;
    const { state, report } = load(saved);
    const slots = state.eras.regions[10]!.slots.map((s) => s.machine);
    // the fixture's era 10 plot is full (0.9.7 adds a ninth slot, which a 0.9.6 save loads empty)
    expect(slots.slice(0, had).every((m) => m !== '')).toBe(true);
    expect(slots.slice(had).every((m) => m === '')).toBe(true);
    expect(slots[0]).toBe('heliumSkimmer');
    expect(slots[4]).toBe('fusionPlant');
    expect(slots.filter((m) => m === 'fusionPlant')).toHaveLength(1);
    // both keep the old plant's level and pad payment
    expect(state.upgrades.heliumSkimmer).toBe(6);
    expect(state.upgrades.fusionPlant).toBe(6);
    expect(state.padPaid['pad:heliumSkimmer']).toBe(500);
    expect(state.padPaid['pad:fusionPlant']).toBe(500);
    expect(state.flags['reveal:levelPad:heliumSkimmer' as keyof typeof state.flags]).toBe(true);
    expect(report.reactor).toBe('kept');
  });

  it('a lone Fusion Plant becomes a Helium Skimmer and the card asks for a Fusion Reactor', () => {
    const s = save096();
    const slots = (s.state as unknown as { eras: { regions: { slots: Record<string, unknown>[] }[] } }).eras.regions[10]!.slots;
    slots[4] = { machine: '', tier: -1, cash: 0, extra: 0 };
    s.world.eras[10]!.slots[4] = { in: {}, out: 0 };
    const { state, report } = load(s);
    const built = state.eras.regions[10]!.slots.map((x) => x.machine);
    expect(built[0]).toBe('heliumSkimmer');
    expect(built).not.toContain('fusionPlant');
    expect(state.upgrades.heliumSkimmer).toBe(6);
    expect(state.upgrades.fusionPlant).toBe(6); // the Reactor, once built, starts at the old plant's level
    expect(report.reactor).toBe('build');
  });

  it('keeps Fine levels, pad payments, trading holdings, price records and an open contract', () => {
    const { state, report } = load(save096());
    expect(state.upgrades.pelletsQuality).toBeGreaterThanOrEqual(7);
    expect(state.upgrades.rareEarthQuality).toBeGreaterThanOrEqual(4);
    expect(state.padPaid['pad:pelletsQuality']).toBe(200);
    expect(state.market.holdings).toMatchObject({ pellets: 10, rareEarth: 4 });
    expect(state.market.basis).toMatchObject({ pellets: 100, rareEarth: 5000 });
    expect(state.market.index.pellets).toBe(1.2);
    expect(state.contract).toEqual({ kind: 'rareEarth', target: 20, progress: 5, left: 100, bonus: 1000 });
    expect(report.applied).toContain('0.9.7-era-resources');
    expect(report.resourcesAge).toBe(10);
  });

  it('runs once: the converted save loads again unchanged', () => {
    const first = load(save096());
    const again: SaveData = { ...first.data, state: JSON.parse(JSON.stringify(first.state)) };
    const second = load(again);
    expect(second.report.applied).toEqual([]);
    expect(second.state).toEqual(first.state);
    expect(second.data.world).toEqual(first.data.world);
  });

  it('a save before era 5 changes nothing and shows no card', () => {
    const { report } = load(fixture('save-v9-0.9.1-era3.json'));
    expect(report.applied).toContain('0.9.7-era-resources');
    expect(report.resourcesAge).toBe(0);
  });
});
