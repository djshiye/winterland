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
/** 0.9.12 (V10): the highway deck is a warm slate and its markings soft cream, not black asphalt with yellow lines. */
const DECK = 0x625d5f;
const MARKING = 0xf1e4c4;
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

function slopeAt(x: number): number {
  for (let i = 1; i < PROFILE.length; i++) {
    const [x1, y1] = PROFILE[i]!;
    const [x0, y0] = PROFILE[i - 1]!;
    if (x <= x1) return Math.atan2(y1 - y0, x1 - x0);
  }
  return 0;
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
  const curbGeo = new THREE.BoxGeometry(1, 0.55, 0.3);
  const curbSnow = new THREE.BoxGeometry(1, 0.08, 0.34);
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
    hw.add(slabGeo, DECK, mx - nrm.x * (slabT / 2), my - nrm.y * (slabT / 2), HZ, { sx: len, sy: slabT / 0.5, rz: th });
    if (raised) {
      for (const dz of [-HW / 2 - 0.05, HW / 2 + 0.05]) {
        hw.add(curbGeo, 0xb4bfce, mx + nrm.x * 0.2, my + nrm.y * 0.2, HZ + dz, { sx: len, rz: th });
        hw.add(curbSnow, PALETTE.snow, mx + nrm.x * 0.5, my + nrm.y * 0.5, HZ + dz, { sx: len, rz: th });
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
  hw.add(new THREE.BoxGeometry(0.9, 0.2, HW - 0.1), PALETTE.snow, W.rampWest.to + 0.7, bY - 0.05, HZ);
  hw.add(new THREE.BoxGeometry(0.9, 0.2, HW - 0.1), PALETTE.snow, W.rampEast.from - 0.7, bY - 0.05, HZ);
  // Dashed centre line following the profile.
  const dash = new THREE.BoxGeometry(1.5, 0.03, 0.17);
  for (let x = -92; x < ROAD_END_X - 2; x += 3.2) {
    hw.add(dash, MARKING, x, highwayY(x) + 0.015, HZ, { rz: slopeAt(x) });
  }
  // Pale edge lines on flat sections.
  const edgeLine = new THREE.BoxGeometry(1, 0.03, 0.1);
  const flatSpans: Array<[number, number]> = [[-95, W.rampWest.from], [W.rampEast.to, ROAD_END_X]];
  for (const [a, b] of flatSpans) {
    for (const dz of [-HW / 2 + 0.25, HW / 2 - 0.25]) hw.add(edgeLine, 0xd7e0ea, (a + b) / 2, TOP + 0.015, HZ + dz, { sx: b - a });
  }
  // 0.9.9: where the tricycle road crosses the highway, stop bars and give-way triangles on the tricycle road (it
  // used to run under the asphalt with nothing to say it was a junction)
  for (const s of [-1, 1]) {
    const z = HZ + s * (HW / 2 + 0.55);
    hw.add(new THREE.BoxGeometry(roadW - 0.5, 0.03, 0.26), MARKING, (tr.minX + tr.maxX) / 2, 0.03, z);
    for (const dx of [-1.1, 0, 1.1]) {
      hw.add(new THREE.ConeGeometry(0.3, 0.03, 3).rotateY(s < 0 ? Math.PI : 0), 0xffffff, (tr.minX + tr.maxX) / 2 + dx, 0.03, z + s * 0.75, { sz: 1.4 });
    }
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
  sp.add(frame, 0xb3bfce, S.minX + 0.5, 0, HZ);
  const mouth = new THREE.ShapeGeometry(archShape(2.75, 2.8)).rotateY(-Math.PI / 2);
  sp.add(mouth, 0x12161d, S.minX + 0.02, 0, HZ);
  // Hazard stripes on the visible (+Z) side of the portal frame.
  for (let i = 0; i < 4; i++) {
    sp.add(new THREE.BoxGeometry(0.5, 0.5, 0.1), i % 2 ? PALETTE.rubber : PALETTE.roadLine, S.minX - 0.4, 0.3 + i * 0.5, HZ + 3.52);
  }
  const spur = sp.mesh({ cast: false, flat: true });
  group.add(spur);

  return { group, trikeTail };
}
