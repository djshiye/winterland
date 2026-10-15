/**
 * [B3 — world/ridge] Crew bunkhouse ("living quarters") on Timber Ridge (LAYOUT.ridge.quarters, QUARTERS tiers).
 *
 * CONTRACT (keep every public signature; B3 owns the implementation):
 * - State: ctx.state.quarters (tier −1 = none, logs / cash paid toward the next tier) is the truth. The constructor
 *   builds from it at once and silently (model of the current tier, pad re-armed with partial progress).
 * - Once the ridge is open (ctx.state.unlocked.ridge; poll it or be told by Level via offer()), a ConstructionPad
 *   (stations/ConstructionPad.ts, key 'quarters') at LAYOUT.ridge.quarters.pad offers the next tier; onProgress
 *   mirrors logs / cash into state. On completion: state.quarters.tier = tier, swap the model, emit
 *   'quarters:built' {tier, position}. More crew may then work (core/crew.ts crewSlots; npc/Crew reads it live).
 * - padSpot(): where to stand to pay the current pad, or null when none is offered (bot / guide).
 * - debugBuild(tier): set the tier at once (same bookkeeping + event when it rises).
 *
 * Implementation: one site group at LAYOUT.ridge.quarters shows ONE model at a time — the staked site, a growing
 * scaffold while the next tier is being paid (also during an upgrade), or the built tier (assets/ridge.ts). The
 * door faces the pad. The building is solid (one box collider). Tiers 0+ puff chimney smoke.
 */
import * as THREE from 'three';
import { LAYOUT, QUARTERS, rect, type XZ } from '../config';
import type { GameContext } from '../core/types';
import { createQuarters, createQuartersSite, QUARTERS_CHIMNEY } from '../assets/ridge';
import { createScaffold, type Scaffold } from '../assets/shelters';
import { ConstructionPad, type ConstructionIcon, type ConstructionTarget } from '../stations/ConstructionPad';
import type { ColliderHandle } from '../world/Colliders';

const Q = LAYOUT.ridge.quarters;
/** Pad icon per tier (the pad canvas only knows the shelter icons). */
const ICONS: readonly ConstructionIcon[] = ['cabin', 'lodge', 'greatLodge'];
const SMOKE_TICK = 0.7;
/** Pause between a finished tier and the pad for the next one. */
const NEXT_DELAY = 1.4;
/** Pause between the ridge opening and the site / pad appearing (the gate and the snow come first). */
const OFFER_DELAY = 1.6;

type Look = 'none' | 'site' | 'scaffold' | `tier:${number}`;

function target(tier: number, paidLogs: number, paidCash: number): ConstructionTarget {
  const t = QUARTERS.tiers[tier]!;
  return { label: t.label.toUpperCase(), icon: ICONS[tier]!, logs: t.logs, cash: t.cash, paidLogs, paidCash };
}

export class Quarters {
  readonly root = new THREE.Group();
  private readonly pad: ConstructionPad;
  private readonly site = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private scaffold: Scaffold | null = null;
  private look: Look = 'none';
  /** Tier the pad is armed for (−1 = none). */
  private padTier = -1;
  private collider: ColliderHandle | null = null;
  private offerPending = false;
  private smokeTimer = 0;
  private readonly smoke = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  /** Door yaw: the door faces the pad. */
  private readonly yaw = Q.pad.z < Q.z ? Math.PI : 0;

  constructor(readonly ctx: GameContext) {
    this.root.name = 'quarters';
    this.root.visible = false;
    ctx.scene.add(this.root);
    this.site.position.set(Q.x, 0, Q.z);
    this.site.rotation.y = this.yaw;
    this.root.add(this.site);

    const st = ctx.state.quarters;
    // A save written while the last bundle was still flying holds a fully paid, never-completed tier: state is the
    // truth, finish it silently (no event / particles) before the pad is armed.
    const paid = QUARTERS.tiers[st.tier + 1];
    if (paid && st.logs >= paid.logs && st.cash >= paid.cash) {
      st.tier++;
      st.logs = 0;
      st.cash = 0;
    }
    const next = Math.min(QUARTERS.tiers.length - 1, st.tier + 1);
    this.pad = new ConstructionPad(ctx, {
      ...target(next, st.logs, st.cash),
      key: 'quarters',
      x: Q.pad.x,
      z: Q.pad.z,
      size: Q.padSize,
      onProgress: (logs, cash) => this.onProgress(logs, cash),
      onComplete: () => this.onComplete(),
    });
    this.padTier = st.tier + 1 < QUARTERS.tiers.length ? st.tier + 1 : -1;

    // A restored save: the ridge is open, show everything at once and silently.
    if (ctx.state.unlocked.ridge) {
      this.root.visible = true;
      this.refreshLook(false);
      if (this.padTier >= 0) this.pad.show(true);
    }
  }

  get tier(): number {
    return this.ctx.state.quarters.tier;
  }

  /** The ridge just opened: offer the first tier (the site and pad appear after the gate and snow). */
  offer(): void {
    if (!this.ctx.state.unlocked.ridge) return;
    if (this.root.visible && (this.pad.visible || this.padTier < 0)) return;
    if (!this.root.visible) {
      if (this.offerPending) return;
      this.offerPending = true;
      this.ctx.tweens.delay(OFFER_DELAY, () => {
        this.offerPending = false;
        this.root.visible = true;
        this.refreshLook(false);
        if (this.look === 'site') this.ctx.tweens.popIn(this.site, { duration: 0.45 });
        this.armPad(false);
      });
      return;
    }
    this.armPad(false);
  }

  /** The live construction pad (shown or not); the foreman reads its `visible` / logsLeft / cashLeft and pays into it. */
  constructionPad(): ConstructionPad {
    return this.pad;
  }

  padSpot(): XZ | null {
    if (!this.pad.visible) return null;
    return { x: this.pad.position.x, z: this.pad.position.z };
  }

  debugBuild(tier: number): void {
    const q = this.ctx.state.quarters;
    const rose = tier > q.tier;
    q.tier = tier;
    q.logs = 0;
    q.cash = 0;
    this.padTier = -1; // force a re-arm
    if (this.ctx.state.unlocked.ridge) this.root.visible = true;
    this.refreshLook(this.root.visible);
    if (this.root.visible) this.armPad(true);
    if (rose) this.ctx.events.emit('quarters:built', { tier, position: new THREE.Vector3(Q.x, 0, Q.z) });
  }

  update(dt: number): void {
    // Polling safety net: the ridge may open through a path that never calls offer().
    if (!this.root.visible && !this.offerPending && this.ctx.state.unlocked.ridge) this.offer();
    if (!this.root.visible) return;
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = SMOKE_TICK;
      if (this.look.startsWith('tier:')) {
        this.ctx.particles.puff(this.tmp.copy(this.smoke), { color: 0xffffff, count: 1, size: 0.5, life: 2.2 });
      }
    }
  }

  // ---- pad ------------------------------------------------------------------------------------------
  /** Re-arm the pad for the next tier (when there is one) and show / hide it. */
  private armPad(instant: boolean): void {
    const st = this.ctx.state.quarters;
    const next = st.tier + 1;
    if (next >= QUARTERS.tiers.length) {
      this.pad.hide();
      this.padTier = -1;
      return;
    }
    if (this.padTier !== next) {
      this.pad.rearm(target(next, st.logs, st.cash));
      this.padTier = next;
    }
    this.pad.show(instant);
  }

  private onProgress(logs: number, cash: number): void {
    const st = this.ctx.state.quarters;
    st.logs = logs;
    st.cash = cash;
    this.refreshLook(true);
  }

  private onComplete(): void {
    const ctx = this.ctx;
    const q = ctx.state.quarters;
    const tier = this.padTier;
    q.tier = tier;
    q.logs = 0;
    q.cash = 0;
    this.padTier = -1;
    this.refreshLook(true);
    this.tmp.set(Q.x, 0.4, Q.z);
    ctx.particles.puff(this.tmp, { color: 0xffffff, count: 12, size: 1.6, life: 0.9 });
    ctx.events.emit('quarters:built', { tier, position: new THREE.Vector3(Q.x, 0, Q.z) });
    if (tier + 1 < QUARTERS.tiers.length) ctx.tweens.delay(NEXT_DELAY, () => this.armPad(false));
  }

  // ---- visuals ----------------------------------------------------------------------------------------
  private paidFraction(): number {
    const st = this.ctx.state.quarters;
    if (st.logs <= 0 && st.cash <= 0) return 0;
    const t = QUARTERS.tiers[Math.min(QUARTERS.tiers.length - 1, st.tier + 1)]!;
    return Math.min(1, (st.logs / Math.max(1, t.logs) + st.cash / Math.max(1, t.cash)) / 2);
  }

  /** Make the site show the model for the state. `animate`: pop / squash when the model changes. */
  private refreshLook(animate: boolean): void {
    const st = this.ctx.state.quarters;
    const frac = this.paidFraction();
    let look: Look;
    if (frac > 0 && st.tier + 1 < QUARTERS.tiers.length) look = 'scaffold';
    else look = st.tier >= 0 ? `tier:${Math.min(QUARTERS.tiers.length - 1, st.tier)}` : 'site';

    if (look === 'scaffold' && this.look === 'scaffold' && this.scaffold) {
      this.scaffold.setProgress(frac);
      return;
    }
    if (look === this.look) return;
    const prev = this.look;
    this.look = look;
    if (this.model) {
      this.site.remove(this.model);
      this.model = null;
      this.scaffold = null;
    }
    if (look === 'scaffold') {
      const sc = createScaffold();
      sc.setProgress(frac);
      sc.group.scale.set(Q.w / 2.44, sc.group.scale.y, Q.d / 2.44);
      this.scaffold = sc;
      this.model = sc.group;
    } else if (look === 'site') {
      this.model = createQuartersSite();
    } else {
      const tier = Number(look.slice('tier:'.length));
      this.model = createQuarters(tier);
      const c = QUARTERS_CHIMNEY[tier]!;
      const cos = Math.cos(this.yaw);
      const sin = Math.sin(this.yaw);
      this.smoke.set(Q.x + c.x * cos + c.z * sin, c.y, Q.z - c.x * sin + c.z * cos);
    }
    this.site.add(this.model);
    // solid once there is a building (scaffold stays walk-through-free: the player never needs the site)
    if (look.startsWith('tier:') && !this.collider) this.collider = this.ctx.colliders.addBox(rect(Q.x, Q.z, Q.w - 0.4, Q.d - 0.4), 'quarters');
    if (animate && this.root.visible) {
      if (look.startsWith('tier:')) this.ctx.tweens.squash(this.model, 0.3, 0.45);
      else if (look === 'scaffold' && prev !== 'scaffold') this.ctx.tweens.popIn(this.model, { duration: 0.3 });
    }
  }
}
