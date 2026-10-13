/**
 * [B1 — engine] Static 2D (XZ) collision world for the player. STUB: replace bodies, keep the public API.
 *
 * - Bounds: the walkable yard rectangle; the player circle is clamped inside it.
 * - Obstacles: axis-aligned boxes and circles registered by stations/decor; resolveCircle pushes a
 *   circle out of every overlapping obstacle (minimum translation, several iterations) so the player
 *   slides along walls instead of sticking.
 * - Handles let owners remove/disable colliders later (e.g. phase-5 fence removal).
 * - NPCs follow scripted paths and do not use this.
 */
import type * as THREE from 'three';
import type { Rect } from '../config';

export interface ColliderHandle {
  readonly id: number;
  enabled: boolean;
  readonly tag: string;
}

export class ColliderWorld {
  bounds: Rect = { minX: -1e9, maxX: 1e9, minZ: -1e9, maxZ: 1e9 };

  setBounds(r: Rect): void {
    this.bounds = { ...r };
  }

  addBox(_r: Rect, tag = 'box'): ColliderHandle {
    return { id: 0, enabled: true, tag };
  }

  addCircle(_x: number, _z: number, _r: number, tag = 'circle'): ColliderHandle {
    return { id: 0, enabled: true, tag };
  }

  remove(_h: ColliderHandle): void {}

  /** Push the circle (pos.x, pos.z, radius) out of obstacles and clamp it to bounds, in place. */
  resolveCircle(_pos: THREE.Vector3, _radius: number): void {}

  /** True if the circle overlaps any enabled obstacle (ignores bounds). */
  overlaps(_x: number, _z: number, _radius: number): boolean {
    return false;
  }
}
