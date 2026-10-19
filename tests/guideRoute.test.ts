/**
 * 0.9.12 (guide arrow): GuideRoute (ui/guideRoute.ts), the walk behind the edge arrow and the guide dots. Covered: the
 * steer point heads for the gap in a wall rather than through it, following the steer reaches the target without the
 * point flip-flopping, a teleport is answered from the same field without a new plan, target changes and clearing,
 * the straight-line fallback for an unreachable target, and re-planning when the world changes.
 */
import { describe, expect, it } from 'vitest';
import { GuideRoute } from '../src/ui/guideRoute';
import { ColliderWorld } from '../src/world/Colliders';
import type { XZ } from '../src/world/navGrid';

const R = 0.36;
const wallWithGap = (): ColliderWorld => {
  const c = new ColliderWorld();
  c.setBounds({ minX: 0, maxX: 40, minZ: 0, maxZ: 40 });
  c.addBox({ minX: 19, maxX: 21, minZ: 0, maxZ: 18 }, 'wall');
  c.addBox({ minX: 19, maxX: 21, minZ: 22, maxZ: 40 }, 'wall');
  return c;
};

/** Update a few times so the field (a slice per update) settles. */
const settle = (g: GuideRoute, now: number, player: XZ, target: XZ | null, area = null as Parameters<GuideRoute['update']>[3], n = 12): void => {
  for (let i = 0; i < n; i++) g.update(now, player, target, area);
};

describe('GuideRoute', () => {
  it('steers toward the gap, not straight at the target through the wall', () => {
    const g = new GuideRoute(wallWithGap(), R);
    const player = { x: 5, z: 5 };
    const target = { x: 35, z: 5 };
    settle(g, 0, player, target);
    expect(g.steer).not.toBeNull();
    expect(g.reachable).toBe(true);
    const s = g.steer!;
    // straight at the target would be +x with z unchanged; the gap is at z 18..22
    expect(s.z - player.z).toBeGreaterThan(2);
    expect(g.walk).not.toBeNull();
    const full = g.fullWalk(player)!;
    expect(full.length).toBeGreaterThan(30);
    expect(g.remaining).toBeCloseTo(full.length, -1);
    expect(Math.abs(g.remaining - full.length)).toBeLessThan(2);
  });

  it('waits (steer null) until the player\'s spot is known, then points the right way', () => {
    const g = new GuideRoute(wallWithGap(), R);
    g.update(0, { x: 5, z: 5 }, { x: 35, z: 5 });
    // one slice is not enough for the far side of this map? either way never point at a wall: steer is null or valid
    if (g.steer) expect(g.steer.z - 5).toBeGreaterThan(2);
    settle(g, 0, { x: 5, z: 5 }, { x: 35, z: 5 });
    expect(g.steer).not.toBeNull();
  });

  it('following the steer reaches the target without the steer point flip-flopping', () => {
    const g = new GuideRoute(wallWithGap(), R);
    const target = { x: 35, z: 5 };
    const p = { x: 5, z: 5 };
    let now = 0;
    let flips = 0;
    let prevAngle: number | null = null;
    let arrived = false;
    const speed = 0.2; // m per step
    for (let step = 0; step < 1500; step++) {
      now += 0.05;
      g.update(now, p, target);
      const s = g.steer;
      if (!s) continue;
      const dx = s.x - p.x;
      const dz = s.z - p.z;
      const d = Math.hypot(dx, dz);
      const ang = Math.atan2(dz, dx);
      if (prevAngle !== null) {
        let diff = Math.abs(ang - prevAngle);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff > Math.PI / 2) flips++;
      }
      prevAngle = ang;
      if (Math.hypot(target.x - p.x, target.z - p.z) < 1.5) {
        arrived = true;
        break;
      }
      const k = Math.min(speed, d) / (d || 1);
      p.x += dx * k;
      p.z += dz * k;
    }
    expect(arrived).toBe(true);
    // the angle may swing once when a corner is passed, but it never alternates back and forth
    expect(flips).toBeLessThanOrEqual(1);
  });

  it('every step of the followed walk stays on open ground (never walks into the wall)', () => {
    const c = wallWithGap();
    const g = new GuideRoute(c, R);
    const target = { x: 35, z: 5 };
    const p = { x: 5, z: 5 };
    let now = 0;
    for (let step = 0; step < 1500; step++) {
      now += 0.05;
      g.update(now, p, target);
      const s = g.steer;
      if (!s) continue;
      if (Math.hypot(target.x - p.x, target.z - p.z) < 1.5) break;
      const d = Math.hypot(s.x - p.x, s.z - p.z) || 1;
      const k = Math.min(0.2, d) / d;
      p.x += (s.x - p.x) * k;
      p.z += (s.z - p.z) * k;
      expect(c.isFree(p.x, p.z, R - 0.05)).toBe(true);
    }
  });

  it('a teleport far away (same target) is answered within a few updates and without a new plan', () => {
    const g = new GuideRoute(wallWithGap(), R);
    const target = { x: 35, z: 5 };
    settle(g, 0, { x: 5, z: 5 }, target, null, 20);
    const plans = g.plans;
    expect(plans).toBe(1);
    const far = { x: 6, z: 36 };
    for (let i = 0; i < 3; i++) g.update(0.1 + i * 0.05, far, target);
    expect(g.plans).toBe(plans);
    expect(g.steer).not.toBeNull();
    expect(g.reachable).toBe(true);
    // from the north half the way leads south to the gap
    expect(g.steer!.z).toBeLessThan(far.z);
  });

  it('a new target bumps plans; the same target (within 0.5 m) does not', () => {
    const g = new GuideRoute(wallWithGap(), R);
    const p = { x: 5, z: 5 };
    settle(g, 0, p, { x: 35, z: 5 });
    expect(g.plans).toBe(1);
    g.update(0.2, p, { x: 35.2, z: 5 });
    expect(g.plans).toBe(1);
    g.update(0.4, p, { x: 35, z: 30 });
    expect(g.plans).toBe(2);
    g.update(0.6, p, { x: 35, z: 30 }, { minX: 30, maxX: 38, minZ: 28, maxZ: 32 });
    expect(g.plans).toBe(3);
  });

  it('a null target clears steer and walk', () => {
    const g = new GuideRoute(wallWithGap(), R);
    settle(g, 0, { x: 5, z: 5 }, { x: 35, z: 5 });
    expect(g.steer).not.toBeNull();
    g.update(1, { x: 5, z: 5 }, null);
    expect(g.steer).toBeNull();
    expect(g.walk).toBeNull();
    expect(g.remaining).toBe(0);
    expect(g.reachable).toBe(true);
  });

  it('a retargeted route forgets the old steer until the new walk is known', () => {
    const g = new GuideRoute(wallWithGap(), R);
    const p = { x: 5, z: 5 };
    settle(g, 0, p, { x: 35, z: 5 });
    g.update(0.1, p, { x: 5, z: 35 }); // same side: quick
    // whatever it says now leads toward the new target (north), never toward the old gap
    if (g.steer) expect(g.steer.z).toBeGreaterThan(p.z);
  });

  it('an unreachable target falls back to the straight line (reachable false, steer is the target)', () => {
    const c = wallWithGap();
    // close the gap completely
    c.addBox({ minX: 19, maxX: 21, minZ: 18, maxZ: 22 }, 'plug');
    const g = new GuideRoute(c, R);
    const target = { x: 35, z: 5 };
    settle(g, 0, { x: 5, z: 5 }, target, null, 40);
    expect(g.reachable).toBe(false);
    expect(g.steer).toEqual(target);
    expect(g.walk).toBeNull();
    expect(g.remaining).toBeCloseTo(30, 3);
    expect(g.fullWalk({ x: 5, z: 5 })).toBeNull();
  });

  it('a target in a rect zone is reached inside the zone', () => {
    const g = new GuideRoute(wallWithGap(), R);
    const area = { minX: 30, maxX: 36, minZ: 30, maxZ: 36 };
    settle(g, 0, { x: 5, z: 5 }, { x: 33, z: 33 }, area);
    const w = g.fullWalk({ x: 5, z: 5 })!;
    const last = w.points[w.points.length - 1]!;
    expect(last.x).toBeGreaterThanOrEqual(30);
    expect(last.z).toBeGreaterThanOrEqual(30);
  });

  it('re-plans when a collider is added in the way, after the revision check interval', () => {
    const c = wallWithGap();
    const g = new GuideRoute(c, R);
    // a straight shot along z 30 is blocked only by the wall; use the open north half: start and target on the west
    const p = { x: 5, z: 10 };
    const target = { x: 5, z: 30 };
    settle(g, 0, p, target);
    const plans = g.plans;
    const before = g.fullWalk(p)!;
    expect(before.length).toBeLessThan(21);
    // a long barrier across the straight route, with room to go round it at the west end
    c.addBox({ minX: 3, maxX: 17, minZ: 19.5, maxZ: 20.5 }, 'fence');
    g.update(0.5, p, target); // too soon: not looked at yet
    expect(g.plans).toBe(plans);
    settle(g, 2, p, target);
    expect(g.plans).toBeGreaterThan(plans);
    const after = g.fullWalk(p)!;
    expect(after.length).toBeGreaterThan(before.length + 0.5);
    // and it goes round one end of the fence
    expect(after.points.some((q) => q.x > 17 || q.x < 3)).toBe(true);
  });

  it('keeps the last walk on show while a re-plan is being worked out', () => {
    const c = wallWithGap();
    const g = new GuideRoute(c, R);
    const p = { x: 5, z: 5 };
    settle(g, 0, p, { x: 35, z: 5 });
    c.addCircle(30, 30, 1, 'tree');
    g.update(2, p, { x: 35, z: 5 });
    expect(g.plans).toBe(2);
    expect(g.steer).not.toBeNull();
  });
});
