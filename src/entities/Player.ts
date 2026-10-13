/**
 * [B1 — engine] The lumberjack. STUB: replace bodies, keep the public API.
 *
 * Requirements:
 * - Movement: desired velocity = cameraRig.screenToWorldDir(input.move) * PLAYER.speed (or toward
 *   `autopilot` when set); accelerate/decelerate (PLAYER.accel/decel) for responsive-but-smooth feel;
 *   resolve against ctx.colliders (radius PLAYER.radius); face movement direction with
 *   dampAngle(PLAYER.turnLambda). inputEnabled=false → decelerate to a stop.
 * - Visual: CharacterRig (red shirt, dark pants, yellow beanie) + an axe (wood handle, grey head)
 *   parented to rig.handR, visible only while chopping. rig.setCarrying(arms.size > 0).
 * - Stacks: `arms` = CarryStack(accepts log+crate, PLAYER.armsCapacity, anchor rig.armsAnchor);
 *   `back` = CashStack(anchor rig.backAnchor, PLAYER.cashVisualCap). Call arms.update/back.update
 *   every frame with the world velocity (drives their sway spring).
 * - Chopping: setChopTarget(p) (called every frame by the giant log while the player stands in its
 *   chop zone; null when leaving) → face p when not moving, loop an axe swing every
 *   TIMING.chopInterval (wind-up, fast strike, recoil); at the strike frame emit
 *   ctx.events 'player:chopHit' { position: p }. No target → axe hidden, swing stops.
 * - Small dust/snow puffs at the feet while running are welcome (ctx.particles.puff, throttled).
 */
import * as THREE from 'three';
import { PALETTE, PLAYER } from '../config';
import type { GameContext } from '../core/types';
import { CharacterRig } from '../render/characters';
import { CarryStack } from '../items/CarryStack';
import { CashStack } from '../items/CashStack';

export class Player {
  readonly object = new THREE.Group();
  readonly rig: CharacterRig;
  readonly velocity = new THREE.Vector3();
  readonly arms: CarryStack;
  readonly back: CashStack;
  /** Yaw (rotation.y); the model faces local +Z. */
  facing = 0;
  inputEnabled = true;
  /** Debug/test autopilot: walk toward this XZ point (y ignored); cleared on arrival. */
  autopilot: THREE.Vector3 | null = null;

  constructor(readonly ctx: GameContext) {
    this.rig = new CharacterRig({ body: PALETTE.playerShirt, pants: PALETTE.playerPants, hat: 'beanie', hatColor: PALETTE.playerHat });
    this.object.add(this.rig.root);
    this.object.position.set(PLAYER.spawn.x, 0, PLAYER.spawn.z);
    ctx.scene.add(this.object);
    this.arms = new CarryStack(ctx, { id: 'player.arms', accepts: ['log', 'crate'], capacity: PLAYER.armsCapacity, anchor: this.rig.armsAnchor });
    this.back = new CashStack(ctx, { id: 'player.back', anchor: this.rig.backAnchor, maxVisual: PLAYER.cashVisualCap });
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  /** 0 when idle, 1 at full speed. */
  get speed01(): number {
    return Math.min(1, this.velocity.length() / PLAYER.speed);
  }

  get isChopping(): boolean {
    return false;
  }

  teleport(x: number, z: number): void {
    this.object.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
  }

  setChopTarget(_p: THREE.Vector3 | null): void {}

  update(_dt: number): void {}
}
