/**
 * [0.9.8 — sky] Sky, weather and life (brief 16): the one place that runs the sky. The Environment builds it and calls
 * update(dt) every step.
 *
 * - Weather (weather.ts): calm spells of clear sky, fair clouds and gentle snow over several minutes; it sets the cloud
 *   cover, how much snow falls (world/env/snowfall.ts) and the wind. The snowstorm world event still brings its storm.
 * - Sun path (weather.ts sunAt): the sun swings gently over the day with a peach morning and a honey afternoon, and the
 *   moon carries the swing back at night (render/Renderer.ts setSunPath). Plain LIGHTING at noon.
 * - Cloud shadows and the northern lights are light on the world (render/skyLight.ts, aurora.ts): no extra draw calls.
 * - Each era's air (motes.ts), chimney smoke (smoke.ts), flocks of bullfinches by day (birds.ts) and the crews'
 *   families out on their greens (world/life/RegionLife.ts).
 *
 * Comfort (fx/comfort.ts): the Falling snow switch, Calm / Minimal effects (fewer motes and puffs, no birds on
 * Minimal), Reduce motion (everything drifts more slowly), and the Glow slider (the aurora and the glowing motes).
 * Everything here is cosmetic: nothing is saved and nothing in the economy reads it.
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { glowScale, particleScale, reducedMotion } from '../../fx/comfort';
import { SKY_LIGHT } from '../../render/skyLight';
import { Rng } from '../env/common';
import type { SnowfallPart } from '../env/snowfall';
import { RegionLife } from '../life/RegionLife';
import { AuroraLight } from './aurora';
import { buildBirds, type Birds } from './birds';
import { buildMotes, type Motes } from './motes';
import { buildSmoke, type Smoke } from './smoke';
import { sunAt, weatherAt, type SunState, type Weather } from './weather';

/** Cloud shadow strength by day and under the moon. */
const CLOUD_DAY = 0.3;
const CLOUD_NIGHT = 0.16;

export class Sky {
  readonly group = new THREE.Group();
  /** The shared sky-light uniforms (render/skyLight.ts), here so the debug console can read them. */
  readonly light = SKY_LIGHT;
  private readonly aurora = new AuroraLight();
  private readonly motes: Motes;
  private readonly smoke: Smoke;
  private readonly birds: Birds;
  /** The crews' families out on their greens (world/life/RegionLife.ts). */
  private readonly life: RegionLife;
  private readonly weather: Weather = { clouds: 0, snow: 1, wind: 1 };
  private readonly sun: SunState = { offset: new THREE.Vector3(), sun: new THREE.Color(), hemiSky: new THREE.Color() };
  /** Eased cloud cover (the weather's, pulled up during a snowstorm). */
  private clouds = 0.3;
  private time = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly snowfall: SnowfallPart,
  ) {
    this.group.name = 'sky';
    const rng = new Rng(16016);
    this.motes = buildMotes(rng);
    this.smoke = buildSmoke();
    this.birds = buildBirds(rng);
    this.group.add(this.motes.object, this.smoke.object, this.birds.group);
    this.life = new RegionLife(ctx, this.group);
    // start where the clock is, so a loaded game opens on its own weather instead of easing into it
    this.time = ctx.time?.elapsed ?? 0;
    weatherAt(this.time, this.weather);
    this.clouds = this.weather.clouds;
  }

  update(dt: number): void {
    const ctx = this.ctx;
    this.time += dt;
    const dark = ctx.dayNight.darkness;
    const event = ctx.worldEvents.active;
    const speed = reducedMotion() ? 0.45 : 1;
    const particles = particleScale();
    const era = ctx.renderer.era;
    const center = ctx.cameraRig.target;

    // weather: clouds, snow, wind (a snowstorm overrides the snow and darkens the sky)
    const w = weatherAt(this.time, this.weather);
    const storm = event === 'snowstorm';
    const cloudsWant = storm ? 0.9 : w.clouds;
    this.clouds += (cloudsWant - this.clouds) * Math.min(1, dt * 0.25);
    this.snowfall.setIntensity(storm ? ctx.worldEvents.snowfall : w.snow);
    this.snowfall.setDarkness(dark);
    const wind = storm ? 3 : w.wind;

    // sun path and its colour over the day
    sunAt(ctx.dayNight.enabled ? ctx.dayNight.phase : 0.275, this.clouds, this.sun);
    ctx.renderer.setSunPath(this.sun.offset, this.sun.sun, this.sun.hemiSky);

    // cloud shadows drift downwind (render/skyLight.ts)
    const c = SKY_LIGHT.cloud;
    c[0]! += wind * 0.6 * speed * dt;
    c[1]! += wind * 0.21 * speed * dt;
    c[3] = (CLOUD_DAY + (CLOUD_NIGHT - CLOUD_DAY) * dark) * (0.35 + 0.65 * this.clouds);
    SKY_LIGHT.sky[0] = this.clouds;

    // the northern lights (stronger in the aurora event)
    this.aurora.update(dt, dark, event === 'aurora' ? 1.8 : 1, glowScale(), speed, era);

    // the era's air, chimney smoke, birds
    this.motes.update(dt, era, dark, center, wind, particles, speed);
    this.smoke.update(dt, center, dark, wind, 0.4 + 0.6 * particles, speed);
    this.birds.update(dt, center, dark < 0.3 && !storm && w.snow < 1.2 && particles > 0.3, speed);
    this.life.update(dt);
  }
}
