/**
 * [0.9.6, F15] MANAGE signs show only near the player. Every built machine, town lot and city lot has one, and from
 * the default camera a yard full of them crowded the view (one often sat right over the player). They now fade in
 * as the player walks up (fully on within MANAGE_NEAR metres, gone past MANAGE_FAR), like the pads' fade. Only the
 * material changes (opacity, material.visible), so the owners keep deciding whether a sign exists at all
 * (mesh.visible). Pure part: manageSignAlpha (unit-tested).
 */
import type * as THREE from 'three';

/** Fully visible within this distance (metres, ground plane). */
export const MANAGE_NEAR = 6;
/** Hidden past this distance. */
export const MANAGE_FAR = 9;

/** Sign opacity 0..1 for a player (dx, dz) metres from the sign. */
export function manageSignAlpha(dx: number, dz: number): number {
  const d = Math.hypot(dx, dz);
  if (!(d < MANAGE_FAR)) return 0;
  if (d <= MANAGE_NEAR) return 1;
  return (MANAGE_FAR - d) / (MANAGE_FAR - MANAGE_NEAR);
}

/**
 * Fade one sign for the player at `player` (null: leave it fully on). The sign's position is read in world space when
 * `world` is given (a sign under a moved parent), else its local position is taken as world (signs under the scene or
 * an unmoved root).
 */
export function fadeManageSign(sign: THREE.Mesh, player: { x: number; z: number } | null | undefined, world?: { x: number; z: number }): void {
  const mat = sign.material as THREE.Material;
  const at = world ?? sign.position;
  const a = player ? manageSignAlpha(player.x - at.x, player.z - at.z) : 1;
  const on = a > 0.01;
  if (mat.visible !== on) mat.visible = on;
  if (Math.abs(mat.opacity - a) > 0.01) mat.opacity = a;
}
