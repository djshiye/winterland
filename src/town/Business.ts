/**
 * [T2 — town] One built town building (BUSINESSES[id]) on lot `lot`: a producer, a shop or a home.
 *
 * CONTRACT (T2 owns the implementation; Town is its only constructor caller):
 * - producer: every def.cycle seconds (while its out pile has room) makes one def.output item onto `output`
 *   (launchNew, a little hop out of the barn door); a transfer zone gives them to the player's arms.
 *   stats.goodsMade++, emit 'goods:made'.
 * - shop: `input` (a hopper Pile, mixed kinds) takes def.inputs kinds from the player's arms (transfer zone, only
 *   kinds it still needs room for); a cycle starts when it holds `per` of every input kind and `output` (the
 *   counter, a Pile) has room: takes them, works (chimney puffs / oven glow / bench animation), puts one def.output
 *   on the counter. `till` (CashPile) receives the townsfolk's payments; asShop() exposes the ShopSpot.
 * - home: no stations; just the model (lit windows at night, chimney smoke).
 * - build(instant): visible + running; instant (restore) = final state, no animation / event / sound.
 * - inProcess: input items taken for the current cycle whose product isn't on the counter yet (for the save,
 *   by kind).
 *
 * Implementation: the building and its props live in a group at the lot centre, rotated so the model's +Z front
 * faces the square (rules.ts has the layout). Shop cycle, as fractions of the live cycle time T = def.cycle: the
 * inputs hop from the hopper to the door (0 → 0.4) and are eaten; the building works (0.4 → 0.8); the product hops
 * out of the door onto the counter (0.8); cooldown until T. A cycle starts only with the inputs in the hopper and
 * room on the counter; back-to-back cycles keep the exact cycle time. A producer's timer runs only while its pallet
 * has room. Colliders: the building and its solid props (sized so the player zones stay reachable).
 *
 * Demolish (0.9.0): teardown() takes the business out of play at once (colliders and zones removed, hopper / counter
 * cleared, the building hidden; asShop() / staff() go empty) and `till` keeps its value for the caller to credit;
 * drain() then finishes the job once no item or cash bundle is still flying to its piles (flights cannot be recalled),
 * disposing the piles and removing the group. Town keeps the dead business until drain() returns true.
 */
import * as THREE from 'three';
import { BUSINESSES, COLORS, ITEM_SIZE, TIMING, type BusinessDef, type PileGrid, type Rect, type XZ } from '../config';
import { createBusinessModel, createHopperBin, createOutPallet, createShopCounter, type BusinessModel, type StationProp } from '../assets/town';
import { smoothstep } from '../core/math';
import type { GameContext, Item, ItemKind } from '../core/types';
import { Pile } from '../items/Pile';
import { launchNew } from '../items/transfer';
import type { Zone } from '../items/Zones';
import { CashPile } from '../stations/CashPile';
import type { ColliderHandle } from '../world/Colliders';
import {
  hopperPerKind,
  layersFor,
  layoutFor,
  localX,
  lotFrame,
  queueSpotOf,
  toWorld,
  worldRect,
  type LotFrame,
  type LRect,
  type StationLayout,
} from './rules';
import type { ShopSpot } from './types';

const F_DOOR = 0.4;
const F_POP = 0.8;
const SMOKE_COLOR = 0xe6edf3;
/** Goods that ride out of the door get this much arc. */
const HOP = { arcHeight: 0.9, scaleFrom: 0.5 };

type State = 'idle' | 'busy' | 'blocked' | 'cooldown';

export interface StaffSpot {
  x: number;
  z: number;
  yaw: number;
  working: boolean;
}

/** A hopper that takes each input kind only while it has room for that kind (landed + in flight). */
class HopperPile extends Pile {
  constructor(
    ctx: GameContext,
    opts: ConstructorParameters<typeof Pile>[1],
    private readonly perKind: () => number,
  ) {
    super(ctx, opts);
  }

  override canAccept(kind: ItemKind): boolean {
    if (!super.canAccept(kind)) return false;
    return this.count(kind) + this.ctx.flights.inFlightTo(this, kind) < this.perKind();
  }
}

function outGrid(kind: ItemKind, capacity: number, wide: number, deep: number): PileGrid {
  const s = ITEM_SIZE[kind as keyof typeof ITEM_SIZE] as { stackHeight: number; w?: number; d?: number; size?: number };
  const w = s.w ?? s.size ?? 0.4;
  const d = s.d ?? s.size ?? 0.3;
  const cols = 3;
  const rows = 2;
  return {
    cols,
    rows,
    layers: layersFor(capacity),
    spacing: { x: Math.min(wide / cols, w + 0.08), y: s.stackHeight, z: Math.min(deep / rows, d + 0.1) },
  };
}

export class Business {
  readonly input: Pile | null = null;
  readonly output: Pile | null = null;
  readonly till: CashPile | null = null;
  /** The building + props, at the lot centre, rotated toward the square. */
  readonly group = new THREE.Group();
  readonly model: BusinessModel;
  readonly frame: LotFrame;
  readonly layout: StationLayout;
  /** World chimney mouth, or null. */
  readonly chimney: THREE.Vector3 | null;

  private built = false;
  private startAt = 0;
  private state: State = 'idle';
  private t = 0;
  private cycle = 2;
  private cur: Item[] = [];
  private readonly start: THREE.Vector3[] = [];
  private readonly proc: Partial<Record<ItemKind, number>> = {};
  private puffClock = 0;
  private readonly door = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly zones: Zone[] = [];
  private spot: ShopSpot | null = null;
  private readonly solids: LRect[] = [];
  private readonly colliders: ColliderHandle[] = [];
  private torn = false;
  private gone = false;

  constructor(
    readonly ctx: GameContext,
    readonly lot: number,
    readonly def: BusinessDef,
    parent?: THREE.Object3D,
  ) {
    const f = lotFrame(lot);
    const model = createBusinessModel(def.id);
    const box = new THREE.Box3().setFromObject(model.root);
    const body = box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-model.w / 2, 0, -model.d / 2), new THREE.Vector3(model.w / 2, 1, model.d / 2)) : box;
    const front = Math.max(0.3, Math.min(1.8, body.max.z));
    const L = layoutFor(def, front, f.variant);
    this.frame = f;
    this.model = model;
    this.layout = L;
    this.group.name = `business:${lot}:${def.id}`;
    this.group.position.set(f.x, 0, f.z);
    this.group.rotation.y = f.yaw;
    this.group.visible = false;
    this.group.add(model.root);
    (parent ?? ctx.scene).add(this.group);

    const p = toWorld(f, 0, L.front + 0.05);
    this.door.set(p.x, 0.9, p.z);
    this.chimney = model.chimney ? this.localToWorld(model.chimney) : null;
    this.solids.push({ u0: Math.max(-model.w / 2, body.min.x), u1: Math.min(model.w / 2, body.max.x), v0: body.min.z, v1: front });

    if (def.kind === 'shop' && L.hopper && L.counter && L.till && L.feed && L.collect && def.output) {
      const bin = createHopperBin();
      const counter = createShopCounter();
      this.place(bin, L.hopper.u, L.hopper.v);
      this.place(counter, L.counter.u, L.counter.v);
      const kinds = def.inputs.map((i) => i.kind);
      const slots = hopperPerKind(def) * kinds.length;
      const input = new HopperPile(
        ctx,
        {
          id: `pile:town${lot}In`,
          accepts: kinds,
          position: new THREE.Vector3(localX(f, L.hopper.u), bin.topY, L.hopper.v),
          parent: this.group,
          grid: { cols: 2, rows: 3, layers: layersFor(slots), spacing: { x: 0.5, y: 0.3, z: 0.3 } },
        },
        () => hopperPerKind(BUSINESSES[def.id]),
      );
      const output = new Pile(ctx, {
        id: `pile:town${lot}Out`,
        accepts: [def.output],
        position: new THREE.Vector3(localX(f, L.counter.u), counter.topY, L.counter.v),
        parent: this.group,
        grid: outGrid(def.output, def.capacity, 1.38, 0.66),
      });
      const tp = toWorld(f, L.till.u, L.till.v);
      const till = new CashPile(ctx, {
        id: `pile:town${lot}Cash`,
        x: tp.x,
        z: tp.z,
        grid: { cols: 2, rows: 2, layers: 20, spacing: { x: 0.37, y: 0.125, z: 0.22 } },
        zone: worldRect(f, L.collect.u0, L.collect.u1, L.collect.v0, L.collect.v1),
      });
      till.pile.root.visible = false;
      till.zone.setEnabled(false);
      this.zones.push(till.zone);
      this.zones.push(
        ctx.zones.addTransfer({
          id: `pile:town${lot}In:feed`,
          area: worldRect(f, L.feed.u0, L.feed.u1, L.feed.v0, L.feed.v1),
          from: ctx.player.arms,
          to: input,
          kinds,
          interval: TIMING.dropInterval,
          marker: true,
          enabled: false,
        }),
      );
      if (L.pickup) {
        // A carryable product (toys): the player can take it off the counter pile too (townsfolk still buy from it).
        this.zones.push(
          ctx.zones.addTransfer({
            id: `pile:town${lot}Out:pickup`,
            area: worldRect(f, L.pickup.u0, L.pickup.u1, L.pickup.v0, L.pickup.v1),
            from: output,
            to: ctx.player.arms,
            kinds: [def.output],
            kind: 'take',
            interval: TIMING.pickupInterval,
            marker: true,
            enabled: false,
          }),
        );
      }
      this.input = input;
      this.output = output;
      this.till = till;
    } else if (def.kind === 'producer' && L.pallet && L.pickup && def.output) {
      const pallet = createOutPallet();
      this.place(pallet, L.pallet.u, L.pallet.v);
      const output = new Pile(ctx, {
        id: `pile:town${lot}Out`,
        accepts: [def.output],
        position: new THREE.Vector3(localX(f, L.pallet.u), pallet.topY, L.pallet.v),
        parent: this.group,
        grid: outGrid(def.output, def.capacity, 1.4, 1.0),
      });
      this.zones.push(
        ctx.zones.addTransfer({
          id: `pile:town${lot}Out:pickup`,
          area: worldRect(f, L.pickup.u0, L.pickup.u1, L.pickup.v0, L.pickup.v1),
          from: output,
          to: ctx.player.arms,
          kinds: [def.output],
          kind: 'take',
          interval: TIMING.pickupInterval,
          marker: true,
          enabled: false,
        }),
      );
      this.output = output;
    }
    for (const s of L.solids) this.solids.push(s); // solids[0] is the building footprint, props follow
  }

  /** Goods / inputs taken for the running cycle, by kind (for the save). */
  get inProcess(): Partial<Record<ItemKind, number>> {
    return this.proc;
  }

  /** True while the building is visibly working (shop cycle running; producer making goods). */
  get working(): boolean {
    if (!this.built) return false;
    if (this.def.kind === 'shop') return this.state === 'busy';
    if (this.def.kind === 'producer') return this.roomFor();
    return false;
  }

  asShop(): ShopSpot | null {
    if (this.def.kind !== 'shop' || !this.output || !this.till || !this.built) return null;
    if (!this.spot) {
      const f = this.frame;
      const L = this.layout;
      const top = new THREE.Vector3();
      const c = toWorld(f, L.counter!.u, L.counter!.v);
      top.set(c.x, 1.25, c.z);
      const self = this;
      this.spot = {
        lot: this.lot,
        def: this.def,
        counter: this.output,
        till: this.till,
        facing: f.facing,
        counterTop: top,
        queueSpot: (i: number, out: XZ): XZ => queueSpotOf(f, self.layout, i, out),
      };
    }
    return this.spot;
  }

  /** Visible workers: about one per two jobs, behind the counter / beside the barn. */
  staff(): StaffSpot[] {
    if (!this.built) return [];
    const w = this.working;
    return this.layout.staff.map((s) => {
      const p = toWorld(this.frame, s.u, s.v);
      return { x: p.x, z: p.z, yaw: this.frame.yaw, working: w };
    });
  }

  /** World rects of this business's player zones (feed hopper, pick up goods, collect cash): tests / debug. */
  /** World rects of the player's zones (null when this kind has none): feed the hopper, pick goods up, collect the till. */
  get feedZone(): Rect | null {
    return this.layout.feed ? worldRect(this.frame, this.layout.feed.u0, this.layout.feed.u1, this.layout.feed.v0, this.layout.feed.v1) : null;
  }
  get pickupZone(): Rect | null {
    const r = this.layout.pickup;
    return r ? worldRect(this.frame, r.u0, r.u1, r.v0, r.v1) : null;
  }
  get collectZone(): Rect | null {
    const r = this.layout.collect;
    return r ? worldRect(this.frame, r.u0, r.u1, r.v0, r.v1) : null;
  }

  zoneRects(): Rect[] {
    const L = this.layout;
    return [L.feed, L.pickup, L.collect]
      .filter((r): r is LRect => !!r)
      .map((r) => worldRect(this.frame, r.u0, r.u1, r.v0, r.v1));
  }

  /** Register the colliders, pop in with a squash. instant (restoring a save): final state at once — no animation, no sound. */
  build(instant = false): void {
    if (this.built) return;
    this.built = true;
    const ctx = this.ctx;
    const f = this.frame;
    this.solids.forEach((s, i) => {
      const r = worldRect(f, s.u0, s.u1, s.v0, s.v1);
      this.colliders.push(ctx.colliders.addBox(r, i === 0 ? `town:${this.lot}` : `town:${this.lot}:prop${i}`));
    });
    for (const z of this.zones) z.setEnabled(true);
    this.till?.appear(instant);
    this.group.visible = true;
    if (instant) {
      this.startAt = ctx.time.elapsed;
      return;
    }
    this.startAt = ctx.time.elapsed + 0.9;
    ctx.tweens.popIn(this.group, { duration: 0.5 });
    ctx.tweens.delay(0.55, () => ctx.tweens.squash(this.model.root, 0.08, 0.4));
  }

  /** True once teardown() ran: the business is out of play (a stale reference must not use its piles). */
  get dead(): boolean {
    return this.torn;
  }

  /**
   * Demolish: out of play at once. Colliders and zones are removed, the hopper / counter / till are emptied (their goods
   * go back to the item pool; the till's dollars are NOT touched: read `till.value` first and credit it), the building
   * is hidden. The piles stay attached until drain() says nothing is flying to them any more. Idempotent.
   */
  teardown(): void {
    if (this.torn) return;
    this.torn = true;
    this.built = false;
    const ctx = this.ctx;
    for (const h of this.colliders) ctx.colliders.remove(h);
    this.colliders.length = 0;
    for (const z of this.zones) ctx.zones.remove(z);
    this.zones.length = 0;
    for (const item of this.cur) {
      ctx.tweens.killTweensOf(item.object);
      ctx.items.release(item);
    }
    this.cur.length = 0;
    for (const k of Object.keys(this.proc) as ItemKind[]) delete this.proc[k];
    this.owed = 0;
    this.spot = null;
    this.input?.clear();
    this.output?.clear();
    this.till?.pile.clear();
    ctx.tweens.killTweensOf(this.group);
    ctx.tweens.killTweensOf(this.model.root);
    this.group.visible = false;
  }

  /**
   * After teardown(): true once nothing is still flying to this business's piles (a goods hop, a townsfolk's payment, a
   * porter's delivery); then the piles are cleared of whatever landed meanwhile and disposed, the group is removed.
   * While flights remain the piles are cleared again (landed items go back to the pool) and false is returned.
   */
  drain(): boolean {
    if (!this.torn) return false;
    if (this.gone) return true;
    const fl = this.ctx.flights;
    const piles = [this.input, this.output, this.till?.pile].filter((p): p is Pile => !!p);
    let flying = (this.till?.inFlightValue ?? 0) > 0; // payments still waiting in pay()'s stagger delays
    for (const p of piles) {
      if (fl.inFlightTo(p) > 0) flying = true;
      p.clear();
    }
    if (flying) return false;
    for (const p of piles) p.dispose();
    this.group.removeFromParent();
    this.gone = true;
    return true;
  }

  update(dt: number): void {
    if (!this.built) return;
    const ctx = this.ctx;
    const def = BUSINESSES[this.def.id]; // live config
    if (def.kind === 'producer') this.updateProducer(dt, def);
    else if (def.kind === 'shop') this.updateShop(dt, def);
    this.model.animate(dt, this.working);

    // chimney: busy puffs
    if (this.chimney && this.working) {
      this.puffClock -= dt;
      if (this.puffClock <= 0) {
        this.puffClock = 0.9;
        ctx.particles.puff(this.tmp.copy(this.chimney), { color: SMOKE_COLOR, count: 1, size: 0.34, life: 1.4 });
      }
    }
  }

  // ---- save -------------------------------------------------------------------------------------------------
  /** Items per kind in the hopper (landed, in flight, in process), goods on the pile, dollars in the till. */
  snapshot(): { in: Partial<Record<ItemKind, number>>; out: number; cash: number } {
    const fl = this.ctx.flights;
    const inn: Partial<Record<ItemKind, number>> = {};
    if (this.input) {
      for (const i of this.def.inputs) {
        inn[i.kind] = this.input.count(i.kind) + fl.inFlightTo(this.input, i.kind) + (this.proc[i.kind] ?? 0);
      }
    }
    const out = this.output && this.def.output ? this.output.count(this.def.output) + fl.inFlightTo(this.output, this.def.output) : 0;
    return { in: inn, out, cash: this.till ? this.till.value : 0 };
  }

  restore(w: { in: Partial<Record<ItemKind, number>>; out: number; cash: number }): void {
    if (this.input) {
      this.input.clear();
      const per = hopperPerKind(this.def);
      for (const i of this.def.inputs) this.input.fill(i.kind, Math.min(per, Math.max(0, Math.floor(w.in[i.kind] ?? 0))));
    }
    if (this.output && this.def.output) {
      this.output.clear();
      this.output.fill(this.def.output, Math.min(this.def.capacity, Math.max(0, Math.floor(w.out || 0))));
    }
    if (this.till && w.cash > 0) this.till.restoreValue(w.cash);
  }

  // ---- internals --------------------------------------------------------------------------------------------
  private place(prop: StationProp, u: number, v: number): void {
    prop.root.position.set(localX(this.frame, u), 0, v);
    this.group.add(prop.root);
  }

  private localToWorld(p: THREE.Vector3): THREE.Vector3 {
    const w = toWorld(this.frame, this.frame.mirror ? -p.x : p.x, p.z);
    return new THREE.Vector3(w.x, p.y, w.z);
  }

  private roomFor(): boolean {
    const out = this.output;
    if (!out || !this.def.output) return false;
    const cap = Math.min(BUSINESSES[this.def.id].capacity, out.capacity);
    return out.total < cap && out.canAccept(this.def.output);
  }

  private updateProducer(dt: number, def: BusinessDef): void {
    const kind = def.output;
    const out = this.output;
    if (!kind || !out) return;
    if (this.ctx.time.elapsed < this.startAt) return;
    if (!this.roomFor()) {
      this.t = Math.min(this.t, Math.max(0.3, def.cycle));
      return;
    }
    this.t += dt;
    const cyc = Math.max(0.3, def.cycle);
    if (this.t < cyc) return;
    if (this.pop(kind, cyc)) this.t = Math.max(0, this.t - cyc);
    else this.t = cyc;
  }

  private updateShop(dt: number, def: BusinessDef): void {
    const ctx = this.ctx;
    if (this.state === 'idle') {
      if (ctx.time.elapsed >= this.startAt && this.canStart(def)) this.startCycle(def);
      return;
    }
    this.t += dt;
    this.advance(def);
    if (this.isIdle() && this.canStart(def)) {
      const over = this.t - this.cycle;
      this.startCycle(def);
      this.t = Math.max(0, over);
    }
  }

  private isIdle(): boolean {
    return this.state === 'idle';
  }

  private canStart(def: BusinessDef): boolean {
    const inp = this.input;
    if (!inp || !def.output) return false;
    for (const i of def.inputs) if (inp.count(i.kind) < i.per) return false;
    return this.roomFor();
  }

  private startCycle(def: BusinessDef): void {
    const inp = this.input!;
    this.cur.length = 0;
    this.start.length = 0;
    for (const k of Object.keys(this.proc) as ItemKind[]) delete this.proc[k];
    for (const i of def.inputs) {
      for (let n = 0; n < i.per; n++) {
        const item = inp.take(i.kind);
        if (!item) continue;
        this.cur.push(item);
        this.start.push(item.object.position.clone());
        this.proc[i.kind] = (this.proc[i.kind] ?? 0) + 1;
      }
    }
    this.cycle = Math.max(0.3, def.cycle);
    this.state = 'busy';
    this.t = 0;
  }

  /** Items of the current cycle's batch not yet out of the door. */
  private owed = 0;

  private advance(def: BusinessDef): void {
    const ctx = this.ctx;
    const cyc = this.cycle;
    const tDoor = F_DOOR * cyc;
    const tPop = F_POP * cyc;
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
        for (const item of this.cur) {
          ctx.tweens.killTweensOf(item.object);
          ctx.items.release(item);
        }
        this.cur.length = 0;
        ctx.tweens.punchScale(this.model.root, 0.03, 0.15);
      }
    }
    if ((this.state === 'busy' || this.state === 'blocked') && this.t >= tPop) {
      const kind = def.output;
      // A cycle makes def.batch items; the inputs count as spent once the first one is out (save: inProcess).
      if (this.state === 'busy') this.owed = Math.max(1, def.batch ?? 1);
      while (kind && this.owed > 0 && this.pop(kind, cyc)) {
        this.owed--;
        for (const k of Object.keys(this.proc) as ItemKind[]) delete this.proc[k];
      }
      this.state = this.owed === 0 ? 'cooldown' : 'blocked';
    }
    if (this.state === 'cooldown' && this.t >= cyc) this.state = 'idle';
  }

  /** One goods item hops out of the door onto the pile. False when the pile has no room. */
  private pop(kind: ItemKind, cyc: number): boolean {
    const out = this.output;
    if (!out || !this.roomFor()) return false;
    const item = launchNew(this.ctx, kind, this.door, out, { duration: Math.max(0.25, Math.min(0.5, 0.3 * cyc)), ...HOP });
    if (!item) return false;
    const ctx = this.ctx;
    ctx.state.stats.goodsMade++;
    ctx.events.emit('goods:made', { lot: this.lot, kind, position: this.tmp.copy(this.door) });
    ctx.particles.sparkle(this.tmp.copy(this.door).setY(1.1), COLORS.CASH_BAND);
    ctx.tweens.punchScale(this.model.root, 0.025, 0.2);
    ctx.audio.play('pop', { volume: 0.3, pitch: 1.1 + Math.random() * 0.2 });
    return true;
  }
}
