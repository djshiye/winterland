/**
 * The Timber Ridge gate in the yard's east fence (LAYOUT.ridge.gate): two swinging palisade leaves under a
 * "TIMBER RIDGE" arch. Built closed and always visible (the fence has a gap there from frame 0); open() swings the
 * leaves outward (+X, over the road). Mirrors env/gate.ts, turned to run along Z.
 */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE } from '../../config';
import { PALISADE, palisadePostGeometry } from '../../assets/scenery';
import { Batch, vcMat } from '../../render/batch';
import { GAME_FONT, makeCanvasTexture, toon } from '../../render/materials';
import type { EnvPart } from './common';

export interface RidgeGatePart extends EnvPart {
  /** Swing the leaves open (instant: no animation). */
  open(instant: boolean): void;
  readonly isOpen: boolean;
}

const OPEN_TIME = 0.9;
const easeBack = (t: number): number => {
  const c1 = 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function signTexture(): THREE.CanvasTexture {
  const { canvas, ctx: g, texture } = makeCanvasTexture(1024, 256);
  const paint = (): void => {
    g.fillStyle = '#5a3a1c';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#2f7a55';
    g.fillRect(14, 14, canvas.width - 28, canvas.height - 28);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.font = `bold 120px ${GAME_FONT}`;
    g.lineWidth = 18;
    g.strokeStyle = '#173f2c';
    g.strokeText('TIMBER', canvas.width / 2, canvas.height * 0.34);
    g.fillStyle = '#fff6e0';
    g.fillText('TIMBER', canvas.width / 2, canvas.height * 0.34);
    g.font = `bold 100px ${GAME_FONT}`;
    g.strokeText('RIDGE', canvas.width / 2, canvas.height * 0.73);
    g.fillStyle = '#ffd34d';
    g.fillText('RIDGE', canvas.width / 2, canvas.height * 0.73);
    texture.needsUpdate = true;
  };
  paint();
  void document.fonts?.ready.then(paint);
  texture.anisotropy = 8;
  return texture;
}

export function buildRidgeGate(): RidgeGatePart {
  const group = new THREE.Group();
  group.name = 'ridgeGate';
  const gap = LAYOUT.ridge.gate;
  const x = LAYOUT.yard.maxX;
  const inset = PALISADE.radius * 1.35;
  const hingeLo = gap.minZ + inset;
  const hingeHi = gap.maxZ - inset;
  const leafLen = (hingeHi - hingeLo) / 2;

  /** A leaf along local +X (cross bars on the side that faces +X, toward the road). */
  const leafGeometry = (bar: 1 | -1): THREE.BufferGeometry => {
    const b = new Batch();
    const m = new THREE.Matrix4();
    const n = Math.round(leafLen / PALISADE.spacing);
    for (let i = 0; i < n; i++) {
      m.makeTranslation(0.12 + i * ((leafLen - 0.24) / (n - 1)), 0, 0);
      b.addMatrix(palisadePostGeometry(), COLORS.FENCE_WOOD, m);
    }
    for (const y of [0.32, 0.7]) b.add(new THREE.BoxGeometry(leafLen, 0.09, 0.07), PALETTE.fenceDark, leafLen / 2, y, 0.13 * bar);
    return b.geometry();
  };
  const makeLeaf = (hinge: number, bar: 1 | -1): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0, hinge);
    const mesh = new THREE.Mesh(leafGeometry(bar), vcMat());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  };
  const leafLo = makeLeaf(hingeLo, -1);
  const leafHi = makeLeaf(hingeHi, 1);

  // ---- arch with sign (beam along Z, board facing +X) -----------------------------------------
  const arch = new Batch();
  const az0 = gap.minZ - 0.25;
  const az1 = gap.maxZ + 0.25;
  const H = 3.05;
  for (const z of [az0, az1]) {
    arch.add(new THREE.BoxGeometry(0.28, H, 0.28), PALETTE.fenceDark, x, H / 2, z);
    arch.add(new THREE.BoxGeometry(0.44, 0.1, 0.44), PALETTE.snow, x, H + 0.04, z);
  }
  arch.add(new THREE.BoxGeometry(0.32, 0.2, az1 - az0 + 0.5), PALETTE.fence, x, H - 0.1, (az0 + az1) / 2);
  arch.add(new THREE.BoxGeometry(0.4, 0.09, az1 - az0 + 0.4), PALETTE.snow, x, H + 0.04, (az0 + az1) / 2);
  // a pair of log braces
  for (const s of [-1, 1]) {
    arch.add(new THREE.BoxGeometry(0.1, 0.7, 0.1), PALETTE.bark, x, H - 0.6, (az0 + az1) / 2 + s * ((az1 - az0) / 2 - 0.45), { rx: s * 0.7 });
  }
  group.add(arch.mesh());
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.78, 0.1),
    [PALETTE.fenceDark, PALETTE.fenceDark, PALETTE.fenceDark, PALETTE.fenceDark].map((c) => toon(c)).concat([toon(0xffffff, { map: signTexture() }), toon(PALETTE.fenceDark)]),
  );
  board.rotation.y = Math.PI / 2;
  board.position.set(x + 0.14, H - 0.66, (az0 + az1) / 2);
  board.castShadow = true;
  group.add(board);

  // ---- animation --------------------------------------------------------------------------------
  // Closed: leaf Lo points +Z (yaw −π/2), leaf Hi points −Z (yaw +π/2). Open: both point +X (yaw 0).
  let isOpen = false;
  let t = 0;
  let animating = false;
  const apply = (k: number): void => {
    leafLo.rotation.y = -(Math.PI / 2) * (1 - k);
    leafHi.rotation.y = (Math.PI / 2) * (1 - k);
  };
  apply(0);
  return {
    group,
    get isOpen(): boolean {
      return isOpen;
    },
    open(instant: boolean): void {
      if (isOpen) return;
      isOpen = true;
      if (instant) {
        animating = false;
        apply(1);
      } else {
        animating = true;
        t = 0;
      }
    },
    update(dt: number): void {
      if (!animating) return;
      t += dt;
      const k = Math.min(1, t / OPEN_TIME);
      apply(easeBack(k));
      if (k >= 1) {
        animating = false;
        apply(1);
      }
    },
  };
}
