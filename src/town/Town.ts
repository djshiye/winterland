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
 *
 * Wave 12 amenities (cafe, snowman park, bandstand, skating pond): four fixed sites on the square, built like the
 * Great Lodge. Each owns a ConstructionPad at LAYOUT.town.amenities[id].pad (logs + cash from AMENITIES[id]), shown
 * once the town is revealed and village.level >= def.era while state.town.amenities[id].tier < 0 (re-checked on
 * 'village:changed'). Progress is mirrored into state; completion sets tier 0, pops the model in (assets/townAmenities.ts,
 * facing the pad: rules.amenityFrame), adds its footprint as a solid collider and emits 'built' (JuiceDirector's chime,
 * ring, puff) + 'amenity:built'. A restored built amenity shows silently; a fully paid one is settled silently first
 * (rules.settlePaidAmenities, also called from Level). The cafe puffs steam from its mug sign (round-robin with the chimneys).
 *
 * 0.9.0 Demolish: once the player reached era 2 (state.eras.age >= 2, rules.canManage) every BUILT lot gets a small manage
 * zone + MANAGE sign beyond its stations (rules.manageRect; created lazily, nothing exists in era 1; re-checked on
 * 'era:unlocked'). Entering it emits 'manage:open' (the ManagePanel card: jobs, what it makes, the price
 * rules.demolishCost); leaving emits 'manage:close'. Its onDemolish pays (economy.spend) and calls demolish(lot): the till's
 * cash goes to the player, the Business is torn down (colliders, zones, piles; Business.teardown, then drained once nothing
 * flies to it) and the lot is for sale again (building '', tier -1, a sale sign, a BUILD pad), 'town:demolished'.
 *
 * Wave 13 Grand Market (the Winterland finale): one more fixed site at LAYOUT.town.grandMarket. Its ConstructionPad
 * (key 'grandMarket') takes logs + cash + TOYS (the pad's `extra`), shown while the town is revealed, village.level >=
 * VILLAGE.grandMarket.requiresLevel and state.town.grandMarket.tier < 0. Progress is mirrored into
 * state.town.grandMarket {logs, cash, toys}. Completion sets tier 0, pops the hall in (assets/grandMarket.ts, front toward +Z /
 * the camera: rules.grandMarketFrame), adds its footprint as a solid collider and emits 'built' + 'finale2:start' (Progression sets flags.grandMarket,
 * JuiceDirector fires the fireworks, the HUD schedules the finale card). The pad lies outside LAYOUT.town.walk, so the
 * town's reveal also adds rules.grandMarketFrame().walk. A restored built market shows silently (and settles a fully
 * paid one first: rules.settlePaidGrandMarket, also called from Level). debugBuildGrandMarket() builds it without the event.
 */

import * as THREE from 'three';
import { AMENITIES, AMENITY_IDS, BUSINESSES, LAYOUT, VILLAGE, rect, type AmenityId, type BusinessDef, type BusinessId, type XZ } from '../config';
import { createLotForSale, createTownScaffold, type TownScaffold } from '../assets/town';
import { createPadSign } from '../assets/pads';
import { createAmenityModel, type AmenityModel } from '../assets/townAmenities';
import { createGrandMarketModel, type GrandMarketModel } from '../assets/grandMarket';
import type { WorldSnapshot } from '../core/Save';
import type { GameContext } from '../core/types';
import { ConstructionPad, type ConstructionTarget } from '../stations/ConstructionPad';
import type { CashPile } from '../stations/CashPile';
import type { Zone } from '../items/Zones';
import { Business, type StaffSpot } from './Business';
import { LotPad } from './LotPad';
import { amenityFrame, amenityOffered, canChoose, canManage, choicesFor, demolishCost, grandMarketFrame, grandMarketOffered, lotFrame, lotOpen, manageRect, paidFraction, settlePaidAmenities, settlePaidGrandMarket, settlePaidLots, type AmenityFrame, type GrandMarketFrame, type LotFrame } from './rules';
import type { ShopSpot } from './types';

const T = LAYOUT.town;
const SMOKE_TICK = 0.24;
const HINT_HEIGHT = 1.05;
const HINT_SCALE = 0.46;
/** The MANAGE label over a built lot's manage tile: the same size as the city's and the machines' (readable from the camera). */
const MANAGE_SIGN_SCALE = 0.9;
const MANAGE_SIGN_HEIGHT = 1.3;

export interface BuildChoice {
  def: BusinessDef;
  available: boolean;
  /** Why it can't be chosen yet ('Needs Winter City'), when !available. */
  reason?: string;
}

type Look = 'none' | 'sale' | 'scaffold' | 'built';

/** One amenity site (wave 12). */
interface AmenitySite {
  readonly id: AmenityId;
  readonly frame: AmenityFrame;
  readonly pad: ConstructionPad;
  readonly group: THREE.Group;
  model: AmenityModel | null;
  /** World steam source (cafe, once built) or null. */
  steam: THREE.Vector3 | null;
}

/** The Grand Market site (wave 13). */
interface MarketSite {
  readonly frame: GrandMarketFrame;
  readonly pad: ConstructionPad;
  readonly group: THREE.Group;
  model: GrandMarketModel | null;
  /** World chimney mouths (once built). */
  chimneys: THREE.Vector3[];
}

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
  /** Era 2+: the demolish card's zone and its floating sign (created the first time the lot is manageable). */
  manage: Zone | null;
  manageSign: THREE.Mesh | null;
}

export class Town {
  /** Everything the town draws hangs under this group. */
  readonly root = new THREE.Group();
  private readonly lots: Lot[] = [];
  private readonly amenities: AmenitySite[] = [];
  private readonly market: MarketSite;
  private opened = false;
  /** Demolished businesses waiting for their last in-flight items before their piles are disposed (Business.drain). */
  private readonly graveyard: Business[] = [];
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
    settlePaidAmenities(ctx.state);
    settlePaidGrandMarket(ctx.state);

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
      this.lots.push({ index: i, frame, group, pos, buildPad, zone, pad: null, hint: null, look: 'none', model: null, scaffold: null, business: null, manage: null, manageSign: null });
    });

    for (const id of AMENITY_IDS) this.amenities.push(this.makeAmenitySite(id));
    // a village level-up can unlock an amenity's pad (the pond needs level 4)
    this.market = this.makeMarketSite();
    ctx.events.on('village:changed', () => this.refreshAmenities(false));
    // era 2 opens the demolish zones of the lots that are already built
    ctx.events.on('era:unlocked', () => this.refreshAllManage());

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

  /** Debug / bot: pay + finish amenity `id` at once (not instant: plays the build moment). Opens the town if needed. */
  debugBuildAmenity(id: AmenityId): void {
    const S = this.amenities.find((a) => a.id === id);
    if (!S) return;
    if (!this.opened) this.reveal(true);
    const st = this.ctx.state.town.amenities[id];
    if (st.tier >= 0 && S.model) return;
    this.completeAmenity(S);
  }

  /** Debug / bot: build the Grand Market at once (tier 0 + model + flag, NO event: no fanfare, no card). */
  debugBuildGrandMarket(): void {
    if (!this.opened) this.reveal(true);
    const st = this.ctx.state.town.grandMarket;
    st.tier = 0;
    st.logs = 0;
    st.cash = 0;
    st.toys = 0;
    this.market.pad.hide();
    this.showMarket(true);
  }

  /** True once the Grand Market is built and shown. */
  get grandMarketBuilt(): boolean {
    return this.market.model !== null;
  }

  /** The Grand Market's construction pad (tests / bot / guide). */
  get marketPad(): ConstructionPad {
    return this.market.pad;
  }

  /** True once amenity `id` is built and shown. */
  amenityBuilt(id: AmenityId): boolean {
    return this.amenities.some((a) => a.id === id && a.model !== null);
  }

  /** Price to demolish the building on `lot`, or null when the lot has none. */
  demolishCost(lot: number): number | null {
    const b = this.lots[lot]?.business;
    return b ? demolishCost(b.def.id) : null;
  }

  /**
   * Demolish the building on `lot` (no payment, no era check: the manage card pays first; tests / debug / bot call it
   * directly). The till's cash is credited to the player, the Business is torn down and the lot is for sale again.
   */
  demolish(lot: number): boolean {
    const L = this.lots[lot];
    const b = L?.business;
    if (!L || !b) return false;
    const ctx = this.ctx;
    const id = b.def.id;
    const cash = Math.floor(b.till?.value ?? 0);
    if (cash > 0) ctx.economy.add(cash); // nothing the shop earned is lost
    b.teardown();
    this.graveyard.push(b);
    L.business = null;
    const st = ctx.state.town.lots[lot]!;
    st.building = '';
    st.tier = -1;
    st.logs = 0;
    st.cash = 0;
    L.pad?.hide();
    this.refreshManage(L);
    ctx.events.emit('manage:close', { key: this.manageKey(lot) });
    this.refreshHint(L);
    this.refreshLook(L, false);
    this.refreshZone(L);
    L.buildPad.show(false);
    if (L.model && this.root.visible) ctx.tweens.popIn(L.model, { duration: 0.45 });
    ctx.state.stats.demolished++;
    const position = new THREE.Vector3(L.frame.x, 0, L.frame.z);
    ctx.particles.puff(this.tmp.set(L.frame.x, 0.5, L.frame.z), { color: 0xffffff, count: 14, size: 1.5, life: 1.0 });
    ctx.audio.play('pop', { volume: 0.6, pitch: 0.8 });
    ctx.events.emit('town:demolished', { lot, building: id, position });
    return true;
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
      if (L.manageSign?.visible) L.manageSign.quaternion.copy(cam);
      L.business?.update(dt);
    }
    for (let i = this.graveyard.length - 1; i >= 0; i--) if (this.graveyard[i]!.drain()) this.graveyard.splice(i, 1);
    for (const S of this.amenities) S.model?.animate?.(this.ctx.time.elapsed);
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
    ctx.colliders.addBounds(T.playerWalk); // 0.9.2: up to the lot fronts, not just the square
    ctx.colliders.addBounds(this.market.frame.walk); // the Grand Market's pad lies beyond the square
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
      this.refreshManage(L);
      if (!instant && L.model && L.look === 'sale') ctx.tweens.popIn(L.model, { delay: 0.25 + L.index * 0.07, duration: 0.45 });
    }
    for (const S of this.amenities) if (ctx.state.town.amenities[S.id].tier >= 0) this.showAmenity(S, true);
    if (ctx.state.town.grandMarket.tier >= 0) this.showMarket(true);
    this.refreshAmenities(instant);
  }

  // ---- amenities (wave 12) ----------------------------------------------------------------------------------
  private amenityTarget(id: AmenityId): ConstructionTarget {
    const def = AMENITIES[id];
    const st = this.ctx.state.town.amenities[id];
    return { label: def.label.toUpperCase(), icon: id, logs: def.logs, cash: def.cash, paidLogs: st.logs, paidCash: st.cash };
  }

  private makeAmenitySite(id: AmenityId): AmenitySite {
    const ctx = this.ctx;
    const frame = amenityFrame(id);
    const group = new THREE.Group();
    group.name = `amenity:${id}`;
    group.position.set(frame.x, 0, frame.z);
    group.rotation.y = frame.yaw;
    this.root.add(group);
    const pad = new ConstructionPad(ctx, {
      ...this.amenityTarget(id),
      key: `amenity:${id}`,
      x: frame.pad.x,
      z: frame.pad.z,
      size: T.amenityPadSize,
      onProgress: (logs, cash) => {
        const st = ctx.state.town.amenities[id];
        st.logs = logs;
        st.cash = cash;
      },
      onComplete: () => this.completeAmenity(this.amenities.find((a) => a.id === id)!),
    });
    return { id, frame, pad, group, model: null, steam: null };
  }

  /** Show / hide each amenity's pad: offered while the town is open, the level is reached and it is not built. */
  private refreshAmenities(instant: boolean): void {
    if (!this.opened) return;
    if (grandMarketOffered(this.ctx.state)) {
      if (!this.market.pad.visible) this.market.pad.show(instant);
    } else {
      this.market.pad.hide();
    }
    for (const S of this.amenities) {
      if (amenityOffered(this.ctx.state, S.id)) {
        if (!S.pad.visible) S.pad.show(instant);
      } else {
        S.pad.hide();
      }
    }
  }

  /** Put the built model on its site (instant: silent, final state; else it pops in with a puff). */
  private showAmenity(S: AmenitySite, instant: boolean): void {
    if (S.model) return;
    const model = createAmenityModel(S.id);
    S.model = model;
    S.group.add(model.root);
    this.ctx.colliders.addBox(S.frame.rect, `town:amenity:${S.id}`);
    if (model.steam) {
      const f = S.frame;
      const c = Math.cos(f.yaw);
      const s = Math.sin(f.yaw);
      S.steam = new THREE.Vector3(f.x + model.steam.x * c + model.steam.z * s, model.steam.y, f.z - model.steam.x * s + model.steam.z * c);
    }
    if (!instant && this.root.visible) {
      this.ctx.tweens.popIn(model.root, { duration: 0.5 });
      this.ctx.particles.puff(this.tmp.set(S.frame.x, 0.4, S.frame.z), { color: 0xffffff, count: 9, size: 1.3, life: 0.9 });
    }
  }

  /** The amenity is paid (or debugBuildAmenity): tier 0, the model pops in, the juice plays. */
  private completeAmenity(S: AmenitySite): void {
    const ctx = this.ctx;
    const st = ctx.state.town.amenities[S.id];
    if (S.model) return;
    st.tier = 0;
    st.logs = 0;
    st.cash = 0;
    S.pad.hide();
    this.showAmenity(S, false);
    const position = new THREE.Vector3(S.frame.x, 0, S.frame.z);
    ctx.events.emit('built', { what: `amenity:${S.id}`, position, object: S.group });
    ctx.events.emit('amenity:built', { id: S.id, position: position.clone() });
  }

  // ---- Grand Market (wave 13) -------------------------------------------------------------------------------
  private makeMarketSite(): MarketSite {
    const ctx = this.ctx;
    const frame = grandMarketFrame();
    const def = VILLAGE.grandMarket;
    const st = ctx.state.town.grandMarket;
    const group = new THREE.Group();
    group.name = 'grandMarket';
    group.position.set(frame.x, 0, frame.z);
    group.rotation.y = frame.yaw;
    this.root.add(group);
    const pad = new ConstructionPad(ctx, {
      label: def.label,
      icon: 'grandMarket',
      logs: def.logs,
      cash: def.cash,
      paidLogs: st.logs,
      paidCash: st.cash,
      extra: { kind: 'toy', count: def.toys, paid: st.toys },
      key: 'grandMarket',
      x: frame.pad.x,
      z: frame.pad.z,
      size: frame.padSize,
      onProgress: (logs, cash, toys) => {
        st.logs = logs;
        st.cash = cash;
        st.toys = toys;
      },
      onComplete: () => this.completeMarket(),
    });
    return { frame, pad, group, model: null, chimneys: [] };
  }

  /** Put the built hall on its site (instant: silent, final state; else it pops in with a puff). */
  private showMarket(instant: boolean): void {
    const S = this.market;
    if (S.model) return;
    const model = createGrandMarketModel();
    S.model = model;
    S.group.add(model.root);
    this.ctx.colliders.addBox(S.frame.rect, 'town:grandMarket');
    const f = S.frame;
    const c = Math.cos(f.yaw);
    const sn = Math.sin(f.yaw);
    S.chimneys = model.chimney.map((p) => new THREE.Vector3(f.x + p.x * c + p.z * sn, p.y, f.z - p.x * sn + p.z * c));
    if (instant) this.ctx.state.flags.grandMarket = true; // live: Progression sets it on 'finale2:start'
    if (!instant && this.root.visible) {
      this.ctx.tweens.popIn(model.root, { duration: 0.6 });
      this.ctx.particles.puff(this.tmp.set(f.x, 0.4, f.z), { color: 0xffffff, count: 12, size: 1.6, life: 1.0 });
    }
  }

  /** The Grand Market is paid: tier 0, the hall pops in, 'built' + 'finale2:start'. */
  private completeMarket(): void {
    const S = this.market;
    if (S.model) return;
    const st = this.ctx.state.town.grandMarket;
    st.tier = 0;
    st.logs = 0;
    st.cash = 0;
    st.toys = 0;
    S.pad.hide();
    this.showMarket(false);
    const position = new THREE.Vector3(S.frame.x, 0, S.frame.z);
    this.ctx.events.emit('built', { what: 'town:grandMarket', position, object: S.group });
    this.ctx.events.emit('finale2:start', { position: position.clone() });
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

  // ---- demolish (0.9.0) -------------------------------------------------------------------------------------
  private manageKey(lot: number): string {
    return `town:${lot}`;
  }

  private refreshAllManage(): void {
    for (const L of this.lots) this.refreshManage(L);
  }

  /** The manage zone + sign are on exactly while the town is open, a building stands on the lot and era 2 is reached. */
  private refreshManage(L: Lot): void {
    const on = this.opened && !!L.business && canManage(this.ctx.state, L.index);
    if (on && !L.manage) this.makeManage(L);
    L.manage?.setEnabled(on); // a disabled zone with the player inside fires its exit next frame ('manage:close')
    if (L.manageSign) L.manageSign.visible = on;
  }

  private makeManage(L: Lot): void {
    const ctx = this.ctx;
    const area = manageRect(L.index);
    L.manage = ctx.zones.add({
      id: `town:lot${L.index}:manage`,
      area,
      enabled: false,
      marker: true,
      onEnter: () => this.openManage(L),
      onExit: () => ctx.events.emit('manage:close', { key: this.manageKey(L.index) }),
    });
    const sign = createPadSign('MANAGE');
    sign.scale.setScalar(MANAGE_SIGN_SCALE);
    sign.position.set((area.minX + area.maxX) / 2, MANAGE_SIGN_HEIGHT, (area.minZ + area.maxZ) / 2);
    sign.visible = false;
    this.root.add(sign);
    L.manageSign = sign;
  }

  /** The info / demolish card of the building on `L` ('manage:open'). */
  private openManage(L: Lot): void {
    const b = L.business;
    if (!b || !canManage(this.ctx.state, L.index)) return;
    const def = b.def;
    const stats: { label: string; value: string }[] = [{ label: def.kind === 'home' ? 'Residents' : 'Jobs', value: `${def.people}` }];
    if (def.output) stats.push({ label: 'Makes', value: def.batch && def.batch > 1 ? `${def.output} x${def.batch}` : `${def.output}` });
    if (def.inputs.length > 0) stats.push({ label: 'Needs', value: def.inputs.map((i) => `${i.per} ${i.kind}`).join(' + ') });
    this.ctx.events.emit('manage:open', {
      key: this.manageKey(L.index),
      title: def.label,
      subtitle: 'Market Town',
      stats,
      demolishCost: demolishCost(def.id),
      onDemolish: () => this.demolishPaid(L, b),
    });
  }

  /** The card's confirm: still the same building, era gate open, pay, then demolish. False (nothing changed) otherwise. */
  private demolishPaid(L: Lot, b: Business): boolean {
    if (L.business !== b || b.dead || !canManage(this.ctx.state, L.index)) return false;
    if (!this.ctx.economy.spend(demolishCost(b.def.id))) return false;
    return this.demolish(L.index);
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
    this.refreshManage(L);
    ctx.state.stats.townBuilt++;
    const at = this.tmp.set(L.frame.x, 0.4, L.frame.z);
    ctx.particles.puff(at, { color: 0xffffff, count: 9, size: 1.3, life: 0.9 });
    const position = new THREE.Vector3(L.frame.x, 0, L.frame.z);
    ctx.events.emit('built', { what: `town:${id}`, position, object: b.group });
    ctx.events.emit('town:built', { lot: L.index, building: id, position: position.clone(), object: b.group });
  }

  /** Chimney smoke: one source per tick, round-robin over the chimneys, the cafe's cocoa steam (smaller, shorter), then the Grand Market's two chimneys. */
  private puffNext(): void {
    const nLA = this.lots.length + this.amenities.length;
    const n = nLA + this.market.chimneys.length;
    for (let k = 0; k < n; k++) {
      this.smokeCursor = (this.smokeCursor + 1) % n;
      if (this.smokeCursor < this.lots.length) {
        const c = this.lots[this.smokeCursor]!.business?.chimney;
        if (c) {
          this.ctx.particles.puff(this.tmp.copy(c), { color: 0xffffff, count: 1, size: 0.45, life: 2.2 });
          return;
        }
      } else if (this.smokeCursor >= nLA) {
        const c = this.market.chimneys[this.smokeCursor - nLA];
        if (c) {
          this.ctx.particles.puff(this.tmp.copy(c), { color: 0xffffff, count: 1, size: 0.5, life: 2.4 });
          return;
        }
      } else {
        const steam = this.amenities[this.smokeCursor - this.lots.length]!.steam;
        if (steam) {
          this.ctx.particles.puff(this.tmp.copy(steam), { color: 0xffffff, count: 1, size: 0.3, life: 1.5 });
          return;
        }
      }
    }
  }
}
