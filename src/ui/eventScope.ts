/**
 * 0.9.13 (U2): rush hour (the mill's walk-in customers) and festival day (townsfolk shopping) only change Winterland
 * and its Market Town, so their banners show only while the player is there. Snowstorm (walking) and the northern
 * lights (their hint names the mill and the Market Town) show everywhere.
 */
import type { EventKind } from '../config';
import type { GameContext } from '../core/types';
import { regionAt } from '../eras/playerUpgrades';

/** Pure: does this event's banner belong in region `region` (0 = Winterland and the Market Town, 2..10 = eras)? */
export function eventShowsIn(kind: EventKind | 'rush', region: number): boolean {
  return region === 0 || (kind !== 'rush' && kind !== 'festival');
}

/** The region the player stands in now. */
export function playerRegion(ctx: GameContext): number {
  const p = ctx.player.object.position;
  return regionAt(p.x, p.z);
}
