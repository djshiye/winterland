/**
 * [STUB — owner builder fills it] 0.9.0 era workers (npc/EraCrew.ts): one CharacterModel per era outfit.
 * Every model this file makes is also listed in `eraWorkerCatalog` (shown by the ?gallery page: --query gallery=eraWorkers).
 */
import type * as THREE from 'three';

export const eraWorkerCatalog: Record<string, () => THREE.Object3D> = {};
