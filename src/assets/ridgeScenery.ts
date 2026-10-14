/**
 * [B3 — world/ridge] Static scenery of Timber Ridge: snowy ground, trampled paths, the road crossing, the log deck
 * pad, the rail line (bed, two rails, instanced ties), the platform deck + lamps, the tunnel portal the trains
 * emerge from, rocks and bushes. Everything is merged / instanced: ~8 draw calls in all.
 *
 * Two groups, because they animate differently when the ridge opens:
 *   ground  flat things (wiped in from the road side by scaling X)
 *   props   things with height (pop up by scaling Y)
 */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE, rect } from '../config';
import { Batch, vcMat } from '../render/batch';
import { toon } from '../render/materials';
import { instanced, Rng, W, type Placement } from '../world/env/common';
import { rockGeo } from '../world/env/props';
import { bushGeo } from './ridge';

const R = LAYOUT.ridge;
const ROAD = LAYOUT.tricycles.road;
const SNOW_TOP = 0xe4edf7;
const PATH_SNOW = 0xd3deea;

export interface RidgeScenery {
  readonly ground: THREE.Group;
  readonly props: THREE.Group;
}

const flat = (b: Batch, w: number, d: number, x: number, z: number, top: number, color: number, t = 0.012): void => {
  b.add(new THREE.BoxGeometry(w, t, d), color, x, top - t / 2, z);
};

/** Platform deck rectangle (centre-space) — the counter and cash pile sit on it, flush with the snow. */
export const PLATFORM_DECK = { minX: 29.0, maxX: 32.0, minZ: -2.6, maxZ: 5.2 };
/** Log-deck timber pad under LAYOUT.ridge.deck. */
export const LOG_DECK_PAD = rect(R.deck.x, R.deck.z + 0.7, 3.6, 3.4);

export function buildRidgeScenery(): RidgeScenery {
  const ground = new THREE.Group();
  ground.name = 'ridgeGround';
  const props = new THREE.Group();
  props.name = 'ridgeProps';
  const A = R.area;
  const x0 = ROAD.maxX; // the ridge snow starts at the road's east shoulder

  // ---- flat things ------------------------------------------------------------------------------
  const g = new Batch();
  flat(g, A.maxX - x0, A.maxZ - A.minZ, (x0 + A.maxX) / 2, (A.minZ + A.maxZ) / 2, 0.010, SNOW_TOP);
  // soft darker rim so the ridge reads as a patch of its own
  flat(g, A.maxX - x0, 0.5, (x0 + A.maxX) / 2, A.minZ + 0.25, 0.013, PALETTE.snowShade);
  flat(g, A.maxX - x0, 0.5, (x0 + A.maxX) / 2, A.maxZ - 0.25, 0.013, PALETTE.snowShade);
  flat(g, 0.5, A.maxZ - A.minZ, A.maxX - 0.25, (A.minZ + A.maxZ) / 2, 0.013, PALETTE.snowShade);

  // crossing over the road: planks across the lane, edge beams, trampled approach
  const gz = (R.gate.minZ + R.gate.maxZ) / 2;
  const cw = 1.9;
  const c0 = LAYOUT.yard.maxX + 0.1;
  const c1 = ROAD.maxX + 0.1;
  for (let x = c0 + 0.25; x < c1; x += 0.52) flat(g, 0.44, cw, x, gz, 0.045, (Math.round((x - c0) / 0.52) % 2 ? PALETTE.plank : COLORS.PLANK_WOOD) as number, 0.04);
  for (const s of [-1, 1]) flat(g, c1 - c0, 0.12, (c0 + c1) / 2, gz + (s * (cw + 0.12)) / 2, 0.07, PALETTE.fenceDark, 0.06);
  flat(g, 1.1, 2.6, c0 - 0.4, gz, 0.014, PATH_SNOW);

  // trampled paths: main street along the gate line, branches to the deck, quarters pad, platform
  const pz = gz;
  flat(g, 30.4 - c1, 1.7, (c1 + 30.4) / 2, pz, 0.016, PATH_SNOW);
  const dk = R.deck;
  flat(g, 1.6, pz - dk.zone.maxZ, dk.x, (pz + dk.zone.maxZ) / 2, 0.016, PATH_SNOW);
  const qp = R.quarters.pad;
  flat(g, 1.6, Math.abs(qp.z - pz) + 0.8, qp.x, (qp.z + pz) / 2, 0.016, PATH_SNOW);
  flat(g, 1.7, 5.4, 30.1, 1.4, 0.016, PATH_SNOW);

  // log deck: a timber pad of planks with two skids, where the feller's logs land and the player picks up
  const L = LOG_DECK_PAD;
  const lw = L.maxX - L.minX;
  const ld = L.maxZ - L.minZ;
  flat(g, lw + 0.3, ld + 0.3, (L.minX + L.maxX) / 2, (L.minZ + L.maxZ) / 2, 0.026, PALETTE.barkDark, 0.02);
  for (let i = 0; i < 7; i++) flat(g, lw / 7 - 0.04, ld, L.minX + (i + 0.5) * (lw / 7), (L.minZ + L.maxZ) / 2, 0.036, i % 2 ? PALETTE.plank : COLORS.PLANK_WOOD, 0.02);

  // platform deck (planks along X, flush) + edge trim
  const P = PLATFORM_DECK;
  const pw = P.maxX - P.minX;
  const pd = P.maxZ - P.minZ;
  flat(g, pw + 0.24, pd + 0.24, (P.minX + P.maxX) / 2, (P.minZ + P.maxZ) / 2, 0.028, PALETTE.fenceDark, 0.02);
  for (let z = P.minZ + 0.2; z < P.maxZ; z += 0.4) flat(g, pw, 0.34, (P.minX + P.maxX) / 2, z, 0.044, Math.round((z - P.minZ) / 0.4) % 2 ? PALETTE.plank : COLORS.PLANK_WOOD, 0.02);
  for (const x of [P.minX - 0.04, P.maxX + 0.04]) flat(g, 0.14, pd + 0.2, x, (P.minZ + P.maxZ) / 2, 0.1, PALETTE.fenceDark, 0.08);
  flat(g, pw + 0.2, 0.14, (P.minX + P.maxX) / 2, P.minZ - 0.04, 0.1, PALETTE.fenceDark, 0.08);
  flat(g, pw + 0.2, 0.14, (P.minX + P.maxX) / 2, P.maxZ + 0.04, 0.1, PALETTE.fenceDark, 0.08);

  // rail bed + two rails (the line leaves the map along Z; north of the spur it is inside the rock)
  const rx = R.rail.x;
  const zA = W.spur.maxZ - 0.2;
  const zB = R.rail.exitZ;
  flat(g, 3.3, zB - zA, rx, (zA + zB) / 2, 0.07, 0xcfd9e5, 0.07);
  flat(g, 3.0, zB - zA, rx, (zA + zB) / 2, 0.082, PATH_SNOW, 0.01);
  for (const s of [-1, 1]) {
    g.add(new THREE.BoxGeometry(0.12, 0.13, zB - zA), PALETTE.metal, rx + s * 0.72, 0.2, (zA + zB) / 2);
    g.add(new THREE.BoxGeometry(0.04, 0.03, zB - zA), 0xdfe6ec, rx + s * 0.72, 0.275, (zA + zB) / 2);
  }
  ground.add(g.mesh({ cast: false, receive: true }));

  // ties
  const tieGeo = new Batch().add(new THREE.BoxGeometry(2.3, 0.1, 0.3), PALETTE.trunk, 0, 0.05, 0).geometry();
  const ties: Placement[] = [];
  for (let z = zA + 0.4; z < zB; z += 0.85) ties.push({ x: rx, y: 0.1, z });
  ground.add(instanced(tieGeo, vcMat(), ties, { cast: false }));

  // ---- things with height -------------------------------------------------------------------------------
  const body = new Batch();
  const glow = new Batch();
  // lamps + bollards on the platform deck, a sign post
  for (const z of [P.minZ + 0.1, P.maxZ - 0.1]) {
    body.add(new THREE.CylinderGeometry(0.06, 0.08, 2.0, 6), PALETTE.metalDark, P.maxX - 0.15, 1.0, z);
    body.add(new THREE.BoxGeometry(0.34, 0.06, 0.34), PALETTE.metalDark, P.maxX - 0.15, 2.04, z);
    body.add(new THREE.ConeGeometry(0.26, 0.22, 4), PALETTE.rubber, P.maxX - 0.15, 2.28, z, { ry: Math.PI / 4 });
    glow.add(new THREE.BoxGeometry(0.22, 0.28, 0.22), 0xffd978, P.maxX - 0.15, 1.88, z);
  }
  for (const z of [-0.9, 1.5]) body.add(new THREE.CylinderGeometry(0.1, 0.12, 0.34, 6), PALETTE.fenceDark, P.maxX - 0.08, 0.17, z);
  // stacked logs at the north end of the platform (what the trains will take)
  const lg = new THREE.CylinderGeometry(0.11, 0.11, 1.4, 7).rotateZ(Math.PI / 2);
  for (const [dz, y, n] of [[0.0, 0.14, 3], [0.0, 0.34, 2]] as const) {
    for (let i = 0; i < n; i++) body.add(lg, i % 2 ? PALETTE.plank : PALETTE.bark, 30.1, y + 0.06, P.minZ + 0.3 + dz + (i - (n - 1) / 2) * 0.23 + 0.25);
  }
  // snow-capped signboard at the south end
  body.add(new THREE.BoxGeometry(0.09, 1.0, 0.09), PALETTE.fenceDark, P.minX + 0.2, 0.5, P.maxZ - 0.1);
  body.add(new THREE.BoxGeometry(0.9, 0.38, 0.08), PALETTE.plank, P.minX + 0.2, 1.0, P.maxZ - 0.1);
  body.add(new THREE.BoxGeometry(1.0, 0.07, 0.14), PALETTE.snow, P.minX + 0.2, 1.22, P.maxZ - 0.1);
  for (const dy of [-0.08, 0.08]) body.add(new THREE.BoxGeometry(0.7, 0.06, 0.1), PALETTE.fenceDark, P.minX + 0.2, 1.0 + dy, P.maxZ - 0.06);

  // tunnel portal where the rail enters the rock (face of the spur, looking +Z)
  const zp = W.spur.maxZ;
  const mouth = new THREE.Shape([new THREE.Vector2(-1.45, 0), new THREE.Vector2(-1.45, 1.9), new THREE.Vector2(0, 2.8), new THREE.Vector2(1.45, 1.9), new THREE.Vector2(1.45, 0)]);
  body.add(new THREE.ShapeGeometry(mouth), 0x12161d, rx, 0.02, zp + 0.06);
  const frame = new THREE.Shape([new THREE.Vector2(-1.9, 0), new THREE.Vector2(-1.9, 2.2), new THREE.Vector2(0, 3.4), new THREE.Vector2(1.9, 2.2), new THREE.Vector2(1.9, 0)]);
  frame.holes.push(new THREE.Path(mouth.getPoints()));
  body.add(new THREE.ExtrudeGeometry(frame, { depth: 0.22, bevelEnabled: false }), 0xb3bfce, rx, 0, zp + 0.0);
  for (let i = 0; i < 4; i++) body.add(new THREE.BoxGeometry(0.4, 0.4, 0.1), i % 2 ? PALETTE.rubber : PALETTE.roadLine, rx - 1.65 + (i < 2 ? 0 : 3.3), 0.2 + (i % 2) * 0.4, zp + 0.3);

  const propsMesh = body.mesh({ cast: true, receive: true });
  props.add(propsMesh);
  props.add(glow.mesh({ cast: false, receive: false, material: toon(0xffd978, { emissive: 0xffb347, emissiveIntensity: 0.8 }) }));

  // rocks + bushes (explicit spots: they frame the paths, the quarters and the forest edge)
  const rng = new Rng(4417);
  const rocks: Placement[] = (
    [
      [15.9, -10.6, 1.1],
      [15.4, -15.0, 1.45],
      [19.2, -16.6, 0.95],
      [21.0, -12.4, 0.85],
      [22.4, -17.0, 1.2],
      [27.4, 7.0, 1.0],
      [23.2, 7.2, 0.8],
      [14.9, 7.0, 1.2],
      [31.2, -16.9, 1.3],
      [24.9, -2.7, 0.7],
    ] as const
  ).map(([x, z, s]) => ({ x, z, ry: rng.range(0, 6.28), sx: s, sy: s * rng.range(0.85, 1.15), tint: rng.range(0.9, 1.05) }));
  props.add(instanced(rockGeo(), vcMat(), rocks, { cast: true }));
  const bushes: Placement[] = (
    [
      [15.1, -4.4],
      [15.3, -6.3],
      [17.0, -9.2],
      [15.2, 3.4],
      [21.7, 2.2],
      [22.6, 5.9],
      [24.6, 3.4],
      [26.5, 5.8],
      [28.0, 7.0],
      [20.4, -9.6],
      [22.2, -6.4],
      [25.6, -3.0],
      [27.6, -3.0],
      [17.6, -13.2],
      [18.8, -10.8],
      [16.4, 6.6],
    ] as const
  ).map(([x, z]) => ({ x, z, ry: rng.range(0, 6.28), sx: rng.range(0.9, 1.35), sy: rng.range(0.9, 1.3), tint: rng.range(0.9, 1.05) }));
  props.add(instanced(bushGeo(), vcMat(), bushes, { cast: true }));

  return { ground, props };
}
