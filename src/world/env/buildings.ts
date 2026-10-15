/** Cosy log cabin (+ chimney), lamp posts, the WINTERLAND LUMBER CO. sign and a snowman. */
import * as THREE from 'three';
import { LAYOUT, PALETTE } from '../../config';
import { GAME_FONT, makeCanvasTexture, toon } from '../../render/materials';
import type { GameContext } from '../../core/types';
import { Batch, type EnvPart } from './common';
import { buildHalos, registerGlow, type HaloSpot } from './glow';

export interface BuildingsPart extends EnvPart {
  /** World position of the chimney mouth (smoke source). */
  readonly chimney: THREE.Vector3;
}

const ROOF_RED = 0xc4472f;
const ROOF_RED_DARK = 0x9e3524;
const WARM = 0xffd978;

/** Lamp post spots: yard corners, clear of every zone / pad / path. */
// (The SE-corner lamp is gone: from the camera it stood right in front of the processor pad's sign.)
const LAMPS: Array<[number, number]> = [
  [-9.6, 7.3],
  [9.4, -3.6],
];

function buildCabin(cx: number, cz: number, glow: Batch): Batch {
  const b = new Batch();
  const c = LAYOUT.cabin;
  const w = c.maxX - c.minX - 0.2;
  const d = c.maxZ - c.minZ - 0.2;
  const wallH = 1.75;
  const base = 0.28;
  b.add(new THREE.BoxGeometry(w + 0.25, base, d + 0.25), PALETTE.rock, cx, base / 2, cz);
  b.add(new THREE.BoxGeometry(w - 0.3, wallH + 0.1, d - 0.3), PALETTE.barkDark, cx, base + wallH / 2, cz);
  // Horizontal log courses on every face (chunky toy logs).
  const logX = new THREE.CylinderGeometry(0.2, 0.2, w + 0.2, 8).rotateZ(Math.PI / 2);
  const logZ = new THREE.CylinderGeometry(0.2, 0.2, d + 0.2, 8).rotateX(Math.PI / 2);
  const rows = 4;
  for (let i = 0; i < rows; i++) {
    const y = base + 0.2 + i * 0.4;
    const col = i % 2 ? PALETTE.fence : PALETTE.plank;
    for (const s of [-1, 1]) {
      b.add(logX, col, cx, y, cz + (s * (d - 0.4)) / 2 + (i % 2 ? 0 : 0));
      b.add(logZ, i % 2 ? PALETTE.plank : PALETTE.fence, cx + (s * (w - 0.4)) / 2, y, cz);
    }
  }
  // Gable roof (ridge along X) with overhang, snow on top.
  const run = d / 2 + 0.25;
  const rise = 1.15;
  const ang = Math.atan2(rise, run);
  const slope = Math.hypot(run, rise) + 0.1;
  const eaveY = base + wallH + 0.05;
  const roofLen = w + 0.7;
  const slab = new THREE.BoxGeometry(roofLen, 0.18, slope);
  const snow = new THREE.BoxGeometry(roofLen - 0.45, 0.2, slope - 0.75);
  for (const s of [-1, 1]) {
    const yMid = eaveY + rise / 2;
    b.add(slab, s > 0 ? ROOF_RED : ROOF_RED_DARK, cx, yMid, cz + (s * run) / 2, { rx: s * ang });
    b.add(snow, PALETTE.snow, cx, yMid + 0.2 + 0.2 * Math.cos(ang), cz + (s * run) / 2 - s * 0.3 * Math.cos(ang), { rx: s * ang });
  }
  b.add(new THREE.BoxGeometry(roofLen, 0.16, 0.28), PALETTE.snow, cx, eaveY + rise + 0.2, cz);
  // Gable end triangles (log colour).
  const tri = new THREE.Shape([new THREE.Vector2(-d / 2 + 0.15, 0), new THREE.Vector2(d / 2 - 0.15, 0), new THREE.Vector2(0, rise - 0.05)]);
  const gable = new THREE.ExtrudeGeometry(tri, { depth: 0.3, bevelEnabled: false }).rotateY(Math.PI / 2);
  for (const s of [-1, 1]) b.add(gable, PALETTE.fence, cx + (s * (w - 0.5)) / 2 - 0.15 + (s > 0 ? 0.0 : 0), eaveY, cz);
  // Chimney (stone) with snow cap.
  const chx = cx - 0.9;
  const chz = cz - 0.55;
  b.add(new THREE.BoxGeometry(0.6, 2.2, 0.6), PALETTE.rock, chx, eaveY + 0.9, chz);
  b.add(new THREE.BoxGeometry(0.78, 0.14, 0.78), PALETTE.rockDark, chx, eaveY + 2.0, chz);
  b.add(new THREE.BoxGeometry(0.7, 0.1, 0.7), PALETTE.snow, chx, eaveY + 2.12, chz);
  // Door (+Z face), porch step, windows (+Z and +X faces).
  const zf = cz + d / 2 - 0.1;
  b.add(new THREE.BoxGeometry(0.85, 1.3, 0.14), 0x6a3f1f, cx - 0.8, base + 0.65, zf + 0.08);
  b.add(new THREE.BoxGeometry(1.1, 0.14, 0.14), PALETTE.fenceDark, cx - 0.8, base + 1.36, zf + 0.1);
  b.add(new THREE.SphereGeometry(0.07, 6, 4), PALETTE.accent, cx - 0.5, base + 0.65, zf + 0.17);
  b.add(new THREE.BoxGeometry(1.4, 0.12, 0.5), PALETTE.rockDark, cx - 0.8, 0.06, zf + 0.35);
  const win = new THREE.BoxGeometry(0.72, 0.6, 0.06);
  const frameG = new THREE.BoxGeometry(0.9, 0.78, 0.09);
  glow.add(win, WARM, cx + 0.85, base + 1.0, zf + 0.12);
  b.add(frameG, PALETTE.fenceDark, cx + 0.85, base + 1.0, zf + 0.07);
  const xf = cx + w / 2 - 0.1;
  glow.add(win, WARM, xf + 0.12, base + 1.0, cz, { ry: Math.PI / 2 });
  b.add(frameG, PALETTE.fenceDark, xf + 0.07, base + 1.0, cz, { ry: Math.PI / 2 });
  // Woodpile against the +X wall.
  const stack = new THREE.CylinderGeometry(0.14, 0.14, 1.0, 7).rotateX(Math.PI / 2);
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 3 - r; k++) {
      b.add(stack, (r + k) % 2 ? PALETTE.plank : PALETTE.bark, xf + 0.5 + r * 0.0, 0.14 + r * 0.25, cz - 0.7 + k * 0.3 + r * 0.15);
    }
  }
  return b;
}

function signTexture(): THREE.CanvasTexture {
  const { canvas, ctx: g, texture } = makeCanvasTexture(1024, 256);
  const draw = (): void => {
    paintSign(canvas, g);
    texture.needsUpdate = true;
  };
  draw();
  // Redraw once the web font has loaded (the first paint may use a fallback face).
  void document.fonts?.ready.then(draw);
  texture.anisotropy = 8;
  return texture;
}

function paintSign(canvas: HTMLCanvasElement, g: CanvasRenderingContext2D): void {
  const w = canvas.width;
  const h = canvas.height;
  g.fillStyle = '#7f5328';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#c98f52';
  g.fillRect(14, 14, w - 28, h - 28);
  g.strokeStyle = 'rgba(127,83,40,0.35)';
  g.lineWidth = 3;
  for (const y of [h * 0.33, h * 0.66]) {
    g.beginPath();
    g.moveTo(14, y);
    g.lineTo(w - 14, y);
    g.stroke();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold 118px ${GAME_FONT}`;
  g.lineJoin = 'round';
  g.lineWidth = 16;
  g.strokeStyle = '#5a3a1c';
  g.strokeText('WINTERLAND', w / 2, h * 0.38);
  g.fillStyle = '#fff6e0';
  g.fillText('WINTERLAND', w / 2, h * 0.38);
  g.font = `bold 78px ${GAME_FONT}`;
  g.lineWidth = 12;
  g.strokeText('LUMBER CO.', w / 2, h * 0.76);
  g.fillStyle = '#ffd34d';
  g.fillText('LUMBER CO.', w / 2, h * 0.76);
}

export function buildBuildings(ctx: GameContext): BuildingsPart {
  const group = new THREE.Group();
  group.name = 'buildings';
  const c = LAYOUT.cabin;
  const cx = (c.minX + c.maxX) / 2;
  const cz = (c.minZ + c.maxZ) / 2;

  // Cabin
  const glow = new Batch();
  const cabin = buildCabin(cx, cz, glow);
  group.add(cabin.mesh());
  group.add(glow.mesh({ cast: false, material: registerGlow(toon(0xffffff, { emissive: WARM, emissiveIntensity: 0.9 })) }));
  ctx.colliders.addBox(c, 'cabin');
  const chimney = new THREE.Vector3(cx - 0.9, 0.28 + 1.75 + 0.05 + 2.2, cz - 0.55);

  // Lamp posts
  const lamps = new Batch();
  const lampGlow = new Batch();
  const halos: HaloSpot[] = [];
  for (const [x, z] of LAMPS) {
    lamps.add(new THREE.CylinderGeometry(0.2, 0.26, 0.3, 8), PALETTE.metalDark, x, 0.15, z);
    lamps.add(new THREE.CylinderGeometry(0.07, 0.1, 3.0, 8), PALETTE.metalDark, x, 1.5, z);
    lamps.add(new THREE.BoxGeometry(0.46, 0.08, 0.46), PALETTE.metalDark, x, 3.05, z);
    lampGlow.add(new THREE.BoxGeometry(0.32, 0.42, 0.32), WARM, x, 3.3, z);
    halos.push({ x, y: 3.3, z });
    lamps.add(new THREE.ConeGeometry(0.4, 0.3, 4), PALETTE.rubber, x, 3.66, z, { ry: Math.PI / 4 });
    lamps.add(new THREE.CylinderGeometry(0.2, 0.34, 0.1, 4), PALETTE.snow, x, 3.8, z, { ry: Math.PI / 4 });
    ctx.colliders.addCircle(x, z, 0.3, 'lamp');
  }
  group.add(lamps.mesh());
  group.add(lampGlow.mesh({ cast: false, material: registerGlow(toon(0xffffff, { emissive: WARM, emissiveIntensity: 1 })) }));
  group.add(buildHalos(halos, { size: 2.6, pool: 6 }));

  // Sign outside the south fence, west of the walk-in gap (turned toward the camera for legibility).
  const signRoot = new THREE.Group();
  signRoot.position.set(-8.2, 0, 11.6);
  signRoot.rotation.y = 0.5;
  const sign = new Batch();
  for (const dx of [-2.35, 2.35]) {
    sign.add(new THREE.BoxGeometry(0.3, 3.4, 0.3), PALETTE.fenceDark, dx, 1.7, 0);
    sign.add(new THREE.BoxGeometry(0.46, 0.1, 0.46), PALETTE.snow, dx, 3.45, 0);
  }
  sign.add(new THREE.BoxGeometry(5.1, 0.12, 0.45), PALETTE.snow, 0, 3.25, 0);
  signRoot.add(sign.mesh());
  const wood = toon(PALETTE.fenceDark);
  const face = toon(0xffffff, { map: signTexture() });
  const board = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.2, 0.16), [wood, wood, wood, wood, face, wood]);
  board.castShadow = true;
  board.receiveShadow = true;
  board.position.set(0, 2.45, 0.2);
  signRoot.add(board);
  group.add(signRoot);

  // Snowman near the customer path.
  const sm = new Batch();
  const smx = -8.6;
  const smz = 14.4;
  sm.add(new THREE.SphereGeometry(0.62, 12, 8), PALETTE.snow, smx, 0.55, smz);
  sm.add(new THREE.SphereGeometry(0.46, 12, 8), PALETTE.snow, smx, 1.3, smz);
  sm.add(new THREE.SphereGeometry(0.34, 12, 8), PALETTE.snow, smx, 1.9, smz);
  sm.add(new THREE.ConeGeometry(0.07, 0.4, 6).rotateX(Math.PI / 2), 0xf08a2e, smx + 0.2, 1.9, smz + 0.3, { ry: 0.5 });
  sm.add(new THREE.CylinderGeometry(0.2, 0.24, 0.3, 8), PALETTE.rubber, smx, 2.3, smz);
  sm.add(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 8), PALETTE.rubber, smx, 2.16, smz);
  sm.add(new THREE.TorusGeometry(0.33, 0.07, 6, 12).rotateX(Math.PI / 2), PALETTE.truckRed, smx, 1.62, smz);
  for (const e of [-0.12, 0.12]) sm.add(new THREE.SphereGeometry(0.04, 5, 4), PALETTE.rubber, smx + 0.2 + e * 0.3, 1.98, smz + 0.27 - e * 0.5);
  for (let i = 0; i < 3; i++) sm.add(new THREE.SphereGeometry(0.05, 5, 4), PALETTE.rubber, smx + 0.38, 1.4 - i * 0.17, smz + 0.25);
  group.add(sm.mesh());

  return { group, chimney };
}
