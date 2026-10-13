/** Chunky post-and-rail fences, merged into one mesh per fence group. */
import * as THREE from 'three';
import { LAYOUT, PALETTE } from '../../config';
import { Batch, W, type EnvPart } from './common';

const POST_H = 1.1;
const postGeo = new THREE.BoxGeometry(0.28, POST_H, 0.28);
const capGeo = new THREE.BoxGeometry(0.4, 0.1, 0.4);
const railGeo = new THREE.BoxGeometry(1, 0.13, 0.1);
const topSnowGeo = new THREE.BoxGeometry(1, 0.07, 0.15);

export interface FenceLine {
  /** Axis the fence runs along. */
  axis: 'x' | 'z';
  /** Constant coordinate on the other axis. */
  at: number;
  from: number;
  to: number;
  /** Open gaps (ranges along the axis) — e.g. counters. */
  gaps?: Array<[number, number]>;
}

/** Add the fence line to `batch`. */
export function addFence(batch: Batch, line: FenceLine): void {
  const gaps = [...(line.gaps ?? [])].sort((a, b) => a[0] - b[0]);
  const pieces: Array<[number, number, boolean, boolean]> = [];
  let cursor = line.from;
  let afterGap = false;
  for (const [a, b] of gaps) {
    pieces.push([cursor, a, afterGap, true]);
    cursor = b;
    afterGap = true;
  }
  pieces.push([cursor, line.to, afterGap, false]);
  // flags: piece starts / ends at a gap edge (taller gate-style posts)
  const rotated = line.axis === 'z';
  for (let i = 0; i < pieces.length; i++) {
    const [s, e, startsAtGap, endsAtGap] = pieces[i]!;
    if (e - s < 0.3) continue;
    const n = Math.max(1, Math.ceil((e - s) / 1.8));
    const step = (e - s) / n;
    for (let k = 0; k <= n; k++) {
      const u = s + k * step;
      const gate = (k === 0 && startsAtGap) || (k === n && endsAtGap);
      const x = rotated ? line.at : u;
      const z = rotated ? u : line.at;
      const sy = gate ? 1.3 : 1;
      batch.add(postGeo, gate ? PALETTE.fenceDark : PALETTE.fence, x, (POST_H * sy) / 2, z, { sy });
      batch.add(capGeo, PALETTE.snow, x, POST_H * sy + 0.04, z);
    }
    const len = e - s;
    const mid = (s + e) / 2;
    const rx = rotated ? line.at : mid;
    const rz = rotated ? mid : line.at;
    const o = { sx: len, ry: rotated ? Math.PI / 2 : 0 };
    batch.add(railGeo, PALETTE.fence, rx, 0.42, rz, o);
    batch.add(railGeo, PALETTE.fenceDark, rx, 0.8, rz, o);
    batch.add(topSnowGeo, PALETTE.snow, rx, 0.9, rz, { sx: len * 0.96, ry: rotated ? Math.PI / 2 : 0 });
  }
}

export interface FencesPart extends EnvPart {
  /** North (-Z) fence, removed by expand(). */
  readonly north: THREE.Group;
  /** Fence at the expanded edge, built hidden. */
  readonly expansion: THREE.Group;
}

export function buildFences(): FencesPart {
  const group = new THREE.Group();
  group.name = 'fences';
  const Y = LAYOUT.yard;
  const wc = LAYOUT.walkInCounter;
  const se = LAYOUT.seCounter;

  const main = new Batch();
  addFence(main, { axis: 'x', at: Y.maxZ, from: Y.minX, to: Y.maxX, gaps: [[wc.x - wc.length / 2, wc.x + wc.length / 2]] });
  addFence(main, { axis: 'z', at: Y.maxX, from: Y.minZ, to: Y.maxZ, gaps: [[se.z - se.length / 2, se.z + se.length / 2]] });
  // Customer path fences.
  const p = LAYOUT.customers.path;
  addFence(main, { axis: 'z', at: p.minX, from: wc.z + wc.depth / 2, to: p.maxZ });
  addFence(main, { axis: 'z', at: p.maxX, from: Y.maxZ, to: p.maxZ });
  group.add(main.mesh());

  const north = new Batch();
  addFence(north, { axis: 'x', at: Y.minZ, from: -8.2, to: Y.maxX });
  const northGroup = new THREE.Group();
  northGroup.add(north.mesh());
  group.add(northGroup);

  const exp = new Batch();
  const tc = LAYOUT.expansion.truckCounter;
  addFence(exp, { axis: 'z', at: Y.maxX, from: LAYOUT.expandedMinZ, to: Y.minZ });
  addFence(exp, {
    axis: 'x',
    at: LAYOUT.expandedMinZ,
    from: W.yardMinX + 0.2,
    to: Y.maxX,
    gaps: [[tc.x - tc.length / 2, tc.x + tc.length / 2]],
  });
  const expGroup = new THREE.Group();
  expGroup.add(exp.mesh());
  expGroup.visible = false;
  expGroup.scale.y = 0.001;
  group.add(expGroup);

  return { group, north: northGroup, expansion: expGroup };
}
