import { describe, expect, it } from 'vitest';
import { FOLLOW_DISTANCE, FOLLOW_LAG, FOLLOW_MAX_SPEED, PET_AFTER, PET_DISTANCE, PET_EVERY, followStep, restHeading, type XZ } from '../src/entities/Dog';

const DT = 1 / 60;

function simulate(dog: XZ, player: XZ, heading: XZ, seconds: number): XZ {
  let d = { ...dog };
  for (let t = 0; t < seconds; t += DT) d = followStep(d, player, heading, DT);
  return d;
}

describe('Sled dog follow step', () => {
  it('converges to 1.2 m behind a standing player', () => {
    const heading = { x: 0, z: 1 };
    const d = simulate({ x: 3, z: -4 }, { x: 0, z: 0 }, heading, 4);
    expect(d.x).toBeCloseTo(0, 2);
    expect(d.z).toBeCloseTo(-FOLLOW_DISTANCE, 2);
  });

  it('is behind the player for any heading', () => {
    for (const a of [0, 1, 2.4, -2, Math.PI]) {
      const h = { x: Math.sin(a), z: Math.cos(a) };
      const p = { x: 5, z: -2 };
      const d = simulate({ x: 5, z: -2 }, p, h, 4);
      expect(Math.hypot(d.x - p.x, d.z - p.z)).toBeCloseTo(FOLLOW_DISTANCE, 2);
      expect((d.x - p.x) * h.x + (d.z - p.z) * h.z).toBeCloseTo(-FOLLOW_DISTANCE, 2);
    }
  });

  it('never overshoots: the distance to the target only shrinks', () => {
    const heading = { x: 1, z: 0 };
    const player = { x: 10, z: 4 };
    const target = { x: player.x - FOLLOW_DISTANCE, z: player.z };
    for (const dt of [1 / 240, 1 / 60, 1 / 20, 0.5, 5]) {
      let d: XZ = { x: -20, z: 30 };
      let prev = Math.hypot(target.x - d.x, target.z - d.z);
      for (let i = 0; i < 400; i++) {
        d = followStep(d, player, heading, dt);
        const dist = Math.hypot(target.x - d.x, target.z - d.z);
        expect(dist).toBeLessThanOrEqual(prev + 1e-9);
        // stays on the segment start -> target (never past it)
        expect((target.x - d.x) * (target.x - -20) + (target.z - d.z) * (target.z - 30)).toBeGreaterThanOrEqual(-1e-6);
        prev = dist;
      }
    }
  });

  it('closes about 63% of the gap in one lag time constant', () => {
    const heading = { x: 0, z: 1 };
    const start = { x: 0, z: -1.2 - 2 };
    const d = simulate(start, { x: 0, z: 0 }, heading, FOLLOW_LAG);
    const gap = Math.abs(d.z - -FOLLOW_DISTANCE);
    expect(gap).toBeGreaterThan(2 * 0.3);
    expect(gap).toBeLessThan(2 * 0.45);
  });

  it('caps its speed', () => {
    const d = followStep({ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 1, z: 0 }, DT);
    expect(Math.hypot(d.x, d.z)).toBeLessThanOrEqual(FOLLOW_MAX_SPEED * DT + 1e-9);
  });

  it('trails a moving player by roughly speed x lag behind the follow spot', () => {
    const heading = { x: 1, z: 0 };
    const speed = 6.4;
    let d: XZ = { x: -FOLLOW_DISTANCE, z: 0 };
    let px = 0;
    for (let i = 0; i < 600; i++) {
      px += speed * DT;
      d = followStep(d, { x: px, z: 0 }, heading, DT);
    }
    expect(px - d.x).toBeGreaterThan(FOLLOW_DISTANCE);
    expect(px - d.x).toBeCloseTo(FOLLOW_DISTANCE + speed * FOLLOW_LAG, 0);
  });
});

describe('Pet your pal (0.9.11)', () => {
  it('a pal sitting on its follow spot is close enough for a pat', () => {
    expect(FOLLOW_DISTANCE).toBeLessThan(PET_DISTANCE);
  });

  it('pats are calm: a short wait first, then a long gap', () => {
    expect(PET_AFTER).toBeGreaterThanOrEqual(2);
    expect(PET_EVERY[0]).toBeGreaterThanOrEqual(8);
    expect(PET_EVERY[1]).toBeGreaterThan(PET_EVERY[0]);
  });
});

describe('0.9.12 restHeading: the pal settles on free ground', () => {
  it('keeps its spot behind when that is free', () => {
    const h = { x: 1, z: 0 };
    expect(restHeading({ x: 0, z: 0 }, h, () => false)).toBe(h);
  });
  it('turns round the player when the spot behind is inside something solid', () => {
    // a wall west of x = -0.5: the spot behind (x = -1.2) is blocked, the one beside him is not
    const out = restHeading({ x: 0, z: 0 }, { x: 1, z: 0 }, (x) => x < -0.5);
    expect(-out.x * FOLLOW_DISTANCE).toBeGreaterThanOrEqual(-0.5);
  });
  it('keeps the heading when nothing round him is free', () => {
    const h = { x: 0, z: 1 };
    expect(restHeading({ x: 0, z: 0 }, h, () => true)).toBe(h);
  });
});
