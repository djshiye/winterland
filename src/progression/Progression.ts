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
 * - Wave 7 (after the mega saw): truck loader pad after a few truck sales; Timber Ridge pad once the loader is bought
 *   (or the village reaches Town); tree feller pad once the ridge is open; cash tubes pad a little later. The ridge
 *   unlock plays a two-stop camera moment (east gate, then the ridge). The guide walks the player through the east
 *   gate, to the bunkhouse pad (Level.quarters.padSpot()), pine logs from the deck to the rail platform, and hiring
 *   the pine hauler.
 * - Wave 8: the workshop pad appears 60 s after the tree feller (reveals.ts). Its unlock plays a feller-style pan. The
 *   guide: "Build the Workshop ($15,000)" (the generic pad hint), then a one-off lesson "Feed logs to the workshop"
 *   (hopper arrow; "Pick up logs for the workshop" fetches them from the deck / yard) until the first chair exists,
 *   "Grab the chairs for the dog sleds" at the bench, and "Carry chairs to the dog sleds" at the sled counter. The sled
 *   cash joins the "Walk over the cash" biggest-pile pick through Level.cashPiles().
 * - Guide (re-evaluated ~4×/s): one objective at a time via ctx.hud.setObjective(text) +
 *   ctx.hud.setGuideTarget(world point) — chop → pick up → sell → collect cash → build pad → feed the
 *   processor → grab the crates → load the tricycles / trucks. The arrow is hidden while the player already
 *   stands in the target zone; the guide goes quiet once everything is automated.
 * - 0.9.0 climb: once the Great Lodge opens it, the guide's last word is the era gate's next goal (climbGuide).
 */
import * as THREE from 'three';
import { AMENITIES, AMENITY_IDS, BUSINESSES, LAYOUT, PADS, QUARTERS, TOWN, UPGRADES, VILLAGE, rect, type BusinessId, type PadIdConst, type Rect, type UpgradeIdConst, type XZ } from '../config';
import type { FlagId, GameContext, ItemKind, PadId, Phase } from '../core/types';
import type { Level } from '../level/Level';
import type { Machine } from '../eras/Machine';
import { DISTRICTS, ERAS, MACHINES, MATERIALS, REGIONS, machinesOfEra } from '../eras/data';
import { climbOpen, eraMatOf, hasGate, nextGoal } from '../eras/gate';
import { expansionOffered, regionLayout } from '../eras/layout';
import { MAT_SIZE, machinePadTarget, worldRect } from '../eras/rules';
import { MATERIAL_KINDS } from '../core/kinds';
import { article, formatMoney } from '../ui/format';
import { REVEALS, type RevealAction, type RevealQuery, type RevealRule } from './reveals';
import { grandMarketOffered } from '../town/rules';
import { lotOffered } from '../town/lane';
import { usingGamepad } from '../input/Gamepad';
import { EraStarter, starterFlag } from './eraStarter';
import { setGuideGoal } from './guideGoal';

/** " (hold A)" with a gamepad (0.9.7), " (hold E)" with a keyboard, " (hold)" on touch, for the guide's pickup / payment hints. */
function holdHint(): string {
  try {
    if (usingGamepad()) return ' (hold A)';
    return window.matchMedia('(pointer: coarse)').matches ? ' (hold)' : ' (hold E)';
  } catch {
    return ' (hold E)';
  }
}

const GUIDE_INTERVAL = 0.25;
/** Minimum time an objective stays on screen before it may change. */
const GUIDE_DWELL = 0.7;
const PICKUP_STAY_UNTIL = 6;
/** Seconds between "visit the cabin" reminders once the shop has been visited. */
const SHOP_REMINDER = 120;
const RULE_INTERVAL = 0.2;
/** With the cash tubes built, "Walk over the cash to bank it" only shows for a pile worth at least this much. */
const CASH_BACKLOG = 300;
/** The "feed logs to the workshop" lesson is offered this long after the workshop opens, and only until the first chair. */
const WORKSHOP_LESSON = 600; // long enough that a busy village can't hide the lesson
/** 0.9.10 (READINESS C7): the one-time MANAGE tip shows once a built era machine's sign is this close (metres)... */
const MANAGE_HINT_NEAR = 6;
/** ...and stays up this long (seconds) unless the player opens a MANAGE card first. */
const MANAGE_HINT_SECONDS = 12;
const MANAGE_HINT_FLAG = 'seen:manageHint' as const;

const PAD_ORDER = [
  'harvester',
  'processor',
  'westConveyor',
  'eastConveyor',
  'megaSaw',
  'truckLoader',
  'ridge',
  'treeFeller',
  'cashTubes',
  'workshop',
] as const;

/** Pad button text: what the player does there (everything else reads "Build the <Label>"). */
const PAD_VERB: Partial<Record<PadId, string>> = { ridge: 'Open', cashTubes: 'Install the' };
const PAD_NOUN: Partial<Record<PadId, string>> = { ridge: 'Timber Ridge', cashTubes: 'Cash Tubes' };

const fmtMoney = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

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
  // Wave 7 pads come after the expansion and don't change the phase.
  ridge: 'expansion',
  treeFeller: 'expansion',
  truckLoader: 'expansion',
  cashTubes: 'expansion',
  workshop: 'expansion',
};

type IntroState = 'pending' | 'playing' | 'done';

const titleCase = (s: string): string => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const centerOf = (r: Rect, out: THREE.Vector3): THREE.Vector3 => out.set((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);

/** What a log-and-cash build goal (village shelter, Great Lodge, crew bunkhouse) points at. */
interface BuildNeed {
  spot: XZ;
  logsLeft: number;
  cashLeft: number;
  /** The call to action once the logs are in hand ('Build the Great Lodge!', 'Bring logs to the village', ...). */
  text: string;
  /** Shown while fetching logs. */
  pick: string;
  /** 0.9.2: the foreman builds this site (village plots, town lots, the bunkhouse; never the Great Lodge). */
  crew?: boolean;
}

export class Progression {
  private intro: IntroState = 'pending';
  /** Bumped whenever the intro ends so stale delayed callbacks do nothing. */
  private introToken = 0;
  private sawCrash = false;
  /** Invisible object the intro camera tracks (follows the log until it is near the gate). */
  private readonly introCam = new THREE.Object3D();

  // Clocks only (never one-shots: those live in ctx.state.flags). They restart after a reload.
  private readonly unlockedAt = new Map<PadId, number>();
  private readonly revealedAt = new Map<string, number>();
  private readonly readySince = new Map<string, number>();
  private ruleAcc = 0;
  /** Invalidates a pending second stop of the ridge camera moment when another moment takes over. */
  private momentToken = 0;
  private readonly tmpGate = new THREE.Vector3();
  private lastShopVisit = 0;

  // guide
  private guideAcc = 0;
  /** 0.9.7: the five-step guide of a newly opened era region (eraStarter.ts). */
  private readonly starter = new EraStarter();
  private objective: string | null = null;
  private objectiveSince = -10;
  private readonly guidePoint = new THREE.Vector3();
  private readonly tmpPoint = new THREE.Vector3();
  /** The MANAGE tip: when it came up (−1 = not yet) and the sign it points at. */
  private manageHintAt = -1;
  private manageSpot: Rect | null = null;

  private readonly query: RevealQuery;

  constructor(
    readonly ctx: GameContext,
    readonly level: Level,
  ) {
    const now = ctx.time.elapsed;
    this.lastShopVisit = now;
    this.query = {
      state: ctx.state,
      sinceUnlock: (id) => ctx.time.elapsed - (this.unlockedAt.get(id) ?? Number.NEGATIVE_INFINITY),
      sinceReveal: (id) => ctx.time.elapsed - (this.revealedAt.get(id) ?? Number.NEGATIVE_INFINITY),
      cashPiles: () => level.cashPiles().length,
    };

    ctx.events.on('intro:crash', () => {
      this.sawCrash = true;
    });
    ctx.events.on('sale', ({ buyer }) => {
      if (buyer === 'customer') ctx.state.flags.firstCustomerSale = true;
      else if (buyer === 'tricycle') ctx.state.flags.firstTrikeSale = true;
    });
    ctx.events.on('pad:unlocked', ({ id }) => this.onUnlocked(id));
    // the MANAGE tip is learnt the moment an era machine's or a city building's card opens (town shops don't count)
    ctx.events.on('manage:open', ({ key }) => {
      if (/^(slot|city):/.test(key)) ctx.state.flags[MANAGE_HINT_FLAG] = true;
    });
    ctx.events.on('shop:close', () => {
      this.lastShopVisit = ctx.time.elapsed;
    });
    ctx.events.on('village:levelUp', ({ level }) => {
      if (level === VILLAGE.greatLodge.requiresLevel) this.onGreatLodgeOffered();
    });
    ctx.events.on('shelter:built', ({ plot }) => {
      if (plot < 0) this.onFinale();
    });
    // wave 13: the Grand Market opens (Town emits it once, on completion): the second finale
    ctx.events.on('finale2:start', ({ position }) => this.onFinale2(position));

    // A restored game: clocks restart, fired reveals are re-applied silently, the intro is skipped silently.
    for (const id of PAD_ORDER) if (ctx.state.unlocked[id]) this.unlockedAt.set(id, now);
    for (const rule of REVEALS) {
      if (!ctx.state.flags[flagOf(rule)]) continue;
      this.revealedAt.set(rule.id, now);
      this.apply(rule.action, true);
    }
    if (ctx.state.flags.introDone) {
      this.intro = 'done';
      level.giantLog.placeAtRest();
      level.giantLog.setChoppable(true);
      ctx.player.inputEnabled = true;
      if (PHASE_RANK[ctx.state.phase] < PHASE_RANK.manual) ctx.state.phase = 'manual';
      this.guideAcc = GUIDE_INTERVAL;
    }
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
    if (this.intro !== 'done') return;

    this.ruleAcc += dt;
    if (this.ruleAcc >= RULE_INTERVAL) {
      this.ruleAcc = 0;
      this.evaluateReveals();
    }
    this.guideAcc += dt;
    if (this.guideAcc >= GUIDE_INTERVAL) {
      this.guideAcc = 0;
      this.evaluateGuide();
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
    ctx.state.flags.introDone = true;
    ctx.events.emit('intro:done', {});
    this.guideAcc = GUIDE_INTERVAL;
    this.objectiveSince = -10;
  }

  // ---------------------------------------------------------------------------
  // Phases + reveal timeline (data in ./reveals.ts)
  // ---------------------------------------------------------------------------

  /** Phases only ever move forward (debug unlocks can arrive out of order). */
  private setPhase(phase: Phase): void {
    const s = this.ctx.state;
    if (s.phase === phase || PHASE_RANK[phase] < PHASE_RANK[s.phase]) return;
    s.phase = phase;
    this.ctx.events.emit('phase:changed', { phase });
  }

  private onUnlocked(id: PadId): void {
    this.unlockedAt.set(id, this.ctx.time.elapsed);
    this.setPhase(PHASE_OF_PAD[id]);
    // Camera moment on the freshly built station.
    if (this.intro === 'done') {
      if (id === 'ridge') {
        this.ridgeMoment();
        return;
      }
      const anchor = this.level.anchorOf(id, this.tmpPoint);
      // The feller is a smaller beat than the big unlocks.
      // The workshop gets the feller's quick pan with a slightly longer look (the cabin is the star).
      const small = id === 'treeFeller' || id === 'workshop';
      const hold = id === 'megaSaw' ? 2.0 : id === 'treeFeller' ? 1.0 : id === 'workshop' ? 1.5 : 1.4;
      this.ctx.cameraRig.focus(anchor, { duration: small ? 0.7 : 0.8, hold });
    }
  }

  /** Timber Ridge opens: pan to the east gate, then out across the ridge, then back to the player. */
  private ridgeMoment(): void {
    const ctx = this.ctx;
    const rig = ctx.cameraRig;
    const g = LAYOUT.ridge.gate;
    const gate = this.tmpGate.set(LAYOUT.yard.maxX, 0, (g.minZ + g.maxZ) / 2).clone();
    const far = this.level.anchorOf('ridge', new THREE.Vector3());
    const token = ++this.momentToken;
    rig.focus(gate, {
      duration: 0.8,
      hold: 1.2,
      onArrive: () =>
        ctx.tweens.delay(0.55, () => {
          if (token === this.momentToken) rig.focus(far, { duration: 1.0, hold: 1.5 });
        }),
    });
  }

  /** Check the reveal table; fires at most one rule per call. */
  private evaluateReveals(): void {
    const ctx = this.ctx;
    const now = ctx.time.elapsed;
    for (const rule of REVEALS) {
      const flag = flagOf(rule);
      if (ctx.state.flags[flag]) continue;
      if (rule.satisfied?.(this.query)) {
        ctx.state.flags[flag] = true;
        this.revealedAt.set(rule.id, now);
        continue;
      }
      if (!rule.ready(this.query)) {
        this.readySince.delete(rule.id);
        continue;
      }
      const since = this.readySince.get(rule.id) ?? now;
      this.readySince.set(rule.id, since);
      if (now - since < rule.delay) continue;
      ctx.state.flags[flag] = true;
      this.revealedAt.set(rule.id, now);
      this.readySince.delete(rule.id);
      this.apply(rule.action, false);
      return;
    }
  }

  /** Do what a reveal says. instant (restored game): silent, no camera. */
  private apply(action: RevealAction, instant: boolean): void {
    const L = this.level;
    switch (action.kind) {
      case 'pad': {
        const pad = L.pads[action.id];
        if (pad.unlocked || pad.visible) return;
        pad.show(instant);
        if (!instant) this.moment(pad.position, 0.9);
        return;
      }
      case 'conveyors': {
        const w = L.pads.westConveyor;
        const e = L.pads.eastConveyor;
        w.show(instant);
        e.show(instant);
        if (!instant) this.moment(this.tmpPoint.addVectors(w.position, e.position).multiplyScalar(0.5), 1.2);
        return;
      }
      case 'levelPad': {
        const pad = L.pads[action.id];
        pad.showLevel(instant);
        if (!instant) {
          this.ctx.events.emit('reveal', { what: `levelPad:${action.id}`, position: pad.position.clone() });
          this.moment(pad.position, 0.9);
        }
        return;
      }
      case 'shop': {
        const mat = LAYOUT.shop.mat;
        L.shopMat.show(instant);
        if (!instant) {
          const at = new THREE.Vector3((mat.minX + mat.maxX) / 2, 0, (mat.minZ + mat.maxZ) / 2);
          this.ctx.events.emit('reveal', { what: 'shop', position: at });
          this.moment(at, 1.4);
        }
        return;
      }
      case 'village': {
        if (L.village.revealed && instant) {
          L.village.reveal(true);
          return;
        }
        const g = LAYOUT.village.gate;
        const at = new THREE.Vector3((g.minX + g.maxX) / 2, 0, 10.4);
        L.village.reveal(instant);
        if (!instant) {
          this.ctx.events.emit('reveal', { what: 'village', position: at });
          this.moment(at, 1.8);
        }
        return;
      }
      case 'town': {
        L.town.reveal(instant);
        if (!instant) {
          const sq = LAYOUT.town.square;
          const at = new THREE.Vector3((sq.minX + sq.maxX) / 2, 0, (sq.minZ + sq.maxZ) / 2);
          this.ctx.events.emit('reveal', { what: 'town', position: at });
          this.moment(at, 2.2);
        }
        return;
      }
    }
  }

  /** A short camera look at something new (never during the intro / for restored state). */
  private moment(point: THREE.Vector3, hold: number): void {
    if (this.intro !== 'done') return;
    this.momentToken++;
    this.ctx.cameraRig.focus(point, { duration: 0.75, hold });
  }

  /** Village level 4 (Winter City): the Great Lodge pad is offered. */
  private onGreatLodgeOffered(): void {
    const flags = this.ctx.state.flags;
    if (flags['reveal:greatLodge']) return;
    flags['reveal:greatLodge'] = true;
    const pad = LAYOUT.village.greatLodge.pad;
    const at = new THREE.Vector3(pad.x, 0, pad.z);
    this.ctx.events.emit('reveal', { what: 'greatLodge', position: at.clone() });
    this.moment(at, 2.0);
  }

  /** The Great Lodge is complete: Survival's finale ("Survival complete, the Frontier awaits"), and its trophy. */
  private onFinale(): void {
    const flags = this.ctx.state.flags;
    if (flags.finale) return;
    flags.finale = true;
    this.ctx.state.trophies.lodge++; // 0.9.7: lifetime, survives New Season
    const g = LAYOUT.village.greatLodge;
    const at = new THREE.Vector3(g.x, 0, g.z);
    this.ctx.events.emit('finale:start', { position: at.clone() });
    if (this.intro === 'done') this.ctx.cameraRig.focus(at, { duration: 1.0, hold: 3.0 });
  }

  /** The Grand Market is complete: the second finale (the flag marks it for the save; fireworks + card are others' job). */
  private onFinale2(position: THREE.Vector3): void {
    if (!this.ctx.state.flags.grandMarket) this.ctx.state.trophies.market++; // 0.9.7: lifetime trophy
    this.ctx.state.flags.grandMarket = true;
    if (this.intro === 'done') this.ctx.cameraRig.focus(position, { duration: 1.0, hold: 3.0 });
  }

  // ---------------------------------------------------------------------------
  // Tutorial guide
  // ---------------------------------------------------------------------------

  private setGoal(text: string | null, area: Rect | null, point?: THREE.Vector3, chip?: string): void {
    const ctx = this.ctx;
    const now = ctx.time.elapsed;
    const goal = text;
    // hold-to-interact (core/interact.ts): pickups and payments need the key, so the hint says so
    if (text && ctx.input.holdToInteract && /^(Pick up|Pay for|Bring logs to|Build the Great Lodge)/.test(text)) {
      text += holdHint();
    }
    if (text !== this.objective) {
      if (now - this.objectiveSince < GUIDE_DWELL) return; // keep the current hint a moment
      this.objective = text;
      this.objectiveSince = now;
      ctx.hud.setObjective(text);
      setGuideGoal(ctx.state, goal, chip); // 0.9.10 (C2): the era chip names the same goal
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
    ctx.hud.setGuideTarget(this.guidePoint, area);
  }

  /** The most useful village pad right now: the Great Lodge, else the first plot whose cash part is affordable. */
  private villageNeed(): BuildNeed | null {
    const ctx = this.ctx;
    const v = ctx.state.village;
    if (!v.revealed) return null;
    const money = ctx.economy.money;
    const great = this.level.village.padSpot(-1);
    if (great) {
      const gl = VILLAGE.greatLodge;
      const cashLeft = gl.cash - v.greatLodge.cash;
      if (v.greatLodge.tier < 0 && (cashLeft <= 0 || money >= cashLeft * 0.25)) {
        return { spot: great, logsLeft: gl.logs - v.greatLodge.logs, cashLeft, text: 'Build the Great Lodge!', pick: 'Pick up logs for the Great Lodge' };
      }
    }
    for (let i = 0; i < v.plots.length; i++) {
      const spot = this.level.village.padSpot(i);
      if (!spot) continue;
      const plot = v.plots[i]!;
      const tier = VILLAGE.tiers[plot.tier + 1];
      if (!tier) continue;
      const cashLeft = tier.cash - plot.cash;
      if (cashLeft <= 0 || money >= cashLeft) {
        const logsLeft = tier.logs - plot.logs;
        return {
          spot,
          logsLeft,
          cashLeft,
          text: logsLeft > 0 ? 'Bring logs to the village' : `Pay for the shelter (${fmtMoney(cashLeft)})`,
          pick: 'Pick up logs for the village',
          crew: true,
        };
      }
    }
    return null;
  }

  /** The crew bunkhouse pad (Timber Ridge) when it is offered and its cash part is affordable. */
  private quartersNeed(): BuildNeed | null {
    const spot = this.level.quarters.padSpot();
    if (!spot) return null;
    const q = this.ctx.state.quarters;
    const tier = QUARTERS.tiers[q.tier + 1];
    if (!tier) return null;
    const cashLeft = tier.cash - q.cash;
    if (cashLeft > 0 && this.ctx.economy.money < cashLeft) return null;
    const name = tier.label.toLowerCase();
    const logsLeft = tier.logs - q.logs;
    return {
      spot,
      logsLeft,
      cashLeft,
      text: logsLeft > 0 ? `Bring logs to the ${name}` : `Pay for the ${name} (${fmtMoney(cashLeft)})`,
      pick: `Pick up logs for the ${name}`,
      crew: true,
    };
  }

  /**
   * Walk a log-and-cash build goal: fetch logs (from whichever stocked pile is nearest the pad), carry them over,
   * pay. Returns false when nothing useful can be said right now (the caller falls through to other hints).
   */
  private pursue(need: BuildNeed): boolean {
    const L = this.level;
    const arms = this.ctx.player.arms;
    const armsLogs = arms.count('log');
    // 0.9.2: once the foreman hauls the logs and pays for this site, fetching / paying hints are noise; logs already in
    // hand still get a place to go
    if (need.crew && this.ctx.upgrades.isHired('foreman') && armsLogs === 0) return false;
    const want = Math.min(need.logsLeft, arms.capacity);
    if (need.logsLeft <= 0 || armsLogs >= want) {
      const spotArea = rect(need.spot.x, need.spot.z, 2.4, 2.4);
      this.setGoal(need.text, spotArea, this.tmpPoint.set(need.spot.x, 0, need.spot.z));
      return true;
    }
    if (arms.count() >= arms.capacity) return false;
    const sources: Rect[] = [];
    if (L.dropZone.pile.count('log') > 0) sources.push(L.dropZone.zone.area);
    if ((L.treeFeller?.deck.count('log') ?? 0) > 0) sources.push(LAYOUT.ridge.deck.zone);
    const dist = (a: Rect): number => Math.hypot((a.minX + a.maxX) / 2 - need.spot.x, (a.minZ + a.maxZ) / 2 - need.spot.z);
    sources.sort((a, b) => dist(a) - dist(b));
    if (!sources[0]) return false;
    this.setGoal(need.pick, sources[0]);
    return true;
  }

  /** Wave 9: wheat / meat in hand → the nearest shop whose hopper still takes it. */
  private townGoodsInHand(): boolean {
    const arms = this.ctx.player.arms;
    for (const kind of ['wheat', 'meat'] as const) {
      if (arms.count(kind) === 0) continue;
      const shop = this.townShopNeeding(kind);
      if (shop) {
        this.setGoal(`Bring ${kind} to the ${shop.def.label.toLowerCase()}`, shop.zone);
        return true;
      }
    }
    return false;
  }

  /** A built shop whose hopper still takes `kind` (fewest of it first). */
  private townShopNeeding(kind: ItemKind): { def: (typeof BUSINESSES)[BusinessId]; zone: Rect; have: number } | null {
    const town = this.level.town;
    let best: { def: (typeof BUSINESSES)[BusinessId]; zone: Rect; have: number } | null = null;
    for (let i = 0; i < LAYOUT.town.lots.length; i++) {
      const b = town.business(i);
      if (!b || b.def.kind !== 'shop' || !b.input || !b.feedZone) continue;
      if (!b.def.inputs.some((x) => x.kind === kind) || !b.input.canAccept(kind)) continue;
      const have = b.input.count(kind);
      if (!best || have < best.have) best = { def: b.def, zone: b.feedZone, have };
    }
    return best;
  }

  /** Wave 9: Market Town hints. Returns true when it set a goal. */
  private townGuide(): boolean {
    const ctx = this.ctx;
    const s = ctx.state;
    const town = this.level.town;
    if (!s.town.revealed) return false;
    const inArea = (r: Rect): boolean => ctx.zones.isPlayerIn(r);
    const money = ctx.economy.money;

    // First visit: through the corridor to the square.
    if (!s.flags['seen:town']) {
      if (inArea(LAYOUT.town.square)) {
        s.flags['seen:town'] = true;
      } else {
        const w = LAYOUT.town.walk[0]!;
        this.setGoal('Visit the new Market Town', LAYOUT.town.square, this.tmpPoint.set(w.maxX, 0, (w.minZ + w.maxZ) / 2));
        return true;
      }
    }

    // A chosen building being paid for (affordable): bring logs, pay.
    for (let i = 0; i < s.town.lots.length; i++) {
      const lot = s.town.lots[i]!;
      if (lot.building === '' || lot.tier >= 0) continue;
      const def = BUSINESSES[lot.building as BusinessId];
      const spot = town.padSpot(i);
      if (!spot) continue;
      const cashLeft = def.cash - lot.cash;
      if (cashLeft > 0 && money < cashLeft) continue;
      const logsLeft = def.logs - lot.logs;
      const name = def.label.toLowerCase();
      if (
        this.pursue({
          spot,
          logsLeft,
          cashLeft,
          text: logsLeft > 0 ? `Bring logs to the ${name}` : `Pay for the ${name} (${fmtMoney(cashLeft)})`,
          pick: `Pick up logs for the ${name}`,
          crew: true,
        })
      )
        return true;
    }

    if (this.grandMarketGuide()) return true;

    // Nothing built or chosen yet: point at the first free lot once a building is nearly affordable.
    const anyChosen = s.town.lots.some((l) => l.building !== '');
    if (!anyChosen) {
      const cheapest = Math.min(...Object.values(BUSINESSES).filter((d) => !TOWN.hidden.includes(d.id)).map((d) => d.cash));
      const lot = s.town.lots.findIndex((l, i) => l.building === '' && lotOffered(s, i));
      const spot = lot >= 0 ? town.padSpot(lot) : null;
      if (spot && money >= cheapest * 0.6) {
        this.setGoal('Build something in the Market Town', rect(spot.x, spot.z, 1.8, 1.8), this.tmpPoint.set(spot.x, 0, spot.z));
        return true;
      }
    }

    // Low priority, after the lots (no lot payment or first-lot hint was due above): an affordable amenity on the
    // square, pointed at its pad.
    for (const id of AMENITY_IDS) {
      const st = s.town.amenities[id];
      const def = AMENITIES[id];
      if (st.tier >= 0 || s.village.level < def.era) continue;
      const cashLeft = def.cash - st.cash;
      if (cashLeft > 0 && money < cashLeft) continue;
      const pad = LAYOUT.town.amenities[id].pad;
      this.setGoal(`Build the ${def.label} on the square`, rect(pad.x, pad.z, 1.8, 1.8), this.tmpPoint.set(pad.x, 0, pad.z));
      return true;
    }

    // Keep the shops stocked: carry a producer's goods to a shop that is low on them. 0.9.2: not once a porter does it
    // (wheat or meat already in hand is still pointed at a shop, townGoodsInHand).
    const arms = ctx.player.arms;
    const porter = ctx.upgrades.isHired('porter');
    if (!porter && arms.count() < arms.capacity) {
      for (let i = 0; i < LAYOUT.town.lots.length; i++) {
        const b = town.business(i);
        if (!b || b.def.kind !== 'producer' || !b.output || !b.pickupZone || !b.def.output) continue;
        const kind = b.def.output;
        if (b.output.count(kind) < 3) continue;
        const shop = this.townShopNeeding(kind);
        if (!shop) continue;
        this.setGoal(`Pick up ${kind} at the ${b.def.label.toLowerCase()}`, b.pickupZone);
        return true;
      }
    }
    // Logs in hand and a shop out of firewood (the porter's job once hired).
    if (!porter && arms.count('log') > 0) {
      const shop = this.townShopNeeding('log');
      if (shop && shop.have < 2) {
        this.setGoal(`Bring firewood to the ${shop.def.label.toLowerCase()}`, shop.zone);
        return true;
      }
    }
    return false;
  }

  /** 0.9.2: the built Toy Factory (the first one), or null. */
  private toyFactory(): ReturnType<Level['town']['business']> {
    const town = this.level.town;
    for (let i = 0; i < LAYOUT.town.lots.length; i++) {
      const b = town.business(i);
      if (b && b.def.id === 'toyFactory') return b;
    }
    return null;
  }

  /** 0.9.2: toys the Grand Market still needs (0 when it is not offered or the toys are all in). */
  private toysLeft(): number {
    const s = this.ctx.state;
    if (!grandMarketOffered(s)) return 0;
    return Math.max(0, VILLAGE.grandMarket.toys - s.town.grandMarket.toys);
  }

  /**
   * 0.9.2: the Grand Market, step by step. It needs logs, cash AND toys, and the toys come from a Toy Factory in the
   * Market Town (crates in, toy trains out on its counter, which the player can pick up). The guide used to say nothing
   * about it. Order: toys in hand → the pad; toys on the factory counter → pick them up; the factory short of crates →
   * fetch crates from the processor; no factory → build one on a free lot; all toys in → logs and cash.
   */
  private grandMarketGuide(): boolean {
    const ctx = this.ctx;
    const s = ctx.state;
    if (!grandMarketOffered(s)) return false;
    const def = VILLAGE.grandMarket;
    const st = s.town.grandMarket;
    const pad = LAYOUT.town.grandMarket.pad;
    const padArea = rect(pad.x, pad.z, 2.2, 2.2);
    const padPoint = this.tmpPoint.set(pad.x, 0, pad.z);
    const money = ctx.economy.money;
    const arms = ctx.player.arms;
    const left = this.toysLeft();
    if (!s.flags['seen:grandMarketTip']) {
      s.flags['seen:grandMarketTip'] = true;
      ctx.hud.toast('The Grand Market awaits!', { sub: `It needs ${def.toys} toys from a Toy Factory`, duration: 3.6 });
    }
    if (left > 0) {
      const inHand = arms.count('toy');
      if (inHand > 0) {
        this.setGoal(`Bring toys to the Grand Market (${st.toys}/${def.toys})`, padArea, padPoint);
        return true;
      }
      const toys = this.toyFactory();
      if (toys) {
        if (arms.count() < arms.capacity && toys.pickupZone && (toys.output?.count('toy') ?? 0) > 0) {
          this.setGoal(`Pick up toys at the toy factory (${st.toys}/${def.toys} delivered)`, toys.pickupZone);
          return true;
        }
        const proc = this.level.processor;
        const hungry = !!toys.input && toys.input.canAccept('crate') && toys.input.count('crate') < 2;
        if (hungry && proc && arms.count() < arms.capacity && proc.output.count('crate') > 0) {
          this.setGoal('Grab crates for the toy factory', proc.outputZone.area);
          return true;
        }
        return false; // the factory is busy: let the rest of the guide speak
      }
      // A toy factory chosen on a lot is being paid for above (townGuide's lot payments). None at all: build one.
      if (s.town.lots.some((l) => l.building === 'toyFactory')) return false;
      const lot = s.town.lots.findIndex((l, i) => l.building === '' && lotOffered(s, i));
      const spot = lot >= 0 ? this.level.town.padSpot(lot) : null;
      if (!spot || money < BUSINESSES.toyFactory.cash * 0.6) return false;
      this.setGoal('Build a Toy Factory: the Grand Market needs toys', rect(spot.x, spot.z, 1.8, 1.8), this.tmpPoint.set(spot.x, 0, spot.z));
      return true;
    }
    // every toy is in: logs and cash, once the cash part is in reach
    const cashLeft = def.cash - st.cash;
    if (cashLeft > 0 && money < cashLeft) return false;
    const logsLeft = def.logs - st.logs;
    return this.pursue({
      spot: pad,
      logsLeft,
      cashLeft,
      text: logsLeft > 0 ? 'Bring logs to the Grand Market' : `Pay for the Grand Market (${fmtMoney(cashLeft)})`,
      pick: 'Pick up logs for the Grand Market',
    });
  }

  /** 0.9.6: the unlocked era region the player stands in, or 0 outside every region. */
  private regionHere(): number {
    const s = this.ctx.state;
    const p = this.ctx.player.object.position;
    for (let n = 2; n <= s.eras.age; n++) {
      const r = REGIONS[n]?.rect;
      if (r && p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ) return n;
    }
    return 0;
  }

  /** 0.9.0: the unlocked region the player stands in, else the newest one (null before era 2). */
  private nearRegion(): number {
    const here = this.regionHere();
    if (here) return here;
    const s = this.ctx.state;
    return s.eras.age >= 2 ? s.eras.age : 0;
  }

  /** 0.9.0: era materials in hand → a machine that wants them (nearest region first), else that region's export depot. */
  private eraGoodsInHand(): boolean {
    const s = this.ctx.state;
    if (s.eras.age < 2) return false;
    const arms = this.ctx.player.arms;
    const kind = MATERIAL_KINDS.find((k) => arms.count(k) > 0);
    if (!kind) return false;
    const home = this.nearRegion();
    // 0.9.6: inside a region only that region's machines count (leftover bricks no longer point back to Granite
    // Hollow from the Steam Age); what nothing here wants goes to this region's depot
    const order = this.regionHere() ? [home] : [home, ...Array.from({ length: s.eras.age - 1 }, (_, i) => i + 2).filter((n) => n !== home)];
    for (const n of order) {
      const region = this.level.eras.region(n);
      if (!region) continue;
      for (const m of region.machines) {
        if (!m || m.wants(kind) <= 0) continue;
        this.setGoal(`Feed the ${m.def.label.toLowerCase()}`, rect(m.feedSpot.x, m.feedSpot.z, 1.6, 1.6), this.tmpPoint.set(m.feedSpot.x, 0, m.feedSpot.z));
        return true;
      }
    }
    const region = this.level.eras.region(home);
    if (!region) return false;
    const d = region.depotSpot;
    this.setGoal(`Ship ${MATERIALS[kind].label.toLowerCase()} at the export depot`, rect(d.x, d.z, 1.6, 1.6), this.tmpPoint.set(d.x, 0, d.z));
    return true;
  }

  /**
   * 0.9.0 era hints, only once the climb is open (the Great Lodge) or an era is reached (the Survival guide stays
   * 0.8.0's): the next expansion pad once half its cash is in hand, then the first machine of the newest region.
   */
  private eraGuide(): boolean {
    const s = this.ctx.state;
    if (!climbOpen(s) && s.eras.age < 2) return false;
    const next = s.eras.age + 1;
    const era = ERAS[next];
    if (era && expansionOffered(s, next)) {
      const paid = s.eras.regions[next]!;
      const cashLeft = era.unlock.cash - paid.cash;
      const extraLeft = era.unlock.extra.count - paid.extra;
      if (cashLeft <= 0 || this.ctx.economy.money >= cashLeft * 0.5) {
        const pad = regionLayout(next).expansionPad;
        const what = MATERIALS[era.unlock.extra.kind as keyof typeof MATERIALS]?.label.toLowerCase() ?? `${era.unlock.extra.kind}s`;
        const text = cashLeft > 0 ? `Expand to ${era.region} (${formatMoney(cashLeft)})` : `Bring ${extraLeft} ${what} to ${era.region}`;
        if (cashLeft > 0 || extraLeft > 0) {
          this.setGoal(text, rect(pad.x, pad.z, 2, 2), this.tmpPoint.set(pad.x, 0, pad.z));
          return true;
        }
      }
    }
    // The newest region with nothing chosen on any slot: build its first machine (the extractor).
    const n = s.eras.age;
    if (n < 2 || s.eras.regions[n]!.slots.some((slot) => slot.machine !== '')) return false;
    const first = machinesOfEra(n).find((id) => MACHINES[id].kind === 'extractor') ?? machinesOfEra(n)[0];
    const slot = regionLayout(n).slots[0];
    if (!first || !slot) return false;
    this.setGoal(`Build ${article(MACHINES[first].label)} ${MACHINES[first].label.toLowerCase()} in ${ERAS[n]!.region}`, rect(slot.x, slot.z, 3, 3), this.tmpPoint.set(slot.x, 0, slot.z));
    return true;
  }

  /**
   * 0.9.0 climb (docs/EXPANSION.md §C): the era gate's single next goal (eras/gate.ts nextGoal, the era chip's line)
   * once nothing more urgent is due, with the arrow where it needs walking: a machine's level pad, what unlocks a
   * prereq, the district to build a home in, the cabin's shop mat for a shop row, the era's shop mat for an Industry row
   * (upgrades are hands-on: every level is bought standing on a pad or a mat). Quiet while the expansion pad itself is
   * the goal (eraGuide).
   */
  private climbGuide(): boolean {
    const s = this.ctx.state;
    const n = s.eras.age + 1;
    if (!climbOpen(s) || !hasGate(n) || expansionOffered(s, n)) return false; // 0.9.7: era 10 guides to the final gate too
    const goal = nextGoal(s, this.ctx.economy.money);
    if (!goal) return false;
    const text = goal.hint ?? goal.text;
    const { kind, target } = goal.action;
    if (target.startsWith('pad:')) {
      const pad = PADS[target.slice(4) as PadIdConst];
      if (pad) {
        this.setGoal(text, rect(pad.x, pad.z, pad.size, pad.size));
        return true;
      }
    } else if (target === 'quarters') {
      const q = LAYOUT.ridge.quarters.pad;
      this.setGoal(text, rect(q.x, q.z, 2, 2));
      return true;
    } else if (target.startsWith('district:')) {
      const d = DISTRICTS[Number(target.slice(9))];
      if (d) {
        this.setGoal(text, d.rect);
        return true;
      }
    } else if (target.startsWith('machine:')) {
      const at = machinePadTarget(s, target.slice(8) as UpgradeIdConst);
      if (at) {
        this.setGoal(text, rect(at.pad.x, at.pad.z, at.size, at.size));
        return true;
      }
    } else if (kind === 'buy' && UPGRADES[target as UpgradeIdConst]) {
      const def = UPGRADES[target as UpgradeIdConst];
      const e = eraMatOf(def);
      if (e === null) {
        this.setGoal(text, LAYOUT.shop.mat);
        return true;
      }
      if (e <= s.eras.age) {
        const at = regionLayout(e).shopMat;
        this.setGoal(text, rect(at.x, at.z, MAT_SIZE.w, MAT_SIZE.d));
        return true;
      }
    }
    this.setGoal(text, null);
    return true;
  }

  /**
   * 0.9.10 (READINESS C7): a gentle one-time tip the first time a built machine's MANAGE sign in an era region is near:
   * the arrow points at the sign for MANAGE_HINT_SECONDS, or until a MANAGE card opens. Never again after that.
   */
  private manageHint(here: number): boolean {
    const s = this.ctx.state;
    if (s.flags[MANAGE_HINT_FLAG]) return false;
    const now = this.ctx.time.elapsed;
    if (this.manageHintAt < 0) {
      const region = this.level.eras.region(here);
      const p = this.ctx.player.object.position;
      for (const rt of region?.machines ?? []) {
        // Region's machines are eras/Machine instances (the runtime view leaves the frame out)
        if (!rt || !('frame' in rt)) continue;
        const m = rt as Machine;
        const r = worldRect(m.place, m.place.yaw, m.frame.manage);
        if (Math.hypot((r.minX + r.maxX) / 2 - p.x, (r.minZ + r.maxZ) / 2 - p.z) > MANAGE_HINT_NEAR) continue;
        this.manageSpot = r;
        this.manageHintAt = now;
        break;
      }
      if (!this.manageSpot) return false;
    }
    if (now - this.manageHintAt > MANAGE_HINT_SECONDS || !this.manageSpot) {
      s.flags[MANAGE_HINT_FLAG] = true;
      return false;
    }
    this.setGoal('Tip: step on a MANAGE sign to see or swap a machine', this.manageSpot, undefined, 'Try the MANAGE sign');
    return true;
  }

  /** 0.9.7: the starter guide of the region the player stands in, while it runs (eraStarter.ts). */
  private starterGuide(here: number): boolean {
    const s = this.ctx.state;
    const p = this.ctx.player.object.position;
    const step = this.starter.update(
      GUIDE_INTERVAL,
      {
        here,
        age: s.eras.age,
        started: s.eras.regions[here]?.slots.some((slot) => slot.machine !== '') ?? true,
        flags: s.flags,
        player: { x: p.x, z: p.z },
        carrying: (kind) => this.ctx.player.arms.count(kind),
      },
      (n) => {
        s.flags[starterFlag(n)] = true;
      },
    );
    if (!step) return false;
    if (step.spot) this.setGoal(step.text, rect(step.spot.x, step.spot.z, step.w, step.d), this.tmpPoint.set(step.spot.x, 0, step.spot.z), step.chip);
    else this.setGoal(step.text, null, undefined, step.chip);
    return true;
  }

  private evaluateGuide(): void {
    const ctx = this.ctx;
    const L = this.level;
    const s = ctx.state;
    const money = ctx.economy.money;
    const arms = ctx.player.arms;
    const armsLogs = arms.count('log');
    const armsCrates = arms.count('crate');
    const armsFull = arms.count() >= arms.capacity;
    const trucksWaiting = L.trucks?.waiting ?? 0;
    const inArea = (r: Rect): boolean => ctx.zones.isPlayerIn(r);
    const dropCount = L.dropZone.pile.count('log');
    const padPayable = (pad: (typeof L.pads)[PadId]): boolean =>
      pad.visible && pad.remaining > 0 && (money >= pad.remaining || (inArea(pad.zone.area) && money > 0));

    // 0.9.6 (guide by location): inside an era region its own guide runs first, and Survival's chores (cash piles,
    // logs, the cabin) never drag the arrow back to the yard mid-climb. Quiet when the region has nothing to ask.
    const here = this.regionHere();
    if (here >= 2) {
      if (this.starterGuide(here)) return;
      if (this.eraGoodsInHand() || this.manageHint(here) || this.eraGuide() || this.climbGuide()) return;
      this.setGoal(null, null);
      return;
    }

    // 1. An unlock pad we can pay right now.
    for (const id of PAD_ORDER) {
      const pad = L.pads[id];
      if (!pad.levelMode && padPayable(pad)) {
        const verb = PAD_VERB[id] ?? 'Build the';
        const noun = PAD_NOUN[id] ?? titleCase(pad.def.label);
        this.setGoal(`${verb} ${noun} (${fmtMoney(pad.remaining)})`, pad.zone.area);
        return;
      }
    }

    // 2. Toys in hand → the Grand Market (0.9.2); crates in hand → the toy factory while the Grand Market still needs
    // toys, else the tricycles.
    if (arms.count('toy') > 0 && this.toysLeft() > 0) {
      const gm = VILLAGE.grandMarket;
      const pad = LAYOUT.town.grandMarket.pad;
      this.setGoal(`Bring toys to the Grand Market (${s.town.grandMarket.toys}/${gm.toys})`, rect(pad.x, pad.z, 2.2, 2.2), this.tmpPoint.set(pad.x, 0, pad.z));
      return;
    }
    if (armsCrates > 0) {
      const toys = this.toyFactory();
      if (toys && this.toysLeft() > 0 && toys.input?.canAccept('crate') && toys.feedZone) {
        this.setGoal('Bring crates to the toy factory', toys.feedZone);
        return;
      }
    }
    if (armsCrates > 0 && L.seCounter) {
      this.setGoal('Load the tricycles', L.seCounter.zone.area);
      return;
    }

    // 2a. Wave 8: chairs in hand go to the dog sled counter (skipped while the counter is full: the sleds will empty it).
    const armsChairs = arms.count('furniture');
    const workshop = L.workshop;
    const sledCounter = L.sledCounter;
    if (armsChairs > 0 && sledCounter && sledCounter.pile.canAccept('furniture')) {
      this.setGoal('Carry chairs to the dog sleds', sledCounter.zone.area);
      return;
    }

    // 2c. Wave 9: town goods in hand (wheat, meat) go to a shop that still needs them.
    if (this.townGoodsInHand()) return;
    // 2d. 0.9.0: era materials in hand feed a machine that wants them, else the export depot.
    if (this.eraGoodsInHand()) return;
    // 2e. 0.9.10 (READINESS C3): from era 2 on, Survival's chores (cash piles, crates, chairs, logs, the cabin, the town)
    // never outrank the current era's next step; only what is already in the player's hands comes first.
    if (s.eras.age >= 2 && (this.eraGuide() || this.climbGuide())) return;

    // 2b. Timber Ridge is open but the player has not been through the east gate yet.
    if (s.unlocked.ridge && !s.unlocked.treeFeller && !s.flags['seen:ridge']) {
      if (inArea(LAYOUT.ridge.walk[1]!)) {
        s.flags['seen:ridge'] = true;
      } else {
        const g = LAYOUT.ridge.gate;
        const gate = this.tmpPoint.set(LAYOUT.yard.maxX, 0, (g.minZ + g.maxZ) / 2);
        this.setGoal('Walk through the east gate to Timber Ridge', LAYOUT.ridge.walk[0]!, gate);
        return;
      }
    }

    // 3. Log-and-cash builds. The first bunkhouse tier comes first (it unlocks more crew), then the village (bring
    // logs, pay the shelter, build the Great Lodge), then the later bunkhouse tiers.
    const quarters = this.quartersNeed();
    if (quarters && s.quarters.tier < 0 && this.pursue(quarters)) return;
    // 3a. The pine hauler (needs the tree feller and the bunkhouse): hire it until it is done
    // (above the village so a busy village never starves it).
    if (L.shopMat.visible && !ctx.upgrades.isHired('pineHauler') && ctx.upgrades.canBuy('pineHauler')) {
      this.setGoal('Hire the Pine Hauler at the cabin', LAYOUT.shop.mat);
      return;
    }

    const need = this.villageNeed();
    if (need && this.pursue(need)) return;
    if (quarters && this.pursue(quarters)) return;
    // 3c. Wave 9: the Market Town (first visit, the first building, paying for chosen lots, keeping shops stocked).
    if (this.townGuide()) return;
    // 3d. 0.9.0: the next expansion, the first machine of a new region.
    if (this.eraGuide()) return;

    const deck = L.treeFeller?.deck;
    const deckLogs = deck?.count('log') ?? 0;
    // 3b. The workshop lesson (a one-off: until the first chair exists or the hopper holds a log, for a limited time):
    // logs in hand go into the west hopper. Fetching the logs is the low-priority half (see 5c).
    const feedLesson =
      !!workshop &&
      s.stats.furnitureMade === 0 &&
      workshop.input.count('log') === 0 &&
      workshop.input.canAccept('log') &&
      this.query.sinceUnlock('workshop') < WORKSHOP_LESSON &&
      !ctx.upgrades.isHired('sledLoader'); // 0.9.2: the sled loader fills the hopper itself
    // (not while the player is still loading up at a stocked deck / drop zone)
    const loadingUp =
      armsLogs < PICKUP_STAY_UNTIL &&
      !armsFull &&
      ((deckLogs > 0 && inArea(LAYOUT.ridge.deck.zone)) || (dropCount > 0 && inArea(L.dropZone.zone.area)));
    if (feedLesson && armsLogs > 0 && !loadingUp) {
      this.setGoal('Feed logs to the workshop', LAYOUT.ridge.workshop.hopper.zone);
      return;
    }

    // 4. Pine logs. Keep picking up while standing at a stocked deck; logs in hand on the ridge go to the train.
    const pickingDeck = !!deck && inArea(LAYOUT.ridge.deck.zone) && deckLogs > 0 && !armsFull && armsLogs < PICKUP_STAY_UNTIL;
    if (pickingDeck) {
      this.setGoal('Pick up pine logs', LAYOUT.ridge.deck.zone);
      return;
    }
    // Keep picking up while standing at a stocked drop zone.
    const pickingUp = inArea(L.dropZone.zone.area) && dropCount > 0 && !armsFull && armsLogs < PICKUP_STAY_UNTIL;
    if (armsLogs > 0 && L.platformCounter) {
      // Trains pay the most per log (the platform takes any log): on the ridge always; from the yard only as the
      // first nudge, until the feller is built and the platform has a few logs to sell.
      const onRidge = inArea(LAYOUT.ridge.area);
      const nudge = !pickingUp && !s.unlocked.treeFeller && L.platformCounter.pile.count('log') < 8;
      if (onRidge || nudge) {
        this.setGoal('Load the freight train', L.platformCounter.zone.area);
        return;
      }
    }

    // 4b. Logs in hand.
    if (armsLogs > 0 && !pickingUp) {
      const proc = L.processor;
      if (s.phase === 'expansion' && L.truckCounter && trucksWaiting > 0 && !L.truckLoader) {
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

    // 5. Cash waiting (the bigger pile first).
    // Once the cash tubes or a cashier bank the piles, only point at a big backlog.
    let pile = L.walkInCash;
    for (const p of [...L.cashPiles(), ...L.town.tills()]) if (p.value > pile.value) pile = p;
    if (pile.value > (L.cashTubes || ctx.upgrades.isHired('cashier') ? CASH_BACKLOG : 0)) {
      this.setGoal('Walk over the cash to bank it', pile.zone.area); // 0.9.10 (C8): banking is walking over it
      return;
    }

    // 5a. Chairs waiting on the workshop bench (the counter must have room, or the trip would be pointless).
    if (workshop && sledCounter && !armsFull && !ctx.upgrades.isHired('sledLoader') && workshop.output.count('furniture') > 0 && sledCounter.pile.canAccept('furniture')) {
      this.setGoal('Grab the chairs for the dog sleds', LAYOUT.ridge.workshop.bench.zone);
      return;
    }

    // 5c. The workshop lesson, fetching half: the nearest stocked log pile to the hopper (the deck first on the ridge).
    if (feedLesson && !armsFull) {
      const hopper = LAYOUT.ridge.workshop.hopper;
      const sources: Rect[] = [];
      if (deckLogs > 0) sources.push(LAYOUT.ridge.deck.zone);
      if (dropCount > 0) sources.push(L.dropZone.zone.area);
      const dist = (a: Rect): number => Math.hypot((a.minX + a.maxX) / 2 - hopper.x, (a.minZ + a.maxZ) / 2 - hopper.z);
      sources.sort((a, b) => dist(a) - dist(b));
      if (sources[0]) {
        this.setGoal('Pick up logs for the workshop', sources[0]);
        return;
      }
    }

    // 5b. Pine logs waiting on the deck and nobody hired to haul them.
    if (deckLogs >= 4 && !armsFull && L.platformCounter && !ctx.upgrades.isHired('pineHauler')) {
      this.setGoal('Carry pine logs to the train', LAYOUT.ridge.deck.zone);
      return;
    }

    // 6. Crates ready on the workbench.
    if (L.processor && !armsFull && !ctx.upgrades.isHired('crateRunner') && L.processor.output.count('crate') > 0) {
      this.setGoal('Grab the crates', L.processor.outputZone.area);
      return;
    }

    // 6b. 0.9.0 climb: the era gate's next goal (it covers the cabin reminder and the machine level pads below).
    if (this.climbGuide()) return;

    // 7. The cabin shop, when something is affordable (first visit, then a reminder now and then).
    if (L.shopMat.visible && L.shopMat.hasAffordable) {
      const due = !s.flags.shopVisited || ctx.time.elapsed - this.lastShopVisit > SHOP_REMINDER;
      if (due) {
        this.setGoal('Visit the cabin to upgrade', LAYOUT.shop.mat);
        return;
      }
    }

    // 8. A machine level pad we can pay.
    for (const id of PAD_ORDER) {
      const pad = L.pads[id];
      if (pad.levelMode && padPayable(pad)) {
        this.setGoal(`Upgrade the ${titleCase(pad.def.label)} (${fmtMoney(pad.remaining)})`, pad.zone.area);
        return;
      }
    }

    // 9. Logs waiting in the drop zone (unless both belts carry them away).
    const belts = !!L.westConveyor && !!L.eastConveyor;
    const chopping = inArea(L.giantLog.chopZone.area) && !L.dropZone.isFull && dropCount < 4 && !s.unlocked.harvester;
    if ((!belts || (trucksWaiting > 0 && !L.truckLoader)) && !ctx.upgrades.isHired('logHauler') && !armsFull && dropCount > 0 && !chopping) {
      this.setGoal('Pick up the logs', L.dropZone.zone.area);
      return;
    }

    // 10. Nothing in the yard yet: chop (only until the harvester does it for us).
    if (!s.unlocked.harvester && !L.dropZone.isFull) {
      this.setGoal('Chop the giant log!', L.giantLog.chopZone.area);
      return;
    }

    // Everything runs by itself: quiet.
    this.setGoal(null, null);
  }
}

function flagOf(rule: RevealRule): FlagId {
  return rule.flag ?? `reveal:${rule.id}`;
}
