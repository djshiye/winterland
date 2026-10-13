/**
 * [B3 — world & juice] Turns game events into feel: sounds, particles, floating text, camera shake.
 * STUB: replace bodies, keep the public API. Gameplay code only emits events (types.ts GameEvents);
 * this class decides how they look and sound, so juice can be tuned in one place.
 *
 * Suggested mapping:
 * - item:landed → into player arms: 'pop' (combo); into player back (cash): 'cash' (combo) + tiny
 *   sparkle; into a pad: 'pay' (combo); into piles/counters/hoppers: soft 'drop' (rate-limited).
 * - player:chopHit → 'chop', wood-chip burst (bark + light wood colours) at the position, shake ~0.04.
 * - log:chopped (harvester / megaSaw) → small chip burst + quiet 'chop'.
 * - crate:made → sparkle + 'machine'.
 * - sale → 'sell' + floatText "+$<amount>" in green above the position.
 * - stack:full → 'full' + floatText "MAX" (throttled).
 * - pad:paid → nothing extra (pad animates itself); pad:unlocked → 'unlock', confetti, ring, shake
 *   0.25, hud.toast("<LABEL> UNLOCKED!").
 * - built → 'build', puff + ring at the position.
 * - intro:crash → 'crash' + 'splash', splash particles, big shake (0.6, 0.5 s).
 */
import type { GameContext } from '../core/types';

export class JuiceDirector {
  constructor(readonly ctx: GameContext) {}

  update(_dt: number): void {}
}
