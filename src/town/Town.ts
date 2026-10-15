/**
 * [T2 — town] The Market Town (wave 9): LAYOUT.town, BUSINESSES, TOWN. Eight lots around a market square east of
 * the village; the player chooses what to build on each (build panel), pays for it like a shelter, and the
 * building then runs as a business (town/Business.ts) that adds people to the population (eras = village levels).
 *
 * CONTRACT (keep every public signature; T2 owns the implementation, MAIN owns Level / Progression wiring):
 * - State: ctx.state.town is the truth. The constructor builds everything from it AT ONCE and silently: an
 *   unrevealed town shows nothing interactive; a revealed one has walk bounds added, every built lot's business
 *   built (instant), every chosen-but-unpaid lot's ConstructionPad armed with its partial progress, every empty
 *   lot's "for sale" sign + lot pad. A restored lot whose paid amounts already cover its cost is built silently
 *   (the same rule Village / Quarters follow; stats.townBuilt++ once).
 * - reveal(instant): adds LAYOUT.town.walk to ctx.colliders (addBounds), calls ctx.environment.openTownGate(instant),
 *   sets state.town.revealed, offers the lots. Idempotent. Not instant: emits 'town:revealed'. Progression calls it.
 * - Empty lot: a lot pad (a Zone over a pad tile at lot centre + face × padOffset, labelled "BUILD"). While the
 *   player stands on it: emit 'build:open' { lot } once; on leaving: 'build:close'. The HUD's BuildPanel shows
 *   the choices (choices(lot)) and calls choose(lot, id).
 * - choose(lot, id): only when the lot's paid amounts are 0 and id is in choices(lot) with available = true. Sets
 *   state.town.lots[lot].building, emits 'build:chosen', arms the lot's ConstructionPad (key 'lot:<i>', same spot)
 *   for BUSINESSES[id] (logs + cash). Returns false otherwise. While nothing is paid, standing on the pad opens the
 *   build panel again so the choice can be changed (the pad shows the building's icon + "tap to change").
 * - Completion: state lot.tier = 0 (paid reset to 0), stats.townBuilt++, the business is built (not instant: pop-in,
 *   dust, chimney smoke starts), emit 'built' { what: 'town:<id>' } and 'town:built'. Village recomputes the
 *   population on 'town:built' (core/demand.ts villagePopulation counts BUSINESSES[id].people of built lots).
 * - shops(): every built shop business (ShopSpot) — the townsfolk buy there. tills(): every till CashPile.
 * - snapshot() / restore(): the world part of the save (WorldSnapshot['town'], one entry per lot): hopper counts by
 *   kind (+ the item being processed), out pile / counter count, till value (CashPile.value already counts cash in
 *   flight). Level adds the townsfolk's unpaid goods (Townsfolk.loadedByLot) to `out` before saving.
 * - staffSpots(): visible workers (the "jobs" the town opens), read live by Townsfolk.
 * - padSpot(lot): the lot's pad position (the bot and the guide walk there). business(lot): the built business.
 *
 * Choices (choices(lot)): every BUSINESSES entry not in TOWN.hidden, with available = era ≤ village level, and
 * a reason when not ("Needs Winter City").
 *
 * Implementation: every lot owns a group at the lot centre (rotated so +Z faces the square) that shows ONE look at a
 * time — the for-sale sign, a growing scaffold while the chosen building is being paid, or (once built) the
 * Business's own group. Empty lots show a BUILD tile (town/LotPad.ts); a chosen one gets its ConstructionPad (created
 * lazily) plus a small "tap to change" sign while nothing is paid. The panel zone over the pad spot is enabled exactly
 * while the lot is open (rules.lotOpen), so the first payment closes the panel. Pure rules (choices, canChoose,
 * settlePaidLots, geometry) live in town/rules.ts so tests run without WebGL. The BuildPanel is attached to the
 * HUD at construction (ctx.hud.buildPanel.attach).
 */

import * as THREE from 'three';
import { BUSINESSES, LAYOUT, rect, type BusinessDef, type BusinessId, type XZ } from '../config';
import { createLotForSale, createTownScaffold, type TownScaffold } from '../assets/town';
import { createPadSign } from '../assets/pads';
import type { WorldSnapshot } from '../core/Save';
import type { GameContext } from '../core/types';
import { ConstructionPad, type ConstructionTarget } from '../stations/ConstructionPad';
import type { CashPile } from '../stations/CashPile';
import type { Zone } from '../items/Zones';
import { Business, type StaffSpot } from './Business';
import { LotPad } from './LotPad';
import { canChoose, choicesFor, lotFrame, lotOpen, paidFraction, settlePaidLots, type LotFrame } from './rules';
import type { ShopSpot } from './types';

const T = LAYOUT.town;
const SMOKE_TICK = 0.24;
const HINT_HEIGHT = 1.05;
const HINT_SCALE = 0.46;

export interface BuildChoice {
  def: BusinessDef;
  available: boolean;
  /** Why it can't be chosen yet ('Needs Winter City'), when !available. */
  reason?: string;
}

type Look = 'none' | 'sale' | 'scaffold' | 'built';

/** One lot of the square. */
interface Lot {
  readonly index: number;
  readonly frame: LotFrame;
  readonly group: THREE.Group;
  readonly pos: XZ;
  readonly buildPad: LotPad;
  readonly zone: Zone;
  pad: ConstructionPad | null;
  hint: THREE.Mesh | null;
  look: Look;
  model: THREE.Object3D | null;
  scaffold: TownScaffold | null;
  business: Business | null;
}

export class Town {
  /** Everything the town draws hangs under this group. */
  readonly root = new THREE.Group();
  private readonly lots: Lot[] = [];
  private opened = false;
  private smokeTimer = 0;
  private smokeCursor = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(readonly ctx: GameContext) {
    this.root.name = 'town';
    this.root.visible = false;
    ctx.scene.add(this.root);

    // A save written while a lot's last bundle was still flying holds a fully paid, never-completed building:
    // state is the truth, finish it silently before any pad is armed (stats.townBuilt++ once; the live path counts
    // in completeLot(), which never ran for it).
    const before = ctx.state.town.lots.map((l) => l.tier);
    const settled = settlePaidLots(ctx.state);
    ctx.state.stats.townBuilt += settled;

    T.lots.forEach((l, i) => {
      const frame = lotFrame(i);
      const group = new THREE.Group();
      group.name = `lot:${i}`;
      group.position.set(l.x, 0, l.z);
      group.rotation.y = frame.yaw;
      this.root.add(group);
      const pos = { x: l.x + l.face.x * T.padOffset, z: l.z + l.face.z * T.padOffset };
      const buildPad = new LotPad(ctx, pos.x, pos.z, T.padSize);
      this.root.add(buildPad.object);
      const zone = ctx.zones.add({
        id: `town:lot${i}:build`,
        area: rect(pos.x, pos.z, T.padSize * 1.2, T.padSize * 1.2),
        enabled: false,
        onEnter: () => ctx.events.emit('build:open', { lot: i }),
        onExit: () => ctx.events.emit('build:close', {}),
      });
      this.lots.push({ index: i, frame, group, pos, buildPad, zone, pad: null, hint: null, look: 'none', model: null, scaffold: null, business: null });
    });

    ctx.hud.buildPanel.attach(this);
    if (ctx.state.town.revealed) this.applyReveal(true);
    // Village was constructed first and counted these lots as unbuilt: tell it (and anyone else) now.
    ctx.state.town.lots.forEach((l, i) => {
      if (before[i]! < 0 && l.tier >= 0 && l.building !== '') {
        const b = this.lots[i]!.business;
        ctx.events.emit('town:built', { lot: i, building: l.building, position: new THREE.Vector3(this.lots[i]!.frame.x, 0, this.lots[i]!.frame.z), object: b?.group ?? this.root });
      }
    });
  }

  get revealed(): boolean {
    return this.ctx.state.town.revealed;
  }

  /** Open the corridor: walk bounds, the gate, the lots on offer. Idempotent. */
  reveal(instant = false): void {
    const st = this.ctx.state.town;
    if (st.revealed && this.opened) return;
    st.revealed = true;
    this.applyReveal(instant);
    if (!instant) {
      const sq = T.square;
      this.ctx.events.emit('town:revealed', { position: new THREE.Vector3((sq.minX + sq.maxX) / 2, 0, (sq.minZ + sq.maxZ) / 2) });
    }
  }

  choices(_lot: number): BuildChoice[] {
    return choicesFor(this.ctx.state.village.level);
  }

  /** Pick what to build on `lot` (only while nothing is paid). Arms the construction pad. */
  choose(lot: number, id: BusinessId): boolean {
    if (!this.opened || !canChoose(this.ctx.state, lot, id)) return false;
    const L = this.lots[lot]!;
    const st = this.ctx.state.town.lots[lot]!;
    const same = st.building === id;
    st.building = id;
    const pad = this.armPad(L, id);
    L.buildPad.hide();
    if (!pad.visible) pad.show(false);
    this.refreshHint(L);
    this.refreshLook(L, true);
    this.refreshZone(L);
    this.ctx.audio.play('pop', { volume: 0.7, pitch: 1.2 });
    if (!same) this.ctx.events.emit('build:chosen', { lot, building: id });
    return true;
  }

  business(lot: number): Business | null {
    return this.lots[lot]?.business ?? null;
  }

  shops(): ShopSpot[] {
    const out: ShopSpot[] = [];
    for (const L of this.lots) {
      const s = L.business?.asShop();
      if (s) out.push(s);
    }
    return out;
  }

  tills(): CashPile[] {
    const out: CashPile[] = [];
    for (const L of this.lots) if (L.business?.till) out.push(L.business.till);
    return out;
  }

  /**
   * Where the workers of every built producer / shop stand (behind the counter, in the field…), ~1 per 2 jobs:
   * Townsfolk shows a working person at each (idle bob / working gesture while the business works).
   */
  staffSpots(): { lot: number; x: number; z: number; yaw: number; working: boolean }[] {
    const out: { lot: number; x: number; z: number; yaw: number; working: boolean }[] = [];
    for (const L of this.lots) {
      if (!L.business) continue;
      const spots: StaffSpot[] = L.business.staff();
      for (const s of spots) out.push({ lot: L.index, ...s });
    }
    return out;
  }

  /** Where to stand to choose / pay lot `lot` (its pad), or null when it is built or the town is closed. */
  padSpot(lot: number): XZ | null {
    const L = this.lots[lot];
    if (!L || !this.opened || L.business) return null;
    return { x: L.pos.x, z: L.pos.z };
  }

  /** The lot's live construction pad (exists once a building was chosen; shown while it is being paid), else null. */
  pad(lot: number): ConstructionPad | null {
    return this.lots[lot]?.pad ?? null;
  }

  snapshot(): WorldSnapshot['town'] {
    return this.lots.map((L) => (L.business ? L.business.snapshot() : { in: {}, out: 0, cash: 0 }));
  }

  restore(w: WorldSnapshot['town']): void {
    if (!Array.isArray(w)) return;
    this.lots.forEach((L, i) => {
      const e = w[i];
      if (L.business && e) L.business.restore(e);
    });
  }

  /** Debug: choose + finish lot `lot` as `id` at once (not instant: plays the build moment). */
  debugBuild(lot: number, id: BusinessId): void {
    const L = this.lots[lot];
    if (!L || !(id in BUSINESSES)) return;
    if (!this.opened) this.reveal(true);
    const st = this.ctx.state.town.lots[lot]!;
    if (st.tier >= 0 || L.business) return;
    st.building = id;
    st.logs = 0;
    st.cash = 0;
    this.completeLot(L);
  }

  update(dt: number): void {
    if (!this.opened) return;
    const cam = this.ctx.camera.quaternion;
    for (const L of this.lots) {
      L.buildPad.update(dt);
      if (L.hint?.visible) L.hint.quaternion.copy(cam);
      L.business?.update(dt);
    }
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = SMOKE_TICK;
      this.puffNext();
    }
  }

  // ---- reveal -----------------------------------------------------------------------------------------------
  private applyReveal(instant: boolean): void {
    if (this.opened) return;
    this.opened = true;
    const ctx = this.ctx;
    this.root.visible = true;
    ctx.environment.openTownGate(instant);
    for (const r of T.walk) ctx.colliders.addBounds(r);
    for (const L of this.lots) {
      const st = ctx.state.town.lots[L.index]!;
      if (st.building !== '' && st.tier >= 0) {
        this.makeBusiness(L, true);
      } else if (st.building !== '') {
        const pad = this.armPad(L, st.building);
        pad.show(true);
        this.refreshHint(L);
      } else {
        L.buildPad.show(instant);
      }
      this.refreshLook(L, false);
      this.refreshZone(L);
      if (!instant && L.model && L.look === 'sale') ctx.tweens.popIn(L.model, { delay: 0.25 + L.index * 0.07, duration: 0.45 });
    }
  }

  // ---- lots -------------------------------------------------------------------------------------------------
  private target(id: BusinessId, paidLogs: number, paidCash: number): ConstructionTarget {
    const d = BUSINESSES[id];
    return { label: d.label.toUpperCase(), icon: id, logs: d.logs, cash: d.cash, paidLogs, paidCash };
  }

  /** The lot's construction pad, created on first use and re-armed for `id`. */
  private armPad(L: Lot, id: BusinessId): ConstructionPad {
    const st = this.ctx.state.town.lots[L.index]!;
    const target = this.target(id, st.logs, st.cash);
    if (L.pad) {
      L.pad.rearm(target);
      return L.pad;
    }
    const pad = new ConstructionPad(this.ctx, {
      ...target,
      key: `lot:${L.index}`,
      x: L.pos.x,
      z: L.pos.z,
      size: T.padSize,
      onProgress: (logs, cash) => this.onProgress(L, logs, cash),
      onComplete: () => this.completeLot(L),
    });
    L.pad = pad;
    return pad;
  }

  private onProgress(L: Lot, logs: number, cash: number): void {
    const st = this.ctx.state.town.lots[L.index]!;
    st.logs = logs;
    st.cash = cash;
    this.refreshLook(L, true);
    this.refreshHint(L);
    this.refreshZone(L);
  }

  /** The panel zone is on exactly while the lot is open (empty, or chosen with nothing paid). */
  private refreshZone(L: Lot): void {
    L.zone.setEnabled(this.opened && lotOpen(this.ctx.state, L.index));
  }

  /** "Tap to change" under the pad's sign while a chosen building has nothing paid yet. */
  private refreshHint(L: Lot): void {
    const st = this.ctx.state.town.lots[L.index]!;
    const on = st.building !== '' && lotOpen(this.ctx.state, L.index);
    if (on && !L.hint) {
      const h = createPadSign('TAP TO CHANGE');
      h.scale.setScalar(HINT_SCALE);
      h.position.set(L.pos.x, HINT_HEIGHT, L.pos.z);
      this.root.add(h);
      L.hint = h;
    }
    if (L.hint) L.hint.visible = on;
  }

  /** Make the lot show the right model: the sign, a scaffold sized to the paid share, or nothing (built). */
  private refreshLook(L: Lot, animate: boolean): void {
    const st = this.ctx.state.town.lots[L.index]!;
    const built = st.building !== '' && st.tier >= 0;
    const frac = paidFraction(this.ctx.state, L.index);
    const look: Look = built ? 'built' : frac > 0 ? 'scaffold' : 'sale';
    if (look === 'scaffold' && L.look === 'scaffold' && L.scaffold) {
      L.scaffold.setProgress(frac);
      return;
    }
    if (look === L.look) return;
    const prev = L.look;
    L.look = look;
    if (L.model) {
      L.group.remove(L.model);
      L.model = null;
      L.scaffold = null;
    }
    if (look === 'built') return;
    if (look === 'scaffold') {
      const sc = createTownScaffold();
      sc.setProgress(frac);
      L.scaffold = sc;
      L.model = sc.group;
    } else {
      L.model = createLotForSale();
    }
    L.group.add(L.model);
    if (animate && this.root.visible && prev !== 'none' && look === 'scaffold') this.ctx.tweens.popIn(L.model, { duration: 0.3 });
  }

  private makeBusiness(L: Lot, instant: boolean): Business {
    const id = this.ctx.state.town.lots[L.index]!.building as BusinessId;
    const b = new Business(this.ctx, L.index, BUSINESSES[id], this.root);
    L.business = b;
    b.build(instant);
    return b;
  }

  /** The chosen building is paid (or debugBuild): it pops in and starts running. */
  private completeLot(L: Lot): void {
    const ctx = this.ctx;
    const st = ctx.state.town.lots[L.index]!;
    if (st.building === '' || L.business) return;
    const id = st.building;
    st.tier = 0;
    st.logs = 0;
    st.cash = 0;
    L.pad?.hide();
    L.buildPad.hide();
    this.refreshHint(L);
    this.refreshLook(L, true);
    this.refreshZone(L);
    const b = this.makeBusiness(L, false);
    ctx.state.stats.townBuilt++;
    const at = this.tmp.set(L.frame.x, 0.4, L.frame.z);
    ctx.particles.puff(at, { color: 0xffffff, count: 9, size: 1.3, life: 0.9 });
    const position = new THREE.Vector3(L.frame.x, 0, L.frame.z);
    ctx.events.emit('built', { what: `town:${id}`, position, object: b.group });
    ctx.events.emit('town:built', { lot: L.index, building: id, position: position.clone(), object: b.group });
  }

  /** Chimney smoke: one source per tick, round-robin over the buildings that have a chimney. */
  private puffNext(): void {
    const n = this.lots.length;
    for (let k = 0; k < n; k++) {
      this.smokeCursor = (this.smokeCursor + 1) % n;
      const c = this.lots[this.smokeCursor]!.business?.chimney;
      if (c) {
        this.ctx.particles.puff(this.tmp.copy(c), { color: 0xffffff, count: 1, size: 0.45, life: 2.2 });
        return;
      }
    }
  }
}
