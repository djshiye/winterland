/**
 * [0.9.7 — Comfort] Gamepad support (cozy couch play, READINESS D4). Polled once per frame by Input.update(); the
 * browser's "standard" mapping (Xbox / PlayStation / Switch Pro pads all report it):
 *
 *   Left stick ........ walk (analog), or move through an open menu
 *   D-pad ............. move through menus (steps into an open shop / build sheet), else walk
 *   A (cross) ......... pick up & pay (hold, like E), or press the focused menu button
 *   B (circle) ........ back: closes the open menu
 *   Start ............. Settings (or closes the open menu)
 *   Y (triangle) ...... map          X (square) ...... market
 *   LB / RB ........... zoom out / in
 *
 * Holding a direction in a menu repeats after REPEAT_DELAY, every REPEAT_EVERY. Rumble (`rumble`) goes through
 * fx/Haptics, so it follows the Vibration switch. Key rebinding comes after 1.0.
 * Pure helpers (`deadZone`, `dirOf`, `PadRepeat`) are tested in tests/gamepad.test.ts; every navigator access is
 * guarded (no Gamepad API → no pad, never an error).
 */
import type { NavDir } from './menuNav';

/** Standard-mapping button indexes. */
export const BTN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;

/** Stick dead zone (radial) and the push that counts as a menu step. */
export const STICK_DEAD = 0.2;
export const NAV_PUSH = 0.55;
/** Seconds before a held direction repeats in a menu, and between repeats. */
export const REPEAT_DELAY = 0.4;
export const REPEAT_EVERY = 0.14;

/** Pure: radial dead zone, rescaled so movement starts at 0 just past it and reaches 1 at full tilt. Screen y is down. */
export function deadZone(x: number, y: number, dz = STICK_DEAD): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (!(len > dz)) return { x: 0, y: 0 };
  const k = Math.min(1, (len - dz) / (1 - dz)) / len;
  return { x: x * k, y: y * k };
}

/** Pure: a menu direction for a stick / D-pad vector (screen y down), or null inside `push`. */
export function dirOf(x: number, y: number, push = NAV_PUSH): NavDir | null {
  if (Math.max(Math.abs(x), Math.abs(y)) < push) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

/** Pure: key-repeat for a held direction. `step(dir, now)` is true on the first frame and on each repeat. */
export class PadRepeat {
  private dir: NavDir | null = null;
  private next = 0;

  step(dir: NavDir | null, now: number): boolean {
    if (dir === null) {
      this.dir = null;
      return false;
    }
    if (dir !== this.dir) {
      this.dir = dir;
      this.next = now + REPEAT_DELAY;
      return true;
    }
    if (now >= this.next) {
      this.next = now + REPEAT_EVERY;
      return true;
    }
    return false;
  }
}

/** One frame of the first connected pad. */
export interface PadFrame {
  /** Left stick after the dead zone; x right, y DOWN (as the browser reports it). */
  stick: { x: number; y: number };
  /** D-pad as a vector (-1 / 0 / 1), y down. */
  dpad: { x: number; y: number };
  /** Buttons held now. */
  held: ReadonlySet<number>;
  /** Buttons that went down this frame. */
  pressed: ReadonlySet<number>;
}

function pads(): (Gamepad | null)[] {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
    return Array.from(navigator.getGamepads());
  } catch {
    return [];
  }
}

/** The pad the player used last (the first connected one until a button is pressed). */
function activePad(): Gamepad | null {
  const list = pads().filter((p): p is Gamepad => !!p && p.connected);
  return list.find((p) => p.index === lastIndex) ?? list[0] ?? null;
}

let lastIndex = -1;
let lastUsed = 0;

/** True when a pad was the last thing the player touched (hints then say "A" instead of "E"). */
export function usingGamepad(): boolean {
  return lastUsed > 0 && activePad() !== null;
}

/** Reads the pad once per frame and works out which buttons went down. */
export class PadReader {
  private prev = new Set<number>();

  read(): PadFrame | null {
    const list = pads().filter((p): p is Gamepad => !!p && p.connected);
    if (list.length === 0) {
      this.prev.clear();
      return null;
    }
    // follow whichever pad has a button down (two pads plugged in: the one in the player's hands)
    const busy = list.find((p) => p.buttons.some((b) => b.pressed));
    if (busy) lastIndex = busy.index;
    const p = list.find((g) => g.index === lastIndex) ?? list[0]!;
    const held = new Set<number>();
    p.buttons.forEach((b, i) => {
      if (b.pressed) held.add(i);
    });
    const pressed = new Set<number>();
    for (const i of held) if (!this.prev.has(i)) pressed.add(i);
    this.prev = held;
    const stick = deadZone(p.axes[0] ?? 0, p.axes[1] ?? 0);
    const dpad = {
      x: (held.has(BTN.right) ? 1 : 0) - (held.has(BTN.left) ? 1 : 0),
      y: (held.has(BTN.down) ? 1 : 0) - (held.has(BTN.up) ? 1 : 0),
    };
    if (held.size > 0 || stick.x !== 0 || stick.y !== 0) lastUsed = Date.now();
    return { stick, dpad, held, pressed };
  }
}

/** A short rumble on the active pad (no-op without one, or where the browser has no rumble). Called by fx/Haptics. */
export function rumble(ms: number, strength = 0.5): void {
  const p = activePad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null;
  const act = p?.vibrationActuator;
  if (!act || typeof act.playEffect !== 'function') return;
  try {
    const s = Math.max(0, Math.min(1, strength));
    void act.playEffect('dual-rumble', { duration: ms, strongMagnitude: s * 0.6, weakMagnitude: s }).catch(() => undefined);
  } catch {
    /* some browsers throw while the page is not focused */
  }
}

/** True where the browser has the Gamepad API (desktop browsers and the desktop app). */
export function gamepadApiAvailable(): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  } catch {
    return false;
  }
}
