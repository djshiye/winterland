/**
 * [B7 — progression] AssetFactory: upgrade-pad tile + its canvas texture + floating label sign.
 *
 * Art spec — createPadTexture(iconType, costText, progressRatio):
 * - 256×256 offscreen canvas. Dark grey #4A4A4A (COLORS.PAD_BG) rounded rect with a white border,
 *   lineWidth 10.
 * - Green #2ECC71 (COLORS.PAD_FILL) fill rising from the bottom to the top with progressRatio (0..1 =
 *   paid fraction), clipped to the rounded rect.
 * - White silhouette icon in the upper half: chainsaw for the harvester ('saw'), factory box for the
 *   processor ('factory'), conveyor arrows for belts ('conveyor'), giant blade for the mega saw
 *   ('megasaw').
 * - Green bill icon bottom-left + bold 56px white text (GAME_FONT) with the remaining amount.
 * - Cheap to RE-RENDER whenever the cost decrements: pass `target` to redraw an existing texture's
 *   canvas in place (texture.needsUpdate = true) instead of allocating a new one. Fredoka may load after
 *   the first draw, so every texture redraws itself once when the font is ready.
 */
import * as THREE from 'three';
import { CAMERA, COLORS, PALETTE, type PadDef } from '../config';
import { GAME_FONT, basic, geo, makeCanvasTexture, mesh, toon } from '../render/materials';

export type PadIcon = PadDef['icon'];

const SIZE = 256;
const BORDER = 10;
/** Corner radius of the border's centre line (outer edge radius = this + BORDER / 2). */
const CORNER = 36;

const hex = (c: number): string => `#${new THREE.Color(c).getHexString()}`;

// ---------------------------------------------------------------------------
// Canvas drawing
// ---------------------------------------------------------------------------

function roundedRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r);
  g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h);
  g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r);
  g.arcTo(x, y, x + r, y, r);
  g.closePath();
}

/** Sub-path version (does not begin a new path) for even-odd cut-outs. */
function addRoundedRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Harvester: a chunky chainsaw (body, rear handle, toothed guide bar). Local box ≈ ±60. */
function drawSaw(g: CanvasRenderingContext2D): void {
  g.beginPath();
  addRoundedRect(g, -58, -20, 58, 44, 11); // engine body
  g.fill();
  // rear handle loop
  g.lineWidth = 9;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-50, -20);
  g.quadraticCurveTo(-52, -46, -22, -44);
  g.lineTo(-6, -44);
  g.stroke();
  // front hand guard
  g.beginPath();
  addRoundedRect(g, -12, -34, 10, 16, 4);
  g.fill();
  // guide bar with a cut-out slot
  g.beginPath();
  addRoundedRect(g, -4, -13, 66, 26, 13);
  addRoundedRect(g, 8, -4.5, 42, 9, 4.5);
  g.fill('evenodd');
  // chain teeth along both edges
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const x = 6 + i * 10;
    g.moveTo(x, -13);
    g.lineTo(x + 5, -21);
    g.lineTo(x + 10, -13);
    g.moveTo(x, 13);
    g.lineTo(x + 5, 21);
    g.lineTo(x + 10, 13);
  }
  g.fill();
  // pull-start knob
  g.beginPath();
  g.arc(-30, 2, 7, 0, Math.PI * 2);
  g.arc(-30, 2, 3, 0, Math.PI * 2);
  g.fill('evenodd');
}

/** Processor: factory box with sawtooth roof, chimney and a big door. Local box ≈ ±60. */
function drawFactory(g: CanvasRenderingContext2D): void {
  // chimney
  g.beginPath();
  addRoundedRect(g, 28, -58, 17, 40, 3);
  g.fill();
  // smoke puffs
  g.beginPath();
  g.arc(40, -60, 7, 0, Math.PI * 2);
  g.arc(52, -68, 5, 0, Math.PI * 2);
  g.fill();
  // body with sawtooth roof (even-odd: door + windows are cut out)
  g.beginPath();
  g.moveTo(-58, 48);
  g.lineTo(-58, -14);
  g.lineTo(-30, -36);
  g.lineTo(-30, -14);
  g.lineTo(-2, -36);
  g.lineTo(-2, -14);
  g.lineTo(26, -36);
  g.lineTo(26, -14);
  g.lineTo(58, -14);
  g.lineTo(58, 48);
  g.closePath();
  addRoundedRect(g, -20, 8, 40, 40, 5); // door
  addRoundedRect(g, -48, -4, 20, 16, 3); // windows
  addRoundedRect(g, 28, -4, 20, 16, 3);
  g.fill('evenodd');
  // door slats
  g.fillRect(-20, 22, 40, 4);
}

/** Conveyors: belt bar with wheels and two chevron arrows. Local box ≈ ±60. */
function drawConveyor(g: CanvasRenderingContext2D): void {
  // belt body
  g.beginPath();
  addRoundedRect(g, -60, 12, 120, 26, 13);
  addRoundedRect(g, -48, 20, 96, 10, 5);
  g.fill('evenodd');
  // rollers
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(-33 + i * 22, 25, 4, 0, Math.PI * 2);
    g.fill();
  }
  // support feet
  g.fillRect(-46, 38, 10, 14);
  g.fillRect(36, 38, 10, 14);
  // chevrons ( >> )
  g.lineWidth = 15;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const ox of [-26, 12]) {
    g.beginPath();
    g.moveTo(ox, -40);
    g.lineTo(ox + 24, -18);
    g.lineTo(ox, 4);
    g.stroke();
  }
}

/** Mega saw: the giant circular blade (toothed disc with an arbor hole and spokes). Local box ≈ ±60. */
function drawMegaSaw(g: CanvasRenderingContext2D): void {
  const teeth = 12;
  const rOut = 60;
  const rIn = 47;
  g.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.8) / teeth) * Math.PI * 2;
    const a2 = ((i + 1) / teeth) * Math.PI * 2;
    // hooked tooth: ramps out to the tip, drops straight back to the root
    if (i === 0) g.moveTo(Math.cos(a0) * rIn, Math.sin(a0) * rIn);
    g.lineTo(Math.cos(a1) * rOut, Math.sin(a1) * rOut);
    g.lineTo(Math.cos(a1 + 0.03) * rIn, Math.sin(a1 + 0.03) * rIn);
    g.lineTo(Math.cos(a2) * rIn, Math.sin(a2) * rIn);
  }
  g.closePath();
  // arbor hole + 4 lightening holes
  g.moveTo(11, 0);
  g.arc(0, 0, 11, 0, Math.PI * 2, true);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = Math.cos(a) * 28;
    const cy = Math.sin(a) * 28;
    g.moveTo(cx + 9, cy);
    g.arc(cx, cy, 9, 0, Math.PI * 2, true);
  }
  g.fill('evenodd');
}

const ICONS: Record<PadIcon, (g: CanvasRenderingContext2D) => void> = {
  saw: drawSaw,
  factory: drawFactory,
  conveyor: drawConveyor,
  megasaw: drawMegaSaw,
};

/** Little banknote: CASH_GREEN with a white band, white outline so it reads on grey AND on the green fill. */
function drawBill(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(-0.12);
  roundedRectPath(g, -40, -24, 80, 48, 9);
  g.fillStyle = hex(COLORS.CASH_GREEN);
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = hex(COLORS.CASH_BAND);
  g.fillRect(-9, -24, 18, 48);
  g.fillStyle = hex(PALETTE.cashDark);
  g.beginPath();
  g.arc(0, 0, 8, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

interface PadTextureParams {
  icon: PadIcon;
  text: string;
  ratio: number;
}

const params = new WeakMap<THREE.CanvasTexture, PadTextureParams>();
const fontHooked = new WeakSet<THREE.CanvasTexture>();

function draw(texture: THREE.CanvasTexture, p: PadTextureParams): void {
  const canvas = texture.image as HTMLCanvasElement;
  const g = canvas.getContext('2d')!;
  const ratio = Math.min(1, Math.max(0, p.ratio));
  g.clearRect(0, 0, SIZE, SIZE);

  const inset = BORDER / 2;
  // background
  roundedRectPath(g, inset, inset, SIZE - BORDER, SIZE - BORDER, CORNER);
  g.fillStyle = hex(COLORS.PAD_BG);
  g.fill();

  // progress fill, rising bottom -> top, clipped to the rounded rect
  if (ratio > 0) {
    g.save();
    roundedRectPath(g, inset, inset, SIZE - BORDER, SIZE - BORDER, CORNER);
    g.clip();
    const top = SIZE - SIZE * ratio;
    g.fillStyle = hex(COLORS.PAD_FILL);
    g.fillRect(0, top, SIZE, SIZE - top);
    if (ratio < 1) {
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.fillRect(0, top, SIZE, 4);
    }
    g.restore();
  }

  // border
  roundedRectPath(g, inset, inset, SIZE - BORDER, SIZE - BORDER, CORNER);
  g.lineWidth = BORDER;
  g.strokeStyle = hex(COLORS.PAD_BORDER);
  g.stroke();

  // white silhouette icon, upper half
  g.save();
  g.translate(128, 90);
  g.scale(1.04, 1.04);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  ICONS[p.icon](g);
  g.restore();

  // bill icon (bottom-left) + remaining amount
  drawBill(g, 56, 196);
  g.font = `700 56px ${GAME_FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 9;
  g.strokeStyle = hex(COLORS.PAD_BG);
  g.fillStyle = '#ffffff';
  const tx = 104;
  const ty = 200;
  const maxW = SIZE - BORDER - 12 - tx;
  g.strokeText(p.text, tx, ty, maxW);
  g.fillText(p.text, tx, ty, maxW);

  texture.needsUpdate = true;
}

export function createPadTexture(
  iconType: PadIcon,
  costText: string,
  progressRatio: number,
  target?: THREE.CanvasTexture,
): THREE.CanvasTexture {
  const texture = target ?? makeCanvasTexture(SIZE, SIZE).texture;
  const p: PadTextureParams = { icon: iconType, text: costText, ratio: progressRatio };
  params.set(texture, p);
  draw(texture, p);
  hookFont(texture);
  return texture;
}

/** Fredoka may finish loading after the first draw: redraw once with the latest parameters. */
function hookFont(texture: THREE.CanvasTexture): void {
  if (fontHooked.has(texture) || typeof document === 'undefined' || !document.fonts) return;
  fontHooked.add(texture);
  const redraw = (): void => {
    const p = params.get(texture);
    if (p) draw(texture, p);
  };
  document.fonts
    .load(`700 56px ${GAME_FONT}`)
    .catch(() => undefined)
    .then(() => document.fonts.ready)
    .then(redraw, redraw);
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const SLAB_HEIGHT = 0.16;
const slabCache = new Map<string, THREE.BufferGeometry>();

/** Rounded square slab (cached), top face at y = SLAB_HEIGHT, matching the texture's outer edge. */
function slabGeometry(side: number): THREE.BufferGeometry {
  const key = side.toFixed(3);
  let g = slabCache.get(key);
  if (!g) {
    const r = ((CORNER + BORDER / 2) / SIZE) * side;
    const h = side / 2;
    const s = new THREE.Shape();
    s.moveTo(-h + r, -h);
    s.lineTo(h - r, -h);
    s.absarc(h - r, -h + r, r, -Math.PI / 2, 0, false);
    s.lineTo(h, h - r);
    s.absarc(h - r, h - r, r, 0, Math.PI / 2, false);
    s.lineTo(-h + r, h);
    s.absarc(-h + r, h - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-h, -h + r);
    s.absarc(-h + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
    g = new THREE.ExtrudeGeometry(s, { depth: SLAB_HEIGHT, bevelEnabled: false, curveSegments: 6 });
    g.rotateX(-Math.PI / 2); // extrusion now points up (+Y)
    slabCache.set(key, g);
  }
  return g;
}

export interface PadModelOptions {
  /**
   * Rotation of the tile around Y. Default: the camera yaw, so the texture's "up" points to the top of the
   * screen and the text reads upright. The tile is then a square on screen (a diamond-in-diamond on the ground).
   */
  yaw?: number;
  /** Side of the visible tile as a fraction of `size` (default 1). */
  fill?: number;
}

/** Floor tile showing `texture` on a chunky rounded slab; origin at the tile's floor centre. */
export function createPadModel(size: number, texture: THREE.Texture, opts: PadModelOptions = {}): THREE.Group {
  const yaw = opts.yaw ?? THREE.MathUtils.degToRad(CAMERA.yawDeg);
  const side = size * (opts.fill ?? 1);
  const root = new THREE.Group();
  root.name = 'padModel';
  const slab = mesh(slabGeometry(side), toon(PALETTE.padBase), { cast: false });
  root.add(slab);
  const top = mesh(geo.ground(side, side), basic(0xffffff, { map: texture, transparent: true, depthWrite: false }), {
    cast: false,
    receive: false,
  });
  top.position.y = SLAB_HEIGHT + 0.006;
  top.renderOrder = 3;
  root.add(top);
  root.rotation.y = yaw;
  const holder = new THREE.Group();
  holder.add(root);
  return holder;
}

/** Floating label sign ("HARVESTER"): rounded dark plate, white border + bold text. Face it to the camera. */
export function createPadSign(label: string): THREE.Mesh {
  const w = 512;
  const h = 128;
  const { ctx: g, texture } = makeCanvasTexture(w, h);
  const paint = (): void => {
    g.clearRect(0, 0, w, h);
    roundedRectPath(g, 5, 5, w - 10, h - 10, 36);
    g.fillStyle = hex(COLORS.PAD_BG);
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = hex(COLORS.PAD_BORDER);
    g.stroke();
    g.font = `700 64px ${GAME_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText(label, w / 2, h / 2 + 4, w - 60);
    texture.needsUpdate = true;
  };
  paint();
  if (typeof document !== 'undefined' && document.fonts) {
    void document.fonts
      .load(`700 64px ${GAME_FONT}`)
      .catch(() => undefined)
      .then(paint);
  }
  const m = new THREE.Mesh(geo.plane(2.5, 0.625), basic(0xffffff, { map: texture, transparent: true, depthWrite: false }));
  m.renderOrder = 4;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

export const padCatalog: Record<string, () => THREE.Object3D> = {
  padHarvester: () => createPadModel(2.2, createPadTexture('saw', '$100', 0.35)),
  padProcessor: () => createPadModel(2.2, createPadTexture('factory', '$200', 0)),
  padConveyor: () => createPadModel(2.2, createPadTexture('conveyor', '$150', 0.7)),
  padMegaSaw: () => createPadModel(2.2, createPadTexture('megasaw', '$200', 1)),
  padSign: () => {
    // Tilted to face the gallery's isometric camera (the in-game sign copies the camera quaternion instead).
    const sign = createPadSign('MEGA SAWMILL');
    sign.rotation.order = 'YXZ';
    sign.rotation.set(-THREE.MathUtils.degToRad(CAMERA.pitchDeg), THREE.MathUtils.degToRad(CAMERA.yawDeg), 0);
    return new THREE.Group().add(sign);
  },
};
