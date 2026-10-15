/**
 * [B1 — engine] Keyboard + floating virtual joystick + mouse-drag input.
 *
 * - Keyboard: WASD + arrow keys → 8-directional, normalised (diagonals not faster).
 * - Touch / mouse: press anywhere on the game canvas spawns a floating joystick (DOM: base ring +
 *   knob, styled in joystick.css) centred at the press point; dragging gives an analog vector
 *   (dead-zone ~8%, full at ~55px); release hides it. Never scrolls/zooms the page.
 * - `move` is SCREEN space: x → right, y → up, length 0..1. Keyboard overrides joystick when both.
 * - `override` (tests/autopilot) replaces live input when non-null.
 * - onFirstGesture(cb): fires on the first pointerdown/keydown and then again on every later pointerup/keydown, so
 *   WebAudio can be re-resumed after iOS suspends it ('interrupted' after backgrounding); callbacks must be cheap and
 *   idempotent (audio.unlock() is a no-op while the context runs).
 * - `enabled = false` makes `move` read as zero (intro cinematic) but still tracks gestures.
 */
import * as THREE from 'three';
import './joystick.css';

const FULL_RADIUS = 55;
const DEAD_ZONE = 0.08;
const KNOB_REACH = 46;

const KEY_MAP: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

export type Shortcut = 'escape' | 'mute' | 'fullscreen' | 'zoomIn' | 'zoomOut';

export class Input {
  /** Screen-space movement intent; x → right, y → up, length 0..1. Updated by update(). */
  readonly move = new THREE.Vector2();
  /** Replaces live input when non-null (debug / tests). */
  override: THREE.Vector2 | null = null;
  enabled = true;

  private readonly keys = { up: false, down: false, left: false, right: false };
  private readonly pressed = new Set<string>();
  private readonly stick = new THREE.Vector2();
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private readonly joyRoot: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  private gestureCbs: (() => void)[] = [];
  private gestureFired = false;
  private allCbs: (() => void)[] = [];
  /** Wave 10 shortcut listener (Game wires it to events). TODO(engine builder): fire from onKeyDown and wheel. */
  protected shortcutCb: ((s: Shortcut) => void) | null = null;
  protected zoomCb: ((delta: number) => void) | null = null;

  /** Escape, M (mute), F11 / Alt+Enter / F (fullscreen), + / - (zoom). Fired on keydown, not while typing in an input. */
  onShortcut(cb: (s: Shortcut) => void): void {
    this.shortcutCb = cb;
  }

  /** Mouse wheel over the canvas and two-finger pinch: delta > 0 zooms in, about 0.1 per wheel notch. */
  onZoom(cb: (delta: number) => void): void {
    this.zoomCb = cb;
  }

  constructor(readonly element: HTMLElement) {
    this.joyRoot = document.createElement('div');
    this.joyRoot.className = 'wl-joy';
    const base = document.createElement('div');
    base.className = 'wl-joy__base';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'wl-joy__knob';
    this.joyRoot.append(base, this.joyKnob);
    (element.parentElement ?? document.body).appendChild(this.joyRoot);

    element.style.touchAction = 'none';
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerEnd);
    element.addEventListener('pointercancel', this.onPointerEnd);
    element.addEventListener('lostpointercapture', this.onPointerEnd);
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    element.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    // capture: UI panels shield pointerup, but a tap on them is still a user activation worth re-unlocking audio on
    window.addEventListener('pointerup', this.onGestureAgain, true);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.releaseAll);
  }

  /** True if the player is currently giving movement input. */
  get active(): boolean {
    return this.move.lengthSq() > 1e-4;
  }

  /** Register a callback fired once, on the first pointerdown/keydown (browser audio unlock). */
  onFirstGesture(cb: () => void): void {
    this.allCbs.push(cb);
    if (this.gestureFired) cb();
    else this.gestureCbs.push(cb);
  }

  /** Resolve the current intent into `move`. Call once per frame. */
  update(): void {
    if (this.override) {
      this.move.copy(this.override);
    } else {
      const k = this.keys;
      const kx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      const ky = (k.up ? 1 : 0) - (k.down ? 1 : 0);
      if (kx !== 0 || ky !== 0) {
        const len = Math.hypot(kx, ky);
        this.move.set(kx / len, ky / len);
      } else {
        this.move.copy(this.stick);
      }
    }
    if (this.move.lengthSq() > 1) this.move.normalize();
    if (!this.enabled) this.move.set(0, 0);
  }

  // --- internals --------------------------------------------------------------
  private fireGesture(): void {
    if (this.gestureFired) {
      // later gestures: re-run every registered callback (cheap idempotent unlock)
      for (const cb of this.allCbs) cb();
      return;
    }
    this.gestureFired = true;
    const cbs = this.gestureCbs;
    this.gestureCbs = [];
    for (const cb of cbs) cb();
  }

  private readonly onGestureAgain = (): void => {
    if (this.gestureFired) this.fireGesture();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.fireGesture();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.joyRoot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    this.joyKnob.style.transform = 'translate(0px, 0px)';
    this.joyRoot.classList.add('is-active');
    this.stick.set(0, 0);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - this.originX;
    const dy = e.clientY - this.originY;
    const dist = Math.hypot(dx, dy);
    // knob stays within reach of the ring
    const kd = Math.min(dist, KNOB_REACH);
    const kx = dist > 0 ? (dx / dist) * kd : 0;
    const ky = dist > 0 ? (dy / dist) * kd : 0;
    this.joyKnob.style.transform = `translate(${kx}px, ${ky}px)`;
    // analog magnitude: dead zone then linear to full
    let mag = Math.min(1, dist / FULL_RADIUS);
    mag = mag < DEAD_ZONE ? 0 : (mag - DEAD_ZONE) / (1 - DEAD_ZONE);
    if (mag === 0 || dist === 0) this.stick.set(0, 0);
    else this.stick.set((dx / dist) * mag, (-dy / dist) * mag); // screen y is down
  };

  private readonly onPointerEnd = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.stick.set(0, 0);
    this.joyRoot.classList.remove('is-active');
    try {
      if (this.element.hasPointerCapture(e.pointerId)) this.element.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.fireGesture();
    const dir = KEY_MAP[e.code];
    if (!dir) return;
    this.keys[dir] = true;
    this.pressed.add(e.code);
    e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const dir = KEY_MAP[e.code];
    if (!dir) return;
    this.pressed.delete(e.code);
    // another physical key may still hold the same direction (W + ArrowUp)
    let still = false;
    for (const code of this.pressed) if (KEY_MAP[code] === dir) still = true;
    this.keys[dir] = still;
  };

  private readonly releaseAll = (): void => {
    this.pressed.clear();
    this.keys.up = this.keys.down = this.keys.left = this.keys.right = false;
    if (this.pointerId !== null) {
      this.pointerId = null;
      this.stick.set(0, 0);
      this.joyRoot.classList.remove('is-active');
    }
  };
}
