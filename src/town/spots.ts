/**
 * [MAIN — wave 9 contract] Fixed decor spots on the market square (LAYOUT.town.square). world/env/town.ts places
 * the props here (and their colliders); npc/Townsfolk.ts sends wanderers to them. Yaw: the way a seated / standing
 * person faces (radians, 0 = +Z).
 */
import { AMENITY_IDS, LAYOUT, townZ, type AmenityId, type XZ } from '../config';
import { CAFE_STOOLS } from '../assets/townAmenities';
import { amenityFrame, amenityToWorld, type AmenityFrame } from './rules';
import type { Rect } from '../config';

export interface Spot extends XZ {
  yaw: number;
}

const toward = (from: XZ, to: XZ): number => Math.atan2(to.x - from.x, to.z - from.z);
const TREE = { x: LAYOUT.town.tree.x, z: LAYOUT.town.tree.z };

/**
 * Benches (2 seats each, seats ±0.45 m along the bench), facing the big tree. 0.9.9: the two north ones moved off the
 * walk from the corridor mouth to the east gate (they sat on it at z 26.55) into the corners by the stall and the
 * north-east lot.
 */
export const BENCHES: readonly Spot[] = [
  { x: 19.6, z: 23.9 },
  { x: 28.4, z: 23.9 },
  { x: 19.4, z: 35.2 }, // 0.9.4: west of the pond's rim
  { x: 27.6, z: townZ(29.5) },
].map((p) => ({ ...p, yaw: toward(p, TREE) }));

/**
 * Market stalls (≈1.8 × 1.0 m, solid) by the corridor mouth (z 25.9..27.5, not stretched; the south one leaves the
 * porters' corner at z 28.4..29.2 clear); the stallholder stands behind, facing the yaw.
 */
export const STALLS: readonly Spot[] = [
  { x: 17.6, z: 23.4, yaw: Math.PI / 2 },
  { x: 17.6, z: 30.8, yaw: Math.PI / 2 },
];

/**
 * A snowman (solid, r 0.5) kids gather around. 0.9.9: in the quiet south-west corner, facing the square (it stood in
 * the way between the north-east road, the east gate and the south avenue).
 */
export const SNOWMAN: Spot = { x: 17.3, z: 37.3, yaw: Math.PI / 2 };

/** True when (x, z) lies inside `r` grown by `margin` on every side. */
const insideGrown = (r: Rect, x: number, z: number, margin: number): boolean =>
  x >= r.minX - margin && x <= r.maxX + margin && z >= r.minZ - margin && z <= r.maxZ + margin;

/** Amenity footprints (rules.amenityFrame, rotated by facing) that the tree ring must keep clear of. */
const AMENITY_RECTS: readonly Rect[] = AMENITY_IDS.map((id) => amenityFrame(id).rect);

/**
 * People stand around the big tree here (r ≈ 2.3 from it), facing it. Eight angles; any angle whose point falls inside
 * an amenity footprint grown by 0.4 m is dropped (the remaining spots keep their angles).
 */
export const TREE_RING: readonly Spot[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2 + 0.3;
  const p = { x: TREE.x + Math.sin(a) * 2.3, z: TREE.z + Math.cos(a) * 2.3 };
  return { ...p, yaw: toward(p, TREE) };
}).filter((p) => !AMENITY_RECTS.some((r) => insideGrown(r, p.x, p.z, 0.4)));

// ---------------------------------------------------------------------------------------------------------------
// Wave 12: amenity spots for the crowd (town/Town.ts builds the sites; npc/Townsfolk.ts uses these)
// ---------------------------------------------------------------------------------------------------------------

/** Build order of the amenities (same as AMENITY_IDS). */
export const AMENITY_ORDER: readonly AmenityId[] = AMENITY_IDS;

/** A model-local point (lx, lz) as a world spot facing the model-local point (tx, tz). */
function localSpot(f: AmenityFrame, lx: number, lz: number, tx: number, tz: number): Spot {
  const p = amenityToWorld(f, lx, lz);
  const q = amenityToWorld(f, tx, tz);
  return { x: p.x, z: p.z, yaw: Math.atan2(q.x - p.x, q.z - p.z) };
}

function amenitySpots(id: AmenityId): Spot[] {
  const f = amenityFrame(id);
  const hd = f.d / 2;
  switch (id) {
    case 'cafe':
      // the four stools (assets/townAmenities CAFE_STOOLS), each facing its table
      return CAFE_STOOLS.map((s) => localSpot(f, s.x, s.z, s.tx, 0.4));
    case 'snowmanPark':
      // kids stand at the fence's open sides and in front of the gap, facing the snowmen
      return [localSpot(f, -1.45, -0.45, 0, 0), localSpot(f, 1.45, -0.45, 0, 0), localSpot(f, 0, 1.25, 0, 0)];
    case 'bandstand':
      // the audience in front of the stage (local +Z), facing it; the band plays on the deck itself
      return [
        localSpot(f, -0.8, hd + 0.45, 0, 0),
        localSpot(f, -0.25, hd + 0.5, 0, 0),
        localSpot(f, 0.3, hd + 0.5, 0, 0),
        localSpot(f, 0.85, hd + 0.45, 0, 0),
      ];
    case 'pond':
      // the rim (clear of the pad tile and the neighbours), facing the ice: skaters loop between these
      return [
        localSpot(f, 0.65, -1.25, 0, 0),
        localSpot(f, -0.65, -1.25, 0, 0),
        localSpot(f, -1.75, 0, 0, 0),
        localSpot(f, -1.1, 1.25, 0, 0),
      ];
  }
}

/** The pond's four corner lamp posts (assets/townAmenities.ts bakePond): solid for the crowd. */
export const POND_POSTS: readonly XZ[] = (() => {
  const f = amenityFrame('pond');
  const out: XZ[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = amenityToWorld(f, sx * (f.w / 2 - 0.12), sz * (f.d / 2 - 0.1));
      out.push({ x: p.x, z: p.z });
    }
  }
  return out;
})();

/**
 * Extra waypoints for a skater gliding from pond rim spot i to spot i + 1 (AMENITY_SPOTS.pond, looping): the two
 * glides round the far end pass outside its lamp posts (straight, one went right through a post).
 */
export const POND_GLIDE_VIA: readonly (readonly XZ[])[] = (() => {
  const f = amenityFrame('pond');
  const at = (lx: number, lz: number): XZ => {
    const p = amenityToWorld(f, lx, lz);
    return { x: p.x, z: p.z };
  };
  return [[], [at(-1.6, -1.1)], [at(-1.6, 1.1)], []];
})();

/** 3-4 standing / sitting spots per amenity, with yaws (0 = +Z): cafe stools, pond rim, bandstand audience, park edge. */
export const AMENITY_SPOTS: Record<AmenityId, Spot[]> = {
  cafe: amenitySpots('cafe'),
  snowmanPark: amenitySpots('snowmanPark'),
  bandstand: amenitySpots('bandstand'),
  pond: amenitySpots('pond'),
};
