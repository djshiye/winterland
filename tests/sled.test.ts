/**
 * Dog sled path validation (assets/sled.ts createSledTrack): the sled and its huskies all follow one path, so we
 * sweep their footprints along it and measure the clearance to the cash-tube posts, the sled counter, the cash pile,
 * the workshop and the rail.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAYOUT, rect, type Rect } from '../src/config';
import { SLED_HALF_WIDTH, SLED_LANE_Z, SLED_RETURN_Z, TEAM_OFFSETS, TRAIN_HALF_WIDTH, createSledTrack, sledCrossingBands } from '../src/assets/sled';
import { ROUTES } from '../src/stations/CashTubes';

const R = LAYOUT.ridge;
const track = createSledTrack();

/** Post bases are 0.34 m boxes (circle of 0.17 half-width, 0.24 on the diagonal). */
const POSTS = Object.values(ROUTES)
  .flatMap((r) => r.posts)
  .filter((p) => p.x > 13 && p.z > 6.5);
const POST_R = 0.24;
const COUNTER = rect(R.sledCounter.x, R.sledCounter.z, R.sledCounter.length, R.sledCounter.depth);
const SOLIDS: { name: string; r: Rect }[] = [
  { name: 'sled counter', r: COUNTER },
  { name: 'sled cash pile', r: R.sledCash.zone },
  { name: 'workshop', r: rect(R.workshop.x, R.workshop.z, R.workshop.w, R.workshop.d) },
  { name: 'quarters', r: rect(R.quarters.x, R.quarters.z, R.quarters.w, R.quarters.d) },
];

interface Unit {
  /** Half extents across / along, centre offset along (all in the unit's frame). */
  hw: number;
  front: number;
  back: number;
  at: number;
}
const UNITS: Unit[] = [
  { hw: SLED_HALF_WIDTH, front: 1.15, back: 1.15, at: 0 }, // sled with the musher on the runners
  { hw: 0.47, front: 0.7, back: 0.45, at: TEAM_OFFSETS[0] },
  { hw: 0.47, front: 0.7, back: 0.45, at: TEAM_OFFSETS[1] },
];

function distToRect(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

function sweep(fn: (x: number, z: number) => void): void {
  const p = new THREE.Vector3();
  for (let s = track.sStart; s < track.sExit; s += 0.1) {
    for (const u of UNITS) {
      track.at(s + u.at, p);
      const yaw = track.yawAt(s + u.at);
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      for (const a of [-u.back, 0, u.front]) {
        for (const l of [-u.hw, 0, u.hw]) fn(p.x + fx * a + rx * l, p.z + fz * a + rz * l);
      }
    }
  }
}

describe('dog sled path', () => {
  it('stops with the sled at the counter and the head on the lane', () => {
    const p = new THREE.Vector3();
    track.at(track.sStop, p);
    expect(p.x).toBeCloseTo(R.sledLane.stopX, 1);
    expect(p.z).toBeCloseTo(SLED_LANE_Z, 3);
    expect(track.yawAt(track.sStop)).toBeCloseTo(-Math.PI / 2, 2); // facing -X
    track.at(track.sExit, p);
    expect(p.x).toBeGreaterThanOrEqual(R.sledLane.exitX - 0.1);
  });

  it('keeps the lane inside the clearance corridor: counter body to the north, tube posts to the south', () => {
    expect(SLED_LANE_Z - SLED_HALF_WIDTH - COUNTER.maxZ).toBeGreaterThan(0.15);
    for (const post of POSTS.filter((q) => q.z > SLED_LANE_Z)) {
      expect(post.z - POST_R - (SLED_LANE_Z + SLED_HALF_WIDTH)).toBeGreaterThan(0.15);
    }
  });

  it('never touches a post', () => {
    let min = Infinity;
    sweep((x, z) => {
      for (const p of POSTS) min = Math.min(min, Math.hypot(x - p.x, z - p.z) - POST_R);
    });
    expect(min).toBeGreaterThan(0.15);
  });

  it('never touches a solid or a station zone on the ridge', () => {
    for (const { name, r } of SOLIDS) {
      let min = Infinity;
      sweep((x, z) => {
        min = Math.min(min, distToRect(x, z, r));
      });
      expect(min, name).toBeGreaterThan(0.15);
    }
  });

  it('turns around on the SOUTH side of the lane only', () => {
    const p = new THREE.Vector3();
    for (let s = track.sStart; s < track.sExit; s += 0.1) {
      track.at(s, p);
      expect(p.z).toBeGreaterThanOrEqual(SLED_LANE_Z - 1e-3);
    }
  });
});

describe('rail crossing bands (sled <-> train mutual exclusion)', () => {
  const railX = R.rail.x;
  const bands = sledCrossingBands(track, railX);
  const p = new THREE.Vector3();

  /** Sled arc-length -> the x extent of the convoy [back .. nose] along the track. */
  const convoyXs = (s: number): number[] => {
    const out: number[] = [];
    for (let a = -1.15; a <= TEAM_OFFSETS[1] + 0.7; a += 0.05) out.push(track.at(s + a, p).x);
    return out;
  };
  const inCorridor = (x: number): boolean => Math.abs(x - railX) < TRAIN_HALF_WIDTH + SLED_HALF_WIDTH;

  it('covers every pose in which the convoy overlaps the rail corridor', () => {
    for (let s = track.sStart; s < track.sExit; s += 0.05) {
      const overlaps = convoyXs(s).some(inCorridor);
      const inBand = (s >= bands.arrive.start && s <= bands.arrive.end) || (s >= bands.leave.start && s <= bands.leave.end);
      if (overlaps) expect(inBand, `s=${s.toFixed(2)}`).toBe(true);
    }
  });

  it('has one band per lane/return line, ordered along the track, with the counter stop outside both', () => {
    expect(bands.arrive.start).toBeLessThan(bands.arrive.end);
    expect(bands.arrive.end).toBeLessThan(track.sStop);
    expect(track.sStop).toBeLessThan(bands.leave.start);
    expect(bands.leave.end).toBeLessThan(track.sExit);
    track.at(bands.arrive.start + 5, p);
    expect(p.z).toBeCloseTo(SLED_LANE_Z, 3);
    track.at(bands.leave.start + 5, p);
    expect(p.z).toBeCloseTo(SLED_RETURN_Z, 3);
  });

  it('keeps the whole convoy clear of the corridor while held 1 m before a band', () => {
    for (const b of [bands.arrive, bands.leave]) {
      for (const x of convoyXs(b.start - 1)) expect(inCorridor(x)).toBe(false);
    }
  });
});
