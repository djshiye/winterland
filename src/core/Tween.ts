/**
 * [B1 — engine] Tween manager.
 *
 * All timing in the game must run on simulation time (this manager, or dt in update()), never
 * setTimeout/setInterval, so the debug `simulate(seconds)` fast-forward works.
 */
import * as THREE from 'three';

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
  /** Object this tween was created for (used by killTweensOf). */
  target: object | null = null;
  /** @internal */
  elapsed = 0;
  /** @internal */
  duration = 0;
  /** @internal */
  delay = 0;
  /** @internal */
  ease: Easing = Ease.linear;
  /** @internal */
  onUpdate: ((k: number) => void) | undefined;
  /** @internal */
  onComplete: (() => void) | undefined;
  /** @internal property names/start/end for to() tweens (captured on the first tick after the delay). */
  keys: string[] | null = null;
  /** @internal */
  from: number[] | null = null;
  /** @internal */
  end: number[] | null = null;
  /** @internal */
  started = false;

  /** Stop without calling onComplete. */
  kill(): void {
    this.done = true;
  }
}

type NumRecord = Record<string, number>;

const BASE_KEY = 'baseScale';

/** Scale the object was authored at; captured once so overlapping scale tweens never drift. */
function baseScaleOf(obj: THREE.Object3D): THREE.Vector3 {
  let b = obj.userData[BASE_KEY] as THREE.Vector3 | undefined;
  if (!b) {
    b = obj.scale.clone();
    // A mid-pop capture (scale ≈ 0) would be useless: fall back to 1.
    if (b.x < 1e-4 && b.y < 1e-4 && b.z < 1e-4) b.set(1, 1, 1);
    obj.userData[BASE_KEY] = b;
  }
  return b;
}

export class TweenManager {
  private tweens: Tween[] = [];

  /** Animate numeric properties of `target` (e.g. obj.position, obj.scale, a material) to the given values. */
  to<T extends object>(target: T, to: Partial<Record<keyof T, number>>, opts: TweenOptions): Tween {
    const tw = this.make(opts);
    tw.target = target;
    const keys: string[] = [];
    const end: number[] = [];
    for (const k in to) {
      const v = to[k as keyof T];
      if (typeof v === 'number') {
        keys.push(k);
        end.push(v);
      }
    }
    tw.keys = keys;
    tw.end = end;
    tw.from = new Array<number>(keys.length).fill(0);
    return tw;
  }

  /** Generic driver: calls opts.onUpdate(easedK) every frame for opts.duration seconds. */
  run(opts: TweenOptions): Tween {
    return this.make(opts);
  }

  /** Call `fn` after `seconds` of simulation time. */
  delay(seconds: number, fn: () => void): Tween {
    return this.make({ duration: Math.max(0, seconds), onComplete: fn });
  }

  /**
   * Spawn effect: scale from 0 up to the object's base scale with an elastic/back overshoot
   * ("scale-bounce"). Makes the object visible first.
   */
  popIn(obj: THREE.Object3D, opts?: { duration?: number; delay?: number }): Tween {
    const base = baseScaleOf(obj);
    this.killScaleTweens(obj, false);
    obj.scale.setScalar(0.0001);
    obj.visible = true;
    const tw = this.make({
      duration: opts?.duration ?? 0.45,
      delay: opts?.delay,
      ease: Ease.backOut,
      onUpdate: (k) => obj.scale.set(base.x * k, base.y * k, base.z * k),
      onComplete: () => obj.scale.copy(base),
    });
    tw.target = obj;
    return tw;
  }

  /** Shrink to 0, then hide (and remove from its parent if `remove`). */
  popOut(obj: THREE.Object3D, opts?: { duration?: number; delay?: number; remove?: boolean; onComplete?: () => void }): Tween {
    const base = baseScaleOf(obj);
    this.killScaleTweens(obj, false);
    const tw = this.make({
      duration: opts?.duration ?? 0.3,
      delay: opts?.delay,
      ease: Ease.quadIn,
      onUpdate: (k) => {
        const s = Math.max(0.0001, 1 - k);
        obj.scale.set(base.x * s, base.y * s, base.z * s);
      },
      onComplete: () => {
        obj.visible = false;
        obj.scale.copy(base);
        if (opts?.remove) obj.parent?.remove(obj);
        opts?.onComplete?.();
      },
    });
    tw.target = obj;
    return tw;
  }

  /**
   * Quick uniform scale pulse (amount 0.2 → peaks at 120% of base scale, then settles back).
   * Relative to obj.userData.baseScale (captured on first use) so overlapping punches never drift.
   */
  punchScale(obj: THREE.Object3D, amount = 0.2, duration = 0.25): Tween {
    const base = baseScaleOf(obj);
    this.killScaleTweens(obj);
    const tw = this.make({
      duration,
      onUpdate: (k) => {
        // sin hump with a little elastic tail
        const s = 1 + amount * Math.sin(k * Math.PI) * (1 - 0.35 * k);
        obj.scale.set(base.x * s, base.y * s, base.z * s);
      },
      onComplete: () => obj.scale.copy(base),
    });
    tw.target = obj;
    return tw;
  }

  /**
   * Squash & stretch: Y squashes by `amount` while X/Z bulge, then springs back past 1 and settles.
   * Use for machines processing an item, things landing, buildings spawning.
   */
  squash(obj: THREE.Object3D, amount = 0.25, duration = 0.35): Tween {
    const base = baseScaleOf(obj);
    this.killScaleTweens(obj);
    const tw = this.make({
      duration,
      onUpdate: (k) => {
        // damped oscillation: starts fully squashed (k=0 -> -1), overshoots to stretch, settles at 0.
        const w = Math.cos(k * Math.PI * 2.5) * Math.pow(1 - k, 1.6);
        const sy = 1 - amount * w;
        const sxz = 1 + amount * 0.6 * w;
        obj.scale.set(base.x * sxz, base.y * sy, base.z * sxz);
      },
      onComplete: () => obj.scale.copy(base),
    });
    tw.target = obj;
    return tw;
  }

  /** Kill every tween whose target is `target` (for to()) or that was created for object `target`. */
  killTweensOf(target: object): void {
    const list = this.tweens;
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.target === target) list[i]!.done = true;
    }
  }

  update(dt: number): void {
    const list = this.tweens;
    const n = list.length; // tweens added by callbacks start next frame
    for (let i = 0; i < n; i++) {
      const tw = list[i]!;
      if (tw.done) continue;
      if (tw.delay > 0) {
        tw.delay -= dt;
        if (tw.delay > 0) continue;
        // carry the overshoot into the tween itself
        tw.elapsed += -tw.delay;
        tw.delay = 0;
      } else {
        tw.elapsed += dt;
      }
      if (!tw.started) {
        tw.started = true;
        if (tw.keys && tw.from && tw.target) {
          const t = tw.target as NumRecord;
          for (let j = 0; j < tw.keys.length; j++) tw.from[j] = t[tw.keys[j]!] ?? 0;
        }
      }
      const raw = tw.duration <= 0 ? 1 : Math.min(1, tw.elapsed / tw.duration);
      const k = tw.ease(raw);
      if (tw.keys && tw.from && tw.end && tw.target) {
        const t = tw.target as NumRecord;
        for (let j = 0; j < tw.keys.length; j++) t[tw.keys[j]!] = tw.from[j]! + (tw.end[j]! - tw.from[j]!) * k;
      }
      tw.onUpdate?.(k);
      if (raw >= 1 && !tw.done) {
        tw.done = true;
        tw.onComplete?.();
      }
    }
    // compact (swap-free, order preserving, no allocation)
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const tw = list[i]!;
      if (!tw.done) list[w++] = tw;
    }
    list.length = w;
  }

  private make(opts: TweenOptions): Tween {
    const tw = new Tween();
    tw.duration = opts.duration;
    tw.delay = opts.delay ?? 0;
    tw.ease = opts.ease ?? Ease.linear;
    tw.onUpdate = opts.onUpdate;
    tw.onComplete = opts.onComplete;
    this.tweens.push(tw);
    return tw;
  }

  /** A new scale tween supersedes older ones on the same object (they would fight over scale). */
  private killScaleTweens(obj: THREE.Object3D, restore = true): void {
    const list = this.tweens;
    for (let i = 0; i < list.length; i++) {
      const tw = list[i]!;
      if (tw.target === obj && !tw.done && tw.keys === null) tw.done = true;
    }
    // restore base so a punch started mid-pop does not compound
    const b = obj.userData[BASE_KEY] as THREE.Vector3 | undefined;
    if (restore && b) obj.scale.copy(b);
  }
}
