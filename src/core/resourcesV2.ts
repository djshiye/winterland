/**
 * [PURE] 0.9.7 era resources v2 (audit-1.0/era-resources-v2.md, approved by Dino 2026-10-16): era 5 runs on iron
 * pellets + coke, era 10 on rare earth + helium-3 with fusion. An older save keeps everything it owns (core/Save.ts
 * migration '0.9.7-era-resources'):
 * - the 0.9.6 stand-ins become the new raws one for one: pig iron → iron pellets, data shards → rare earth (in machine
 *   hoppers, on the import docks, on the market dock and stall, in the player's arms, in trading holdings, in the
 *   market's price records, in an open contract, and their Fine sales upgrade levels and pad payments);
 * - what era 5's coke ovens made (coal) becomes coke, and what era 10's fusion plants made (power cells) becomes
 *   fusion cells, wherever it lies in that era's region (older eras' coal and power are untouched);
 * - the Fusion Plant was era 10's power extractor; it is the Fusion Reactor (a processor) now and the new Helium
 *   Skimmer took over the extractor's job, so every built Fusion Plant becomes a Helium Skimmer with the plant's level
 *   and pad payment, and the cells on its out pile go to the import dock as fusion cells.
 * Region.restore hands any input a machine no longer uses to its import dock, so nothing in a hopper is lost.
 */
import type { MaterialKind } from './kinds';
import type { GameState, ItemKind } from './types';

/** Old kind → new kind, everywhere. */
export const LEGACY_KINDS: Readonly<Record<string, MaterialKind>> = { pigIron: 'pellets', dataShard: 'rareEarth' };

/** Era → (old kind → new kind) for goods lying in that era's region only. */
const REGION_KINDS: Readonly<Record<number, Readonly<Record<string, MaterialKind>>>> = {
  5: { ...LEGACY_KINDS, coal: 'coke' },
  10: { ...LEGACY_KINDS, power: 'fusionCell' },
};

/** Machine ids whose job moved to another id (built slots, levels and pad payments follow). */
const MOVED_MACHINES: Readonly<Record<string, string>> = { fusionPlant: 'heliumSkimmer' };

/** The world snapshot parts this conversion touches (core/Save.ts WorldSnapshot). */
export interface ResourcesWorld {
  arms?: Partial<Record<string, number>>;
  eras: { slots: { in: Partial<Record<ItemKind, number>>; out: number }[]; dock: Partial<Record<ItemKind, number>>; market?: { dock: Partial<Record<ItemKind, number>>; stall: Partial<Record<ItemKind, number>> } }[];
}

export interface ResourcesResult {
  /** Units of goods that changed kind (0 for a save that had none). */
  converted: number;
  /** Built machines that changed id (Fusion Plant → Helium Skimmer). */
  machines: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Move every `map` key of `rec` onto its new kind (added to what is already there). Returns the units moved. */
function renameIn(rec: Partial<Record<string, number>> | undefined, map: Readonly<Record<string, string>>): number {
  if (!rec) return 0;
  let n = 0;
  for (const [from, to] of Object.entries(map)) {
    const v = rec[from];
    if (v === undefined) continue;
    delete rec[from];
    if (!isNum(v) || v <= 0) continue;
    rec[to] = (rec[to] ?? 0) + v;
    n += v;
  }
  return n;
}

/**
 * Convert a merged, sanitized state (and its world snapshot, if any) in place. `saved` is the raw saved state: the
 * sanitizer already dropped the old kinds' upgrade levels, market records and contract, so they are read from there.
 */
export function convertEraResources(state: GameState, saved: unknown, world?: ResourcesWorld): ResourcesResult {
  const out: ResourcesResult = { converted: 0, machines: 0 };
  const raw = isObj(saved) ? saved : {};
  const ups = state.upgrades as unknown as Record<string, number>;
  const rawUps = isObj(raw.upgrades) ? raw.upgrades : {};

  // Fine sales upgrades of the old raws: the new raw keeps the higher level
  for (const [from, to] of Object.entries(LEGACY_KINDS)) {
    const v = rawUps[`${from}Quality`];
    if (isNum(v) && v > 0) ups[`${to}Quality`] = Math.max(ups[`${to}Quality`] ?? 0, Math.min(10, Math.floor(v)));
  }
  // moved machines: the new id takes the old one's level; the old id (a different machine now) starts over
  for (const [from, to] of Object.entries(MOVED_MACHINES)) {
    const v = ups[from] ?? 0;
    if (v > 0) {
      ups[to] = Math.max(ups[to] ?? 0, v);
      ups[from] = 0;
    }
  }
  // pad payments and reveal flags follow their upgrade / machine
  const ids: Record<string, string> = { ...MOVED_MACHINES };
  for (const [from, to] of Object.entries(LEGACY_KINDS)) ids[`${from}Quality`] = `${to}Quality`;
  for (const [from, to] of Object.entries(ids)) {
    const paid = state.padPaid[`pad:${from}`];
    if (paid === undefined) continue;
    state.padPaid[`pad:${to}`] = (state.padPaid[`pad:${to}`] ?? 0) + paid;
    delete state.padPaid[`pad:${from}`];
  }
  for (const k of Object.keys(state.flags)) {
    for (const [from, to] of Object.entries({ ...LEGACY_KINDS, ...MOVED_MACHINES })) {
      if (k.includes(from) && state.flags[k as keyof typeof state.flags]) (state.flags as Record<string, boolean>)[k.split(from).join(to)] = true;
    }
  }

  // market records of the old raws (trading holdings keep their average buy price)
  const m = state.market;
  const rm = isObj(raw.market) ? raw.market : {};
  const rec = (name: string): Record<string, unknown> => (isObj(rm[name]) ? (rm[name] as Record<string, unknown>) : {});
  for (const [from, to] of Object.entries(LEGACY_KINDS)) {
    const held = rec('holdings')[from];
    const basis = rec('basis')[from];
    if (isNum(held) && held > 0) {
      const h0 = m.holdings[to] ?? 0;
      const b0 = m.basis[to] ?? 0;
      const units = Math.floor(held);
      const price = isNum(basis) && basis > 0 ? basis : 0;
      m.holdings[to] = h0 + units;
      m.basis[to] = (h0 * b0 + units * price) / (h0 + units);
      out.converted += units;
    }
    const idx = rec('index')[from];
    if (isNum(idx) && m.index[to] === undefined) m.index[to] = idx;
    const pr = rec('pressure')[from];
    if (isNum(pr) && m.pressure[to] === undefined) m.pressure[to] = Math.max(0, pr);
  }

  // an open contract for an old raw carries on for the new one
  const rc = isObj(raw.contract) ? raw.contract : {};
  if (typeof rc.kind === 'string' && rc.kind in LEGACY_KINDS && state.contract.kind === '') {
    const target = isNum(rc.target) ? Math.max(1, Math.floor(rc.target)) : 0;
    if (target > 0) {
      state.contract.kind = LEGACY_KINDS[rc.kind]!;
      state.contract.target = target;
      state.contract.progress = isNum(rc.progress) ? Math.max(0, Math.min(target, Math.floor(rc.progress))) : 0;
      state.contract.left = isNum(rc.left) ? Math.max(0, rc.left) : 0;
      state.contract.bonus = isNum(rc.bonus) ? Math.max(0, Math.floor(rc.bonus)) : 0;
    }
  }

  // built machines that changed id: the slot keeps its place and paid progress
  for (let n = 0; n < state.eras.regions.length; n++) {
    const slots = state.eras.regions[n]!.slots;
    for (let i = 0; i < slots.length; i++) {
      const to = MOVED_MACHINES[slots[i]!.machine];
      if (!to) continue;
      (slots[i] as { machine: string }).machine = to;
      out.machines++;
      // what it had made (power cells) goes to the import dock, converted below with the rest of the region
      const ws = world?.eras[n]?.slots[i];
      if (ws && world) {
        if (ws.out > 0) world.eras[n]!.dock.power = (world.eras[n]!.dock.power ?? 0) + ws.out;
        ws.out = 0;
        ws.in = {};
      }
    }
  }

  if (world) {
    out.converted += renameIn(world.arms, LEGACY_KINDS);
    world.eras.forEach((r, n) => {
      const map = REGION_KINDS[n] ?? LEGACY_KINDS;
      for (const s of r.slots) out.converted += renameIn(s.in, map);
      out.converted += renameIn(r.dock, map);
      if (r.market) {
        out.converted += renameIn(r.market.dock, map);
        out.converted += renameIn(r.market.stall, map);
      }
    });
  }
  return out;
}
