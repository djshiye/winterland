/**
 * [B5 — commerce] AssetFactory: shop furniture + NPC speech bubbles.
 *
 * - COUNTER: wooden table (length × depth × height; FENCE_WOOD), long axis along local X, origin at floor
 *   centre. Sturdy top slab with plank grooves, a beam under it, four legs, vertical-plank aprons on both
 *   long sides and a low shelf. Built from cached primitives, then baked into ONE vertex-coloured mesh
 *   (render/batch.ts): about 30 parts, 2 draw calls.
 * - SPEECH BUBBLE: camera-facing THREE.Sprite whose CanvasTexture is drawn on an offscreen canvas: white
 *   rounded bubble with a tail, an item icon (wood PLANK bundle, CRATE, LOG) with an optional count
 *   ("1/3") or a green check mark when the order is fulfilled. One canvas per bubble, redrawn in place
 *   (only when the content changes).
 */
import * as THREE from 'three';
import { COLORS, PALETTE } from '../config';
import { bake } from '../render/batch';
import { GAME_FONT, geo, makeCanvasTexture, mesh, toon } from '../render/materials';

// ---------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------

/** Wooden sales table. Origin = floor centre, long axis = local X. */
export function createCounterModel(length: number, depth: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const wood = toon(COLORS.FENCE_WOOD);
  const dark = toon(PALETTE.fenceDark);
  const light = toon(COLORS.PLANK_WOOD);

  const topH = 0.1;
  // Sturdy top slab (exactly length × depth) + two plank grooves.
  const top = mesh(geo.boxBase(length, topH, depth), wood);
  top.position.y = height - topH;
  g.add(top);
  for (const sz of [-1, 1]) {
    const groove = mesh(geo.box(length - 0.02, 0.006, 0.02), dark, { cast: false });
    groove.position.set(0, height + 0.002, (sz * depth) / 6);
    g.add(groove);
  }
  // Front/back lip planks that frame the top.
  for (const sz of [-1, 1]) {
    const lip = mesh(geo.box(length, 0.05, 0.05), light);
    lip.position.set(0, height - topH / 2 + 0.02, (sz * (depth - 0.05)) / 2);
    g.add(lip);
  }

  // Beam under the top.
  const beam = mesh(geo.boxBase(length - 0.1, 0.07, depth - 0.1), dark);
  beam.position.y = height - topH - 0.07;
  g.add(beam);

  // Legs.
  const legH = height - topH;
  const lx = length / 2 - 0.09;
  const lz = depth / 2 - 0.09;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = mesh(geo.boxBase(0.12, legH, 0.12), dark);
      leg.position.set(sx * lx, 0, sz * lz);
      g.add(leg);
    }
  }

  // Low shelf.
  const shelf = mesh(geo.boxBase(length - 0.2, 0.05, depth - 0.14), dark);
  shelf.position.y = 0.16;
  g.add(shelf);

  // Vertical-plank aprons (both long sides, so the table reads from either side of the fence).
  const planks = 7;
  const span = length - 0.3;
  const pw = span / planks;
  const ph = height - topH - 0.2;
  for (const sz of [-1, 1]) {
    for (let i = 0; i < planks; i++) {
      const p = mesh(geo.boxBase(pw - 0.025, ph, 0.04), i % 2 === 0 ? wood : light);
      p.position.set(-span / 2 + pw * (i + 0.5), 0.2, sz * (depth / 2 - 0.07));
      g.add(p);
    }
    for (const y of [0.17, height - topH - 0.1]) {
      const rail = mesh(geo.box(length - 0.22, 0.05, 0.05), dark);
      rail.position.set(0, y, sz * (depth / 2 - 0.05));
      g.add(rail);
    }
  }
  const model = new THREE.Group();
  model.name = 'counterModel';
  model.add(bake(g));
  return model;
}

// ---------------------------------------------------------------------------
// Speech bubble
// ---------------------------------------------------------------------------

export type BubbleIcon = 'plank' | 'crate' | 'log' | 'check';

export interface SpeechBubble {
  readonly sprite: THREE.Sprite;
  /** Redraw with an icon and optional text (e.g. "1/3"). No-op when nothing changed. */
  show(icon: BubbleIcon, text?: string): void;
  dispose(): void;
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

const SIZE = 160;
const BUBBLE_BOTTOM = 124;

function bubbleBody(g: CanvasRenderingContext2D, accent: string): void {
  g.clearRect(0, 0, SIZE, SIZE);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // tail
  g.beginPath();
  g.moveTo(62, BUBBLE_BOTTOM - 4);
  g.lineTo(80, 154);
  g.lineTo(98, BUBBLE_BOTTOM - 4);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.strokeStyle = accent;
  g.lineWidth = 8;
  g.stroke();
  g.fill();
  // body
  g.beginPath();
  g.roundRect(8, 8, SIZE - 16, BUBBLE_BOTTOM - 8, 30);
  g.fillStyle = '#ffffff';
  g.strokeStyle = accent;
  g.lineWidth = 8;
  g.stroke();
  g.fill();
  // cover the tail's top outline so the tail merges with the body
  g.fillStyle = '#ffffff';
  g.fillRect(66, BUBBLE_BOTTOM - 14, 28, 14);
}

function drawPlank(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // a small bundle: three planks, the top one offset
  const w = 78 * s;
  const h = 17 * s;
  const rows = [
    { x: -3 * s, y: 20 * s, w },
    { x: 3 * s, y: 0, w },
    { x: -2 * s, y: -20 * s, w: w * 0.92 },
  ];
  for (const r of rows) {
    g.beginPath();
    g.roundRect(cx + r.x - r.w / 2, cy + r.y - h / 2, r.w, h, 5 * s);
    g.fillStyle = hex(COLORS.PLANK_WOOD);
    g.fill();
    g.lineWidth = 3.5 * s;
    g.strokeStyle = hex(PALETTE.fenceDark);
    g.stroke();
    // wood grain
    g.beginPath();
    g.moveTo(cx + r.x - r.w * 0.28, cy + r.y - 1 * s);
    g.lineTo(cx + r.x + r.w * 0.1, cy + r.y - 1 * s);
    g.lineWidth = 2.5 * s;
    g.strokeStyle = hex(COLORS.LOG_CORE);
    g.stroke();
  }
}

function drawCrate(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const w = 62 * s;
  g.beginPath();
  g.roundRect(cx - w / 2, cy - w / 2, w, w, 7 * s);
  g.fillStyle = hex(COLORS.CRATE_BOX);
  g.fill();
  g.lineWidth = 5 * s;
  g.strokeStyle = hex(COLORS.CRATE_STRIP);
  g.stroke();
  g.lineWidth = 7 * s;
  g.beginPath();
  g.moveTo(cx - w / 2 + 6 * s, cy - w / 2 + 6 * s);
  g.lineTo(cx + w / 2 - 6 * s, cy + w / 2 - 6 * s);
  g.moveTo(cx + w / 2 - 6 * s, cy - w / 2 + 6 * s);
  g.lineTo(cx - w / 2 + 6 * s, cy + w / 2 - 6 * s);
  g.stroke();
}

function drawLog(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  const len = 70 * s;
  const r = 20 * s;
  // bark body
  g.beginPath();
  g.roundRect(cx - len / 2, cy - r, len, r * 2, r * 0.5);
  g.fillStyle = hex(COLORS.LOG_BARK);
  g.fill();
  g.lineWidth = 4 * s;
  g.strokeStyle = hex(PALETTE.barkDark);
  g.stroke();
  // end cap
  g.beginPath();
  g.ellipse(cx + len / 2 - 4 * s, cy, 11 * s, r, 0, 0, Math.PI * 2);
  g.fillStyle = hex(COLORS.LOG_CORE);
  g.fill();
  g.lineWidth = 3 * s;
  g.strokeStyle = hex(PALETTE.woodRing);
  g.stroke();
  g.beginPath();
  g.ellipse(cx + len / 2 - 4 * s, cy, 5 * s, r * 0.5, 0, 0, Math.PI * 2);
  g.stroke();
}

function drawCheck(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  g.beginPath();
  g.arc(cx, cy, 36 * s, 0, Math.PI * 2);
  g.fillStyle = hex(COLORS.CASH_GREEN);
  g.fill();
  g.beginPath();
  g.moveTo(cx - 17 * s, cy + 1 * s);
  g.lineTo(cx - 5 * s, cy + 14 * s);
  g.lineTo(cx + 19 * s, cy - 14 * s);
  g.lineWidth = 11 * s;
  g.strokeStyle = '#ffffff';
  g.stroke();
}

/**
 * Camera-facing bubble. `scale` = world height of the whole sprite. Rendered on top of everything
 * (depthTest off) so counters / vehicles never hide it.
 */
export function createSpeechBubble(scale = 1.1): SpeechBubble {
  const { ctx: g, texture } = makeCanvasTexture(SIZE, SIZE);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, fog: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scale, scale, 1);
  sprite.renderOrder = 998;
  // Anchor the tail tip (not the sprite centre) at the sprite position.
  sprite.center.set(0.5, 0.04);
  sprite.name = 'speechBubble';
  let lastKey = '';
  return {
    sprite,
    show(icon: BubbleIcon, text?: string): void {
      const key = `${icon}|${text ?? ''}`;
      if (key === lastKey) return;
      lastKey = key;
      const done = icon === 'check';
      bubbleBody(g, done ? hex(COLORS.CASH_GREEN) : hex(PALETTE.fenceDark));
      const cx = SIZE / 2;
      const hasText = !!text;
      const cy = hasText ? 52 : 66;
      const s = hasText ? 0.92 : 1.12;
      if (icon === 'plank') drawPlank(g, cx, cy, s);
      else if (icon === 'crate') drawCrate(g, cx, cy, s);
      else if (icon === 'log') drawLog(g, cx, cy, s);
      else drawCheck(g, cx, cy, 1.2);
      if (hasText) {
        g.font = `800 40px ${GAME_FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 9;
        g.strokeStyle = '#ffffff';
        g.strokeText(text, cx, 103);
        g.fillStyle = hex(PALETTE.rubber);
        g.fillText(text, cx, 103);
      }
      texture.needsUpdate = true;
    },
    dispose(): void {
      texture.dispose();
      material.dispose();
    },
  };
}

export const shopCatalog: Record<string, () => THREE.Object3D> = {
  counter: () => createCounterModel(1.6, 0.6, 0.8),
  bubblePlank: () => {
    const b = createSpeechBubble();
    b.show('plank', '1/3');
    return b.sprite;
  },
  bubbleCrate: () => {
    const b = createSpeechBubble();
    b.show('crate', '2/4');
    return b.sprite;
  },
  bubbleLog: () => {
    const b = createSpeechBubble();
    b.show('log', '5/10');
    return b.sprite;
  },
  bubbleDone: () => {
    const b = createSpeechBubble();
    b.show('check');
    return b.sprite;
  },
};
