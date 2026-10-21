/**
 * Tricycle road (SE), North Highway (with a raised bridge over the river so the giant log can float
 * beneath it) and the rocky tunnel spur the pickup trucks emerge from.
 */
import * as THREE from 'three';
import { LAYOUT, PALETTE } from '../../config';
import { geo, mesh, toon } from '../../render/materials';
import { TRIKE_ROAD_END_Z } from '../../eras/data';
import { Batch, W, type EnvPart } from './common';

const HZ = LAYOUT.highway.z;
const HW = LAYOUT.highway.width;
const TOP = 0.04;
/**
 * 0.9.14: the North Road is a packed-snow country road with wheel ruts (like the tricycle road), crossing the river on
 * a timber bridge with snow-capped wooden rails: no asphalt, painted lines or concrete kerbs (0.9.12 had made the deck
 * a warm slate with cream lines, which still read as a modern highway in the opening flyover).
 */
const DECK = 0xb3bccb;
const RUT = 0x8d9db4;
const BRIDGE_DECK = 0x9c6a45;
const BRIDGE_SEAM = 0x7d4a29;
const BRIDGE_BEAM = 0x8a5532;
const ROAD_END_X = 34;

/** Highway profile (world X, height above the ground). */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [-95, 0],
  [W.rampWest.from, 0],
  [W.rampWest.to, W.bridgeY],
  [W.rampEast.from, W.bridgeY],
  [W.rampEast.to, 0],
  [ROAD_END_X, 0],
];

/** Road surface height at world X (flat 0.04 except over the bridge). Trucks may sample this. */
export function highwayY(x: number): number {
  if (x <= PROFILE[0]![0]) return TOP;
  for (let i = 1; i < PROFILE.length; i++) {
    const [x1, y1] = PROFILE[i]!;
    const [x0, y0] = PROFILE[i - 1]!;
    if (x <= x1) return TOP + y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return TOP;
}

function archShape(radius: number, pillar: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-radius, 0);
  s.lineTo(-radius, pillar);
  s.absarc(0, pillar, radius, Math.PI, 0, true);
  s.lineTo(radius, 0);
  s.closePath();
  return s;
}

/** The roads part; `trikeTail` = the tricycle road past TRIKE_ROAD_END_Z (hidden once the new land shows). */
export function buildRoads(): EnvPart & { trikeTail: THREE.Object3D } {
  const group = new THREE.Group();
  group.name = 'roads';

  // ---- tricycle road ------------------------------------------------------
  // 0.9.5: built in two pieces so the tail past TRIKE_ROAD_END_Z (it ran into era II's plot) can hide once the new
  // land shows (env/frontier.ts); with both pieces shown it is the same road as before.
  const tr = LAYOUT.tricycles.road;
  const roadW = tr.maxX - tr.minX;
  const lane = LAYOUT.tricycles.laneX;
  const trikeTail = new THREE.Group();
  trikeTail.name = 'trikeRoadTail';
  for (const [z0, z1, into] of [
    [tr.minZ, TRIKE_ROAD_END_Z, group],
    [TRIKE_ROAD_END_Z, tr.maxZ, trikeTail],
  ] as const) {
    const len = z1 - z0;
    const cz = (z0 + z1) / 2;
    const road = mesh(geo.ground(roadW, len), toon(PALETTE.road), { cast: false });
    road.position.set((tr.minX + tr.maxX) / 2, 0.012, cz);
    into.add(road);
    const ruts = new Batch();
    const rutGeo = new THREE.BoxGeometry(1, 0.01, len);
    for (const [dx, w, c] of [
      [-0.55, 0.22, 0x8d9db4],
      [0.55, 0.22, 0x8d9db4],
      [0, 0.14, 0x9aa9bf],
      [1.55, 0.2, 0x98a8be],
      [2.05, 0.2, 0x98a8be],
    ] as const) {
      ruts.add(rutGeo, c, lane + dx, 0.016, cz, { sx: w });
    }
    // Soft lighter shoulders.
    ruts.add(new THREE.BoxGeometry(0.18, 0.01, len), 0xdfe8f3, tr.minX + 0.12, 0.016, cz);
    ruts.add(new THREE.BoxGeometry(0.18, 0.01, len), 0xdfe8f3, tr.maxX - 0.12, 0.016, cz);
    into.add(ruts.mesh({ cast: false }));
  }
  group.add(trikeTail);

  // ---- highway ------------------------------------------------------------------
  const hw = new Batch();
  const slabGeo = new THREE.BoxGeometry(1, 0.5, HW);
  const beamGeo = new THREE.BoxGeometry(1, 0.42, 0.26);
  const railGeo = new THREE.BoxGeometry(1, 0.1, 0.12);
  const railSnow = new THREE.BoxGeometry(1, 0.06, 0.16);
  const postGeo = new THREE.BoxGeometry(0.18, 1, 0.18);
  const capGeo = new THREE.BoxGeometry(0.24, 0.08, 0.24);
  const seamGeo = new THREE.BoxGeometry(0.05, 0.02, HW - 0.1);
  const nrm = new THREE.Vector2();
  for (let i = 1; i < PROFILE.length; i++) {
    const [x0, y0] = PROFILE[i - 1]!;
    const [x1, y1] = PROFILE[i]!;
    const th = Math.atan2(y1 - y0, x1 - x0);
    const len = Math.hypot(x1 - x0, y1 - y0) + 0.12;
    nrm.set(-Math.sin(th), Math.cos(th));
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2 + TOP;
    const raised = y0 > 0 || y1 > 0;
    const slabT = raised ? 0.5 : 0.3;
    hw.add(slabGeo, raised ? BRIDGE_DECK : DECK, mx - nrm.x * (slabT / 2), my - nrm.y * (slabT / 2), HZ, { sx: len, sy: slabT / 0.5, rz: th });
    if (!raised) continue;
    // timber bridge: plank seams across the deck, a side beam, posts with snow caps and a rail on each side
    const run = Math.hypot(x1 - x0, y1 - y0);
    for (let d = 0.35; d < run; d += 0.7) {
      const x = x0 + ((x1 - x0) * d) / run;
      hw.add(seamGeo, BRIDGE_SEAM, x, highwayY(x) + 0.005, HZ, { rz: th });
    }
    for (const dz of [-HW / 2 - 0.08, HW / 2 + 0.08]) {
      hw.add(beamGeo, BRIDGE_BEAM, mx - nrm.x * 0.12, my - nrm.y * 0.12, HZ + dz, { sx: len, rz: th });
      hw.add(railGeo, PALETTE.fence, mx + nrm.x * 0.85, my + nrm.y * 0.85, HZ + dz, { sx: len, rz: th });
      hw.add(railSnow, PALETTE.snow, mx + nrm.x * 0.92, my + nrm.y * 0.92, HZ + dz, { sx: len, rz: th });
      hw.add(railGeo, PALETTE.fence, mx + nrm.x * 0.45, my + nrm.y * 0.45, HZ + dz, { sx: len, rz: th });
      const posts = Math.max(1, Math.round(run / 1.6));
      for (let k = 0; k <= posts; k++) {
        const x = x0 + ((x1 - x0) * k) / posts;
        const y = highwayY(x);
        hw.add(postGeo, PALETTE.fence, x, y + 0.45, HZ + dz, { sy: 0.9 });
        hw.add(capGeo, PALETTE.snow, x, y + 0.94, HZ + dz);
      }
    }
  }
  // Embankments under the ramps + bridge abutments (stone) – sloped sides are snow covered.
  const wedge = (pts: Array<[number, number]>): THREE.BufferGeometry => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth: HW - 0.3, bevelEnabled: false });
    g.translate(0, 0, -(HW - 0.3) / 2);
    return g;
  };
  const bY = W.bridgeY;
  hw.add(wedge([[W.rampWest.from, -0.2], [W.rampWest.to, -0.2], [W.rampWest.to, bY - 0.1], [W.rampWest.from, -0.05]]), PALETTE.snowShade, 0, 0, HZ);
  hw.add(wedge([[W.rampEast.from, -0.2], [W.rampEast.to, -0.2], [W.rampEast.to, -0.05], [W.rampEast.from, bY - 0.1]]), PALETTE.snowShade, 0, 0, HZ);
  const abut = new THREE.BoxGeometry(1.2, bY + 0.2, HW - 0.3);
  hw.add(abut, PALETTE.rock, W.rampWest.to + 0.3 + 0.3, (bY - 0.1) / 2 - 0.1 + 0.0, HZ);
  hw.add(abut, PALETTE.rock, W.rampEast.from - 0.3 - 0.3, (bY - 0.1) / 2 - 0.1, HZ);
  hw.add(new THREE.BoxGeometry(0.9, 0.2, HW - 0.1), PALETTE.snow, W.rampWest.to + 0.7, bY - 0.25, HZ);
  hw.add(new THREE.BoxGeometry(0.9, 0.2, HW - 0.1), PALETTE.snow, W.rampEast.from - 0.7, bY - 0.25, HZ);
  // Wheel ruts in the packed snow (one pair per lane) on the flat stretches, and snowy verges along both edges.
  const rutGeo = new THREE.BoxGeometry(1, 0.012, 0.22);
  const vergeGeo = new THREE.BoxGeometry(1, 0.05, 0.4);
  const flatSpans: Array<[number, number]> = [[-95, W.rampWest.from], [W.rampEast.to, ROAD_END_X]];
  for (const [a, b] of flatSpans) {
    for (const dz of [-1.5, -0.7, 0.7, 1.5]) hw.add(rutGeo, RUT, (a + b) / 2, TOP + 0.008, HZ + dz, { sx: b - a });
    for (const dz of [-HW / 2 + 0.1, HW / 2 - 0.1]) hw.add(vergeGeo, PALETTE.snow, (a + b) / 2, TOP + 0.01, HZ + dz, { sx: b - a });
  }
  // 0.9.9: where the tricycle road crosses the highway, a timber threshold on the tricycle road each side says it is
  // a junction (0.9.14: was a painted stop bar with give-way triangles)
  for (const s of [-1, 1]) {
    const z = HZ + s * (HW / 2 + 0.55);
    hw.add(new THREE.BoxGeometry(roadW - 0.5, 0.05, 0.3), BRIDGE_DECK, (tr.minX + tr.maxX) / 2, 0.03, z);
  }
  group.add(hw.mesh({ cast: true }));

  // ---- tunnel spur ------------------------------------------------------------------
  const S = W.spur;
  const sp = new Batch();
  const sw = S.maxX - S.minX;
  const sd = S.maxZ - S.minZ;
  const cz = (S.minZ + S.maxZ) / 2;
  const cx = (S.minX + S.maxX) / 2;
  sp.add(new THREE.BoxGeometry(sw, S.height, sd), PALETTE.mountainDark, cx, S.height / 2, cz);
  // Rocky mass above / in front of the tunnel (hides the block's walls and the trucks' spawn).
  const peak = (x: number, z: number, r: number, h: number, snow: number, col: number): void => {
    const ry = x * 0.7;
    sp.add(new THREE.ConeGeometry(r, h, 7, 1, true), col, x, h / 2 - 0.5, z, { ry });
    const ch = h * snow;
    sp.add(new THREE.ConeGeometry(r * snow * 1.04, ch, 7, 1, true), PALETTE.snow, x, h - ch / 2 - 0.5 + 0.03, z, { ry });
  };
  peak(40.5, -21, 10, 11, 0.45, PALETTE.mountain);
  peak(53, -20, 11.5, 12.5, 0.45, PALETTE.mountainDark);
  peak(64, -21, 9, 9, 0.5, PALETTE.mountain);
  peak(43, -29, 12, 17, 0.5, PALETTE.mountainDark);
  peak(56, -27.5, 12.5, 15, 0.5, PALETTE.mountain);
  // Portal frame + dark mouth facing -X.
  const frame = new THREE.ExtrudeGeometry(
    (() => {
      const outer = archShape(3.5, 2.8);
      const hole = new THREE.Path();
      hole.moveTo(-2.75, 0);
      hole.lineTo(-2.75, 2.8);
      hole.absarc(0, 2.8, 2.75, Math.PI, 0, true);
      hole.lineTo(2.75, 0);
      hole.closePath();
      outer.holes.push(hole);
      return outer;
    })(),
    { depth: 1.5, bevelEnabled: false },
  )
    .rotateY(-Math.PI / 2);
  // 0.9.14: a stone portal with a timber lintel (was a concrete frame with hazard stripes)
  sp.add(frame, PALETTE.rock, S.minX + 0.5, 0, HZ);
  sp.add(new THREE.BoxGeometry(0.5, 0.45, 7.6), BRIDGE_BEAM, S.minX - 0.3, 6.55, HZ);
  sp.add(new THREE.BoxGeometry(0.6, 0.12, 7.8), PALETTE.snow, S.minX - 0.3, 6.83, HZ);
  const mouth = new THREE.ShapeGeometry(archShape(2.75, 2.8)).rotateY(-Math.PI / 2);
  sp.add(mouth, 0x12161d, S.minX + 0.02, 0, HZ);
  const spur = sp.mesh({ cast: false, flat: true });
  group.add(spur);

  return { group, trikeTail };
}
