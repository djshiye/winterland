/**
 * [B7 — progression] AssetFactory: upgrade-pad tile + its canvas texture. STUB — replace the placeholder
 * bodies; you own this file and its consumer (stations/UpgradePad.ts).
 *
 * Art spec — createPadTexture(iconType, costText, progressRatio):
 * - 256×256 offscreen canvas. Dark grey #4A4A4A (COLORS.PAD_BG) rounded rect with a white border,
 *   lineWidth 10.
 * - Green #2ECC71 (COLORS.PAD_FILL) fill rising from the bottom to the top with progressRatio (0..1 =
 *   paid fraction), clipped to the rounded rect.
 * - White silhouette icon in the upper half: chainsaw/claw for the harvester ('saw'), factory box for
 *   the processor ('factory'), conveyor arrows for belts ('conveyor'), giant blade for the mega saw
 *   ('megasaw').
 * - Green bill icon bottom-left + bold 56px white text (GAME_FONT) with the remaining amount.
 * - Must be cheap to RE-RENDER whenever the cost decrements: pass `target` to redraw an existing
 *   texture's canvas in place (texture.needsUpdate = true) instead of allocating a new one.
 */
import * as THREE from 'three';
import { COLORS, type PadDef } from '../config';
import { GAME_FONT, basic, geo, makeCanvasTexture, mesh } from '../render/materials';

export type PadIcon = PadDef['icon'];

export function createPadTexture(
  iconType: PadIcon,
  costText: string,
  progressRatio: number,
  target?: THREE.CanvasTexture,
): THREE.CanvasTexture {
  const texture = target ?? makeCanvasTexture(256, 256).texture;
  const canvas = texture.image as HTMLCanvasElement;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = `#${new THREE.Color(COLORS.PAD_BG).getHexString()}`;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = `#${new THREE.Color(COLORS.PAD_FILL).getHexString()}`;
  const fill = 256 * Math.min(1, Math.max(0, progressRatio));
  g.fillRect(0, 256 - fill, 256, fill);
  g.fillStyle = '#ffffff';
  g.font = `700 56px ${GAME_FONT}`;
  g.textAlign = 'center';
  g.fillText(costText, 128, 200);
  g.font = `700 28px ${GAME_FONT}`;
  g.fillText(iconType, 128, 90);
  texture.needsUpdate = true;
  return texture;
}

/** Floor tile (size × size) showing `texture` on top; origin at the tile's floor centre. */
export function createPadModel(size: number, texture: THREE.Texture): THREE.Group {
  const top = mesh(geo.ground(size, size), basic(0xffffff, { map: texture }), { cast: false });
  top.position.y = 0.03;
  return new THREE.Group().add(top);
}

export const padCatalog: Record<string, () => THREE.Object3D> = {
  padHarvester: () => createPadModel(2.2, createPadTexture('saw', '$100', 0.35)),
  padProcessor: () => createPadModel(2.2, createPadTexture('factory', '$200', 0)),
  padConveyor: () => createPadModel(2.2, createPadTexture('conveyor', '$150', 0.7)),
  padMegaSaw: () => createPadModel(2.2, createPadTexture('megasaw', '$200', 1)),
};
