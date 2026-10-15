/**
 * Wave 11 sled loader (npc/SledLoader.ts): pure job choice and the work posts' clearance from every zone / body they
 * must not stand in (the player's transfer zones, the workshop, the bunkhouse) plus the sled lane.
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT, PRIORITIES, inflate, rect, type Rect, type XZ } from '../src/config';
import { BENCH_POST, CHAIR_BATCH, COUNTER_POST, HOPPER_POST, ROUTES, YARD_POST, chooseJob, type JobView } from '../src/npc/SledLoader';

const R = LAYOUT.ridge;
const base: JobView = { bench: 0, counterCount: 5, counterRoom: 10, hopperCount: 10, sourceLogs: 5, peerJobs: [] };

describe('chooseJob', () => {
  it('idles when nothing is needed', () => expect(chooseJob(base)).toBeNull());
  it('takes chairs once a batch waits', () => {
    expect(chooseJob({ ...base, bench: CHAIR_BATCH })).toBe('chairs');
    expect(chooseJob({ ...base, bench: CHAIR_BATCH - 1 })).toBeNull();
  });
  it('takes a single chair when the counter is empty', () => {
    expect(chooseJob({ ...base, bench: 1, counterCount: 0 })).toBe('chairs');
  });
  it('does not carry chairs to a full counter', () => {
    expect(chooseJob({ ...base, bench: 8, counterRoom: 0 })).toBeNull();
  });
  it('fetches firewood only when the hopper is low and a source has logs', () => {
    expect(chooseJob({ ...base, hopperCount: PRIORITIES.workshopLow - 1 })).toBe('firewood');
    expect(chooseJob({ ...base, hopperCount: PRIORITIES.workshopLow })).toBeNull();
    expect(chooseJob({ ...base, hopperCount: 0, sourceLogs: 0 })).toBeNull();
  });
  it('chairs come before firewood', () => {
    expect(chooseJob({ ...base, bench: 6, hopperCount: 0 })).toBe('chairs');
  });
  it('leaves a job a peer is on to the other helper', () => {
    expect(chooseJob({ ...base, bench: 6, hopperCount: 0, peerJobs: ['chairs'] })).toBe('firewood');
    expect(chooseJob({ ...base, bench: 6, hopperCount: 0, peerJobs: ['firewood'] })).toBe('chairs');
    expect(chooseJob({ ...base, bench: 6, hopperCount: 0, peerJobs: ['chairs', 'firewood'] })).toBeNull();
  });
});

describe('work posts', () => {
  const w = R.workshop;
  const body = rect(w.x, w.z, w.w, w.d);
  const forbidden: Record<string, Rect> = {
    benchZone: w.bench.zone,
    hopperZone: w.hopper.zone,
    counterZone: R.sledCounter.playerZone,
    platformCash: R.platformCash.zone,
    sledCash: R.sledCash.zone,
    workshop: body,
    bunkhouse: rect(R.quarters.x, R.quarters.z, R.quarters.w, R.quarters.d),
  };
  const inside = (p: XZ, r: Rect): boolean => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;
  /** Lane offset of helper `i` (crewHelpers LANE_STEP) for a post looking at `look`; mirrors Helper.lanePoint. */
  const lane = (p: XZ, look: XZ, step: number): XZ => {
    const dx = look.x - p.x;
    const dz = look.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dz / len) * step, z: p.z - (dx / len) * step };
  };
  const posts: [string, XZ, XZ][] = [
    ['bench', BENCH_POST, { x: w.bench.x, z: w.bench.z }],
    ['counter', COUNTER_POST, { x: R.sledCounter.x, z: R.sledCounter.z }],
    ['hopper', HOPPER_POST, { x: HOPPER_POST.x, z: w.hopper.z }],
  ];
  for (const [name, post, look] of posts) {
    for (const step of [0, 0.8]) {
      it(`${name} post (lane ${step}) keeps 0.25 m off every zone and body`, () => {
        const p = lane(post, look, step);
        for (const [zn, r] of Object.entries(forbidden)) expect(inside(p, inflate(r, 0.25)), `${name} in ${zn}`).toBe(false);
      });
    }
  }
  it('stays north of the sled lane', () => {
    const pts = [BENCH_POST, COUNTER_POST, HOPPER_POST];
    for (const p of pts) expect(p.z).toBeLessThan(R.sledLane.z - 0.5);
    for (const p of [...ROUTES.north, ...pts]) expect(p.z).toBeLessThan(R.sledLane.z - 0.5);
  });
  it('the yard post is east of the drop zone pile', () => {
    expect(YARD_POST.x).toBeGreaterThan(LAYOUT.dropZone.collider.maxX + 0.5);
  });
});
