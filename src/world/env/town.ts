/**
 * [T4 — wave 9] The Market Town district scenery (LAYOUT.town): snow ground, cobbled market square, the 8 lot
 * outlines, a low picket boundary, the corridor from the village street (flagstone path, a gate in the village's east
 * fence, a zebra crossing over the tricycle road, the "MARKET TOWN" arch), and the centrepiece: a big fairy-lit fir,
 * benches, two market stalls, a snowman, lamp posts and bunting at the spots in town/spots.ts.
 *
 * Built at construction (colliders included) and INERT until `open()`: the whole district is hidden, the little
 * gate in the village fence is closed. `open(false)` swings the gate and pops the props up with puffs; `open(true)`
 * (a restored game) is the final state at once. Era dressing (lamp generation, bunting, festive lights) is
 * registered with env/eras.ts. Draw calls when looking at the square: ~15 (ground 1, square 1, boundary 1, statics 2,
 * bulbs+glow 1, sign 1, halos 1, lamps 3, bunting 1, festive 2).
 */
import * as THREE from 'three';
import { LAYOUT, PALETTE, rect, townZ } from '../../config';
import { palisadeMaterial, palisadePostGeometry, PALISADE } from '../../assets/scenery';
import { Batch, instanced, Rng, vcMat, type EnvPart, type Placement } from './common';
import { addSparkleSpot, registerEra } from './eras';
import { addBunting, addLightString, addWreath } from './festive';
import { addPalisade, type FenceLine } from './fences';
import { bulbMaterial, buildHalos } from './glow';
import { cobbleTexture } from './groundTex';
import { buildLampVariants, LAMP_TOP, type LampSpot } from './lamps';
import { addArch, addBench, addFir, addSnowman, addStall, ARCH_H, FIR_STAR_Y, Placer, box, cyl } from './townProps';
import { BENCHES, SNOWMAN, STALLS } from '../../town/spots';
import { GAME_FONT, makeCanvasTexture, toon } from '../../render/materials';
import { TOWN_SQUARE_LOTS, type GameContext } from '../../core/types';

const T = LAYOUT.town;
const V = LAYOUT.village;
/** The square's own lots (0.9.12: LAYOUT.town.lots 8.. are Lantern Lane's, drawn by env/lantern.ts when it opens). */
const SQUARE_LOTS = T.lots.slice(0, TOWN_SQUARE_LOTS);

export interface TownPart extends EnvPart {
  /** Open the district (instant: final state, silent). Idempotent. */
  open(instant: boolean): void;
  readonly isOpen: boolean;
}

/** Lamp posts around the square (mouth, north, south, east edges) and beside the corridor gate. */
export const SQUARE_LAMPS: readonly LampSpot[] = [
  // 0.9.11: on the fence line beside the gate post (it stood 1 m in, closing the gap between the entrance and the stall)
  { x: 15.2, z: 24.75 },
  { x: 16.2, z: 29.2 },
  { x: 21.8, z: 21.7 },
  { x: 27.4, z: 21.7 },
  // 0.9.9: the south pair stands 0.7 m further south, off the porters' stands at the shops' hoppers (z 39.8); the east
  // one beside the south avenue's alley, not in the middle of its mouth
  { x: 21.8, z: townZ(35.8) - 2.6 },
  { x: 26.1, z: townZ(35.8) - 2.6 },
  // 0.9.9: on the north corner of the east gate's lane (it stood on the walk down the square's east side)
  { x: 32.7, z: 27.3 },
];
export const CORRIDOR_LAMPS: readonly LampSpot[] = [
  { x: 10.35, z: 25.45 },
  { x: 10.35, z: 27.95 },
];

const OPEN_TIME = 0.85;
const POP_TIME = 1.0;
const easeBack = (t: number, c1 = 1.2): number => 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);

function signTexture(): THREE.CanvasTexture {
  const { canvas, ctx: g, texture } = makeCanvasTexture(1024, 360);
  const paint = (): void => {
    g.fillStyle = '#7f5328';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#c98f52';
    g.fillRect(14, 14, canvas.width - 28, canvas.height - 28);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 6; i++) g.fillRect(14, 60 + i * 52, canvas.width - 28, 3);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.font = `bold 124px ${GAME_FONT}`;
    g.lineWidth = 18;
    g.strokeStyle = '#5a3a1c';
    g.strokeText('MARKET', canvas.width / 2, canvas.height * 0.32);
    g.fillStyle = '#fff6e0';
    g.fillText('MARKET', canvas.width / 2, canvas.height * 0.32);
    g.font = `bold 118px ${GAME_FONT}`;
    g.strokeText('TOWN', canvas.width / 2, canvas.height * 0.74);
    g.fillStyle = '#ffd34d';
    g.fillText('TOWN', canvas.width / 2, canvas.height * 0.74);
    // little snowflakes on both sides of "TOWN"
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    for (const fx of [200, 824]) {
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3;
        g.beginPath();
        g.moveTo(fx - Math.cos(a) * 34, 268 - Math.sin(a) * 34);
        g.lineTo(fx + Math.cos(a) * 34, 268 + Math.sin(a) * 34);
        g.stroke();
      }
    }
    texture.needsUpdate = true;
  };
  paint();
  void document.fonts?.ready.then(paint);
  texture.anisotropy = 8;
  return texture;
}

/** The Market Town. `ctx.colliders` exists before the Environment (see Game). */
export function buildTown(ctx: GameContext, rng: Rng): TownPart {
  const root = new THREE.Group();
  root.name = 'town';
  const district = new THREE.Group();
  district.name = 'townDistrict';
  district.visible = false;
  root.add(district);
  const sq = T.square;
  const A = T.area;
  const tree = T.tree;
  const gate = T.gate;
  const entrance = T.entrances[1]!;

  // =====================================================================================================
  // Flat ground (one merged mesh, receives only)
  // =====================================================================================================
  const flat = new Batch();
  const slab = (w: number, d: number, x: number, z: number, y: number, color: number, t = 0.02): void => {
    flat.add(box(w, t, d), color, x, y - t / 2, z);
  };
  // slightly bluer, trampled snow over the whole district, then soft drifts / shaded patches outside the square
  slab(A.maxX - A.minX, A.maxZ - A.minZ, (A.minX + A.maxX) / 2, (A.minZ + A.maxZ) / 2, 0.008, 0xe9f1f9);
  const disc = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  const keep = [
    { minX: sq.minX - 0.5, maxX: sq.maxX + 0.5, minZ: sq.minZ - 0.5, maxZ: sq.maxZ + 0.5 },
    ...SQUARE_LOTS.map((l) => rect(l.x, l.z, T.lotSize + 0.8, T.lotSize + 0.8)),
  ];
  let layer = 0;
  for (let tries = 0; tries < 400 && layer < 34; tries++) {
    const x = rng.range(A.minX + 0.6, A.maxX - 0.6);
    const z = rng.range(A.minZ + 0.6, A.maxZ - 0.6);
    const r = rng.range(0.9, 2.5);
    if (keep.some((k) => x + r * 0.7 > k.minX && x - r * 0.7 < k.maxX && z + r * 0.7 > k.minZ && z - r * 0.7 < k.maxZ)) continue;
    flat.add(disc, layer % 3 === 0 ? 0xf8fbff : layer % 3 === 1 ? 0xdde8f3 : 0xeef4fb, x, 0.009 + layer * 0.00035, z, { sx: r, sz: r * rng.range(0.6, 1), ry: rng.range(0, 3) });
    layer++;
  }
  // the 8 lot outlines: packed snow with a lighter rim (Lantern Lane draws its own, env/lantern.ts)
  for (const l of SQUARE_LOTS) {
    slab(T.lotSize, T.lotSize, l.x, l.z, 0.026, 0xd6e1ee);
    slab(T.lotSize - 0.5, T.lotSize - 0.5, l.x, l.z, 0.031, 0xdfe9f3, 0.01);
    const h = T.lotSize / 2;
    for (const s of [-1, 1]) {
      slab(T.lotSize + 0.1, 0.12, l.x, l.z + s * h, 0.036, 0xb9c8da, 0.012);
      slab(0.12, T.lotSize + 0.1, l.x + s * h, l.z, 0.036, 0xb9c8da, 0.012);
    }
  }
  // corridor: flagstones from the village street across the road (zebra) to the square
  const pz = (gate.minZ + gate.maxZ) / 2;
  const road = LAYOUT.tricycles.road;
  const stoneGeo = box(0.62, 0.03, 0.5);
  for (let x = V.street.maxX - 0.1, i = 0; x < sq.minX + 0.4; x += 0.74, i++) {
    if (x > road.minX - 0.3 && x < road.maxX + 0.3) continue;
    flat.add(stoneGeo, i % 2 ? 0xb4c0d0 : 0xc3ccd9, x, 0.04, pz + (i % 3 === 0 ? 0.3 : i % 3 === 1 ? -0.28 : 0.02), { ry: ((i * 37) % 11) * 0.02 - 0.1, sz: 0.9 + (i % 2) * 0.25 });
    flat.add(stoneGeo, i % 2 ? 0xc3ccd9 : 0xb4c0d0, x + 0.2, 0.04, pz + (i % 3 === 0 ? -0.34 : 0.3), { ry: ((i * 13) % 7) * 0.02, sx: 0.6, sz: 0.9 });
  }
  // zebra crossing over the tricycle road (bars run along the traffic, stepped across it)
  const barW = 0.42;
  for (let x = road.minX + 0.45; x < road.maxX - 0.2; x += 0.78) {
    flat.add(box(barW, 0.018, gate.maxZ - gate.minZ + 0.3), 0xf7fbff, x, 0.03, pz);
  }
  for (const z of [gate.minZ - 0.28, gate.maxZ + 0.28]) flat.add(box(road.maxX - road.minX - 0.5, 0.016, 0.1), 0xf6d04d, (road.minX + road.maxX) / 2, 0.03, z);
  const ground = flat.mesh({ cast: false, receive: true });
  district.add(ground);

  // the market square: cobbles with an accent ring around the fir and a runner from the corridor
  const sqW = sq.maxX - sq.minX;
  const sqD = sq.maxZ - sq.minZ;
  const squareMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(sqW, sqD).rotateX(-Math.PI / 2),
    toon(0xffffff, {
      map: cobbleTexture(sqW, sqD, {
        seed: 21,
        ppm: 52,
        kerb: 0.3,
        snow: 0.55,
        ring: { x: tree.x - sq.minX, z: tree.z - sq.minZ, r0: 2.35, r1: 3.1 },
        runner: { z: pz - sq.minZ, w: 1.5, toX: tree.x - sq.minX - 3 },
      }),
    }),
  );
  squareMesh.position.set((sq.minX + sq.maxX) / 2, 0.05, (sq.minZ + sq.maxZ) / 2);
  squareMesh.castShadow = false;
  squareMesh.receiveShadow = true;
  district.add(squareMesh);

  // =====================================================================================================
  // Props (everything that pops up on open)
  // =====================================================================================================
  const pop = new THREE.Group();
  district.add(pop);
  const statics = new Batch();
  const bulbs = new Batch();
  const glow = bulbs; // lanterns, candles and the star share the unlit bulb mesh (one draw call)
  const stallHalos: Array<{ x: number; y: number; z: number }> = [];

  addFir(statics, glow, bulbs, tree.x, tree.z);
  ctx.colliders.addCircle(tree.x, tree.z, tree.r, 'town:tree');

  BENCHES.forEach((s, i) => {
    addBench(statics, s.x, s.z, s.yaw);
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    for (const k of [-0.5, 0.5]) ctx.colliders.addCircle(s.x + k * c, s.z - k * sn, 0.4, `town:bench${i}`);
  });

  STALLS.forEach((s, i) => {
    addStall(statics, glow, bulbs, s.x, s.z, s.yaw, i === 0 ? { awning: [0xe2453c, 0xffffff], goods: 0 } : { awning: [0x2f9d6a, 0xfff6e0], goods: 1 });
    const c = Math.abs(Math.cos(s.yaw));
    const sn = Math.abs(Math.sin(s.yaw));
    const ex = c * 0.95 + sn * 0.55;
    const ez = sn * 0.95 + c * 0.55;
    ctx.colliders.addBox({ minX: s.x - ex, maxX: s.x + ex, minZ: s.z - ez, maxZ: s.z + ez }, `town:stall${i}`);
    const pw = new Placer(statics, s.x, s.z, s.yaw).world(0, 1.66, 0.72);
    stallHalos.push(pw);
  });

  addSnowman(statics, SNOWMAN.x, SNOWMAN.z, SNOWMAN.yaw);
  ctx.colliders.addCircle(SNOWMAN.x, SNOWMAN.z, 0.5, 'town:snowman');

  // arch over the corridor mouth + its sign
  const archX = A.minX;
  const az0 = gate.minZ - 0.25;
  const az1 = gate.maxZ + 0.25;
  addArch(statics, bulbs, archX, az0, az1);
  // the east entrance: two snowy posts with a hanging lantern each
  const ez0 = entrance.z - 0.95;
  const ez1 = entrance.z + 0.95;
  for (const z of [ez0, ez1]) {
    statics.add(box(0.24, 1.5, 0.24), PALETTE.fenceDark, A.maxX, 0.75, z);
    statics.add(box(0.36, 0.1, 0.36), PALETTE.snow, A.maxX, 1.55, z);
    statics.add(box(0.04, 0.22, 0.04), 0x30353d, A.maxX - 0.2, 1.3, z);
    glow.add(box(0.14, 0.18, 0.14), 0xffd978, A.maxX - 0.2, 1.12, z);
    ctx.colliders.addCircle(A.maxX, z, 0.18, 'town:entrance');
    stallHalos.push({ x: A.maxX - 0.2, y: 1.15, z });
  }
  for (const z of [az0, az1]) ctx.colliders.addCircle(archX, z, 0.2, 'town:arch');

  // snow drifts banked against the boundary (inside), a few barrels and crates by the stalls
  const mound = new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let i = 0; i < 16; i++) {
    const side = i % 4;
    const t = rng.range(0.1, 0.9);
    const x = side === 0 ? A.minX + 0.55 : side === 1 ? A.maxX - 0.55 : A.minX + t * (A.maxX - A.minX);
    const z = side === 2 ? A.minZ + 0.6 : side === 3 ? A.maxZ - 0.6 : A.minZ + t * (A.maxZ - A.minZ);
    if ((side === 0 && Math.abs(z - pz) < 2.4) || (side === 1 && Math.abs(z - entrance.z) < 2.2)) continue;
    const r = rng.range(0.5, 1.0);
    statics.add(mound, PALETTE.snow, x, -0.02, z, { sx: r * 1.3, sy: r * 0.5, sz: r, ry: rng.range(0, 3) });
  }
  for (const [bx, bz, kind] of [[16.3, 21.9, 0], [17.1, 21.4, 1], [16.5, townZ(35.8) - 3.3, 0]] as const) {
    if (kind === 0) {
      statics.add(cyl(0.26, 0.28, 0.6, 9), 0x8a5a2b, bx, 0.3, bz);
      statics.add(cyl(0.28, 0.28, 0.05, 9), 0x30353d, bx, 0.18, bz);
      statics.add(cyl(0.28, 0.28, 0.05, 9), 0x30353d, bx, 0.45, bz);
      statics.add(cyl(0.22, 0.22, 0.04, 9), PALETTE.snow, bx, 0.62, bz);
    } else {
      statics.add(box(0.5, 0.4, 0.5), PALETTE.plank, bx, 0.2, bz, { ry: 0.3 });
      statics.add(box(0.46, 0.05, 0.46), PALETTE.snow, bx, 0.42, bz, { ry: 0.3 });
      statics.add(box(0.36, 0.3, 0.36), PALETTE.crate, bx + 0.1, 0.55, bz - 0.06, { ry: -0.2 });
    }
  }

  // lamp generations (torch / lantern / iron): square + corridor
  const lampSpots = [...SQUARE_LAMPS, ...CORRIDOR_LAMPS];
  const lamps = buildLampVariants(lampSpots);
  pop.add(lamps.group);
  for (const s of lampSpots) {
    ctx.colliders.addCircle(s.x, s.z, 0.17, 'town:lamp');
    addSparkleSpot(s.x, 3, s.z);
  }
  addSparkleSpot(tree.x, 4, tree.z);

  // boundary: a low picket fence with openings at the corridor mouth and the east entrance
  const lines: FenceLine[] = [
    { axis: 'z', at: A.minX, from: A.minZ, to: A.maxZ, gaps: [[az0, az1]] },
    { axis: 'z', at: A.maxX, from: A.minZ, to: A.maxZ, gaps: [[ez0, ez1]] },
    { axis: 'x', at: A.minZ, from: A.minX, to: A.maxX },
    { axis: 'x', at: A.maxZ, from: A.minX, to: A.maxX },
  ];
  const pickets: Placement[] = [];
  for (const l of lines) addPalisade(pickets, l, rng);
  for (const p of pickets) {
    p.sx = (p.sx ?? 1) * 0.8;
    p.sz = p.sx;
    p.sy = (p.sy ?? 1) * 0.5;
  }
  const fence = instanced(palisadePostGeometry(), palisadeMaterial(), pickets, { cast: false });
  pop.add(fence);
  const thick = PALISADE.radius;
  const wallBox = (axis: 'x' | 'z', at: number, a: number, b: number): void => {
    if (b - a < 0.1) return;
    ctx.colliders.addBox(axis === 'z' ? { minX: at - thick, maxX: at + thick, minZ: a, maxZ: b } : { minX: a, maxX: b, minZ: at - thick, maxZ: at + thick }, 'town:fence');
  };
  wallBox('z', A.minX, A.minZ, az0 - 0.3);
  wallBox('z', A.minX, az1 + 0.3, A.maxZ);
  wallBox('z', A.maxX, A.minZ, ez0 - 0.1);
  wallBox('z', A.maxX, ez1 + 0.1, A.maxZ);
  wallBox('x', A.minZ, A.minX, A.maxX);
  wallBox('x', A.maxZ, A.minX, A.maxX);

  // sign board on the arch: the dark board body is baked into the statics; the lettering is ONE double-sided plane
  // (a multi-material box would cost one draw call per face)
  const signZ = (az0 + az1) / 2;
  statics.add(box(0.1, 0.9, 2.2), PALETTE.fenceDark, archX + 0.26, ARCH_H - 0.95, signZ);
  const signMat = toon(0xffffff, { map: signTexture(), side: THREE.DoubleSide });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.04, 0.74).rotateY(Math.PI / 2), signMat);
  board.position.set(archX + 0.26 + 0.055, ARCH_H - 0.95, signZ);
  board.castShadow = false;
  const sign = new THREE.Group();
  sign.add(board);

  // bunting + festive lights (eras): lamps and the arch / tree anchor points
  const bunting = new Batch();
  const lights = new Batch();
  const wreaths = new Batch();
  const lampTop = (s: LampSpot, drop = 0): { x: number; y: number; z: number } => ({ x: s.x, y: LAMP_TOP.iron - 0.12 - drop, z: s.z });
  const [m1, m2, n1, n2, s1, s2, e1] = SQUARE_LAMPS as readonly [LampSpot, LampSpot, LampSpot, LampSpot, LampSpot, LampSpot, LampSpot];
  const chain = [m1, n1, n2, e1, s2, s1, m2];
  for (let i = 0; i + 1 < chain.length; i++) addBunting(bunting, lampTop(chain[i]!), lampTop(chain[i + 1]!), 0.45, i * 2);
  // across the corridor mouth and along the arch beam
  addBunting(bunting, { x: archX + 0.15, y: ARCH_H - 0.15, z: az0 - 0.1 }, { x: archX + 0.15, y: ARCH_H - 0.15, z: az1 + 0.1 }, 0.3, 3);
  addBunting(bunting, lampTop(CORRIDOR_LAMPS[0]!), lampTop(CORRIDOR_LAMPS[1]!), 0.4, 1);
  // festive: bulbs along the same chain (a little lower), spokes from the fir's star, wreaths on the posts
  for (let i = 0; i + 1 < chain.length; i++) addLightString(lights, lampTop(chain[i]!, 0.35), lampTop(chain[i + 1]!, 0.35), 0.5, i + 2);
  const star = { x: tree.x, y: FIR_STAR_Y - 0.3, z: tree.z };
  for (const l of [n1, e1, s1]) addLightString(lights, star, lampTop(l, 0.2), 0.35, 5); // three spokes, not a web
  for (const s of lampSpots) addWreath(wreaths, s.x, 1.7, s.z, 0.9);
  addWreath(wreaths, archX + 0.15, ARCH_H - 0.55, az0 + 0.05, 1.0);
  addWreath(wreaths, archX + 0.15, ARCH_H - 0.55, az1 - 0.25, 1.0);

  // night market (era flag): a denser, lower string of warm bulbs along each stall's scalloped awning edge. The bulbs go
  // in the festive-lights batch (the shared bulb material: no extra draw call); the halos are one extra additive mesh
  // that only draws at night (env/glow.ts hides it by day) and is shown by the `nightMarket` era flag.
  const marketHalos: Array<{ x: number; y: number; z: number; size: number; pool: number }> = [];
  const marketBulb = new THREE.IcosahedronGeometry(0.055, 0);
  const MARKET_BULBS = [0xffd978, 0xffb85c, 0xfff0c2] as const;
  for (const s of STALLS) {
    const p = new Placer(lights, s.x, s.z, s.yaw);
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const lx = -0.98 + (i / n) * 1.96;
      const w = p.world(lx, 0, 0.8);
      const sag = Math.sin((i / n) * Math.PI * 3) * 0.04; // three little scallops between the posts
      lights.add(marketBulb, MARKET_BULBS[i % 3]!, w.x, 1.78 - sag, w.z);
    }
    for (const lx of [-0.55, 0.55]) marketHalos.push({ ...p.world(lx, 1.78, 0.8), size: 1.5, pool: 2.6 });
  }
  const marketGroup = new THREE.Group();
  marketGroup.name = 'nightMarket';
  marketGroup.add(buildHalos(marketHalos));
  marketGroup.visible = false;

  const buntingMesh = bunting.mesh({ cast: false });
  buntingMesh.visible = false;
  const festive = new THREE.Group();
  festive.add(lights.mesh({ cast: false, receive: false, material: bulbMaterial() }), wreaths.mesh({ cast: false }));
  festive.visible = false;

  // merged statics / glow / bulbs
  const staticsMesh = statics.mesh({ cast: true, receive: true });
  const bulbMesh = bulbs.mesh({ cast: false, receive: false, material: bulbMaterial() });
  // night halos: the big warm glow of the fir + the stall / entrance lanterns, in ONE mesh (per-spot sizes)
  const halos = new THREE.Group();
  halos.add(buildHalos([{ x: tree.x, y: FIR_STAR_Y, z: tree.z, size: 4.2, pool: 10 }, ...stallHalos.map((s) => ({ ...s, size: 1.5, pool: 3.2 }))]));
  pop.add(staticsMesh, bulbMesh, sign, buntingMesh, festive, halos, marketGroup);

  registerEra((look) => {
    lamps.show(look.lamp);
    buntingMesh.visible = look.bunting;
    festive.visible = look.festive || look.nightMarket; // the festive mesh also carries the market bulb strings
    marketGroup.visible = look.nightMarket;
  });

  // =====================================================================================================
  // The little gate in the village's east fence (visible once the village is, closed until open())
  // =====================================================================================================
  const gateGroup = new THREE.Group();
  gateGroup.name = 'townGate';
  gateGroup.visible = ctx.state.village.revealed;
  ctx.events.on('village:revealed', () => {
    gateGroup.visible = true;
  });
  root.add(gateGroup);
  const gx = V.area.maxX + 0.3;
  const hingeLo = gate.minZ + 0.1;
  const hingeHi = gate.maxZ - 0.1;
  const leafLen = (hingeHi - hingeLo) / 2;
  const leafGeometry = (bar: 1 | -1): THREE.BufferGeometry => {
    const b = new Batch();
    const n = Math.max(2, Math.round(leafLen / 0.19));
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.compose(new THREE.Vector3(0.1 + i * ((leafLen - 0.2) / (n - 1)), 0, 0), new THREE.Quaternion(), new THREE.Vector3(0.8, 0.62, 0.8));
      b.addMatrix(palisadePostGeometry(), PALETTE.fence, m);
    }
    for (const y of [0.18, 0.38]) b.add(box(leafLen, 0.07, 0.05), PALETTE.fenceDark, leafLen / 2, y, 0.09 * bar);
    return b.geometry();
  };
  const makeLeaf = (hinge: number, bar: 1 | -1): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(gx, 0, hinge);
    const m = new THREE.Mesh(leafGeometry(bar), vcMat());
    m.castShadow = false;
    m.receiveShadow = true;
    pivot.add(m);
    gateGroup.add(pivot);
    return pivot;
  };
  const leafLo = makeLeaf(hingeLo, -1);
  const leafHi = makeLeaf(hingeHi, 1);
  const swing = (k: number): void => {
    leafLo.rotation.y = -(Math.PI / 2) * (1 - k);
    leafHi.rotation.y = (Math.PI / 2) * (1 - k);
  };
  swing(0);

  // =====================================================================================================
  // Open / pop animation
  // =====================================================================================================
  let isOpen = false;
  let gateT = 0;
  let gateAnim = false;
  let popT = 0;
  let popAnim = false;
  let popped = false;
  const setPop = (k: number): void => {
    pop.scale.y = Math.max(0.001, k);
  };
  const puff = (x: number, y: number, z: number, size = 1): void => {
    const v = new THREE.Vector3(x, y, z);
    ctx.particles.puff(v, { color: 0xffffff, count: 3, size, life: 0.9 });
  };
  const puffs: Array<[number, number, number, number]> = [
    [tree.x, 0.4, tree.z, 1.6],
    [STALLS[0]!.x, 0.4, STALLS[0]!.z, 1.0],
    [STALLS[1]!.x, 0.4, STALLS[1]!.z, 1.0],
    [archX, 0.4, pz, 1.2],
    [SNOWMAN.x, 0.4, SNOWMAN.z, 0.9],
    ...BENCHES.map((b) => [b.x, 0.3, b.z, 0.8] as [number, number, number, number]),
  ];

  const part: TownPart = {
    group: root,
    get isOpen(): boolean {
      return isOpen;
    },
    open(instant: boolean): void {
      if (isOpen) return;
      isOpen = true;
      district.visible = true;
      if (instant) {
        gateAnim = false;
        popAnim = false;
        swing(1);
        setPop(1);
        popped = true;
        return;
      }
      gateAnim = true;
      gateT = 0;
      popAnim = true;
      popT = -0.35; // the gate swings first, then the market pops up
      setPop(0.001);
    },
    update(dt: number): void {
      if (gateAnim) {
        gateT += dt;
        const k = Math.min(1, gateT / OPEN_TIME);
        swing(easeBack(k));
        if (k >= 1) {
          gateAnim = false;
          swing(1);
        }
      }
      if (popAnim) {
        popT += dt;
        if (popT > 0 && !popped) {
          popped = true;
          for (const p of puffs) puff(p[0], p[1], p[2], p[3]);
        }
        const k = Math.max(0, Math.min(1, popT / POP_TIME));
        setPop(popT < 0 ? 0.001 : easeBack(k, 1.5));
        if (k >= 1) {
          popAnim = false;
          setPop(1);
        }
      }
    },
  };
  return part;
}
