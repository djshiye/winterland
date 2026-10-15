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
 * - Optional ground marker: rounded-rectangle outline (white, ~0.06 thick, slightly inset, y≈0.02,
 *   unlit, transparent ~0.35) that brightens/pulses while the player is inside. Hidden when disabled.
 *
 * NOTE: ctx.player is created AFTER ctx.zones, so it is only read inside update().
 */
import * as THREE from 'three';
import { PALETTE, TIMING, type Rect } from '../config';
import { damp, inRect } from '../core/math';
import type { GameContext, Item, ItemHolder, ItemKind } from '../core/types';
import { basic } from '../render/materials';
import type { FlightOptions } from './FlightSystem';
import type { CashStack } from './CashStack';
import { transferCash, transferOne } from './transfer';

export interface ZoneOptions {
  id: string;
  area: Rect;
  enabled?: boolean;
  marker?: boolean;
  onEnter?: () => void;
  onExit?: () => void;
  onStay?: (dt: number) => void;
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
}

// ---------------------------------------------------------------------------
// Ground marker
// ---------------------------------------------------------------------------

const MARKER_Y = 0.02;
const MARKER_INSET = 0.1;
const MARKER_THICKNESS = 0.06;
const MARKER_IDLE_OPACITY = 0.35;

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

export class Zone {
  readonly id: string;
  area: Rect;
  enabled: boolean;
  playerInside = false;
  marker: THREE.Object3D | null = null;
  /** @internal */
  removed = false;
  /** @internal */
  markerLevel = 0;
  /** @internal */
  markerMaterial: THREE.MeshBasicMaterial | null = null;
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
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.marker) this.marker.visible = on;
  }

  setArea(r: Rect): void {
    this.area = { ...r };
    const m = this.marker as THREE.Mesh | null;
    if (m) {
      m.geometry.dispose();
      m.geometry = makeMarkerGeometry(this.area);
      m.position.set((r.minX + r.maxX) / 2, MARKER_Y, (r.minZ + r.maxZ) / 2);
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
  private readonly tmpTop = new THREE.Vector3();

  constructor(private readonly t: TransferZoneOptions) {
    super({ id: t.id, area: t.area, enabled: t.enabled, marker: t.marker });
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
  }

  override tick(ctx: GameContext, dt: number): void {
    const t = this.t;
    this.fullTimer -= dt;
    if (!this.playerInside) return;
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
        break;
      }
      moved++;
      this.timer += this.interval;
      this.interval = Math.max(TIMING.minInterval, this.interval * 0.88);
      t.onTransfer?.(item);
    }
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

const ALL_KINDS: readonly ItemKind[] = ['log', 'plank', 'crate', 'cash', 'furniture'];

interface HasTop {
  topWorldPosition(out: THREE.Vector3): THREE.Vector3;
}
function hasTop(h: ItemHolder): h is ItemHolder & HasTop {
  return typeof (h as Partial<HasTop>).topWorldPosition === 'function';
}

export class ZoneSystem {
  private readonly zones: Zone[] = [];
  private needsCompact = false;

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
  }

  isPlayerIn(area: Rect): boolean {
    const p = this.ctx.player.position;
    return inRect(area, p.x, p.z);
  }

  update(dt: number): void {
    const p = this.ctx.player.position;
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i]!;
      if (z.removed) continue;
      const inside = z.enabled && inRect(z.area, p.x, p.z);
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
      if (z.markerMaterial) this.animateMarker(z, inside, dt);
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
    }
    return zone;
  }

  private animateMarker(z: Zone, inside: boolean, dt: number): void {
    z.markerLevel = damp(z.markerLevel, inside ? 1 : 0, 14, dt);
    const pulse = inside ? 0.12 * Math.sin(this.ctx.time.elapsed * 9) : 0;
    z.markerMaterial!.opacity = MARKER_IDLE_OPACITY + z.markerLevel * (0.62 - MARKER_IDLE_OPACITY) + pulse * z.markerLevel;
  }
}
