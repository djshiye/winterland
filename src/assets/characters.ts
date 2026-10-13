/**
 * [B1 — characters] AssetFactory: character models. STUB — replace the placeholder bodies; you own
 * this file (reshape CharacterModel freely — its only consumer is render/characters.ts, also yours).
 *
 * Art spec:
 * - PLAYER (lumberjack): body capsule/cylinder r 0.35, h 0.8 in PLAYER_COAT (#1E6FD9) with WHITE
 *   (PLAYER_TRIM) TORUS COLLARS at the base and at the neck. Head sphere r 0.28 in PLAYER_SKIN
 *   (#F5CBA7) with a WHITE BEARD (flattened sphere) and a BLUE BEANIE (r 0.29 dome).
 *   carryPivot at (0, 0.5, 0.45): carried items stack upward from it (y = index · itemHeight).
 * - AXE: brown cylinder handle + silver (MACHINE_STEEL / light steel) wedge head; it swings with a sine
 *   motion while the player is near the giant log.
 * - CUSTOMER: capsule r 0.3, h 0.75 in CUSTOMER_BLUE (#4FA8F8) with a HOOD sphere.
 * - COURIER (cargo-tricycle rider): yellow helmet in COURIER_YELLOW (#FFD026).
 * - DRIVER (pickup truck): palette-consistent, distinct from customers.
 * Small extras for animation/readability (eyes, mitten hands / stubby arms, boots) are fine as long as
 * the silhouette and colours above hold. Root origin at the feet; the model faces local +Z.
 */
import * as THREE from 'three';
import { COLORS } from '../config';
import { geo, mesh, toon } from '../render/materials';

export type CharacterKind = 'player' | 'customer' | 'courier' | 'driver';

/** Parts of a character model that CharacterRig animates. */
export interface CharacterModel {
  root: THREE.Group;
  /** Upper-body pivot (bob / lean / squash). */
  body: THREE.Object3D;
  head: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  /** Tool attach point (the player's axe). */
  handR: THREE.Object3D;
  /** Carried-stack anchor (player: (0, 0.5, 0.45)). */
  carryPivot: THREE.Object3D;
  /** Cash-stack anchor on the back. */
  backPivot: THREE.Object3D;
  /** Top of the head/hat above the feet (speech bubbles float above it). */
  height: number;
}

function placeholder(color: number, radius: number, height: number): CharacterModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const b = mesh(geo.capsule(radius, Math.max(0.01, height - radius * 2)), toon(color));
  b.position.y = height / 2;
  body.add(b);
  const head = new THREE.Group();
  head.position.y = height + 0.25;
  head.add(mesh(geo.sphere(0.28), toon(COLORS.PLAYER_SKIN)));
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  const handR = new THREE.Object3D();
  armR.add(handR);
  const carryPivot = new THREE.Object3D();
  carryPivot.position.set(0, 0.5, 0.45);
  const backPivot = new THREE.Object3D();
  backPivot.position.set(0, 0.5, -0.4);
  body.add(head, armL, armR, carryPivot, backPivot);
  root.add(body);
  return { root, body, head, armL, armR, handR, carryPivot, backPivot, height: height + 0.55 };
}

export function createPlayerModel(): CharacterModel {
  return placeholder(COLORS.PLAYER_COAT, 0.35, 0.8);
}

export function createCustomerModel(_variant = 0): CharacterModel {
  return placeholder(COLORS.CUSTOMER_BLUE, 0.3, 0.75);
}

export function createCourierModel(): CharacterModel {
  return placeholder(COLORS.MACHINE_BLUE, 0.3, 0.75);
}

export function createDriverModel(_variant = 0): CharacterModel {
  return placeholder(COLORS.CUSTOMER_BLUE, 0.3, 0.75);
}

export function createAxe(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo.cylinder(0.035, 0.035, 0.6), toon(COLORS.LOG_BARK)));
  return g;
}

export const characterCatalog: Record<string, () => THREE.Object3D> = {
  player: () => createPlayerModel().root,
  customer: () => createCustomerModel().root,
  courier: () => createCourierModel().root,
  driver: () => createDriverModel().root,
  axe: () => createAxe(),
};
