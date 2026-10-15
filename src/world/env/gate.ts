/** The village gate in the yard's south fence: two swinging palisade leaves under a "WINTERLAND VILLAGE" arch. */
import * as THREE from 'three';
import { COLORS, LAYOUT, PALETTE } from '../../config';
import { PALISADE, palisadePostGeometry } from '../../assets/scenery';
import { Batch, vcMat } from '../../render/batch';
import { GAME_FONT, makeCanvasTexture, toon } from '../../render/materials';
import type { GameContext } from '../../core/types';
import type { EnvPart } from './common';

export interface GatePart extends EnvPart {
  /** Swing the leaves open (instant: no animation). */
  open(instant: boolean): void;
  readonly isOpen: boolean;
  /** Pin / unpin the contract paper on the notice board beside the gate (follows the contract events; see buildGate). */
  setPosted(on: boolean): void;
}

/** The notice board just outside the yard fence, west of the gate gap (clear of the walk corridor x 3.8..5.4). */
const BOARD = { x: 2.2, z: 10.9, yaw: 0.45 };

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

/** A pinned contract paper (the notice board's only extra draw call, and only while a contract is posted). */
function paperTexture(): THREE.CanvasTexture {
  const { canvas, ctx: g, texture } = makeCanvasTexture(128, 160);
  const paint = (): void => {
    g.fillStyle = '#f6ecd2';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = '#c9b184';
    g.lineWidth = 4;
    g.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#b0301f';
    g.font = `bold 22px ${GAME_FONT}`;
    g.fillText('CONTRACT', canvas.width / 2, 24);
    g.fillStyle = '#7a5a34';
    for (let i = 0; i < 4; i++) g.fillRect(18, 50 + i * 18, i === 3 ? 56 : 92, 5);
    g.fillStyle = '#2e9c48';
    g.font = `bold 28px ${GAME_FONT}`;
    g.fillText('$$$', canvas.width / 2, 132);
    g.fillStyle = '#e8553e';
    g.beginPath();
    g.arc(canvas.width / 2, 7, 6, 0, Math.PI * 2);
    g.fill();
    texture.needsUpdate = true;
  };
  paint();
  void document.fonts?.ready.then(paint);
  return texture;
}

/**
 * ctx: the notice board registers its collider and follows the contract events by itself ('contract:offered' pins
 * the paper, 'contract:done' / 'contract:failed' take it down; a restored active contract is posted at once).
 */
export function buildGate(ctx: GameContext): GatePart {
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
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 0.72, 0.1),
    [PALETTE.fenceDark, PALETTE.fenceDark, PALETTE.fenceDark, PALETTE.fenceDark].map((c) => toon(c)).concat([toon(0xffffff, { map: signTexture() }), toon(PALETTE.fenceDark)]),
  );
  board.position.set((ax0 + ax1) / 2, H - 0.62, z + 0.12);
  board.castShadow = true;
  group.add(board);

  // ---- notice board: two posts + a wooden board (batched into the arch mesh: no extra draw call) and a paper -----
  {
    const place = new THREE.Matrix4().makeTranslation(BOARD.x, 0, BOARD.z).multiply(new THREE.Matrix4().makeRotationY(BOARD.yaw));
    const m = new THREE.Matrix4();
    const piece = (geo: THREE.BufferGeometry, color: number, x: number, y: number, zz: number): void => {
      arch.addMatrix(geo, color, m.copy(place).multiply(new THREE.Matrix4().makeTranslation(x, y, zz)));
    };
    for (const px of [-0.42, 0.42]) {
      piece(new THREE.BoxGeometry(0.12, 1.45, 0.12), PALETTE.fenceDark, px, 0.725, 0);
      piece(new THREE.BoxGeometry(0.16, 0.05, 0.16), PALETTE.snow, px, 1.47, 0);
    }
    piece(new THREE.BoxGeometry(1.1, 0.72, 0.07), PALETTE.fence, 0, 1.0, 0.07);
    piece(new THREE.BoxGeometry(1.2, 0.07, 0.11), PALETTE.fenceDark, 0, 1.4, 0.07);
    piece(new THREE.BoxGeometry(1.14, 0.05, 0.1), PALETTE.snow, 0, 1.45, 0.07);
    ctx.colliders.addBox({ minX: BOARD.x - 0.6, maxX: BOARD.x + 0.6, minZ: BOARD.z - 0.15, maxZ: BOARD.z + 0.15 }, 'noticeBoard');
  }
  group.add(arch.mesh());
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), toon(0xffffff, { map: paperTexture() }));
  paper.position.set(BOARD.x + Math.sin(BOARD.yaw) * 0.125, 1.0, BOARD.z + Math.cos(BOARD.yaw) * 0.125);
  paper.rotation.set(0, BOARD.yaw, 0.05);
  paper.visible = false;
  group.add(paper);
  const setPosted = (on: boolean): void => {
    paper.visible = on;
  };
  setPosted(ctx.state.contract.kind !== '');
  ctx.events.on('contract:offered', () => setPosted(true));
  ctx.events.on('contract:done', () => setPosted(false));
  ctx.events.on('contract:failed', () => setPosted(false));

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
    setPosted,
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

