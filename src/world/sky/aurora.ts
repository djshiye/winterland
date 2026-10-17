/**
 * [0.9.8 — sky] The northern lights, reworked (Validator note on PR #45, brief 16).
 *
 * Until 0.9.7 the aurora was a screen-space picture over the top 55 % of the view with depth testing off. The iso camera
 * looks down at the snow and never sees the sky, so that picture read as a teal fog band with a hard wavy edge lying
 * across the ground and the buildings. Now the aurora is LIGHT (render/skyLight.ts): soft green / teal / violet ribbons
 * that wander slowly over the snow and the roofs on a faint wash, lighting what faces the sky, the way moonlight does.
 * No picture, so no edge, nothing over the play area, and zero draw calls.
 *
 * It fades in only once night has properly fallen (dusk keeps its warm sky), grows stronger during the aurora world
 * event, takes a hint of each era's resource glow in its body (render/palette.ts eraSky), follows the comfort Glow
 * slider, and moves more slowly with Reduce motion.
 */
import * as THREE from 'three';
import { SKY, eraSky } from '../../render/palette';
import { SKY_LIGHT } from '../../render/skyLight';

/** Peak strength on a plain night, and the wash between the ribbons. */
export const AURORA_NIGHT = 0.85;
export const AURORA_WASH = 0.15;
/** The warm-resource eras (3 Iron Age, 4 Steam Age, 5 Industrial) keep a fainter wash, so their ember and copper tones stay warm
 * at night instead of turning teal-grey. The ribbons still pass over them. */
const WARM_ERAS = new Set([3, 4, 5]);
export const AURORA_WASH_WARM = 0.06;
export function auroraWash(era: number): number {
  return WARM_ERAS.has(era) ? AURORA_WASH_WARM : AURORA_WASH;
}

/** Night amount (0 … 1) → how much aurora shows (0 until well after dusk). */
export function auroraFade(dark: number): number {
  const k = Math.min(1, Math.max(0, (dark - 0.35) / 0.5));
  return k * k * (3 - 2 * k);
}

/** Write a colour into a shared uniform array (linear RGB). */
function put(out: Float32Array, c: THREE.Color): void {
  out[0] = c.r;
  out[1] = c.g;
  out[2] = c.b;
}

export class AuroraLight {
  private time = 0;
  private wash = AURORA_WASH;
  private readonly low = new THREE.Color(SKY.auroraLow);
  private readonly crown = new THREE.Color(SKY.auroraCrown);
  private readonly classic = new THREE.Color(SKY.auroraBody);
  private readonly body = new THREE.Color(SKY.auroraBody);
  private readonly want = new THREE.Color();
  private readonly tint = new THREE.Color();

  constructor() {
    put(SKY_LIGHT.aurora0, this.low);
    put(SKY_LIGHT.aurora2, this.crown);
    put(SKY_LIGHT.aurora1, this.body);
  }

  /**
   * Per frame. `dark` 0 … 1, `strength` 1 normal (the aurora event raises it), `glow` the comfort Glow (0 … 1),
   * `speed` 1 normal (lower with Reduce motion), `era` the era the camera is in.
   */
  update(dt: number, dark: number, strength: number, glow: number, speed: number, era: number): void {
    const k = auroraFade(dark) * AURORA_NIGHT * strength * (0.35 + 0.65 * glow);
    SKY_LIGHT.sky[2] = k;
    // eased, so walking between eras blends it
    this.wash += (auroraWash(era) - this.wash) * Math.min(1, dt * 0.8);
    SKY_LIGHT.sky[3] = this.wash;
    if (k <= 0) return;
    this.time += dt * speed;
    SKY_LIGHT.sky[1] = this.time;
    // the teal body leans toward the era's resource glow, eased so walking between eras blends it
    const s = eraSky(era);
    this.tint.setHex(s.auroraTint);
    this.want.copy(this.classic).lerp(this.tint, s.auroraTintAmount);
    this.body.lerp(this.want, Math.min(1, dt * 0.8));
    put(SKY_LIGHT.aurora1, this.body);
  }
}
