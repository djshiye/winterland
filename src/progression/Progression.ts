/**
 * [B7 — progression] Phase state machine, pad sequencing, intro cinematic, tutorial guide.
 * STUB (functional baseline: no intro, pads shown in a simple chain): replace/extend, keep the API.
 *
 * Responsibilities (Level owns the stations and builds them when 'pad:unlocked' fires; this class
 * decides WHEN things happen and guides the player):
 * - start(): intro — ctx.player.inputEnabled = false, camera focuses/tracks the giant log
 *   (ctx.cameraRig.focus(level.giantLog.object, ...)) while level.giantLog.playIntro(onCrash, onSettled)
 *   floats it down the river; after it settles, the camera returns to the player, input is enabled,
 *   the log becomes choppable, phase 'manual', emit 'intro:done'. Tapping/moving during the intro may
 *   skip it (optional). skipIntro() jumps straight to the post-intro state.
 * - Pad sequence (show with a short delay + camera nudge toward the new pad):
 *   harvester pad appears after the first customer sale; processor pad after the harvester unlocks;
 *   both conveyor pads after the processor unlocks AND the first tricycle sale (or ~25 s, whichever
 *   first); mega-saw pad after both conveyors are unlocked.
 * - Phase: 'manual' → 'harvester' → 'processor' → 'automation' (first conveyor) → 'expansion'
 *   (mega saw), set ctx.state.phase + emit 'phase:changed'. On each unlock: a short camera focus on the
 *   new station (level.anchorOf(id)) then back, and an encouraging hud.toast (JuiceDirector already
 *   toasts "<LABEL> UNLOCKED!" — coordinate: either is fine, not both).
 * - Guide (re-evaluated ~4×/s): one objective at a time via ctx.hud.setObjective(text) +
 *   ctx.hud.setGuideTarget(world point) — e.g. "Chop the giant log!" → chop zone; "Pick up the logs" →
 *   drop zone; "Sell logs to customers" → walk-in counter zone; "Collect your cash" → cash pile;
 *   "Build the HARVESTER ($100)" → pad (when affordable or when nothing else to do); later "Feed the
 *   processor", "Grab the crates", "Load the tricycles". Hide the arrow while the player already stands
 *   in the target zone; go quiet once everything is automated except for affordable pads.
 */
import type { GameContext, PadId, Phase } from '../core/types';
import type { Level } from '../level/Level';

const ORDER: PadId[] = ['harvester', 'processor', 'westConveyor', 'eastConveyor', 'megaSaw'];

export class Progression {
  constructor(
    readonly ctx: GameContext,
    readonly level: Level,
  ) {
    ctx.events.on('pad:unlocked', ({ id }) => {
      const i = ORDER.indexOf(id);
      if (id === 'processor') {
        this.level.pads.westConveyor.show();
        this.level.pads.eastConveyor.show();
      } else if (id === 'westConveyor' || id === 'eastConveyor') {
        if (ctx.state.unlocked.westConveyor && ctx.state.unlocked.eastConveyor) this.level.pads.megaSaw.show();
      } else if (i >= 0 && i + 1 < ORDER.length) {
        this.level.pads[ORDER[i + 1]!].show();
      }
      this.setPhase(
        id === 'harvester' ? 'harvester' : id === 'processor' ? 'processor' : id === 'megaSaw' ? 'expansion' : 'automation',
      );
    });
  }

  start(): void {
    this.skipIntro();
  }

  skipIntro(): void {
    this.level.giantLog.placeAtRest();
    this.level.giantLog.setChoppable(true);
    this.ctx.player.inputEnabled = true;
    this.setPhase('manual');
    this.level.pads.harvester.show();
  }

  update(_dt: number): void {}

  private setPhase(phase: Phase): void {
    if (this.ctx.state.phase === phase) return;
    this.ctx.state.phase = phase;
    this.ctx.events.emit('phase:changed', { phase });
  }
}
