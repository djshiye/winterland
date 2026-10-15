/** Wave 13 "more life": pure helpers (wanderer target, carol motif, commute hysteresis) + the commuters and carolers. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAYOUT, TOWN } from '../src/config';
import { EventBus } from '../src/core/EventBus';
import { createGameState, type GameContext, type GameEvents } from '../src/core/types';
import { Path, lotDoor, nearestHome, planTownPath, zoneOf } from '../src/npc/CrowdNav';
import {
  CAROL_MOTIF,
  Townsfolk,
  carolBeat,
  carolPitch,
  carolersEligible,
  nightMarket,
  stallWeight,
  staffAtHome,
  wandererTargetFor,
} from '../src/npc/Townsfolk';
import type { Town } from '../src/town/Town';
import { TREE_RING } from '../src/town/spots';

// Stand-in for the amenities builder's AMENITY_SPOTS (town/spots.ts) until it lands there.

describe('wandererTargetFor', () => {
  it('uses TOWN.wanderers by day and halves on Low quality', () => {
    for (let l = 0; l < TOWN.wanderers.length; l++) {
      expect(wandererTargetFor(l, 0, false, 99)).toBe(TOWN.wanderers[l]);
      expect(wandererTargetFor(l, 0, true, 99)).toBe(Math.round(TOWN.wanderers[l]! / 2));
    }
  });

  it('thins out at night below Winter City', () => {
    for (let l = 0; l <= 3; l++) expect(wandererTargetFor(l, 1, false, 99)).toBeLessThan(wandererTargetFor(l, 0, false, 99) + (l === 0 ? 1 : 0));
    expect(wandererTargetFor(3, 1, false, 99)).toBe(Math.round(TOWN.wanderers[3]! * 0.45));
  });

  it('brings +6 to the night market (level >= 4, dark > 0.5) instead of the reduction', () => {
    expect(wandererTargetFor(4, 1, false, 99)).toBe(TOWN.wanderers[4]! + 6);
    expect(wandererTargetFor(5, 0.8, false, 99)).toBe(TOWN.wanderers[5]! + 6);
    expect(wandererTargetFor(4, 0.4, false, 99)).toBeLessThan(TOWN.wanderers[4]!); // dusk: still the usual reduction
    expect(wandererTargetFor(4, 1, true, 99)).toBe(Math.round((TOWN.wanderers[4]! + 6) / 2));
  });

  it('never exceeds the cap', () => {
    expect(wandererTargetFor(5, 1, false, TOWN.crowdMax)).toBeLessThanOrEqual(TOWN.crowdMax);
    expect(wandererTargetFor(5, 1, false, 10)).toBe(10);
  });
});

describe('night market, carolers, commute rules', () => {
  it('night market needs level 4 and darkness above 0.5', () => {
    expect(nightMarket(3, 1)).toBe(false);
    expect(nightMarket(4, 0.5)).toBe(false);
    expect(nightMarket(4, 0.51)).toBe(true);
    expect(stallWeight(1.3, true)).toBeCloseTo(2.6);
    expect(stallWeight(1.3, false)).toBeCloseTo(1.3);
  });

  it('carolers need level 3 and darkness above 0.5 (and keep going until it is clearly day)', () => {
    expect(carolersEligible(2, 1)).toBe(false);
    expect(carolersEligible(3, 0.4)).toBe(false);
    expect(carolersEligible(3, 0.6)).toBe(true);
    expect(carolersEligible(3, 0.47, false)).toBe(false);
    expect(carolersEligible(3, 0.47, true)).toBe(true);
    expect(carolersEligible(3, 0.3, true)).toBe(false);
  });

  it('staff go home above 0.6, come back below 0.45, and hold in between', () => {
    expect(staffAtHome(0.7, false)).toBe(true);
    expect(staffAtHome(0.5, false)).toBe(false);
    expect(staffAtHome(0.5, true)).toBe(true);
    expect(staffAtHome(0.3, true)).toBe(false);
  });

  it('steps through the carol motif and loops it', () => {
    expect(CAROL_MOTIF).toEqual([1, 1.25, 1.5, 1.25, 1.125, 1]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(carolPitch)).toEqual([1, 1.25, 1.5, 1.25, 1.125, 1, 1, 1.25]);
    expect(carolPitch(-1)).toBe(1);
    expect(carolBeat(0)).toBe(0);
    expect(carolBeat(1.59)).toBe(0);
    expect(carolBeat(1.6)).toBe(1);
    expect(carolBeat(9.7)).toBe(6);
  });
});

describe('CrowdNav town helpers', () => {
  it('planTownPath routes lot interiors and doorsteps through the square, never back through the corridor gate', () => {
    const path = new Path();
    for (let i = 0; i < LAYOUT.town.lots.length; i++) {
      const l = LAYOUT.town.lots[i]!;
      const door = lotDoor(i, { x: 0, z: 0 });
      planTownPath(path, l.x, l.z, 24, 22.5);
      for (let k = 0; k < path.n; k++) expect(path.x[k]!).toBeGreaterThan(LAYOUT.town.square.minX); // no detour west
      planTownPath(path, 24, 22.5, door.x, door.z);
      expect(path.x[path.n - 1]).toBeCloseTo(door.x, 3);
      expect(path.z[path.n - 1]).toBeCloseTo(door.z, 3);
      for (let k = 0; k < path.n; k++) expect(path.x[k]!).toBeGreaterThan(LAYOUT.town.square.minX);
    }
    expect(zoneOf(24, 22.5)).toBe('square');
  });

  it('nearestHome picks the closest door, else the corridor entrance', () => {
    const out = { x: 0, z: 0 };
    nearestHome(20, 20, [{ x: 35, z: 30 }, { x: 19, z: 21 }], out);
    expect(out).toEqual({ x: 19, z: 21 });
    nearestHome(20, 20, [], out);
    expect(out).toEqual({ x: LAYOUT.town.entrances[0]!.x, z: LAYOUT.town.entrances[0]!.z });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
function makeWorld() {
  const state = createGameState();
  state.village.revealed = true;
  state.village.level = 4;
  state.town.revealed = true;
  const plays: { id: string; pitch?: number; volume?: number }[] = [];
  const player = { position: new THREE.Vector3(24, 0, 29) };
  const ctx = {
    scene: new THREE.Scene(),
    state,
    events: new EventBus<GameEvents>(),
    renderer: { quality: 'high' as 'high' | 'low' },
    dayNight: { darkness: 0 },
    rush: { active: false, spawnMult: 1 },
    audio: { play: (id: string, o?: { pitch?: number; volume?: number }) => plays.push({ id, ...o }) },
    player,
  } as unknown as GameContext;
  const spots = [
    { lot: 0, x: 19.0, z: 18.6, yaw: 0, working: true },
    { lot: 1, x: 24.6, z: 18.6, yaw: 0, working: false },
  ];
  const town = { revealed: true, shops: () => [], staffSpots: () => spots } as unknown as Town;
  const folk = new Townsfolk(ctx, town);
  const run = (seconds: number, dt = 1 / 30) => {
    for (let i = 0; i < seconds / dt; i++) folk.update(dt);
  };
  return { ctx, folk, state, plays, spots, run, dark: (d: number) => ((ctx.dayNight as { darkness: number }).darkness = d) };
}

describe('commuters', () => {
  it('staff walk home at dusk (freeing their instances) and are back at their counters at dawn', () => {
    const w = makeWorld();
    w.folk.forceWanderers = 0;
    w.run(2);
    const stallholders = 2;
    expect(w.folk.staffCount).toBe(2 + stallholders);
    expect(w.folk.visible).toBe(2 + stallholders);
    w.dark(1);
    w.run(40);
    expect(w.folk.staffCount).toBe(stallholders); // nobody at the counters, no hidden instances either
    expect(w.folk.visible).toBe(stallholders);
    w.dark(0);
    w.run(40);
    expect(w.folk.staffCount).toBe(2 + stallholders);
    const at = w.folk.crowd.people.filter((p) => p.active && Math.hypot(p.x - w.spots[0]!.x, p.z - w.spots[0]!.z) < 0.05);
    expect(at.length).toBe(1);
  });

  it('never exceeds the crowd cap when everybody comes back', () => {
    const w = makeWorld();
    w.folk.forceWanderers = TOWN.crowdMax;
    w.dark(1);
    w.run(30);
    w.dark(0);
    for (let i = 0; i < 60; i++) {
      w.run(1);
      expect(w.folk.visible).toBeLessThanOrEqual(TOWN.crowdMax);
    }
  });
});

describe('carolers', () => {
  it('three wanderers sing at neighbouring tree spots at night with lanterns, chime in motif near the player, and disband at dawn', () => {
    const w = makeWorld();
    w.state.village.level = 3;
    w.folk.forceWanderers = 12;
    w.dark(1);
    w.run(45);
    const group = (w.folk as unknown as { carolers: { ringIdx: number; mode: string; x: number; z: number; p: { lantern: number } }[] }).carolers;
    expect(group.length).toBe(3);
    const idx = group.map((c) => c.ringIdx).sort((a, b) => a - b);
    const n = TREE_RING.length;
    // neighbouring: the three indices are consecutive modulo the ring
    expect(new Set(idx.map((i) => (i + 1) % n)).size).toBe(3);
    expect(idx.filter((i) => idx.includes((i + 1) % n)).length).toBeGreaterThanOrEqual(2);
    for (const c of group) {
      expect(c.mode).toBe('carol');
      expect(Math.hypot(c.x - TREE_RING[c.ringIdx]!.x, c.z - TREE_RING[c.ringIdx]!.z)).toBeLessThan(0.1);
      expect(c.p.lantern).toBeGreaterThan(0.9);
    }
    expect(w.plays.length).toBeGreaterThan(3);
    for (const p of w.plays) {
      expect(p.id).toBe('chime');
      expect(p.volume).toBe(0.35);
      expect(CAROL_MOTIF).toContain(p.pitch);
    }
    // far from the tree: silence
    const before = w.plays.length;
    w.ctx.player.position.set(4, 0, 12);
    w.run(10);
    expect(w.plays.length).toBe(before);
    w.dark(0);
    w.run(3);
    expect(group.length).toBe(0);
  });

  it('do not form below village level 3', () => {
    const w = makeWorld();
    w.state.village.level = 2;
    w.folk.forceWanderers = 12;
    w.dark(1);
    w.run(30);
    expect((w.folk as unknown as { carolers: unknown[] }).carolers.length).toBe(0);
  });
});

describe('amenity visitors', () => {
  type A = { act: string; mode: string; amenIdx: number; p: { kid: boolean; sit: number }; maxSpeed: number; baseSpeed: number };
  it('use only the built amenities, and every act shows up once they are open', () => {
    const w = makeWorld();
    w.state.village.level = 3;
    w.folk.forceWanderers = 30;
    const acts = (): Set<string> => new Set<string>();
    const seen = acts();
    const live = (): A[] => (w.folk as unknown as { live: A[] }).live;
    w.run(60);
    for (const a of live()) seen.add(a.act);
    for (const x of ['cafe', 'pond', 'band', 'park']) expect(seen.has(x)).toBe(false); // nothing built yet
    for (const id of ['cafe', 'pond', 'bandstand', 'snowmanPark'] as const) w.state.town.amenities[id].tier = 0;
    const speeds: number[] = [];
    for (let i = 0; i < 240; i++) {
      w.run(1);
      for (const a of live()) {
        seen.add(a.act);
        if (a.act === 'pond') speeds.push(a.maxSpeed / a.baseSpeed);
      }
    }
    for (const x of ['cafe', 'pond', 'band', 'park']) expect(seen.has(x), x).toBe(true);
    expect(speeds.length).toBeGreaterThan(0);
    for (const k of speeds) expect(k).toBeCloseTo(1.6, 5);
    // nobody keeps the skating speed after leaving the pond
    for (const a of live()) if (a.act !== 'pond') expect(a.maxSpeed).toBeLessThan(2.6);
  });
});
