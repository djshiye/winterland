/**
 * [0.9.10 — guide] The one next goal on screen (READINESS C2). Progression writes the objective banner's text here the
 * moment it changes; the era chip reads it back, so the chip and the banner always name the same goal. While the
 * banner is quiet the chip falls back to the era gate's own next goal (eras/gate.ts nextGoal).
 *
 * Kept per game state (a WeakMap), so tests and a New Season never see a stale goal from another game.
 */
import type { GameState } from '../core/types';

const goals = new WeakMap<GameState, string>();

/**
 * Record the banner's goal (null or '' = the banner is quiet). `chip` is a shorter wording of the same goal for the
 * chip's one line (a starter's reading step: "Explore Granite Hollow" for "Granite Hollow runs on stone and clay, ...").
 */
export function setGuideGoal(s: GameState, text: string | null, chip?: string): void {
  if (text) goals.set(s, chip || text);
  else goals.delete(s);
}

/** The goal the chip shows right now (the banner's, or its short form), or null while the banner is quiet. */
export function guideGoal(s: GameState): string | null {
  return goals.get(s) ?? null;
}

/** The chip's short form of a banner goal: a starter step's "2/5 · " tag is dropped (the banner keeps it). */
export function chipGoalText(text: string): string {
  return text.replace(/^\d+\/\d+ · /, '');
}

/** True for the expansion pad step (Progression eraGuide: "Expand to Iron Ridge ($50M)", "Bring 35 bricks to Iron Ridge"). */
export function isExpandGoal(text: string): boolean {
  return /^Expand to |^Bring \d+ .+ to /.test(text);
}
