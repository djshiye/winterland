/**
 * AI behaviour: people and workers must arrive where they are going, never jam on a shared spot, and keep their routes
 * off solid props. Complements the long in-browser soak run (scripts/soak.mjs), which plays the whole game headless.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAYOUT, type XZ } from '../src/config';
import { AMENITY_SPOTS, POND_GLIDE_VIA, POND_POSTS } from '../src/town/spots';
import { EventBus } from '../src/core/EventBus';
import { createGameState, type GameContext, type GameEvents } from '../src/core/types';
import { NAV, OBSTACLES, PERSON_MARGIN, Path, insideObstacle, lotDoor, ownerAmenity, planPath, planTownPath } from '../src/npc/CrowdNav';
import { Townsfolk, cafeApproach, separationPush } from '../src/npc/Townsfolk';
import type { Town } from '../src/town/Town';

type StaffSpot = { lot: number; x: number; z: number; yaw: number; working: boolean };

/** A town with `spots` staff spots and one townhouse, so every commuter shares one front door. */
function staffWorld(spots: StaffSpot[], homeLot: number) {
  const state = createGameState();
  state.village.revealed = true;
  state.village.level = 3;
  state.town.revealed = true;
  state.town.lots[homeLot]!.building = 'townhouse';
  state.town.lots[homeLot]!.tier = 0;
  const dayNight = { darkness: 0 };
  const ctx = {
    scene: new THREE.Scene(),
    state,
    events: new EventBus<GameEvents>(),
    renderer: { quality: 'high' as 'high' | 'low' },
    dayNight,
    rush: { active: false, spawnMult: 1 },
    items: { release: () => {} },
    flights: { launch: () => {} },
  } as unknown as GameContext;
  const town = { revealed: true, shops: () => [], staffSpots: () => spots } as unknown as Town;
  const folk = new Townsfolk(ctx, town);
  folk.forceWanderers = 0;
  type StaffAgent = { x: number; z: number; commute: number; fading: boolean } | null;
  const staff = (): StaffAgent[] => (folk as unknown as { staff: StaffAgent[] }).staff;
  return { folk, dayNight, staff };
}

/** Two staff on every lot but the townhouse (just inside the lot by its door). */
function staffSpots(home: number): StaffSpot[] {
  const out: StaffSpot[] = [];
  for (let lot = 0; lot < LAYOUT.town.lots.length; lot++) {
    if (lot === home) continue;
    const l = LAYOUT.town.lots[lot]!;
    const d = lotDoor(lot, { x: 0, z: 0 });
    for (const side of [-0.5, 0.5]) {
      out.push({ lot, x: (l.x + d.x) / 2 + l.face.z * side, z: (l.z + d.z) / 2 - l.face.x * side, yaw: 0, working: true });
    }
  }
  return out;
}

describe('town staff commute', () => {
  it('every worker reaches the shared townhouse door at night and goes home (no jam at the door)', () => {
    const spots = staffSpots(2);
    const w = staffWorld(spots, 2);
    for (let i = 0; i < 30; i++) w.folk.update(1 / 30); // staff appear at their spots
    expect(w.staff().filter(Boolean).length).toBe(spots.length);
    w.dayNight.darkness = 1;
    let goneAt = -1;
    for (let i = 0; i < 30 * 90; i++) {
      w.folk.update(1 / 30);
      if (w.staff().every((a) => a === null)) {
        goneAt = i / 30;
        break;
      }
    }
    const left = w.staff().filter(Boolean).map((a) => `${a!.x.toFixed(2)},${a!.z.toFixed(2)}`);
    expect(goneAt, `still walking after 90 s: ${left.join(' ')}`).toBeGreaterThan(0);
  });

  it('they all walk back to their own counters at dawn and stand still there', () => {
    const spots = staffSpots(2);
    const w = staffWorld(spots, 2);
    for (let i = 0; i < 30; i++) w.folk.update(1 / 30);
    w.dayNight.darkness = 1;
    for (let i = 0; i < 30 * 90; i++) w.folk.update(1 / 30);
    w.dayNight.darkness = 0;
    for (let i = 0; i < 30 * 90; i++) w.folk.update(1 / 30);
    const staff = w.staff();
    expect(staff.filter(Boolean).length).toBe(spots.length);
    staff.forEach((a, i) => {
      expect(a!.commute, `worker ${i} still commuting`).toBe(0);
      expect(Math.hypot(a!.x - spots[i]!.x, a!.z - spots[i]!.z)).toBeLessThan(0.05);
    });
  });
});

describe('crowd routes never cut through a solid', () => {
  /** Distance from a point to an obstacle's axis. */
  const axisDist = (x: number, z: number, o: (typeof OBSTACLES)[number]): number => {
    const dx = o.x2 - o.x;
    const dz = o.z2 - o.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 < 1e-9 ? 0 : Math.min(1, Math.max(0, ((x - o.x) * dx + (z - o.z) * dz) / l2));
    return Math.hypot(x - (o.x + dx * t), z - (o.z + dz * t));
  };
  /** Deterministic pseudo-random numbers so a failure always replays. */
  let seed = 12345;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  it('to and from the edge of the tree, a bench, a stall or an amenity, routes go round the solid, not through it', () => {
    const sq = NAV.square;
    const path = new Path();
    const bad: string[] = [];
    for (const o of OBSTACLES) {
      for (let k = 0; k < 24; k++) {
        // a start in the margin ring around the solid (where a passer-by's nudge can leave someone)
        const ang = rnd() * Math.PI * 2;
        const along = rnd();
        const ax = o.x + (o.x2 - o.x) * along + Math.cos(ang) * (o.r + 0.05 + rnd() * (PERSON_MARGIN - 0.1));
        const az = o.z + (o.z2 - o.z) * along + Math.sin(ang) * (o.r + 0.05 + rnd() * (PERSON_MARGIN - 0.1));
        if (OBSTACLES.some((q) => axisDist(ax, az, q) < q.r + 0.03)) continue;
        // to a free point somewhere on the square
        let bx = 0;
        let bz = 0;
        do {
          bx = sq.minX + 0.5 + rnd() * (sq.maxX - sq.minX - 1);
          bz = sq.minZ + 0.5 + rnd() * (sq.maxZ - sq.minZ - 1);
        } while (OBSTACLES.some((q) => axisDist(bx, bz, q) < q.r + PERSON_MARGIN));
        // both ways: leaving the edge of the solid, and walking up to a spot at its edge
        for (const [sx, sz, ex, ez] of [[ax, az, bx, bz], [bx, bz, ax, az]] as const) {
          planPath(path, sx, sz, ex, ez);
          expect(path.last).toEqual({ x: expect.closeTo(ex, 4), z: expect.closeTo(ez, 4) });
          let px = sx;
          let pz = sz;
          for (let i = 0; i < path.n; i++) {
            const nx = path.x[i]!;
            const nz = path.z[i]!;
            for (let s = 0; s <= 20; s++) {
              const x = px + ((nx - px) * s) / 20;
              const z = pz + ((nz - pz) * s) / 20;
              for (const q of OBSTACLES) {
                if (axisDist(x, z, q) < q.r - 0.02) bad.push(`(${sx.toFixed(2)},${sz.toFixed(2)}) -> (${ex.toFixed(2)},${ez.toFixed(2)}) crosses owner ${q.owner} at ${x.toFixed(2)},${z.toFixed(2)}`);
              }
            }
            px = nx;
            pz = nz;
          }
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe('pond skaters', () => {
  it('glide round the rim without passing through the four corner lamp posts', () => {
    const posts = POND_POSTS;
    const rim = AMENITY_SPOTS.pond;
    const segDist = (p: XZ, a: XZ, b: XZ): number => {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
    };
    for (let i = 0; i < rim.length; i++) {
      const pts: XZ[] = [rim[i]!, ...(POND_GLIDE_VIA[i] ?? []), rim[(i + 1) % rim.length]!];
      for (let k = 1; k < pts.length; k++) {
        for (const p of posts) expect(segDist(p, pts[k - 1]!, pts[k]!), `glide ${i} leg ${k} vs post ${p.x},${p.z}`).toBeGreaterThan(0.3);
      }
    }
  });
});

describe('cafe stools', () => {
  it('are approached from a spot clear of every solid (one stool backs onto the big tree)', () => {
    const out = { x: 0, z: 0 };
    let behindBlocked = 0;
    for (const s of AMENITY_SPOTS.cafe) {
      if (insideObstacle(s.x - Math.sin(s.yaw) * 0.9, s.z - Math.cos(s.yaw) * 0.9, ownerAmenity('cafe'))) behindBlocked++;
      cafeApproach(s, out);
      expect(insideObstacle(out.x, out.z, ownerAmenity('cafe')), `stool at ${s.x},${s.z}`).toBe(false);
    }
    expect(behindBlocked).toBeGreaterThan(0); // the case this guards
  });
});

describe('people meeting head-on', () => {
  it('sidestep and pass each other instead of pushing each other back forever', () => {
    type W = { x: number; z: number; yaw: number; tx: number; tz: number };
    const a: W = { x: 0, z: 0, yaw: 0, tx: 4, tz: 0 };
    const b: W = { x: 4, z: 0, yaw: 0, tx: 0, tz: 0 };
    const dt = 1 / 30;
    const k = Math.min(1, 6 * dt) * 0.5;
    let t = 0;
    const done = (w: W): boolean => Math.hypot(w.tx - w.x, w.tz - w.z) < 0.05;
    for (; t < 20 && !(done(a) && done(b)); t += dt) {
      for (const w of [a, b]) {
        const dx = w.tx - w.x;
        const dz = w.tz - w.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.05) continue;
        const step = Math.min(dist, 1.25 * dt);
        w.yaw = Math.atan2(dx, dz);
        w.x += (dx / dist) * step;
        w.z += (dz / dist) * step;
      }
      if (!done(a)) separationPush(a, b.x, b.z, done(b), k);
      if (!done(b)) separationPush(b, a.x, a.z, done(a), k);
    }
    expect(t, 'still blocking each other after 20 s').toBeLessThan(10);
  });
});

describe('routes between the market lots', () => {
  it('step into the square before turning, instead of brushing along the shop fronts', () => {
    const sq = NAV.square;
    const path = new Path();
    const lots = LAYOUT.town.lots;
    for (let a = 0; a < lots.length; a++) {
      for (let b = 0; b < lots.length; b++) {
        if (a === b) continue;
        const from = lots[a]!;
        const door = lotDoor(b, { x: 0, z: 0 });
        planTownPath(path, from.x - from.face.x * 0.8, from.z - from.face.z * 0.8, door.x, door.z);
        // no stretch longer than a metre runs along the square's edge (where the shop counters stand)
        const edge = (i: number): number => Math.min(path.x[i]! - sq.minX, sq.maxX - path.x[i]!, path.z[i]! - sq.minZ, sq.maxZ - path.z[i]!);
        for (let i = 1; i < path.n; i++) {
          const len = Math.hypot(path.x[i]! - path.x[i - 1]!, path.z[i]! - path.z[i - 1]!);
          const along = edge(i) < 0.6 && edge(i - 1) < 0.6 && len > 1;
          expect(along, `lot ${a} -> door ${b}: ${len.toFixed(1)} m along the edge to ${path.x[i]},${path.z[i]}`).toBe(false);
        }
      }
    }
  });
});
