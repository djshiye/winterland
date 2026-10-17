/**
 * 0.9.0 "Ages": the new land south of the old map. Built once by the Environment, driven by state.
 *
 * - ROADS (eras/data.ts ROADS): packed-gravel paths with edge stones (city streets: dark cobble, centre dashes). A road
 *   is OPEN when `roadOpen` says so (era 2's roads once the Great Lodge is built, the climb, or era 2 is reached;
 *   later roads once the previous era's pad is offered); open roads become walkable (ColliderWorld.addBounds), the rest
 *   show an untrodden, staked-out strip. The two roads that leave the Market Town (southAvenue, cityLink) also carve a
 *   gap into the town's picket fence + its colliders.
 * - REGION envelopes, one per era 2..10: ground tile in the era's colour (snow-washed while locked), era-styled fence
 *   with a 4 m gate (barrier + chain + FOR SALE sign until unlocked; the leaves swing open on 'era:unlocked'), survey
 *   stakes on every slot while locked, and a few instanced props per era around the machine slots (assets/frontierProps).
 *   An unlocked region is walkable (rect inset 0.6 + the gate opening that joins it to its road).
 * - The whole new land only shows once the Great Lodge is built (eras/gate.ts climbOpen) or era 2 is reached, so
 *   era 1 plays and looks exactly like 0.8.0 up to its finale (docs/EXPANSION.md R2). Far scenery (sparse pines /
 *   rocks) fills the big ground plane around it.
 * - `pruneNewLand` removes old-scatter instances that landed on the new land (the old scatter itself is untouched).
 */
import * as THREE from 'three';
import { LAYOUT, PALETTE, type Rect } from '../../config';
import { eraPropGeometry, PROP_RADIUS, PROP_ROLES, strungWires, type PropRole } from '../../assets/frontierProps';
import { ERAS, REGIONS, RIVER_END_Z, RIVER_POND, ROADS, unlockCash } from '../../eras/data';
import { climbOpen } from '../../eras/gate';
import { plotPlaces, regionLayout, type RegionLayout } from '../../eras/layout';
import { buildPlots, type PlotsPart } from './plots';
import type { GameContext } from '../../core/types';
import { Batch, vcMat } from '../../render/batch';
import { GAME_FONT, geo, makeCanvasTexture, toonUnique } from '../../render/materials';
import { blockedNewLand, instanced, occludesNewLand, Rng, type EnvPart, type Placement } from './common';
import { romanNumeral } from './eras';
import { buildEraOpen, buildEraWild, eraGround, eraKeepOut } from './eraGround';
import { palette } from '../../render/palette';
import { moundGeo, pineGeo, pineTallGeo, rockGeo } from './props';
import { buildWayfinding } from './wayfinding';

/** The slice of the game state the new land follows (the tests pass a plain object). */
export interface LandState {
  village: { greatLodge: { tier: number } };
  eras: { age: number };
}

/**
 * True once a road is open for walking. `opensAt` 2: era 2's pad is previewed or offered (the Great Lodge is built) or
 * era 2 is reached; `opensAt` n > 2: the previous era is reached (age ≥ n − 1). Pure.
 */
export function roadOpen(s: LandState, opensAt: number): boolean {
  if (opensAt <= 2) return landVisible(s);
  return s.eras.age >= opensAt - 1;
}

/** True when the new land is drawn at all (the Great Lodge built or era 2 reached): era 1 stays 0.8.0. Pure. */
export function landVisible(s: LandState): boolean {
  return climbOpen(s) || s.eras.age >= 2;
}

/** Walk rect of an unlocked region: its rect inset 0.6. Pure. */
export function regionWalk(l: RegionLayout): Rect {
  const r = l.rect;
  return { minX: r.minX + 0.6, maxX: r.maxX - 0.6, minZ: r.minZ + 0.6, maxZ: r.maxZ - 0.6 };
}

/** Walk rect of a region's gate opening: 3.4 m wide, reaching 1.2 m out onto the road and 1.2 m into the region. Pure. */
export function gateWalk(l: RegionLayout): Rect {
  const z0 = l.gate.z - l.inward * 1.2;
  const z1 = l.gate.z + l.inward * 1.2;
  return { minX: l.gate.x - 1.7, maxX: l.gate.x + 1.7, minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) };
}

/** Walk rect of a region's market gate (0.9.5): 2.4 m wide, reaching 1.2 m out onto the road and 1.2 m in. Pure. */
export function marketGateWalk(l: RegionLayout): Rect {
  const g = l.marketGate;
  const z0 = g.z - l.inward * 1.2;
  const z1 = g.z + l.inward * 1.2;
  return { minX: g.x - g.width / 2 + 0.3, maxX: g.x + g.width / 2 - 0.3, minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) };
}

/** The Market Town fence's south edge (where the south avenue leaves). */
const TOWN_SOUTH = LAYOUT.town.area.maxZ;

/** The gap the Market Town's fence gets when a road leaves the town through it (carved when the road opens). */
const TOWN_GAPS: Record<string, { gap: Rect; wall: Rect; walk?: Rect }> = {
  // `walk` joins the square's walk rect to the avenue between the south lots (0.9.4: both follow the stretched town)
  southAvenue: {
    gap: { minX: 26, maxX: 30, minZ: TOWN_SOUTH - 0.3, maxZ: TOWN_SOUTH + 0.3 },
    wall: { minX: 26, maxX: 30, minZ: TOWN_SOUTH - 0.4, maxZ: TOWN_SOUTH + 0.4 },
    walk: { minX: 26.2, maxX: 29.8, minZ: LAYOUT.town.square.maxZ - 0.2, maxZ: TOWN_SOUTH + 0.2 },
  },
  cityLink: { gap: { minX: 37.7, maxX: 38.3, minZ: 19, maxZ: 23 }, wall: { minX: 37.8, maxX: 38.2, minZ: 19, maxZ: 23 } },
};

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const shade = (c: number, k: number): number => {
  const col = new THREE.Color(c);
  col.r = Math.min(1, col.r * k);
  col.g = Math.min(1, col.g * k);
  col.b = Math.min(1, col.b * k);
  return col.getHex();
};
const mix = (a: number, b: number, t: number): number => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const easeBack = (t: number): number => {
  const c1 = 1.1;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const short = (v: number): string => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1e3)}K`);

export interface FrontierPart extends EnvPart {
  /** Re-read the state (roads, regions, visibility); `hintEra` = an era that was just unlocked (events fire first). */
  refresh(hintEra?: number): void;
}

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

/**
 * Delete every instance whose ground position satisfies `drop` from all InstancedMeshes under `root` (compacting the
 * buffers). Returns how many were removed.
 */
export function pruneInstances(root: THREE.Object3D, drop: (x: number, z: number) => boolean): number {
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let removed = 0;
  root.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh) return;
    let w = 0;
    const n = im.count;
    for (let i = 0; i < n; i++) {
      im.getMatrixAt(i, m);
      if (drop(m.elements[12]!, m.elements[14]!)) continue;
      if (w !== i) {
        im.setMatrixAt(w, m);
        if (im.instanceColor) {
          im.getColorAt(i, c);
          im.setColorAt(w, c);
        }
      }
      w++;
    }
    if (w === n) return;
    removed += n - w;
    im.count = w;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    if (w === 0) im.visible = false;
    else im.computeBoundingSphere();
  });
  return removed;
}

/**
 * The old scatter (pines, rocks, mounds, drifts) is built exactly as before 0.9.0 so no existing tree moves; this
 * deletes the instances that landed on, or would hide, the new land.
 */
export function pruneNewLand(decor: THREE.Object3D): number {
  return pruneInstances(decor, (x, z) => blockedNewLand(x, z, 0.5) || occludesNewLand(x, z, 4.2));
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

interface RoadVis {
  id: string;
  opensAt: number;
  rect: Rect;
  open: THREE.Mesh;
  ghost: THREE.Mesh;
  walked: boolean;
}

const inRect = (r: Rect, x: number, z: number, m = 0): boolean => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m;

/** Zones next to region gates where road edge stones must not stand (the gate opening is a path, not a kerb). */
function gateZones(): Rect[] {
  const out: Rect[] = [];
  for (let n = 2; n < REGIONS.length; n++) {
    if (!REGIONS[n]) continue;
    const l = regionLayout(n);
    out.push({ minX: l.gate.x - 2.8, maxX: l.gate.x + 2.8, minZ: l.gate.z - 1.5, maxZ: l.gate.z + 1.5 });
    out.push({ minX: l.marketGate.x - 2.3, maxX: l.marketGate.x + 2.3, minZ: l.marketGate.z - 1.5, maxZ: l.marketGate.z + 1.5 });
  }
  return out;
}

function buildRoad(i: number, road: (typeof ROADS)[number], rng: Rng, zones: readonly Rect[]): { open: THREE.Mesh; ghost: THREE.Mesh } {
  const r = road.rect;
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  const city = road.id.startsWith('city');
  const alongX = w >= d;
  const y = 0.03 + i * 0.0016;
  const others = ROADS.filter((o) => o.id !== road.id).map((o) => o.rect);
  const skip = (x: number, z: number): boolean => zones.some((q) => inRect(q, x, z)) || others.some((q) => inRect(q, x, z, 0.1));

  // ---- open: surface, edge stones, ruts / dashes
  const b = new Batch();
  b.add(geo.box(w, 0.05, d), city ? 0x4b4e57 : 0xc9c0b0, cx, y - 0.025, cz);
  const kerb = city ? 0x9a9ca6 : 0x8f8a80;
  const len = alongX ? w : d;
  for (let t = 1.0; t < len - 0.5; t += rng.range(2.4, 3.2)) {
    for (const side of [-1, 1]) {
      const along = (alongX ? r.minX : r.minZ) + t;
      const across = (alongX ? cz : cx) + side * ((alongX ? d : w) / 2 - 0.12);
      const x = alongX ? along : across;
      const z = alongX ? across : along;
      if (skip(x, z)) continue;
      const sl = rng.range(0.4, 0.7);
      const tint = shade(kerb, rng.range(0.85, 1.1));
      b.add(geo.box(alongX ? sl : 0.26, 0.14, alongX ? 0.26 : sl), tint, x, y + 0.05, z, { ry: rng.range(-0.15, 0.15) });
    }
  }
  if (city) {
    for (let t = 1.5; t < len - 1.5; t += 3.2) {
      const x = alongX ? r.minX + t : cx;
      const z = alongX ? cz : r.minZ + t;
      if (skip(x, z)) continue;
      b.add(geo.box(alongX ? 1.2 : 0.12, 0.012, alongX ? 0.12 : 1.2), 0xf0e6b0, x, y + 0.008, z);
    }
  } else {
    for (const side of [-0.8, 0.8]) {
      b.add(geo.box(alongX ? w - 1 : 0.34, 0.012, alongX ? 0.34 : d - 1), 0xb3a995, alongX ? cx : cx + side, y + 0.008, alongX ? cz + side : cz);
    }
  }
  const open = b.mesh({ cast: false, receive: true });

  // ---- ghost: faint untrodden strip with surveyor stakes
  const g = new Batch();
  g.add(geo.box(w, 0.03, d), 0xdfe8f4, cx, 0.016 + i * 0.0006, cz);
  for (let t = 2; t < len - 1; t += 9) {
    for (const side of [-1, 1]) {
      const along = (alongX ? r.minX : r.minZ) + t;
      const across = (alongX ? cz : cx) + side * ((alongX ? d : w) / 2 - 0.15);
      const x = alongX ? along : across;
      const z = alongX ? across : along;
      if (skip(x, z)) continue;
      g.add(geo.box(0.07, 0.8, 0.07), 0x8a6a46, x, 0.4, z);
      g.add(geo.box(0.3, 0.17, 0.03), 0xd0453a, x + 0.15, 0.72, z);
    }
  }
  const ghost = g.mesh({ cast: false, receive: true });
  return { open, ghost };
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

type FenceKind = 'timber' | 'stone' | 'iron' | 'steel' | 'chain' | 'barbed' | 'panel' | 'hazard' | 'energy';
const FENCE_KIND: Record<number, FenceKind> = { 2: 'timber', 3: 'stone', 4: 'iron', 5: 'steel', 6: 'chain', 7: 'barbed', 8: 'panel', 9: 'hazard', 10: 'energy' };
const SPACING: Record<FenceKind, number> = { timber: 2.4, stone: 3.2, iron: 3.0, steel: 3.0, chain: 3.0, barbed: 3.0, panel: 3.0, hazard: 3.0, energy: 3.0 };
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });

interface Palette {
  fence: number;
  dark: number;
  light: number;
  accent: number;
  trim: number;
}

/** One straight fence run (posts + infill) along `axis` at the fixed coordinate `at`, from `a0` to `a1`. */
function fenceRun(b: Batch, glow: Batch, kind: FenceKind, c: Palette, axis: 'x' | 'z', at: number, a0: number, a1: number): void {
  const len = a1 - a0;
  if (len < 0.3) return;
  const n = Math.max(1, Math.round(len / SPACING[kind]));
  const step = len / n;
  const put = (batch: Batch, along: number, h: number, thick: number, color: number, mid: number, y0: number): void => {
    if (axis === 'x') batch.add(geo.box(along, h, thick), color, mid, y0 + h / 2, at);
    else batch.add(geo.box(thick, h, along), color, at, y0 + h / 2, mid);
  };
  const post = (p: number, w: number, h: number, color: number): void => put(b, w, h, w, color, p, 0);
  for (let i = 0; i <= n; i++) {
    const p = a0 + i * step;
    switch (kind) {
      case 'timber':
        post(p, 0.16, 1.15, c.fence);
        put(b, 0.22, 0.05, 0.22, PALETTE.snow, p, 1.15);
        break;
      case 'stone':
        post(p, 0.7, 1.05, c.light);
        put(b, 0.8, 0.1, 0.8, c.dark, p, 1.05);
        put(b, 0.74, 0.05, 0.74, PALETTE.snow, p, 1.15);
        break;
      case 'iron':
        post(p, 0.14, 1.5, c.dark);
        put(b, 0.2, 0.12, 0.2, c.accent, p, 1.5);
        break;
      case 'steel':
        post(p, 0.26, 1.6, c.dark);
        put(b, 0.34, 0.06, 0.34, PALETTE.snow, p, 1.6);
        break;
      case 'chain':
        post(p, 0.1, 1.6, c.light);
        break;
      case 'barbed':
        post(p, 0.1, 1.75, c.light);
        put(b, 0.14, 0.2, 0.14, c.accent, p, 1.4);
        break;
      case 'panel':
        post(p, 0.16, 1.5, c.light);
        put(glow, 0.12, 0.12, 0.12, c.accent, p, 1.55);
        break;
      case 'hazard':
        post(p, 0.5, 0.9, 0x8d8f8a);
        put(b, 0.08, 0.8, 0.08, c.fence, p, 0.9);
        break;
      case 'energy':
        post(p, 0.14, 1.7, c.trim);
        put(glow, 0.2, 0.2, 0.2, c.accent, p, 1.75);
        break;
    }
  }
  for (let i = 0; i < n; i++) {
    const s0 = a0 + i * step;
    const mid = s0 + step / 2;
    const l = step - 0.1;
    switch (kind) {
      case 'timber':
        put(b, l, 0.09, 0.07, c.dark, mid, 0.3);
        put(b, l, 0.09, 0.07, c.dark, mid, 0.78);
        put(b, l, 0.04, 0.09, PALETTE.snow, mid, 0.87);
        break;
      case 'stone':
        put(b, l, 0.7, 0.5, c.fence, mid, 0);
        put(b, l, 0.08, 0.6, c.dark, mid, 0.7);
        put(b, l, 0.05, 0.5, PALETTE.snow, mid, 0.78);
        break;
      case 'iron': {
        put(b, l, 0.06, 0.06, c.dark, mid, 0.12);
        put(b, l, 0.06, 0.06, c.dark, mid, 1.15);
        const bars = Math.max(2, Math.floor(l / 0.5));
        for (let k = 0; k < bars; k++) put(b, 0.035, 1.25, 0.035, c.fence, s0 + 0.05 + ((k + 0.5) * l) / bars, 0.1);
        break;
      }
      case 'steel':
        put(b, l, 1.1, 0.1, c.fence, mid, 0.15);
        put(b, l, 0.1, 0.16, c.dark, mid, 1.25);
        put(b, l * 0.5, 0.14, 0.12, c.accent, mid, 0.6);
        break;
      case 'chain':
      case 'barbed': {
        const top = kind === 'chain' ? 1.55 : 1.7;
        put(b, l, 0.05, 0.05, c.light, mid, top);
        for (let y = 0.15; y < top; y += 0.3) put(b, l, 0.015, 0.015, 0xaab4bb, mid, y);
        break;
      }
      case 'panel':
        put(b, l, 1.15, 0.08, c.fence, mid, 0.15);
        put(b, l, 0.05, 0.1, c.light, mid, 1.3);
        put(glow, l, 0.03, 0.09, c.accent, mid, 0.75);
        break;
      case 'hazard': {
        put(b, l, 0.7, 0.4, 0x8d8f8a, mid, 0);
        const k = Math.max(2, Math.floor(l / 0.5));
        for (let j = 0; j < k; j++) put(b, l / k, 0.12, 0.42, j % 2 ? 0x3d5259 : 0xe8c45a, s0 + 0.05 + ((j + 0.5) * l) / k, 0.7);
        for (const y of [1.0, 1.3, 1.6]) put(b, l, 0.015, 0.015, c.fence, mid, y);
        break;
      }
      case 'energy':
        put(b, l, 0.35, 0.2, c.trim, mid, 0);
        put(glow, l, 0.04, 0.04, c.accent, mid, 0.85);
        put(glow, l, 0.04, 0.04, c.accent, mid, 1.35);
        break;
    }
  }
}

/** One gate leaf (hinge at the local origin, extends along dir·X). */
function leafGeometry(kind: FenceKind, c: Palette, dir: 1 | -1): THREE.BufferGeometry {
  const L = 1.85;
  const H = kind === 'stone' || kind === 'timber' ? 1.2 : 1.45;
  const b = new Batch();
  const mid = (dir * L) / 2;
  b.add(geo.box(L, 0.08, 0.07), c.dark, mid, H - 0.1, 0.08);
  b.add(geo.box(L, 0.08, 0.07), c.dark, mid, 0.22, 0.08);
  for (const x of [0.05, L - 0.05]) b.add(geo.box(0.1, H, 0.09), c.dark, dir * x, H / 2, 0.08);
  const bars = Math.round(L / 0.24);
  for (let i = 1; i < bars; i++) b.add(geo.box(0.03, H - 0.3, 0.03), c.fence, dir * ((i * L) / bars), H / 2, 0.08);
  const ang = Math.atan2(H - 0.4, dir * (L - 0.2));
  b.add(geo.box(Math.hypot(L - 0.2, H - 0.4), 0.05, 0.04), c.accent, dir * (L / 2), H / 2, 0.12, { rz: ang });
  return b.geometry();
}

function signTexture(n: number): { texture: THREE.CanvasTexture; paint: (locked: boolean) => void } {
  const e = ERAS[n]!;
  const { canvas, ctx: g, texture } = makeCanvasTexture(512, 256);
  const paint = (locked: boolean): void => {
    g.fillStyle = hex(shade(e.colors.trim, 0.8));
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = hex(mix(e.colors.accent, 0xffffff, 0.2));
    g.fillRect(10, 10, canvas.width - 20, canvas.height - 20);
    g.fillStyle = hex(shade(e.colors.trim, 0.7));
    g.fillRect(18, 18, canvas.width - 36, canvas.height - 36);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    let size = 64;
    g.font = `bold ${size}px ${GAME_FONT}`;
    const name = e.region.toUpperCase();
    while (g.measureText(name).width > canvas.width - 70 && size > 28) {
      size -= 4;
      g.font = `bold ${size}px ${GAME_FONT}`;
    }
    g.lineWidth = 10;
    g.strokeStyle = '#1b1a1a';
    g.strokeText(name, canvas.width / 2, 78);
    g.fillStyle = '#fff6e0';
    g.fillText(name, canvas.width / 2, 78);
    g.font = `bold 34px ${GAME_FONT}`;
    g.fillStyle = hex(mix(e.colors.accent, 0xffffff, 0.45));
    g.fillText(`ERA ${romanNumeral(n)} · ${e.name.toUpperCase()}`, canvas.width / 2, 132);
    if (locked) {
      g.fillStyle = '#d0453a';
      g.fillRect(60, 160, canvas.width - 120, 62);
      g.fillStyle = '#ffffff';
      g.font = `bold 44px ${GAME_FONT}`;
      g.fillText(`FOR SALE  $${short(unlockCash(n))}`, canvas.width / 2, 192);
    } else {
      g.fillStyle = '#2e9c48';
      g.fillRect(60, 160, canvas.width - 120, 62);
      g.fillStyle = '#ffffff';
      g.font = `bold 44px ${GAME_FONT}`;
      g.fillText('OPEN FOR BUSINESS', canvas.width / 2, 192);
    }
    texture.needsUpdate = true;
  };
  texture.anisotropy = 8;
  return { texture, paint };
}

interface Region {
  n: number;
  layout: RegionLayout;
  group: THREE.Group;
  unlocked: boolean;
  /** Gate swing 0..1 and ground colour blend 0..1 (animated after an unlock). */
  gateK: number;
  colorK: number;
  animating: boolean;
  leafL: THREE.Group;
  leafR: THREE.Group;
  ground: THREE.MeshToonMaterial;
  lock: THREE.Object3D;
  survey: THREE.Object3D;
  zones: THREE.Object3D;
  /** 0.9.7: the era's places (huts, market street, yard floor, field), built once the region is bought. */
  places: PlotsPart | null;
  paintSign: (locked: boolean) => void;
  lockedColor: number;
  openColor: number;
}

const inZone = (q: Rect, x: number, z: number, m: number): boolean => x > q.minX - m && x < q.maxX + m && z > q.minZ - m && z < q.maxZ + m;

/**
 * 0.9.5: the packed-snow paths that join a region's zones (2.2 m wide, world rects): along the yard's inner edge from
 * the west fence to the market, down the line between the west column and the market / huts, and along the line
 * between processing and harvest. Pure.
 */
export function regionPaths(l: RegionLayout): Rect[] {
  const Z = l.zones;
  const h = 1.1;
  const yardIn = l.inward > 0 ? Z.yard.maxZ : Z.yard.minZ;
  const procOut = l.inward > 0 ? Z.processing.maxZ : Z.processing.minZ;
  const split = Z.yard.maxX;
  const zLo = Math.min(yardIn, l.inward > 0 ? l.rect.maxZ - 1 : l.rect.minZ + 1);
  const zHi = Math.max(yardIn, l.inward > 0 ? l.rect.maxZ - 1 : l.rect.minZ + 1);
  return [
    { minX: l.rect.minX + 1, maxX: split + h, minZ: yardIn - h, maxZ: yardIn + h },
    { minX: split - h, maxX: split + h, minZ: zLo, maxZ: zHi },
    { minX: l.rect.minX + 1, maxX: split, minZ: procOut - h, maxZ: procOut + h },
  ];
}

/**
 * Does a prop of footprint radius `rad` at (x, z) fit inside region n? 0.9.5: props dress only the harvest zone (the
 * era's wild ground), clear of the paths; the yard, processing, market and huts stay clear for what lives there.
 */
function propFree(l: RegionLayout, x: number, z: number, rad: number): boolean {
  const r = l.rect;
  if (x < r.minX + rad + 0.9 || x > r.maxX - rad - 0.9 || z < r.minZ + rad + 0.9 || z > r.maxZ - rad - 0.9) return false;
  const H = l.zones.harvest;
  if (!(x > H.minX + rad + 0.6 && x < H.maxX - rad - 0.6 && z > H.minZ + rad + 0.6 && z < H.maxZ - rad - 0.6)) return false;
  if (inZone(nodePatch(l), x, z, rad + 0.3)) return false;
  // 0.9.7: the harvest field's resource beds (world/env/plots.ts) keep their own ground
  if (inZone(plotPlaces(l.n).field, x, z, rad + 0.3)) return false;
  // 0.9.8: landmarks an era's world module builds itself (world/env/eraGround.ts)
  if (eraKeepOut(l.n, l).some((q) => inZone(q, x, z, rad + 0.3))) return false;
  return !regionPaths(l).some((q) => inZone(q, x, z, rad + 0.3));
}

/** The hand node's patch kept clear of props: the node (r ≈ 2.2 m), its pile 2.6 m to the right and the take mat. Pure. */
export function nodePatch(l: RegionLayout): Rect {
  const n = l.node;
  return { minX: n.x - 4, maxX: n.x + 6, minZ: n.z - 3.5, maxZ: n.z + 3.5 };
}

function buildRegion(ctx: GameContext, n: number, root: THREE.Group): Region {
  const e = ERAS[n]!;
  const l = regionLayout(n);
  const r = l.rect;
  const kind = FENCE_KIND[n]!;
  const rng = new Rng(7000 + n * 101);
  const group = new THREE.Group();
  group.name = `region${n}`;
  const W = r.maxX - r.minX;
  const D = r.maxZ - r.minZ;
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  const pal: Palette = { fence: e.colors.fence, dark: shade(e.colors.fence, 0.7), light: shade(e.colors.fence, 1.3), accent: e.colors.accent, trim: e.colors.trim };

  // ---- ground tile (+ worn patches / ruts); 0.9.8: the era's board colour (palette floor.board, world/env/eraGround.ts)
  const mod = eraGround(n);
  const boardColor = palette(n).floor.board;
  const lockedColor = mix(boardColor, 0xf4f8ff, mod ? 0.62 : 0.5);
  const ground = toonUnique(lockedColor);
  const tile = new THREE.Mesh(geo.ground(W, D), ground);
  const gy = 0.014;
  // 0.9.5 plots are 3–11× the 0.9.3 ones: dressing scales with the side length, not the area (keeps them airy)
  const grow = Math.sqrt((W * D) / 720);
  tile.position.set(cx, gy, cz);
  tile.receiveShadow = true;
  group.add(tile);
  const decals = new Batch();
  const nDecals = mod?.wild ? 0 : Math.round(16 * grow);
  for (let i = 0; i < nDecals; i++) {
    const s = rng.range(0.8, 2.2);
    const col = shade(e.colors.ground, rng.next() < 0.6 ? 0.94 : 1.04);
    decals.add(geo.circleGround(1, 10), col, rng.range(r.minX + 2, r.maxX - 2), gy + 0.004 + (i % 16) * 0.0004, rng.range(r.minZ + 2, r.maxZ - 2), { sx: s, sz: s * rng.range(0.6, 1.0), ry: rng.range(0, 3) });
  }
  const rutLen = 14;
  if (!mod?.wild) for (const dx of [-0.9, 0.9]) decals.add(geo.box(0.4, 0.012, rutLen), shade(e.colors.ground, 0.78), l.gate.x + dx, gy + 0.008, l.gate.z + l.inward * (rutLen / 2 + 0.5));
  // a worn footpath from the market gate into the market
  if (!mod?.wild) decals.add(geo.box(1.6, 0.012, 6), shade(e.colors.ground, 0.86), l.marketGate.x, gy + 0.008, l.marketGate.z + l.inward * 3.2);
  const decalMesh = decals.empty ? new THREE.Group() : decals.mesh({ cast: false, receive: true });

  // ---- 0.9.5 zones: a soft ground tint per zone and the paths between them (shown once the region is bought)
  const zb = new Batch();
  const Z = l.zones;
  const tint: [Rect, number][] = [
    [Z.yard, shade(e.colors.ground, 0.9)],
    [Z.processing, shade(e.colors.ground, 0.96)],
    [Z.market, mix(shade(e.colors.ground, 1.06), 0xffe9c4, 0.18)],
    [Z.huts, mix(shade(e.colors.ground, 1.04), 0xfff4e0, 0.22)],
  ];
  for (const [q, c] of tint) {
    const w = q.maxX - q.minX - 1.6;
    const d = q.maxZ - q.minZ - 1.6;
    if (w > 0 && d > 0) zb.add(geo.box(w, 0.01, d), c, (q.minX + q.maxX) / 2, gy + 0.001, (q.minZ + q.maxZ) / 2);
  }
  for (const q of regionPaths(l)) zb.add(geo.box(q.maxX - q.minX, 0.012, q.maxZ - q.minZ), shade(e.colors.ground, 0.8), (q.minX + q.maxX) / 2, gy + 0.003, (q.minZ + q.maxZ) / 2);
  // an era module lays its own zone floors and paths instead (built now, shown on unlock like the tints)
  const zonesMesh: THREE.Object3D = (mod?.open ? buildEraOpen(n, l, plotPlaces(n)) : null) ?? zb.mesh({ cast: false, receive: true });
  zonesMesh.visible = false;
  group.add(zonesMesh);
  group.add(decalMesh);
  const wild = buildEraWild(n, l);
  if (wild) group.add(wild);

  // ---- fence with the gate gap, the gate arch
  const fb = new Batch();
  const gb = new Batch();
  const gx = l.gate.x;
  const gapA = gx - l.gate.width / 2;
  const gapB = gx + l.gate.width / 2;
  const gateAtMin = l.gate.side === 'north';
  const gateEdge = gateAtMin ? r.minZ : r.maxZ;
  const farEdge = gateAtMin ? r.maxZ : r.minZ;
  const mg = l.marketGate;
  const mgA = mg.x - mg.width / 2;
  const mgB = mg.x + mg.width / 2;
  fenceRun(fb, gb, kind, pal, 'x', gateEdge, r.minX, gapA);
  fenceRun(fb, gb, kind, pal, 'x', gateEdge, gapB, mgA);
  fenceRun(fb, gb, kind, pal, 'x', gateEdge, mgB, r.maxX);
  // the market gate: two posts with an awning beam in the era's accent colour (no leaves: customers walk right in)
  for (const x of [mgA, mgB]) {
    fb.add(geo.box(0.26, 2.3, 0.26), pal.dark, x, 1.15, mg.z);
    fb.add(geo.box(0.34, 0.05, 0.34), PALETTE.snow, x, 2.32, mg.z);
  }
  fb.add(geo.box(mg.width + 0.5, 0.18, 0.24), pal.dark, mg.x, 2.15, mg.z);
  for (let i = 0; i < 6; i++) fb.add(geo.box((mg.width + 0.4) / 6 - 0.03, 0.3, 0.06), i % 2 ? 0xfff3dc : pal.accent, mgA - 0.2 + ((i + 0.5) * (mg.width + 0.4)) / 6, 1.9, mg.z - l.inward * 0.14);
  fenceRun(fb, gb, kind, pal, 'x', farEdge, r.minX, r.maxX);
  fenceRun(fb, gb, kind, pal, 'z', r.minX, r.minZ, r.maxZ);
  fenceRun(fb, gb, kind, pal, 'z', r.maxX, r.minZ, r.maxZ);
  // gate posts + crossbeam + banner
  for (const x of [gapA, gapB]) {
    fb.add(geo.box(0.34, 2.7, 0.34), pal.dark, x, 1.35, l.gate.z);
    fb.add(geo.box(0.44, 0.06, 0.44), PALETTE.snow, x, 2.73, l.gate.z);
  }
  fb.add(geo.box(l.gate.width + 0.8, 0.22, 0.3), pal.dark, gx, 2.55, l.gate.z);
  fb.add(geo.box(1.4, 0.4, 0.06), pal.accent, gx, 2.1, l.gate.z - l.inward * 0.16);
  fb.add(geo.box(l.gate.width + 0.7, 0.05, 0.38), PALETTE.snow, gx, 2.68, l.gate.z);
  const fence = fb.mesh({ cast: true, receive: true });
  group.add(fence);
  if (!gb.empty) {
    const glow = gb.mesh({ cast: false, receive: false, material: GLOW });
    group.add(glow);
  }

  // ---- gate leaves + the "closed" chain
  const mkLeaf = (hinge: number, dir: 1 | -1): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(hinge, 0, l.gate.z);
    const m = new THREE.Mesh(leafGeometry(kind, pal, dir), vcMat());
    m.castShadow = true;
    pivot.add(m);
    group.add(pivot);
    return pivot;
  };
  const leafL = mkLeaf(gapA + 0.1, 1);
  const leafR = mkLeaf(gapB - 0.1, -1);
  const lb = new Batch();
  lb.add(geo.box(3.7, 0.06, 0.06), 0x2a2a2a, gx, 0.8, l.gate.z - l.inward * 0.18);
  lb.add(geo.box(0.62, 0.42, 0.07), 0xd0453a, gx, 0.8, l.gate.z - l.inward * 0.2);
  lb.add(geo.box(0.34, 0.08, 0.09), 0xffffff, gx, 0.8, l.gate.z - l.inward * 0.21);
  const lock = lb.mesh({ cast: false });
  group.add(lock);

  // ---- survey stakes on every slot while the region is for sale
  const sb = new Batch();
  for (const s of l.slots) {
    const h = l.cell / 2 - 0.9;
    const v = l.rowPitch / 2 - 0.9;
    for (const [dx, dz] of [[-h, -v], [h, -v], [-h, v], [h, v]] as const) {
      sb.add(geo.box(0.07, 0.8, 0.07), 0x8a6a46, s.x + dx, 0.4, s.z + dz);
      sb.add(geo.box(0.3, 0.17, 0.03), 0xd0453a, s.x + dx + 0.15, 0.72, s.z + dz, { ry: 0.5 });
    }
  }
  const survey = sb.mesh({ cast: false });
  group.add(survey);

  // ---- sign by the gate
  const { texture, paint } = signTexture(n);
  const board = new THREE.Group();
  board.position.set(l.sign.x, 0, l.sign.z);
  board.rotation.y = Math.PI / 4;
  const pb = new Batch();
  for (const x of [-1.5, 1.5]) {
    pb.add(geo.box(0.18, 2.7, 0.18), pal.dark, x, 1.35, -0.1);
    pb.add(geo.box(0.26, 0.06, 0.26), PALETTE.snow, x, 2.72, -0.1);
  }
  const posts = pb.mesh({ cast: true });
  board.add(posts);
  const boardMesh = new THREE.Mesh(geo.box(3.4, 1.7, 0.12), [shade(e.colors.trim, 0.7), shade(e.colors.trim, 0.7), shade(e.colors.trim, 0.7), shade(e.colors.trim, 0.7)].map((c) => toonUnique(c)).concat([toonUnique(0xffffff, { map: texture }), toonUnique(shade(e.colors.trim, 0.7))]));
  boardMesh.position.set(0, 1.95, 0);
  boardMesh.castShadow = true;
  board.add(boardMesh);
  group.add(board);
  void document.fonts?.ready.then(() => paint(!reg.unlocked));

  // ---- era props around the slots
  const placed: { x: number; z: number; r: number }[] = [];
  const spot = (x: number, z: number, rad: number): boolean => {
    if (!propFree(l, x, z, rad)) return false;
    return placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + rad);
  };
  const byRole: Record<PropRole, Placement[]> = { tall: [], mid: [], low: [] };
  // tall: a row down the west strip (the camera looks toward -X/-Z, so they hide nothing there); an era module
  // (world/env/eraGround.ts) with its own wild dressing places its props itself
  const zStep = n === 6 ? 7.5 : 5.5;
  for (let z = r.minZ + 2; !mod?.wild && z < r.maxZ - 1.5 && byRole.tall.length < 6; z += zStep) {
    const x = r.minX + 2.0 + (n === 6 ? 0 : rng.range(-0.3, 0.5));
    if (!spot(x, z, PROP_RADIUS.tall)) continue;
    placed.push({ x, z, r: PROP_RADIUS.tall });
    byRole.tall.push({ x, z, ry: n === 6 ? 0 : rng.range(0, 6.28), sx: rng.range(0.95, 1.1), tint: 1 });
  }
  for (const [role, base] of [['mid', 9], ['low', 16]] as const) {
    const count = Math.round(base * Math.sqrt(grow));
    for (let t = 0; !mod?.wild && t < 400 * grow && byRole[role].length < count; t++) {
      const x = rng.range(r.minX + 1, r.maxX - 1);
      const z = rng.range(r.minZ + 1, r.maxZ - 1);
      const s = rng.range(0.85, 1.15);
      if (!spot(x, z, PROP_RADIUS[role] * s)) continue;
      placed.push({ x, z, r: PROP_RADIUS[role] * s });
      byRole[role].push({ x, z, ry: rng.range(0, 6.28), sx: s, tint: rng.range(0.92, 1.05) });
    }
  }
  for (const role of PROP_ROLES) {
    if (byRole[role].length) group.add(instanced(eraPropGeometry(n, role), vcMat(), byRole[role], { cast: role !== 'low', receive: true }));
  }
  if (n === 6 && !mod?.wild) {
    const wires = strungWires(byRole.tall);
    if (wires) group.add(new THREE.Mesh(wires, vcMat()));
  }

  root.add(group);
  const reg: Region = { n, layout: l, group, unlocked: false, gateK: 0, colorK: 0, animating: false, leafL, leafR, ground, lock, survey, zones: zonesMesh, places: null, paintSign: paint, lockedColor, openColor: boardColor };
  paint(true);
  void ctx;
  return reg;
}

function applyRegion(reg: Region): void {
  const inward = reg.layout.inward;
  const swing = (Math.PI / 2) * 0.94 * easeBack(Math.min(1, reg.gateK));
  reg.leafL.rotation.y = -inward * swing;
  reg.leafR.rotation.y = inward * swing;
  reg.ground.color.setHex(mix(reg.lockedColor, reg.openColor, Math.min(1, reg.colorK)));
}

// ---------------------------------------------------------------------------
// Town fence gaps
// ---------------------------------------------------------------------------

/** Open a gap in the Market Town's fence (picket instances + 'town:fence' wall colliders) where a road leaves the town. */
function carveTownGap(ctx: GameContext, town: THREE.Object3D, road: string): void {
  const spec = TOWN_GAPS[road];
  if (!spec) return;
  pruneInstances(town, (x, z) => inRect(spec.gap, x, z));
  if (spec.walk) ctx.colliders.addBounds(spec.walk);
  ctx.colliders.carve('town:fence', spec.wall);
}

// ---------------------------------------------------------------------------
// Where the old map meets the new land (0.9.5)
// ---------------------------------------------------------------------------

/**
 * The seams between era 1 and the new land, shown only with the new land: the frozen pond the river ends in (it used
 * to stop dead in the snow) and the snow over its channel past the pond. (0.9.9: the Timber Ridge rail ends at its own
 * buffer stop north of the Market Town, assets/ridgeScenery.ts.)
 */
function buildSeams(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'seams';
  const b = new Batch();
  const rv = LAYOUT.river;

  // ---- the river past its pond is snowed over (it used to run on under R1 into era II's plot)
  b.add(geo.box(rv.maxX - rv.minX + 0.6, 0.02, rv.maxZ - RIVER_END_Z + 0.4), PALETTE.snow, (rv.minX + rv.maxX) / 2, 0.006, (RIVER_END_Z + rv.maxZ) / 2);

  // ---- frozen pond where the river ends: an ice oval over the channel's last metres, a snowy rim, skate swirls
  const P = RIVER_POND;
  const pcx = (P.minX + P.maxX) / 2;
  const pcz = (P.minZ + P.maxZ) / 2;
  const rx = (P.maxX - P.minX) / 2;
  const rz = (P.maxZ - P.minZ) / 2;
  b.add(geo.circleGround(1, 36), 0xf4f8ff, pcx, 0.018, pcz, { sx: rx + 0.7, sz: rz + 0.7 });
  b.add(geo.circleGround(1, 36), 0xbfdcf0, pcx, 0.024, pcz, { sx: rx, sz: rz });
  b.add(geo.circleGround(1, 28), 0xd7ebf8, pcx - 0.8, 0.028, pcz + 0.6, { sx: rx * 0.62, sz: rz * 0.55 });
  // the river runs under the ice: a darker band fading into the pond from its north edge
  b.add(geo.box(rv.maxX - rv.minX - 0.4, 0.004, 3.2), 0x9fc7e3, (rv.minX + rv.maxX) / 2, 0.03, P.minZ + 1.9);
  const rng = new Rng(5150);
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2);
    b.add(geo.box(rng.range(1.2, 2.6), 0.004, 0.06), 0xeef6fd, pcx + Math.cos(a) * rx * 0.4, 0.034, pcz + Math.sin(a) * rz * 0.4, { ry: rng.range(0, Math.PI) });
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const s = rng.range(0.25, 0.5);
    b.add(geo.box(s, s * 0.6, s), rng.next() < 0.5 ? PALETTE.rock : 0xe9eff7, pcx + Math.cos(a) * (rx + 0.35), s * 0.25, pcz + Math.sin(a) * (rz + 0.35), { ry: rng.range(0, 3) });
  }

  group.add(b.mesh({ cast: true, receive: true }));
  return group;
}

// ---------------------------------------------------------------------------
// Far scenery
// ---------------------------------------------------------------------------

/** Sparse pines / rocks across the big ground plane outside the old scatter and the new land (chunked: culls per cell). */
function buildFarScatter(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'farScatter';
  const rng = new Rng(990331);
  const mat = vcMat();
  const taken: Array<[number, number]> = [];
  const cells = new Map<string, { pine: Placement[]; tall: Placement[]; rock: Placement[] }>();
  const cell = (x: number, z: number): { pine: Placement[]; tall: Placement[]; rock: Placement[] } => {
    const k = `${Math.floor(x / 100)}:${Math.floor(z / 100)}`;
    let c = cells.get(k);
    if (!c) {
      c = { pine: [], tall: [], rock: [] };
      cells.set(k, c);
    }
    return c;
  };
  for (let t = 0; t < 3000 && taken.length < 170; t++) {
    const x = rng.range(-240, 240);
    const z = rng.range(-110, 310);
    // the old scatter owns x −90..85 / z −65..75 (and the old map's surroundings): leave it alone
    if (x > -92 && x < 87 && z > -66 && z < 76) continue;
    const kind = rng.next();
    const rad = kind < 0.8 ? 2 : 1;
    if (blockedNewLand(x, z, rad + 1) || (kind < 0.8 && occludesNewLand(x, z, 4.4))) continue;
    if (taken.some((p) => Math.hypot(p[0] - x, p[1] - z) < 4)) continue;
    taken.push([x, z]);
    const s = rng.range(0.85, 1.45);
    const p: Placement = { x, z, ry: rng.range(0, 6.28), sx: s, sy: s * rng.range(0.92, 1.12), tint: rng.range(0.82, 1.05) };
    const c = cell(x, z);
    if (kind < 0.5) c.pine.push(p);
    else if (kind < 0.8) c.tall.push(p);
    else c.rock.push({ ...p, sy: s * rng.range(0.8, 1.2), sz: s * rng.range(0.8, 1.2) });
  }
  for (const c of cells.values()) {
    if (c.pine.length) group.add(instanced(pineGeo(), mat, c.pine, { cast: false }));
    if (c.tall.length) group.add(instanced(pineTallGeo(), mat, c.tall, { cast: false }));
    if (c.rock.length) group.add(instanced(rockGeo(), mat, c.rock, { cast: false }));
  }
  // a few snow mounds to break the flat plane
  const mounds: Placement[] = [];
  for (let t = 0; t < 600 && mounds.length < 60; t++) {
    const x = rng.range(-240, 240);
    const z = rng.range(-110, 310);
    if (x > -92 && x < 87 && z > -66 && z < 76) continue;
    const s = rng.range(1.2, 3.2);
    if (blockedNewLand(x, z, s)) continue;
    mounds.push({ x, z, ry: rng.range(0, 6.28), sx: s, sy: s * rng.range(0.7, 1.1), sz: s * rng.range(0.8, 1.4), tint: 1 });
  }
  const mm = instanced(moundGeo(), mat, mounds, { cast: false });
  group.add(mm);
  return group;
}

// ---------------------------------------------------------------------------
// The part
// ---------------------------------------------------------------------------

/**
 * Build the new land. `town` = the Market Town's group (its fence gets gaps where roads leave it). The part follows
 * 'village:changed' / 'era:unlocked' by itself; a restored game is brought up to date at construction, silently.
 */
export function buildFrontier(ctx: GameContext, town: THREE.Object3D, trikeTail?: THREE.Object3D): FrontierPart {
  const group = new THREE.Group();
  group.name = 'frontier';
  group.visible = false;

  const rng = new Rng(4242);
  const zones = gateZones();
  const roads: RoadVis[] = ROADS.map((road, i) => {
    const { open, ghost } = buildRoad(i, road, rng, zones);
    open.visible = false;
    group.add(open, ghost);
    return { id: road.id, opensAt: road.opensAt, rect: road.rect, open, ghost, walked: false };
  });
  const regions: Region[] = [];
  for (let n = 2; n < REGIONS.length; n++) if (REGIONS[n]) regions.push(buildRegion(ctx, n, group));
  group.add(buildFarScatter());
  group.add(buildSeams());
  const way = buildWayfinding();
  group.add(way.group);

  const pending = new Set<Region>();
  const view = (hint: number): LandState => ({ village: ctx.state.village, eras: { age: Math.max(ctx.state.eras.age, hint) } });

  const unlock = (reg: Region, instant: boolean): void => {
    reg.unlocked = true;
    ctx.colliders.addBounds(regionWalk(reg.layout));
    ctx.colliders.addBounds(gateWalk(reg.layout));
    ctx.colliders.addBounds(marketGateWalk(reg.layout));
    reg.lock.visible = false;
    reg.survey.visible = false;
    reg.zones.visible = true;
    reg.places ??= buildPlots(ctx, reg.n, reg.group);
    reg.paintSign(false);
    if (instant) {
      reg.gateK = 1;
      reg.colorK = 1;
      applyRegion(reg);
      return;
    }
    reg.gateK = 0;
    reg.colorK = 0;
    reg.animating = true;
    pending.add(reg);
    const p = new THREE.Vector3(reg.layout.gate.x, 0.6, reg.layout.gate.z);
    ctx.particles.puff(p, { color: ERAS[reg.n]!.colors.accent, count: 8, size: 1.3, life: 1.2 });
  };

  let first = true;
  const refresh = (hintEra = 0): void => {
    const s = view(hintEra);
    group.visible = landVisible(s);
    // the era-1 tricycle road's tail ran into era II's plot: once the new land shows, the road ends on R1
    if (trikeTail) trikeTail.visible = !group.visible;
    for (const road of roads) {
      const open = roadOpen(s, road.opensAt);
      road.open.visible = open;
      road.ghost.visible = !open;
      if (open && !road.walked) {
        road.walked = true;
        ctx.colliders.addBounds(road.rect);
        carveTownGap(ctx, town, road.id);
      }
    }
    way.refresh((id) => roads.some((r) => r.id === id && r.open.visible));
    for (const reg of regions) if (!reg.unlocked && s.eras.age >= reg.n) unlock(reg, first);
    first = false;
  };
  // nothing animates before the first refresh: start with every gate shut and the sign "for sale"
  for (const reg of regions) applyRegion(reg);
  ctx.events.on('village:changed', () => refresh());
  ctx.events.on('era:unlocked', (e) => refresh(e.era));
  refresh();

  return {
    group,
    refresh,
    update(dt: number): void {
      for (const reg of regions) reg.places?.update(dt);
      if (pending.size === 0) return;
      for (const reg of pending) {
        reg.gateK = Math.min(1, reg.gateK + dt / 0.9);
        reg.colorK = Math.min(1, reg.colorK + dt / 1.6);
        applyRegion(reg);
        if (reg.gateK >= 1 && reg.colorK >= 1) {
          reg.animating = false;
          pending.delete(reg);
        }
      }
    },
  };
}
