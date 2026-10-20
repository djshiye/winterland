/**
 * 0.9.12: footprints in the snow. The player, the sled dog and the townsfolk walking near the player leave soft prints
 * that slowly fill back in, so the busy ways between the huts, the shops and the gates wear into trodden paths of their
 * own while you watch. One instanced mesh, a fixed pool of prints (the oldest goes first), nothing drawn far away.
 */
import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { Crowd, type CrowdPerson } from '../../npc/Crowd';

/** Prints in the pool (the oldest is reused first). */
const POOL = 420;
/** Seconds a print lasts; it shrinks away over the last FADE of them. */
const LIFE = 40;
const FADE = 10;
/** Townsfolk this near the player leave prints (m). */
const NEAR = 24;
/** Stride (m) and the half-gap between the feet. */
const STRIDE = 0.42;
const FEET = 0.085;
const PAW_STRIDE = 0.3;
const PAW_FEET = 0.05;

interface Walker {
  x: number;
  z: number;
  left: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** A boot print lying flat: an oval, heel narrower than the toe. */
function bootGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  // drawn toe-down in XY, so laying it flat points the toe along +Z (the walker's forward)
  s.ellipse(0, -0.04, 0.05, 0.065, 0, Math.PI * 2, false, 0);
  const heel = new THREE.Path();
  heel.ellipse(0, 0.075, 0.038, 0.04, 0, Math.PI * 2, false, 0);
  const g = new THREE.ShapeGeometry([s, new THREE.Shape(heel.getPoints(10))], 10);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class Footprints {
  readonly mesh: THREE.InstancedMesh;
  /** Where each print is and when it was made (ring buffer). */
  private readonly px = new Float32Array(POOL);
  private readonly pz = new Float32Array(POOL);
  private readonly py = new Float32Array(POOL);
  private readonly yaw = new Float32Array(POOL);
  private readonly size = new Float32Array(POOL);
  private readonly born = new Float32Array(POOL).fill(-1e9);
  private next = 0;
  private time = 0;
  private readonly walkers = new WeakMap<object, Walker>();

  constructor(private readonly ctx: GameContext) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x5f7896, transparent: true, opacity: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(bootGeometry(), mat, POOL);
    this.mesh.name = 'footprints';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  /** Prints still showing (tests). */
  get live(): number {
    let n = 0;
    for (let i = 0; i < POOL; i++) if (this.time - this.born[i]! < LIFE) n++;
    return n;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const pl = this.ctx.player?.position;
    if (!pl) return;
    this.follow(this.ctx.player, pl.x, pl.y, pl.z, STRIDE, FEET, 1);
    const dog = this.ctx.player.dog?.root.position;
    if (dog) this.follow(this.ctx.player.dog!, dog.x, dog.y, dog.z, PAW_STRIDE, PAW_FEET, 0.45);
    for (const crowd of Crowd.all) {
      if (!crowd.prints || !crowd.group.visible) continue;
      for (const p of crowd.people) if (this.walks(p) && Math.hypot(p.x - pl.x, p.z - pl.z) < NEAR) this.follow(p, p.x, p.y, p.z, p.kid ? STRIDE * 0.75 : STRIDE, FEET, p.kid ? 0.8 : 1);
    }
    this.draw();
  }

  private walks(p: CrowdPerson): boolean {
    return p.active && p.sit === 0 && p.appear > 0.9 && p.y < 0.05;
  }

  /** Drop the next print once `who` has gone a stride from the last one (a jump back, like a teleport, starts afresh). */
  private follow(who: object, x: number, y: number, z: number, stride: number, feet: number, size: number): void {
    const w = this.walkers.get(who);
    if (!w) {
      this.walkers.set(who, { x, z, left: false });
      return;
    }
    const dx = x - w.x;
    const dz = z - w.z;
    const d = Math.hypot(dx, dz);
    if (d < stride) return;
    w.x = x;
    w.z = z;
    if (d > stride * 4) return;
    const yaw = Math.atan2(dx, dz);
    const side = (w.left = !w.left) ? 1 : -1;
    const i = this.next;
    this.next = (i + 1) % POOL;
    this.px[i] = x + Math.cos(yaw) * feet * side;
    this.pz[i] = z - Math.sin(yaw) * feet * side;
    this.py[i] = y + 0.07;
    this.yaw[i] = yaw;
    this.size[i] = size;
    this.born[i] = this.time;
  }

  private draw(): void {
    let n = 0;
    for (let i = 0; i < POOL; i++) {
      const age = this.time - this.born[i]!;
      if (age >= LIFE) continue;
      const k = this.size[i]! * Math.min(1, (LIFE - age) / FADE);
      _m.compose(_p.set(this.px[i]!, this.py[i]!, this.pz[i]!), _q.setFromAxisAngle(UP, this.yaw[i]!), _s.set(k * 1.2, 1, k));
      this.mesh.setMatrixAt(n++, _m);
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
