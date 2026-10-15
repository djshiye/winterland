/** Snow world (with the river channel cut out), warm dirt yard, dirt patches, footprints. */
import * as THREE from 'three';
import { LAYOUT, PALETTE } from '../../config';
import { geo, mesh, toon } from '../../render/materials';
import { instanced, W, type EnvPart, type Placement } from './common';

export interface GroundPart extends EnvPart {
  /** Dirt that grows north on expansion (origin on its south edge). */
  readonly dirtExtension: THREE.Group;
}

function flat(w: number, d: number, cx: number, cz: number, y: number, color: number, receive = true): THREE.Mesh {
  const m = mesh(geo.ground(w, d), toon(color), { cast: false, receive });
  m.position.set(cx, y, cz);
  return m;
}

export function buildGround(): GroundPart {
  const group = new THREE.Group();
  group.name = 'ground';
  const R = LAYOUT.river;
  // 0.9.0: the era regions, roads and city districts reach z 156 / x 142; ±320 keeps the plane's edge out of every view.
  const SIZE = 640;
  const half = SIZE / 2;

  // Snow, in pieces around the river hole.
  group.add(flat(half + R.minX, SIZE, (R.minX - half) / 2, 0, 0, PALETTE.snow));
  group.add(flat(half - R.maxX, SIZE, (R.maxX + half) / 2, 0, 0, PALETTE.snow));
  group.add(flat(R.maxX - R.minX, half + R.minZ, (R.minX + R.maxX) / 2, (R.minZ - half) / 2, 0, PALETTE.snow));
  group.add(flat(R.maxX - R.minX, half - R.maxZ, (R.minX + R.maxX) / 2, (R.maxZ + half) / 2, 0, PALETTE.snow));

  // River bed + visible bank walls (the camera only ever sees the west wall's +X face).
  group.add(flat(R.maxX - R.minX, R.maxZ - R.minZ, (R.minX + R.maxX) / 2, (R.minZ + R.maxZ) / 2, R.bedY, PALETTE.waterDeep, false));
  const wallH = -R.waterY + 0.05;
  const wallW = mesh(geo.plane(R.maxZ - R.minZ, wallH + 0.9), toon(0xbad2ea), { cast: false });
  wallW.rotation.y = Math.PI / 2;
  wallW.position.set(R.minX + 0.01, -(wallH + 0.9) / 2 + 0.0, (R.minZ + R.maxZ) / 2);
  group.add(wallW);
  const wallE = wallW.clone();
  wallE.rotation.y = -Math.PI / 2;
  wallE.position.x = R.maxX - 0.01;
  group.add(wallE);

  // Yard: dark border under a lighter dirt plane (thin planes: pads/slabs sit on top of them).
  const bw = W.yardMaxX - W.yardMinX;
  const bd = W.yardMaxZ - W.yardMinZ;
  group.add(flat(bw + 0.5, bd + 0.5, (W.yardMinX + W.yardMaxX) / 2 + 0.2, (W.yardMinZ + W.yardMaxZ) / 2, 0.006, PALETTE.yardDirtDark));
  group.add(flat(bw, bd, (W.yardMinX + W.yardMaxX) / 2, (W.yardMinZ + W.yardMaxZ) / 2, 0.01, PALETTE.yardDirt));

  // Worn, darker patches in the dirt (kept clear of pads / zones' centres).
  const patches: Placement[] = [
    { x: -8.3, z: 8.2, sx: 1.7, sz: 1.2 },
    { x: -1.2, z: -7.0, sx: 1.9, sz: 1.1 },
    { x: 2.6, z: -5.6, sx: 1.2, sz: 0.9 },
    { x: 8.4, z: 8.7, sx: 1.1, sz: 1.5 },
    { x: 1.8, z: 6.2, sx: 1.5, sz: 1.1 },
    { x: -9.0, z: -2.2, sx: 0.9, sz: 1.4 },
    { x: 4.2, z: -8.4, sx: 1.4, sz: 0.8 },
    { x: 7.4, z: -1.2, sx: 1.1, sz: 1.3 },
    { x: -3.0, z: -6.2, sx: 0.9, sz: 0.7 },
  ].map((p) => ({ ...p, y: 0.014 }));
  group.add(instanced(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), toon(PALETTE.yardDirtDark), patches, { cast: false }));

  // Dirt extension (phase 5), grows toward -Z from the current north edge.
  const dirtExtension = new THREE.Group();
  dirtExtension.position.z = W.yardMinZ;
  const extD = LAYOUT.expandedMinZ - W.yardMinZ; // negative
  const ext = Math.abs(extD);
  const border = mesh(geo.ground(bw + 0.5, ext).clone().translate(0.2, 0, -ext / 2), toon(PALETTE.yardDirtDark), { cast: false });
  border.position.y = 0.006;
  const dirt = mesh(geo.ground(bw, ext).clone().translate(0, 0, -ext / 2), toon(PALETTE.yardDirt), { cast: false });
  dirt.position.y = 0.01;
  dirtExtension.add(border, dirt);
  dirtExtension.scale.z = 0.001;
  dirtExtension.visible = false;
  group.add(dirtExtension);

  // Customer path: packed snow lane with footprints, tricycle road etc. live in roads.ts.
  const path = LAYOUT.customers.path;
  const pw = path.maxX - path.minX;
  const pd = path.maxZ - path.minZ;
  group.add(flat(pw, pd, (path.minX + path.maxX) / 2, (path.minZ + path.maxZ) / 2, 0.008, 0xe6eef8));
  const prints: Placement[] = [];
  for (let z = 12.4, i = 0; z < path.maxZ - 1; z += 1.35, i++) {
    prints.push({ x: -4.0 + (i % 2 ? 0.28 : -0.28), y: 0.012, z, sx: 0.16, sz: 0.28 });
    prints.push({ x: -2.3 + (i % 2 ? -0.25 : 0.25), y: 0.012, z: z + 0.5, sx: 0.16, sz: 0.28 });
  }
  group.add(instanced(new THREE.CircleGeometry(1, 8).rotateX(-Math.PI / 2), toon(0xc5d3e5), prints, { cast: false }));

  return { group, dirtExtension };
}
