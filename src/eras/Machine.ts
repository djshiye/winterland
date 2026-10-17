/**
 * [eras] One BUILT machine on a region slot (eras/data.ts MACHINES[id]). Implements the MachineRuntime contract the
 * era workers read.
 *
 * - Model: assets/eraMachines.ts createMachineModel at the slot centre, turned by the slot's yaw (front toward the
 *   region's front yard). Solid footprint = the model's w × d (a collider box, removed on dispose).
 * - Piles (world, on the ground in front of the machine, rules.machineFrame): input hopper front-left (kinds of
 *   def.inputs, each capped at three cycles' worth / an even share of the pile), output pile front-right
 *   (def.output). Player zones: feed (arms → input, 'give'), take (output → arms, 'take': hold to interact) and a
 *   small info zone beside the body (hooks.onManage / onManageExit: Region opens the manage card).
 * - Cycle length = def.cycle ÷ the era's Rigs upgrade value ÷ the machine type's level (0.9.5, its level pad). Extractor: every cycle makes def.batch items while the
 *   output has room (the timer waits at a full cycle while it is full). Processor: starts when the hopper holds `per`
 *   of every input and the output has room for the batch; the inputs hop to the door and are swallowed (40 % of the
 *   cycle), then def.batch products hop out of the door onto the output pile.
 * - Every batch: stats.materialsMade += batch, 'material:made'. snapshot() counts items in flight toward the piles and
 *   the inputs of the running cycle, so a save mid-cycle loses nothing.
 */
import { faceCameraUpright, fadeManageSign, manageSignFoot } from '../fx/manageSign';
import * as THREE from 'three';
import { TIMING, type Rect } from '../config';
import { createMachineModel, type MachineModel } from '../assets/eraMachines';
import { createManageSign, disposeManageSign } from '../assets/pads';
import { smoothstep } from '../core/math';
import type { GameContext, Item, ItemKind } from '../core/types';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';
import type { Zone } from '../items/Zones';
import type { ColliderHandle } from '../world/Colliders';
import { ERAS, MACHINE_PILES, type MachineDef } from './data';
import type { SlotPlace, XZ } from './layout';
import type { MachineRuntime } from './runtime';
import { OUTPUT_CAPACITY, inputCap, levelPadLocal, machineFrame, toWorld, worldRect, type LRect, type MachineFrame } from './rules';

/** The MANAGE label over the info zone: big enough to read from the usual camera distance. */

/** Share of the cycle the inputs spend hopping to the door. */
const F_DOOR = 0.4;
/** Products hop out of the door with this arc. */
const HOP = { arcHeight: 0.9, scaleFrom: 0.5 };
/** Sound / sparkles only play this close to the player (squared metres). */
const NEAR2 = 20 * 20;

type State = 'idle' | 'busy' | 'blocked';

/** 0.9.8: seconds between stack puffs of a working machine, and how near the player it must be to puff. */
const PUFF_EVERY = 0.9;
const PUFF_RANGE = 40;

/** A machine pile: refuses kinds past their cap (hopper) and swallows late arrivals once the machine is gone. */
export class MachinePile extends Pile {
  /** Set by Machine.dispose(): items still flying in are released instead of landing in a detached pile. */
  dead = false;

  constructor(
    ctx: GameContext,
    opts: ConstructorParameters<typeof Pile>[1],
    private readonly cap?: (kind: ItemKind) => number,
  ) {
    super(ctx, opts);
  }

  override canAccept(kind: ItemKind): boolean {
    if (this.dead || !super.canAccept(kind)) return false;
    if (!this.cap) return true;
    return this.count(kind) + this.ctx.flights.inFlightTo(this, kind) < this.cap(kind);
  }

  override receive(item: Item, slot: Parameters<Pile['receive']>[1]): void {
    if (this.dead) {
      this.ctx.items.release(item);
      return;
    }
    super.receive(item, slot);
  }
}

export interface MachineHooks {
  /** The player stepped onto / off the info zone. */
  onManage(): void;
  onManageExit(): void;
}

export class Machine implements MachineRuntime {
  /** Model root's parent: at the slot centre, turned by the slot's yaw. */
  readonly group = new THREE.Group();
  readonly model: MachineModel;
  readonly frame: MachineFrame;
  readonly input: MachinePile | null;
  readonly output: MachinePile;
  readonly feedSpot: XZ;
  /** 0.9.6: world rect of the machine's solid body (its collider). */
  readonly body: Rect;
  readonly takeSpot: XZ;

  private state: State = 'idle';
  private t = 0;
  private cycle = 1;
  private owed = 0;
  private cur: Item[] = [];
  private readonly start: THREE.Vector3[] = [];
  private readonly proc: Partial<Record<ItemKind, number>> = {};
  private readonly door = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly zones: Zone[] = [];
  private readonly collider: ColliderHandle;
  /** The "MANAGE" board on its post beside the info zone (the info / demolish card opens there). */
  private readonly sign: THREE.Mesh;
  private dead = false;
  /** Seconds until the next stack puff (0.9.8). */
  private puffT = Math.random() * PUFF_EVERY;
  private readonly unfade: (() => void) | null;

  constructor(
    private readonly ctx: GameContext,
    readonly era: number,
    readonly slot: number,
    readonly def: MachineDef,
    readonly place: SlotPlace,
    hooks: MachineHooks,
    parent?: THREE.Object3D,
  ) {
    const model = createMachineModel(def.id);
    const f = machineFrame(model.w, model.d);
    this.model = model;
    this.frame = f;
    this.group.name = `machine:${era}:${slot}:${def.id}`;
    this.group.position.set(place.x, 0, place.z);
    this.group.rotation.y = place.yaw;
    this.group.add(model.root);
    (parent ?? ctx.scene).add(this.group);

    const at = { x: place.x, z: place.z };
    const yaw = place.yaw;
    const w = (r: LRect) => worldRect(at, yaw, r);
    const dw = toWorld(at, yaw, f.door.u, f.door.v);
    this.door.set(dw.x, f.door.y, dw.z);
    this.feedSpot = toWorld(at, yaw, f.feedSpot.u, f.feedSpot.v);
    this.takeSpot = toWorld(at, yaw, f.takeSpot.u, f.takeSpot.v);
    this.body = w(f.body);
    this.collider = ctx.colliders.addBox(this.body, `era:${era}:${slot}`);

    const id = `pile:era${era}m${slot}`;
    const outPos = toWorld(at, yaw, f.outPile.u, f.outPile.v);
    this.output = new MachinePile(ctx, { id: `${id}Out`, accepts: [def.output], position: new THREE.Vector3(outPos.x, 0, outPos.z), rotationY: yaw, grid: MACHINE_PILES.out });
    this.zones.push(
      ctx.zones.addTransfer({
        id: `${id}Out:take`,
        area: w(f.take),
        from: this.output,
        to: ctx.player.arms,
        kinds: [def.output],
        kind: 'take',
        interval: TIMING.pickupInterval,
        marker: true,
      }),
    );
    if (def.inputs.length > 0) {
      const kinds = def.inputs.map((i) => i.kind);
      const inPos = toWorld(at, yaw, f.inPile.u, f.inPile.v);
      this.input = new MachinePile(ctx, { id: `${id}In`, accepts: kinds, position: new THREE.Vector3(inPos.x, 0, inPos.z), rotationY: yaw, grid: MACHINE_PILES.in }, (k) => this.cap(k));
      this.zones.push(
        ctx.zones.addTransfer({
          id: `${id}In:feed`,
          area: w(f.feed),
          from: ctx.player.arms,
          to: this.input,
          kinds,
          interval: TIMING.dropInterval,
          marker: true,
        }),
      );
    } else {
      this.input = null;
    }
    const manage = w(f.manage);
    this.zones.push(ctx.zones.add({ id: `${id}:manage`, area: manage, marker: true, onEnter: hooks.onManage, onExit: hooks.onManageExit }));
    this.sign = createManageSign(def.label);
    const foot = manageSignFoot(manage, place);
    this.sign.position.set(foot.x, 0, foot.z);
    (parent ?? ctx.scene).add(this.sign);
    // 0.9.5: fades when it hides the player or its level pad (like the town and city buildings)
    this.unfade = ctx.occlusion?.addOccluder(model.root) ?? null;
  }

  /** Visible and running; not instant: pop-in + puff. */
  appear(instant: boolean): void {
    if (instant) return;
    const ctx = this.ctx;
    ctx.tweens.popIn(this.group, { duration: 0.5 });
    ctx.tweens.delay(0.55, () => {
      if (!this.dead) ctx.tweens.squash(this.model.root, 0.08, 0.4);
    });
    ctx.particles.puff(this.tmp.set(this.place.x, 0.4, this.place.z), { color: 0xffffff, count: 10, size: 1.4, life: 0.9 });
  }

  /** True while a cycle is running (extractor: while its output has room). */
  get working(): boolean {
    if (this.dead) return false;
    if (this.def.kind === 'extractor') return this.roomFor(this.def.batch);
    return this.state !== 'idle';
  }

  wants(kind: ItemKind): number {
    const inp = this.input;
    if (!inp || this.dead) return 0;
    const cap = this.cap(kind);
    if (cap <= 0) return 0;
    return Math.max(0, cap - inp.count(kind) - this.ctx.flights.inFlightTo(inp, kind));
  }

  /** 0.9.6 (F3): units of `kind` the hopper holds at most now (it grows with this machine type's level). */
  cap(kind: ItemKind): number {
    return inputCap(this.def, kind, this.ctx.upgrades.level(this.def.id));
  }

  /** Cycle length in seconds right now (def.cycle ÷ the era's Rigs value ÷ this machine type's level, 0.9.5). */
  cycleTime(): number {
    return Math.max(0.3, this.def.cycle / (this.rigs() * this.levelBoost()));
  }

  /** 0.9.5: speed factor of this machine type's level (UPGRADES[def.id], bought on its level pad; ×1 at LV 1). */
  levelBoost(): number {
    return Math.max(1, this.ctx.upgrades.value(this.def.id));
  }

  /** World centre of this machine's level pad spot (eras/rules.ts levelPadLocal). */
  levelPadSpot(): XZ {
    const l = levelPadLocal(this.model.w, this.model.d);
    return toWorld({ x: this.place.x, z: this.place.z }, this.place.yaw, l.u, l.v);
  }

  /** Upgrade value of the era's Rigs (for the info card). */
  rigs(): number {
    return Math.max(0.25, this.ctx.upgrades.value(`${ERAS[this.era]!.key}Rigs`));
  }

  update(dt: number): void {
    if (this.dead) return;
    const cyc = this.cycleTime();
    if (this.def.kind === 'extractor') this.updateExtractor(dt, cyc);
    else this.updateProcessor(dt, cyc);
    this.model.animate(dt, this.working);
    this.puffVents(dt);
    faceCameraUpright(this.sign, this.ctx.camera);
    fadeManageSign(this.sign, this.ctx.player?.position);
  }

  /**
   * 0.9.8: soft steam / smoke puffs from the model's stack tops while it works, only near the player (the shared puff
   * pool stays free for everything else) and comfort-scaled by the particle system.
   */
  private puffVents(dt: number): void {
    const vents = this.model.vents;
    if (!vents || vents.length === 0 || !this.working) return;
    this.puffT -= dt;
    if (this.puffT > 0) return;
    this.puffT = PUFF_EVERY * (0.8 + Math.random() * 0.4);
    const p = this.ctx.player?.position;
    if (!p || (p.x - this.place.x) ** 2 + (p.z - this.place.z) ** 2 > PUFF_RANGE * PUFF_RANGE) return;
    const v = vents[(Math.random() * vents.length) | 0]!;
    const c = Math.cos(this.place.yaw);
    const s = Math.sin(this.place.yaw);
    this.tmp.set(this.place.x + v[0] * c + v[2] * s, v[1], this.place.z - v[0] * s + v[2] * c);
    this.ctx.particles.puff(this.tmp, { color: this.model.ventColor ?? 0xf2ece6, count: 1, size: 0.6, life: 1.5 });
  }

  // ---- save -------------------------------------------------------------------------------------------------
  /** Hopper contents by kind (landed + in flight + taken for the running cycle) and the output count (landed + in flight). */
  snapshot(): { in: Partial<Record<ItemKind, number>>; out: number } {
    const fl = this.ctx.flights;
    const inn: Partial<Record<ItemKind, number>> = {};
    if (this.input) for (const i of this.def.inputs) inn[i.kind] = this.input.count(i.kind) + fl.inFlightTo(this.input, i.kind) + (this.proc[i.kind] ?? 0);
    const kind = this.def.output;
    return { in: inn, out: this.output.count(kind) + fl.inFlightTo(this.output, kind) };
  }

  /**
   * A processor saved mid-cycle with a full hopper holds up to one cycle's inputs over the cap (snapshot counts `proc`):
   * when every input is within [per, cap + per] and one is over its cap, that cycle resumes (inputs already swallowed).
   */
  restore(w: { in: Partial<Record<ItemKind, number>>; out: number }): void {
    if (this.input) {
      this.input.clear();
      const n = (k: ItemKind) => Math.max(0, Math.floor(w.in[k] ?? 0));
      const ins = this.def.inputs;
      const resume = this.def.kind === 'processor' && ins.some((i) => n(i.kind) > this.cap(i.kind)) && ins.every((i) => n(i.kind) >= i.per && n(i.kind) <= this.cap(i.kind) + i.per);
      for (const i of ins) this.input.fill(i.kind, Math.min(this.cap(i.kind), n(i.kind) - (resume ? i.per : 0)));
      if (resume) {
        for (const k of Object.keys(this.proc) as ItemKind[]) delete this.proc[k];
        for (const i of ins) this.proc[i.kind] = i.per;
        this.swallowInputs();
        this.cycle = this.cycleTime();
        this.state = 'busy';
        this.t = 0;
      }
    }
    this.output.clear();
    this.output.fill(this.def.output, Math.min(OUTPUT_CAPACITY, Math.max(0, Math.floor(w.out || 0))));
  }

  /** Remove everything: zones, collider, piles (items back to the pool), model. */
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    const ctx = this.ctx;
    for (const z of this.zones) ctx.zones.remove(z);
    this.zones.length = 0;
    ctx.colliders.remove(this.collider);
    for (const item of this.cur) {
      ctx.tweens.killTweensOf(item.object);
      ctx.items.release(item);
    }
    this.cur.length = 0;
    if (this.input) {
      this.input.dead = true;
      this.input.dispose();
    }
    this.output.dead = true;
    this.output.dispose();
    ctx.tweens.killTweensOf(this.group);
    this.unfade?.();
    this.group.removeFromParent();
    this.sign.removeFromParent();
    disposeManageSign(this.sign);
  }

  // ---- cycle ------------------------------------------------------------------------------------------------
  private roomFor(n: number): boolean {
    return OUTPUT_CAPACITY - this.output.total >= n;
  }

  private updateExtractor(dt: number, cyc: number): void {
    if (!this.roomFor(this.def.batch)) {
      this.t = Math.min(this.t, cyc);
      return;
    }
    this.t += dt;
    if (this.t < cyc) return;
    if (this.popBatch(this.def.batch) > 0) this.t = Math.max(0, this.t - cyc);
    else this.t = cyc;
  }

  private canStart(): boolean {
    const inp = this.input;
    if (!inp) return false;
    for (const i of this.def.inputs) if (inp.count(i.kind) < i.per) return false;
    return this.roomFor(this.def.batch);
  }

  private startCycle(cyc: number): void {
    const inp = this.input!;
    this.cur.length = 0;
    this.start.length = 0;
    for (const k of Object.keys(this.proc) as ItemKind[]) delete this.proc[k];
    for (const i of this.def.inputs) {
      for (let n = 0; n < i.per; n++) {
        const item = inp.take(i.kind);
        if (!item) continue;
        this.cur.push(item);
        this.start.push(item.object.position.clone());
        this.proc[i.kind] = (this.proc[i.kind] ?? 0) + 1;
      }
    }
    this.cycle = cyc;
    this.state = 'busy';
    this.t = 0;
  }

  private updateProcessor(dt: number, cyc: number): void {
    if (this.state === 'idle') {
      if (this.canStart()) this.startCycle(cyc);
      return;
    }
    this.t += dt;
    const tDoor = F_DOOR * this.cycle;
    if (this.cur.length > 0) {
      if (this.t < tDoor) {
        const k = smoothstep(0, tDoor, this.t);
        for (let i = 0; i < this.cur.length; i++) {
          const o = this.cur[i]!.object;
          o.position.lerpVectors(this.start[i]!, this.door, k);
          o.position.y += Math.sin(k * Math.PI) * 0.5;
          o.scale.setScalar(1 - 0.7 * k);
        }
      } else {
        this.swallowInputs();
      }
    }
    if (this.state === 'busy' && this.t >= this.cycle) {
      this.swallowInputs();
      this.owed = this.def.batch;
      this.state = 'blocked';
    }
    if (this.state === 'blocked') {
      const made = this.popBatch(this.owed);
      this.owed -= made;
      if (made > 0) for (const k of Object.keys(this.proc) as ItemKind[]) delete this.proc[k];
      if (this.owed <= 0) {
        const over = Math.max(0, this.t - this.cycle);
        this.state = 'idle';
        if (this.canStart()) {
          this.startCycle(cyc);
          this.t = Math.min(over, cyc * 0.5);
        }
      }
    }
  }

  private swallowInputs(): void {
    if (this.cur.length === 0) return;
    for (const item of this.cur) {
      this.ctx.tweens.killTweensOf(item.object);
      this.ctx.items.release(item);
    }
    this.cur.length = 0;
    this.ctx.tweens.punchScale(this.model.root, 0.03, 0.15);
  }

  /** Up to `n` products hop out of the door onto the output pile; bookkeeping for the ones that did. */
  private popBatch(n: number): number {
    const ctx = this.ctx;
    const kind = this.def.output;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const item = launchNew(ctx, kind, this.door, this.output, { duration: 0.3 + i * 0.07, ...HOP });
      if (!item) break;
      made++;
    }
    if (made === 0) return 0;
    ctx.state.stats.materialsMade += made;
    ctx.events.emit('material:made', { era: this.era, kind, count: made, position: this.tmp.copy(this.door) });
    const p = ctx.player.position;
    const dx = p.x - this.place.x;
    const dz = p.z - this.place.z;
    if (dx * dx + dz * dz < NEAR2) {
      ctx.particles.sparkle(this.tmp.copy(this.door).setY(1.2), ERAS[this.era]!.colors.accent);
      ctx.audio.play('pop', { volume: 0.25, pitch: 1.0 + Math.random() * 0.25 });
    }
    ctx.tweens.punchScale(this.model.root, 0.025, 0.2);
    return made;
  }
}
