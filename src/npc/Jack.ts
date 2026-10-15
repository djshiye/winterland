/**
 * [STUB — jack builder replaces the body, keeps the public API] Jack of all trades: a swap cart where the player
 * dumps ANY carried item (a discard: wrong pickup, or just quick cash) for UPGRADES.jack share × ctx.market.unitValue.
 * One cart in the yard (eras/data.ts JACK.yard) and one in every unlocked era region (eras/layout.ts regionLayout.jack).
 */
import type * as THREE from 'three';
import type { GameContext } from '../core/types';
import type { XZ } from '../eras/layout';

export class JackCart {
  readonly object: THREE.Object3D | null = null;

  /** `at`: cart centre (world); `yaw`: cart front (local +Z) direction about +Y. The cart registers its own zone + collider. */
  constructor(
    protected readonly ctx: GameContext,
    readonly at: XZ,
    readonly yaw: number,
    readonly id: string,
  ) {}

  update(_dt: number): void {}

  dispose(): void {}
}
