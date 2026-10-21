/**
 * 1.0 (the review's ANNO ideas 5-7): the living-world touches that follow the weather and the world events, run from
 * one place so the Environment only builds and updates this.
 *
 * - Snow that builds up (render/snowCover.ts): a snowstorm slowly lays snow on the roofs and the harvest fields, which
 *   melts off over a few minutes after it. The scenery's meshes are given the snowy material here, and again every few
 *   seconds while snow lies, so buildings built later gather it too.
 * - The river promenade (env/promenade.ts): built with the new land, walkable once it shows.
 * - Festival day (env/festival.ts): lantern garlands over the square and the village street, and the brass band.
 */
import type * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { MAX_ERA } from '../../eras/data';
import { plotPlaces } from '../../eras/layout';
import { setSnowFields, SnowLayer, snowify } from '../../render/snowCover';
import { Festival } from './festival';
import { buildPromenade, type PromenadePart } from './promenade';

/** Top-level scene groups that are scenery (their buildings and fields gather snow). */
const SNOWY_ROOTS = /^(environment|village|town|city|ridge|quarters|region:\d+)$/;
/** Seconds between material sweeps while snow lies (and while it doesn't, to catch new buildings before a storm). */
const SWEEP_SNOW = 3;
const SWEEP_CALM = 20;

export class Seasonal {
  private readonly snow = new SnowLayer();
  private readonly promenade: PromenadePart;
  private readonly festival: Festival;
  private sweep = 0;
  private promenadeOpen = false;

  /** `root`: the environment root; `land`: the new land's group (shown with it); `decor`: the old scatter. */
  constructor(
    private readonly ctx: GameContext,
    root: THREE.Object3D,
    private readonly land: THREE.Object3D,
    decor: THREE.Object3D,
  ) {
    const fields = [];
    for (let n = 2; n <= MAX_ERA; n++) fields.push(plotPlaces(n).field);
    setSnowFields(fields);
    this.snow.apply();
    this.promenade = buildPromenade(ctx, land, decor);
    this.festival = new Festival(ctx);
    root.add(this.festival.group);
  }

  update(dt: number): void {
    this.snow.step(dt, this.ctx.worldEvents?.active === 'snowstorm');
    this.snow.apply();
    this.sweep -= dt;
    if (this.sweep <= 0) {
      this.sweep = this.snow.level > 0 ? SWEEP_SNOW : SWEEP_CALM;
      for (const g of this.ctx.scene.children) if (SNOWY_ROOTS.test(g.name)) snowify(g);
    }
    if (!this.promenadeOpen && this.land.visible) {
      this.promenadeOpen = true;
      this.promenade.open();
    }
    this.festival.update(dt);
  }
}
