/**
 * [B1 — engine] Tween manager. STUB: replace bodies, keep the public API.
 *
 * All timing in the game must run on simulation time (this manager, or dt in update()), never
 * setTimeout/setInterval, so the debug `simulate(seconds)` fast-forward works.
 */
import type * as THREE from 'three';

export type Easing = (t: number) => number;

export const Ease = {
  linear: (t: number) => t,
  quadIn: (t: number) => t * t,
  quadOut: (t: number) => t * (2 - t),
  quadInOut: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  cubicOut: (t: number) => 1 - Math.pow(1 - t, 3),
  cubicInOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  sineInOut: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  expoOut: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  backOut: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  elasticOut: (t: number) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
} satisfies Record<string, Easing>;

export interface TweenOptions {
  duration: number;
  delay?: number;
  ease?: Easing;
  /** Called every frame with the eased progress k ∈ [0,1]. */
  onUpdate?: (k: number) => void;
  onComplete?: () => void;
}

export class Tween {
  done = false;
  /** Stop without calling onComplete. */
  kill(): void {
    this.done = true;
  }
}

export class TweenManager {
  /** Animate numeric properties of `target` (e.g. obj.position, obj.scale, a material) to the given values. */
  to<T extends object>(_target: T, _to: Partial<Record<keyof T, number>>, _opts: TweenOptions): Tween {
    return new Tween();
  }

  /** Generic driver: calls opts.onUpdate(easedK) every frame for opts.duration seconds. */
  run(_opts: TweenOptions): Tween {
    return new Tween();
  }

  /** Call `fn` after `seconds` of simulation time. */
  delay(_seconds: number, _fn: () => void): Tween {
    return new Tween();
  }

  /**
   * Spawn effect: scale from 0 up to the object's base scale with an elastic/back overshoot
   * ("scale-bounce"). Makes the object visible first.
   */
  popIn(_obj: THREE.Object3D, _opts?: { duration?: number; delay?: number }): Tween {
    return new Tween();
  }

  /** Shrink to 0, then hide (and remove from its parent if `remove`). */
  popOut(_obj: THREE.Object3D, _opts?: { duration?: number; delay?: number; remove?: boolean; onComplete?: () => void }): Tween {
    return new Tween();
  }

  /**
   * Quick uniform scale pulse (amount 0.2 → peaks at 120% of base scale, then settles back).
   * Relative to obj.userData.baseScale (captured on first use) so overlapping punches never drift.
   */
  punchScale(_obj: THREE.Object3D, _amount = 0.2, _duration = 0.25): Tween {
    return new Tween();
  }

  /**
   * Squash & stretch: Y squashes by `amount` while X/Z bulge, then springs back past 1 and settles.
   * Use for machines processing an item, things landing, buildings spawning.
   */
  squash(_obj: THREE.Object3D, _amount = 0.25, _duration = 0.35): Tween {
    return new Tween();
  }

  /** Kill every tween whose target is `target` (for to()) or that was created for object `target`. */
  killTweensOf(_target: object): void {}

  update(_dt: number): void {}
}
