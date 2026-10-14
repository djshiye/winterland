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
 * - Level pads (machines with upgrade levels) draw a gold border and an "LV n" badge (`badge` argument).
 * - createConstructionTexture: the village construction pads (shelter icon, logs left + cash left rows).
 * - createShopSign / createMatTexture / createPadSign: the doormat sign + rug and the floating label signs.
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

/** Timber Ridge: a snow-capped mountain with a pine beside it. Local box ≈ ±60. */
function drawRidge(g: CanvasRenderingContext2D): void {
  // mountain; the snow line is a zig-zag band cut out (even-odd) just under the summit
  g.beginPath();
  g.moveTo(-16, 50);
  g.lineTo(24, -52);
  g.lineTo(64, 50);
  g.closePath();
  g.moveTo(10, -14);
  g.lineTo(17, -6);
  g.lineTo(24, -14);
  g.lineTo(31, -5);
  g.lineTo(38, -14);
  g.lineTo(42, -8);
  g.lineTo(31, 3);
  g.lineTo(24, -6);
  g.lineTo(17, 4);
  g.lineTo(6, -8);
  g.closePath();
  g.fill('evenodd');
  // a lower shoulder peak
  g.beginPath();
  g.moveTo(34, 50);
  g.lineTo(52, 12);
  g.lineTo(70, 50);
  g.closePath();
  g.fill();
  // pine tree (three tiers + trunk), clear of the mountain
  g.beginPath();
  g.moveTo(-42, -56);
  g.lineTo(-30, -30);
  g.lineTo(-37, -30);
  g.lineTo(-25, -6);
  g.lineTo(-33, -6);
  g.lineTo(-20, 28);
  g.lineTo(-36, 28);
  g.lineTo(-36, 50);
  g.lineTo(-48, 50);
  g.lineTo(-48, 28);
  g.lineTo(-64, 28);
  g.lineTo(-51, -6);
  g.lineTo(-59, -6);
  g.lineTo(-47, -30);
  g.lineTo(-54, -30);
  g.closePath();
  g.fill();
}

/** Tree feller: a tracked forestry machine with a felling boom and a round saw head. Local box ≈ ±60. */
function drawFeller(g: CanvasRenderingContext2D): void {
  // tracks with three wheel cut-outs
  g.beginPath();
  addRoundedRect(g, -58, 28, 100, 26, 13);
  for (const x of [-38, -8, 22]) {
    g.moveTo(x + 6, 41);
    g.arc(x, 41, 6, 0, Math.PI * 2, true);
  }
  g.fill('evenodd');
  // body + cab window
  g.beginPath();
  addRoundedRect(g, -48, -6, 64, 30, 9);
  addRoundedRect(g, -40, 0, 22, 14, 4);
  g.fill('evenodd');
  // exhaust stack
  g.fillRect(-14, -22, 7, 18);
  // boom arm (two segments) reaching up to the head
  g.lineWidth = 11;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(6, 6);
  g.lineTo(28, -26);
  g.lineTo(48, -30);
  g.stroke();
  // saw head: toothed disc with an arbor hole
  g.beginPath();
  const cx = 50;
  const cy = -34;
  const teeth = 9;
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.75) / teeth) * Math.PI * 2;
    const a2 = ((i + 1) / teeth) * Math.PI * 2;
    if (i === 0) g.moveTo(cx + Math.cos(a0) * 11, cy + Math.sin(a0) * 11);
    g.lineTo(cx + Math.cos(a1) * 18, cy + Math.sin(a1) * 18);
    g.lineTo(cx + Math.cos(a1 + 0.04) * 11, cy + Math.sin(a1 + 0.04) * 11);
    g.lineTo(cx + Math.cos(a2) * 11, cy + Math.sin(a2) * 11);
  }
  g.closePath();
  g.moveTo(cx + 5, cy);
  g.arc(cx, cy, 5, 0, Math.PI * 2, true);
  g.fill('evenodd');
}

/** Truck loader: an inclined belt carrying a log (with end rings), on two legs. Local box ≈ ±60. */
function drawLoader(g: CanvasRenderingContext2D): void {
  g.save();
  g.rotate(-0.2);
  // belt body with an inner slot and rollers
  g.beginPath();
  addRoundedRect(g, -60, 12, 120, 26, 13);
  addRoundedRect(g, -48, 20, 96, 10, 5);
  g.fill('evenodd');
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(-33 + i * 22, 25, 4, 0, Math.PI * 2);
    g.fill();
  }
  // the log riding on it: a long rounded bar with a growth-ring end and a bark notch
  g.beginPath();
  addRoundedRect(g, -34, -24, 68, 32, 16);
  g.moveTo(-14 + 8, -8);
  g.arc(-14, -8, 8, 0, Math.PI * 2, true);
  g.moveTo(-14 + 3, -8);
  g.arc(-14, -8, 3, 0, Math.PI * 2, false);
  g.fill('evenodd');
  g.restore();
  // legs
  g.fillRect(-46, 44, 10, 14);
  g.fillRect(36, 32, 10, 20);
}

/** Cash tubes: a pneumatic tube with a capsule (marked $) shooting through it. Local box ≈ ±60. */
function drawTubes(g: CanvasRenderingContext2D): void {
  // tube: rounded outer wall, hollow inside (even-odd), and the capsule sitting in the hollow (filled again)
  g.beginPath();
  addRoundedRect(g, -60, -22, 120, 52, 26);
  addRoundedRect(g, -51, -13, 102, 34, 17);
  addRoundedRect(g, -20, -9, 56, 26, 13); // capsule
  g.fill('evenodd');
  // clamp rings
  g.fillRect(-44, -30, 9, 68);
  g.fillRect(38, -30, 9, 68);
  // dollar sign cut into the capsule
  g.save();
  g.fillStyle = hex(COLORS.PAD_BG);
  g.font = `700 24px ${GAME_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('$', 8, 5);
  g.restore();
  // little intake funnel + stand under the tube
  g.beginPath();
  g.moveTo(-18, 36);
  g.lineTo(18, 36);
  g.lineTo(8, 56);
  g.lineTo(-8, 56);
  g.closePath();
  g.fill();
}

const ICONS: Record<PadIcon, (g: CanvasRenderingContext2D) => void> = {
  saw: drawSaw,
  factory: drawFactory,
  conveyor: drawConveyor,
  megasaw: drawMegaSaw,
  ridge: drawRidge,
  feller: drawFeller,
  loader: drawLoader,
  tubes: drawTubes,
};


// --- shelter icons (village construction pads) -------------------------------------------------------------

export type ShelterIcon = 'tent' | 'hut' | 'cabin' | 'lodge' | 'greatLodge';

/** Add a closed polygon sub-path. */
function poly(g: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[]): void {
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  g.closePath();
}

function drawTent(g: CanvasRenderingContext2D): void {
  g.beginPath();
  poly(g, [[-60, 50], [0, -42], [60, 50]]);
  poly(g, [[-17, 50], [0, 4], [17, 50]]); // door
  g.fill('evenodd');
  g.fillRect(-64, 50, 128, 7); // ground
  g.fillRect(-2.5, -62, 5, 24); // pole
  g.beginPath();
  poly(g, [[2, -62], [26, -54], [2, -46]]); // pennant
  g.fill();
}

function drawHut(g: CanvasRenderingContext2D): void {
  g.beginPath();
  poly(g, [[-60, 0], [0, -46], [60, 0]]); // roof
  g.fill();
  g.fillRect(28, -48, 13, 26); // chimney
  g.beginPath();
  addRoundedRect(g, -46, 6, 92, 46, 4);
  addRoundedRect(g, -13, 20, 26, 32, 4); // door
  addRoundedRect(g, 20, 16, 18, 16, 3); // window
  addRoundedRect(g, -40, 16, 18, 16, 3);
  g.fill('evenodd');
}

function drawCabin(g: CanvasRenderingContext2D): void {
  g.beginPath();
  poly(g, [[-64, -2], [-36, -42], [36, -42], [64, -2]]); // roof
  g.fill();
  g.fillRect(30, -56, 15, 24); // chimney
  g.beginPath();
  addRoundedRect(g, -56, 4, 112, 50, 4);
  addRoundedRect(g, -12, 22, 24, 32, 4); // door
  addRoundedRect(g, 24, 16, 20, 18, 3); // windows
  addRoundedRect(g, -44, 16, 20, 18, 3);
  g.fill('evenodd');
  // log seams
  g.fillStyle = hex(COLORS.PAD_BG);
  g.fillRect(-56, 40, 112, 3);
  g.fillStyle = '#ffffff';
}

function drawLodge(g: CanvasRenderingContext2D): void {
  g.beginPath();
  poly(g, [[-42, -22], [0, -58], [42, -22]]); // upper roof
  g.fill();
  g.beginPath();
  addRoundedRect(g, -34, -18, 68, 32, 3); // upper floor
  addRoundedRect(g, -8, -10, 16, 16, 8); // round window
  g.fill('evenodd');
  g.beginPath();
  poly(g, [[-66, 20], [-50, 8], [50, 8], [66, 20]]); // porch roof
  g.fill();
  g.beginPath();
  addRoundedRect(g, -56, 22, 112, 32, 3);
  addRoundedRect(g, -10, 28, 20, 26, 10); // arched door
  addRoundedRect(g, 24, 28, 20, 14, 3);
  addRoundedRect(g, -44, 28, 20, 14, 3);
  g.fill('evenodd');
  g.fillRect(34, -56, 12, 20); // chimney
}

function drawGreatLodge(g: CanvasRenderingContext2D): void {
  // wings
  for (const sx of [-1, 1]) {
    g.save();
    g.scale(sx, 1);
    g.beginPath();
    poly(g, [[28, 4], [46, -18], [66, 4]]);
    g.fill();
    g.beginPath();
    addRoundedRect(g, 28, 8, 38, 46, 3);
    addRoundedRect(g, 38, 20, 18, 16, 3);
    g.fill('evenodd');
    g.restore();
  }
  // centre hall
  g.beginPath();
  poly(g, [[-30, -22], [0, -58], [30, -22]]);
  g.fill();
  g.beginPath();
  addRoundedRect(g, -26, -18, 52, 72, 3);
  addRoundedRect(g, -11, 22, 22, 32, 11); // arched door
  addRoundedRect(g, -8, -8, 16, 20, 8); // tall window
  g.fill('evenodd');
  g.fillRect(-2.5, -76, 5, 22); // flagpole
  g.beginPath();
  poly(g, [[2, -76], [24, -69], [2, -62]]);
  g.fill();
  g.fillRect(-70, 54, 140, 6);
}

const SHELTER_ICONS: Record<ShelterIcon, (g: CanvasRenderingContext2D) => void> = {
  tent: drawTent,
  hut: drawHut,
  cabin: drawCabin,
  lodge: drawLodge,
  greatLodge: drawGreatLodge,
};

/** A small log lying on its side: bark body, LOG_CORE end cap with a ring. */
function drawLogIcon(g: CanvasRenderingContext2D, x: number, y: number, k = 1): void {
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.rotate(-0.14);
  roundedRectPath(g, -34, -15, 62, 30, 12);
  g.fillStyle = hex(COLORS.LOG_BARK);
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = hex(COLORS.LOG_CORE);
  g.beginPath();
  g.ellipse(26, 0, 11, 15, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = hex(PALETTE.woodRing);
  g.beginPath();
  g.ellipse(26, 0, 5, 8, 0, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/** White check mark (a requirement that is complete). */
function drawCheck(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.save();
  g.lineWidth = 12;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#ffffff';
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + 14, y + 14);
  g.lineTo(x + 40, y - 16);
  g.stroke();
  g.restore();
}

/** "$4000" / "$16k" / "$12.5k": keeps big prices inside the 56 px text slot. */
export function formatCost(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 10000) return `$${v}`;
  const k = v / 1000;
  return `$${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

/** Little banknote: CASH_GREEN with a white band, white outline so it reads on grey AND on the green fill. */
function drawBill(g: CanvasRenderingContext2D, x: number, y: number, k = 1): void {
  g.save();
  g.translate(x, y);
  g.scale(k, k);
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
  kind: 'pad' | 'construction';
  icon: PadIcon | ShelterIcon;
  text: string;
  ratio: number;
  /** Level pads: "LV 2" badge + gold border. */
  badge?: string | undefined;
  /** Construction pads: requirement rows. */
  logs?: { left: number; total: number };
  cash?: { left: number; total: number };
}

const params = new WeakMap<THREE.CanvasTexture, PadTextureParams>();
const fontHooked = new WeakSet<THREE.CanvasTexture>();

function draw(texture: THREE.CanvasTexture, p: PadTextureParams): void {
  if (p.kind === 'construction') return drawConstruction(texture, p);
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
  g.strokeStyle = hex(p.badge ? PALETTE.accent : COLORS.PAD_BORDER);
  g.stroke();

  // white silhouette icon, upper half (shifted left/down a little when the level badge is drawn)
  g.save();
  g.translate(p.badge ? 112 : 128, p.badge ? 96 : 90);
  g.scale(p.badge ? 0.9 : 1.04, p.badge ? 0.9 : 1.04);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  ICONS[p.icon as PadIcon](g);
  g.restore();

  if (p.badge) {
    roundedRectPath(g, 160, 22, 80, 40, 14);
    g.fillStyle = hex(PALETTE.accent);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.font = `700 28px ${GAME_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = hex(COLORS.PAD_BG);
    g.fillText(p.badge, 200, 43, 70);
  }

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
  badge?: string,
): THREE.CanvasTexture {
  const texture = target ?? makeCanvasTexture(SIZE, SIZE).texture;
  const p: PadTextureParams = { kind: 'pad', icon: iconType, text: costText, ratio: progressRatio, badge };
  params.set(texture, p);
  draw(texture, p);
  hookFont(texture);
  return texture;
}


function drawConstructionRow(
  g: CanvasRenderingContext2D,
  y: number,
  kind: 'log' | 'cash',
  req: { left: number; total: number },
): void {
  if (kind === 'log') drawLogIcon(g, 58, y, 0.95);
  else drawBill(g, 56, y, 0.75);
  if (req.left <= 0) {
    drawCheck(g, 108, y);
    return;
  }
  g.font = `700 50px ${GAME_FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 9;
  g.strokeStyle = hex(COLORS.PAD_BG);
  g.fillStyle = '#ffffff';
  const text = kind === 'log' ? `${req.left}` : formatCost(req.left);
  const maxW = SIZE - BORDER - 14 - 104;
  g.strokeText(text, 104, y + 2, maxW);
  g.fillText(text, 104, y + 2, maxW);
}

function drawConstruction(texture: THREE.CanvasTexture, p: PadTextureParams): void {
  const g = (texture.image as HTMLCanvasElement).getContext('2d')!;
  const ratio = Math.min(1, Math.max(0, p.ratio));
  g.clearRect(0, 0, SIZE, SIZE);
  const inset = BORDER / 2;
  roundedRectPath(g, inset, inset, SIZE - BORDER, SIZE - BORDER, CORNER);
  g.fillStyle = hex(COLORS.PAD_BG);
  g.fill();
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
  roundedRectPath(g, inset, inset, SIZE - BORDER, SIZE - BORDER, CORNER);
  g.lineWidth = BORDER;
  g.strokeStyle = hex(COLORS.PAD_BORDER);
  g.stroke();

  g.save();
  g.translate(128, 76);
  g.scale(0.78, 0.78);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  SHELTER_ICONS[p.icon as ShelterIcon](g);
  g.restore();

  if (p.logs) drawConstructionRow(g, 158, 'log', p.logs);
  if (p.cash) drawConstructionRow(g, 208, 'cash', p.cash);
  texture.needsUpdate = true;
}

/**
 * Construction pad face: shelter icon on top, then "log icon + logs left" and "bill icon + cash left" rows (a
 * finished requirement shows a check mark). The fill rises with the combined progress. Redraws `target` in place.
 */
export function createConstructionTexture(
  icon: ShelterIcon,
  logs: { left: number; total: number },
  cash: { left: number; total: number },
  target?: THREE.CanvasTexture,
): THREE.CanvasTexture {
  const texture = target ?? makeCanvasTexture(SIZE, SIZE).texture;
  const part = (r: { left: number; total: number }): number => (r.total > 0 ? 1 - r.left / r.total : 1);
  const p: PadTextureParams = { kind: 'construction', icon, text: '', ratio: (part(logs) + part(cash)) / 2, logs, cash };
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

const signPainters = new WeakMap<THREE.Mesh, (label: string) => void>();

/** Floating label sign ("HARVESTER"): rounded dark plate, white border + bold text. Face it to the camera. */
export function createPadSign(label: string, gold = false): THREE.Mesh {
  const w = 512;
  const h = 128;
  const { ctx: g, texture } = makeCanvasTexture(w, h);
  let text = label;
  const paint = (): void => {
    g.clearRect(0, 0, w, h);
    roundedRectPath(g, 5, 5, w - 10, h - 10, 36);
    g.fillStyle = hex(COLORS.PAD_BG);
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = gold ? hex(PALETTE.accent) : hex(COLORS.PAD_BORDER);
    g.stroke();
    g.font = `700 64px ${GAME_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText(text, w / 2, h / 2 + 4, w - 60);
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
  signPainters.set(m, (l) => {
    if (l === text) return;
    text = l;
    paint();
  });
  return m;
}

/** Repaint a sign made by createPadSign with a new label (no-op when unchanged). */
export function setPadSignLabel(sign: THREE.Mesh, label: string): void {
  signPainters.get(sign)?.(label);
}

/** The cabin doormat's floating sign: green up-arrow + "UPGRADES" on a dark plate with a gold rim. */
export function createShopSign(): THREE.Mesh {
  const w = 512;
  const h = 160;
  const { ctx: g, texture } = makeCanvasTexture(w, h);
  const paint = (): void => {
    g.clearRect(0, 0, w, h);
    roundedRectPath(g, 5, 5, w - 10, h - 10, 40);
    g.fillStyle = hex(COLORS.PAD_BG);
    g.fill();
    g.lineWidth = 9;
    g.strokeStyle = hex(PALETTE.accent);
    g.stroke();
    // up arrow
    g.save();
    g.translate(86, 82);
    g.beginPath();
    poly(g, [[0, -46], [38, -4], [16, -4], [16, 44], [-16, 44], [-16, -4], [-38, -4]]);
    g.fillStyle = hex(COLORS.PAD_FILL);
    g.fill();
    g.lineWidth = 7;
    g.lineJoin = 'round';
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.restore();
    g.font = `700 70px ${GAME_FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText('UPGRADES', 148, h / 2 + 5, w - 170);
    texture.needsUpdate = true;
  };
  paint();
  if (typeof document !== 'undefined' && document.fonts) {
    void document.fonts
      .load(`700 70px ${GAME_FONT}`)
      .catch(() => undefined)
      .then(paint);
  }
  const m = new THREE.Mesh(geo.plane(2.6, 0.8125), basic(0xffffff, { map: texture, transparent: true, depthWrite: false }));
  m.renderOrder = 4;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/** Cosy striped doormat (w × d metres, axis-aligned): red wool, cream border + stripes, chevrons pointing at the door. */
export function createMatModel(w: number, d: number): THREE.Group {
  const pw = 352;
  const ph = Math.round((352 * d) / w);
  const { ctx: g, texture } = makeCanvasTexture(pw, ph);
  const paint = (): void => {
    g.clearRect(0, 0, pw, ph);
    const red = hex(PALETTE.truckRed);
    const redDark = '#b8352d';
    const cream = hex(COLORS.SNOW_WHITE);
    roundedRectPath(g, 4, 4, pw - 8, ph - 8, 34);
    g.fillStyle = cream;
    g.fill();
    roundedRectPath(g, 20, 20, pw - 40, ph - 40, 22);
    g.fillStyle = red;
    g.fill();
    // woven stripes
    g.save();
    roundedRectPath(g, 20, 20, pw - 40, ph - 40, 22);
    g.clip();
    g.fillStyle = redDark;
    for (let x = 36; x < pw - 20; x += 22) g.fillRect(x, 20, 7, ph - 40);
    g.restore();
    // fringe line
    roundedRectPath(g, 34, 34, pw - 68, ph - 68, 14);
    g.lineWidth = 5;
    g.strokeStyle = cream;
    g.stroke();
    // chevrons pointing toward the door (-Z = up the texture)
    g.lineWidth = 16;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = cream;
    for (const oy of [0.1, 0.32]) {
      g.beginPath();
      g.moveTo(pw / 2 - 38, ph * (0.5 + oy) - 8);
      g.lineTo(pw / 2, ph * (0.5 + oy) - 40);
      g.lineTo(pw / 2 + 38, ph * (0.5 + oy) - 8);
      g.stroke();
    }
    texture.needsUpdate = true;
  };
  paint();
  const group = new THREE.Group();
  group.name = 'shopMat';
  const under = mesh(geo.boxBase(w * 0.93, 0.05, d * 0.9), toon(0x8c2a24), { cast: false });
  group.add(under);
  const top = mesh(geo.ground(w, d), basic(0xffffff, { map: texture, transparent: true, depthWrite: false }), {
    cast: false,
    receive: false,
  });
  top.position.y = 0.056;
  top.renderOrder = 3;
  group.add(top);
  return group;
}

export const padCatalog: Record<string, () => THREE.Object3D> = {
  padHarvester: () => createPadModel(2.2, createPadTexture('saw', '$100', 0.35)),
  padProcessor: () => createPadModel(2.2, createPadTexture('factory', '$200', 0)),
  padConveyor: () => createPadModel(2.2, createPadTexture('conveyor', '$150', 0.7)),
  padMegaSaw: () => createPadModel(2.2, createPadTexture('megasaw', '$200', 1)),
  padRidge: () => createPadModel(1.8, createPadTexture('ridge', '$12k', 0.3)),
  padFeller: () => createPadModel(2.0, createPadTexture('feller', '$9000', 0.6)),
  padLoader: () => createPadModel(2.0, createPadTexture('loader', '$10k', 0)),
  padTubes: () => createPadModel(2.0, createPadTexture('tubes', '$14k', 0.2)),
  padHarvesterLevel: () => createPadModel(2.2, createPadTexture('saw', '$400', 0.4, undefined, 'LV 2')),
  padHut: () => createPadModel(1.4, createConstructionTexture('hut', { left: 8, total: 12 }, { left: 350, total: 350 })),
  padGreatLodge: () => createPadModel(1.8, createConstructionTexture('greatLodge', { left: 120, total: 120 }, { left: 40000, total: 40000 })),
  shopMat: () => createMatModel(2.2, 1.6),
  padSign: () => {
    // Tilted to face the gallery's isometric camera (the in-game sign copies the camera quaternion instead).
    const sign = createPadSign('MEGA SAWMILL');
    sign.rotation.order = 'YXZ';
    sign.rotation.set(-THREE.MathUtils.degToRad(CAMERA.pitchDeg), THREE.MathUtils.degToRad(CAMERA.yawDeg), 0);
    return new THREE.Group().add(sign);
  },
};
