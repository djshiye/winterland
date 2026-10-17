/**
 * [0.9.7 — Comfort] The five-step starter guide of each new era region (READINESS C4). The first time the player
 * walks into an era's region while it is still untouched (no machine chosen on any slot), the objective banner and
 * the guide arrow walk them through it, one calm step at a time:
 *
 *   1. what the era runs on (its resource, in one line);
 *   2. the hand node: harvest the raw by hand (done once some is in hand, or after standing there a while);
 *   3. the era's shop mat: crew and the era's own upgrades (done on stepping onto it);
 *   4. the import dock: where spare goods wait for the machines (done on stepping onto its give / take strip in front);
 *   5. the era rule: everything here to Lv 10 opens the next era (era 10: the 100 % award).
 *
 * Reading steps stay up READ_SECONDS; a walking step moves on by itself after WALK_SECONDS and the node step after
 * NODE_SECONDS (0.9.10), so the banner can never stick. Once finished the guide never returns for that era (flag `seen:starter<N>`,
 * kept across New Season), and an era whose first machine is already chosen never starts it (old saves). The node's
 * name, verb and resource come from the era data, so renames there follow automatically; RESOURCE_LINES is the one
 * hand-written line per era (era resources v2: iron pellets + coke, chips from silicon, rare earths + helium-3).
 * Pure: Progression feeds it the player's position and what they carry (tests/eraStarter.test.ts).
 */
import { ERA_NODES } from '../assets/eraNodes';
import { ERAS, MATERIALS } from '../eras/data';
import { handNodePlace } from '../eras/HandNode';
import { regionLayout, type XZ } from '../eras/layout';
import { DOCK_FRAME, MAT_SIZE, worldRect } from '../eras/rules';
import type { FlagId, ItemKind } from '../core/types';

export const STARTER_STEPS = 5;
/** Seconds a reading step (1 and 5) stays up. */
export const READ_SECONDS = 6;
/** Safety net: a walking step (3 and 4) moves on after this long even if the player never steps onto it. */
export const WALK_SECONDS = 20;
/** Seconds at the node that count as "you've got it" even before anything is picked up. */
export const NODE_LINGER = 5;
/** 0.9.10: safety net for the node step too (the player never goes there): it moves on after this long. */
export const NODE_SECONDS = 45;

/** What each era runs on, finishing "<Region> runs on ...". */
export const RESOURCE_LINES: Readonly<Record<number, string>> = {
  2: 'stone and clay, fired into bricks and roof tiles',
  3: 'iron ore and charcoal, smelted into iron',
  4: 'coal and scrap, for gears, boilers and steam',
  5: 'iron pellets and coke, baked into steel',
  6: 'copper and quartz, for wire and light bulbs',
  7: 'crude oil and gas, refined into plastic and fuel',
  8: 'silicon from the dunes, made into chips',
  9: 'uranium and graphite, for fuel rods and power',
  10: 'rare earths and helium-3, for fusion and AI cores',
};

export type StarterKind = 'read' | 'node' | 'walk';

export interface StarterStep {
  kind: StarterKind;
  text: string;
  /** Where the arrow points (null: no arrow). */
  spot: XZ | null;
  /** Width / depth of the spot's zone (metres). */
  w: number;
  d: number;
  /** 0.9.10: the era chip's shorter wording of a reading or walking step (progression/guideGoal.ts); absent = the text itself. */
  chip?: string;
}

export const starterFlag = (n: number): FlagId => `seen:starter${n}`;

const lower = (s: string): string => s.toLowerCase();

/** The five steps of era n (2..10); [] for anything else. */
export function starterSteps(n: number): StarterStep[] {
  const era = ERAS[n];
  if (!era) return [];
  const L = regionLayout(n);
  const node = ERA_NODES[n];
  const place = handNodePlace(L);
  const raw = node ? MATERIALS[node.yields as keyof typeof MATERIALS] : undefined;
  const rawName = raw ? lower(raw.label) : 'its raw goods';
  const steps: StarterStep[] = [];
  const tag = (i: number, text: string): string => `${i}/${STARTER_STEPS} · ${text}`;
  steps.push({ kind: 'read', text: tag(1, `${era.region} runs on ${RESOURCE_LINES[n] ?? rawName}`), spot: null, w: 0, d: 0, chip: `Explore ${era.region}` });
  steps.push({
    kind: 'node',
    text: tag(2, node ? `${node.verb} the ${node.name} for ${rawName}` : `Harvest ${rawName} by hand`),
    spot: place ? { x: place.x, z: place.z } : null,
    w: 5,
    d: 5,
  });
  steps.push({ kind: 'walk', text: tag(3, `The shop mat: hire ${lower(era.worker.plural)} and buy upgrades`), spot: L.shopMat, w: MAT_SIZE.w, d: MAT_SIZE.d, chip: 'Walk to the shop mat' });
  // the strip in front of the dock (its give + take zones), never the dock's solid body
  const front = worldRect(L.dock, L.facilityYaw, { u0: DOCK_FRAME.give.u0, u1: DOCK_FRAME.take.u1, v0: DOCK_FRAME.give.v0, v1: DOCK_FRAME.give.v1 });
  steps.push({
    kind: 'walk',
    text: tag(4, 'The dock keeps spare goods for your machines'),
    spot: { x: (front.minX + front.maxX) / 2, z: (front.minZ + front.maxZ) / 2 },
    w: front.maxX - front.minX,
    d: front.maxZ - front.minZ,
    chip: 'Walk to the import dock',
  });
  const last = n >= 10 ? `Get everything in ${era.region} to Lv 10; the era chip then shows the last pieces for 100 %` : `Get everything in ${era.region} to Lv 10 to open the next era`;
  steps.push({ kind: 'read', text: tag(5, last), spot: null, w: 0, d: 0, chip: `Everything in ${era.region} to Lv 10` });
  return steps;
}

/** What the guide sees each tick. */
export interface StarterInput {
  /** The region the player stands in (0 outside every region). */
  here: number;
  /** The newest unlocked era. */
  age: number;
  /** A machine is already chosen on one of the region's slots. */
  started: boolean;
  flags: Readonly<Partial<Record<FlagId, boolean>>>;
  player: XZ;
  /** How many of a kind the player carries. */
  carrying: (kind: ItemKind) => number;
}

const inside = (p: XZ, s: StarterStep): boolean =>
  !!s.spot && Math.abs(p.x - s.spot.x) <= s.w / 2 && Math.abs(p.z - s.spot.z) <= s.d / 2;

/** The running guide: which era, which step, and how long the step has been up. */
export class EraStarter {
  era = 0;
  step = 0;
  private t = 0;
  private steps: StarterStep[] = [];

  /** Advance by dt; returns the step to show, or null (no guide now). `done(n)` is called once per finished era. */
  update(dt: number, s: StarterInput, done: (n: number) => void): StarterStep | null {
    const n = s.here;
    if (this.era !== n) {
      // the guide only starts in the newest region, before anything is built there, once
      // (stepping out keeps the place: walking back in carries on where it was)
      if (n < 2 || n !== s.age || s.started || s.flags[starterFlag(n)]) return null;
      this.era = n;
      this.step = 0;
      this.t = 0;
      this.steps = starterSteps(n);
    }
    if (this.era < 2 || this.step >= this.steps.length) return null;
    this.t += dt;
    const cur = this.steps[this.step]!;
    let next = false;
    if (cur.kind === 'read') next = this.t >= READ_SECONDS;
    else if (cur.kind === 'node') {
      const raw = ERA_NODES[n]?.yields as ItemKind | undefined;
      if (raw && s.carrying(raw) > 0) next = true;
      if (inside(s.player, cur) && this.t >= NODE_LINGER) next = true;
      if (this.t >= NODE_SECONDS) next = true;
      if (!cur.spot) next = this.t >= READ_SECONDS;
    } else next = inside(s.player, cur) || !cur.spot || this.t >= WALK_SECONDS;
    if (next) {
      this.step++;
      this.t = 0;
      if (this.step >= this.steps.length) {
        done(n);
        return null;
      }
    }
    return this.steps[this.step]!;
  }
}
