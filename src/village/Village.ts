/**
 * [B3 — world/village] The winter village south of the yard (LAYOUT.village, VILLAGE): a gate in the south
 * fence, a street, 8 plots whose shelters grow Tent → Hut → Cabin → Lodge, and the Great Lodge (the finale).
 *
 * CONTRACT (keep every public signature; B3 owns the implementation):
 * - State: ctx.state.village is the truth. The constructor builds everything from it AT ONCE and silently (a
 *   restored save: open gate + walkable bounds, built shelters, pads re-armed with partial progress). Afterwards
 *   the village writes it as progress happens (plot tier / logs / cash through the pads' onProgress).
 * - reveal(instant): opens the gate, adds LAYOUT.village.walk to ctx.colliders (addBounds), offers the plots
 *   allowed at the current level, emits 'village:revealed' (not when instant). Idempotent. Progression calls it.
 * - One ConstructionPad (stations/ConstructionPad.ts) per plot in the street + one for the Great Lodge; a plot
 *   is offered when its VILLAGE.plotLevels entry ≤ the village level; the next tier is offered when its
 *   requiresLevel ≤ the level; the Great Lodge pad needs VILLAGE.greatLodge.requiresLevel.
 * - On a completed tier: build / swap the shelter model, stats.sheltersBuilt++, emit 'shelter:built', then
 *   recompute population + level (core/demand.ts villagePopulation / villageLevelFor), write
 *   state.village.population / level, emit 'village:changed' and, when the level rose, 'village:levelUp'; offer
 *   whatever the new level unlocks.
 * - The Great Lodge completing sets greatLodge.tier = 0 (level becomes the last one, Winterland). Progression
 *   reacts to 'shelter:built' with plot −1 for the finale.
 *
 * Visuals: every plot shows ONE model at a time — the staked lot, a growing scaffold while the next tier is
 * being paid (also during an upgrade), or the built shelter (assets/shelters.ts). Models are baked (1–2 meshes).
 * Cabins, lodges and the Great Lodge puff chimney smoke (one source per tick, round-robin).
 */
import * as THREE from 'three';
import { LAYOUT, VILLAGE, type XZ } from '../config';
import { villageLevelFor, villagePopulation } from '../core/demand';
import type { GameContext } from '../core/types';
import {
  createGreatLodge,
  createLot,
  createScaffold,
  createShelter,
  SHELTER_CHIMNEY,
  type Scaffold,
} from '../assets/shelters';
import { ConstructionPad, type ConstructionTarget } from '../stations/ConstructionPad';
import { buildVillageScenery } from '../world/env/village';

const V = LAYOUT.village;
const GROW_TIME = 0.9;
const SMOKE_TICK = 0.24;

const backOut = (t: number): number => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

type Look = 'lot' | 'scaffold' | `shelter:${number}` | 'none';

/** One plot (index ≥ 0) or the Great Lodge (index −1): its group, model, pad and smoke source. */
interface Site {
  readonly index: number;
  readonly group: THREE.Group;
  readonly pad: ConstructionPad;
  readonly yaw: number;
  /** Tier the pad is currently armed for (−1 = none yet). */
  padTier: number;
  look: Look;
  model: THREE.Object3D | null;
  scaffold: Scaffold | null;
  /** World chimney mouth while this site smokes. */
  smoke: THREE.Vector3 | null;
}

function tierTarget(tier: number, paidLogs: number, paidCash: number): ConstructionTarget {
  const t = VILLAGE.tiers[tier]!;
  return { label: t.label.toUpperCase(), icon: t.id, logs: t.logs, cash: t.cash, paidLogs, paidCash };
}

export class Village {
  /** Everything the village draws hangs under this group. */
  readonly root = new THREE.Group();
  private readonly sites: Site[] = [];
  private readonly lodge: Site;
  private readonly scenery: THREE.Group;
  private gateOpen = false;
  private growT = GROW_TIME;
  private smokeTimer = 0;
  private smokeCursor = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(readonly ctx: GameContext) {
    this.root.name = 'village';
    this.root.visible = false;
    ctx.scene.add(this.root);

    this.scenery = buildVillageScenery().group;
    this.root.add(this.scenery);

    const state = ctx.state.village;
    // A save written while the last bundle of a tier was still flying holds a fully paid, never-completed tier
    // (progress counts in-flight payments). State is the truth: finish it silently, before any pad is armed.
    state.plots.forEach((st) => {
      const t = VILLAGE.tiers[st.tier + 1];
      if (!t || st.logs < t.logs || st.cash < t.cash) return;
      st.tier++;
      st.logs = 0;
      st.cash = 0;
      ctx.state.stats.sheltersBuilt++; // the live path counts in onComplete(), which never ran for this tier
    });
    // The Great Lodge is NOT settled here: its completion drives the finale (shelter:built, plot -1), which a silent
    // restore would skip forever. ConstructionPad.completeIfPaid() fires it normally once the pad shows.
    V.plots.forEach((p, i) => {
      const st = state.plots[i]!;
      const next = Math.min(VILLAGE.tiers.length - 1, st.tier + 1);
      const yaw = p.side < 0 ? Math.PI / 2 : -Math.PI / 2;
      const pad = new ConstructionPad(ctx, {
        ...tierTarget(next, st.logs, st.cash),
        key: `plot:${i}`,
        x: p.x - p.side * V.padOffset,
        z: p.z,
        size: V.padSize,
        onProgress: (logs, cash) => this.onProgress(this.sites[i]!, logs, cash),
        onComplete: () => this.onComplete(this.sites[i]!),
      });
      const group = new THREE.Group();
      group.position.set(p.x, 0, p.z);
      group.rotation.y = yaw;
      this.root.add(group);
      this.sites.push({ index: i, group, pad, yaw, padTier: st.tier + 1 < VILLAGE.tiers.length ? st.tier + 1 : -1, look: 'none', model: null, scaffold: null, smoke: null });
    });

    const g = V.greatLodge;
    const gs = state.greatLodge;
    const lodgePad = new ConstructionPad(ctx, {
      label: VILLAGE.greatLodge.label,
      icon: 'greatLodge',
      logs: VILLAGE.greatLodge.logs,
      cash: VILLAGE.greatLodge.cash,
      paidLogs: gs.logs,
      paidCash: gs.cash,
      key: 'greatLodge',
      x: g.pad.x,
      z: g.pad.z,
      size: g.padSize,
      onProgress: (logs, cash) => this.onProgress(this.lodge, logs, cash),
      onComplete: () => this.onComplete(this.lodge),
    });
    const lodgeGroup = new THREE.Group();
    lodgeGroup.position.set(g.x, 0, g.z);
    lodgeGroup.rotation.y = Math.PI;
    this.root.add(lodgeGroup);
    this.lodge = { index: -1, group: lodgeGroup, pad: lodgePad, yaw: Math.PI, padTier: gs.tier < 0 ? 0 : -1, look: 'none', model: null, scaffold: null, smoke: null };

    this.recompute(false);
    // Wave 9: town buildings add people too (core/demand.ts villagePopulation).
    ctx.events.on('town:built', () => this.recompute(true));
    // 0.9.0 Demolish: a cleared lot takes its people with it (the stored level stays: it is a floor).
    ctx.events.on('town:demolished', () => this.recompute(true));
    for (const s of this.allSites()) this.refreshLook(s, false);
    if (state.revealed) this.applyReveal(true);
  }

  get revealed(): boolean {
    return this.ctx.state.village.revealed;
  }

  get population(): number {
    return this.ctx.state.village.population;
  }

  get level(): number {
    return this.ctx.state.village.level;
  }

  /** Open the gate and offer the first plots. Idempotent. */
  reveal(instant = false): void {
    if (this.ctx.state.village.revealed && this.gateOpen) return;
    this.ctx.state.village.revealed = true;
    this.applyReveal(instant);
    if (!instant) {
      const g = V.gate;
      this.ctx.events.emit('village:revealed', { position: new THREE.Vector3((g.minX + g.maxX) / 2, 0, LAYOUT.yard.maxZ) });
    }
  }

  /** Debug / bot: set plot `plot` (−1 = the Great Lodge) to `tier` at once (progress toward the next tier reset). */
  debugBuild(plot: number, tier: number): void {
    const v = this.ctx.state.village;
    const p = plot < 0 ? v.greatLodge : v.plots[plot];
    if (!p) return;
    const site = plot < 0 ? this.lodge : this.sites[plot]!;
    const built = tier > p.tier ? tier - p.tier : 0;
    p.tier = tier;
    p.logs = 0;
    p.cash = 0;
    site.padTier = -1; // force a re-arm
    this.refreshLook(site, false);
    // Same bookkeeping as a paid tier, so stats and the finale (shelter:built with plot −1) work from debug too.
    if (built > 0) {
      this.ctx.state.stats.sheltersBuilt += built;
      this.ctx.events.emit('shelter:built', { plot, tier, position: site.group.position.clone(), object: site.model ?? site.group });
    }
    this.recompute(true);
  }

  /**
   * Where the player stands to pay plot `plot`'s current pad (−1 = the Great Lodge), or null when no pad is
   * offered there right now (bots / guide).
   */
  padSpot(plot: number): XZ | null {
    const site = plot < 0 ? this.lodge : this.sites[plot];
    if (!site || !site.pad.visible) return null;
    return { x: site.pad.position.x, z: site.pad.position.z };
  }

  /** The live construction pad of plot `plot` (−1 = the Great Lodge), shown or not; null for an unknown plot. */
  pad(plot: number): ConstructionPad | null {
    const site = plot < 0 ? this.lodge : this.sites[plot];
    return site ? site.pad : null;
  }

  update(dt: number): void {
    if (this.growT < GROW_TIME) {
      this.growT = Math.min(GROW_TIME, this.growT + dt);
      this.scenery.scale.y = Math.max(0.001, backOut(this.growT / GROW_TIME));
    }
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0 && this.root.visible) {
      this.smokeTimer = SMOKE_TICK;
      this.puffNext();
    }
  }

  // ---- reveal ---------------------------------------------------------------------------------
  private applyReveal(instant: boolean): void {
    if (this.gateOpen) return;
    this.gateOpen = true;
    this.root.visible = true;
    this.ctx.environment.openVillageGate(instant);
    for (const r of V.walk) this.ctx.colliders.addBounds(r);
    this.growT = instant ? GROW_TIME : 0;
    this.scenery.scale.y = instant ? 1 : 0.001;
    if (!instant) {
      this.allSites().forEach((s, i) => {
        if (s.model && s.look === 'lot') this.ctx.tweens.popIn(s.model, { delay: 0.25 + i * 0.07, duration: 0.45 });
      });
    }
    this.recompute(!instant);
  }

  // ---- progress ---------------------------------------------------------------------------------
  private stateOf(s: Site): { tier: number; logs: number; cash: number } {
    const v = this.ctx.state.village;
    return s.index < 0 ? v.greatLodge : v.plots[s.index]!;
  }

  private onProgress(s: Site, logs: number, cash: number): void {
    const st = this.stateOf(s);
    st.logs = logs;
    st.cash = cash;
    this.refreshLook(s, true);
  }

  private onComplete(s: Site): void {
    const ctx = this.ctx;
    const st = this.stateOf(s);
    const tier = s.index < 0 ? 0 : s.padTier;
    st.tier = tier;
    st.logs = 0;
    st.cash = 0;
    s.padTier = -1;
    this.refreshLook(s, true);
    ctx.state.stats.sheltersBuilt++;
    this.puffDust(s);
    ctx.events.emit('shelter:built', {
      plot: s.index,
      tier,
      position: s.group.position.clone(),
      object: s.model ?? s.group,
    });
    this.recompute(true);
  }

  /** Population + level from the plots; events when `emit` and something changed. Always re-offers the pads. */
  private recompute(emit: boolean): void {
    const v = this.ctx.state.village;
    const population = villagePopulation(this.ctx.state);
    // The stored level is a floor: a save from before a threshold was raised (wave 9: Winter City 80 → 110 people) keeps
    // the era it had reached, and a demolished town building (0.9.0) lowers the population but never the level.
    const level = Math.max(v.level, villageLevelFor(population, v.greatLodge.tier >= 0));
    const changed = population !== v.population || level !== v.level;
    const rose = level > v.level;
    v.population = population;
    v.level = level;
    this.offer();
    if (!emit || !changed) return;
    this.ctx.events.emit('village:changed', { population, level });
    if (rose) {
      const s = V.street;
      this.ctx.events.emit('village:levelUp', { level, position: new THREE.Vector3((s.minX + s.maxX) / 2, 0, 18) });
    }
  }

  /** Show / hide / re-arm every pad according to the revealed flag, the level and the built tiers. */
  private offer(): void {
    const v = this.ctx.state.village;
    for (const s of this.sites) {
      const st = v.plots[s.index]!;
      const next = st.tier + 1;
      const allowed =
        v.revealed && VILLAGE.plotLevels[s.index]! <= v.level && next < VILLAGE.tiers.length && VILLAGE.tiers[next]!.requiresLevel <= v.level;
      if (allowed) {
        if (s.padTier !== next) {
          s.pad.rearm(tierTarget(next, st.logs, st.cash));
          s.padTier = next;
        }
        s.pad.show(!this.root.visible);
      } else {
        s.pad.hide();
        if (next >= VILLAGE.tiers.length) s.padTier = -1;
      }
      this.refreshLook(s, false);
    }
    const gl = v.greatLodge;
    const lodgeAllowed = v.revealed && v.level >= VILLAGE.greatLodge.requiresLevel && gl.tier < 0;
    if (lodgeAllowed) {
      if (this.lodge.padTier !== 0) {
        this.lodge.pad.rearm({ label: VILLAGE.greatLodge.label, icon: 'greatLodge', logs: VILLAGE.greatLodge.logs, cash: VILLAGE.greatLodge.cash, paidLogs: gl.logs, paidCash: gl.cash });
        this.lodge.padTier = 0;
      }
      this.lodge.pad.show(!this.root.visible);
    } else {
      this.lodge.pad.hide();
    }
    this.refreshLook(this.lodge, false);
  }

  // ---- visuals ----------------------------------------------------------------------------------
  private allSites(): Site[] {
    return [...this.sites, this.lodge];
  }

  /** Paid fraction toward the next tier (0 when nothing is being paid). */
  private paidFraction(s: Site): number {
    const st = this.stateOf(s);
    if (st.logs <= 0 && st.cash <= 0) return 0;
    const t = s.index < 0 ? VILLAGE.greatLodge : VILLAGE.tiers[Math.min(VILLAGE.tiers.length - 1, st.tier + 1)]!;
    return Math.min(1, (st.logs / Math.max(1, t.logs) + st.cash / Math.max(1, t.cash)) / 2);
  }

  /** Make the site show the right model for its state. `animate`: pop / squash when the model changes. */
  private refreshLook(s: Site, animate: boolean): void {
    const st = this.stateOf(s);
    const frac = this.paidFraction(s);
    let look: Look;
    if (s.index < 0) {
      const visible = st.tier >= 0 || this.ctx.state.village.level >= VILLAGE.greatLodge.requiresLevel;
      look = st.tier >= 0 ? 'shelter:0' : !visible ? 'none' : frac > 0 ? 'scaffold' : 'lot';
    } else if (frac > 0 && st.tier + 1 < VILLAGE.tiers.length) {
      look = 'scaffold';
    } else {
      look = st.tier >= 0 ? `shelter:${st.tier}` : 'lot';
    }

    if (look === 'scaffold' && s.look === 'scaffold' && s.scaffold) {
      s.scaffold.setProgress(frac);
      return;
    }
    if (look === s.look) return;
    const prev = s.look;
    s.look = look;
    if (s.model) {
      s.group.remove(s.model);
      s.model = null;
      s.scaffold = null;
    }
    s.smoke = null;
    const big = s.index < 0;
    if (look === 'none') return;
    if (look === 'scaffold') {
      const sc = createScaffold();
      sc.setProgress(frac);
      s.scaffold = sc;
      s.model = sc.group;
      if (big) sc.group.scale.set(2.1, sc.group.scale.y, 1.35);
    } else if (look === 'lot') {
      s.model = createLot();
      if (big) s.model.scale.set(2.1, 1, 1.35);
    } else {
      const tier = Number(look.slice('shelter:'.length));
      s.model = big ? createGreatLodge() : createShelter(tier);
      const chim = big ? SHELTER_CHIMNEY.greatLodge : tier === 2 ? SHELTER_CHIMNEY.cabin : tier === 3 ? SHELTER_CHIMNEY.lodge : null;
      if (chim) {
        const c = Math.cos(s.yaw);
        const sn = Math.sin(s.yaw);
        s.smoke = new THREE.Vector3(s.group.position.x + chim.x * c + chim.z * sn, chim.y, s.group.position.z - chim.x * sn + chim.z * c);
      }
    }
    s.group.add(s.model);
    if (animate && this.root.visible && !prev.startsWith('none')) {
      if (look.startsWith('shelter')) this.ctx.tweens.squash(s.model, 0.3, 0.45);
      else if (look === 'scaffold' && prev !== 'scaffold') this.ctx.tweens.popIn(s.model, { duration: 0.3 });
    }
  }

  private puffDust(s: Site): void {
    this.tmp.set(s.group.position.x, 0.4, s.group.position.z);
    this.ctx.particles.puff(this.tmp, { color: 0xffffff, count: s.index < 0 ? 12 : 7, size: s.index < 0 ? 1.6 : 1.1, life: 0.9 });
  }

  /** Chimney smoke: one source per tick, round-robin over the sites that have a chimney. */
  private puffNext(): void {
    const sites = this.allSites();
    for (let n = 0; n < sites.length; n++) {
      this.smokeCursor = (this.smokeCursor + 1) % sites.length;
      const s = sites[this.smokeCursor]!;
      if (s.smoke) {
        this.tmp.copy(s.smoke);
        this.ctx.particles.puff(this.tmp, { color: 0xffffff, count: 1, size: 0.45, life: 2.2 });
        return;
      }
    }
  }
}
