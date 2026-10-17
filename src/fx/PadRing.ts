/**
 * The soft fill ring around a pad tile (upgrade pads, construction pads, the shop mat): one flat mesh, one draw call,
 * drawn only while it has something to show.
 *
 * - A rounded-rectangle band hugging the tile's edge (same yaw as the tile) fills clockwise from the top of the screen
 *   as cash lands, easing toward the paid ratio (fillApproach) instead of jumping, with a faint cream track behind it.
 *   0.9.8: the band is warm honey (palette PAD), shaded like a rounded tube with a light line along it, a brighter
 *   head where it is still filling and a slow shimmer running through it (held still under Reduce motion).
 * - flash(): a short brightening of the filled part (and a halo pulse) when a bundle lands or a shop buy goes through.
 * - Affordable pads breathe a slow warm halo outside the band (breath(); held steady under reduced motion).
 * - The shader draws everything from a signed-distance rounded box; geometry is one cached plane per footprint, the
 *   material one per pad (its uniforms). Hidden (no draw call) when the fill, flash and glow are all ~0.
 *
 * playPadCelebrate(): the completion squash-and-stretch hump (bounceScale) followed by a pop-out, shared by the pads.
 * PadFeel (0.9.8): the per-frame feel every pad shares: a slow breath while affordable (never a jiggle), the face
 * dimmed while nothing can be paid, and a soft squash plus a felt thump the moment the player steps on.
 */
import * as THREE from 'three';
import { CAMERA } from '../config';
import { Ease, type Tween, type TweenManager } from '../core/Tween';
import { padDim } from '../assets/pads';
import { PAD } from '../render/palette';
import { glowScale } from './comfort';
import type { SfxName, PlayOptions } from './Audio';
import { bounceScale, breath, fillApproach, motionScale, padBreath, pitchJitter, reducedMotion } from './padJuice';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec2 uHalf;
uniform vec2 uExtent;
uniform float uRadius;
uniform float uWidth;
uniform float uProgress;
uniform float uTrackVis;
uniform float uGlow;
uniform float uFlash;
uniform vec3 uColor;
uniform vec3 uDeep;
uniform vec3 uLight;
uniform vec3 uTrack;
uniform vec3 uGlowColor;
uniform float uTime;
uniform float uShimmer;
varying vec2 vUv;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = (vUv * 2.0 - 1.0) * uExtent;
  float d = sdRoundBox(p, uHalf, uRadius);
  float hw = uWidth * 0.5;
  float band = 1.0 - smoothstep(hw - 0.035, hw + 0.035, abs(d));
  // clockwise on screen, starting at the middle of the tile's top edge (the tile is yawed 45 degrees like the camera)
  float a = fract(atan(p.x - p.y, p.x + p.y) / 6.2831853 + 0.125);
  float on = clamp((uProgress - a) * 90.0 + 0.5, 0.0, 1.0) * step(0.0005, uProgress);
  float bandA = band * mix(0.3 * uTrackVis, 0.95, on);
  // honey: deep at the edges, warm in the middle, a light line along the top, a bright head and a slow shimmer
  float mid = clamp(1.0 - abs(d) / hw, 0.0, 1.0);
  vec3 honey = mix(uDeep, uColor, smoothstep(0.0, 0.65, mid)) + uLight * pow(mid, 6.0) * 0.45;
  float head = exp(-pow((uProgress - a) * 28.0, 2.0)) * step(uProgress, 0.999);
  honey += uLight * (head * 0.35 + uShimmer * 0.1 * (0.5 + 0.5 * sin(a * 25.13 - uTime * 1.6)));
  vec3 bandC = mix(uTrack, honey + uFlash * 0.4, on);
  float outside = max(d - hw, 0.0);
  float glowA = min(1.0, uGlow * 0.5 + uFlash * 0.35) * exp(-outside * 4.5) * smoothstep(-uWidth, 0.0, d);
  float A = bandA + glowA * (1.0 - bandA);
  vec3 C = (bandC * bandA + uGlowColor * glowA * (1.0 - bandA)) / max(A, 1e-4);
  gl_FragColor = vec4(C, A);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Glow margin outside the band (world units): the plane is this much bigger than the ring. */
const GLOW_MARGIN = 0.5;

const planes = new Map<string, THREE.PlaneGeometry>();

function plane(w: number, d: number): THREE.PlaneGeometry {
  const key = `${w.toFixed(3)}x${d.toFixed(3)}`;
  let g = planes.get(key);
  if (!g) {
    g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    planes.set(key, g);
  }
  return g;
}

export interface PadRingOptions {
  /** Yaw of the tile (default: the camera yaw, like createPadModel). */
  yaw?: number;
  /** Band width in world units (default 0.16). */
  width?: number;
  /** Gap between the tile's edge and the band's centre line (default 0.15). */
  gap?: number;
  /** Corner radius of the band's centre line (default ≈ the tile's rounded corner). */
  radius?: number;
  /** Filled band colour (default honey). */
  color?: number;
  /** Idle glow colour (default warm candle gold). */
  glowColor?: number;
  /** Height above the floor (default 0.17: level with the pad slab's top, so the slab never hides the far side). */
  y?: number;
}

export class PadRing {
  readonly mesh: THREE.Mesh;
  private readonly u: {
    uHalf: { value: THREE.Vector2 };
    uExtent: { value: THREE.Vector2 };
    uRadius: { value: number };
    uWidth: { value: number };
    uProgress: { value: number };
    uTrackVis: { value: number };
    uGlow: { value: number };
    uFlash: { value: number };
    uColor: { value: THREE.Color };
    uDeep: { value: THREE.Color };
    uLight: { value: THREE.Color };
    uTrack: { value: THREE.Color };
    uGlowColor: { value: THREE.Color };
    uTime: { value: number };
    uShimmer: { value: number };
  };
  private target = 0;
  private shown = 0;
  private glow = 0;
  private flashK = 0;

  /** sizeX / sizeZ: the tile's footprint (world units, before yaw). */
  constructor(sizeX: number, sizeZ: number, opts: PadRingOptions = {}) {
    const width = opts.width ?? 0.16;
    const gap = opts.gap ?? 0.15;
    const hx = sizeX / 2 + gap;
    const hz = sizeZ / 2 + gap;
    const ex = hx + width / 2 + GLOW_MARGIN;
    const ez = hz + width / 2 + GLOW_MARGIN;
    this.u = {
      uHalf: { value: new THREE.Vector2(hx, hz) },
      uExtent: { value: new THREE.Vector2(ex, ez) },
      uRadius: { value: opts.radius ?? Math.min(hx, hz) * 0.3 },
      uWidth: { value: width },
      uProgress: { value: 0 },
      uTrackVis: { value: 0 },
      uGlow: { value: 0 },
      uFlash: { value: 0 },
      uColor: { value: new THREE.Color(opts.color ?? PAD.honey) },
      uDeep: { value: new THREE.Color(PAD.honeyDeep) },
      uLight: { value: new THREE.Color(PAD.honeyLight) },
      uTrack: { value: new THREE.Color(PAD.tag) },
      uGlowColor: { value: new THREE.Color(opts.glowColor ?? 0xffe3a0) },
      uTime: { value: 0 },
      uShimmer: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(plane(ex * 2, ez * 2), mat);
    this.mesh.name = 'padRing';
    this.mesh.rotation.y = opts.yaw ?? THREE.MathUtils.degToRad(CAMERA.yawDeg);
    this.mesh.position.y = opts.y ?? 0.17;
    this.mesh.renderOrder = 2;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
  }

  /** Paid ratio 0..1 to ease toward. */
  setProgress(ratio: number): void {
    this.target = Math.max(0, Math.min(1, ratio));
  }

  /** Jump straight to `ratio` (restore, re-arm). */
  snap(ratio: number): void {
    this.setProgress(ratio);
    this.shown = this.target;
    this.u.uProgress.value = this.shown;
  }

  /** A bundle landed: brighten the filled band for a moment. */
  flash(): void {
    this.flashK = 1;
  }

  /** Per frame while the pad is shown. `afford`: breathe the idle glow. */
  update(dt: number, t: number, afford: boolean): void {
    this.shown = fillApproach(this.shown, this.target, dt);
    const reduced = reducedMotion();
    this.glow = fillApproach(this.glow, afford ? breath(t, reduced) : 0, dt, 3);
    this.flashK = Math.max(0, this.flashK - dt * 5);
    const u = this.u;
    u.uProgress.value = this.shown;
    u.uTime.value = reduced ? 0 : t;
    u.uShimmer.value = reduced ? 0 : 1;
    // the Glow slider softens the halo but never below 35%, so an affordable pad still reads as one
    u.uGlow.value = this.glow * Math.max(0.35, glowScale());
    u.uFlash.value = this.flashK * this.flashK;
    // the faint track shows while something is paid or the pad glows
    u.uTrackVis.value = Math.min(1, Math.max(this.shown > 0.001 ? 1 : 0, this.glow * 2));
    this.mesh.visible = this.shown > 0.001 || this.glow > 0.01 || this.flashK > 0.01;
  }
}

/**
 * Completion: a squash-and-stretch hump on `obj` (peak scale, scaled by motionScale()), then, when `popOut`, a quick
 * shrink to nothing. onDone runs at the end either way (after the hump when not popping out). Pure visuals. The tween
 * has no target (killTweensOf(obj) leaves it running) unless the caller sets one.
 */
export function playPadCelebrate(
  tweens: TweenManager,
  obj: THREE.Object3D,
  peak: number,
  opts: { bounce?: number; popOut?: number; onDone?: () => void } = {},
): Tween {
  const bounce = opts.bounce ?? 0.42;
  const popOut = opts.popOut ?? 0;
  const m = motionScale();
  const s = { xz: 1, y: 1 };
  tweens.killTweensOf(obj);
  return tweens.run({
    duration: bounce + popOut,
    onUpdate: (k) => {
      const t = k * (bounce + popOut);
      if (t < bounce) {
        bounceScale(t / bounce, peak, m, s);
        obj.scale.set(s.xz, s.y, s.xz);
      } else {
        const u = (t - bounce) / popOut;
        const v = Math.max(0.0001, 1 - Ease.quadIn(u));
        obj.scale.set(v, v * (1 + 0.3 * (1 - v)), v);
      }
    },
    onComplete: () => {
      obj.scale.setScalar(1);
      opts.onDone?.();
    },
  });
}

/** What PadFeel needs from the game (a GameContext fits). */
export interface PadFeelContext {
  tweens: TweenManager;
  audio: { play(name: SfxName, opts?: PlayOptions): void };
}

/**
 * The shared feel of a pad, run every frame from its update(): `pulse` breathes slowly while `afford` (the player can
 * buy it now), the face of `model` dims while `canPay` is false (nothing at all can be paid yet: quieter, no shake),
 * and the frame the player steps on (`inside` turns true) the model squashes softly and a felt thump plays. Comfort:
 * the breath and squash follow Reduce motion (padBreath, Tween.squash), the thump the effects volume.
 */
export class PadFeel {
  private inside = false;
  private dim = 0;
  private primed = false;

  constructor(
    private readonly ctx: PadFeelContext,
    private readonly model: THREE.Object3D,
    private readonly phase = 0,
  ) {}

  update(dt: number, t: number, pulse: THREE.Object3D, afford: boolean, canPay: boolean, inside: boolean): void {
    const s = padBreath(t, afford, this.phase);
    pulse.scale.set(s, 1 + (s - 1) * 0.5, s);
    this.dim = this.primed ? fillApproach(this.dim, canPay ? 0 : 1, dt, 4) : canPay ? 0 : 1;
    padDim(this.model, this.dim);
    // the first frame only learns where the player is (a pad appearing under the player stays quiet)
    if (this.primed && inside && !this.inside) this.stepOn();
    this.inside = inside;
    this.primed = true;
  }

  /** The pad was hidden or re-shown: forget the player's last position (no thump for a pad appearing underfoot). */
  reset(): void {
    this.primed = false;
    this.inside = false;
  }

  private stepOn(): void {
    this.ctx.audio.play('padStep', { pitch: pitchJitter(), volume: 0.75 });
    this.ctx.tweens.squash(this.model, 0.06, 0.3);
  }
}
