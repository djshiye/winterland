/**
 * [city] 1.0 how an era's foreman reaches its district's lots without the city and the regions knowing each other
 * (EraWorld is built before City; both get the same GameContext):
 *
 * - `lotNeeds(state, n)` (pure): the lots of district n whose chosen building still misses some of the era's refined
 *   material (DISTRICT_MATERIAL[n]); `room` counts what is paid or already flying in (lot.extra mirrors both), so
 *   the foremen only subtract what peers carry.
 * - City registers a `CityLotAccess` for its context; a foreman asks it for the lot's ConstructionPad at the start of
 *   a trip. The district makes that one pad on demand, silently (no pop-in, no sound, no event), when the player has
 *   not been near the district yet this session. Only material is delivered: the cash stays the player's to pay.
 */
import { CITY_BUILDINGS, DISTRICT_MATERIAL, type CityBuildingId } from '../eras/data';
import type { GameState, ItemHolder, ItemKind } from '../core/types';

export interface LotNeed {
  lot: number;
  kind: ItemKind;
  /** Units still to send (count minus paid and in flight). */
  room: number;
}

/** Lots of district n (chosen, not built) still wanting the era's material. */
export function lotNeeds(state: GameState, n: number): LotNeed[] {
  const out: LotNeed[] = [];
  const kind = DISTRICT_MATERIAL[n];
  const lots = state.city.districts[n]?.lots;
  if (!kind || !lots || state.eras.age < n) return out;
  lots.forEach((l, lot) => {
    if (l.building === '' || l.tier >= 0) return;
    const x = CITY_BUILDINGS[l.building as CityBuildingId]?.extra;
    if (!x || x.kind !== kind) return;
    const room = x.count - l.extra;
    if (room > 0) out.push({ lot, kind, room });
  });
  return out;
}

export interface CityLotAccess {
  /** The construction pad of lot `lot` of district n while it still wants material (made on demand), else null. */
  lotPad(n: number, lot: number): ItemHolder | null;
}

const registry = new WeakMap<object, CityLotAccess>();

/** City: make the lots of `ctx`'s districts reachable for the era foremen. */
export function registerCityLots(ctx: object, access: CityLotAccess): void {
  registry.set(ctx, access);
}

/** The lot access of `ctx`'s city, or null (no city yet, tests). */
export function cityLotAccess(ctx: object): CityLotAccess | null {
  return registry.get(ctx) ?? null;
}
