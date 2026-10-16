/**
 * [city] 1.0 pure plan of district life (city/DistrictLife.ts draws it): how many residents and shoppers stroll a
 * district, the spots they walk between and the routes between those spots. No THREE, no GameContext.
 *
 * - `lifeTarget`: nobody in an empty district; otherwise 2 + one per home's worth of residents (residents / 40, the
 *   people of an era-2 home, scaled down by the era's 2.2× people growth) + one per four eras, capped at 10 … 14 by era
 *   so a full city stays cheap; halved on Low quality.
 * - `lifeSpots`: every built lot gives spots in the clear lane in front of its building: a home its door, a work
 *   building / landmark two shop-front spots (people pause there facing the window), a park its two benches (sit) and
 *   a spot on its front path (linger); the sidewalk ring adds corner spots to stroll to. A spot is reached from its
 *   `access` point on the walkways (city/roadRoute.ts districtWalkways) through `via` (last = the spot).
 * - `lifeRoute`: spot → spot: back out along `via`, over the walkways (routeOver), in along the other spot's `via`.
 * Nothing ever enters a non-park building's footprint (tests/districtLife.test.ts checks every leg).
 */
import { CITY_BUILDINGS, type CityBuildingId } from '../eras/data';
import type { CityLotState } from '../core/types';
import { districtWalkways, laneZ, routeOver } from './roadRoute';
import { districtInner, districtLots, lotBuilt, type XZ } from './rules';

export type LifeSpotKind = 'door' | 'shop' | 'bench' | 'park' | 'walk';

export interface LifeSpot {
  kind: LifeSpotKind;
  /** Lot index (-1 for a sidewalk spot). */
  lot: number;
  x: number;
  z: number;
  /** Facing while there (radians, atan2(dx, dz) convention: 0 = +Z). */
  yaw: number;
  /** On the walkways: where the spot is reached from. */
  access: XZ;
  /** From `access` to the spot (the spot last); empty when the spot is its own access point. */
  via: XZ[];
}

/** People of an era-2 home (the per-home step of the head count). */
const HOME_PEOPLE = 40;

/** How many people stroll district n with `lots` (see the file header). */
export function lifeTarget(n: number, lots: readonly CityLotState[], low = false): number {
  let built = 0;
  let residents = 0;
  for (const l of lots) {
    if (!lotBuilt(l)) continue;
    const def = CITY_BUILDINGS[l.building as CityBuildingId];
    if (!def) continue;
    built++;
    if (def.kind === 'home') residents += def.people;
  }
  if (built === 0) return 0;
  const homes = residents / (HOME_PEOPLE * 2.2 ** (n - 2));
  const cap = 10 + Math.floor((n - 2) / 2);
  const want = Math.min(cap, 2 + Math.floor(homes + 1e-6) + Math.floor((n - 2) / 4));
  return low ? Math.max(1, Math.ceil(want / 2)) : want;
}

/** Shop-front / door offset from the lot centre (clear of the 2 m pad tile). */
const SIDE = 1.6;
/** Distance in front of the building's front wall. */
const FRONT = 0.5;

/** The spots of district n for its current buildings (built lots only) plus the sidewalk corners. */
export function lifeSpots(n: number, lots: readonly CityLotState[]): LifeSpot[] {
  const out: LifeSpot[] = [];
  const frames = districtLots(n);
  for (const f of frames) {
    const st = lots[f.index];
    if (!st || !lotBuilt(st)) continue;
    const def = CITY_BUILDINGS[st.building as CityBuildingId];
    if (!def) continue;
    const front = f.rect.maxZ;
    const lz = laneZ(n, f.index);
    const at = (x: number, z: number, yaw: number, kind: LifeSpotKind): void => {
      out.push({ kind, lot: f.index, x, z, yaw, access: { x, z: lz }, via: [{ x, z }] });
    };
    if (def.kind === 'home') at(f.x - SIDE, front + FRONT, Math.PI, 'door');
    else if (def.kind === 'work' || def.kind === 'landmark') {
      at(f.x - SIDE, front + FRONT, Math.PI, 'shop');
      at(f.x + SIDE, front + FRONT, Math.PI, 'shop');
    } else {
      // park (walkable): in past the pad's side, onto the front path, along the benches (assets/cityBuildings.ts park:
      // benches at ±0.2 w, 0.32 d from the centre, facing +Z)
      const ax = f.x + SIDE;
      const path: XZ = { x: f.x + 0.4, z: front - 0.5 };
      const entry: XZ[] = [{ x: ax, z: front + 0.3 }, path];
      out.push({ kind: 'park', lot: f.index, x: path.x, z: path.z, yaw: Math.PI, access: { x: ax, z: lz }, via: [...entry] });
      for (const s of [-1, 1]) {
        const bx = f.x + s * f.w * 0.2;
        const bz = f.z + f.d * 0.32 + 0.12;
        out.push({ kind: 'bench', lot: f.index, x: bx, z: bz, yaw: 0, access: { x: ax, z: lz }, via: [...entry, { x: bx, z: bz + 0.55 }, { x: bx, z: bz }] });
      }
    }
  }
  // sidewalk corners (on the walkable inner strip of the ring)
  const inner = districtInner(n);
  const k = 0.33;
  for (const [x, z] of [
    [inner.minX - k, inner.minZ - k],
    [inner.maxX + k, inner.minZ - k],
    [inner.minX - k, inner.maxZ + k],
    [inner.maxX + k, inner.maxZ + k],
    [inner.minX - k, (inner.minZ + inner.maxZ) / 2],
    [inner.maxX + k, (inner.minZ + inner.maxZ) / 2],
  ] as const) {
    out.push({ kind: 'walk', lot: -1, x, z, yaw: 0, access: { x, z }, via: [] });
  }
  return out;
}

/** Waypoints from spot `a` to spot `b` (a's own point excluded, b's last). */
export function lifeRoute(n: number, a: LifeSpot, b: LifeSpot): XZ[] {
  const out: XZ[] = [];
  // back out of a's approach (its points in reverse, without the spot itself), to its access point
  for (let i = a.via.length - 2; i >= 0; i--) out.push(a.via[i]!);
  if (a.via.length > 0) out.push(a.access);
  const leg = routeOver(districtWalkways(n), a.access, b.access) ?? [b.access];
  for (const p of leg) out.push(p);
  for (const p of b.via) out.push(p);
  // drop repeats
  const clean: XZ[] = [];
  let last: XZ = { x: a.x, z: a.z };
  for (const p of out) {
    if (Math.hypot(p.x - last.x, p.z - last.z) < 0.05) continue;
    clean.push(p);
    last = p;
  }
  // end exactly on b's spot
  const end = { x: b.x, z: b.z };
  if (clean.length > 0) clean[clean.length - 1] = end;
  else if (Math.hypot(b.x - a.x, b.z - a.z) > 0) clean.push(end);
  return clean;
}
