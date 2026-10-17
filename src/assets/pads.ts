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
import { TAG_H, TAG_W, paintWoodenTag, wearTagLook } from '../ui/worldTag';
import { MATERIALS } from '../eras/data';

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

/** Workshop: a wooden chair (slatted back, seat, legs) beside a toothed saw blade throwing sawdust. Local box ≈ ±60. */
function drawWorkshop(g: CanvasRenderingContext2D): void {
  // chair: slatted back (two slots cut out), seat, legs and a stretcher
  g.beginPath();
  addRoundedRect(g, -52, -54, 38, 50, 5);
  addRoundedRect(g, -45, -46, 24, 10, 3);
  addRoundedRect(g, -45, -29, 24, 10, 3);
  g.fill('evenodd');
  g.beginPath();
  addRoundedRect(g, -58, -6, 52, 14, 5); // seat
  g.fill();
  g.fillRect(-54, 8, 9, 46);
  g.fillRect(-19, 8, 9, 46);
  g.fillRect(-45, 34, 26, 6);
  // saw blade: toothed disc with an arbor hole
  const cx = 30;
  const cy = 18;
  const teeth = 10;
  g.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.8) / teeth) * Math.PI * 2;
    const a2 = ((i + 1) / teeth) * Math.PI * 2;
    if (i === 0) g.moveTo(cx + Math.cos(a0) * 24, cy + Math.sin(a0) * 24);
    g.lineTo(cx + Math.cos(a1) * 33, cy + Math.sin(a1) * 33);
    g.lineTo(cx + Math.cos(a1 + 0.05) * 24, cy + Math.sin(a1 + 0.05) * 24);
    g.lineTo(cx + Math.cos(a2) * 24, cy + Math.sin(a2) * 24);
  }
  g.closePath();
  g.moveTo(cx + 7, cy);
  g.arc(cx, cy, 7, 0, Math.PI * 2, true);
  g.fill('evenodd');
  // sawdust flying off the blade
  g.beginPath();
  g.arc(24, -28, 4, 0, Math.PI * 2);
  g.arc(38, -38, 3.2, 0, Math.PI * 2);
  g.arc(50, -26, 3.6, 0, Math.PI * 2);
  g.arc(12, -40, 2.6, 0, Math.PI * 2);
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
  workshop: drawWorkshop,
};


// --- shelter icons (village construction pads) -------------------------------------------------------------

export type ShelterIcon = 'tent' | 'hut' | 'cabin' | 'lodge' | 'greatLodge' | 'grandMarket' | TownIcon | AmenityIcon | EraIcon;
/** 0.9.0: era machine slots, city lots / buildings, region expansion pads. [pads builder] draws them in SHELTER_ICONS. */
export type EraIcon = 'machine' | 'building' | 'expansion';
/** Wave 12 square amenities (AmenityId): drawn in SHELTER_ICONS below. */
export type AmenityIcon = 'cafe' | 'pond' | 'bandstand' | 'snowmanPark';
/** Wave 9 town buildings (BusinessId) + an empty lot ('lot'). [T1] draws them in SHELTER_ICONS. */
export type TownIcon = 'farm' | 'bakery' | 'townhouse' | 'ranch' | 'butcher' | 'toyFactory' | 'lot';

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

/** Wave 13 Grand Market: a long hall with a central clock gable, a row of arches along the front and a flag. */
function drawGrandMarket(g: CanvasRenderingContext2D): void {
  // long hall roof + body
  g.beginPath();
  poly(g, [[-66, -6], [-48, -30], [48, -30], [66, -6]]);
  g.fill();
  g.beginPath();
  addRoundedRect(g, -60, -2, 120, 56, 3);
  // five arches along the front (colonnade)
  for (let i = 0; i < 5; i++) addRoundedRect(g, -48 + i * 20, 22, 16, 32, 8);
  g.fill('evenodd');
  // central clock gable rising above the roof
  g.beginPath();
  poly(g, [[-20, -30], [0, -62], [20, -30]]);
  g.fill();
  g.beginPath();
  g.arc(0, -42, 9, 0, Math.PI * 2);
  g.arc(0, -42, 5.5, 0, Math.PI * 2);
  g.fill('evenodd');
  // flagpole + pennant on the right
  g.fillRect(46, -66, 4, 38);
  g.beginPath();
  poly(g, [[50, -66], [66, -60], [50, -54]]);
  g.fill();
  g.fillRect(-70, 54, 140, 6);
}

// --- wave 9 town icons (white silhouettes on the pad, same ±64 box as the shelter icons) ---------------------

/** Farm: a gambrel barn with a big X door, a hay-loft window and a little windmill behind it. */
function drawFarm(g: CanvasRenderingContext2D): void {
  // windmill (right, behind): tower + four sails
  g.beginPath();
  poly(g, [[34, 52], [40, -10], [56, -10], [62, 52]]);
  g.fill();
  g.beginPath();
  poly(g, [[38, -10], [48, -26], [58, -10]]);
  g.fill();
  g.save();
  g.translate(48, -12);
  g.rotate(Math.PI / 5);
  for (let i = 0; i < 4; i++) {
    g.fillRect(-2.5, -34, 5, 34);
    g.fillRect(2.5, -34, 10, 20);
    g.rotate(Math.PI / 2);
  }
  g.restore();
  // barn
  g.beginPath();
  poly(g, [[-62, 52], [-62, -4], [-46, -26], [-22, -44], [2, -26], [18, -4], [18, 52]]);
  addRoundedRect(g, -48, 16, 40, 36, 2); // door
  addRoundedRect(g, -36, -14, 16, 14, 2); // loft window
  g.fill('evenodd');
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(-46, 18);
  g.lineTo(-10, 50);
  g.moveTo(-10, 18);
  g.lineTo(-46, 50);
  g.moveTo(-28, 16);
  g.lineTo(-28, 52);
  g.stroke();
  g.fillRect(-66, 52, 132, 6);
}

/** Bakery: a gabled shop with a big chimney (and smoke puffs), a scalloped awning and a round loaf on the sign. */
function drawBakery(g: CanvasRenderingContext2D): void {
  g.beginPath();
  poly(g, [[-62, -4], [-8, -40], [46, -4]]); // roof
  g.fill();
  g.fillRect(14, -52, 18, 34); // chimney
  g.fillRect(11, -56, 24, 7);
  for (const [x, y, r] of [[26, -66, 5], [34, -76, 6]] as const) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  addRoundedRect(g, -54, 0, 92, 54, 3);
  addRoundedRect(g, 14, 18, 18, 36, 8); // door
  addRoundedRect(g, -46, 20, 44, 18, 3); // shop window
  g.fill('evenodd');
  // scalloped awning
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(-40 + i * 14, 10, 7, 0, Math.PI);
    g.fill();
  }
  // hanging loaf sign
  g.fillRect(40, -2, 22, 4);
  g.beginPath();
  g.ellipse(54, 22, 10, 16, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(-58, 54, 122, 5);
}

/** Townhouse: a narrow two-storey house with a steep roof, chimney, four windows and a wreath on the door. */
function drawTownhouse(g: CanvasRenderingContext2D): void {
  g.beginPath();
  poly(g, [[-46, -22], [0, -60], [46, -22]]); // roof
  g.fill();
  g.fillRect(16, -56, 14, 26); // chimney
  g.beginPath();
  addRoundedRect(g, -40, -18, 80, 74, 3);
  addRoundedRect(g, -30, -8, 20, 20, 3); // upper windows
  addRoundedRect(g, 10, -8, 20, 20, 3);
  addRoundedRect(g, -30, 22, 16, 18, 3); // lower windows
  addRoundedRect(g, 14, 22, 16, 18, 3);
  addRoundedRect(g, -9, 24, 18, 32, 3); // door
  g.fill('evenodd');
  // wreath on the door
  g.lineWidth = 4;
  g.beginPath();
  g.arc(0, 36, 5, 0, Math.PI * 2);
  g.stroke();
  g.fillRect(-48, 56, 96, 5);
}

/** Ranch: a snug barn, a fence and a chunky cow. */
function drawRanch(g: CanvasRenderingContext2D): void {
  g.beginPath();
  poly(g, [[-64, 6], [-64, -14], [-40, -44], [-16, -14], [-16, 6]]); // barn gable
  g.fill();
  g.beginPath();
  addRoundedRect(g, -64, 6, 48, 46, 2);
  addRoundedRect(g, -52, 20, 24, 32, 2);
  g.fill('evenodd');
  // cow (facing right)
  g.beginPath();
  addRoundedRect(g, -2, 14, 50, 24, 10); // body
  addRoundedRect(g, 40, 6, 22, 20, 6); // head
  g.fill();
  g.fillRect(2, 36, 7, 18);
  g.fillRect(14, 36, 7, 18);
  g.fillRect(32, 36, 7, 18);
  g.fillRect(44, 36, 7, 18);
  g.beginPath();
  poly(g, [[44, 6], [48, -4], [52, 6]]);
  poly(g, [[54, 6], [58, -4], [62, 6]]);
  g.fill();
  // fence
  g.fillRect(-66, 40, 130, 4);
  for (let x = -62; x <= 62; x += 31) g.fillRect(x, 32, 5, 24);
  g.fillRect(-66, 54, 132, 5);
}

/** Butcher: a striped-awning shop, a smokehouse chimney and a hanging ham. */
function drawButcher(g: CanvasRenderingContext2D): void {
  // smokehouse (right) with chimney pipe
  g.beginPath();
  poly(g, [[22, -20], [40, -40], [58, -20]]);
  g.fill();
  g.fillRect(36, -62, 8, 24);
  g.beginPath();
  addRoundedRect(g, 24, -20, 32, 74, 2);
  addRoundedRect(g, 31, 14, 18, 20, 2);
  g.fill('evenodd');
  // shop roof + body
  g.beginPath();
  poly(g, [[-62, -10], [-20, -34], [22, -10]]);
  g.fill();
  g.beginPath();
  addRoundedRect(g, -56, -4, 74, 58, 3);
  addRoundedRect(g, -46, 22, 28, 26, 3); // window
  addRoundedRect(g, -10, 22, 18, 32, 3); // door
  g.fill('evenodd');
  // awning stripes (alternate filled / empty bars)
  for (let i = 0; i < 6; i++) if (i % 2 === 0) g.fillRect(-58 + i * 13, 8, 12, 12);
  g.beginPath();
  poly(g, [[-62, 8], [-62, 2], [22, 2], [22, 8]]);
  g.fill();
  // hanging ham
  g.fillRect(-6, -2, 2.5, 8);
  g.fillRect(-60, 54, 122, 5);
}

/** Toy factory: sawtooth roof, tall chimney, a big cog on the wall and a little train sign. */
function drawToyFactory(g: CanvasRenderingContext2D): void {
  g.fillRect(-56, -62, 12, 40); // chimney
  g.fillRect(-59, -66, 18, 6);
  g.beginPath();
  poly(g, [[-62, -2], [-62, -28], [-34, -2], [-34, -28], [-6, -2], [-6, -28], [22, -2], [22, -28], [50, -2]]); // saw teeth
  g.fill();
  g.beginPath();
  addRoundedRect(g, -62, -2, 112, 56, 3);
  addRoundedRect(g, -52, 22, 26, 32, 2); // door
  addRoundedRect(g, -18, 12, 20, 16, 2); // window
  g.fill('evenodd');
  // cog
  g.save();
  g.translate(26, 30);
  g.beginPath();
  g.arc(0, 0, 14, 0, Math.PI * 2);
  g.arc(0, 0, 5, 0, Math.PI * 2, true);
  g.fill('evenodd');
  for (let i = 0; i < 8; i++) {
    g.rotate(Math.PI / 4);
    g.fillRect(-4, -21, 8, 10);
  }
  g.restore();
  g.fillRect(-66, 54, 130, 5);
}

/** Lot: an empty plot with rope stakes and a FOR SALE signboard. */
function drawLot(g: CanvasRenderingContext2D): void {
  // sign
  g.fillRect(-4, -4, 7, 58);
  g.beginPath();
  addRoundedRect(g, -42, -44, 84, 46, 5);
  addRoundedRect(g, -34, -36, 68, 30, 3);
  g.fill('evenodd');
  g.fillRect(-26, -30, 52, 5);
  g.fillRect(-20, -18, 40, 5);
  // stakes + rope
  for (const x of [-58, 56]) {
    g.fillRect(x - 3, 22, 6, 32);
    g.beginPath();
    g.arc(x, 20, 6, 0, Math.PI * 2);
    g.fill();
  }
  g.fillRect(-58, 34, 114, 3);
  g.fillRect(-66, 54, 132, 6);
}

// --- wave 12 amenity icons (square amenities; white silhouettes, same ±64 box) --------------------------------

/** Cocoa Café: a steaming mug with a handle, whipped top and a saucer. */
function drawCafe(g: CanvasRenderingContext2D): void {
  // mug body + handle ring
  g.beginPath();
  addRoundedRect(g, -40, -10, 66, 58, 12);
  g.fill();
  g.lineWidth = 11;
  g.beginPath();
  g.arc(30, 20, 20, -Math.PI / 2, Math.PI / 2);
  g.stroke();
  // whipped cream bumps on top
  for (const [x, r] of [[-26, 10], [-8, 13], [12, 11]] as const) {
    g.beginPath();
    g.arc(x, -12, r, 0, Math.PI * 2);
    g.fill();
  }
  // saucer
  g.fillRect(-58, 52, 112, 7);
  // three curls of steam
  g.lineWidth = 6;
  g.lineCap = 'round';
  for (const x of [-26, -4, 18]) {
    g.beginPath();
    g.moveTo(x, -34);
    g.bezierCurveTo(x - 12, -44, x + 12, -52, x, -64);
    g.stroke();
  }
}

/** Skating Pond: an ice ellipse with a pair of figure skates on it. */
function drawPond(g: CanvasRenderingContext2D): void {
  // pond ring
  g.beginPath();
  g.ellipse(0, 36, 62, 22, 0, 0, Math.PI * 2);
  g.ellipse(0, 36, 50, 14, 0, 0, Math.PI * 2);
  g.fill('evenodd');
  // a figure skate: boot, blade, and a curl at the toe
  g.beginPath();
  poly(g, [[-26, -46], [-8, -46], [-8, -4], [14, 8], [14, 22], [-26, 22]]);
  g.fill();
  g.fillRect(-32, 26, 54, 5); // blade
  g.beginPath();
  g.arc(22, 22, 8, -Math.PI / 2, Math.PI / 2);
  g.lineWidth = 5;
  g.stroke();
  // a snowflake
  g.lineWidth = 4.5;
  g.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3;
    g.beginPath();
    g.moveTo(40 - Math.cos(a) * 20, -22 - Math.sin(a) * 20);
    g.lineTo(40 + Math.cos(a) * 20, -22 + Math.sin(a) * 20);
    g.stroke();
  }
}

/** Bandstand: an open eight-sided pavilion with a cone roof, posts, a raised deck and a flag. */
function drawBandstand(g: CanvasRenderingContext2D): void {
  g.beginPath();
  poly(g, [[-62, -10], [0, -48], [62, -10]]); // roof
  g.fill();
  g.fillRect(-2.5, -66, 5, 20); // finial / pole
  g.beginPath();
  poly(g, [[2, -66], [22, -60], [2, -54]]); // pennant
  g.fill();
  for (const x of [-48, -16, 16, 48]) g.fillRect(x - 4, -8, 8, 52); // posts
  g.fillRect(-60, -10, 120, 6); // beam
  g.fillRect(-64, 44, 128, 10); // deck
  g.fillRect(-52, 54, 104, 6); // step
  // bunting between the posts
  for (const x of [-32, 0, 32]) {
    g.beginPath();
    poly(g, [[x - 8, -2], [x + 8, -2], [x, 12]]);
    g.fill();
  }
}

/** Snowman Park: a snowman (three balls, hat, carrot, scarf, twig arms) beside a small one. */
function drawSnowmanPark(g: CanvasRenderingContext2D): void {
  const ball = (x: number, y: number, r: number): void => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  ball(-14, 38, 24);
  ball(-14, 8, 18);
  ball(-14, -16, 12);
  g.fillRect(-28, -44, 28, 4); // hat brim
  g.fillRect(-23, -62, 18, 20); // hat
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.beginPath(); // twig arms
  g.moveTo(-30, 6);
  g.lineTo(-56, -8);
  g.moveTo(2, 6);
  g.lineTo(28, -10);
  g.stroke();
  g.beginPath(); // carrot
  poly(g, [[-14, -16], [6, -12], [-14, -10]]);
  g.fill();
  // the small one
  ball(40, 46, 15);
  ball(40, 26, 10);
  g.fillRect(-64, 60, 128, 5); // ground
}

// --- 0.9.0 era icons (machine slots, city lots / buildings, region expansion pads; same ±64 box) -------------------

/** Machine: a chunky cog beside a chimney factory, with smoke puffs. */
function drawMachine(g: CanvasRenderingContext2D): void {
  // chimney + smoke
  g.fillRect(14, -52, 16, 40);
  g.fillRect(11, -56, 22, 6);
  for (const [x, y, r] of [[26, -66, 5], [38, -74, 6.5]] as const) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // factory hall: sawtooth roof, a door and a window cut out
  g.beginPath();
  poly(g, [[-2, 52], [-2, -14], [18, -30], [18, -14], [38, -30], [38, -14], [62, -14], [62, 52]]);
  addRoundedRect(g, 12, 22, 20, 30, 3);
  addRoundedRect(g, 40, 6, 16, 14, 3);
  g.fill('evenodd');
  // big cog on the left (teeth + hub hole)
  g.save();
  g.translate(-30, 18);
  g.beginPath();
  g.arc(0, 0, 25, 0, Math.PI * 2);
  g.arc(0, 0, 10, 0, Math.PI * 2, true);
  g.fill('evenodd');
  for (let i = 0; i < 8; i++) {
    g.rotate(Math.PI / 4);
    g.beginPath();
    addRoundedRect(g, -7, -37, 14, 15, 3);
    g.fill();
  }
  g.restore();
  g.fillRect(-66, 52, 132, 6);
}

/** Building: a city tower block with a crown, rows of windows and a door, beside a lower annex. */
function drawBuilding(g: CanvasRenderingContext2D): void {
  // antenna
  g.fillRect(-14, -66, 4, 20);
  // tower: stepped crown, window grid cut out, door
  g.beginPath();
  poly(g, [[-38, 52], [-38, -34], [-28, -34], [-28, -46], [-8, -46], [-8, -34], [10, -34], [10, 52]]);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 2; c++) addRoundedRect(g, -30 + c * 20, -26 + r * 14, 12, 8, 2);
  }
  addRoundedRect(g, -20, 36, 16, 16, 2);
  g.fill('evenodd');
  // annex: shorter block with its own windows
  g.beginPath();
  poly(g, [[16, 52], [16, 4], [62, 4], [62, 52]]);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) addRoundedRect(g, 22 + c * 14, 12 + r * 13, 9, 7, 2);
  }
  g.fill('evenodd');
  g.fillRect(-66, 52, 132, 6);
}

/** Expansion: a flag planted on a hill with a signpost, the way into new land. */
function drawExpansion(g: CanvasRenderingContext2D): void {
  // hill
  g.beginPath();
  g.moveTo(-66, 54);
  g.quadraticCurveTo(-30, 8, 8, 18);
  g.quadraticCurveTo(46, 26, 66, 54);
  g.closePath();
  g.fill();
  // flag pole + waving pennant + ball
  g.fillRect(-4, -60, 6, 70);
  g.beginPath();
  g.moveTo(2, -58);
  g.bezierCurveTo(20, -66, 32, -48, 54, -54);
  g.lineTo(54, -22);
  g.bezierCurveTo(32, -16, 20, -34, 2, -26);
  g.closePath();
  g.fill();
  g.beginPath();
  g.arc(-1, -62, 6, 0, Math.PI * 2);
  g.fill();
  // little signpost on the left with an arrow board
  g.fillRect(-46, -2, 5, 36);
  g.beginPath();
  poly(g, [[-62, -4], [-30, -4], [-22, 6], [-30, 16], [-62, 16]]);
  g.fill();
}

const SHELTER_ICONS: Record<ShelterIcon, (g: CanvasRenderingContext2D) => void> = {
  tent: drawTent,
  hut: drawHut,
  cabin: drawCabin,
  lodge: drawLodge,
  greatLodge: drawGreatLodge,
  grandMarket: drawGrandMarket,
  farm: drawFarm,
  bakery: drawBakery,
  townhouse: drawTownhouse,
  ranch: drawRanch,
  butcher: drawButcher,
  toyFactory: drawToyFactory,
  lot: drawLot,
  cafe: drawCafe,
  pond: drawPond,
  bandstand: drawBandstand,
  snowmanPark: drawSnowmanPark,
  machine: drawMachine,
  building: drawBuilding,
  expansion: drawExpansion,
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

/** Three significant digits, no trailing zeros: 1.35 / 12.5 / 984. */
function sig3(x: number): string {
  if (x >= 100) return String(Math.round(x));
  return (x >= 10 ? x.toFixed(1) : x.toFixed(2)).replace(/\.?0+$/, '');
}

/**
 * "$4000" / "$16k" / "$12.5k" / "$1.35M" / "$984M" / "$1.2B" / "$3T": keeps big prices inside the 56 px text slot.
 * Below a million the output is the original (k) format.
 */
export function formatCost(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 10000) return `$${v}`;
  if (v < 1_000_000) {
    const k = v / 1000;
    return `$${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  const units = ['M', 'B', 'T'] as const;
  let i = 0;
  let x = v / 1e6;
  // 999.6M rounds to "1000M": promote to the next unit instead
  while (i < units.length - 1 && Math.round(x) >= 1000) {
    x /= 1000;
    i++;
  }
  return `$${sig3(x)}${units[i]}`;
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
  /** Third requirement (Grand Market toys). */
  extra?: { left: number; total: number; kind: string };
  /** Construction pads on preview (0.9 era pads before their gate is met): greyed, a padlock + this note. */
  locked?: string | undefined;
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


/** Little wooden toy train (red cab + blue boiler + yellow wheels) with a white outline. */
function drawToyIcon(g: CanvasRenderingContext2D, x: number, y: number, k = 1): void {
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.lineWidth = 4;
  g.strokeStyle = '#ffffff';
  g.lineJoin = 'round';
  // boiler (blue) + chimney, cab (red) + roof
  roundedRectPath(g, -34, -8, 44, 26, 6);
  g.fillStyle = '#3f86c8';
  g.fill();
  g.stroke();
  g.fillStyle = '#2a2a2e';
  g.fillRect(-27, -22, 10, 15);
  g.strokeRect(-27, -22, 10, 15);
  roundedRectPath(g, 6, -20, 28, 38, 5);
  g.fillStyle = '#d8432f';
  g.fill();
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fillRect(12, -13, 14, 12);
  // wheels
  g.fillStyle = '#f2c23a';
  for (const wx of [-22, -4, 20]) {
    g.beginPath();
    g.arc(wx, 20, 8, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.restore();
}

/** Wooden crate: CRATE_BOX square with a darker frame and a crossbar. */
function drawCrateIcon(g: CanvasRenderingContext2D, x: number, y: number, k = 1): void {
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.lineJoin = 'round';
  g.lineWidth = 4;
  g.strokeStyle = '#ffffff';
  roundedRectPath(g, -27, -27, 54, 54, 6);
  g.fillStyle = hex(COLORS.CRATE_BOX);
  g.fill();
  g.stroke();
  g.strokeStyle = hex(COLORS.CRATE_STRIP);
  g.lineWidth = 6;
  g.strokeRect(-20, -20, 40, 40);
  g.beginPath();
  g.moveTo(-20, -20);
  g.lineTo(20, 20);
  g.stroke();
  g.restore();
}

/**
 * Any era material as a small tinted icon (MATERIALS[kind].color / accent): a rounded block with an accent stripe by
 * default, with a few shape variants (cog, drum, crystal, cell, chip, ingot) so neighbouring rows read apart.
 */
function drawMaterialIcon(g: CanvasRenderingContext2D, x: number, y: number, kind: string, k = 1): void {
  if (!(kind in MATERIALS)) {
    g.save();
    g.translate(x, y);
    g.scale(k, k);
    roundedRectPath(g, -26, -22, 52, 44, 9);
    g.fillStyle = '#c9c9d4';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.restore();
    return;
  }
  const def = MATERIALS[kind as keyof typeof MATERIALS];
  const body = hex(def.color);
  const accent = hex(def.accent);
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.lineJoin = 'round';
  g.lineWidth = 4;
  g.strokeStyle = '#ffffff';
  g.fillStyle = body;
  switch (def.shape) {
    case 'gear': {
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * Math.PI * 2;
        const a1 = ((i + 1) / 16) * Math.PI * 2;
        const r = i % 2 === 0 ? 29 : 21;
        g.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
        g.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 8, 0, Math.PI * 2);
      g.fillStyle = accent;
      g.fill();
      break;
    }
    case 'barrel':
    case 'flask':
    case 'fusion':
    case 'cell': {
      roundedRectPath(g, -17, -27, 34, 54, 8);
      g.fill();
      g.stroke();
      g.fillStyle = accent;
      g.fillRect(-17, -10, 34, 14);
      break;
    }
    case 'crystal':
    case 'geode':
    case 'core': {
      g.beginPath();
      poly(g, [[0, -29], [22, -8], [14, 26], [-14, 26], [-22, -8]]);
      g.fill();
      g.stroke();
      g.fillStyle = accent;
      g.beginPath();
      poly(g, [[0, -29], [-6, -6], [4, 22], [14, 26], [22, -8]]);
      g.globalAlpha = 0.45;
      g.fill();
      g.globalAlpha = 1;
      break;
    }
    case 'chip': {
      roundedRectPath(g, -24, -24, 48, 48, 6);
      g.fill();
      g.stroke();
      g.fillStyle = '#1c1c22';
      g.fillRect(-12, -12, 24, 24);
      g.fillStyle = accent;
      for (const p of [-14, 0, 14]) {
        g.fillRect(p - 3, -30, 6, 8);
        g.fillRect(p - 3, 22, 6, 8);
      }
      break;
    }
    case 'ingot': {
      g.beginPath();
      poly(g, [[-30, 14], [-20, -12], [20, -12], [30, 14]]);
      g.fill();
      g.stroke();
      g.fillStyle = accent;
      g.fillRect(-26, 14, 52, 8);
      break;
    }
    default: {
      roundedRectPath(g, -28, -22, 56, 44, 9);
      g.fill();
      g.stroke();
      g.fillStyle = accent;
      g.fillRect(-28, 2, 56, 9);
      break;
    }
  }
  g.restore();
}

function drawConstructionRow(
  g: CanvasRenderingContext2D,
  y: number,
  kind: 'log' | 'cash' | 'extra',
  req: { left: number; total: number },
  k = 1,
  extraKind = 'toy',
): void {
  if (kind === 'log') drawLogIcon(g, 58, y, 0.95 * k);
  else if (kind === 'cash') drawBill(g, 56, y, 0.75 * k);
  else if (extraKind === 'toy') drawToyIcon(g, 58, y, 0.78 * k);
  else if (extraKind === 'crate') drawCrateIcon(g, 58, y, 0.7 * k);
  else if (extraKind === 'log') drawLogIcon(g, 58, y, 0.95 * k);
  else drawMaterialIcon(g, 58, y, extraKind, 0.72 * k);
  if (req.left <= 0) {
    drawCheck(g, 108, y);
    return;
  }
  g.font = `700 ${Math.round(50 * k)}px ${GAME_FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 9;
  g.strokeStyle = hex(COLORS.PAD_BG);
  g.fillStyle = '#ffffff';
  const text = kind === 'cash' ? formatCost(req.left) : `${req.left}`;
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

  // 0.9.0 era pads cost no logs (logs.total 0): no log row, the remaining rows take the lower half
  const hasLogs = !!p.logs && p.logs.total > 0;
  const rows = (hasLogs ? 1 : 0) + (p.extra ? 1 : 0) + (p.cash ? 1 : 0);
  // three requirements (Grand Market): a smaller icon and tighter rows so the toy row fits
  const three = rows >= 3;
  const single = rows <= 1;
  g.save();
  g.translate(128, three ? 58 : single ? 82 : 76);
  const iconScale = three ? 0.6 : single ? 0.86 : 0.78;
  g.scale(iconScale, iconScale);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  SHELTER_ICONS[p.icon as ShelterIcon](g);
  g.restore();

  const ek = p.extra?.kind;
  if (three) {
    if (hasLogs) drawConstructionRow(g, 120, 'log', p.logs!, 0.8);
    if (p.extra) drawConstructionRow(g, 166, 'extra', p.extra, 0.8, ek);
    if (p.cash) drawConstructionRow(g, 212, 'cash', p.cash, 0.8);
  } else if (single) {
    // cash only (or one other row): centred a little lower than the two-row layout
    if (hasLogs) drawConstructionRow(g, 190, 'log', p.logs!);
    if (p.extra) drawConstructionRow(g, 190, 'extra', p.extra, 1, ek);
    if (p.cash) drawConstructionRow(g, 190, 'cash', p.cash);
  } else {
    // two rows: logs / extra on top, cash below
    if (hasLogs) drawConstructionRow(g, 158, 'log', p.logs!);
    if (p.extra) drawConstructionRow(g, 158, 'extra', p.extra, 1, ek);
    if (p.cash) drawConstructionRow(g, 208, 'cash', p.cash);
  }
  if (p.locked !== undefined) drawLockedWash(g, p.locked);
  texture.needsUpdate = true;
}

/**
 * Preview face (docs/EXPANSION.md §C): a grey wash over the whole tile, a padlock and a short progress note
 * ("37/48 · S8/10") on a dark strip, so the pad reads "for sale, not yet" without a second mesh.
 */
function drawLockedWash(g: CanvasRenderingContext2D, note: string): void {
  const inset = BORDER / 2;
  g.save();
  roundedRectPath(g, inset, inset, SIZE - BORDER, SIZE - BORDER, CORNER);
  g.fillStyle = 'rgba(150,158,170,0.62)';
  g.fill();
  // padlock: shackle + body
  g.translate(SIZE / 2, note ? 104 : 128);
  g.lineWidth = 11;
  g.strokeStyle = '#ffffff';
  g.beginPath();
  g.arc(0, -14, 22, Math.PI, 0);
  g.lineTo(22, 4);
  g.moveTo(-22, 4);
  g.lineTo(-22, -14);
  g.stroke();
  roundedRectPath(g, -36, 0, 72, 56, 10);
  g.fillStyle = '#ffffff';
  g.fill();
  g.fillStyle = hex(COLORS.PAD_BG);
  g.beginPath();
  g.arc(0, 22, 8, 0, Math.PI * 2);
  g.fill();
  g.fillRect(-3.5, 24, 7, 16);
  g.restore();
  if (!note) return;
  g.font = `700 40px ${GAME_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 9;
  g.strokeStyle = hex(COLORS.PAD_BG);
  g.fillStyle = '#ffffff';
  const maxW = SIZE - BORDER - 28;
  g.strokeText(note, SIZE / 2, 200, maxW);
  g.fillText(note, SIZE / 2, 200, maxW);
}

/**
 * Construction pad face: shelter icon on top, then "log icon + logs left" and "bill icon + cash left" rows (a
 * finished requirement shows a check mark). The fill rises with the combined progress. Redraws `target` in place.
 * `locked` (a preview pad): the face is greyed under a padlock and that note.
 */
export function createConstructionTexture(
  icon: ShelterIcon,
  logs: { left: number; total: number },
  cash: { left: number; total: number },
  target?: THREE.CanvasTexture,
  extra?: { left: number; total: number; kind: string },
  locked?: string,
): THREE.CanvasTexture {
  const texture = target ?? makeCanvasTexture(SIZE, SIZE).texture;
  const part = (r: { left: number; total: number }): number => (r.total > 0 ? 1 - r.left / r.total : 1);
  // era pads (logs.total 0) have no log requirement: it must not count as a free third of the progress
  const parts = [...(logs.total > 0 ? [part(logs)] : []), part(cash), ...(extra ? [part(extra)] : [])];
  const ratio = parts.reduce((a, b) => a + b, 0) / parts.length;
  const p: PadTextureParams = { kind: 'construction', icon, text: '', ratio, logs, cash, ...(extra ? { extra } : {}), locked };
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
  // 0.9.8 (brief 14): a hanging wooden tag (ui/worldTag.ts)
  const { ctx: g, texture } = makeCanvasTexture(TAG_W, TAG_H);
  let text = label;
  const paint = (): void => {
    paintWoodenTag(g, text, { gold, font: GAME_FONT });
    texture.needsUpdate = true;
  };
  paint();
  if (typeof document !== 'undefined' && document.fonts) {
    void document.fonts
      .load(`700 64px ${GAME_FONT}`)
      .catch(() => undefined)
      .then(paint);
  }
  const m = new THREE.Mesh(geo.plane(2.5, (2.5 * TAG_H) / TAG_W), basic(0xffffff, { map: texture, transparent: true, depthWrite: false }));
  wearTagLook(m, (2.5 * TAG_H) / TAG_W);
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
  // 0.9.8 (brief 14): a hanging wooden tag with a green up-arrow (ui/worldTag.ts)
  const { ctx: g, texture } = makeCanvasTexture(TAG_W, TAG_H);
  const paint = (): void => {
    paintWoodenTag(g, 'UPGRADES', { gold: true, arrow: true, font: GAME_FONT });
    texture.needsUpdate = true;
  };
  paint();
  if (typeof document !== 'undefined' && document.fonts) {
    void document.fonts
      .load(`700 70px ${GAME_FONT}`)
      .catch(() => undefined)
      .then(paint);
  }
  const m = new THREE.Mesh(geo.plane(2.6, (2.6 * TAG_H) / TAG_W), basic(0xffffff, { map: texture, transparent: true, depthWrite: false }));
  wearTagLook(m, (2.6 * TAG_H) / TAG_W);
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
  padHarvesterLevel: () => createPadModel(2.2, createPadTexture('saw', '$400', 0.4, undefined, 'LV 1')),
  padHut: () => createPadModel(1.4, createConstructionTexture('hut', { left: 8, total: 12 }, { left: 350, total: 350 })),
  padFarm: () => createPadModel(1.8, createConstructionTexture('farm', { left: 24, total: 24 }, { left: 2500, total: 2500 })),
  padBakery: () => createPadModel(1.8, createConstructionTexture('bakery', { left: 20, total: 30 }, { left: 4000, total: 4000 })),
  padTownhouse: () => createPadModel(1.8, createConstructionTexture('townhouse', { left: 40, total: 40 }, { left: 6000, total: 6000 })),
  padRanch: () => createPadModel(1.8, createConstructionTexture('ranch', { left: 30, total: 30 }, { left: 5000, total: 5000 })),
  padButcher: () => createPadModel(1.8, createConstructionTexture('butcher', { left: 36, total: 36 }, { left: 9000, total: 9000 })),
  padToyFactory: () => createPadModel(1.8, createConstructionTexture('toyFactory', { left: 50, total: 50 }, { left: 14000, total: 14000 })),
  padLot: () => createPadModel(1.8, createConstructionTexture('lot', { left: 10, total: 10 }, { left: 1000, total: 1000 })),
  padGreatLodge: () => createPadModel(1.8, createConstructionTexture('greatLodge', { left: 120, total: 120 }, { left: 40000, total: 40000 })),
  padGrandMarket: () =>
    createPadModel(1.8, createConstructionTexture('grandMarket', { left: 90, total: 120 }, { left: 60000, total: 60000 }, undefined, { left: 14, total: 20, kind: 'toy' })),
  padExpansion: () =>
    createPadModel(1.8, createConstructionTexture('expansion', { left: 0, total: 0 }, { left: 450_000, total: 450_000 }, undefined, { left: 40, total: 40, kind: 'crate' })),
  padMachine: () =>
    createPadModel(1.8, createConstructionTexture('machine', { left: 0, total: 0 }, { left: 27_000, total: 27_000 }, undefined, { left: 8, total: 12, kind: 'stone' })),
  padBuilding: () => createPadModel(1.8, createConstructionTexture('building', { left: 0, total: 0 }, { left: 1_350_000, total: 1_350_000 })),
  shopMat: () => createMatModel(2.2, 1.6),
  padSign: () => {
    // Tilted to face the gallery's isometric camera (the in-game sign copies the camera quaternion instead).
    const sign = createPadSign('MEGA SAWMILL');
    sign.rotation.order = 'YXZ';
    sign.rotation.set(-THREE.MathUtils.degToRad(CAMERA.pitchDeg), THREE.MathUtils.degToRad(CAMERA.yawDeg), 0);
    return new THREE.Group().add(sign);
  },
};
