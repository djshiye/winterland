/**
 * [B2 — items] Proximity zones: "player stands here → something happens".
 *
 * - A zone is an XZ rectangle. Each update: inside = player position within area (and zone enabled).
 *   Fire onEnter / onExit on transitions and onStay(dt) every step while inside.
 * - Transfer zones (addTransfer) move items `from` → `to` while the player is inside: the first item
 *   moves immediately on entry, then one every `interval` seconds, the interval shrinking ×0.88 per
 *   item down to TIMING.minInterval (satisfying acceleration). Uses transferOne(). If items are
 *   available but `to` refuses because it is full, emit 'stack:full' (throttled ~0.6 s per zone).
 *   Leaving resets the interval.
 * - Hold to interact (Wave 10b, core/interact.ts): `kind` 'take' (pickups) or 'pay' (payments) zones are GATED when
 *   `ctx.input.interactHeld` is false: nothing transfers and no timer / interval advances (so nothing accumulates
 *   and bursts when E is pressed); instead, while there is something transferable, 'interact:prompt' {on:true, kind}
 *   fires once, and {on:false, kind} when the player leaves, holds or the zone empties. Once held, the first item
 *   moves immediately as usual. Releasing re-arms the zone (interval and delay restart). 'give' (default; drop-offs,
 *   cash collection) is never gated. `interactHeld` is always true when the setting is off.
 * - Optional ground marker: rounded-rectangle outline (white, ~0.06 thick, slightly inset, y≈0.02,
 *   unlit, transparent ~0.35) that brightens/pulses while the player is inside. Hidden when disabled.
 * - 0.9.11 forgiving reach (full review I1-I5): a zone's `reach` says how close the player's CENTRE must come to the
 *   rectangle. 'exact' (custom zones, payments, Jack) is the old centre-inside test. 'body' (pickups, drop-offs and cash
 *   piles) counts the whole body plus slack: in once the centre is within REACH.enter of the rect, out only past
 *   REACH.leave and after REACH.grace s, so drifting along a counter never stutters. A soft halo the width of that slack
 *   glows round the outline while the player is in range, and fainter as they walk up to a zone with something to move.
 * - 0.9.11 (I7): in walk-over mode (hold to interact off) a 'pay' zone only pays while the player is slower than
 *   PAY_WALK_MAX m/s, so running across a pad spends nothing.
 * - 0.9.11 (I6): a drop-off from the player's arms that takes only some kinds floats "Takes Stone" once per visit when
 *   the player arrives carrying nothing it takes.
 *
 * NOTE: ctx.player is created AFTER ctx.zones, so it is only read inside update().
 */
import * as THREE from 'three';
import { PALETTE, PLAYER, TIMING, type Rect } from '../config';
import { damp, inRect } from '../core/math';
import { itemLabel } from '../ui/agesLogic';
import { ALL_ITEM_KINDS, type GameContext, type Item, type ItemHolder, type ItemKind } from '../core/types';
import { basic } from '../render/materials';
import type { FlightOptions } from './FlightSystem';
import type { CashStack } from './CashStack';
import { transferCash, transferOne } from './transfer';
import { steadyHighlights } from '../fx/comfort';

export interface ZoneOptions {
  id: string;
  area: Rect;
  enabled?: boolean;
  marker?: boolean;
  onEnter?: () => void;
  onExit?: () => void;
  onStay?: (dt: number) => void;
  /** How close the player must come (default 'exact': centre inside the rect). */
  reach?: ZoneReach;
}

/** 'exact': the player's centre inside the rect. 'body': the body touching it, with slack and a sticky exit (REACH). */
export type ZoneReach = 'exact' | 'body';

/**
 * 0.9.11 forgiving reach (full review I1): distances from the player's centre to the zone's rect, in metres. `enter` is
 * the body radius plus 0.2 m of slack; `leave` adds 0.35 m so a player drifting along a counter keeps flowing; `grace`
 * keeps a transfer going a moment after they step out; `near` is how far beyond `enter` the halo starts to glimmer.
 */
export const REACH = { enter: PLAYER.radius + 0.2, leave: PLAYER.radius + 0.55, grace: 0.25, near: 0.7 } as const;

/** 0.9.11 (I7): in walk-over mode a pay zone only pays below this speed (m/s); walking pace is 4+. */
export const PAY_WALK_MAX = 1.0;
/** Metres nearer the player must step to the waiting side of a two-way spot before it takes over. */
const PAIR_SWITCH = 0.3;

/** Distance from (x, z) to the rect (0 inside). */
export function rectDistance(r: Rect, x: number, z: number): number {
  const dx = x < r.minX ? r.minX - x : x > r.maxX ? x - r.maxX : 0;
  const dz = z < r.minZ ? r.minZ - z : z > r.maxZ ? z - r.maxZ : 0;
  return dx === 0 ? dz : dz === 0 ? dx : Math.hypot(dx, dz);
}

export interface TransferZoneOptions {
  id: string;
  area: Rect;
  from: ItemHolder;
  to: ItemHolder;
  kinds?: readonly ItemKind[];
  /** Seconds between items at the start of a visit (default TIMING.pickupInterval). */
  interval?: number;
  flight?: FlightOptions;
  marker?: boolean;
  enabled?: boolean;
  onTransfer?: (item: Item) => void;
  /** Seconds the player must stand inside before the first transfer (default 0). Leaving resets it. */
  delay?: number;
  /**
   * Chunked cash: when set, `from` must be a CashStack and every transfer is ONE bundle worth `cashAmount()`
   * dollars (transferCash). Return ≤ 0 to skip. `kinds` is ignored.
   */
  cashAmount?: () => number;
  /**
   * Hold-to-interact class: 'take' (pickups) and 'pay' (payments) only transfer while `ctx.input.interactHeld`;
   * 'give' (default: drop-offs, cash collection) is automatic.
   */
  kind?: 'take' | 'give' | 'pay';
  /** Default: 'exact' for 'pay', 'body' otherwise. */
  reach?: ZoneReach;
}

// ---------------------------------------------------------------------------
// Ground marker
// ---------------------------------------------------------------------------

const MARKER_Y = 0.02;
const MARKER_INSET = 0.1;
const MARKER_THICKNESS = 0.06;
const MARKER_IDLE_OPACITY = 0.35;
/** Halo (0.9.11): width beyond the rect for an 'exact' zone ('body' zones use REACH.enter), and its peak opacity. */
const HALO_EXACT = 0.14;
const HALO_OPACITY = 0.7;
/** Warm lantern gold: reads on snow, cobbles and every era's ground (a white glow vanished on the snow). */
const HALO_COLOR = 0xffc45e;
const MARKER_WHITE = new THREE.Color(PALETTE.zoneMarker);
const MARKER_GOLD = new THREE.Color(HALO_COLOR);

function roundedRectPath(p: THREE.Path, x0: number, y0: number, x1: number, y1: number, r: number): void {
  p.moveTo(x0 + r, y0);
  p.lineTo(x1 - r, y0);
  p.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x1, y1 - r);
  p.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  p.lineTo(x0 + r, y1);
  p.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(x0, y0 + r);
  p.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
}

/** Flat rounded-rectangle outline lying in the XZ plane, centred on the origin. */
function makeMarkerGeometry(area: Rect): THREE.BufferGeometry {
  const w = Math.max(0.5, area.maxX - area.minX - MARKER_INSET * 2);
  const d = Math.max(0.5, area.maxZ - area.minZ - MARKER_INSET * 2);
  const r = Math.min(0.45, w / 2 - 0.01, d / 2 - 0.01);
  const shape = new THREE.Shape();
  roundedRectPath(shape, -w / 2, -d / 2, w / 2, d / 2, r);
  const t = MARKER_THICKNESS;
  const hole = new THREE.Path();
  roundedRectPath(hole, -w / 2 + t, -d / 2 + t, w / 2 - t, d / 2 - t, Math.max(0.05, r - t));
  shape.holes.push(hole);
  // Shape lives in XY; rotate so shape-y maps to world +Z and the face points up.
  return new THREE.ShapeGeometry(shape, 8).rotateX(-Math.PI / 2);
}

/** Flat rounded band from the rect's edge out to `width` beyond it (the in-range halo), centred on the origin. */
function makeHaloGeometry(area: Rect, width: number): THREE.BufferGeometry {
  const w = Math.max(0.3, area.maxX - area.minX);
  const d = Math.max(0.3, area.maxZ - area.minZ);
  const ri = Math.min(0.45, w / 2 - 0.01, d / 2 - 0.01);
  const shape = new THREE.Shape();
  roundedRectPath(shape, -w / 2 - width, -d / 2 - width, w / 2 + width, d / 2 + width, ri + width);
  const hole = new THREE.Path();
  roundedRectPath(hole, -w / 2, -d / 2, w / 2, d / 2, ri);
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 8).rotateX(-Math.PI / 2);
  // fade out from the rect's edge (alpha 1) to the band's outer edge (alpha 0): vertex colours with alpha
  const pos = g.getAttribute('position');
  const rgba = new Float32Array(pos.count * 4);
  const r = { minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 };
  for (let i = 0; i < pos.count; i++) {
    const a = 1 - Math.min(1, rectDistance(r, pos.getX(i), pos.getZ(i)) / Math.max(0.01, width));
    rgba.set([1, 1, 1, a], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  return g;
}

export class Zone {
  readonly id: string;
  area: Rect;
  enabled: boolean;
  playerInside = false;
  marker: THREE.Object3D | null = null;
  /** In-range halo round the marker (0.9.11). */
  halo: THREE.Mesh | null = null;
  readonly reach: ZoneReach;
  /** @internal seconds the player has been past `leave` while still counted inside (grace) */
  outFor = 0;
  /** @internal this step's centre distance to the rect and inside verdict (ZoneSystem.update pass 1) */
  lastDist = Infinity;
  /** @internal */
  nextInside = false;
  /** @internal a reverse-direction zone the player stands nearer to runs instead this step */
  yielding = false;
  /** @internal last step's `yielding` (keeps a two-way spot's choice steady) */
  wasYielding = false;
  /** @internal */
  removed = false;
  /** @internal */
  markerLevel = 0;
  /** @internal */
  markerMaterial: THREE.MeshBasicMaterial | null = null;
  /** @internal */
  haloMaterial: THREE.MeshBasicMaterial | null = null;
  /** @internal the outline is tinted toward gold (reset to white once the level settles at 0) */
  markerTint = false;
  /** @internal */
  readonly onEnter: (() => void) | undefined;
  /** @internal */
  readonly onExit: (() => void) | undefined;
  /** @internal */
  readonly onStay: ((dt: number) => void) | undefined;

  constructor(opts: ZoneOptions) {
    this.id = opts.id;
    this.area = { ...opts.area };
    this.enabled = opts.enabled ?? true;
    this.onEnter = opts.onEnter;
    this.onExit = opts.onExit;
    this.onStay = opts.onStay;
    this.reach = opts.reach ?? 'exact';
  }

  /** Centre distance at which the player counts as arriving. */
  get enterDist(): number {
    return this.reach === 'body' ? REACH.enter : 0;
  }

  /** Halo width round the outline: the reach slack. */
  get haloWidth(): number {
    return this.reach === 'body' ? REACH.enter : HALO_EXACT;
  }

  /** True when the player near this zone has something to move (drives the walk-up glimmer). @internal */
  ready(_ctx: GameContext): boolean {
    return false;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.marker) this.marker.visible = on;
    if (!on && this.halo) this.halo.visible = false;
  }

  setArea(r: Rect): void {
    this.area = { ...r };
    const m = this.marker as THREE.Mesh | null;
    if (m) {
      m.geometry.dispose();
      m.geometry = makeMarkerGeometry(this.area);
      m.position.set((r.minX + r.maxX) / 2, MARKER_Y, (r.minZ + r.maxZ) / 2);
    }
    const h = this.halo;
    if (h) {
      h.geometry.dispose();
      h.geometry = makeHaloGeometry(this.area, this.haloWidth);
      h.position.set((r.minX + r.maxX) / 2, MARKER_Y - 0.002, (r.minZ + r.maxZ) / 2);
    }
  }

  /** Called when the zone is entered (override point for subclasses). @internal */
  protected entered(): void {}
  /** @internal */
  protected left(): void {}
  /** @internal */
  tick(_ctx: GameContext, _dt: number): void {}
  /** @internal */
  handleEnter(): void {
    this.entered();
    this.onEnter?.();
  }
  /** @internal */
  handleExit(): void {
    this.left();
    this.onExit?.();
  }
}

/** Zone that moves items from one holder to another while the player stands inside. */
class TransferZone extends Zone {
  private readonly base: number;
  private interval: number;
  private timer = 0;
  private fullTimer = 0;
  /** An 'interact:prompt' {on:true} is currently showing for this zone. */
  private prompting = false;
  /** The wrong-load hint already floated this visit (I6). */
  private hinted = false;
  private readonly tmpTop = new THREE.Vector3();

  constructor(private readonly t: TransferZoneOptions) {
    super({ id: t.id, area: t.area, enabled: t.enabled, marker: t.marker, reach: t.reach ?? (t.kind === 'pay' ? 'exact' : 'body') });
    this.base = t.interval ?? TIMING.pickupInterval;
    this.interval = this.base;
  }

  protected override entered(): void {
    this.interval = this.base;
    this.timer = this.t.delay ?? 0;
  }

  protected override left(): void {
    this.interval = this.base;
    this.timer = 0;
    this.hinted = false;
    this.movedThisVisit = false;
  }

  /** @internal something moved through this zone since the player arrived (ZoneSystem.pairWinner) */
  movedThisVisit = false;

  override ready(_ctx: GameContext): boolean {
    return this.hasTransferable();
  }

  /** Moves goods out of a holder into the player's arms (a pickup). */
  get takes(): boolean {
    return this.t.kind === 'take';
  }

  /** True when `o` moves goods the opposite way between the same two holders. */
  reverses(o: TransferZone): boolean {
    return this.t.from === o.t.to && this.t.to === o.t.from;
  }

  override tick(ctx: GameContext, dt: number): void {
    const t = this.t;
    this.fullTimer -= dt;
    if (!this.playerInside) {
      this.setPrompt(ctx, false);
      return;
    }
    if (this.yielding) {
      // the reverse zone next to this one runs: nothing moves here, and the next burst starts fresh
      this.interval = this.base;
      this.timer = t.delay ?? 0;
      this.setPrompt(ctx, false);
      return;
    }
    const kind = t.kind ?? 'give';
    if (kind !== 'give' && !ctx.input.interactHeld) {
      // gated: nothing moves, nothing accumulates; re-arm so the next hold starts a fresh burst
      this.interval = this.base;
      this.timer = t.delay ?? 0;
      this.setPrompt(ctx, this.hasTransferable());
      return;
    }
    this.setPrompt(ctx, false);
    if (kind === 'pay' && ctx.input.holdToInteract === false) {
      // walk-over mode: crossing a pad at walking pace pays nothing (I7); slow down or stop on it to pay
      const v = ctx.player.velocity;
      if (v && Math.hypot(v.x, v.z) > PAY_WALK_MAX) {
        this.interval = this.base;
        this.timer = Math.max(this.timer, t.delay ?? 0);
        return;
      }
    }
    this.timer -= dt;
    let moved = 0;
    while (this.timer <= 0 && moved < 4) {
      const amount = t.cashAmount ? t.cashAmount() : 0;
      const item = t.cashAmount
        ? amount > 0
          ? transferCash(ctx, t.from as CashStack, t.to, amount, t.flight)
          : null
        : transferOne(ctx, t.from, t.to, t.kinds, t.flight);
      if (!item) {
        this.timer = 0;
        this.interval = this.base; // nothing to move: next burst starts slow again
        if (!t.cashAmount) this.checkFull(ctx); // a full / fully reserved pad is not a "full stack"
        if (moved === 0) this.hintWrongLoad(ctx);
        break;
      }
      moved++;
      this.movedThisVisit = true;
      this.timer += this.interval;
      this.interval = Math.max(TIMING.minInterval, this.interval * 0.88);
      t.onTransfer?.(item);
    }
  }

  /**
   * I6: a drop-off from the arms that takes only some kinds, reached with arms full of none of them, floats
   * "Takes Stone" over the zone once per visit (a look-alike load is never a silent no).
   */
  private hintWrongLoad(ctx: GameContext): void {
    const t = this.t;
    // payments (construction pads) float their own "Needs Clay" (stations/ConstructionPad.ts)
    if (this.hinted || t.kind === 'pay' || !t.kinds || t.kinds.length > 3 || t.from !== ctx.player.arms) return;
    const arms = t.from;
    if (arms.count() === 0) return;
    const v = ctx.player.velocity;
    if (v && Math.hypot(v.x, v.z) > PAY_WALK_MAX) return; // only once they stop here, not while walking past
    for (let i = 0; i < t.kinds.length; i++) if (arms.count(t.kinds[i]!) > 0) return;
    this.hinted = true;
    const a = this.area;
    const names = t.kinds.map(itemLabel).join(' or ');
    ctx.hud?.floatText(this.tmpTop.set((a.minX + a.maxX) / 2, 2.2, (a.minZ + a.maxZ) / 2), `Takes ${names}`, { color: '#ffe3a3', size: 24, duration: 1.8, rise: 0.8 });
  }

  /** Emit 'interact:prompt' only on a change of state. */
  private setPrompt(ctx: GameContext, on: boolean): void {
    if (this.prompting === on) return;
    this.prompting = on;
    const kind = this.t.kind;
    if (kind && kind !== 'give') ctx.events.emit('interact:prompt', { on, kind });
  }

  /** Cheap check: something could move right now (used only to decide whether to show the prompt). */
  private hasTransferable(): boolean {
    const t = this.t;
    if (t.cashAmount) return t.from.count('cash') > 0 && t.cashAmount() > 0 && t.to.canAccept('cash');
    const kinds = t.kinds ?? ALL_KINDS;
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i]!;
      if (t.from.count(k) > 0 && t.to.canAccept(k)) return true;
    }
    return false;
  }

  /** Items are waiting but the destination refuses them → 'stack:full' (throttled). */
  private checkFull(ctx: GameContext): void {
    if (this.fullTimer > 0) return;
    const kinds = this.t.kinds ?? ALL_KINDS;
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i]!;
      if (this.t.from.count(k) > 0 && !this.t.to.canAccept(k)) {
        this.fullTimer = 0.6;
        const to = this.t.to;
        const pos = this.tmpTop;
        if (hasTop(to)) to.topWorldPosition(pos);
        else pos.copy(ctx.player.position).setY(2);
        ctx.events.emit('stack:full', { holder: to, position: pos });
        return;
      }
    }
  }
}

const ALL_KINDS: readonly ItemKind[] = ALL_ITEM_KINDS;

interface HasTop {
  topWorldPosition(out: THREE.Vector3): THREE.Vector3;
}
function hasTop(h: ItemHolder): h is ItemHolder & HasTop {
  return typeof (h as Partial<HasTop>).topWorldPosition === 'function';
}

export class ZoneSystem {
  private readonly zones: Zone[] = [];
  private needsCompact = false;
  private readonly pairBuf: TransferZone[] = [];

  constructor(readonly ctx: GameContext) {}

  /** Register a custom zone (chopping, upgrade pads, ...). */
  add(opts: ZoneOptions): Zone {
    return this.register(new Zone(opts), opts.marker ?? false);
  }

  /** Register a proximity transfer zone (accelerating one-by-one moves between two holders). */
  addTransfer(opts: TransferZoneOptions): Zone {
    return this.register(new TransferZone(opts), opts.marker ?? false);
  }

  remove(zone: Zone): void {
    zone.removed = true;
    this.needsCompact = true;
    if (zone.marker) {
      zone.marker.removeFromParent();
      (zone.marker as THREE.Mesh).geometry.dispose();
      zone.markerMaterial?.dispose();
      zone.marker = null;
    }
    if (zone.halo) {
      zone.halo.removeFromParent();
      zone.halo.geometry.dispose();
      zone.haloMaterial?.dispose();
      zone.halo = null;
    }
  }

  /** 0.9.12: true if (x, z) lies within `margin` of any pad (critters keep off them). */
  nearAny(x: number, z: number, margin: number): boolean {
    return this.zones.some((z0) => x > z0.area.minX - margin && x < z0.area.maxX + margin && z > z0.area.minZ - margin && z < z0.area.maxZ + margin);
  }

  isPlayerIn(area: Rect): boolean {
    const p = this.ctx.player.position;
    return inRect(area, p.x, p.z);
  }

  /**
   * Which of two reverse zones the player stands in runs. A fresh pairing goes to the one with something to move, else
   * the nearer one (a tie goes to the drop-off). It then holds for the visit, so emptying the arms never hands over to
   * the pick-up (or the other way round), unless the player steps clearly nearer to the other side, or the winner never
   * had anything to move and the other side now does.
   */
  private pairWinner(a: TransferZone, b: TransferZone): TransferZone {
    if (a.wasYielding !== b.wasYielding) {
      const w = a.wasYielding ? b : a;
      const l = w === a ? b : a;
      if (l.lastDist + PAIR_SWITCH < w.lastDist) return l;
      if (!w.movedThisVisit && !w.ready(this.ctx) && l.ready(this.ctx)) return l;
      return w;
    }
    const ar = a.ready(this.ctx);
    if (ar !== b.ready(this.ctx)) return ar ? a : b;
    if (a.lastDist !== b.lastDist) return a.lastDist < b.lastDist ? a : b;
    return a.takes ? b : a;
  }

  update(dt: number): void {
    const p = this.ctx.player.position;
    // pass 1: who counts as inside this step (no callbacks yet)
    const pairs = this.pairBuf;
    pairs.length = 0;
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i]!;
      if (z.removed) continue;
      const d = z.enabled ? rectDistance(z.area, p.x, p.z) : Infinity;
      let inside: boolean;
      if (z.reach === 'exact') inside = d === 0;
      else if (!z.playerInside) inside = d <= REACH.enter;
      else if (d <= REACH.leave) {
        z.outFor = 0;
        inside = true;
      } else {
        z.outFor += dt;
        inside = z.enabled && z.outFor < REACH.grace;
      }
      if (inside && !z.playerInside) z.outFor = 0;
      z.lastDist = d;
      z.nextInside = inside;
      z.wasYielding = z.yielding;
      z.yielding = false;
      if (inside && z instanceof TransferZone) pairs.push(z);
    }
    // a player inside both halves of a two-way spot (an era dock's drop and pick-up side by side) would bounce the same
    // goods between arms and pile: only one of the two runs (pairWinner), the other waits
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const a = pairs[i]!;
        const b = pairs[j]!;
        if (a.reverses(b)) (this.pairWinner(a, b) === a ? b : a).yielding = true;
      }
    }
    // pass 2: transitions, callbacks, transfers, markers
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i]!;
      if (z.removed) continue;
      const inside = z.nextInside;
      const d = z.lastDist;
      if (inside && !z.playerInside) {
        z.playerInside = true;
        z.handleEnter();
      } else if (!inside && z.playerInside) {
        z.playerInside = false;
        z.handleExit();
      }
      if (z.removed) continue;
      if (inside) z.onStay?.(dt);
      if (z.removed) continue;
      z.tick(this.ctx, dt);
      if (z.markerMaterial) this.animateMarker(z, inside, d, dt);
    }
    if (this.needsCompact) {
      this.needsCompact = false;
      for (let i = this.zones.length - 1; i >= 0; i--) if (this.zones[i]!.removed) this.zones.splice(i, 1);
    }
  }

  // --- internals ------------------------------------------------------------
  private register<T extends Zone>(zone: T, marker: boolean): T {
    this.zones.push(zone);
    if (marker) {
      const mat = basic(PALETTE.zoneMarker, { transparent: true, opacity: MARKER_IDLE_OPACITY, depthWrite: false }).clone();
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -2;
      mat.polygonOffsetUnits = -2;
      const m = new THREE.Mesh(makeMarkerGeometry(zone.area), mat);
      m.position.set((zone.area.minX + zone.area.maxX) / 2, MARKER_Y, (zone.area.minZ + zone.area.maxZ) / 2);
      m.renderOrder = 2;
      m.visible = zone.enabled;
      m.name = `zone:${zone.id}`;
      this.ctx.scene.add(m);
      zone.marker = m;
      zone.markerMaterial = mat;
      const hm = mat.clone();
      hm.color.setHex(HALO_COLOR);
      hm.vertexColors = true;
      hm.opacity = 0;
      const h = new THREE.Mesh(makeHaloGeometry(zone.area, zone.haloWidth), hm);
      h.position.set(m.position.x, MARKER_Y - 0.002, m.position.z);
      h.renderOrder = 1;
      h.visible = false;
      h.name = `zoneHalo:${zone.id}`;
      this.ctx.scene.add(h);
      zone.halo = h;
      zone.haloMaterial = hm;
    }
    return zone;
  }

  private animateMarker(z: Zone, inside: boolean, d: number, dt: number): void {
    // in range: full glow; walking up to a zone with something to move (within REACH.near of arriving): a glimmer
    const near = !inside && z.enabled && d <= z.enterDist + REACH.near && z.ready(this.ctx);
    z.markerLevel = damp(z.markerLevel, inside ? 1 : near ? 0.4 : 0, 14, dt);
    // 0.9.7: the marker glows steady with calmer effects / Reduce motion (it used to flicker at 9 rad/s)
    const pulse = inside && !steadyHighlights() ? 0.12 * Math.sin(this.ctx.time.elapsed * 9) : 0;
    z.markerMaterial!.opacity = MARKER_IDLE_OPACITY + z.markerLevel * (0.62 - MARKER_IDLE_OPACITY) + pulse * z.markerLevel;
    // the outline warms from white to lantern gold as the player arrives
    if (z.markerLevel > 0.002 || z.markerTint) {
      z.markerMaterial!.color.lerpColors(MARKER_WHITE, MARKER_GOLD, Math.min(1, z.markerLevel));
      z.markerTint = z.markerLevel > 0.002;
    }
    const h = z.halo;
    if (h) {
      const show = z.enabled && z.markerLevel > 0.02;
      if (h.visible !== show) h.visible = show;
      if (show) z.haloMaterial!.opacity = HALO_OPACITY * z.markerLevel;
    }
  }
}
