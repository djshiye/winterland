/**
 * [0.9.8 — sky] The calm weather and the sun's path: pure functions of time, so they are easy to test and cost nothing.
 *
 * Weather: the sky drifts between clear spells, fair-weather clouds and gentle snow over several minutes (three slow
 * waves, never a sudden change). Purely cosmetic and never saved; the snowstorm world event still overrides the snow.
 *
 * Sun path: the sun swings gently across the day (morning shadows lean one way, afternoon shadows the other) and stands
 * highest at noon, where it is exactly the 0.9.7 sun (config LIGHTING.sunOffset). Through the night the moon carries
 * the swing back, so the path is one continuous loop and the light never jumps.
 */
import * as THREE from 'three';
import { LIGHTING } from '../../config';
import { SKY } from '../../render/palette';

export interface Weather {
  /** Cloud cover 0 (clear) … 1 (overcast). */
  clouds: number;
  /** Falling snow, as a share of the calm snowfall: ~0.3 a few flakes … 1.3 snowing. */
  snow: number;
  /** Wind speed (m/s) the clouds and smoke drift with. */
  wind: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How snowy the sky is at time `t` (s), 0 clear … 1 snowing: three slow waves (periods ~6, ~15 and ~4 minutes). A new
 * session (t = 0) opens on fair weather.
 */
export function snowiness(t: number): number {
  const a = Math.sin(t / 57 - 0.6) * 0.5 + Math.sin(t / 143 - 1.2) * 0.35 + Math.sin(t / 37 + 0.5) * 0.15;
  return Math.min(1, Math.max(0, (a + 1) / 2));
}

/** The weather at time `t` (s). */
export function weatherAt(t: number, out: Weather = { clouds: 0, snow: 0, wind: 0 }): Weather {
  const w = Number.isFinite(t) ? snowiness(t) : 0.4;
  out.clouds = 0.1 + 0.55 * smooth(0.05, 0.85, w);
  out.snow = 0.3 + 1.0 * smooth(0.35, 0.9, w);
  out.wind = 0.6 + 0.9 * w;
  return out;
}

/** Midday on the day / night cycle (DAYNIGHT: day runs 0 … 0.55). */
export const NOON = 0.275;
/** How far the sun swings either side of noon (deg), and how much lower it stands in the morning and evening. */
export const SWING_DEG = 18;
export const DIP_DEG = 5;

const BASE = new THREE.Vector3(LIGHTING.sunOffset.x, LIGHTING.sunOffset.y, LIGHTING.sunOffset.z);
const R = BASE.length();
const AZ0 = Math.atan2(BASE.z, BASE.x);
const EL0 = Math.asin(BASE.y / R);
const DEG = Math.PI / 180;

export interface SunState {
  offset: THREE.Vector3;
  sun: THREE.Color;
  hemiSky: THREE.Color;
}

const noonSun = new THREE.Color(LIGHTING.sunColor);
const noonHemi = new THREE.Color(LIGHTING.hemiSky);
const morningSun = new THREE.Color(SKY.sunMorning);
const eveningSun = new THREE.Color(SKY.sunEvening);
const morningHemi = new THREE.Color(SKY.hemiMorning);
const eveningHemi = new THREE.Color(SKY.hemiEvening);

/**
 * The sun at cycle share `phase` (0..1) under `clouds` (0..1): its offset from the shadow focus (same length as
 * LIGHTING.sunOffset) and the daytime sun / sky colours (warmer in the morning and late afternoon, a touch dimmer under
 * cloud). Exactly the LIGHTING sun at noon under a clear sky. Writes into `out`.
 */
export function sunAt(phase: number, clouds: number, out: SunState): SunState {
  const p = Number.isFinite(phase) ? phase : NOON;
  const u = 2 * Math.PI * (p - NOON);
  const az = AZ0 + SWING_DEG * DEG * Math.sin(u);
  const el = EL0 - DIP_DEG * DEG * (1 - Math.cos(u));
  out.offset.set(Math.cos(az) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(az) * Math.cos(el) * R);
  // how far from noon (0 … 1 at the ends of the day): only the ends of the day turn warm
  const off = Math.abs(((p - NOON + 0.5) % 1 + 1) % 1 - 0.5);
  const warm = smooth(0.1, 0.27, off);
  const morning = ((p - NOON + 1) % 1) > 0.5;
  out.sun.copy(noonSun).lerp(morning ? morningSun : eveningSun, warm);
  out.hemiSky.copy(noonHemi).lerp(morning ? morningHemi : eveningHemi, warm * 0.8);
  const dim = 1 - 0.1 * Math.min(1, Math.max(0, Number.isFinite(clouds) ? clouds : 0));
  out.sun.multiplyScalar(dim);
  return out;
}
