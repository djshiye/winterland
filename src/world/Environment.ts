/**
 * [B3 — world] Static scenery + ambient animation: snow world, dirt yard, river (animated water,
 * ice floes, gate), fences, customer path, tricycle road, highway + bridge + tunnel spur, mountains,
 * pines / rocks / stumps / mounds, cabin (+ chimney smoke), lamp posts, sign, snowfall.
 *
 * Everything is procedural primitives with toon materials; repeated props are InstancedMesh and
 * static pieces are merged vertex-coloured meshes (see world/env/*). All animation runs on
 * simulation dt in update().
 */
import * as THREE from 'three';
import { LAYOUT } from '../config';
import type { GameContext } from '../core/types';
import { buildBuildings } from './env/buildings';
import { Rng, type EnvPart } from './env/common';
import { buildDecor, type ClearItem } from './env/decor';
import { buildFences } from './env/fences';
import { buildGate, type GatePart } from './env/gate';
import { buildGround } from './env/ground';
import { buildRidgeGate, type RidgeGatePart } from './env/ridgeGate';
import { buildMountains } from './env/mountains';
import { buildRiver } from './env/river';
import { buildRoads, highwayY } from './env/roads';
import { buildSnowfall } from './env/snowfall';

const EXPAND_TIME = 1.6;

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const backOut = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

interface StripState {
  item: ClearItem;
  baseScale: number;
  delay: number;
  puffed: boolean;
}

export class Environment {
  readonly waterY = LAYOUT.river.waterY;
  /** Root of all scenery. */
  readonly root = new THREE.Group();

  private readonly parts: EnvPart[] = [];
  private readonly river: EnvPart;
  private readonly snowfall: EnvPart;
  private readonly fences: ReturnType<typeof buildFences>;
  private readonly ground: ReturnType<typeof buildGround>;
  private readonly gate: GatePart;
  private readonly ridgeGate: RidgeGatePart;
  private readonly strip: StripState[] = [];
  private readonly chimney: THREE.Vector3;
  private readonly tmp = new THREE.Vector3();
  private smokeTimer = 0;
  private expanding = false;
  private expanded = false;
  private expandT = 0;
  private northPuffed = false;

  constructor(readonly ctx: GameContext) {
    this.root.name = 'environment';
    ctx.scene.add(this.root);
    const rng = new Rng(20260);

    this.ground = buildGround();
    this.river = buildRiver(rng);
    this.fences = buildFences();
    const roads = buildRoads();
    const mountains = buildMountains(rng);
    const decor = buildDecor(rng);
    const buildings = buildBuildings(ctx);
    this.snowfall = buildSnowfall(ctx, rng);
    this.gate = buildGate();
    this.ridgeGate = buildRidgeGate();
    this.chimney = buildings.chimney;

    for (const p of [this.ground, this.river, this.fences, this.gate, this.ridgeGate, roads, mountains, decor, buildings, this.snowfall]) {
      this.parts.push(p);
      this.root.add(p.group);
    }
    decor.stripItems.forEach((item, i) => {
      this.strip.push({ item, baseScale: item.object.scale.x, delay: 0.1 + i * 0.09, puffed: false });
    });

    ctx.colliders.setBounds(LAYOUT.yard);
    // A restored game: the state is the truth, build the final scenery at once and silently.
    if (ctx.state.village.revealed) this.gate.open(true);
    if (ctx.state.unlocked.ridge) this.ridgeGate.open(true);
    if (ctx.state.expanded) this.expand(true);
  }

  /** Swing the village gate open (instant: no animation). Idempotent. */
  openVillageGate(instant = false): void {
    this.gate.open(instant);
  }

  /** Swing the Timber Ridge gate open (instant: no animation). Idempotent. */
  openRidgeGate(instant = false): void {
    this.ridgeGate.open(instant);
  }

  /** Highway road-surface height at world X (raised over the river bridge). */
  highwayY(x: number): number {
    return highwayY(x);
  }

  /** True once the phase-5 expansion has finished growing the yard. */
  get isExpanded(): boolean {
    return this.expanded;
  }

  update(dt: number): void {
    this.river.update?.(dt);
    this.gate.update?.(dt);
    this.ridgeGate.update?.(dt);
    this.snowfall.update?.(dt);

    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.75;
      this.tmp.copy(this.chimney);
      this.ctx.particles.puff(this.tmp, { color: 0xffffff, count: 1, size: 0.5, life: 2.2 });
    }

    if (this.expanding) this.stepExpansion(dt);
  }

  /**
   * Phase 5: grow the yard north (-Z) to LAYOUT.expandedMinZ over ~1.6 s — the -Z fence pops out,
   * the strip decor is cleared with puffs, the dirt extends, the new fence (with a gap for the
   * truck counter) pops in, and the collider bounds are widened.
   */
  /** `instant` (restoring a save): final state at once, no animation, no puffs. */
  expand(instant = false): void {
    if (this.expanding || this.expanded) return;
    this.ctx.colliders.setBounds({ ...LAYOUT.yard, minZ: LAYOUT.expandedMinZ });
    this.ground.dirtExtension.visible = true;
    this.fences.expansion.visible = true;
    if (instant) {
      this.finishExpansion();
      return;
    }
    this.expanding = true;
    this.expandT = 0;
  }

  private puffAt(x: number, z: number, size = 0.9): void {
    this.tmp.set(x, 0.5, z);
    this.ctx.particles.puff(this.tmp, { color: 0xffffff, count: 3, size, life: 0.9 });
  }

  private stepExpansion(dt: number): void {
    this.expandT += dt;
    const t = this.expandT;

    // North fence: puff along it, then shrink away.
    const north = this.fences.north;
    if (!this.northPuffed) {
      this.northPuffed = true;
      for (let x = -7; x <= 9; x += 2.7) this.puffAt(x, LAYOUT.yard.minZ, 0.8);
    }
    if (north.visible) {
      const k = clamp01(t / 0.45);
      north.scale.y = Math.max(0.001, 1 - k * k);
      if (k >= 1) north.visible = false;
    }

    // Strip decor pops out with a puff each.
    for (const s of this.strip) {
      const obj = s.item.object;
      if (!obj.visible) continue;
      const k = clamp01((t - s.delay) / 0.35);
      if (k > 0 && !s.puffed) {
        s.puffed = true;
        this.puffAt(s.item.x, s.item.z, 1.0);
      }
      if (k > 0) {
        obj.scale.setScalar(Math.max(0.001, s.baseScale * (1 - k * k)));
        if (k >= 1) obj.visible = false;
      }
    }

    // Dirt grows north.
    const dk = clamp01((t - 0.2) / 1.1);
    this.ground.dirtExtension.scale.z = Math.max(0.001, easeOut(dk));

    // New fence pops in at the end.
    const fk = clamp01((t - 1.0) / 0.55);
    if (fk > 0) this.fences.expansion.scale.y = Math.max(0.001, backOut(fk));

    if (t >= EXPAND_TIME) this.finishExpansion();
  }

  /** The final (expanded) scenery state. */
  private finishExpansion(): void {
    this.expanding = false;
    this.expanded = true;
    this.ground.dirtExtension.scale.z = 1;
    this.fences.expansion.scale.y = 1;
    this.fences.north.visible = false;
    this.root.remove(this.fences.north);
    for (const s of this.strip) s.item.object.removeFromParent();
    this.strip.length = 0;
  }
}
