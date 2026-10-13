/**
 * [B4 — juice & HUD] DOM overlay HUD. STUB: replace bodies, keep the public API.
 *
 * Styles live in your own CSS file imported by this module (e.g. src/ui/hud.css). Chunky rounded
 * "mobile game" look: font GAME_FONT (Fredoka, loaded by index.html), white text with dark outline /
 * drop shadow, bright pills. Must work from 320 px wide phones to desktop (safe-area insets).
 * - Money pill top-left: green cash icon (CSS/SVG) + "$123"; the number counts up/down smoothly
 *   toward the real value and the pill bumps (scale pop) on increase. Subscribes to 'money:changed'.
 * - floatText: world-anchored text ("+$15", "MAX", "FULL") that rises ~1.2 units and fades over
 *   ~0.9 s; reprojected every frame via ctx.cameraRig.worldToScreen. Pool the DOM nodes.
 * - setObjective: small banner top-centre with the current hint ("Chop the giant log!"); animate
 *   in/out on change; null hides.
 * - setGuideTarget: a bouncing 3D arrow (toon cone + shaft, PALETTE.accent with white outline feel)
 *   hovering above the world point; when the point is off-screen, a DOM arrow at the screen edge
 *   points toward it instead. null hides both.
 * - toast: big centred title + optional subtitle that pops in and fades out (unlock celebrations).
 * - Mute toggle button top-right (calls ctx.audio.toggleMute(), shows state).
 */
import type * as THREE from 'three';
import type { GameContext } from '../core/types';

export interface FloatTextOptions {
  color?: string;
  /** CSS px font size (default ~26). */
  size?: number;
  duration?: number;
  /** World units to rise. */
  rise?: number;
}

export class HUD {
  constructor(
    readonly ctx: GameContext,
    readonly root: HTMLElement,
  ) {}

  setMoney(_value: number, _animate = true): void {}

  floatText(_world: THREE.Vector3, _text: string, _opts?: FloatTextOptions): void {}

  setObjective(_text: string | null): void {}

  setGuideTarget(_world: THREE.Vector3 | null): void {}

  toast(_title: string, _opts?: { sub?: string; duration?: number }): void {}

  update(_dt: number): void {}
}
