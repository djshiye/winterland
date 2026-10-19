/**
 * 0.9.11 full review (I2, O1, O4): every pickup / drop-off spot gives the player room to stand, and nothing solid on
 * the Market Town square makes a walk from the entrance to a shop counter much longer than the open square would.
 *
 * Replays tests/fixtures/zoneWorld.json: a dump of the live colliders, walkable rects and enabled zones with every yard
 * machine bought and all eight town lots built (toy factory on lot 0). Refresh it after moving props or zones: in the
 * debug build, after `unlock` of every pad, `revealTown`, `buildTown(0..7)` and `buildAmenity` of all four amenities,
 * dump `ctx.colliders.colliders` (enabled), `.bounds`, `.extra` and `ctx.zones.zones` (enabled: id, area, reach).
 */
import { describe, expect, it } from 'vitest';
import { REACH, rectDistance } from '../src/items/Zones';
import { BENCHES, STALLS } from '../src/town/spots';
import { CORRIDOR_LAMPS, SQUARE_LAMPS } from '../src/world/env/town';
import type { Rect } from '../src/config';
import fixture from './fixtures/zoneWorld.json';

interface Fixture {
  radius: number;
  bounds: Rect;
  extra: Rect[];
  colliders: { tag: string; box?: number[]; circle?: number[] }[];
  zones: { id: string; reach: 'exact' | 'body'; area: number[] }[];
}
const F = fixture as Fixture;
const R = F.radius;
const H = 0.1;
const toRect = (a: number[]): Rect => ({ minX: a[0]!, maxX: a[1]!, minZ: a[2]!, maxZ: a[3]! });
const inR = (r: Rect, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const b = F.bounds;
const walkable = (x: number, z: number): boolean =>
  (x >= b.minX + R && x <= b.maxX - R && z >= b.minZ + R && z <= b.maxZ - R) || F.extra.some((r) => inR(r, x, z));
const solid = (x: number, z: number): boolean =>
  F.colliders.some((c) => {
    if (c.box) {
      const d = rectDistance(toRect(c.box), x, z);
      return d < R - 1e-9;
    }
    const [cx, cz, cr] = c.circle!;
    return Math.hypot(x - cx!, z - cz!) < R + cr! - 1e-9;
  });
const reachOf = (z: Fixture['zones'][number]): number => (z.reach === 'body' ? REACH.enter : 0);

/** Square metres where the player's centre can stand and counts as inside the zone. */
function standable(z: Fixture['zones'][number]): number {
  const a = toRect(z.area);
  const e = reachOf(z);
  let n = 0;
  for (let x = a.minX - e; x <= a.maxX + e; x += H) {
    for (let zz = a.minZ - e; zz <= a.maxZ + e; zz += H) {
      if (rectDistance(a, x, zz) <= e && walkable(x, zz) && !solid(x, zz)) n++;
    }
  }
  return n * H * H;
}

describe('every pickup and drop-off gives room to stand (I2)', () => {
  const carry = F.zones.filter((z) => z.id.startsWith('pile:') || z.id.startsWith('counter:'));
  it('the fixture holds the yard and town stations', () => {
    expect(carry.length).toBeGreaterThan(20);
    expect(carry.some((z) => z.id === 'pile:town0Out:pickup')).toBe(true);
  });
  it.each(carry.map((z) => [z.id, z] as const))('%s: body reach and at least 2.5 m² to stand', (_id, z) => {
    expect(z.reach).toBe('body');
    expect(standable(z)).toBeGreaterThanOrEqual(2.5);
  });
});

// ---- Market Town walks (O1 / O4) ------------------------------------------------------------------------------------
const V = { x0: 14.8, x1: 38.4, z0: 19.0, z1: 42.0 };
const NX = Math.ceil((V.x1 - V.x0) / H);
const NZ = Math.ceil((V.z1 - V.z0) / H);
const cx = (i: number): number => V.x0 + (i + 0.5) * H;
const cz = (j: number): number => V.z0 + (j + 0.5) * H;

function grid(withSolids: boolean): Uint8Array {
  const g = new Uint8Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) g[j * NX + i] = walkable(cx(i), cz(j)) && (!withSolids || !solid(cx(i), cz(j))) ? 1 : 0;
  return g;
}

/** Octile shortest walk lengths over free cells from (x, z). */
function walks(g: Uint8Array, x: number, z: number): Float64Array {
  const dist = new Float64Array(NX * NZ).fill(Infinity);
  const s = Math.floor((z - V.z0) / H) * NX + Math.floor((x - V.x0) / H);
  dist[s] = 0;
  // small binary heap
  const hk: number[] = [s];
  const hd: number[] = [0];
  const swap = (a: number, c: number): void => {
    [hk[a], hk[c]] = [hk[c]!, hk[a]!];
    [hd[a], hd[c]] = [hd[c]!, hd[a]!];
  };
  const push = (k: number, d: number): void => {
    hk.push(k);
    hd.push(d);
    for (let n = hk.length - 1; n > 0; ) {
      const p = (n - 1) >> 1;
      if (hd[p]! <= hd[n]!) break;
      swap(p, n);
      n = p;
    }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [hk[0]!, hd[0]!];
    const lk = hk.pop()!;
    const ld = hd.pop()!;
    if (hk.length) {
      hk[0] = lk;
      hd[0] = ld;
      for (let n = 0; ; ) {
        const l = 2 * n + 1;
        const r = l + 1;
        let m = n;
        if (l < hk.length && hd[l]! < hd[m]!) m = l;
        if (r < hk.length && hd[r]! < hd[m]!) m = r;
        if (m === n) break;
        swap(m, n);
        n = m;
      }
    }
    return top;
  };
  const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]] as const;
  while (hk.length) {
    const [k, d] = pop();
    if (d > dist[k]!) continue;
    const i = k % NX;
    const j = (k / NX) | 0;
    for (const [di, dj, w] of N8) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
      const nk = nj * NX + ni;
      if (!g[nk] || (di && dj && (!g[j * NX + ni] || !g[nj * NX + i]))) continue;
      const nd = d + w * H;
      if (nd < dist[nk]!) {
        dist[nk] = nd;
        push(nk, nd);
      }
    }
  }
  return dist;
}

/** Shortest walk to the first spot where the player counts as inside zone `z`. */
function walkTo(dist: Float64Array, g: Uint8Array, z: Fixture['zones'][number]): number {
  const a = toRect(z.area);
  const e = reachOf(z);
  let best = Infinity;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i;
    if (g[k] && dist[k]! < best && rectDistance(a, cx(i), cz(j)) <= e) best = dist[k]!;
  }
  return best;
}

describe('Market Town square: nothing solid in the way (O1, O4)', () => {
  const ENTRANCE = { x: 15.65, z: 26.7 }; // the corridor mouth
  const open = grid(false);
  const real = grid(true);
  const free = walks(open, ENTRANCE.x, ENTRANCE.z);
  const dist = walks(real, ENTRANCE.x, ENTRANCE.z);
  const shops = F.zones.filter((z) => z.id.startsWith('pile:town'));

  it('the fixture holds the town stations', () => expect(shops.length).toBeGreaterThanOrEqual(8));

  it.each(shops.map((z) => [z.id, z] as const))('entrance to %s: at most 1.5 m longer than across the open square', (_id, z) => {
    const ideal = walkTo(free, open, z);
    const got = walkTo(dist, real, z);
    expect(Number.isFinite(got)).toBe(true);
    expect(got - ideal).toBeLessThanOrEqual(1.5);
  });

  it('the fixture is current: benches, stalls and lamps stand where the code puts them', () => {
    BENCHES.forEach((s, i) => {
      const seats = F.colliders.filter((c) => c.tag === `town:bench${i}`).map((c) => c.circle!);
      expect(seats.length).toBe(2);
      expect((seats[0]![0]! + seats[1]![0]!) / 2).toBeCloseTo(s.x, 1);
      expect((seats[0]![1]! + seats[1]![1]!) / 2).toBeCloseTo(s.z, 1);
    });
    STALLS.forEach((s, i) => {
      const box = F.colliders.find((c) => c.tag === `town:stall${i}`)!.box!;
      expect((box[0]! + box[1]!) / 2).toBeCloseTo(s.x, 1);
      expect((box[2]! + box[3]!) / 2).toBeCloseTo(s.z, 1);
    });
    const lamps = F.colliders.filter((c) => c.tag === 'town:lamp').map((c) => `${c.circle![0]},${c.circle![1]}`);
    expect(lamps.sort()).toEqual([...SQUARE_LAMPS, ...CORRIDOR_LAMPS].map((l) => `${l.x},${l.z}`).sort());
  });
});
