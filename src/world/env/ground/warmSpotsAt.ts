/**
 * Era n's warm spot exactly as its ground module places it (eras 4-7 and 10 hand warmSpots.ts the rects their landmarks
 * and sidings already fill). Kept apart from warmSpots.ts so the era modules, which import that, do not import each other.
 */
import '../eraGround';
import type { Rect } from '../../../config';
import type { RegionLayout } from '../../../eras/layout';
import { baseKeepOut as base4 } from './era04';
import { baseKeepOut as base5 } from './era05';
import { landKeepOut as land6 } from './era06';
import { landKeepOut as land7 } from './era07';
import { haloRect } from './era10';
import { warmSpotFor, type WarmEra } from './warmSpots';

/** The rects era n's module passes to warmSpotFor. */
export function warmExtra(l: RegionLayout, n: WarmEra): Rect[] {
  switch (n) {
    case 4: return base4(l);
    case 5: return base5(l);
    case 6: return land6(l);
    case 7: return land7(l);
    case 10: return [haloRect(l)];
    default: return [];
  }
}

/** Era n's warm spot on region l, as the ground module places it (null when nothing fits). */
export function warmSpot(l: RegionLayout, n: WarmEra): { x: number; z: number } | null {
  return warmSpotFor(l, n, warmExtra(l, n));
}
