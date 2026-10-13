/**
 * [B7 — progression] Phase state machine, pad sequencing, intro cinematic, tutorial guide.
 *
 * Responsibilities (Level owns the stations and builds them when 'pad:unlocked' fires; this class
 * decides WHEN things happen and guides the player):
 * - start(): intro — ctx.player.inputEnabled = false, the camera tracks the giant log while
 *   level.giantLog.playIntro(onCrash, onSettled) floats it down the river; after it settles the camera
 *   returns to the player, input is enabled, the log becomes choppable, phase 'manual', 'intro:done'.
 *   Tapping / pressing a key skips the cinematic. skipIntro() jumps straight to the post-intro state.
 *   Gameplay state never waits on camera callbacks (debug teleports cancel camera focus without firing
 *   them): everything is driven by simulation-time delays and an idempotent finishIntro().
 * - Pad sequence (revealed with a short delay + camera nudge toward the new pad):
 *   harvester pad after the first customer sale; processor pad after the harvester unlocks;
 *   both conveyor pads after the processor unlocks AND the first tricycle sale (or ~25 s, whichever
 *   first); mega-saw pad after both conveyors are unlocked.
 * - Phase: 'manual' → 'harvester' → 'processor' → 'automation' (first conveyor) → 'expansion'
 *   (mega saw), set ctx.state.phase + emit 'phase:changed' (only ever moves forward). On each unlock: a
 *   camera focus on the new station (level.anchorOf(id)) then back. JuiceDirector already toasts
 *   "<LABEL> UNLOCKED!", so no second toast here.
 * - Guide (re-evaluated ~4×/s): one objective at a time via ctx.hud.setObjective(text) +
 *   ctx.hud.setGuideTarget(world point) — chop → pick up → sell → collect cash → build pad → feed the
 *   processor → grab the crates → load the tricycles / trucks. The arrow is hidden while the player already
 *   stands in the target zone; the guide goes quiet once everything is automated.
 */
import * as THREE from 'three';
import { LAYOUT, PLAYER, type Rect } from '../config';
import type { GameContext, PadId, Phase } from '../core/types';
import type { Level } from '../level/Level';

/** Seconds after the processor unlocks before the conveyor pads appear even without a tricycle sale. */
const CONVEYOR_FALLBACK = 25;
/** Pause between a unlock's camera moment and the next pad appearing. */
const NEXT_PAD_DELAY = 3.4;
const GUIDE_INTERVAL = 0.25;
/** Minimum time an objective stays on screen before it may change. */
const GUIDE_DWELL = 0.7;
const PICKUP_STAY_UNTIL = 6;

const PHASE_RANK: Record<Phase, number> = {
  intro: 0,
  manual: 1,
  harvester: 2,
  processor: 3,
  automation: 4,
  expansion: 5,
};

const PHASE_OF_PAD: Record<PadId, Phase> = {
  harvester: 'harvester',
  processor: 'processor',
  westConveyor: 'automation',
  eastConveyor: 'automation',
  megaSaw: 'expansion',
};

type IntroState = 'pending' | 'playing' | 'done';

const titleCase = (s: string): string => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const centerOf = (r: Rect, out: THREE.Vector3): THREE.Vector3 => out.set((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);

export class Progression {
  private intro: IntroState = 'pending';
  /** Bumped whenever the intro ends so stale delayed callbacks do nothing. */
  private introToken = 0;
  private sawCrash = false;
  /** Invisible object the intro camera tracks (follows the log until it is near the gate). */
  private readonly introCam = new THREE.Object3D();

  private readonly scheduled = new Set<PadId>();
  private conveyorTimer: number | null = null;
  private conveyorsRevealed = false;
  private firstTrikeSale = false;

  // guide
  private guideAcc = 0;
  private objective: string | null = null;
  private objectiveSince = -10;
  private readonly guidePoint = new THREE.Vector3();
  private readonly tmpPoint = new THREE.Vector3();

  constructor(
    readonly ctx: GameContext,
    readonly level: Level,
  ) {
    ctx.events.on('intro:crash', () => {
      this.sawCrash = true;
    });
    ctx.events.on('sale', ({ buyer }) => {
      if (buyer === 'customer') {
        this.schedulePad('harvester', 1.6);
      } else if (buyer === 'tricycle' && !this.firstTrikeSale) {
        this.firstTrikeSale = true;
        if (ctx.state.unlocked.processor) this.revealConveyors(2.0);
      }
    });
    ctx.events.on('pad:unlocked', ({ id }) => this.onUnlocked(id));
  }

  start(): void {
    if (this.intro !== 'pending') return;
    const ctx = this.ctx;
    const log = this.level.giantLog;
    this.intro = 'playing';
    const token = ++this.introToken;
    ctx.player.inputEnabled = false;
    log.setChoppable(false);
    ctx.hud.setObjective(null);
    ctx.hud.setGuideTarget(null);

    // Tap / key press skips the cinematic.
    ctx.input.onFirstGesture(() => {
      if (this.intro === 'playing' && token === this.introToken) this.finishIntro(true);
    });

    this.sawCrash = false;
    log.playIntro(
      () => {
        if (token !== this.introToken) return;
        if (!this.sawCrash) {
          // The log did not announce the crash itself: do it here (sound / splash / shake come from the event).
          const g = LAYOUT.giantLog;
          ctx.events.emit('intro:crash', { position: new THREE.Vector3(g.x, 0.3, g.gateZ) });
        }
      },
      () => {
        if (token !== this.introToken) return;
        ctx.tweens.delay(1.0, () => {
          if (token === this.introToken) this.handOver();
        });
      },
    );

    // Camera: open on the log wherever playIntro put it and ride along with it down the river.
    this.updateIntroCam();
    ctx.cameraRig.target.copy(this.introCam.position);
    ctx.cameraRig.focus(this.introCam, { duration: 0, hold: Infinity });
  }

  /** Jump straight to the post-intro state (also used by the debug API). */
  skipIntro(): void {
    if (this.intro === 'done') return;
    this.intro = 'playing';
    this.finishIntro(true);
  }

  update(dt: number): void {
    if (this.intro === 'playing') this.updateIntroCam();

    if (this.conveyorTimer !== null) {
      this.conveyorTimer -= dt;
      if (this.conveyorTimer <= 0) {
        this.conveyorTimer = null;
        this.revealConveyors(0);
      }
    }

    if (this.intro === 'done') {
      this.guideAcc += dt;
      if (this.guideAcc >= GUIDE_INTERVAL) {
        this.guideAcc = 0;
        this.evaluateGuide();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Intro
  // ---------------------------------------------------------------------------

  /** Camera proxy: rides ahead of the log, but stops short of the gate so the crash plays out in frame. */
  private updateIntroCam(): void {
    const g = LAYOUT.giantLog;
    const p = this.level.giantLog.object.position;
    // Look a little downstream of the log so it slides into frame out of the mountain pass.
    this.introCam.position.set(p.x + 3, 0, Math.min(p.z + 9, g.z + 2.5));
  }

  /** Cinematic is over: camera glides back to the player and the game begins. */
  private handOver(): void {
    if (this.intro !== 'playing') return;
    this.ctx.cameraRig.focus(this.ctx.player.object, { duration: 1.1, hold: 0.01 });
    this.finishIntro(false);
  }

  /** Idempotent. `instant` also snaps the log and the camera (skip / debug). */
  private finishIntro(instant: boolean): void {
    if (this.intro === 'done') return;
    this.intro = 'done';
    this.introToken++;
    const ctx = this.ctx;
    if (instant) {
      this.level.giantLog.placeAtRest();
      ctx.cameraRig.snapToTarget();
    }
    ctx.player.inputEnabled = true;
    this.level.giantLog.setChoppable(true);
    this.setPhase('manual');
    ctx.events.emit('intro:done', {});
    this.guideAcc = GUIDE_INTERVAL;
    this.objectiveSince = -10;
  }

  // ---------------------------------------------------------------------------
  // Phases + pad sequencing
  // ---------------------------------------------------------------------------

  /** Phases only ever move forward (debug unlocks can arrive out of order). */
  private setPhase(phase: Phase): void {
    const s = this.ctx.state;
    if (s.phase === phase || PHASE_RANK[phase] < PHASE_RANK[s.phase]) return;
    s.phase = phase;
    this.ctx.events.emit('phase:changed', { phase });
  }

  private onUnlocked(id: PadId): void {
    const ctx = this.ctx;
    this.setPhase(PHASE_OF_PAD[id]);

    // Camera moment on the freshly built station.
    if (this.intro === 'done') {
      const anchor = this.level.anchorOf(id, this.tmpPoint);
      ctx.cameraRig.focus(anchor, { duration: 0.8, hold: id === 'megaSaw' ? 2.0 : 1.4 });
    }

    switch (id) {
      case 'harvester':
        this.schedulePad('processor', NEXT_PAD_DELAY);
        break;
      case 'processor':
        if (this.firstTrikeSale) this.revealConveyors(NEXT_PAD_DELAY);
        else if (!this.conveyorsRevealed && this.conveyorTimer === null) this.conveyorTimer = CONVEYOR_FALLBACK;
        break;
      case 'westConveyor':
      case 'eastConveyor':
        if (ctx.state.unlocked.westConveyor && ctx.state.unlocked.eastConveyor) this.schedulePad('megaSaw', NEXT_PAD_DELAY);
        break;
      case 'megaSaw':
        break;
    }
  }

  /** Show a pad after `delay` seconds of simulation time (once). */
  private schedulePad(id: PadId, delay: number): void {
    const pad = this.level.pads[id];
    if (this.scheduled.has(id) || pad.visible || pad.unlocked) return;
    this.scheduled.add(id);
    this.ctx.tweens.delay(delay, () => this.revealPad(id));
  }

  private revealPad(id: PadId): void {
    const pad = this.level.pads[id];
    if (pad.visible || pad.unlocked) return;
    pad.show();
    if (this.intro === 'done') this.ctx.cameraRig.focus(pad.position, { duration: 0.7, hold: 0.9 });
  }

  /** Both conveyor pads appear together, with one camera nudge between them. */
  private revealConveyors(delay: number): void {
    if (this.conveyorsRevealed) return;
    this.conveyorsRevealed = true;
    this.conveyorTimer = null;
    this.ctx.tweens.delay(delay, () => {
      const w = this.level.pads.westConveyor;
      const e = this.level.pads.eastConveyor;
      w.show();
      e.show();
      if (this.intro === 'done') {
        const mid = new THREE.Vector3().addVectors(w.position, e.position).multiplyScalar(0.5);
        this.ctx.cameraRig.focus(mid, { duration: 0.8, hold: 1.2 });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Tutorial guide
  // ---------------------------------------------------------------------------

  private setGoal(text: string | null, area: Rect | null, point?: THREE.Vector3): void {
    const ctx = this.ctx;
    const now = ctx.time.elapsed;
    if (text !== this.objective) {
      if (now - this.objectiveSince < GUIDE_DWELL) return; // keep the current hint a moment
      this.objective = text;
      this.objectiveSince = now;
      ctx.hud.setObjective(text);
    }
    if (!text || (!area && !point)) {
      ctx.hud.setGuideTarget(null);
      return;
    }
    // No arrow while the player already stands in the target zone.
    if (area && ctx.zones.isPlayerIn(area)) {
      ctx.hud.setGuideTarget(null);
      return;
    }
    if (point) this.guidePoint.copy(point);
    else centerOf(area!, this.guidePoint);
    ctx.hud.setGuideTarget(this.guidePoint);
  }

  private evaluateGuide(): void {
    const ctx = this.ctx;
    const L = this.level;
    const s = ctx.state;
    const money = ctx.economy.money;
    const arms = ctx.player.arms;
    const armsLogs = arms.count('log');
    const armsCrates = arms.count('crate');
    const armsFull = arms.count() >= PLAYER.armsCapacity;
    const trucksWaiting = L.trucks?.waiting ?? 0;
    const inArea = (r: Rect): boolean => ctx.zones.isPlayerIn(r);

    // 1. A pad we can pay right now.
    for (const id of ['harvester', 'processor', 'westConveyor', 'eastConveyor', 'megaSaw'] as const) {
      const pad = L.pads[id];
      if (pad.visible && pad.remaining > 0 && (money >= pad.remaining || (inArea(pad.zone.area) && money > 0))) {
        this.setGoal(`Build the ${titleCase(pad.def.label)} ($${pad.remaining})`, pad.zone.area);
        return;
      }
    }

    // 2. Crates in hand → tricycles.
    if (armsCrates > 0 && L.seCounter) {
      this.setGoal('Load the tricycles', L.seCounter.zone.area);
      return;
    }

    // 3. Logs in hand (keep picking up while standing at a stocked drop zone).
    const dropCount = L.dropZone.pile.count('log');
    const pickingUp = inArea(L.dropZone.zone.area) && dropCount > 0 && !armsFull && armsLogs < PICKUP_STAY_UNTIL;
    if (armsLogs > 0 && !pickingUp) {
      const proc = L.processor;
      if (s.phase === 'expansion' && L.truckCounter && trucksWaiting > 0) {
        this.setGoal('Load the trucks', L.truckCounter.zone.area);
        return;
      }
      const stock =
        proc && L.seCounter
          ? proc.input.count('log') + proc.output.count('crate') + L.seCounter.pile.count('crate')
          : 99;
      const feed = proc && (L.tricycles?.waiting ?? 0) > 0 && stock < 6 && L.walkInCounter.pile.count('plank') >= 4;
      if (feed && proc) {
        this.setGoal('Feed the processor', proc.inputZone.area);
      } else {
        this.setGoal('Sell logs to customers', L.walkInCounter.zone.area);
      }
      return;
    }

    // 4. Cash waiting (the bigger pile first).
    const seCash = L.seCash?.value ?? 0;
    const wiCash = L.walkInCash.value;
    if (seCash > 0 || wiCash > 0) {
      const pile = seCash > wiCash && L.seCash ? L.seCash : L.walkInCash;
      this.setGoal('Collect your cash', pile.zone.area);
      return;
    }

    // 5. Crates ready on the workbench.
    if (L.processor && !armsFull && L.processor.output.count('crate') > 0) {
      this.setGoal('Grab the crates', L.processor.outputZone.area);
      return;
    }

    // 6. Logs waiting in the drop zone (unless both belts carry them away).
    const belts = !!L.westConveyor && !!L.eastConveyor;
    const chopping = inArea(L.giantLog.chopZone.area) && !L.dropZone.isFull && dropCount < 4 && !s.unlocked.harvester;
    if ((!belts || trucksWaiting > 0) && !armsFull && dropCount > 0 && !chopping) {
      this.setGoal('Pick up the logs', L.dropZone.zone.area);
      return;
    }

    // 7. Nothing in the yard yet: chop (only until the harvester does it for us).
    if (!s.unlocked.harvester && !L.dropZone.isFull) {
      this.setGoal('Chop the giant log!', L.giantLog.chopZone.area);
      return;
    }

    // Everything runs by itself: quiet.
    this.setGoal(null, null);
  }
}
