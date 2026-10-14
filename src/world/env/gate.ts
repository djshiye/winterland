/** The village gate in the yard's south fence: two swinging palisade leaves under a "WINTERLAND VILLAGE" arch. */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE } from '../../config';
import { PALISADE, palisadePostGeometry } from '../../assets/scenery';
import { Batch, vcMat } from '../../render/batch';
import { GAME_FONT, makeCanvasTexture, toon } from '../../render/materials';
import type { EnvPart } from './common';

export interface GatePart extends EnvPart {
  /** Swing the leaves open (instant: no animation). */
  open(instant: boolean): void;
  readonly isOpen: boolean;
}

const OPEN_TIME = 0.8;
const easeBack = (t: number): number => {
  const c1 = 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function signTexture(): THREE.CanvasTexture {
  const { canvas, ctx: g, texture } = makeCanvasTexture(1024, 256);
  const paint = (): void => {
    g.fillStyle = '#7f5328';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#c98f52';
    g.fillRect(14, 14, canvas.width - 28, canvas.height - 28);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.font = `bold 112px ${GAME_FONT}`;
    g.lineWidth = 16;
    g.strokeStyle = '#5a3a1c';
    g.strokeText('WINTERLAND', canvas.width / 2, canvas.height * 0.36);
    g.fillStyle = '#fff6e0';
    g.fillText('WINTERLAND', canvas.width / 2, canvas.height * 0.36);
    g.font = `bold 92px ${GAME_FONT}`;
    g.strokeText('VILLAGE', canvas.width / 2, canvas.height * 0.74);
    g.fillStyle = '#ffd34d';
    g.fillText('VILLAGE', canvas.width / 2, canvas.height * 0.74);
    texture.needsUpdate = true;
  };
  paint();
  void document.fonts?.ready.then(paint);
  texture.anisotropy = 8;
  return texture;
}

export function buildGate(): GatePart {
  const group = new THREE.Group();
  group.name = 'villageGate';
  const gate = LAYOUT.village.gate;
  const z = LAYOUT.yard.maxZ;
  // Inner edges of the sturdier gate posts that flank the gap (radius 0.12 × 1.35).
  const inset = PALISADE.radius * 1.35;
  const hingeL = gate.minX + inset;
  const hingeR = gate.maxX - inset;
  const leafLen = (hingeR - hingeL) / 2;

  const leafGeometry = (dir: 1 | -1): THREE.BufferGeometry => {
    const b = new Batch();
    const m = new THREE.Matrix4();
    const n = Math.round(leafLen / PALISADE.spacing);
    for (let i = 0; i < n; i++) {
      m.makeTranslation(dir * (0.12 + i * ((leafLen - 0.24) / (n - 1))), 0, 0);
      b.addMatrix(palisadePostGeometry(), COLORS.FENCE_WOOD, m);
    }
    for (const y of [0.32, 0.7]) b.add(new THREE.BoxGeometry(leafLen, 0.09, 0.07), PALETTE.fenceDark, (dir * leafLen) / 2, y, 0.13);
    return b.geometry();
  };
  const makeLeaf = (hinge: number, dir: 1 | -1): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(hinge, 0, z);
    const mesh = new THREE.Mesh(leafGeometry(dir), vcMat());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  };
  const leafL = makeLeaf(hingeL, 1);
  const leafR = makeLeaf(hingeR, -1);

  // ---- arch with sign ---------------------------------------------------------------------
  const arch = new Batch();
  const ax0 = gate.minX - 0.25;
  const ax1 = gate.maxX + 0.25;
  const H = 3.05;
  for (const x of [ax0, ax1]) {
    arch.add(new THREE.BoxGeometry(0.28, H, 0.28), PALETTE.fenceDark, x, H / 2, z);
    arch.add(new THREE.BoxGeometry(0.44, 0.1, 0.44), PALETTE.snow, x, H + 0.04, z);
  }
  arch.add(new THREE.BoxGeometry(ax1 - ax0 + 0.5, 0.2, 0.32), PALETTE.fence, (ax0 + ax1) / 2, H - 0.1, z);
  arch.add(new THREE.BoxGeometry(ax1 - ax0 + 0.4, 0.09, 0.4), PALETTE.snow, (ax0 + ax1) / 2, H + 0.04, z);
  group.add(arch.mesh());
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 0.72, 0.1),
    [PALETTE.fenceDark, PALETTE.fenceDark, PALETTE.fenceDark, PALETTE.fenceDark].map((c) => toon(c)).concat([toon(0xffffff, { map: signTexture() }), toon(PALETTE.fenceDark)]),
  );
  board.position.set((ax0 + ax1) / 2, H - 0.62, z + 0.12);
  board.castShadow = true;
  group.add(board);

  // ---- animation --------------------------------------------------------------------------
  let isOpen = false;
  let t = 0;
  let animating = false;
  const apply = (k: number): void => {
    leafL.rotation.y = -(Math.PI / 2) * k;
    leafR.rotation.y = (Math.PI / 2) * k;
  };
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

