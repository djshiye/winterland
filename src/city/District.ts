/**
 * [city] 0.9.0 one city district (eras/data.ts DISTRICTS[n], 30 × 28 m east of the Market Town). It owns the pavement,
 * the street lamps, and DISTRICTS[n].lots lots laid out by rules.districtLots(n). Everything is driven by
 * state.city.districts[n].lots (the truth):
 *
 * - An EMPTY lot shows a "BUILD" tile (town/LotPad.ts) at its front. Standing on it opens the choose card
 *   ('choose:open' {key: 'city:<n>:<lot>'}, one option per building of the era, the landmark locked when the district
 *   already has one); leaving closes it. Choosing sets lot.building and arms a ConstructionPad (cash + the era's
 *   refined material, icon 'building') on the same spot; the paid share persists in the lot state and shows as a
 *   rising shell. While nothing is paid the card can be opened again to change the choice.
 * - A paid lot completes: the building model pops in (assets/cityBuildings.ts), its footprint becomes a solid collider
 *   (parks stay walkable), stats.cityBuilt++, 'built' + 'city:built'.
 * - A BUILT lot has a manage zone on the same tile: 'manage:open' (residents / jobs / income / happiness, the
 *   demolish price) and 'manage:close' on leaving. Demolishing spends the price, removes the model and collider and
 *   makes the lot empty again (stats.demolished++, 'city:demolished').
 * - The district's walk area (ctx.colliders.addBounds) is added when it opens. A restored save builds silently; the
 *   built models are made a few per frame so loading a huge city never stalls, and the pads / zones of a district
 *   are only created once the player first comes near.
 *
 * - 1.0: `sitePad(lot)` makes / shows a chosen lot's pad on demand (silently) for the era foremen (city/lotAccess.ts),
 *   and the district's walking residents and shoppers live in `life` (city/DistrictLife.ts, the city's shared crowd).
 *   A pad is re-armed only for a new choice: re-arming on every progress report dropped the pad's in-flight count, so
 *   each bundle / brick paid while the district was active used to count twice.
 *
 * Draw calls: pavement 1, lamps 1 (+ bulbs 1, + night halos 1), street furniture 1 (city/decor.ts, its lights in the bulbs), every building 2 (+1 pivot), every pad ~3.
 */
import { faceCameraUpright, fadeManageSign, manageSignFoot } from '../fx/manageSign';
import * as THREE from 'three';
import { CITY_BUILDINGS, CITY_HAPPINESS_BONUS, DISTRICT_MATERIAL, ERA_NAMES, districtDef, era, type CityBuildingDef, type CityBuildingId } from '../eras/data';
import type { ChooseOption, GameContext } from '../core/types';
import { climbMult, settledCityTotals } from '../core/demand';
import { Batch } from '../render/batch';
import { SNOW, mixHex, palette } from '../render/palette';
import { geo } from '../render/materials';
import { createCityBuilding, createCityScaffold, type CityBuildingModel } from '../assets/cityBuildings';
import { LotPad } from '../town/LotPad';
import { createManageSign, setManageSignName } from '../assets/pads';
import { ConstructionPad } from '../stations/ConstructionPad';
import type { ColliderHandle } from '../world/Colliders';
import type { Zone } from '../items/Zones';
import type { Crowd } from '../npc/Crowd';
import { DistrictLife } from './DistrictLife';
import { districtDecor, districtLamps } from './decor';
import { drawDecor } from './decorModels';
import { buildHalos, bulbMaterial, type HaloSpot } from '../world/env/glow';
import {
  canChoose,
  chooseOptions,
  costText,
  demolishCost,
  demolishLot,
  districtInner,
  districtLots,
  emptyLot,
  employment,
  lotBuilt,
  lotHeightCap,
  lotOpen,
  paidFraction,
  visualHeight,
  type LotFrame,
} from './rules';

/** Pavement per era: street, sidewalk (lanes + ring), plot, tile accent, lamp pole, lamp bulb. */
type Surface = { street: number; walk: number; plot: number; tile: number; pole: number; bulb: number; tileSize: number };

/**
 * 0.9.8 (10c): the late districts pave in their era's own base board (render/palette.ts floors), so the city reads as
 * the same place as the era's plot: silicon-beige terrazzo with teal poles (8), mint glaze (9), cream with gold
 * seams (10). Lighter era by era, warm, never grey slush.
 */
function lateSurface(n: number, tileSize: number): Surface {
  const p = palette(n);
  const c = p.city!;
  return {
    street: mixHex(p.floor.yard, 0x8a8478, n === 10 ? 0.3 : 0.42),
    walk: mixHex(n === 10 ? p.floor.yard : p.floor.processing, SNOW, 0.25),
    plot: mixHex(p.floor.yard, c.wall2, 0.25),
    tile: n === 10 ? mixHex(p.floor.yard, p.floor.processing, 0.28) : mixHex(p.floor.yard, c.accent, 0.18),
    pole: c.roof,
    bulb: mixHex(p.light, 0xffffff, 0.45),
    tileSize,
  };
}

const SURFACE: readonly (Surface | null)[] = [
  null,
  null,
  { street: 0x8d8478, walk: 0xb9b2a6, plot: 0xa39a8c, tile: 0x9f978a, pole: 0x6b4a33, bulb: 0xffc860, tileSize: 0.9 },
  { street: 0x7b6e68, walk: 0xa99b92, plot: 0x8f827a, tile: 0x93857c, pole: 0x3b3f47, bulb: 0xffc860, tileSize: 1.1 },
  { street: 0x6f6a66, walk: 0x9c9690, plot: 0x85807b, tile: 0x8c8782, pole: 0x383d40, bulb: 0xffd070, tileSize: 1.3 },
  { street: 0x55575c, walk: 0x9a9da3, plot: 0x7d8086, tile: 0x8a8d93, pole: 0x34383d, bulb: 0xffd890, tileSize: 1.5 },
  { street: 0x5a5d62, walk: 0xa8aaa6, plot: 0x82868a, tile: 0x9a9c98, pole: 0x2b3b39, bulb: 0xffe0a0, tileSize: 1.6 },
  { street: 0x5c5650, walk: 0xb3aa9c, plot: 0x8a8278, tile: 0xa69d8e, pole: 0x6a5a4e, bulb: 0xfff0c8, tileSize: 1.8 },
  lateSurface(8, 2.0),
  lateSurface(9, 2.0),
  lateSurface(10, 2.2),
];

const PER_FRAME = 2;

/**
 * Free a dropped construction site's own merged base geometry (each scaffold merges a fresh one). The shell's unit box
 * and the materials are shared caches and stay.
 */
export function disposeScaffold(group: THREE.Object3D): void {
  const shared = geo.boxBase(1, 1, 1);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry !== shared) o.geometry.dispose();
  });
}

/** Lot runtime. */
interface Lot {
  readonly index: number;
  readonly frame: LotFrame;
  readonly group: THREE.Group;
  zone: Zone | null;
  lotPad: LotPad | null;
  pad: ConstructionPad | null;
  /** The building the pad is armed for ('' = re-arm on the next choice): re-arming resets its in-flight counts. */
  padFor: CityBuildingId | '';
  model: CityBuildingModel | null;
  scaffold: { group: THREE.Group; setProgress(p: number): void } | null;
  collider: ColliderHandle | null;
  /** Floating "MANAGE" label over a built lot's tile (the info / demolish card opens there). */
  sign: THREE.Mesh | null;
  /** Which card the player's standing on this lot has open. */
  card: 'choose' | 'manage' | null;
}

export class District {
  readonly n: number;
  readonly root = new THREE.Group();
  private readonly lots: Lot[] = [];
  private active = false;
  private readonly queue: Lot[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly inflated: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** 1.0: residents and shoppers walking the district (only with the city's shared crowd). */
  readonly life: DistrictLife | null;

  /**
   * @param ctx       game services
   * @param n         the era / district number (2..10)
   * @param onChange  called after a lot completed / was demolished (City recomputes the economy)
   * @param crowd     1.0: the city's shared crowd for the district's walking people (none: no district life)
   */
  constructor(
    readonly ctx: GameContext,
    n: number,
    private readonly onChange: () => void,
    crowd?: () => Crowd,
  ) {
    this.n = n;
    this.life = crowd ? new DistrictLife(ctx, n, crowd, this.root) : null;
    const def = districtDef(n);
    this.root.name = `district:${n}`;
    this.root.add(buildScenery(n));
    ctx.scene.add(this.root);
    ctx.colliders.addBounds(def.rect);
    this.inflated = { minX: def.rect.minX - 12, maxX: def.rect.maxX + 12, minZ: def.rect.minZ - 12, maxZ: def.rect.maxZ + 12 };
    for (const frame of districtLots(n)) {
      const group = new THREE.Group();
      group.name = `lot:${n}:${frame.index}`;
      group.position.set(frame.x, 0, frame.z);
      this.root.add(group);
      this.lots.push({ index: frame.index, frame, group, zone: null, lotPad: null, pad: null, padFor: '', model: null, scaffold: null, collider: null, sign: null, card: null });
    }
    // restored buildings: colliders now, models a few per frame
    for (const L of this.lots) {
      if (lotBuilt(this.state(L))) {
        this.addCollider(L);
        this.queue.push(L);
      }
    }
  }

  get width(): number {
    return this.lots[0]?.frame.w ?? 0;
  }

  /** Lot count. */
  get size(): number {
    return this.lots.length;
  }

  private state(L: Lot) {
    return this.ctx.state.city.districts[this.n]!.lots[L.index]!;
  }

  private key(L: Lot): string {
    return `city:${this.n}:${L.index}`;
  }

  /** The built model of a lot (tests / debug) or null. */
  modelOf(lot: number): CityBuildingModel | null {
    return this.lots[lot]?.model ?? null;
  }

  /** Where to stand to choose / pay / manage lot `lot` (its pad tile). */
  padSpot(lot: number): { x: number; z: number } | null {
    const L = this.lots[lot];
    return L ? { x: L.frame.pad.x, z: L.frame.pad.z } : null;
  }

  /** The lot's live construction pad (exists once a building was chosen), else null. */
  pad(lot: number): ConstructionPad | null {
    return this.lots[lot]?.pad ?? null;
  }

  /**
   * 1.0 (era foremen): the pad of a chosen, unbuilt lot, made and shown on demand when the player has not been near the
   * district yet; silent (no pop-in, sound or event), like a restored save. Null when the lot has nothing chosen or is
   * built. Activation later finds it armed and shown and leaves it as it is.
   */
  sitePad(lot: number): ConstructionPad | null {
    const L = this.lots[lot];
    if (!L) return null;
    const st = this.state(L);
    if (st.building === '' || lotBuilt(st)) return null;
    const pad = this.armPad(L, st.building as CityBuildingId);
    if (!pad.visible) pad.show(true);
    return pad;
  }

  // ---- frame update ------------------------------------------------------------------------------------------
  update(dt: number): void {
    if (!this.active && this.playerNear()) this.activate();
    this.life?.update(dt);
    for (let i = 0; i < PER_FRAME && this.queue.length > 0; i++) this.ensureModel(this.queue.shift()!, true);
    const t = this.ctx.time.elapsed;
    const player = this.ctx.player?.position;
    for (const L of this.lots) {
      L.lotPad?.update(dt);
      if (L.sign?.visible) {
        faceCameraUpright(L.sign, this.ctx.camera);
        fadeManageSign(L.sign, player);
      }
      L.model?.animate(t);
    }
  }

  private playerNear(): boolean {
    const p = this.ctx.player?.position;
    if (!p) return false;
    const r = this.inflated;
    return p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;
  }

  /** Create the pads and zones (first time the player comes near, or at once for debug / pad lookups). */
  activate(): void {
    if (this.active) return;
    this.active = true;
    for (const L of this.lots) {
      const f = L.frame;
      L.zone = this.ctx.zones.add({
        id: `${this.key(L)}:zone`,
        area: f.zone,
        enabled: false,
        onEnter: () => this.enter(L),
        onExit: () => this.leave(L),
      });
      L.lotPad = new LotPad(this.ctx, f.pad.x, f.pad.z, f.padSize);
      this.root.add(L.lotPad.object);
      L.sign = createManageSign('');
      const foot = manageSignFoot(f.zone, f);
      L.sign.position.set(foot.x, 0, foot.z);
      L.sign.visible = false;
      this.root.add(L.sign);
      this.refresh(L, false);
    }
  }

  // ---- state → world ---------------------------------------------------------------------------------------
  /** Bring one lot's pad / zone / scaffold / model in line with its state. */
  private refresh(L: Lot, animate: boolean): void {
    const st = this.state(L);
    const built = lotBuilt(st);
    const chosen = st.building !== '' && !built;
    if (this.active) {
      if (chosen) {
        const pad = this.armPad(L, st.building as CityBuildingId);
        if (!pad.visible) pad.show(!animate);
      } else {
        L.pad?.hide();
      }
      if (st.building === '') L.lotPad?.show(!animate);
      else L.lotPad?.hide();
      if (L.sign) {
        L.sign.visible = built;
        if (built) setManageSignName(L.sign, CITY_BUILDINGS[st.building as CityBuildingId].label);
      }
      const on = built || lotOpen(st);
      if (L.zone && L.zone.enabled !== on) {
        // a player already standing on the tile must not get the card the moment it re-enables
        if (on && this.ctx.zones.isPlayerIn(L.zone.area)) L.zone.playerInside = true;
        L.zone.setEnabled(on);
      }
    }
    // scaffold while a building is being paid
    const frac = chosen ? paidFraction(st) : 0;
    if (chosen && frac > 0) {
      if (!L.scaffold) {
        const def = CITY_BUILDINGS[st.building as CityBuildingId];
        L.scaffold = createCityScaffold(L.frame.w, L.frame.d, era(this.n).colors.ground, Math.min(6, Math.min(lotHeightCap(this.n, L.index), visualHeight(def.height)) * 0.7));
        L.group.add(L.scaffold.group);
      }
      L.scaffold.setProgress(frac);
    } else if (L.scaffold) {
      L.group.remove(L.scaffold.group);
      disposeScaffold(L.scaffold.group);
      L.scaffold = null;
    }
  }

  private armPad(L: Lot, id: CityBuildingId): ConstructionPad {
    const st = this.state(L);
    const def = CITY_BUILDINGS[id];
    const target = { label: def.label.toUpperCase(), icon: 'building' as const, logs: 0, cash: def.cash, paidLogs: 0, paidCash: st.cash, extra: { kind: def.extra.kind, count: def.extra.count, paid: st.extra } };
    if (L.pad) {
      // 1.0: only a new choice re-arms. Every payment reports its progress (refresh → here) while the item is still
      // flying, and re-arming then would drop the pad's in-flight count and credit that item twice on landing.
      if (L.padFor !== id) {
        L.pad.rearm(target);
        L.padFor = id;
      }
      return L.pad;
    }
    const pad = new ConstructionPad(this.ctx, {
      ...target,
      key: this.key(L),
      x: L.frame.pad.x,
      z: L.frame.pad.z,
      size: L.frame.padSize,
      onProgress: (_logs, cash, extra) => {
        const s = this.state(L);
        s.cash = cash;
        s.extra = extra;
        this.refresh(L, true);
      },
      onComplete: () => this.complete(L, false),
    });
    L.pad = pad;
    L.padFor = id;
    return pad;
  }

  /** The model of a built lot (created on demand). */
  private ensureModel(L: Lot, instant: boolean): void {
    const st = this.state(L);
    if (L.model || !lotBuilt(st)) return;
    const f = L.frame;
    const seed = this.n * 7 + L.index * 3;
    const model = createCityBuilding(st.building, seed, { w: f.w, d: f.d, maxH: lotHeightCap(this.n, L.index) });
    L.model = model;
    L.group.add(model.root);
    this.ctx.occlusion?.addOccluder(model.root); // 0.9.3: fades when it hides the player or a pad
    if (!instant && this.root.visible) {
      this.ctx.tweens.popIn(model.root, { duration: 0.6 });
      this.ctx.particles.puff(this.tmp.set(f.x, 0.4, f.z), { color: 0xffffff, count: 12, size: 1.6, life: 1.0 });
    }
  }

  private addCollider(L: Lot): void {
    const st = this.state(L);
    if (L.collider || CITY_BUILDINGS[st.building as CityBuildingId]?.kind === 'park') return;
    const r = L.frame.rect;
    L.collider = this.ctx.colliders.addBox({ minX: r.minX + 0.1, maxX: r.maxX - 0.1, minZ: r.minZ + 0.1, maxZ: r.maxZ - 0.1 }, this.key(L));
  }

  // ---- the cards --------------------------------------------------------------------------------------------
  private enter(L: Lot): void {
    const ctx = this.ctx;
    const st = this.state(L);
    if (lotBuilt(st)) {
      L.card = 'manage';
      ctx.events.emit('manage:open', this.manageRequest(L));
    } else if (lotOpen(st)) {
      L.card = 'choose';
      ctx.events.emit('choose:open', {
        key: this.key(L),
        title: `${districtDef(this.n).name}: lot ${L.index + 1}`,
        options: this.options(L),
        onChoose: (id) => this.choose(L.index, id as CityBuildingId),
      });
    }
  }

  private leave(L: Lot): void {
    if (L.card === 'manage') this.ctx.events.emit('manage:close', { key: this.key(L) });
    else if (L.card === 'choose') this.ctx.events.emit('choose:close', { key: this.key(L) });
    L.card = null;
  }

  private options(L: Lot): ChooseOption[] {
    return chooseOptions(this.ctx.state.city, this.n, L.index).map(({ id, def, locked }) => ({
      id,
      label: def.label,
      blurb: `${def.blurb}.`,
      stat: statLine(def),
      costText: costText(def),
      ...(locked ? { locked } : {}),
    }));
  }

  private manageRequest(L: Lot) {
    const ctx = this.ctx;
    const st = this.state(L);
    const def = CITY_BUILDINGS[st.building as CityBuildingId];
    // what City pays: the decor happiness perk, Renown and Mastery included (core/demand.ts, settlement 6..50)
    const t = settledCityTotals(ctx.state);
    const k = (1 + CITY_HAPPINESS_BONUS * t.happiness) * ctx.upgrades.value('taxOffice') * climbMult(ctx.state);
    const rows: { label: string; value: string }[] = [{ label: 'District', value: `${districtDef(this.n).name} (${ERA_NAMES[this.n]})` }];
    if (def.kind === 'home') {
      rows.push({ label: 'Residents', value: String(def.people) }, { label: 'Rent', value: `$${fmt(def.income * k)}/s` });
    } else if (def.kind === 'park') {
      rows.push({ label: 'Happiness', value: `+${Math.round(def.happiness * 100)}%` });
    } else {
      rows.push({ label: 'Jobs', value: String(def.jobs) }, { label: 'Income', value: `$${fmt(def.income * employment(t.residents, t.jobs) * k)}/s` });
      if (def.happiness > 0) rows.push({ label: 'Happiness', value: `+${Math.round(def.happiness * 100)}%` });
    }
    rows.push({ label: 'City happiness', value: `${Math.round(t.happiness * 100)}%` });
    return {
      key: this.key(L),
      title: def.label,
      subtitle: `${def.kind[0]!.toUpperCase()}${def.kind.slice(1)} · lot ${L.index + 1}`,
      icon: undefined,
      stats: rows,
      demolishCost: demolishCost(def),
      onDemolish: () => this.demolish(L.index),
    };
  }

  // ---- actions ---------------------------------------------------------------------------------------------
  /** Choose building `id` for an empty lot (only while nothing is paid). Arms the construction pad. */
  choose(lot: number, id: CityBuildingId): boolean {
    const L = this.lots[lot];
    if (!L || !canChoose(this.ctx.state, this.n, lot, id)) return false;
    this.activate();
    this.state(L).building = id;
    this.refresh(L, true);
    this.ctx.audio.play('pop', { volume: 0.7, pitch: 1.2 });
    return true;
  }

  /** The building is paid (pad) or debug-built: tier 0, model, collider, events. */
  private complete(L: Lot, instant: boolean): void {
    const ctx = this.ctx;
    const st = this.state(L);
    if (st.building === '' || L.model) return;
    const id = st.building;
    st.tier = 0;
    st.cash = 0;
    st.extra = 0;
    ctx.state.stats.cityBuilt++;
    L.pad?.hide();
    L.padFor = '';
    this.addCollider(L);
    this.ensureModel(L, instant);
    this.refresh(L, !instant);
    const position = new THREE.Vector3(L.frame.x, 0, L.frame.z);
    if (!instant) ctx.events.emit('built', { what: `city:${id}`, position, object: L.group });
    ctx.events.emit('city:built', { era: this.n, lot: L.index, building: id, position: position.clone(), object: L.group });
    this.onChange();
  }

  /** Debug / tests: choose + finish lot `lot` as `id` at once. False when the lot is built or `id` is not allowed. */
  debugBuild(lot: number, id: CityBuildingId, instant = true): boolean {
    const L = this.lots[lot];
    if (!L || lotBuilt(this.state(L))) return false;
    const st = this.state(L);
    // a debug build may replace a half-paid choice, but never breaks the one-landmark rule
    st.building = '';
    st.cash = 0;
    st.extra = 0;
    if (!canChoose(this.ctx.state, this.n, lot, id)) return false;
    st.building = id;
    this.complete(L, instant);
    return true;
  }

  /** Pay the demolish price, clear the lot, make it empty again. False (nothing changes) when it can't be done. */
  demolish(lot: number): boolean {
    const L = this.lots[lot];
    if (!L) return false;
    const st = this.state(L);
    if (!lotBuilt(st)) return false;
    const def = CITY_BUILDINGS[st.building as CityBuildingId];
    if (!this.ctx.economy.spend(demolishCost(def))) return false;
    const id = demolishLot(this.ctx.state, this.n, lot);
    if (L.model) {
      this.ctx.occlusion?.removeOccluder(L.model.root);
      L.group.remove(L.model.root);
      L.model = null;
    }
    if (L.collider) {
      this.ctx.colliders.remove(L.collider);
      L.collider = null;
    }
    this.ctx.particles.puff(this.tmp.set(L.frame.x, 0.6, L.frame.z), { color: 0xd8d8d8, count: 14, size: 2.0, life: 1.1 });
    this.refresh(L, true);
    // the lot's one zone stays on (empty lots are open), so a player still on the tile gets the choose card now
    if (L.card === 'manage' && L.zone?.playerInside) this.enter(L);
    const position = new THREE.Vector3(L.frame.x, 0, L.frame.z);
    if (id !== '') this.ctx.events.emit('city:demolished', { era: this.n, lot, building: id, position });
    this.onChange();
    return true;
  }

  /** Reset a lot's runtime and state to empty without cost (tests). */
  reset(lot: number): void {
    const L = this.lots[lot];
    if (!L) return;
    Object.assign(this.state(L), emptyLot());
    if (L.model) {
      this.ctx.occlusion?.removeOccluder(L.model.root);
      L.group.remove(L.model.root);
    }
    L.model = null;
    if (L.collider) this.ctx.colliders.remove(L.collider);
    L.collider = null;
    L.padFor = '';
    this.refresh(L, false);
  }
}

const fmt = (v: number): string => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1).replace(/\.0$/, ''));

/** "40 residents, $4/s rent" etc. for the choose card. */
function statLine(def: CityBuildingDef): string {
  // 0.9.6: say plainly which lots grow the settlement (only homes do), so a full district never soft-locks it by surprise
  if (def.kind === 'home') return `+${def.people} residents for your settlement, $${fmt(def.income)}/s rent`;
  if (def.kind === 'park') return `+${Math.round(def.happiness * 100)}% happiness, ${def.jobs} jobs · no residents`;
  const h = def.happiness > 0 ? `, +${Math.round(def.happiness * 100)}% happiness` : '';
  return `${def.jobs} jobs, $${fmt(def.income)}/s${h} · no residents`;
}

/** The refined material a district's buildings are made of (for hints). */
export const districtMaterial = (n: number): string => String(DISTRICT_MATERIAL[n] ?? '');

// ---------------------------------------------------------------------------
// scenery: pavement + lamps
// ---------------------------------------------------------------------------

/** One group: the era-styled pavement (one merged mesh), the street lamps (one mesh), their bulbs and night halos, the street furniture (one mesh). */
function buildScenery(n: number): THREE.Group {
  const S = SURFACE[n]!;
  const def = districtDef(n);
  const r = def.rect;
  const inner = districtInner(n);
  const group = new THREE.Group();
  group.name = 'scenery';
  const box = geo.boxBase(1, 1, 1);
  const ground = new Batch();
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  ground.add(box, S.street, cx, 0, cz, { sx: r.maxX - r.minX, sy: 0.08, sz: r.maxZ - r.minZ });
  // sidewalk ring (curb + walk) around the district
  const ringW = inner.minX - r.minX;
  ground.add(box, S.walk, cx, 0, r.minZ + ringW / 2, { sx: r.maxX - r.minX, sy: 0.12, sz: ringW });
  ground.add(box, S.walk, cx, 0, r.maxZ - ringW / 2, { sx: r.maxX - r.minX, sy: 0.12, sz: ringW });
  ground.add(box, S.walk, r.minX + ringW / 2, 0, cz, { sx: ringW, sy: 0.12, sz: r.maxZ - r.minZ });
  ground.add(box, S.walk, r.maxX - ringW / 2, 0, cz, { sx: ringW, sy: 0.12, sz: r.maxZ - r.minZ });
  const trim = new THREE.Color(S.walk).multiplyScalar(0.8).getHex();
  ground.add(box, trim, cx, 0, r.minZ + 0.06, { sx: r.maxX - r.minX, sy: 0.16, sz: 0.12 });
  ground.add(box, trim, cx, 0, r.maxZ - 0.06, { sx: r.maxX - r.minX, sy: 0.16, sz: 0.12 });
  ground.add(box, trim, r.minX + 0.06, 0, cz, { sx: 0.12, sy: 0.16, sz: r.maxZ - r.minZ });
  ground.add(box, trim, r.maxX - 0.06, 0, cz, { sx: 0.12, sy: 0.16, sz: r.maxZ - r.minZ });
  let s = 0x9e3779b1 ^ (n * 7919);
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (const f of districtLots(n)) {
    // the lot's plot, the lane in front of it (with paving tiles) and a snow drift behind the building
    ground.add(box, S.plot, f.x, 0, f.z, { sx: f.w + 0.8, sy: 0.12, sz: f.d + 0.8 });
    const lane = { minX: f.cell.minX + 0.1, maxX: f.cell.maxX - 0.1, minZ: f.rect.maxZ + 0.35, maxZ: f.cell.maxZ };
    ground.add(box, S.walk, (lane.minX + lane.maxX) / 2, 0, (lane.minZ + lane.maxZ) / 2, { sx: lane.maxX - lane.minX, sy: 0.1, sz: lane.maxZ - lane.minZ });
    const ts = S.tileSize;
    for (let x = lane.minX + ts / 2; x < lane.maxX; x += ts) {
      for (let z = lane.minZ + ts / 2; z < lane.maxZ; z += ts) {
        if (((Math.round((x - lane.minX) / ts) + Math.round((z - lane.minZ) / ts)) & 1) === 0) continue;
        ground.add(box, S.tile, x, 0.1, z, { sx: ts * 0.94, sy: 0.02, sz: ts * 0.94 });
      }
    }
    for (let i = 0; i < 2; i++) {
      const sx = f.cell.minX + 0.6 + rnd() * (f.cell.maxX - f.cell.minX - 1.2);
      const sz = f.cell.minZ + 0.4 + rnd() * Math.max(0.2, f.rect.minZ - f.cell.minZ - 0.6);
      ground.add(geo.sphere(1, 8, 5), SNOW, sx, 0.05, sz, { sx: 0.8 + rnd() * 0.5, sy: 0.3, sz: 0.7 + rnd() * 0.4 });
    }
  }
  const gm = ground.mesh({ cast: false, receive: true });
  gm.name = 'pavement';
  group.add(gm);

  // lamps along the perimeter: ~every 7 m, none on the corners
  const spots: HaloSpot[] = [];
  const poles = new Batch();
  const bulbs = new Batch();
  const lampAt = (x: number, z: number, side: 'n' | 's' | 'e' | 'w'): void => {
    const h = 3.3;
    poles.add(geo.cylinder(0.7, 1, 1, 6), S.pole, x, h / 2, z, { sx: 0.1, sy: h, sz: 0.1 });
    poles.add(box, S.pole, x, 0, z, { sx: 0.34, sy: 0.25, sz: 0.34 });
    // an arm leaning over the street
    const ax = side === 'e' ? -0.35 : side === 'w' ? 0.35 : 0;
    const az = side === 's' ? -0.35 : side === 'n' ? 0.35 : 0;
    poles.add(box, S.pole, x + ax / 2, h - 0.08, z + az / 2, { sx: Math.abs(ax) + 0.08, sy: 0.07, sz: Math.abs(az) + 0.08 });
    bulbs.add(geo.sphere(1, 8, 6), S.bulb, x + ax, h - 0.2, z + az, { sx: 0.2, sy: 0.24, sz: 0.2 });
    spots.push({ x: x + ax, y: h - 0.2, z: z + az, size: 2.0, pool: 4.6 });
  };
  for (const l of districtLamps(n)) lampAt(l.x, l.z, l.side);
  const pm = poles.mesh({ cast: true });
  pm.name = 'lamps';
  group.add(pm);
  // street furniture (city/decor.ts): ONE solid mesh; its fairy lights ride in the lamps' bulb batch (no extra draw call)
  const furniture = new Batch();
  drawDecor(n, districtDecor(n), furniture, bulbs, S.bulb);
  const fm = furniture.mesh({ cast: true, receive: true });
  fm.name = 'street-furniture';
  group.add(fm);
  const bm = new THREE.Mesh(bulbs.geometry(), bulbMaterial());
  bm.name = 'lamp-bulbs';
  bm.castShadow = false;
  bm.receiveShadow = false;
  group.add(bm);
  group.add(buildHalos(spots, { size: 2.0, pool: 4.6 }));
  return group;
}
