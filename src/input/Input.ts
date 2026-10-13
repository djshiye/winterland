/**
 * [B1 — engine] Keyboard + virtual joystick + mouse-drag input. STUB: replace bodies, keep the public API.
 *
 * Requirements:
 * - Keyboard: WASD + arrow keys → 8-directional, normalised (diagonals not faster).
 * - Touch / mouse: press anywhere on the game canvas spawns a floating joystick (DOM: base ring +
 *   knob, styled in your own CSS file imported by this module) centred at the press point; dragging
 *   gives an analog vector (dead-zone ~8%, full at ~55px); release hides it. Must not scroll/zoom
 *   the page (touch-action: none, preventDefault).
 * - `move` is SCREEN space: x → right, y → up, length 0..1. Keyboard overrides joystick when both.
 * - `override` (tests/autopilot) replaces live input when non-null.
 * - onFirstGesture(cb): fire once on the first pointerdown/keydown (used to unlock WebAudio).
 * - `enabled = false` makes `move` read as zero (intro cinematic) but still tracks gestures.
 */
import * as THREE from 'three';

export class Input {
  /** Screen-space movement intent; x → right, y → up, length 0..1. Updated by update(). */
  readonly move = new THREE.Vector2();
  /** Replaces live input when non-null (debug / tests). */
  override: THREE.Vector2 | null = null;
  enabled = true;

  constructor(readonly element: HTMLElement) {}

  /** True if the player is currently giving movement input. */
  get active(): boolean {
    return this.move.lengthSq() > 1e-4;
  }

  onFirstGesture(_cb: () => void): void {}

  update(): void {
    if (this.override) this.move.copy(this.override);
    else this.move.set(0, 0);
    if (!this.enabled) this.move.set(0, 0);
  }
}
