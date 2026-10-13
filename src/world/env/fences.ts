/** Palisade fences (art spec): rows of vertical posts, one InstancedMesh per fence group. */
import * as THREE from 'three';
import { LAYOUT } from '../../config';
import { PALISADE, palisadeMaterial, palisadePostGeometry } from '../../assets/scenery';
import { instanced, Rng, W, type EnvPart, type Placement } from './common';

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

/** Sturdier, taller posts flank every gap (gate posts). */
const GATE_SCALE = { r: 1.35, h: 1.3 };

/** Append the palisade posts for `line` to `out`. */
export function addPalisade(out: Placement[], line: FenceLine, rng: Rng): void {
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

  for (const [s, e, startGate, endGate] of pieces) {
    if (e - s < 0.2) continue;
    const n = Math.max(1, Math.round((e - s) / PALISADE.spacing));
    const step = (e - s) / n;
    for (let k = 0; k <= n; k++) {
      const gate = (k === 0 && startGate) || (k === n && endGate);
      const u = s + k * step;
      const jitter = rng.range(0.94, 1.06);
      const gx = gate ? GATE_SCALE.r : 1;
      out.push({
        x: line.axis === 'x' ? u : line.at,
        z: line.axis === 'x' ? line.at : u,
        sx: gx,
        sy: (gate ? GATE_SCALE.h : 1) * jitter,
        sz: gx,
      });
    }
  }
}

export interface FencesPart extends EnvPart {
  /** North (-Z) fence, removed by expand(). */
  readonly north: THREE.Group;
  /** Fence at the expanded edge, built hidden. */
  readonly expansion: THREE.Group;
}

function run(lines: FenceLine[], rng: Rng, cast = true): THREE.InstancedMesh {
  const items: Placement[] = [];
  for (const l of lines) addPalisade(items, l, rng);
  return instanced(palisadePostGeometry(), palisadeMaterial(), items, { cast });
}

export function buildFences(): FencesPart {
  const group = new THREE.Group();
  group.name = 'fences';
  const rng = new Rng(777);
  const Y = LAYOUT.yard;
  const wc = LAYOUT.walkInCounter;
  const se = LAYOUT.seCounter;
  const half = (c: { length: number }): number => c.length / 2;

  group.add(
    run(
      [
        { axis: 'x', at: Y.maxZ, from: Y.minX, to: Y.maxX, gaps: [[wc.x - half(wc), wc.x + half(wc)]] },
        { axis: 'z', at: Y.maxX, from: Y.minZ, to: Y.maxZ, gaps: [[se.z - half(se), se.z + half(se)]] },
        // Customer path fences.
        { axis: 'z', at: LAYOUT.customers.path.minX, from: wc.z + wc.depth / 2, to: LAYOUT.customers.path.maxZ },
        { axis: 'z', at: LAYOUT.customers.path.maxX, from: Y.maxZ, to: LAYOUT.customers.path.maxZ },
      ],
      rng,
    ),
  );

  const northGroup = new THREE.Group();
  northGroup.add(run([{ axis: 'x', at: Y.minZ, from: -8.2, to: Y.maxX }], rng));
  group.add(northGroup);

  const tc = LAYOUT.expansion.truckCounter;
  const expGroup = new THREE.Group();
  expGroup.add(
    run(
      [
        { axis: 'z', at: Y.maxX, from: LAYOUT.expandedMinZ, to: Y.minZ },
        { axis: 'x', at: LAYOUT.expandedMinZ, from: W.yardMinX + 0.2, to: Y.maxX, gaps: [[tc.x - half(tc), tc.x + half(tc)]] },
      ],
      rng,
    ),
  );
  expGroup.visible = false;
  expGroup.scale.y = 0.001;
  group.add(expGroup);

  return { group, north: northGroup, expansion: expGroup };
}
