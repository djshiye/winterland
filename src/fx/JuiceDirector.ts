/**
 * [B4 — juice & HUD] Turns game events into feel: sounds, particles, floating text, camera shake.
 * Gameplay code only emits events (types.ts GameEvents); this class decides how they look and sound,
 * so juice can be tuned in one place. Holders are identified by identity (holder === ctx.player.arms),
 * with the 'pad:' id prefix as the fallback for pads.
 *
 * Mapping:
 * - item:landed → into player arms: 'pop' (combo); into player back (cash): 'cash' (combo) + tiny
 *   sparkle; into a pad: nothing (pad:paid handles it); anything else: soft rate-limited 'drop'.
 * - player:chopHit → 'chop', wood-chip burst, shake ~0.04.
 * - log:chopped (harvester / megaSaw) → small chip burst + quiet 'chop'.
 * - crate:made → sparkle + 'machine'.
 * - sale → 'sell' + floatText "+$<amount>" in green above the position.
 * - stack:full → 'full' + floatText "FULL" over counters/hoppers (throttled). The player's own stack
 *   already wears a persistent MAX badge (CarryStack), so it only gets the sound.
 * - pad:paid / construction:paid (cash) → a soft 'tick' whose pitch climbs a pentatonic ladder while the player keeps
 *   paying the same pad (fx/padJuice.ts TickLadder, ±3 % jitter, at most one per TICK_GAP per pad);
 *   pad:complete (any pad, the shop mat) → a warm 'padDone' chord and a cozy snow-sparkle pop (pooled particles;
 *   skipped / shrunk under reduced motion); pad:unlocked → 'unlock', confetti, ring, shake, toast.
 * - built → 'build', puff + ring.
 * - intro:crash → 'crash' + 'splash', splash particles, big shake.
 *
 * Full-game events:
 * - upgrade:bought → 'upgrade', sparkles at the pad / machine (or around the player for shop buys), "LV n!"
 *   (crew level 1 is the hire: 'helper:hired' does the cheer + "HIRED!").
 * - construction:paid → light wood 'thunk' (logs) / the pad 'tick' ladder (cash), throttled.
 * - shelter:built → pop + dust ring + chime + "+N villagers".
 * - village:revealed / reveal → whoosh / soft chime + toast. village:levelUp → fanfare, confetti, toast with perks.
 * - finale:start → fanfare, a volley of firework rockets for ~4 s (the stats card is the HUD's job).
 * - finale2:start (wave 13, the Grand Market opens) → the same, smaller: fanfare, confetti, ~3 s of rockets over the market.
 * - offline:collected → cash burst + coin sounds.
 *
 * Wave 7 (Timber Ridge):
 * - tree:felled → snow puff + wood crack / thud, only when the tree is on screen or near the player, throttled
 *   (trees fall every few seconds). quarters:built → like shelter:built plus fanfare, confetti and the "More crew can
 *   work now" toast. sale from a 'train' → the usual sale sound / popup plus a train whistle (rate-limited in Audio).
 *
 * 0.9.0 climb: gate:progress → a tiny 'ding-ding' per finished row (up to 3), a toast every 5 rows, confetti every 10 %, the fanfare and a camera
 * look at the expansion pad when the gate is met.
 *
 * Wave 8: quest:done → 'quest' chime, "Quest complete!" toast and a coin burst flying to the money pill (HUD.coinBurst);
 * rush:start → service bell; sale with vip → gold "+$tip TIP!" popup (floatText) + sparkle; night:start / day:start →
 * softer music at night (AudioFX.setNight); haptics (fx/Haptics.ts) for pad unlocks, upgrades and cash pickups.
 * The workshop's chairs (no event of its own): an 'item:landed' on 'pile:workshopOut' → saw-whirr + sawdust
 * (throttled, near or on screen only); a 'sale' from a dog sled adds a happy "woof".
 * 'stack:full' from upgrade / construction pads ('pad:' ids) is ignored.
 */
import * as THREE from 'three';
import { AMENITIES, LAYOUT, PADS, PALETTE, QUARTERS, SETTLEMENT, UPGRADES, VILLAGE } from '../config';
import { townHappiness } from '../core/demand';
import type { GameContext, ItemHolder } from '../core/types';
import { contractClock, contractItem } from '../core/Contracts';
import { formatMoney } from '../ui/format';
import { expansionCostText } from '../ui/agesLogic';
import { ERAS, MATERIALS } from '../eras/data';
import { ERA_NODES } from '../assets/eraNodes';
import { regionLayout } from '../eras/layout';
import { Haptics } from './Haptics';
import { TickLadder, burstCount, motionScale, pitchJitter } from './padJuice';

/** 0.9.5: strike pitch per era hand node (heavier tools lower: slag hammer, oil auger; crystals higher). */
const NODE_PITCH: Record<number, number> = { 2: 0.9, 3: 1.0, 4: 0.85, 5: 0.75, 6: 1.1, 7: 0.8, 8: 1.25, 9: 1.3, 10: 1.4 };

const WOOD_CHIPS = [PALETTE.bark, PALETTE.barkDark, PALETTE.woodEnd, PALETTE.woodRing, PALETTE.plank];
const SNOW = [0xffffff, 0xeaf4ff, 0xd4e6fa];
const SAWDUST = [PALETTE.woodEnd, PALETTE.woodRing, 0xf6e3bd];
const CASH_COLORS = [0x46c35f, 0x5ee07a, 0xffd84a, 0xffffff];
/** The completion pop: snow, frost and a touch of candle gold. */
const SNOW_SPARKLE = [0xffffff, 0xeaf4ff, 0xd4e6fa, 0xfff1c4];
/** Minimum seconds between two audible pad ticks of the same pad (bundles land ~20 per second). */
const TICK_GAP = 0.07;
/** Firework shell colours: [main, inner]. */
const FIREWORKS: Array<[number, number]> = [
  [0xff4d6d, 0xffd1dc],
  [0xffc43d, 0xffffff],
  [0x5ee07a, 0xd8ffe2],
  [0x3fa7ff, 0xcdeeff],
  [0xb066ff, 0xf0dcff],
  [0xff8a3d, 0xffe2c4],
];

export class JuiceDirector {
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly tmp4 = new THREE.Vector3();
  private readonly lastFull = new Map<ItemHolder, number>();
  private lastSparkle = 0;
  private lastDropFx = 0;
  private lastPadFx = 0;
  private lastFell = -10;
  private lastSaw = -10;
  /** Per pad holder id: the rising tick ladder and the last audible tick. */
  private readonly ticks = new Map<string, { ladder: TickLadder; last: number }>();
  /** Delayed one-shots (simulation time), e.g. the splash a beat after the crash. */
  private readonly pending: Array<{ at: number; fn: () => void }> = [];

  constructor(readonly ctx: GameContext) {
    const ev = ctx.events;

    ev.on('item:landed', (e) => {
      const { holder, position } = e;
      if (holder === ctx.player.arms) {
        ctx.audio.play('pop', { combo: true, volume: 0.9 });
      } else if (holder === ctx.player.back) {
        ctx.audio.play('cash', { combo: true });
        if (ctx.time.elapsed - this.lastSparkle > 0.12) {
          this.lastSparkle = ctx.time.elapsed;
          ctx.particles.sparkle(position, PALETTE.accent);
        }
      } else if (holder.id.startsWith('pad:')) {
        // handled by 'pad:paid'
      } else if (holder.id === 'pile:workshopOut' && e.item.kind === 'furniture') {
        // a chair popped out onto the workshop bench (the workshop emits no event of its own)
        this.chairMade();
      } else if (holder.id === 'npc:crew:deposit') {
        // the cashier banking bundles at the cabin door: a softer, lower "ching"
        ctx.audio.play('cash', { combo: true, volume: 0.45, pitch: 0.85 });
        if (ctx.time.elapsed - this.lastSparkle > 0.2) {
          this.lastSparkle = ctx.time.elapsed;
          ctx.particles.sparkle(position, PALETTE.accent);
        }
      } else if (ctx.time.elapsed - this.lastDropFx > 0.09) {
        this.lastDropFx = ctx.time.elapsed;
        ctx.audio.play('drop', { volume: 0.55, pitch: 0.9 + Math.random() * 0.25 });
      }
    });

    ev.on('player:chopHit', (e) => {
      if (e.node !== undefined) {
        // 0.9.5 era hand node: the era's material flies off in chips, a soft tool strike (pitch per era)
        const m = MATERIALS[ERA_NODES[e.node]?.yields ?? 'stone'];
        ctx.audio.play('strike', { pitch: (NODE_PITCH[e.node] ?? 1) * (0.95 + Math.random() * 0.1) });
        ctx.particles.burst(e.position, { colors: [m.color, m.accent, m.color], count: 8, speed: 3.8, size: 0.18, spread: 1.0, life: 0.65, shape: 'cube', gravity: 9 });
        ctx.particles.burst(e.position, { colors: [0xffffff, 0xe8f0f8], count: 4, speed: 2, size: 0.12, spread: 1.4, life: 0.5 });
        ctx.cameraRig.shake(0.03, 0.1);
        return;
      }
      ctx.audio.play('chop', { pitch: 0.95 + Math.random() * 0.12 });
      ctx.particles.burst(e.position, { colors: WOOD_CHIPS, count: 9, speed: 4.2, size: 0.2, spread: 1.0, life: 0.7 });
      ctx.particles.burst(e.position, { colors: SAWDUST, count: 4, speed: 2.2, size: 0.12, spread: 1.4, life: 0.5, shape: 'cube', gravity: 8 });
      ctx.cameraRig.shake(0.04, 0.12);
    });

    ev.on('log:chopped', (e) => {
      if (e.source === 'player') return; // the axe hit already made noise
      ctx.audio.play('chop', { volume: 0.35, pitch: 1.15 });
      ctx.particles.burst(e.position, { colors: WOOD_CHIPS, count: 6, speed: 3.2, size: 0.17, spread: 1.0, life: 0.6 });
    });

    ev.on('crate:made', (e) => {
      ctx.particles.sparkle(e.position, 0xfff1a8);
      ctx.particles.sparkle(this.tmp.copy(e.position).setY(e.position.y + 0.3), 0xffffff);
      ctx.audio.play('machine', { volume: 0.7 });
    });

    ev.on('sale', (e) => {
      ctx.audio.play('sell');
      this.tmp.copy(e.position);
      this.tmp.y += 1.8;
      ctx.hud.floatText(this.tmp, `+${formatMoney(e.amount)}`, { color: '#5ee07a', size: 28 });
      ctx.particles.sparkle(e.position, 0xaaffbb);
      if (e.buyer === 'train') ctx.audio.play('whistle', { volume: 0.7 });
      else if (e.buyer === 'sled') ctx.audio.play('woof', { pitch: 0.95 + Math.random() * 0.15, volume: 0.9 });
      if (e.vip && e.tip && e.tip > 0) {
        // VIP: a gold tip popup above the normal "+$" one (same world-to-screen float mechanism)
        ctx.audio.play('sparkle');
        ctx.hud.floatText(this.tmp.copy(e.position).setY(e.position.y + 3.5), `+${formatMoney(e.tip)} TIP!`, {
          color: '#ffd84a',
          size: 32,
          duration: 1.5,
          rise: 1.7,
        });
        ctx.particles.sparkle(this.tmp2.copy(e.position).setY(e.position.y + 1.4), 0xffe066);
        ctx.particles.sparkle(this.tmp2.setY(e.position.y + 2.2), 0xffffff);
      }
    });

    ev.on('stack:full', (e) => {
      if (e.holder.id.startsWith('pad:')) return; // upgrade / construction pads: no FULL spam
      const now = ctx.time.elapsed;
      if (now - (this.lastFull.get(e.holder) ?? -10) < 0.9) return;
      this.lastFull.set(e.holder, now);
      ctx.audio.play('full');
      if (e.holder === ctx.player.arms) return; // the CarryStack MAX badge says it already
      this.tmp.copy(e.position);
      this.tmp.y += 1.2;
      ctx.hud.floatText(this.tmp, 'FULL', { color: '#ff9a2e', size: 26, duration: 1.0 });
    });

    ev.on('pad:paid', (e) => {
      this.padTick(`pad:${e.id}`, 1);
    });

    ev.on('pad:complete', (e) => {
      ctx.audio.play('padDone', { pitch: pitchJitter(), volume: 0.85 });
      const at = this.tmp.copy(e.position).setY(e.position.y + 0.35);
      const n = burstCount(16);
      if (n > 0) {
        ctx.particles.burst(at, { colors: SNOW_SPARKLE, count: n, speed: 3.4, size: 0.13, spread: 1.15, life: 0.85, gravity: 5, shape: 'sphere' });
      }
      ctx.particles.sparkle(this.tmp2.copy(at).setY(at.y + 0.5), 0xffffff);
      if (motionScale() >= 1) {
        ctx.particles.sparkle(this.tmp2.setY(at.y + 1.1), 0xfff1c4);
        ctx.particles.ring(e.position, { color: 0xffffff, radius: 2.2, life: 0.5 });
      }
    });

    ev.on('pad:unlocked', (e) => {
      ctx.audio.play('unlock');
      this.tmp.copy(e.position);
      const m = motionScale();
      const confetti = burstCount(60 * m);
      if (confetti > 0) ctx.particles.confetti(this.tmp, confetti);
      ctx.particles.ring(this.tmp, { color: PALETTE.padFill, radius: 4, life: 0.7 });
      ctx.particles.ring(this.tmp, { color: 0xffffff, radius: 2.6, life: 0.5 });
      ctx.cameraRig.shake(0.25 * m, 0.3);
      const label = PADS[e.id]?.label ?? String(e.id).toUpperCase();
      ctx.hud.toast(`${label} UNLOCKED!`);
    });

    ev.on('built', (e) => {
      ctx.audio.play('build');
      ctx.particles.puff(e.position, { count: 8, size: 0.9, life: 0.9 });
      ctx.particles.ring(e.position, { color: 0xffffff, radius: 3.2, life: 0.6 });
      ctx.particles.burst(e.position, { colors: SAWDUST, count: 10, speed: 4, size: 0.2, spread: 1.3, shape: 'cube' });
    });

    // ------------------------------------------------------------------------------------------------
    // Full game
    // ------------------------------------------------------------------------------------------------

    ev.on('upgrade:bought', (e) => {
      const crewHire = UPGRADES[e.id].group === 'crew' && e.level === 1;
      const at = e.position ? this.tmp2.copy(e.position) : this.playerSpot(this.tmp2);
      ctx.audio.play('upgrade');
      ctx.particles.sparkle(this.tmp.copy(at).setY(at.y + 0.6), 0xfff1a8);
      ctx.particles.sparkle(this.tmp.copy(at).setY(at.y + 1.6), 0xffffff);
      ctx.particles.sparkle(this.tmp.copy(at).setY(at.y + 2.4), 0xffe066);
      ctx.particles.ring(at, { color: 0xffe066, radius: 2.4, life: 0.55 });
      if (crewHire) return; // 'helper:hired' says HIRED! when the new worker walks out
      // one numbering everywhere (the pads, the shop, the era checklist): the shown level
      ctx.hud.floatText(this.tmp.copy(at).setY(at.y + 2.6), `LV ${ctx.upgrades.shownLevel(e.id)}!`, { color: '#ffd84a', size: 32, duration: 1.2, rise: 1.6 });
      // 0.9.5: Lv 10 is the top of every upgrade (or the era cap in 'offset' mode)
      if (ctx.upgrades.atEraCap(e.id)) {
        ctx.hud.floatText(this.tmp.copy(at).setY(at.y + 3.5), 'Max for this era', { color: '#bfe6ff', size: 22, duration: 2.2, rise: 1.2 });
      } else if (ctx.upgrades.isMax(e.id)) {
        ctx.hud.floatText(this.tmp.copy(at).setY(at.y + 3.5), 'Max level!', { color: '#bfe6ff', size: 22, duration: 2.2, rise: 1.2 });
      }
    });

    ev.on('helper:hired', (e) => {
      ctx.audio.play('cheer');
      ctx.particles.confetti(this.tmp.copy(e.position), 30);
      ctx.particles.sparkle(this.tmp.copy(e.position).setY(e.position.y + 1.4), 0xffffff);
      ctx.hud.floatText(this.tmp.copy(e.position).setY(e.position.y + 2.6), 'HIRED!', { color: '#5ee07a', size: 34, duration: 1.4, rise: 1.6 });
    });

    ev.on('construction:paid', (e) => {
      const now = ctx.time.elapsed;
      if (now - this.lastPadFx < 0.06) return; // a burst of bundles must not machine-gun
      this.lastPadFx = now;
      if (e.kind === 'log') {
        ctx.audio.play('thunk', { combo: true, pitch: 0.95 + Math.random() * 0.1, volume: 0.9 });
        ctx.particles.burst(e.position, { colors: SAWDUST, count: 3, speed: 2.2, size: 0.1, spread: 1.2, life: 0.4, shape: 'cube' });
      } else {
        this.padTick(`pad:${e.key}`, 0.9);
        ctx.particles.sparkle(e.position, 0xaaffbb);
      }
    });

    ev.on('shelter:built', (e) => {
      ctx.audio.play('pop', { pitch: 0.7, volume: 1 });
      ctx.audio.play('chime', { volume: 0.8 });
      ctx.particles.puff(e.position, { count: 9, size: 1.0, life: 1.0 });
      ctx.particles.ring(e.position, { color: 0xffffff, radius: 3.6, life: 0.65 });
      ctx.particles.ring(e.position, { color: PALETTE.padFill, radius: 2.4, life: 0.5 });
      ctx.particles.burst(e.position, { colors: SAWDUST, count: 12, speed: 4.5, size: 0.2, spread: 1.3, shape: 'cube' });
      ctx.cameraRig.shake(0.1, 0.2);
      if (e.plot >= 0) {
        const tier = VILLAGE.tiers[e.tier];
        const prev = e.tier > 0 ? VILLAGE.tiers[e.tier - 1] : undefined;
        if (tier) {
          const n = tier.residents - (prev?.residents ?? 0);
          this.tmp.copy(e.position).setY(e.position.y + 3);
          ctx.hud.floatText(this.tmp, `+${n} villagers`, { color: '#bfe8ff', size: 28, duration: 1.5, rise: 1.8 });
        }
      }
    });

    ev.on('village:revealed', (e) => {
      ctx.audio.play('whoosh');
      ctx.audio.play('chime', { volume: 0.7 });
      ctx.particles.sparkle(this.tmp.copy(e.position).setY(e.position.y + 1), 0xffffff);
      ctx.hud.toast('The village is open!', { sub: 'Build shelters for your workers' });
    });

    ev.on('reveal', (e) => {
      const what = e.what;
      if (what === 'village') return; // 'village:revealed' covers it
      ctx.audio.play('chime');
      if (e.position) ctx.particles.sparkle(this.tmp.copy(e.position).setY(e.position.y + 1), 0xfff1a8);
      if (what === 'shop') {
        ctx.hud.toast('Upgrade shop open!', { sub: 'Step on the mat by the cabin' });
      } else if (what.startsWith('levelPad:')) {
        // four machines reveal their pad over a game: say it once
        if (!ctx.state.flags['seen:levelPadToast']) {
          ctx.state.flags['seen:levelPadToast'] = true;
          ctx.hud.toast('Machine upgrades!', { sub: 'Step on a machine\u2019s level pad' });
        }
      } else if (what === 'greatLodge') {
        ctx.hud.toast('The Great Lodge awaits!', { sub: 'Build it at the end of the street' });
      }
    });

    // ------------------------------------------------------------------------------------------------
    // Wave 7: Timber Ridge
    // ------------------------------------------------------------------------------------------------

    ev.on('tree:felled', (e) => {
      const now = ctx.time.elapsed;
      if (now - this.lastFell < 0.45) return;
      // only worth the sound and particles when the player can see or is near it
      const near = ctx.cameraRig.isOnScreen(e.position, 24) || ctx.player.position.distanceTo(e.position) < 14;
      if (!near) return;
      this.lastFell = now;
      ctx.audio.play('timber', { pitch: 0.92 + Math.random() * 0.16, volume: 0.85 });
      const at = this.tmp.copy(e.position);
      at.y = Math.max(0, at.y) + 0.3;
      ctx.particles.puff(at, { color: 0xffffff, count: 5, size: 0.85, life: 0.9 });
      ctx.particles.burst(at, { colors: SNOW, count: 10, speed: 3.2, size: 0.16, spread: 1.4, life: 0.7, gravity: 6, shape: 'sphere' });
    });

    ev.on('quarters:built', (e) => {
      ctx.audio.play('pop', { pitch: 0.7, volume: 1 });
      ctx.audio.play('fanfare', { volume: 0.85 });
      ctx.particles.puff(e.position, { count: 9, size: 1.0, life: 1.0 });
      ctx.particles.ring(e.position, { color: 0xffffff, radius: 3.6, life: 0.65 });
      ctx.particles.ring(e.position, { color: PALETTE.padFill, radius: 2.4, life: 0.5 });
      ctx.particles.burst(e.position, { colors: SAWDUST, count: 12, speed: 4.5, size: 0.2, spread: 1.3, shape: 'cube' });
      ctx.particles.confetti(this.tmp2.copy(e.position), 60);
      this.later(0.25, () => ctx.particles.confetti(this.tmp3.copy(e.position), 36));
      ctx.cameraRig.shake(0.12, 0.22);
      const tier = QUARTERS.tiers[e.tier];
      ctx.hud.toast(tier ? tier.label : 'Crew quarters', { sub: 'More crew can work now', duration: 3 });
    });

    // Wave 12: an amenity opens on the square: cheer, confetti, a ring, and the new happiness.
    ev.on('amenity:built', (e) => {
      ctx.audio.play('chime');
      ctx.audio.play('cheer');
      ctx.particles.confetti(this.tmp.copy(e.position), 50);
      ctx.particles.ring(e.position, { color: 0xffe066, radius: 3.4, life: 0.7 });
      this.later(0.25, () => ctx.particles.confetti(this.tmp2.copy(e.position), 30));
      ctx.cameraRig.shake(0.1, 0.2);
      const pct = Math.round(townHappiness(ctx.state) * 100);
      ctx.hud.toast(`${AMENITIES[e.id].label} built \u00b7 happiness \u2665 ${pct}%`, { duration: 3 });
    });

    ev.on('village:levelUp', (e) => {
      ctx.audio.play('fanfare');
      this.tmp.copy(e.position);
      ctx.particles.confetti(this.tmp, 70);
      ctx.particles.ring(this.tmp, { color: PALETTE.padFill, radius: 5, life: 0.8 });
      ctx.particles.ring(this.tmp, { color: 0xffffff, radius: 3, life: 0.55 });
      ctx.cameraRig.shake(0.2, 0.3);
      this.later(0.25, () => ctx.particles.confetti(this.tmp2.copy(e.position), 40));
      // The era card (ui/EraCard.ts) names the new era and its perks; no toast on top of it.
    });

    // 0.9.0 settlement 6..50: the card (ui/EraCard.ts) names the level; a chime (a fanfare for a Charter) and confetti
    // over the city gift pile, where the gift lands.
    ev.on('settlement:levelUp', (e) => {
      ctx.audio.play(e.charter ? 'fanfare' : 'chime');
      this.tmp.set(SETTLEMENT.giftPile.x, 0, SETTLEMENT.giftPile.z);
      ctx.particles.confetti(this.tmp, e.charter ? 70 : 40);
      ctx.particles.ring(this.tmp, { color: PALETTE.padFill, radius: 3, life: 0.7 });
      if (e.charter) ctx.cameraRig.shake(0.15, 0.25);
    });

    // 0.9.0 climb (docs/EXPANSION.md §C rewards): the era checklist moves ('gate:progress', eras/GateTracker.ts). A soft
    // tick per finished row (the era chip pulses itself), a small toast every 5 rows, mini-confetti at each 10 % of the
    // list; the gate met: fanfare, a camera look at the expansion pad and "Iron Ridge is for sale!".
    ev.on('gate:progress', (e) => {
      const era = ERAS[e.era];
      if (!era) return;
      // a tiny "ding-ding" per row that turned green (a few at most, each a pentatonic step higher)
      for (let i = 0; i < Math.min(e.gained, 3); i++) this.later(i * 0.26, () => ctx.audio.play('ding', { pitch: pitchJitter() * Math.pow(2, (i * 2) / 12), volume: 0.8 }));
      if (e.gained > 0 && !e.ready) {
        const before = e.ok - e.gained;
        if (Math.floor(e.ok / 5) > Math.floor(before / 5)) {
          ctx.hud.toast(`${e.ok}/${e.total} upgrades ready`, { sub: `${e.total - e.ok} more to open ${era.region}`, small: true, duration: 2.4 });
        }
        if (Math.floor((e.ok * 10) / e.total) > Math.floor((before * 10) / e.total)) ctx.particles.confetti(this.playerSpot(this.tmp), 24);
      }
      if (e.readyNow) {
        const pad = regionLayout(e.era).expansionPad;
        const at = new THREE.Vector3(pad.x, 0, pad.z);
        ctx.audio.play('fanfare');
        ctx.particles.confetti(this.playerSpot(this.tmp), 50);
        this.later(0.9, () => {
          ctx.particles.confetti(this.tmp2.copy(at), 60);
          ctx.particles.ring(at, { color: 0xffd84a, radius: 3.4, life: 0.8 });
        });
        ctx.cameraRig.focus(at, { duration: 0.8, hold: 1.8 });
        ctx.hud.toast(`${era.region} is for sale!`, { sub: expansionCostText(e.era), duration: 3.4 });
      }
    });

    ev.on('finale:start', (e) => {
      const center = new THREE.Vector3().copy(e.position);
      ctx.audio.play('fanfare');
      ctx.particles.confetti(center, 90);
      ctx.particles.ring(center, { color: 0xffd84a, radius: 6, life: 0.9 });
      ctx.cameraRig.shake(0.3, 0.4);
      // ~4 s of rockets over the Great Lodge
      const salvos = 14;
      for (let i = 0; i < salvos; i++) {
        this.later(0.2 + (i / salvos) * 3.6 + Math.random() * 0.15, () => {
          const [c1, c2] = FIREWORKS[(Math.random() * FIREWORKS.length) | 0]!;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 7;
          const from = this.tmp3.set(center.x + Math.cos(a) * r, center.y, center.z + Math.sin(a) * r);
          ctx.audio.play('whoosh', { volume: 0.35, pitch: 1.3 });
          ctx.particles.rocket(from, {
            height: 8 + Math.random() * 4,
            color: c1,
            color2: c2,
            drift: this.tmp4.set((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3),
            onBurst: () => ctx.audio.play('firework', { pitch: 0.85 + Math.random() * 0.4 }),
          });
        });
      }
      this.later(1.2, () => ctx.particles.confetti(this.tmp2.copy(center), 60));
      this.later(2.6, () => ctx.audio.play('fanfare', { pitch: 1.12, volume: 0.8 }));
    });

    // Wave 13: the Grand Market opens, a second, smaller fireworks show over the south-east corner of the square
    ev.on('finale2:start', (e) => {
      const center = new THREE.Vector3().copy(e.position);
      ctx.audio.play('fanfare');
      ctx.particles.confetti(center, 70);
      ctx.particles.ring(center, { color: 0xffd84a, radius: 5, life: 0.9 });
      ctx.cameraRig.shake(0.25, 0.35);
      const salvos = 10;
      for (let i = 0; i < salvos; i++) {
        this.later(0.2 + (i / salvos) * 3.0 + Math.random() * 0.15, () => {
          const [c1, c2] = FIREWORKS[(Math.random() * FIREWORKS.length) | 0]!;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 4.5;
          const from = this.tmp3.set(center.x + Math.cos(a) * r, center.y, center.z + Math.sin(a) * r);
          ctx.audio.play('whoosh', { volume: 0.35, pitch: 1.3 });
          ctx.particles.rocket(from, {
            height: 7 + Math.random() * 4,
            color: c1,
            color2: c2,
            drift: this.tmp4.set((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3),
            onBurst: () => ctx.audio.play('firework', { pitch: 0.85 + Math.random() * 0.4 }),
          });
        });
      }
      this.later(1.0, () => ctx.particles.confetti(this.tmp2.copy(center), 50));
      this.later(2.2, () => ctx.audio.play('fanfare', { pitch: 1.2, volume: 0.8 }));
    });

    ev.on('offline:collected', (e) => {
      this.cashBurst(this.playerSpot(this.tmp2), e.amount);
    });

    // ------------------------------------------------------------------------------------------------
    // Wave 8: quests, rush hour, night
    // ------------------------------------------------------------------------------------------------

    ev.on('quest:done', (e) => {
      ctx.audio.play('quest');
      ctx.hud.toast('Quest complete!', { sub: `${e.title} +${formatMoney(e.reward)}`, duration: 2.6 });
      ctx.hud.coinBurst(Math.min(14, 6 + Math.floor(Math.log10(Math.max(10, e.reward)) * 2)));
    });

    ev.on('rush:start', () => {
      ctx.audio.play('bell');
    });

    // Wave 13: the gate's delivery contracts
    ev.on('contract:offered', (e) => {
      ctx.audio.play('quest');
      ctx.hud.toast(`New contract: ${contractItem(e.kind, e.count)} in ${contractClock(e.seconds)} \u00b7 +${formatMoney(e.bonus)}`, { duration: 3 });
    });
    ev.on('contract:done', (e) => {
      ctx.audio.play('fanfare');
      ctx.particles.confetti(this.playerSpot(this.tmp), 60);
      ctx.hud.toast('Contract complete!', { sub: `+${formatMoney(e.bonus)} bonus`, duration: 2.8 });
      ctx.hud.coinBurst(Math.min(14, 6 + Math.floor(Math.log10(Math.max(10, e.bonus)) * 2)));
    });
    ev.on('contract:failed', () => {
      ctx.audio.play('full');
      ctx.hud.toast('Contract missed', { sub: 'The notice board will post another soon', duration: 2.6 });
    });

    // Wave 13: world events
    ev.on('event:start', (e) => {
      if (e.kind === 'festival') ctx.audio.play('bell');
      else if (e.kind === 'snowstorm') {
        ctx.audio.play('whoosh');
        this.later(0.35, () => ctx.audio.play('whoosh', { volume: 0.8, pitch: 0.85 }));
      } else ctx.audio.play('sparkle');
    });

    ev.on('night:start', () => ctx.audio.setNight(true));
    ev.on('day:start', () => ctx.audio.setNight(false));
    // Ambience: the town bell, three tolls at dusk and two at dawn, once the village is a Town (level 3, Great Lodge era)
    const toll = (n: number): void => {
      if (ctx.state.village.level < 3) return;
      for (let i = 0; i < n; i++) this.later(i * 0.9, () => ctx.audio.play('bellToll'));
    };
    ev.on('night:start', () => toll(3));
    ev.on('day:start', () => toll(2));
    if (ctx.dayNight.darkness >= 0.5) ctx.audio.setNight(true);

    new Haptics(ctx);

    ev.on('intro:crash', (e) => {
      ctx.audio.play('crash');
      ctx.particles.splash(e.position, 1.3);
      ctx.cameraRig.shake(0.6, 0.5);
      this.later(0.12, () => ctx.audio.play('splash'));
    });
  }

  /**
   * A chair came out of the workshop: saw-whirr + a spray of sawdust over the cabin. Throttled, and only when the
   * workshop is on screen or the player is near it (the ridge is off to the east of the yard).
   */
  private chairMade(): void {
    const { ctx } = this;
    const now = ctx.time.elapsed;
    if (now - this.lastSaw < 0.7) return;
    const W = LAYOUT.ridge.workshop;
    const at = this.tmp.set(W.x, 1.3, W.z);
    if (!(ctx.cameraRig.isOnScreen(at, 24) || ctx.player.position.distanceTo(at) < 14)) return;
    this.lastSaw = now;
    ctx.audio.play('saw', { pitch: 0.94 + Math.random() * 0.12, volume: 0.8 });
    ctx.particles.burst(at, { colors: SAWDUST, count: 12, speed: 3.4, size: 0.14, spread: 1.5, life: 0.7, shape: 'cube', gravity: 7 });
    ctx.particles.puff(at, { color: 0xf6e3bd, count: 3, size: 0.55, life: 0.7 });
  }

  /** One soft tick into pad `id`: rate-limited per pad, its pitch walks the pad's pentatonic ladder. */
  private padTick(id: string, volume: number): void {
    const now = this.ctx.time.elapsed;
    let t = this.ticks.get(id);
    if (!t) this.ticks.set(id, (t = { ladder: new TickLadder(), last: -10 }));
    if (now - t.last < TICK_GAP) return;
    t.last = now;
    this.ctx.audio.play('tick', { pitch: t.ladder.next(now, Math.random()), volume });
  }

  /** Where shop purchases and other "no position" effects go: just above the player. */
  private playerSpot(out: THREE.Vector3, y = 0): THREE.Vector3 {
    return out.copy(this.ctx.player.position).setY(y);
  }

  private cashBurst(at: THREE.Vector3, amount: number): void {
    const { ctx } = this;
    ctx.particles.confetti(at, 36);
    ctx.particles.burst(this.tmp.copy(at).setY(at.y + 1), { colors: CASH_COLORS, count: 34, speed: 7, size: 0.22, spread: 1.5, life: 0.9, shape: 'cube', gravity: 12 });
    ctx.particles.sparkle(this.tmp.copy(at).setY(at.y + 1.2), 0xfff1a8);
    ctx.particles.ring(at, { color: 0x5ee07a, radius: 3.4, life: 0.7 });
    for (let i = 0; i < 6; i++) this.later(i * 0.07, () => ctx.audio.play('cash', { combo: true, volume: 0.8 }));
    ctx.hud.floatText(this.tmp.copy(at).setY(2.6), `+${formatMoney(amount)}`, { color: '#5ee07a', size: 36, duration: 1.4, rise: 1.8 });
  }

  private later(seconds: number, fn: () => void): void {
    this.pending.push({ at: this.ctx.time.elapsed + seconds, fn });
  }

  update(_dt: number): void {
    if (this.pending.length === 0) return;
    const now = this.ctx.time.elapsed;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      if (now >= p.at) {
        this.pending.splice(i, 1);
        p.fn();
      }
    }
  }
}
