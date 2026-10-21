/**
 * [eras] One UNLOCKED era region at runtime (implements RegionRuntime). Owns everything inside the region's fence:
 *
 * - Front yard (eras/layout.ts): the export depot (ExportDepot + model + a 'give' zone: materials in the player's
 *   arms are sold), the import dock (a Pile of up to 24 materials + model; a 'give' zone on its left half and a hold-to-
 *   interact 'take' zone on its right half), Jack's swap cart and the era shop mat ('shop:open' {tab:'crew', era}: the era's own Crew and Industry tabs).
 * - Machine slots (layout.slots): an empty slot shows a BUILD tile (town/LotPad) whose zone emits 'choose:open';
 *   choosing a machine arms a ConstructionPad (cash + the machine's extra material, never logs) that persists its
 *   progress in SlotState and, once paid, becomes a Machine (eras/Machine.ts). While the first payment has not landed
 *   the choice can still be changed (the zone stays on). A built machine has an info zone: 'manage:open' with its stats
 *   and a demolish button (pay DEMOLISH_SHARE of its price, no refund; the slot becomes empty again).
 * - The era crew (EraCrew) and the market's physical orders (deliver()).
 * - 0.9.5: the market (eras/RegionMarket.ts) in the market zone: a loading dock for buyer trucks on the road and a market
 *   stall for walk-in shoppers, both paying into one cash pile.
 *
 * Construction is silent (a restored game builds every region instantly: no events, no sounds); the live path
 * (EraWorld.unlock) calls appear() for the pop-in. Slot state is the truth: every transition writes state first.
 */
import * as THREE from 'three';
import { PALETTE, PLAYER, TIMING, rect } from '../config';
import { createMatModel, createPadSign, createShopSign } from '../assets/pads';
import { createDepotModel, createDockModel } from '../assets/eraMachines';
import { createSurveyKit, KIT_CRATES } from '../assets/surveyKit';
import { vcMat } from '../render/batch';
import type { ColliderHandle } from '../world/Colliders';
import type { MaterialKind, GameContext, ItemKind } from '../core/types';
import type { WorldSnapshot } from '../core/Save';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';
import type { Zone } from '../items/Zones';
import { EraCrew } from '../npc/EraCrew';
import { JackCart } from '../npc/Jack';
import { ConstructionPad } from '../stations/ConstructionPad';
import { LotPad } from '../town/LotPad';
import { ERAS, MACHINES, MATERIAL_KINDS, machinesOfEra, type MachineId } from './data';
import { DepotFreight } from './DepotFreight';
import { ExportDepot } from './ExportDepot';
import { HandNode, handNodePlace } from './HandNode';
import { regionLayout, type RegionLayout, type XZ } from './layout';
import { EraBelts } from './EraBelts';
import { YardLinks } from './YardLinks';
import { EraLevelPad } from './LevelPad';
import { Machine } from './Machine';
import { RegionMarket } from './RegionMarket';
import type { RegionRuntime, SiteRuntime } from './runtime';
import { DEPOT_FRAME, DOCK_FRAME, LEVEL_PAD_SIZE, MAT_SIZE, chooseOptions, demolishCost, machineStatRows, slotKey, slotTarget, slotTitle, slotUntouched, toWorld, worldRect } from './rules';
import { motionScale } from '../fx/padJuice';

const SIGN_HEIGHT = 2.0;
/** 0.9.6 (F6): the "counters full" hint floats this high over the export depot … */
const FULL_SIGN_HEIGHT = 2.9;
/** … once both counters have been full this long (s), and hides once they have had room this long. */
const FULL_SHOW_AFTER = 1.0;
const FULL_HIDE_AFTER = 1.5;
/**
 * 0.9.13 (P5): the off-screen yard's step (s), what a 30 fps frame already gives every system. Four minutes of the full
 * late game sold the same number of goods with it as at 60 Hz (13,317 against 13,383 and 13,415: run-to-run noise).
 */
export const OFFSCREEN_STEP = 1 / 30;
/** Market orders drop in from this height above the dock. */
const DROP_HEIGHT = 7;

/** One machine slot's runtime. */
interface SlotSite {
  readonly index: number;
  readonly lotPad: LotPad;
  readonly zone: Zone;
  pad: ConstructionPad | null;
  /** Every pad built for the slot, one per extra kind (a pad's item zone keeps the kinds it was built with). */
  readonly pads: ConstructionPad[];
  machine: Machine | null;
}

const kitM = new THREE.Matrix4();
const kitZero = new THREE.Vector3(0, 0, 0);

export class Region implements RegionRuntime {
  readonly era: number;
  readonly layout: RegionLayout;
  readonly machines: (Machine | null)[];
  readonly depot: ExportDepot;
  /** Cosmetic crate loader + freight lift beside the depot. */
  private readonly freight: DepotFreight;
  readonly depotSpot: XZ;
  readonly dock: Pile;
  readonly dockSpot: XZ;
  /** Facility models, mat and signs hang under this group. */
  readonly root = new THREE.Group();
  readonly crew: EraCrew;
  readonly jack: JackCart;
  /** 0.9.5: the era's hand node (eras/HandNode.ts); null while the layout has no harvest area for it. */
  readonly node: HandNode | null;
  /** 0.9.5: conveyor belts between the machines (from Lv 1 of the era's Belts upgrade). */
  readonly belts: EraBelts;
  /** 0.9.12: overhead pipes, chutes and cables between neighbouring machines (visual only, eras/linkPlan.ts). */
  readonly links: YardLinks;
  /** 0.9.5: the sales counter and its buyer trucks (the depot hands goods to it first). */
  readonly market: RegionMarket;

  private readonly slots: SlotSite[] = [];
  /** 0.9.5: one level pad per machine type, beside the first built machine of that type (slot index). */
  private readonly levelPads = new Map<MachineId, { pad: EraLevelPad; slot: number }>();
  /** 0.9.13 (E10): the empty slots' survey kits (two mirrored variants, one instance per slot) and their crate colliders. */
  private readonly kits: THREE.InstancedMesh[];
  private readonly kitColliders: (ColliderHandle | null)[];
  private readonly sign: THREE.Mesh;
  /** 0.9.6 (F6): "COUNTERS FULL" over the export depot while it sells straight away at the plain depot price. */
  readonly fullSign: THREE.Mesh;
  private fullFor = 0;
  /** Simulated time the yard is still owed while off screen (update). */
  private owed = 0;
  private roomFor = 0;
  /** Facility objects that pop in on a live unlock. */
  private readonly pops: THREE.Object3D[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly ctx: GameContext,
    era: number,
  ) {
    const L = regionLayout(era);
    this.era = era;
    this.layout = L;
    this.root.name = `region:${era}`;
    ctx.scene.add(this.root);
    const yaw = L.facilityYaw;

    // ---- export depot -----------------------------------------------------------------------------------------
    this.depot = new ExportDepot(ctx, era, L.depot, yaw);
    this.addModel(createDepotModel(era), L.depot, yaw);
    ctx.colliders.addBox(worldRect(L.depot, yaw, DEPOT_FRAME.body), `era:${era}:depot`);
    this.freight = new DepotFreight(era, L, this.root);
    this.depot.onReceive = () => this.freight.push();
    this.depotSpot = toWorld(L.depot, yaw, DEPOT_FRAME.spot.u, DEPOT_FRAME.spot.v);
    ctx.zones.addTransfer({
      id: `depot:era${era}:give`,
      area: worldRect(L.depot, yaw, DEPOT_FRAME.give),
      from: ctx.player.arms,
      to: this.depot,
      kinds: MATERIAL_KINDS,
      interval: TIMING.dropInterval,
      marker: true,
    });

    // ---- market (0.9.5): loading dock + market stall in the market zone, buyers from the road --------------------
    this.market = new RegionMarket(ctx, era, L, this.root);
    this.pops.push(...this.market.models);
    this.depot.forward = (item) => this.market.forward(item);
    this.fullSign = createPadSign('COUNTERS FULL');
    this.fullSign.position.set(L.depot.x, FULL_SIGN_HEIGHT, L.depot.z);
    this.fullSign.visible = false;
    this.root.add(this.fullSign);

    // ---- import dock ------------------------------------------------------------------------------------------
    this.addModel(createDockModel(era), L.dock, yaw);
    ctx.colliders.addBox(worldRect(L.dock, yaw, DOCK_FRAME.body), `era:${era}:dock`);
    this.dock = new Pile(ctx, { id: `pile:era${era}Dock`, accepts: MATERIAL_KINDS, position: new THREE.Vector3(L.dock.x, DOCK_FRAME.palletY, L.dock.z), rotationY: yaw, grid: DOCK_FRAME.grid });
    this.dockSpot = toWorld(L.dock, yaw, DOCK_FRAME.spot.u, DOCK_FRAME.spot.v);
    ctx.zones.addTransfer({ id: `pile:era${era}Dock:give`, area: worldRect(L.dock, yaw, DOCK_FRAME.give), from: ctx.player.arms, to: this.dock, kinds: MATERIAL_KINDS, interval: TIMING.dropInterval, marker: true });
    ctx.zones.addTransfer({ id: `pile:era${era}Dock:take`, area: worldRect(L.dock, yaw, DOCK_FRAME.take), from: this.dock, to: ctx.player.arms, kinds: MATERIAL_KINDS, kind: 'take', interval: TIMING.pickupInterval, marker: true });

    // ---- era shop mat -----------------------------------------------------------------------------------------
    const mat = createMatModel(MAT_SIZE.w, MAT_SIZE.d);
    mat.position.set(L.shopMat.x, 0, L.shopMat.z);
    this.root.add(mat);
    this.pops.push(mat);
    this.sign = createShopSign();
    this.sign.position.set(L.shopMat.x, SIGN_HEIGHT, L.shopMat.z);
    this.root.add(this.sign);
    ctx.zones.add({
      id: `shop:mat:era${era}`,
      area: rect(L.shopMat.x, L.shopMat.z, MAT_SIZE.w, MAT_SIZE.d),
      onEnter: () => {
        this.sign.visible = false;
        ctx.audio.play('padStep', { volume: 0.7 });
        ctx.events.emit('shop:open', { tab: 'crew', era });
      },
      onExit: () => {
        this.sign.visible = true;
        ctx.events.emit('shop:close', {});
      },
    });

    // ---- Jack ---------------------------------------------------------------------------------------------------
    this.jack = new JackCart(ctx, L.jack, yaw, `jack:${era}`);

    // ---- hand node (0.9.5) ----------------------------------------------------------------------------------------
    const nodeAt = handNodePlace(L);
    this.node = nodeAt ? new HandNode(ctx, era, nodeAt, nodeAt.yaw, this.root) : null;
    if (this.node) this.pops.push(this.node.model.root);

    // ---- machine slots ------------------------------------------------------------------------------------------
    this.machines = L.slots.map(() => null);
    L.slots.forEach((place, i) => {
      const lotPad = new LotPad(ctx, place.x, place.z, L.padSize);
      this.root.add(lotPad.object);
      const zone = ctx.zones.add({
        id: `${slotKey(era, i)}:choose`,
        area: rect(place.x, place.z, L.padSize, L.padSize),
        enabled: false,
        onEnter: () => this.openChoose(i),
        onExit: () => ctx.events.emit('choose:close', { key: slotKey(era, i) }),
      });
      this.slots.push({ index: i, lotPad, zone, pad: null, pads: [], machine: null });
    });
    // 0.9.13 (E10): an empty slot shows a survey kit (stakes, a flag, crates), as instances of two mirrored variants
    this.kits = [false, true].map((mirror) => {
      const m = new THREE.InstancedMesh(createSurveyKit(era, mirror), vcMat(), Math.max(1, L.slots.length));
      m.name = `region${era}:surveyKits`;
      m.castShadow = false; // small and low: not worth a shadow-pass draw per region
      m.receiveShadow = true;
      m.count = L.slots.length;
      this.root.add(m);
      return m;
    });
    this.kitColliders = L.slots.map(() => null);
    this.belts = new EraBelts(ctx, this);
    for (const S of this.slots) this.refreshSlot(S, true);
    this.syncLevelPads(true);
    this.belts.sync(true);
    this.links = new YardLinks(this);
    this.links.sync();

    // ---- workers --------------------------------------------------------------------------------------------------
    this.crew = new EraCrew(ctx, this);
    this.crew.reconcile();
    const crewIds = new Set<string>(this.crew.ids);
    ctx.events.on('upgrade:bought', (e) => {
      if (crewIds.has(e.id)) this.crew.reconcile();
    });
  }

  /** Pop-in of the freshly opened region (live unlock only). */
  appear(): void {
    const ctx = this.ctx;
    const g = this.layout.gate;
    // the root sits at the world origin: pop each facility in about its own origin
    this.pops.forEach((o, i) => ctx.tweens.popIn(o, { duration: 0.6, delay: i * 0.1 }));
    ctx.particles.ring(this.tmp.set(g.x, 0.1, g.z), { color: PALETTE.accent, radius: 3.4, life: 0.8 });
    ctx.audio.play('whoosh', { volume: 0.5 });
  }

  /**
   * 0.9.13 (review P5): `inView` false (the region is nowhere near the camera, eras/EraWorld.ts) runs the region's own
   * yard (machines, pads, belts, crew, Jack, the depot) in steps of OFFSCREEN_STEP, the same step a 30 fps frame gives
   * it, so nothing behaves differently, it just costs half. The market (its buyer vehicles and walk-in
   * shoppers use the shared roads and verges, seen from other areas) always runs every frame. Coming back into view, the
   * time still owed is run first.
   */
  update(dt: number, inView = true): void {
    if (inView) {
      if (this.owed > 0) this.updateYard(this.owed);
      this.owed = 0;
      this.updateYard(dt);
    } else {
      this.owed += dt;
      while (this.owed >= OFFSCREEN_STEP) {
        this.owed -= OFFSCREEN_STEP;
        this.updateYard(OFFSCREEN_STEP);
      }
    }
    this.market.update(dt);
  }

  private updateYard(dt: number): void {
    const ctx = this.ctx;
    for (const S of this.slots) {
      S.lotPad.update(dt);
      S.machine?.update(dt);
    }
    for (const L of this.levelPads.values()) L.pad.update(dt);
    this.belts.update(dt);
    this.links.update(dt);
    if (this.sign.visible) {
      this.sign.quaternion.copy(ctx.camera.quaternion);
      this.sign.position.y = SIGN_HEIGHT + Math.sin(ctx.time.elapsed * 2) * 0.05 * motionScale();
    }
    this.node?.update(dt);
    this.crew.update(dt);
    this.jack.update(dt);
    this.freight.update(dt);
    this.updateFullSign(dt);
  }

  /**
   * 0.9.6 (F6): while both market counters stay full the depot sells at once for the plain depot price (no Fine bonus);
   * a small sign over the depot says so (a bigger Loading Dock / Market Stall, or fewer raw goods, clears it).
   */
  private updateFullSign(dt: number): void {
    const s = this.fullSign;
    if (this.market.countersFull()) {
      this.fullFor += dt;
      this.roomFor = 0;
    } else {
      this.roomFor += dt;
      this.fullFor = 0;
    }
    if (!s.visible && this.fullFor >= FULL_SHOW_AFTER) {
      s.visible = true;
      this.ctx.tweens.popIn(s, { duration: 0.3 });
    } else if (s.visible && this.roomFor >= FULL_HIDE_AFTER) {
      s.visible = false;
    }
    if (s.visible) {
      s.quaternion.copy(this.ctx.camera.quaternion);
      s.position.y = FULL_SIGN_HEIGHT + Math.sin(this.ctx.time.elapsed * 2) * 0.05 * motionScale();
    }
  }

  // ---- slots ----------------------------------------------------------------------------------------------------
  private state(i: number): { machine: MachineId | ''; tier: number; cash: number; extra: number } {
    return this.ctx.state.eras.regions[this.era]!.slots[i]!;
  }

  /** 0.9.13 (E10): slot `i`'s survey kit on (no machine standing yet) or off, with its crate stack's collider. */
  private showKit(i: number, on: boolean): void {
    const p = this.layout.slots[i]!;
    const kit = this.kits[i % 2]!;
    const other = this.kits[(i + 1) % 2]!;
    kitM.makeRotationY(p.yaw).setPosition(p.x, 0, p.z);
    if (!on) kitM.scale(kitZero);
    kit.setMatrixAt(i, kitM);
    other.setMatrixAt(i, kitM.makeScale(0, 0, 0));
    kit.instanceMatrix.needsUpdate = true;
    other.instanceMatrix.needsUpdate = true;
    kit.computeBoundingSphere();
    const cur = this.kitColliders[i];
    if (on && !cur) {
      const c = toWorld(p, p.yaw, (i % 2 ? -1 : 1) * KIT_CRATES.u, KIT_CRATES.v);
      this.kitColliders[i] = this.ctx.colliders.addBox(rect(c.x, c.z, KIT_CRATES.half * 2, KIT_CRATES.half * 2), `era:${this.era}:kit`);
    } else if (!on && cur) {
      this.ctx.colliders.remove(cur);
      this.kitColliders[i] = null;
    }
  }

  /** Slot centre as a world point (effects, events). */
  private slotPos(i: number): THREE.Vector3 {
    const p = this.layout.slots[i]!;
    return new THREE.Vector3(p.x, 0, p.z);
  }

  /** Show exactly what the slot's state says: BUILD tile, construction pad, or the machine. */
  private refreshSlot(S: SlotSite, instant: boolean): void {
    const st = this.state(S.index);
    this.showKit(S.index, st.tier < 0 || st.machine === '');
    if (st.machine === '') {
      S.pad?.hide();
      S.lotPad.show(instant);
      S.zone.setEnabled(true);
    } else if (st.tier < 0) {
      S.lotPad.hide();
      const pad = this.armPad(S, st.machine);
      if (!pad.visible) pad.show(instant);
      S.zone.setEnabled(slotUntouched(st));
    } else {
      S.lotPad.hide();
      S.pad?.hide();
      S.zone.setEnabled(false);
      if (!S.machine) this.makeMachine(S, instant);
    }
  }

  /**
   * The slot's construction pad for machine `id`: the slot's pad for the same extra material, re-armed, or a new one
   * (a pad cannot change the kinds its item zone pulls, so a different extra kind needs its own pad).
   */
  private armPad(S: SlotSite, id: MachineId): ConstructionPad {
    const st = this.state(S.index);
    const target = slotTarget(MACHINES[id], st.cash, st.extra);
    const kind = target.extra?.kind ?? null;
    if (S.pad && S.pad.extraKind !== kind) S.pad.hide();
    const reuse = S.pads.find((p) => p.extraKind === kind);
    if (reuse) {
      S.pad = reuse;
      reuse.rearm({ ...target, icon: 'machine' });
      return reuse;
    }
    const place = this.layout.slots[S.index]!;
    S.pad = new ConstructionPad(this.ctx, {
      ...target,
      icon: 'machine',
      key: slotKey(this.era, S.index),
      x: place.x,
      z: place.z,
      size: this.layout.padSize,
      onProgress: (_logs, cash, extra) => {
        const s = this.state(S.index);
        s.cash = cash;
        s.extra = extra;
        S.zone.setEnabled(slotUntouched(s));
      },
      onComplete: () => this.finishSlot(S, false),
    });
    S.pads.push(S.pad);
    return S.pad;
  }

  private makeMachine(S: SlotSite, instant: boolean): Machine {
    const st = this.state(S.index);
    const key = slotKey(this.era, S.index);
    const m = new Machine(this.ctx, this.era, S.index, MACHINES[st.machine as MachineId], this.layout.slots[S.index]!, { onManage: () => this.openManage(S), onManageExit: () => this.ctx.events.emit('manage:close', { key }) }, this.root);
    S.machine = m;
    this.machines[S.index] = m;
    m.appear(instant);
    return m;
  }

  /** Choose card of an empty slot. */
  private openChoose(i: number): void {
    const key = slotKey(this.era, i);
    this.ctx.events.emit('choose:open', { key, title: slotTitle(this.era, i), options: chooseOptions(this.era), onChoose: (id) => this.choose(i, id) });
  }

  /** Pick machine `id` for slot `i` (only while nothing is paid): arms the construction pad. */
  choose(i: number, id: string): boolean {
    const S = this.slots[i];
    if (!S || !machinesOfEra(this.era).includes(id as MachineId)) return false;
    const st = this.state(i);
    if (st.tier >= 0 && st.machine !== '') return false;
    if (st.machine !== '' && !slotUntouched(st)) return false;
    st.machine = id as MachineId;
    st.tier = -1;
    st.cash = 0;
    st.extra = 0;
    this.refreshSlot(S, false);
    this.ctx.audio.play('pop', { volume: 0.7, pitch: 1.2 });
    return true;
  }

  /** The slot is fully paid (or debugBuild): tier 0, the machine appears, 'built' (live) + 'machine:built'. */
  private finishSlot(S: SlotSite, instant: boolean): void {
    const st = this.state(S.index);
    if (st.machine === '' || S.machine) return;
    st.tier = 0;
    st.cash = 0;
    st.extra = 0;
    this.refreshSlot(S, instant);
    const m = S.machine!;
    this.stepAside(m);
    this.syncLevelPads(instant);
    this.belts.sync(instant);
    this.ctx.state.stats.machinesBuilt++;
    const position = this.slotPos(S.index);
    if (!instant) this.ctx.events.emit('built', { what: `machine:${m.def.id}`, position, object: m.group });
    this.ctx.events.emit('machine:built', { era: this.era, slot: S.index, machine: m.def.id, position, object: m.group });
  }

  /**
   * 0.9.6 (eras 1-4 finding 3): the player who just paid for the machine stands on its slot, inside the new collider.
   * Pushed out face by face, they slid through the neighbouring machines and over the fence (about 25 m); instead they
   * step to the new machine's feed spot, in front of it on the yard side.
   */
  private stepAside(m: Machine): void {
    const p = this.ctx.player?.position;
    if (!p) return;
    const r = PLAYER.radius;
    const b = m.body;
    if (p.x <= b.minX - r || p.x >= b.maxX + r || p.z <= b.minZ - r || p.z >= b.maxZ + r) return;
    p.x = m.feedSpot.x;
    p.z = m.feedSpot.z;
  }

  /**
   * Debug / tests: slot `slot` gets machine `id` fully built. A different machine already there is cleared first (free,
   * silent). False for a bad slot or a machine of another era.
   */
  debugBuild(slot: number, id: string, instant: boolean): boolean {
    const S = this.slots[slot];
    if (!S || !machinesOfEra(this.era).includes(id as MachineId)) return false;
    const st = this.state(slot);
    if (S.machine) {
      if (S.machine.def.id === id) return true;
      this.clearSlot(S, true);
    }
    st.machine = id as MachineId;
    st.tier = -1;
    st.cash = 0;
    st.extra = 0;
    this.finishSlot(S, instant);
    return true;
  }

  /**
   * 0.9.5: every machine type of the era that stands somewhere has exactly one level pad, beside its first built machine
   * (lowest slot). A demolished carrier hands the pad (and what was paid into it, state.padPaid) to the next one.
   */
  private syncLevelPads(instant: boolean): void {
    for (const id of machinesOfEra(this.era)) {
      const slot = this.machines.findIndex((m) => m?.def.id === id);
      const cur = this.levelPads.get(id);
      if (cur && cur.slot === slot) continue;
      if (cur) {
        cur.pad.dispose();
        this.levelPads.delete(id);
      }
      const m = slot >= 0 ? this.machines[slot] : null;
      if (!m) continue;
      const pad = new EraLevelPad(this.ctx, id, m.levelPadSpot(), LEVEL_PAD_SIZE, MACHINES[id].label.toUpperCase(), this.root, instant || !!cur);
      this.levelPads.set(id, { pad, slot });
    }
  }

  /** 0.9.5: slots the player started paying for that still want their extra material (era foremen). */
  sites(): SiteRuntime[] {
    const out: SiteRuntime[] = [];
    for (const S of this.slots) {
      const st = this.state(S.index);
      const pad = S.pad;
      // 0.9.9: from the moment a machine is chosen (it used to wait for the player's first coin, so builders stood idle)
      if (st.machine === '' || st.tier >= 0 || !pad || !pad.visible) continue;
      const kind = pad.extraKind;
      const room = pad.extraRoom;
      if (!kind || room <= 0) continue;
      out.push({ slot: S.index, kind, room, holder: pad, spot: this.siteSpot(S.index) });
    }
    return out;
  }

  /** 0.9.9: chosen, unbuilt slots whose pad still owes cash (the era foremen pay them). */
  payPads(): { slot: number; pad: ConstructionPad; total: number; spot: XZ }[] {
    const out: { slot: number; pad: ConstructionPad; total: number; spot: XZ }[] = [];
    for (const S of this.slots) {
      const st = this.state(S.index);
      const pad = S.pad;
      if (st.machine === '' || st.tier >= 0 || !pad || !pad.visible || pad.cashLeft <= 0) continue;
      out.push({ slot: S.index, pad, total: MACHINES[st.machine as MachineId].cash, spot: this.siteSpot(S.index) });
    }
    return out;
  }

  /** 0.9.12 (guide): every chosen, unbuilt slot with its construction pad on show (slot order). */
  chosenSites(): { slot: number; machine: MachineId; pad: ConstructionPad }[] {
    const out: { slot: number; machine: MachineId; pad: ConstructionPad }[] = [];
    for (const S of this.slots) {
      const st = this.state(S.index);
      if (st.machine === '' || st.tier >= 0 || !S.pad || !S.pad.visible) continue;
      out.push({ slot: S.index, machine: st.machine as MachineId, pad: S.pad });
    }
    return out;
  }

  /** Where a worker stands to unload into / pay slot `i`'s pad (beside the tile on the yard side, clear of it). */
  private siteSpot(i: number): XZ {
    const L = this.layout;
    const p = L.slots[i]!;
    return { x: p.x, z: p.z - L.inward * (L.padSize / 2 + 0.7) };
  }

  /** Debug / tests: the level pad of machine type `id`, if one stands. */
  levelPad(id: MachineId): EraLevelPad | null {
    return this.levelPads.get(id)?.pad ?? null;
  }

  // ---- manage / demolish ----------------------------------------------------------------------------------------
  private openManage(S: SlotSite): void {
    const m = S.machine;
    if (!m) return;
    const snap = m.snapshot();
    this.ctx.events.emit('manage:open', {
      key: slotKey(this.era, S.index),
      title: m.def.label,
      subtitle: `${ERAS[this.era]!.name} · ${m.def.blurb}`,
      stats: machineStatRows(m.def, m.rigs(), { input: snap.in, output: snap.out }, { shown: this.ctx.upgrades.shownLevel(m.def.id), boost: m.levelBoost() }),
      demolishCost: demolishCost(m.def),
      onDemolish: () => this.demolish(S),
    });
  }

  /** Pay the demolition price and clear the slot (false when poor / nothing built). */
  private demolish(S: SlotSite): boolean {
    const m = S.machine;
    if (!m) return false;
    if (!this.ctx.economy.spend(demolishCost(m.def))) return false;
    this.clearSlot(S, false);
    return true;
  }

  /** Dispose the machine and make the slot empty again (silent: no stats, no event, no effect). */
  private clearSlot(S: SlotSite, silent: boolean): void {
    const m = S.machine;
    if (!m) return;
    const ctx = this.ctx;
    const id = m.def.id;
    const position = this.slotPos(S.index);
    m.dispose();
    S.machine = null;
    this.machines[S.index] = null;
    const st = this.state(S.index);
    st.machine = '';
    st.tier = -1;
    st.cash = 0;
    st.extra = 0;
    ctx.events.emit('manage:close', { key: slotKey(this.era, S.index) });
    this.syncLevelPads(silent);
    this.belts.sync(silent);
    if (!silent) {
      ctx.state.stats.demolished++;
      ctx.particles.puff(this.tmp.set(position.x, 0.6, position.z), { color: 0xcfc6b8, count: 14, size: 1.8, life: 1.0 });
      ctx.events.emit('machine:demolished', { era: this.era, slot: S.index, machine: id, position });
    }
    this.refreshSlot(S, silent);
  }

  // ---- market orders ----------------------------------------------------------------------------------------------
  /**
   * The market bought `count` units of `kind` for this region: they drop onto the import dock (staggered flights; the
   * dock reserves every landing spot at once, so nothing races). What does not fit is refunded at its share of
   * `amount` (what the order cost, delivery and multipliers included). Returns how many were delivered.
   */
  deliver(kind: MaterialKind, count: number, amount: number): number {
    const ctx = this.ctx;
    const d = this.layout.dock;
    let ok = 0;
    for (let i = 0; i < count; i++) {
      this.tmp.set(d.x + (Math.random() - 0.5) * 1.2, DROP_HEIGHT, d.z + (Math.random() - 0.5) * 1.2);
      const item = launchNew(ctx, kind, this.tmp, this.dock, { duration: 0.35 + i * 0.06, arcHeight: 0.6 });
      if (!item) break;
      ok++;
    }
    const over = count - ok;
    if (over > 0) ctx.economy.add(Math.round((amount * over) / count), 0); // money back, not money earned
    return ok;
  }

  // ---- save -------------------------------------------------------------------------------------------------------
  /**
   * Machine piles by slot + the import dock (landed, in flight, what the workers carry, and materials still flying to
   * the depot or Jack: not sold yet, so they come back unsold).
   */
  snapshot(): WorldSnapshot['eras'][number] {
    const fl = this.ctx.flights;
    const dock: Partial<Record<ItemKind, number>> = {};
    const carried = this.crew.carried();
    this.belts.carried(carried);
    for (const k of MATERIAL_KINDS) {
      const n = this.dock.count(k) + fl.inFlightTo(this.dock, k) + fl.inFlightTo(this.depot, k) + fl.inFlightTo(this.jack.sink, k) + (carried[k] ?? 0);
      if (n > 0) dock[k] = n;
    }
    return { slots: this.slots.map((S) => (S.machine ? S.machine.snapshot() : { in: {}, out: 0 })), dock, market: this.market.snapshot() };
  }

  restore(e: WorldSnapshot['eras'][number]): void {
    // 0.9.6: a hopper saved before its machine's recipe changed (steel mill ore, chip fab wire, robot works steel …)
    // hands the inputs it no longer uses to the import dock, so an old save loses nothing
    const dockIn: Partial<Record<ItemKind, number>> = { ...e.dock };
    this.slots.forEach((S, i) => {
      const w = e.slots[i];
      if (!S.machine || !w) return;
      S.machine.restore(w);
      for (const [k, v] of Object.entries(w.in) as [ItemKind, number][]) {
        if (!S.machine.def.inputs.some((x) => x.kind === k) && (MATERIAL_KINDS as readonly string[]).includes(k)) dockIn[k] = (dockIn[k] ?? 0) + Math.max(0, Math.floor(v || 0));
      }
    });
    this.dock.clear();
    for (const k of MATERIAL_KINDS) {
      const n = Math.max(0, Math.floor(dockIn[k] ?? 0));
      if (n <= 0) continue;
      const before = this.dock.count(k);
      this.dock.fill(k, n);
      // workers' loads on top of a full dock: sold at the depot quote instead of lost
      const over = n - (this.dock.count(k) - before);
      if (over > 0) this.ctx.economy.add(Math.round(this.ctx.market.quote(k, 'sell') * over));
    }
    this.market.restore(e.market);
  }

  // ---- internals --------------------------------------------------------------------------------------------------
  private addModel(model: THREE.Object3D, at: XZ, yaw: number): void {
    model.position.set(at.x, 0, at.z);
    model.rotation.y = yaw;
    this.root.add(model);
    this.pops.push(model);
  }
}
