/** Gentle snowfall: one Points object of flakes that wrap around the camera target. */
import * as THREE from 'three';
import { makeCanvasTexture } from '../../render/materials';
import type { GameContext } from '../../core/types';
import { Rng, type EnvPart } from './common';

const COUNT = 520;
const SPAN = 72;
const HEIGHT = 18;

export interface SnowfallPart extends EnvPart {
  /** Wave 13: 1 normal; the snowstorm event raises it (more flakes via the draw range, and they fall faster). */
  setIntensity(k: number): void;
}

const MAX_COUNT = 1560; // 3x the calm count (EVENTS snowstorm snowfall: 3)

export function buildSnowfall(ctx: GameContext, rng: Rng): SnowfallPart {
  const group = new THREE.Group();
  group.name = 'snowfall';

  const { ctx: g, texture } = makeCanvasTexture(32, 32);
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);

  const pos = new Float32Array(MAX_COUNT * 3);
  const vel = new Float32Array(MAX_COUNT * 3); // fall speed, sway phase, sway amplitude
  const tx = ctx.cameraRig.target.x;
  const tz = ctx.cameraRig.target.z;
  for (let i = 0; i < MAX_COUNT; i++) {
    pos[i * 3] = tx + rng.range(-SPAN / 2, SPAN / 2);
    pos[i * 3 + 1] = rng.range(0, HEIGHT);
    pos[i * 3 + 2] = tz + rng.range(-SPAN / 2, SPAN / 2);
    vel[i * 3] = rng.range(0.7, 1.5);
    vel[i * 3 + 1] = rng.range(0, 6.28);
    vel[i * 3 + 2] = rng.range(0.15, 0.5);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 5,
    sizeAttenuation: false,
    map: texture,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    alphaTest: 0.02,
  });
  geometry.setDrawRange(0, COUNT);
  const points = new THREE.Points(geometry, mat);
  points.frustumCulled = false;
  points.renderOrder = 10;
  group.add(points);

  let t = 0;
  let target = 1;
  let intensity = 1; // eased toward `target`
  return {
    group,
    setIntensity(k: number): void {
      target = Math.min(MAX_COUNT / COUNT, Math.max(1, Number.isFinite(k) ? k : 1));
    },
    update(dt: number): void {
      t += dt;
      intensity += (target - intensity) * Math.min(1, dt * 1.5);
      if (Math.abs(target - intensity) < 0.005) intensity = target;
      geometry.setDrawRange(0, Math.round(COUNT * intensity));
      const fall = 1 + (intensity - 1) * 0.4; // a storm also falls harder,
      const wind = 0.12 + (intensity - 1) * 0.9; // blows sideways
      mat.size = 5 + (intensity - 1) * 1.8; // and its flakes read bigger
      const cx = ctx.cameraRig.target.x;
      const cz = ctx.cameraRig.target.z;
      const half = SPAN / 2;
      for (let i = 0; i < MAX_COUNT; i++) {
        const k = i * 3;
        let y = pos[k + 1]! - vel[k]! * fall * dt;
        let x = pos[k]! + Math.cos(t * 0.6 + vel[k + 1]!) * vel[k + 2]! * dt - wind * dt;
        let z = pos[k + 2]! + Math.sin(t * 0.5 + vel[k + 1]!) * vel[k + 2]! * dt;
        if (y < 0) y += HEIGHT;
        if (x < cx - half) x += SPAN;
        else if (x > cx + half) x -= SPAN;
        if (z < cz - half) z += SPAN;
        else if (z > cz + half) z -= SPAN;
        pos[k] = x;
        pos[k + 1] = y;
        pos[k + 2] = z;
      }
      geometry.attributes.position!.needsUpdate = true;
    },
  };
}
