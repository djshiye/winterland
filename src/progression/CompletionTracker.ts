/**
 * [MAIN] 0.9.7 the ending (plan decisions 3-5): watches this season's completion (core/completion.ts) and plays the
 * finale the moment it reaches 100 %.
 *
 * - 'era:unlocked' { era } stamps state.eraAt[era] with the play time (the stats page's "time per era"). A restored
 *   save emits nothing, so old eras keep whatever the save holds (−1 for eras reached before 0.9.7).
 * - Re-reads the completion twice a second. At 100 % (once per season, flags.complete): stamps the moment
 *   (eraAt[MAX_ERA + 1]), adds the trophy and the finished season to state.trophies (lifetime, survives New Season)
 *   and emits 'complete:start' at the Great Lodge (JuiceDirector: fireworks; HUD: the Winterland Complete card).
 *   Never during the intro.
 * - The gold trophy stands on the Great Lodge plaza for good once any season reached 100 % (trophies.complete > 0),
 *   one small star on its plinth per completion.
 */
import * as THREE from 'three';
import { LAYOUT } from '../config';
import { completion, runRecord } from '../core/completion';
import { hushFinale, tickQuiet } from '../core/quiet';
import { RUNS_CAP } from '../core/Save';
import type { GameContext } from '../core/types';
import { MAX_ERA } from '../eras/data';
import { createTrophyModel, type TrophyModel } from '../assets/trophy';
import { reducedMotion } from '../fx/padJuice';

const CHECK_EVERY = 0.5;

/**
 * Where the trophy stands: in the open corner east of the Great Lodge, south of the town corridor (no lamp, no
 * walkway). Validator #41 note 2: it was villager-sized at the corridor mouth, partly behind a street lamp.
 */
export const TROPHY_SPOT = { x: 8.6, z: 29.7 } as const;
/** About 4 m tall on a 2.2 m plinth: the ending's landmark, not a villager-sized ornament. */
export const TROPHY_SCALE = 2.0;

export class CompletionTracker {
  private acc = 0;
  private trophy: TrophyModel | null = null;
  private trophyStars = 0;
  private t = 0;
  /** Last completion % read (the era chip reads its own; this one is for tests and the debug API). */
  pct = 0;

  constructor(private readonly ctx: GameContext) {
    ctx.events.on('era:unlocked', ({ era }) => {
      const at = ctx.state.eraAt;
      if (era >= 2 && era <= MAX_ERA && !(at[era]! >= 0)) at[era] = ctx.state.playTime;
    });
    this.placeTrophy();
    ctx.addUpdatable(this);
  }

  update(dt: number): void {
    this.t += dt;
    tickQuiet(dt);
    if (this.trophy && !reducedMotion()) this.trophy.spin.rotation.y = this.t * 0.9;
    this.acc -= dt;
    if (this.acc > 0) return;
    this.acc = CHECK_EVERY;
    const s = this.ctx.state;
    const c = completion(s);
    this.pct = c.pct;
    if (!c.complete || s.flags.complete || !s.flags.introDone) return;
    this.finish();
  }

  /** The season reached 100 %: record it, place the trophy, start the finale. */
  finish(): void {
    const s = this.ctx.state;
    if (s.flags.complete) return;
    s.flags.complete = true;
    s.eraAt[MAX_ERA + 1] = s.playTime;
    s.trophies.complete++;
    s.trophies.runs.push(runRecord(s));
    if (s.trophies.runs.length > RUNS_CAP) s.trophies.runs.splice(0, s.trophies.runs.length - RUNS_CAP);
    this.placeTrophy();
    hushFinale();
    const g = LAYOUT.village.greatLodge;
    this.ctx.events.emit('complete:start', { position: new THREE.Vector3(g.x, 0, g.z) });
  }

  /** The plaza trophy, (re)built when the number of completions it shows changed. */
  private placeTrophy(): void {
    const n = this.ctx.state.trophies.complete;
    if (n <= 0 || n === this.trophyStars) return;
    if (this.trophy) this.ctx.scene.remove(this.trophy.root);
    this.trophy = createTrophyModel(n);
    this.trophy.root.position.set(TROPHY_SPOT.x, 0, TROPHY_SPOT.z);
    this.trophy.root.scale.setScalar(TROPHY_SCALE);
    this.trophy.root.rotation.y = -Math.PI / 2; // faces the street (−X)
    this.trophyStars = n;
    this.ctx.scene.add(this.trophy.root);
  }

  /** The trophy on the plaza (null before the first 100 %). Tests. */
  get trophyObject(): THREE.Object3D | null {
    return this.trophy?.root ?? null;
  }
}
