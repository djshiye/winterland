/**
 * [B5 — commerce] AssetFactory: shop furniture + NPC speech bubbles. STUB — replace the placeholder
 * bodies; you own this file and its consumers (stations/Counter.ts, npc/*).
 *
 * Art spec:
 * - COUNTER: wooden table 1.6 × 0.6 × 0.8 (length × depth × height; sizes are passed in from LAYOUT) in
 *   FENCE_WOOD — sturdy top, legs/front panel planks; long axis along local X; origin at floor centre.
 *   Placed with an adjacent cash grid (that is a CashPile, not part of this model).
 * - SPEECH BUBBLE: camera-facing billboard (THREE.Sprite + CanvasTexture drawn on an offscreen canvas):
 *   white rounded bubble with a tail; shows an item icon (a wood PLANK icon for walk-in customers; crate /
 *   log for vehicles) with an optional count like "1/3", or a green ✓ when the order is fulfilled.
 *   Redraw in place on change (one canvas per bubble, texture.needsUpdate = true).
 */
import * as THREE from 'three';
import { COLORS } from '../config';
import { geo, makeCanvasTexture, mesh, toon } from '../render/materials';

export function createCounterModel(length: number, depth: number, height: number): THREE.Group {
  return new THREE.Group().add(mesh(geo.boxBase(length, height, depth), toon(COLORS.FENCE_WOOD)));
}

export type BubbleIcon = 'plank' | 'crate' | 'log' | 'check';

export interface SpeechBubble {
  readonly sprite: THREE.Sprite;
  /** Redraw with an icon and optional text (e.g. "1/3"). */
  show(icon: BubbleIcon, text?: string): void;
  dispose(): void;
}

export function createSpeechBubble(): SpeechBubble {
  const { ctx, texture } = makeCanvasTexture(128, 128);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.8, 0.8, 1);
  return {
    sprite,
    show(icon: BubbleIcon, text?: string): void {
      ctx.clearRect(0, 0, 128, 128);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(8, 8, 112, 96);
      ctx.fillStyle = icon === 'check' ? '#2ecc71' : '#e29547';
      ctx.fillRect(32, 32, 64, text ? 32 : 48);
      texture.needsUpdate = true;
    },
    dispose(): void {
      texture.dispose();
      material.dispose();
    },
  };
}

export const shopCatalog: Record<string, () => THREE.Object3D> = {
  counter: () => createCounterModel(1.6, 0.6, 0.8),
  bubble: () => {
    const b = createSpeechBubble();
    b.show('plank', '1/3');
    return b.sprite;
  },
};
