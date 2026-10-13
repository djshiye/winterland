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
 * - stack:full → 'full' + floatText "MAX" (throttled).
 * - pad:paid → 'pay' (combo); pad:unlocked → 'unlock', confetti, ring, shake, toast.
 * - built → 'build', puff + ring.
 * - intro:crash → 'crash' + 'splash', splash particles, big shake.
 */
import * as THREE from 'three';
import { PADS, PALETTE } from '../config';
import type { GameContext, ItemHolder } from '../core/types';

const WOOD_CHIPS = [PALETTE.bark, PALETTE.barkDark, PALETTE.woodEnd, PALETTE.woodRing, PALETTE.plank];
const SAWDUST = [PALETTE.woodEnd, PALETTE.woodRing, 0xf6e3bd];

export class JuiceDirector {
  private readonly tmp = new THREE.Vector3();
  private readonly lastFull = new Map<ItemHolder, number>();
  private lastSparkle = 0;
  private lastDropFx = 0;
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
      } else if (ctx.time.elapsed - this.lastDropFx > 0.09) {
        this.lastDropFx = ctx.time.elapsed;
        ctx.audio.play('drop', { volume: 0.55, pitch: 0.9 + Math.random() * 0.25 });
      }
    });

    ev.on('player:chopHit', (e) => {
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
      ctx.hud.floatText(this.tmp, `+$${e.amount}`, { color: '#5ee07a', size: 28 });
      ctx.particles.sparkle(e.position, 0xaaffbb);
    });

    ev.on('stack:full', (e) => {
      const now = ctx.time.elapsed;
      if (now - (this.lastFull.get(e.holder) ?? -10) < 0.9) return;
      this.lastFull.set(e.holder, now);
      ctx.audio.play('full');
      this.tmp.copy(e.position);
      this.tmp.y += 2.2;
      ctx.hud.floatText(this.tmp, 'MAX', { color: '#ff9a2e', size: 30, duration: 1.0 });
    });

    ev.on('pad:paid', () => {
      ctx.audio.play('pay', { combo: true, volume: 0.8 });
    });

    ev.on('pad:unlocked', (e) => {
      ctx.audio.play('unlock');
      this.tmp.copy(e.position);
      ctx.particles.confetti(this.tmp, 60);
      ctx.particles.ring(this.tmp, { color: PALETTE.padFill, radius: 4, life: 0.7 });
      ctx.particles.ring(this.tmp, { color: 0xffffff, radius: 2.6, life: 0.5 });
      ctx.cameraRig.shake(0.25, 0.3);
      const label = PADS[e.id]?.label ?? String(e.id).toUpperCase();
      ctx.hud.toast(`${label} UNLOCKED!`);
    });

    ev.on('built', (e) => {
      ctx.audio.play('build');
      ctx.particles.puff(e.position, { count: 8, size: 0.9, life: 0.9 });
      ctx.particles.ring(e.position, { color: 0xffffff, radius: 3.2, life: 0.6 });
      ctx.particles.burst(e.position, { colors: SAWDUST, count: 10, speed: 4, size: 0.2, spread: 1.3, shape: 'cube' });
    });

    ev.on('intro:crash', (e) => {
      ctx.audio.play('crash');
      ctx.particles.splash(e.position, 1.3);
      ctx.cameraRig.shake(0.6, 0.5);
      this.later(0.12, () => ctx.audio.play('splash'));
    });
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
