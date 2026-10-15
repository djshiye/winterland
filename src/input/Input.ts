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
 * - Wave 10 shortcuts (onShortcut, fired on keydown, never while typing in an input / textarea / contenteditable,
 *   never on key repeat, never with Ctrl / Meta held): Escape → 'escape'; M → 'mute'; F, F11 and Alt+Enter →
 *   'fullscreen' (F11 / Alt+Enter are only reported when `location.protocol !== 'app:'`, because the Electron shell
 *   already toggles fullscreen for those and both would cancel out; the browser's own F11 / Alt+Enter are
 *   preventDefault-ed); + / = / NumpadAdd → 'zoomIn'; - / NumpadSubtract → 'zoomOut'. Movement keys are ignored
 *   while typing in a field so arrows still drive sliders.
 * - Zoom (onZoom): mouse wheel on the canvas only (non-passive, preventDefault) → -sign(deltaY) × 0.1 per event
 *   (wheel up = zoom in); two-finger pinch on the canvas → every pointermove emits
 *   (dist − lastDist) / startDist × 0.3, so doubling the finger distance sums to +0.3 and halving it to −0.15.
 *   Starting a pinch releases the joystick, and the finger left over after a pinch does not start a new one.
 * - Wave 10b hold to interact (core/interact.ts): E and Space are "interact" keys (Space is only preventDefault-ed
 *   when the target is not a button / input / textarea / select, so a focused button still clicks). `interactHeld`
 *   is true when the setting is off, or while E / Space is down, or while the joystick pointer is down with its
 *   knob still inside the dead zone (a drag that walked you onto a pad does NOT count; pinch is zoom, never a
 *   hold), unless `interactOverride` (debug / bot) is non-null, which wins. Zones with kind 'take' / 'pay' read it.
 */
import * as THREE from 'three';
import './joystick.css';
import { readHoldToInteract, writeHoldToInteract } from '../core/interact';

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

const WHEEL_STEP = 0.1;
/** Total zoom delta for a pinch that changes the finger distance by 100% of its starting value. */
const PINCH_GAIN = 0.3;
/** Fingers closer than this at the start count as this far apart (avoids huge ratios). */
const PINCH_MIN_START = 30;

/** Pure: shortcut for a keydown, or null. `desktop` = running inside the Electron shell (protocol 'app:'). */
export function shortcutForKey(
  e: { key: string; code: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  desktop = false,
): Shortcut | null {
  if (e.ctrlKey || e.metaKey) return null;
  const { key, code } = e;
  if (key === 'Escape' || code === 'Escape') return 'escape';
  if (code === 'KeyM' || key === 'm' || key === 'M') return 'mute';
  if (code === 'KeyF' || key === 'f' || key === 'F') return 'fullscreen';
  if (key === 'F11' || code === 'F11' || (e.altKey && (key === 'Enter' || code === 'Enter' || code === 'NumpadEnter'))) {
    return desktop ? null : 'fullscreen';
  }
  if (key === '+' || key === '=' || code === 'NumpadAdd' || code === 'Equal') return 'zoomIn';
  if (key === '-' || code === 'NumpadSubtract' || code === 'Minus') return 'zoomOut';
  return null;
}

/** Pure: incremental zoom delta for a pinch step. Summed over a gesture it equals (dist / startDist − 1) × 0.3. */
export function pinchDelta(dist: number, lastDist: number, startDist: number): number {
  return ((dist - lastDist) / Math.max(PINCH_MIN_START, startDist)) * PINCH_GAIN;
}

/** Pure: wheel notch → zoom delta (wheel up = deltaY < 0 = zoom in). */
export function wheelDelta(deltaY: number): number {
  return -Math.sign(deltaY) * WHEEL_STEP;
}

/**
 * Pure: the hold-to-interact rule. `override` wins; otherwise held when the setting is off, a key (E / Space) is
 * down, or the joystick pointer is down with the raw knob magnitude (0..1, before the dead zone is removed) still
 * inside the dead zone.
 */
export function heldFrom(s: {
  hold: boolean;
  key: boolean;
  pointerDown: boolean;
  stickLen: number;
  deadZone: number;
  override: boolean | null;
}): boolean {
  if (s.override !== null) return s.override;
  return !s.hold || s.key || (s.pointerDown && s.stickLen < s.deadZone);
}

/** Pure: is this keydown/keyup one of the interact keys (E, Space)? */
export function isInteractKey(e: { key: string; code: string }): boolean {
  return e.code === 'KeyE' || e.key === 'e' || e.key === 'E' || e.code === 'Space' || e.key === ' ';
}

function interactToken(e: { key: string; code: string }): string {
  return e.code === 'Space' || e.key === ' ' ? 'Space' : 'KeyE';
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

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
  /** Every pointer currently pressed on the canvas (joystick finger + pinch fingers). */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchIds: [number, number] | null = null;
  private pinchStart = 0;
  private pinchLast = 0;
  private originX = 0;
  private originY = 0;
  private readonly joyRoot: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  private gestureCbs: (() => void)[] = [];
  private gestureFired = false;
  private allCbs: (() => void)[] = [];
  /** Wave 10 shortcut / zoom listeners (Game wires them to events). */
  protected shortcutCb: ((s: Shortcut) => void) | null = null;
  protected zoomCb: ((delta: number) => void) | null = null;
  /**
   * Wave 10b hold-to-interact (core/interact.ts). `holdToInteract` is the setting; `interactHeld` is true while E,
   * Space or a pointer press with the stick inside its dead zone is held; `interactOverride` (debug/bot) wins when
   * non-null. When the setting is off, `interactHeld` is always true.
   */
  holdToInteract: boolean;
  interactOverride: boolean | null = null;
  /** Physical interact keys currently down (E, Space), by KeyboardEvent.code. */
  private readonly holdKeys = new Set<string>();
  /** Raw knob magnitude of the joystick pointer, 0..1 before the dead zone is removed. */
  private stickRaw = 0;
  get keyHeld(): boolean {
    return this.holdKeys.size > 0;
  }
  get pointerHeld(): boolean {
    return this.pointerId !== null && this.stickRaw < DEAD_ZONE;
  }
  get interactHeld(): boolean {
    return heldFrom({
      hold: this.holdToInteract,
      key: this.keyHeld,
      pointerDown: this.pointerId !== null,
      stickLen: this.stickRaw,
      deadZone: DEAD_ZONE,
      override: this.interactOverride,
    });
  }

  /** Settings switch: turn hold-to-interact on / off and persist it. */
  setHoldToInteract(on: boolean): void {
    this.holdToInteract = on;
    writeHoldToInteract(on);
  }

  /** Escape, M (mute), F11 / Alt+Enter / F (fullscreen), + / - (zoom). Fired on keydown, not while typing in an input. */
  onShortcut(cb: (s: Shortcut) => void): void {
    this.shortcutCb = cb;
  }

  /** Mouse wheel over the canvas and two-finger pinch: delta > 0 zooms in, about 0.1 per wheel notch. */
  onZoom(cb: (delta: number) => void): void {
    this.zoomCb = cb;
  }

  constructor(readonly element: HTMLElement) {
    this.holdToInteract = readHoldToInteract();
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
    element.addEventListener('wheel', this.onWheel, { passive: false });
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
    if (this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    if (this.pinchIds) return; // a third finger is ignored while pinching
    if (this.pointers.size >= 2) {
      // second finger: pinch-zoom instead of the joystick
      let other = -1;
      for (const id of this.pointers.keys()) {
        if (id !== e.pointerId) {
          other = id;
          break;
        }
      }
      this.releaseStick();
      const a = this.pointers.get(other);
      if (!a) return;
      this.pinchIds = [other, e.pointerId];
      this.pinchLast = Math.hypot(a.x - e.clientX, a.y - e.clientY);
      this.pinchStart = Math.max(PINCH_MIN_START, this.pinchLast);
      return;
    }
    this.pointerId = e.pointerId;
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.joyRoot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    this.joyKnob.style.transform = 'translate(0px, 0px)';
    this.joyRoot.classList.add('is-active');
    this.stick.set(0, 0);
    this.stickRaw = 0;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (this.pinchIds) {
      if (e.pointerId !== this.pinchIds[0] && e.pointerId !== this.pinchIds[1]) return;
      e.preventDefault();
      const a = this.pointers.get(this.pinchIds[0]);
      const b = this.pointers.get(this.pinchIds[1]);
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const d = pinchDelta(dist, this.pinchLast, this.pinchStart);
      this.pinchLast = dist;
      if (d !== 0) this.zoomCb?.(d);
      return;
    }
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
    this.stickRaw = mag;
    mag = mag < DEAD_ZONE ? 0 : (mag - DEAD_ZONE) / (1 - DEAD_ZONE);
    if (mag === 0 || dist === 0) this.stick.set(0, 0);
    else this.stick.set((dx / dist) * mag, (-dy / dist) * mag); // screen y is down
  };

  private readonly onPointerEnd = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pinchIds && (e.pointerId === this.pinchIds[0] || e.pointerId === this.pinchIds[1])) this.pinchIds = null;
    if (e.pointerId !== this.pointerId) return;
    this.releaseStick();
    try {
      if (this.element.hasPointerCapture(e.pointerId)) this.element.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  /** Drop the joystick (no more movement from it, ring hidden). */
  private releaseStick(): void {
    this.pointerId = null;
    this.stick.set(0, 0);
    this.stickRaw = 0;
    this.joyRoot.classList.remove('is-active');
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (e.target !== this.element) return;
    e.preventDefault();
    if (e.deltaY === 0) return;
    this.zoomCb?.(wheelDelta(e.deltaY));
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.fireGesture();
    if (isTyping(e.target)) return;
    if (isInteractKey(e) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.holdKeys.add(interactToken(e));
      if (e.code === 'Space' || e.key === ' ') {
        const tag = ((e.target as HTMLElement | null)?.tagName ?? '').toUpperCase();
        if (tag !== 'BUTTON' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') e.preventDefault();
      }
      return;
    }
    const dir = KEY_MAP[e.code];
    if (dir) {
      this.keys[dir] = true;
      this.pressed.add(e.code);
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    const desktop = typeof location !== 'undefined' && location.protocol === 'app:';
    const s = shortcutForKey(e, desktop);
    const browserKey = e.key === 'F11' || (e.altKey && e.key === 'Enter');
    if (browserKey) e.preventDefault(); // stop the browser's own fullscreen from fighting ours
    if (s) this.shortcutCb?.(s);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (isInteractKey(e)) this.holdKeys.delete(interactToken(e));
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
    this.holdKeys.clear();
    this.keys.up = this.keys.down = this.keys.left = this.keys.right = false;
    this.pointers.clear();
    this.pinchIds = null;
    if (this.pointerId !== null) this.releaseStick();
  };
}
