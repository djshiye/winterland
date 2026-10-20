/**
 * [B3 — world] Static scenery + ambient animation: snow world, dirt yard, river (animated water,
 * ice floes, gate), fences, customer path, tricycle road, highway + bridge + tunnel spur, mountains,
 * pines / rocks / stumps / mounds, cabin (+ chimney smoke), lamp posts, sign, snowfall, and (0.9.0) the new land of
 * era regions + roads (env/frontier.ts) on a 640 m ground plane.
 *
 * Everything is procedural primitives with toon materials; repeated props are InstancedMesh and
 * static pieces are merged vertex-coloured meshes (see world/env/*). All animation runs on
 * simulation dt in update().
 */
import * as THREE from 'three';
import { LAYOUT } from '../config';
import type { GameContext } from '../core/types';
import { buildBuildings } from './env/buildings';
import { setGlowStrength, updateGlow } from './env/glow';
import { Rng, type EnvPart } from './env/common';
import { buildDecor, type ClearItem } from './env/decor';
import { EraController, resetEras } from './env/eras';
import { buildFences } from './env/fences';
import { buildFrontier, pruneInstances, pruneNewLand, type FrontierPart } from './env/frontier';
import { WinterFun } from './life/WinterFun';
import { Critters } from './life/Critters';
import { Footprints } from './life/Footprints';
import { SkyTraffic } from './life/SkyTraffic';
import { LANE } from '../town/lane';
import { buildLanternLane } from './env/lantern';
import { buildGate, type GatePart } from './env/gate';
import { buildGround } from './env/ground';
import { buildRidgeGate, type RidgeGatePart } from './env/ridgeGate';
import { buildMountains } from './env/mountains';
import { buildRiver } from './env/river';
import { buildRoads, highwayY } from './env/roads';
import { buildTown, type TownPart } from './env/town';
import { buildSnowfall, type SnowfallPart } from './env/snowfall';
import { Sky } from './sky/Sky';
import { resetSmoke, smokeFrom } from './sky/smoke';
import { glowScale, onComfortChange, reducedMotion } from '../fx/comfort';
import { regionAt } from '../eras/playerUpgrades';

const EXPAND_TIME = 1.6;

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const backOut = (t: number): number => {
  if (reducedMotion()) return easeOut(t); // 0.9.7: no overshoot with Reduce motion
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
  private readonly snowfall: SnowfallPart;
  /** 0.9.8: sky, weather and life (world/sky/Sky.ts). */
  private readonly sky: Sky;
  private readonly fences: ReturnType<typeof buildFences>;
  private readonly ground: ReturnType<typeof buildGround>;
  private readonly gate: GatePart;
  private readonly ridgeGate: RidgeGatePart;
  private readonly town: TownPart;
  /** The old-map scatter (pines, rocks, drifts): Lantern Lane clears its patch when it opens. */
  private readonly decorGroup: THREE.Object3D;
  private readonly frontier: FrontierPart;
  /** 0.9.12: the skating pond and the sledding hill by the village (shown with the new land). */
  private readonly winterFun: WinterFun;
  private readonly critters: Critters;
  private readonly footprints: Footprints;
  private readonly skyTraffic: SkyTraffic;
  private winterPruned = false;
  /** 0.9.3: hides the peaks that stood on the new land once it shows (env/mountains.ts). */
  private readonly mountains: EnvPart;
  private readonly eras: EraController;
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
    resetEras();
    resetSmoke();
    ctx.scene.add(this.root);
    const rng = new Rng(20260);

    this.ground = buildGround();
    this.river = buildRiver(rng);
    this.fences = buildFences();
    const roads = buildRoads();
    const mountains = buildMountains(rng, () => this.frontier?.group.visible ?? false);
    this.mountains = mountains;
    const decor = buildDecor(rng);
    const buildings = buildBuildings(ctx);
    this.snowfall = buildSnowfall(ctx, rng);
    this.gate = buildGate(ctx);
    this.ridgeGate = buildRidgeGate();
    this.town = buildTown(ctx, new Rng(9090));
    this.sky = new Sky(ctx, this.snowfall);
    // 0.9.0: the old scatter is built exactly as before; whatever landed on the new land is pruned afterwards.
    pruneNewLand(decor.group);
    this.decorGroup = decor.group;
    this.frontier = buildFrontier(ctx, this.town.group, roads.trikeTail);
    this.winterFun = new WinterFun(ctx, this.frontier.group);
    this.critters = new Critters(ctx);
    this.root.add(this.critters.group);
    this.footprints = new Footprints(ctx);
    this.root.add(this.footprints.mesh);
    this.skyTraffic = new SkyTraffic(ctx);
    this.root.add(this.skyTraffic.group);
    this.chimney = buildings.chimney;

    for (const p of [this.ground, this.river, this.fences, this.gate, this.ridgeGate, this.town, this.frontier, roads, mountains, decor, buildings, this.snowfall]) {
      this.parts.push(p);
      this.root.add(p.group);
    }
    this.root.add(this.sky.group);
    decor.stripItems.forEach((item, i) => {
      this.strip.push({ item, baseScale: item.object.scale.x, delay: 0.1 + i * 0.09, puffed: false });
    });

    // Day / night: the renderer pulls ctx.dayNight.darkness every render() and tells us when it changes.
    ctx.renderer.darknessSource = () => ctx.dayNight.darkness;
    ctx.renderer.onDarkness((d) => {
      updateGlow(d);
    });
    // 0.9.8: each era's light and colour grade follows the camera (render/palette.ts looks; outside the regions = era 1)
    ctx.renderer.eraSource = () => {
      const t = ctx.cameraRig?.target;
      return t ? regionAt(t.x, t.z) || 1 : 1;
    };
    // the comfort Glow slider scales the bloom and the night lights
    const glow = (): void => {
      ctx.renderer.glow = glowScale();
      setGlowStrength(glowScale());
    };
    glow();
    onComfortChange(glow);

    // Eras follow the village level (live on 'village:changed'); sets the current look now and again for late registrants.
    this.eras = new EraController(ctx);
    ctx.colliders.setBounds(LAYOUT.yard);
    // A restored game: the state is the truth, build the final scenery at once and silently.
    if (ctx.state.village.revealed) this.gate.open(true);
    if (ctx.state.unlocked.ridge) this.ridgeGate.open(true);
    if (ctx.state.town.revealed) this.town.open(true);
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

  /**
   * [T4 — wave 9] Open the village's east fence gap + the town corridor / crossing so the Market Town can be
   * reached (instant: no animation). Idempotent. Town.reveal calls it; a restored revealed town at construction.
   */
  openTownGate(instant = false): void {
    this.town.open(instant);
  }

  /** 0.9.12: Lantern Lane (town/lane.ts) opens: clear the old scatter off it and build its scenery into `parent`. */
  openLane(parent: THREE.Object3D): void {
    const m = 0.8;
    pruneInstances(this.decorGroup, (x, z) => x > LANE.minX - m && x < LANE.maxX + m && z > LANE.minZ - m && z < LANE.maxZ + m);
    buildLanternLane(this.ctx, parent);
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
    this.town.update?.(dt);
    this.frontier.update?.(dt);
    if (!this.winterPruned && this.frontier.group.visible) {
      // the old scatter keeps era 1 exactly as it was; the hill only clears it once the new land shows
      this.winterPruned = true;
      const F = WinterFun.FOOTPRINT;
      pruneInstances(this.decorGroup, (x, z) => x > F.minX && x < F.maxX && z > F.minZ && z < F.maxZ);
    }
    this.winterFun.update(dt);
    this.critters.update(dt);
    this.footprints.update(dt);
    this.skyTraffic.update(dt);
    this.mountains.update?.(dt);
    this.eras.update(dt);
    // 0.9.8: the sky runs the weather (snowfall amount, the snowstorm event), the northern lights (stronger in the
    // aurora event), cloud shadows, the sun path, each era's air, chimney smoke and birds
    this.sky.update(dt);
    this.snowfall.update?.(dt);

    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 5;
      smokeFrom(this.chimney, 0.5);
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
