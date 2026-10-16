/**
 * 0.9.0 era regions at runtime: expansion pads (cash + the previous era's refined material) that unlock eras, and one
 * Region (eras/Region.ts) per unlocked era: machine slots (choose → construction pad → Machine), the export depot and
 * import dock, the era shop mat, Jack's cart and the era crew. Built once by Level from state.
 *
 * Silence rules (documented contract for the world dressing, city and juice):
 * - The constructor builds every region with n ≤ state.eras.age instantly and emits NOTHING (a restored game is silent;
 *   the world builder / city read state at their own construction).
 * - unlock(n, instant) ALWAYS emits 'era:unlocked' {era, position: gate} once per newly opened era (also for a debug
 *   instant unlock, so the world dressing adds its walk area and the city opens its district). `instant` only drops this
 *   file's own juice (pop-in, ring, sound). Jumping to n opens every lower era that is still closed first.
 * - build(n, slot, id, instant) always emits 'machine:built' (a state event); it emits 'built' (the fanfare) only when
 *   not instant.
 * - 'expansion:offered' fires once when a pad appears LIVE (never for a pad already on offer at construction).
 *
 * Expansion pad of era n (2..10): ConstructionPad key `expansion:${n}`, logs 0, cash = unlock.cash, extra = unlock.extra,
 * at regionLayout(n).expansionPad. Shown while expansionOffered(state, n) (re-checked on 'village:changed' and once a
 * second) and the region is closed; its progress lives in state.eras.regions[n].cash / .extra. Paying it opens the era.
 * While expansionPreview(state, n) the same pad shows greyed and locked under the gate's progress (docs/EXPANSION.md
 * §C, eras/gate.ts gateNote): it takes nothing, and 'expansion:offered' fires only when it turns payable (the gate met,
 * picked up by the one-second poll).
 */
import * as THREE from 'three';
import type { WorldSnapshot } from '../core/Save';
import { REGION_SLOTS, type GameContext } from '../core/types';
import { ConstructionPad } from '../stations/ConstructionPad';
import { ERAS, MAX_ERA } from './data';
import { eraGate, gateNote } from './gate';
import { expansionOffered, expansionPreview, regionLayout } from './layout';
import { Region } from './Region';
import type { RegionRuntime } from './runtime';
import { settlePaidSlots } from './rules';

const POLL = 1;

export class EraWorld {
  /** Index = era number; null while closed (0 and 1 are unused). */
  private readonly regions: (Region | null)[] = Array.from({ length: MAX_ERA + 1 }, () => null);
  private readonly pads: (ConstructionPad | null)[] = Array.from({ length: MAX_ERA + 1 }, () => null);
  private pollTimer = 0;

  constructor(protected readonly ctx: GameContext) {
    const st = ctx.state.eras;
    for (let n = 2; n <= MAX_ERA; n++) if (ERAS[n] && st.age >= n) st.regions[n]!.unlocked = true; // the age is the truth
    // A save written while a slot's last bundle was still flying: finish it silently before any pad is armed.
    ctx.state.stats.machinesBuilt += settlePaidSlots(ctx.state);
    for (let n = 2; n <= MAX_ERA; n++) if (st.regions[n]!.unlocked) this.regions[n] = new Region(ctx, n);
    this.refreshPads(false);
    ctx.events.on('village:changed', () => this.refreshPads(true));
    ctx.events.on('market:order', ({ kind, count, era, amount }) => {
      const r = this.regions[era];
      if (r) r.deliver(kind, count, amount);
      else ctx.economy.add(amount, 0); // no dock (cannot happen): give the money back
    });
  }

  /**
   * Open era n now (the expansion pad completed, or debug): state.eras.age = max(age, n), build the region and emit
   * 'era:unlocked' for it (and for every lower closed era first). `instant`: no pop-in / ring / sound.
   */
  unlock(n: number, instant = false): void {
    if (!ERAS[n]) return;
    const st = this.ctx.state.eras;
    for (let k = 2; k <= n; k++) {
      if (this.regions[k]) continue;
      st.age = Math.max(st.age, k);
      const rs = st.regions[k]!;
      rs.unlocked = true;
      rs.cash = 0;
      rs.extra = 0;
      const region = new Region(this.ctx, k);
      this.regions[k] = region;
      if (!instant) region.appear();
      const g = region.layout.gate;
      this.ctx.events.emit('era:unlocked', { era: k, position: new THREE.Vector3(g.x, 0, g.z) });
    }
    this.refreshPads(true);
  }

  /**
   * Debug / tests: put machine `id` on slot `slot` of era n, fully built (instant: no effects). False when the region is
   * locked, the slot is out of range or the machine is from another era.
   */
  build(n: number, slot: number, id: string, instant = true): boolean {
    return this.regions[n]?.debugBuild(slot, id, instant) ?? false;
  }

  /** Region runtime for era n, or null while locked. */
  region(n: number): RegionRuntime | null {
    return this.regions[n] ?? null;
  }

  update(dt: number): void {
    for (const r of this.regions) r?.update(dt);
    this.pollTimer -= dt;
    if (this.pollTimer <= 0) {
      this.pollTimer = POLL;
      this.refreshPads(true);
    }
  }

  /** World snapshot of every region (machine piles + import docks; items carried by workers go back to their dock). */
  snapshot(): WorldSnapshot['eras'] {
    return REGION_SLOTS.map((count, n) => this.regions[n]?.snapshot() ?? { slots: Array.from({ length: count }, () => ({ in: {}, out: 0 })), dock: {} });
  }

  /** Refill piles from a save (after construction). */
  restore(snap: WorldSnapshot['eras']): void {
    if (!Array.isArray(snap)) return;
    snap.forEach((e, n) => {
      if (e) this.regions[n]?.restore(e);
    });
  }

  // ---- expansion pads ---------------------------------------------------------------------------------------------
  /**
   * Show the pads that are on offer (payable) or on preview (greyed, locked), hide the others. `live`: a newly shown pad
   * pops in, and a pad that turns payable announces itself.
   */
  private refreshPads(live: boolean): void {
    const state = this.ctx.state;
    for (let n = 2; n <= MAX_ERA; n++) {
      if (!ERAS[n]) continue;
      const offered = expansionOffered(state, n);
      if ((offered || expansionPreview(state, n)) && !this.regions[n]) {
        const pad = this.padFor(n);
        const wasPayable = pad.visible && !pad.locked;
        // preview: the gate's progress "37/48 · S8/10" under the padlock (redrawn only when the text changes)
        pad.setLocked(offered ? null : gateNote(eraGate(state, n)));
        if (!pad.visible) pad.show(!live);
        if (!offered || wasPayable) continue;
        if (live) {
          const p = regionLayout(n).expansionPad;
          this.ctx.events.emit('expansion:offered', { era: n, position: new THREE.Vector3(p.x, 0, p.z) });
        }
      } else {
        this.pads[n]?.hide();
      }
    }
  }

  /** The era's expansion pad, created on first use. */
  private padFor(n: number): ConstructionPad {
    let pad = this.pads[n];
    if (pad) return pad;
    const def = ERAS[n]!;
    const L = regionLayout(n);
    const rs = ctxRegion(this.ctx, n);
    pad = new ConstructionPad(this.ctx, {
      label: def.region.toUpperCase(),
      icon: 'expansion',
      logs: 0,
      cash: def.unlock.cash,
      paidCash: rs.cash,
      extra: { kind: def.unlock.extra.kind, count: def.unlock.extra.count, paid: rs.extra },
      key: `expansion:${n}`,
      x: L.expansionPad.x,
      z: L.expansionPad.z,
      size: L.padSize,
      onProgress: (_logs, cash, extra) => {
        const s = ctxRegion(this.ctx, n);
        s.cash = cash;
        s.extra = extra;
      },
      onComplete: () => this.unlock(n, false),
    });
    this.pads[n] = pad;
    return pad;
  }
}

function ctxRegion(ctx: GameContext, n: number): { cash: number; extra: number } {
  return ctx.state.eras.regions[n]!;
}
