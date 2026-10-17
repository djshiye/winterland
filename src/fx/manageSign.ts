/**
 * [0.9.6, F15] MANAGE signs show only near the player. Every built machine, town lot and city lot has one, and from
 * the default camera a yard full of them crowded the view (one often sat right over the player). They now fade in
 * as the player walks up (fully on within MANAGE_NEAR metres, gone past MANAGE_FAR), like the pads' fade. Only the
 * material changes (opacity, material.visible), so the owners keep deciding whether a sign exists at all
 * (mesh.visible). Pure part: manageSignAlpha (unit-tested).
 */
import * as THREE from 'three';
import { CAMERA } from '../config';

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

/**
 * [0.9.9] MANAGE board size (on-screen metres, assets/pads.ts createManageSign): board width and height, and the
 * visible post below it. The board stands upright, stretched by 1/cos(pitch), so world heights are these × UPRIGHT.
 */
export const MANAGE_BOARD_W = 3.0;
export const MANAGE_BOARD_H = 1.25;
export const MANAGE_POST_H = 1.0;
export const UPRIGHT = 1 / Math.cos((CAMERA.pitchDeg * Math.PI) / 180);

/** [0.9.9] How far outside the manage tile, toward its building, a board's post is planted (metres). */
export const MANAGE_POST_GAP = 0.18;

/**
 * [PURE, 0.9.9] Where a MANAGE board's post stands: on the side of the manage tile `zone` that faces its building's
 * centre `building` (the axis the building lies along), just outside the tile and centred on it. So every board stands
 * between its tile and its own building, the same way for machines, Market Town lots and city lots, and the player on
 * the tile never walks through the post.
 */
export function manageSignFoot(zone: { minX: number; maxX: number; minZ: number; maxZ: number }, building: { x: number; z: number }): { x: number; z: number } {
  const cx = (zone.minX + zone.maxX) / 2;
  const cz = (zone.minZ + zone.maxZ) / 2;
  const dx = building.x - cx;
  const dz = building.z - cz;
  if (Math.abs(dx) > Math.abs(dz)) return { x: dx > 0 ? zone.maxX + MANAGE_POST_GAP : zone.minX - MANAGE_POST_GAP, z: cz };
  return { x: cx, z: dz > 0 ? zone.maxZ + MANAGE_POST_GAP : zone.minZ - MANAGE_POST_GAP };
}

const look = new THREE.Vector3();

/** [0.9.9] Turn an upright board (assets/pads.ts createManageSign) to face the camera around Y only. */
export function faceCameraUpright(sign: THREE.Object3D, camera: THREE.Camera): void {
  look.set(0, 0, 1).applyQuaternion(camera.quaternion);
  const yaw = Math.atan2(look.x, look.z);
  if (sign.rotation.y !== yaw || sign.rotation.x !== 0 || sign.rotation.z !== 0) sign.rotation.set(0, yaw, 0);
}

/**
 * [PURE, 0.9.9] The ground a MANAGE board standing at `foot` hides from the camera (which sits toward +X/+Z): the
 * board's span across the view, swept back from where its bottom edge meets the ground line to where its top does.
 * Four corners (x, z), for pad-visibility tests. The thin post is left out.
 */
export function manageBoardShadow(foot: { x: number; z: number }): { x: number; z: number }[] {
  const tan = Math.tan((CAMERA.pitchDeg * Math.PI) / 180);
  const yaw = (CAMERA.yawDeg * Math.PI) / 180;
  // across the view (screen right) and away from the camera on the ground
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const bx = -Math.sin(yaw);
  const bz = -Math.cos(yaw);
  const near = ((MANAGE_POST_H - 0.04) * UPRIGHT) / tan;
  const far = ((MANAGE_POST_H - 0.04 + MANAGE_BOARD_H) * UPRIGHT) / tan;
  const h = MANAGE_BOARD_W / 2;
  const at = (s: number, d: number) => ({ x: foot.x + rx * s + bx * d, z: foot.z + rz * s + bz * d });
  return [at(-h, near), at(h, near), at(h, far), at(-h, far)];
}
