/** River: animated water, drifting ice floes, the wooden river gate and the timber bank lip. */
import * as THREE from 'three';
import { LAYOUT, PALETTE } from '../../config';
import { geo, makeCanvasTexture, mesh, toon } from '../../render/materials';
import { Batch, Rng, type EnvPart } from './common';

const R = LAYOUT.river;
const GATE_Z = LAYOUT.giantLog.gateZ;
const TILE_W = R.maxX - R.minX;
const TILE_D = TILE_W * 2;

function waterTexture(rng: Rng): THREE.CanvasTexture {
  const W = 128;
  const H = 256;
  const { ctx: g, texture } = makeCanvasTexture(W, H);
  g.fillStyle = '#' + new THREE.Color(PALETTE.water).getHexString();
  g.fillRect(0, 0, W, H);
  g.lineCap = 'round';
  const streak = (x: number, y: number, len: number, w: number, color: string): void => {
    for (const oy of [-H, 0, H]) {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y + oy);
      g.bezierCurveTo(x + 6, y + oy + len * 0.33, x - 6, y + oy + len * 0.66, x + 2, y + oy + len);
      g.stroke();
    }
  };
  for (let i = 0; i < 16; i++) streak(rng.range(8, W - 8), rng.range(0, H), rng.range(40, 100), rng.range(7, 13), 'rgba(42,135,207,0.55)');
  for (let i = 0; i < 22; i++) streak(rng.range(10, W - 10), rng.range(0, H), rng.range(28, 90), rng.range(2.5, 5), 'rgba(255,255,255,0.85)');
  for (let i = 0; i < 12; i++) streak(rng.range(10, W - 10), rng.range(0, H), rng.range(14, 36), rng.range(2, 3.5), 'rgba(205,240,255,0.9)');
  // Foam fringe along both banks.
  for (let i = 0; i < 26; i++) {
    const y = rng.range(0, H);
    const l = rng.range(14, 50);
    streak(rng.range(1, 6), y, l, rng.range(4, 7), 'rgba(255,255,255,0.95)');
    streak(rng.range(W - 6, W - 1), y + 20, l, rng.range(4, 7), 'rgba(255,255,255,0.95)');
  }
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, (R.maxZ - R.minZ) / TILE_D);
  texture.anisotropy = 4;
  return texture;
}

interface Floe {
  x: number;
  z: number;
  speed: number;
  size: number;
  rot: number;
  spin: number;
  phase: number;
  /** Visible z-range; wraps inside it. */
  z0: number;
  z1: number;
}

export function buildRiver(rng: Rng): EnvPart {
  const group = new THREE.Group();
  group.name = 'river';

  // ---- water ------------------------------------------------------------
  const tex = waterTexture(rng);
  const water = mesh(geo.ground(TILE_W, R.maxZ - R.minZ), toon(0xffffff, { map: tex }), { cast: false });
  water.position.set((R.minX + R.maxX) / 2, R.waterY, (R.minZ + R.maxZ) / 2);
  group.add(water);

  // ---- ice floes (animated) ---------------------------------------------
  const floes: Floe[] = [];
  const leftLane = (): number => rng.range(R.minX + 0.8, -15.1);
  for (let i = 0; i < 9; i++) {
    floes.push({ x: leftLane(), z: -50 + i * 6.2, speed: rng.range(0.85, 1.05) * R.flowSpeed, size: rng.range(0.4, 0.65), rot: rng.range(0, 6), spin: rng.range(-0.3, 0.3), phase: rng.range(0, 6), z0: -50, z1: GATE_Z - 1.2 });
  }
  for (let i = 0; i < 9; i++) {
    floes.push({ x: rng.range(R.minX + 0.9, R.maxX - 0.9), z: GATE_Z + 1.4 + i * 5.2, speed: rng.range(0.85, 1.05) * R.flowSpeed, size: rng.range(0.5, 1.0), rot: rng.range(0, 6), spin: rng.range(-0.4, 0.4), phase: rng.range(0, 6), z0: GATE_Z + 1.4, z1: 50 });
  }
  const floeMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 0.9, 0.16, 6),
    toon(PALETTE.ice),
    floes.length,
  );
  floeMesh.castShadow = false;
  floeMesh.receiveShadow = true;
  floeMesh.frustumCulled = false;
  group.add(floeMesh);
  const snowFloe = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.8, 0.8, 0.04, 6), toon(PALETTE.snow), floes.length);
  snowFloe.frustumCulled = false;
  snowFloe.receiveShadow = true;
  group.add(snowFloe);

  // ---- bank lip (timber, yard side) --------------------------------------
  const lip = new Batch();
  const logGeo = new THREE.CylinderGeometry(0.2, 0.2, 2.2, 8).rotateX(Math.PI / 2);
  const stakeGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.8, 7);
  const capGeo = new THREE.CylinderGeometry(0.2, 0.22, 0.08, 7);
  const lipX = R.maxX - 0.1;
  let alt = false;
  for (let z = LAYOUT.expandedMinZ - 0.4; z < 10.6; z += 2.3) {
    lip.add(logGeo, alt ? PALETTE.bark : PALETTE.barkDark, lipX, 0.2, z + 1.15);
    lip.add(logGeo, PALETTE.snow, lipX - 0.02, 0.4, z + 1.15, { sx: 0.5, sy: 1, sz: 0.97 });
    lip.add(stakeGeo, PALETTE.trunk, lipX, 0.34, z);
    lip.add(capGeo, PALETTE.snow, lipX, 0.76, z);
    alt = !alt;
  }
  group.add(lip.mesh());

  // ---- river gate -----------------------------------------------------------
  const gate = new Batch();
  const gx0 = R.minX + 0.35;
  const gx1 = R.maxX - 0.35;
  const postGeo = new THREE.BoxGeometry(0.55, 3.4, 0.55);
  const capG = new THREE.BoxGeometry(0.75, 0.14, 0.75);
  for (const x of [gx0, (gx0 + gx1) / 2 - 1.1, (gx0 + gx1) / 2 + 1.1, gx1]) {
    gate.add(postGeo, PALETTE.fenceDark, x, 0.4, GATE_Z);
    gate.add(capG, PALETTE.snow, x, 2.15, GATE_Z);
  }
  const plankLen = gx1 - gx0 + 0.55;
  const plankGeo = new THREE.BoxGeometry(plankLen, 0.34, 0.42);
  const planks: Array<[number, number]> = [
    [1.45, PALETTE.plank],
    [0.75, PALETTE.fence],
    [0.05, PALETTE.plank],
    [-0.6, PALETTE.fenceDark],
    [-1.1, PALETTE.fence],
  ];
  for (const [y, c] of planks) gate.add(plankGeo, c, (gx0 + gx1) / 2, y, GATE_Z - 0.04);
  gate.add(new THREE.BoxGeometry(plankLen * 0.98, 0.1, 0.5), PALETTE.snow, (gx0 + gx1) / 2, 1.66, GATE_Z - 0.04);
  // Cross braces.
  const brace = new THREE.BoxGeometry(0.2, 2.6, 0.12);
  gate.add(brace, PALETTE.fenceDark, gx0 + 1.45, 0.3, GATE_Z + 0.26, { rz: 0.8 });
  gate.add(brace, PALETTE.fenceDark, gx1 - 1.45, 0.3, GATE_Z + 0.26, { rz: -0.8 });
  group.add(gate.mesh());

  // Foam where the water spills past the gate.
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
  const foams: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const f = new THREE.Mesh(new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2), foamMat);
    f.position.set(R.minX + 0.8 + i * ((TILE_W - 1.6) / 6), R.waterY + 0.03, GATE_Z + 0.75 + (i % 2) * 0.3);
    f.renderOrder = 2;
    group.add(f);
    foams.push(f);
  }

  // ---- animation -----------------------------------------------------------------
  const dummy = new THREE.Object3D();
  let t = 0;
  const place = (): void => {
    for (let i = 0; i < floes.length; i++) {
      const f = floes[i]!;
      const span = f.z1 - f.z0;
      const u = (f.z - f.z0) / span;
      const fade = Math.min(1, u * 10, (1 - u) * 10);
      const s = f.size * Math.max(0.001, fade);
      dummy.position.set(f.x + Math.sin(t * 0.5 + f.phase) * 0.12, R.waterY + 0.03 + Math.sin(t * 1.3 + f.phase) * 0.025, f.z);
      dummy.rotation.set(Math.sin(t * 0.9 + f.phase) * 0.04, f.rot, Math.cos(t * 0.8 + f.phase) * 0.04);
      dummy.scale.set(s, 1, s);
      dummy.updateMatrix();
      floeMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.y += 0.1;
      dummy.scale.set(s * 0.82, 1, s * 0.82);
      dummy.updateMatrix();
      snowFloe.setMatrixAt(i, dummy.matrix);
    }
    floeMesh.instanceMatrix.needsUpdate = true;
    snowFloe.instanceMatrix.needsUpdate = true;
  };
  place();

  return {
    group,
    update(dt: number): void {
      t += dt;
      tex.offset.y = (tex.offset.y + (R.flowSpeed * dt) / TILE_D) % 1;
      for (const f of floes) {
        f.z += f.speed * dt;
        f.rot += f.spin * dt;
        if (f.z > f.z1) f.z = f.z0 + (f.z - f.z1);
      }
      place();
      for (let i = 0; i < foams.length; i++) {
        const k = 0.55 + 0.25 * Math.sin(t * 2.2 + i * 1.7);
        foams[i]!.scale.set(k * 0.95, 1, k * 0.55);
      }
    },
  };
}
