/**
 * 1.0 (review idea 6): the river promenade. A wide packed-snow walk down the river's east bank from the mill's sign to
 * the frozen pond, an overlook on the pond's north shore with a little bandstand, and the customers' trodden footpath
 * (env/wayfinding.ts) on to R1 made walkable, so the walk joins the road to the Market Town. Benches face the water and
 * the skaters, lamps (the era's own generation) light it at night.
 *
 * Where (world, metres; the river's east bank is x = -10.4, the customers' fenced lane x -5.5..-1 runs z 10.3..42):
 * - BANK: player walk x -9.25..-6.5, z 16.2..44.8, the open snow strip between the river and the lane (the snowman by
 *   the sign stands at z 14.4, just north of it). Lamps and benches stand on the river side of it (x -9.95).
 * - OVERLOOK: x -9.25..-1.9, z 42.6..44.8, south of the lane's end; the bandstand stands south of it at the pond's edge.
 * - FOOTPATH: x -4.3..-1.9, z 42.6..62.6 (the trodden footpath, 0.3 m inside its edge stones), overlapping R1 (z 62).
 * Every prop stands outside all three walk rects (by more than the player's radius), off the water, the pond's ice
 * and rim, every road, the lane and the sledding hill (tests/seasonal.test.ts). Nothing here moves.
 *
 * Shown with the new land (a child of the frontier group); the walk rects and the colliders go live then, and the old
 * scatter is cleared off the strip. Draw calls: the statics (path, kerbs, benches) 1, lamps 3, bandstand 2.
 */
import * as THREE from 'three';
import { PALETTE, type Rect } from '../../config';
import { createAmenityModel } from '../../assets/townAmenities';
import type { GameContext } from '../../core/types';
import { Batch } from '../../render/batch';
import { geo } from '../../render/materials';
import { registerEra } from './eras';
import { pruneInstances } from './frontier';
import { buildLampVariants, type LampSpot } from './lamps';

/** Player-centre walk rects (ColliderWorld.addBounds). */
export const PROMENADE_WALK: readonly Rect[] = [
  { minX: -9.25, maxX: -6.5, minZ: 16.2, maxZ: 44.8 },
  { minX: -9.25, maxX: -1.9, minZ: 42.6, maxZ: 44.8 },
  { minX: -4.3, maxX: -1.9, minZ: 42.6, maxZ: 62.6 },
];

/** The drawn walk (a little wider than the walk rects: the player's body reaches past its centre). */
const BANK_PATH: Rect = { minX: -9.72, maxX: -6.08, minZ: 15.8, maxZ: 45.2 };
const OVERLOOK_PATH: Rect = { minX: -9.72, maxX: -4.6, minZ: 42.2, maxZ: 45.2 };

/** The river-side row (x) the lamps and benches stand in. */
const RIVER_ROW = -9.98;
/** The river rail's line (x), on the bank's lip, outside the benches' fronts. */
const RAIL_X = -10.3;
/** East of the footpath (x): its benches and lamps. */
const FOOT_ROW = -0.9;

export type PromenadePropKind = 'lamp' | 'bench' | 'bandstand';

export interface PromenadeProp {
  kind: PromenadePropKind;
  x: number;
  z: number;
  /** Yaw: the way a bench faces (0 = +Z). */
  yaw: number;
  /** Footprint half sizes (world, after the yaw), for the colliders and the clearance tests. */
  hx: number;
  hz: number;
}

/** The bandstand: front steps toward the overlook (north), the pond behind it. */
export const PROMENADE_BANDSTAND = { x: -7.75, z: 46.5, r: 1.12 } as const;

const lamp = (x: number, z: number): PromenadeProp => ({ kind: 'lamp', x, z, yaw: 0, hx: 0.2, hz: 0.2 });
const benchX = (x: number, z: number, yaw: number): PromenadeProp => ({ kind: 'bench', x, z, yaw, hx: 0.3, hz: 0.78 });
const benchZ = (x: number, z: number, yaw: number): PromenadeProp => ({ kind: 'bench', x, z, yaw, hx: 0.78, hz: 0.3 });

/** Every prop of the promenade (pure, stable). */
export function promenadeProps(): readonly PromenadeProp[] {
  return PROPS;
}

const PROPS: readonly PromenadeProp[] = [
  // the bank: a lamp every 7 m, a bench facing the river between each pair
  ...[17.4, 24.4, 31.4, 38.4].map((z) => lamp(RIVER_ROW, z)),
  ...[20.9, 27.9, 34.9, 41.7].map((z) => benchX(RIVER_ROW, z, -Math.PI / 2)),
  // the overlook: the bandstand, a bench looking out over the pond, a lamp at the footpath's corner
  { kind: 'bandstand', x: PROMENADE_BANDSTAND.x, z: PROMENADE_BANDSTAND.z, yaw: Math.PI, hx: PROMENADE_BANDSTAND.r, hz: PROMENADE_BANDSTAND.r },
  benchZ(-5.75, 45.85, 0),
  // the footpath on to R1: benches facing west over the pond's skaters, lamps between them
  // (a big old pine stands just east of the footpath at z ~52: the lamps and benches keep a step off it)
  ...[46.4, 55.2, 61.0].map((z) => lamp(FOOT_ROW, z)),
  ...[49.4, 58.1].map((z) => benchX(FOOT_ROW, z, -Math.PI / 2)),
];

/** A timber bench with iron ends and snow on the seat and back, facing local +Z, centred on (0, 0). */
function bench(b: Batch, x: number, z: number, yaw: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // local (lx, lz) → world, turned by yaw (local +Z faces the way the bench looks)
  const at = (lx: number, y: number, lz: number, g: THREE.BufferGeometry, color: number): void => {
    b.add(g, color, x + lx * c + lz * s, y, z - lx * s + lz * c, { ry: yaw });
  };
  const wood = 0x8a5a36;
  const woodL = 0xa8713f;
  const iron = 0x30353d;
  for (const lx of [-0.62, 0.62]) {
    at(lx, 0.22, 0.02, geo.box(0.06, 0.44, 0.42), iron);
    at(lx, 0.62, -0.17, geo.box(0.06, 0.4, 0.06), iron);
    at(lx, 0.56, 0.06, geo.box(0.06, 0.05, 0.36), iron);
  }
  at(0, 0.46, 0.1, geo.box(1.44, 0.05, 0.16), woodL);
  at(0, 0.46, -0.08, geo.box(1.44, 0.05, 0.16), wood);
  at(0, 0.7, -0.19, geo.box(1.44, 0.12, 0.04), woodL);
  at(0, 0.86, -0.19, geo.box(1.44, 0.1, 0.04), wood);
  // snow: a soft pad along the seat's back half and a line on the top rail
  at(0.08, 0.5, -0.06, geo.box(1.1, 0.04, 0.16), PALETTE.snow);
  at(0, 0.93, -0.19, geo.box(1.3, 0.04, 0.07), PALETTE.snow);
}

/**
 * A low timber rail along the river's edge (x = RAIL_X) from z0 to z1: square posts every ~1.8 m, two rails, snow on
 * the top one. Waist-low and on the water side of the benches, so it never stands in the walk.
 */
function riverRail(b: Batch, z0: number, z1: number): void {
  const n = Math.max(1, Math.round((z1 - z0) / 1.8));
  const step = (z1 - z0) / n;
  for (let i = 0; i <= n; i++) {
    const z = z0 + i * step;
    b.add(geo.box(0.12, 0.66, 0.12), 0x7a4f2c, RAIL_X, 0.33, z);
    b.add(geo.box(0.16, 0.05, 0.16), PALETTE.snow, RAIL_X, 0.685, z);
  }
  const len = z1 - z0;
  b.add(geo.box(0.07, 0.08, len), 0x9a6a3c, RAIL_X, 0.58, (z0 + z1) / 2);
  b.add(geo.box(0.06, 0.06, len), 0x8a5a36, RAIL_X, 0.3, (z0 + z1) / 2);
  b.add(geo.box(0.1, 0.035, len - 0.1), PALETTE.snow, RAIL_X, 0.635, (z0 + z1) / 2);
}

/** Packed snow with a darker trodden middle. */
function path(b: Batch, r: Rect, alongZ: boolean): void {
  const w = r.maxX - r.minX;
  const d = r.maxZ - r.minZ;
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;
  b.add(geo.box(w, 0.02, d), 0xdbe4ee, cx, 0.012, cz);
  b.add(alongZ ? geo.box(w * 0.5, 0.02, d - 0.5) : geo.box(w - 0.5, 0.02, d * 0.5), 0xcbd7e5, cx, 0.016, cz);
}

/** A low kerb of short laid stones along x = `x` from z0 to z1 (no collider: it is ankle high and off the walk). */
function kerb(b: Batch, x: number, z0: number, z1: number): void {
  const len = z1 - z0;
  const n = Math.max(1, Math.round(len / 0.9));
  for (let i = 0; i < n; i++) {
    const sl = len / n - 0.12;
    b.add(geo.box(0.22, 0.08, sl), i % 3 === 0 ? PALETTE.rockDark : PALETTE.rock, x, 0.04, z0 + ((i + 0.5) / n) * len);
  }
}

export interface PromenadePart {
  readonly group: THREE.Group;
  /** Make it walkable and solid (once, when the new land shows). */
  open(): void;
}

/** Build the promenade into `parent` (the frontier group). `decor`: the old scatter, cleared off the strip on open. */
export function buildPromenade(ctx: GameContext, parent: THREE.Object3D, decor: THREE.Object3D): PromenadePart {
  const group = new THREE.Group();
  group.name = 'promenade';
  parent.add(group);

  const b = new Batch();
  path(b, BANK_PATH, true);
  path(b, OVERLOOK_PATH, false);
  // the lane side of the bank, up to where the overlook opens
  kerb(b, BANK_PATH.maxX, BANK_PATH.minZ, OVERLOOK_PATH.minZ);
  riverRail(b, BANK_PATH.minZ + 0.4, OVERLOOK_PATH.maxZ - 0.2);
  for (const p of PROPS) if (p.kind === 'bench') bench(b, p.x, p.z, p.yaw);
  group.add(b.mesh({ cast: true, receive: true }));

  const spots: LampSpot[] = PROPS.filter((p) => p.kind === 'lamp').map((p) => ({ x: p.x, z: p.z }));
  const lamps = buildLampVariants(spots);
  group.add(lamps.group);
  registerEra((look) => lamps.show(look.lamp));

  const stand = createAmenityModel('bandstand').root;
  stand.name = 'promenade:bandstand';
  stand.position.set(PROMENADE_BANDSTAND.x, 0, PROMENADE_BANDSTAND.z);
  stand.rotation.y = Math.PI; // the steps toward the overlook
  group.add(stand);
  ctx.occlusion?.addOccluder(stand);

  let opened = false;
  return {
    group,
    open(): void {
      if (opened) return;
      opened = true;
      const m = 0.6;
      const clear = [BANK_PATH, OVERLOOK_PATH, ...PROPS.map((p) => ({ minX: p.x - p.hx, maxX: p.x + p.hx, minZ: p.z - p.hz, maxZ: p.z + p.hz }))];
      const near = (x: number, z: number, k: number): boolean => clear.some((r) => x > r.minX - k && x < r.maxX + k && z > r.minZ - k && z < r.maxZ + k);
      // off the strip, and no old pine left standing where, from the camera (+X / +Z), it would hide the walk
      const hides = (x: number, z: number): boolean => {
        for (let t = 0; t <= 3.2; t += 0.4) if (PROMENADE_WALK.some((r) => x - t > r.minX - 0.4 && x - t < r.maxX + 0.4 && z - t > r.minZ - 0.4 && z - t < r.maxZ + 0.4)) return true;
        return false;
      };
      pruneInstances(decor, (x, z) => near(x, z, m) || hides(x, z));
      for (const r of PROMENADE_WALK) ctx.colliders.addBounds(r);
      for (const p of PROPS) {
        if (p.kind === 'lamp') ctx.colliders.addCircle(p.x, p.z, 0.18, 'promenade:lamp');
        else if (p.kind === 'bandstand') ctx.colliders.addCircle(p.x, p.z, PROMENADE_BANDSTAND.r, 'promenade:bandstand');
        else ctx.colliders.addBox({ minX: p.x - p.hx, maxX: p.x + p.hx, minZ: p.z - p.hz, maxZ: p.z + p.hz }, 'promenade:bench');
      }
    },
  };
}
