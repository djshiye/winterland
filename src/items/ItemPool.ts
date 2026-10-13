/**
 * [B2 — items] Creates and recycles item visuals.
 *
 * Visuals (centred on origin, sizes from ITEM_SIZE, built with materials.ts toon() + cached
 * geometries, all meshes cast + receive shadows, ≤ 3 meshes per item):
 * - log:   bark cylinder lying along local X with light end-grain caps (PALETTE.woodEnd) and a darker
 *          ring (PALETTE.woodRing) on both ends.
 * - crate: wooden crate cube with a darker edge frame and a belt of slats (PALETTE.crateDark).
 * - cash:  green bill bundle with darker end edges and a pale paper band around the middle.
 * Pooling: release() hides + detaches; create() reuses a hidden item of that kind when available.
 * create() resets the transform (scale 1, identity rotation), makes it visible, adds it to ctx.scene and
 * sets value = ECONOMY.cashBundleValue for cash (or the given value), 0 for goods.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ECONOMY, ITEM_SIZE, PALETTE } from '../config';
import type { GameContext, Item, ItemKind } from '../core/types';
import { toon } from '../render/materials';

// ---------------------------------------------------------------------------
// Shared geometries (built lazily once, never disposed)
// ---------------------------------------------------------------------------

interface LogParts {
  body: THREE.BufferGeometry;
  caps: THREE.BufferGeometry;
}

let logParts: LogParts | null = null;
let crateBody: THREE.BufferGeometry | null = null;
let crateFrame: THREE.BufferGeometry | null = null;
let cashBody: THREE.BufferGeometry | null = null;
let cashBand: THREE.BufferGeometry | null = null;
let cashEdges: THREE.BufferGeometry | null = null;

/** Cylinder lying along X, centred at x = `cx`. */
function disc(radius: number, thickness: number, cx: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radius, radius, thickness, 14).rotateZ(Math.PI / 2).translate(cx, 0, 0);
}

function getLogParts(): LogParts {
  if (logParts) return logParts;
  const { length, radius } = ITEM_SIZE.log;
  const body = new THREE.CylinderGeometry(radius, radius, length, 10).rotateZ(Math.PI / 2);
  const e = length / 2;
  // Groups: ring, end, ring, end (material array order below).
  const caps = mergeGeometries(
    [disc(radius * 0.93, 0.02, -e - 0.002), disc(radius * 0.58, 0.028, -e - 0.004), disc(radius * 0.93, 0.02, e + 0.002), disc(radius * 0.58, 0.028, e + 0.004)],
    true,
  );
  logParts = { body, caps };
  return logParts;
}

function getCrateParts(): { body: THREE.BufferGeometry; frame: THREE.BufferGeometry } {
  if (crateBody && crateFrame) return { body: crateBody, frame: crateFrame };
  const s = ITEM_SIZE.crate.size;
  const t = 0.07; // edge bar thickness
  const o = s / 2 - t / 2;
  crateBody = new THREE.BoxGeometry(s - 0.02, s - 0.02, s - 0.02);
  const bars: THREE.BufferGeometry[] = [];
  for (const a of [-o, o]) {
    for (const b of [-o, o]) {
      bars.push(new THREE.BoxGeometry(s, t, t).translate(0, a, b)); // along X
      bars.push(new THREE.BoxGeometry(t, s, t).translate(a, 0, b)); // along Y
      bars.push(new THREE.BoxGeometry(t, t, s).translate(a, b, 0)); // along Z
    }
  }
  // Slat belt around the middle of the four sides.
  bars.push(new THREE.BoxGeometry(s + 0.012, 0.09, s - 0.1));
  bars.push(new THREE.BoxGeometry(s - 0.1, 0.09, s + 0.012));
  crateFrame = mergeGeometries(bars, false);
  return { body: crateBody, frame: crateFrame };
}

function getCashParts(): { body: THREE.BufferGeometry; band: THREE.BufferGeometry; edges: THREE.BufferGeometry } {
  if (cashBody && cashBand && cashEdges) return { body: cashBody, band: cashBand, edges: cashEdges };
  const { w, h, d } = ITEM_SIZE.cash;
  cashBody = new THREE.BoxGeometry(w, h, d);
  cashBand = new THREE.BoxGeometry(0.09, h + 0.008, d + 0.008);
  const eo = w / 2 - 0.015;
  cashEdges = mergeGeometries(
    [new THREE.BoxGeometry(0.032, h + 0.004, d + 0.004).translate(-eo, 0, 0), new THREE.BoxGeometry(0.032, h + 0.004, d + 0.004).translate(eo, 0, 0)],
    false,
  );
  return { body: cashBody, band: cashBand, edges: cashEdges };
}

function shadowed<T extends THREE.Mesh>(m: T): T {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function buildVisual(kind: ItemKind): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'log') {
    const p = getLogParts();
    g.add(shadowed(new THREE.Mesh(p.body, toon(PALETTE.bark))));
    const ring = toon(PALETTE.woodRing);
    const end = toon(PALETTE.woodEnd);
    g.add(shadowed(new THREE.Mesh(p.caps, [ring, end, ring, end])));
  } else if (kind === 'crate') {
    const p = getCrateParts();
    g.add(shadowed(new THREE.Mesh(p.body, toon(PALETTE.crate))));
    g.add(shadowed(new THREE.Mesh(p.frame, toon(PALETTE.crateDark))));
  } else {
    const p = getCashParts();
    g.add(shadowed(new THREE.Mesh(p.body, toon(PALETTE.cash))));
    g.add(shadowed(new THREE.Mesh(p.edges, toon(PALETTE.cashDark))));
    g.add(shadowed(new THREE.Mesh(p.band, toon(PALETTE.cashBand))));
  }
  return g;
}

// ---------------------------------------------------------------------------

export class ItemPool {
  private nextId = 1;
  private readonly free: Record<ItemKind, Item[]> = { log: [], crate: [], cash: [] };
  private readonly live = new Set<Item>();

  constructor(readonly ctx: GameContext) {}

  /** Check out an item of `kind` (reused from the pool when possible), added to the scene root. */
  create(kind: ItemKind, value?: number): Item {
    let item = this.free[kind].pop();
    if (!item) {
      item = { id: this.nextId++, kind, object: buildVisual(kind), value: 0 };
    }
    item.value = value ?? (kind === 'cash' ? ECONOMY.cashBundleValue : 0);
    const o = item.object;
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.scale.set(1, 1, 1);
    o.visible = true;
    delete o.userData.baseScale;
    this.ctx.scene.add(o);
    this.live.add(item);
    return item;
  }

  /** Return an item to the pool (hidden + detached). Safe to call on items that are mid-air. */
  release(item: Item): void {
    if (!this.live.delete(item)) return; // not checked out (double release)
    this.ctx.tweens.killTweensOf(item.object);
    item.object.removeFromParent();
    item.object.visible = false;
    item.value = 0;
    this.free[item.kind].push(item);
  }

  /** Vertical spacing of this kind when stacked (ITEM_SIZE[kind].stackHeight). */
  stackHeight(kind: ItemKind): number {
    return ITEM_SIZE[kind].stackHeight;
  }

  /** Items currently checked out (for debugging leaks). */
  get liveCount(): number {
    return this.live.size;
  }
}
