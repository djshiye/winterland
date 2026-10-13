/**
 * [B1 — engine] Static 2D (XZ) collision world for the player.
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

interface Collider extends ColliderHandle {
  /** 0 = box, 1 = circle */
  readonly kind: 0 | 1;
  // box
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  // circle
  x: number;
  z: number;
  r: number;
}

const ITERATIONS = 4;

export class ColliderWorld {
  bounds: Rect = { minX: -1e9, maxX: 1e9, minZ: -1e9, maxZ: 1e9 };
  private readonly colliders: Collider[] = [];
  private nextId = 1;

  /** Replace the walkable rectangle. */
  setBounds(r: Rect): void {
    this.bounds = { ...r };
  }

  /** Register a solid axis-aligned box. */
  addBox(r: Rect, tag = 'box'): ColliderHandle {
    const c: Collider = {
      id: this.nextId++,
      enabled: true,
      tag,
      kind: 0,
      minX: r.minX,
      maxX: r.maxX,
      minZ: r.minZ,
      maxZ: r.maxZ,
      x: 0,
      z: 0,
      r: 0,
    };
    this.colliders.push(c);
    return c;
  }

  /** Register a solid circle. */
  addCircle(x: number, z: number, r: number, tag = 'circle'): ColliderHandle {
    const c: Collider = { id: this.nextId++, enabled: true, tag, kind: 1, minX: 0, maxX: 0, minZ: 0, maxZ: 0, x, z, r };
    this.colliders.push(c);
    return c;
  }

  /** Permanently remove a collider. */
  remove(h: ColliderHandle): void {
    const i = this.colliders.indexOf(h as Collider);
    if (i >= 0) this.colliders.splice(i, 1);
  }

  /** Push the circle (pos.x, pos.z, radius) out of obstacles and clamp it to bounds, in place. */
  resolveCircle(pos: THREE.Vector3, radius: number): void {
    const list = this.colliders;
    for (let it = 0; it < ITERATIONS; it++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        const c = list[i]!;
        if (!c.enabled) continue;
        if (c.kind === 0) {
          // closest point on the box to the circle centre
          const cx = pos.x < c.minX ? c.minX : pos.x > c.maxX ? c.maxX : pos.x;
          const cz = pos.z < c.minZ ? c.minZ : pos.z > c.maxZ ? c.maxZ : pos.z;
          const dx = pos.x - cx;
          const dz = pos.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= radius * radius) continue;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            const push = (radius - d) / d;
            pos.x += dx * push;
            pos.z += dz * push;
          } else {
            // centre inside the box: leave through the nearest face
            const l = pos.x - c.minX;
            const r = c.maxX - pos.x;
            const t = pos.z - c.minZ;
            const b = c.maxZ - pos.z;
            const m = Math.min(l, r, t, b);
            if (m === l) pos.x = c.minX - radius;
            else if (m === r) pos.x = c.maxX + radius;
            else if (m === t) pos.z = c.minZ - radius;
            else pos.z = c.maxZ + radius;
          }
          moved = true;
        } else {
          const dx = pos.x - c.x;
          const dz = pos.z - c.z;
          const min = c.r + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min) continue;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            const push = (min - d) / d;
            pos.x += dx * push;
            pos.z += dz * push;
          } else {
            pos.x = c.x + min;
          }
          moved = true;
        }
      }
      this.clampToBounds(pos, radius);
      if (!moved) break;
    }
    this.clampToBounds(pos, radius);
  }

  /** True if the circle overlaps any enabled obstacle (ignores bounds). */
  overlaps(x: number, z: number, radius: number): boolean {
    const list = this.colliders;
    for (let i = 0; i < list.length; i++) {
      const c = list[i]!;
      if (!c.enabled) continue;
      if (c.kind === 0) {
        const cx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
        const cz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
        const dx = x - cx;
        const dz = z - cz;
        if (dx * dx + dz * dz < radius * radius) return true;
      } else {
        const dx = x - c.x;
        const dz = z - c.z;
        const min = c.r + radius;
        if (dx * dx + dz * dz < min * min) return true;
      }
    }
    return false;
  }

  private clampToBounds(pos: THREE.Vector3, radius: number): void {
    const b = this.bounds;
    if (pos.x < b.minX + radius) pos.x = b.minX + radius;
    else if (pos.x > b.maxX - radius) pos.x = b.maxX - radius;
    if (pos.z < b.minZ + radius) pos.z = b.minZ + radius;
    else if (pos.z > b.maxZ - radius) pos.z = b.maxZ - radius;
  }
}
