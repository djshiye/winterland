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
 * - Guide (re-evaluated ~4×/s): one objective at a time via ctx.hud.setObjective(text) +
 *   ctx.hud.setGuideTarget(world point) — chop → pick up → sell → collect cash → build pad → feed the
 *   processor → grab the crates → load the tricycles / trucks. The arrow is hidden while the player already
 *   stands in the target zone; the guide goes quiet once everything is automated.
 */
import * as THREE from 'three';
import { LAYOUT, QUARTERS, VILLAGE, rect, type Rect, type XZ } from '../config';
import type { FlagId, GameContext, PadId, Phase } from '../core/types';
import type { Level } from '../level/Level';
import { REVEALS, type RevealAction, type RevealQuery, type RevealRule } from './reveals';

const GUIDE_INTERVAL = 0.25;
/** Minimum time an objective stays on screen before it may change. */
const GUIDE_DWELL = 0.7;
const PICKUP_STAY_UNTIL = 6;
/** Seconds between "visit the cabin" reminders once the shop has been visited. */
const SHOP_REMINDER = 120;
const RULE_INTERVAL = 0.2;
/** With the cash tubes built, "Collect your cash" only shows for a pile worth at least this much. */
const CASH_BACKLOG = 300;

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
  private objective: string | null = null;
  private objectiveSince = -10;
  private readonly guidePoint = new THREE.Vector3();
  private readonly tmpPoint = new THREE.Vector3();

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
    ctx.events.on('shop:close', () => {
      this.lastShopVisit = ctx.time.elapsed;
    });
    ctx.events.on('village:levelUp', ({ level }) => {
      if (level === VILLAGE.greatLodge.requiresLevel) this.onGreatLodgeOffered();
    });
    ctx.events.on('shelter:built', ({ plot }) => {
      if (plot < 0) this.onFinale();
    });

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
      const hold = id === 'megaSaw' ? 2.0 : id === 'treeFeller' ? 1.0 : 1.4;
      this.ctx.cameraRig.focus(anchor, { duration: id === 'treeFeller' ? 0.7 : 0.8, hold });
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

  /** The Great Lodge is complete: the finale. */
  private onFinale(): void {
    const flags = this.ctx.state.flags;
    if (flags.finale) return;
    flags.finale = true;
    const g = LAYOUT.village.greatLodge;
    const at = new THREE.Vector3(g.x, 0, g.z);
    this.ctx.events.emit('finale:start', { position: at.clone() });
    if (this.intro === 'done') this.ctx.cameraRig.focus(at, { duration: 1.0, hold: 3.0 });
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

    // 2. Crates in hand → tricycles.
    if (armsCrates > 0 && L.seCounter) {
      this.setGoal('Load the tricycles', L.seCounter.zone.area);
      return;
    }

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

    // 4. Pine logs. Keep picking up while standing at a stocked deck; logs in hand on the ridge go to the train.
    const deck = L.treeFeller?.deck;
    const deckLogs = deck?.count('log') ?? 0;
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
    // Once the cash tubes bank the piles themselves, only point at a big backlog.
    let pile = L.walkInCash;
    for (const p of L.cashPiles()) if (p.value > pile.value) pile = p;
    if (pile.value > (L.cashTubes ? CASH_BACKLOG : 0)) {
      this.setGoal('Collect your cash', pile.zone.area);
      return;
    }

    // 5b. Pine logs waiting on the deck and nobody hired to haul them.
    if (deckLogs >= 4 && !armsFull && L.platformCounter && !ctx.upgrades.isHired('pineHauler')) {
      this.setGoal('Carry pine logs to the train', LAYOUT.ridge.deck.zone);
      return;
    }

    // 6. Crates ready on the workbench.
    if (L.processor && !armsFull && L.processor.output.count('crate') > 0) {
      this.setGoal('Grab the crates', L.processor.outputZone.area);
      return;
    }

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
    if ((!belts || (trucksWaiting > 0 && !L.truckLoader)) && !armsFull && dropCount > 0 && !chopping) {
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
