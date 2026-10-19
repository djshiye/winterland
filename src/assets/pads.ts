/**
 * [B7 — progression; 0.9.8 brief 13] The pads: floor tiles that take cash (and logs / materials), their canvas faces,
 * the hanging price tags and the floating sign boards.
 *
 * Look (DIRECTION D6, never the source ad's grey tile with a green fill or black BUILD tile):
 * - Three looks, `PadStyle` (palette.ts PAD.looks): a stitched snow QUILT, a wooden pressure PLATE and a
 *   frosted ice LANTERN, the default (DEFAULT_PAD_STYLE); `?pads=quilt` previews another one, `?gallery=pads` shows
 *   all three side by side.
 * - createPadTexture / createConstructionTexture / createBuildTexture: 256 × 256 canvas faces in that look: the
 *   machine / shelter icon in warm ink on a round medallion, warm honey rising from the bottom as the pad is paid (its
 *   wavy surface sloshes a little with every bundle), a brass "LV n" rosette on level pads, a frost wash and padlock on
 *   preview pads. Cheap to RE-RENDER on every bundle: pass `target` to redraw a texture's canvas in place.
 * - hangPriceTag(sign, texture): the price (or a construction pad's rows: logs, extra, cash, a tick when done, or a
 *   preview pad's note) moves off the tile onto a cream luggage tag on twine under the sign. It sways gently and swings
 *   when the amount changes; still under Reduce motion. A tile without a tag shows the price on a small cream label.
 * - createPadModel: the face on a rounded slab with a fat lumpy snow rim (one merged, vertex-coloured mesh), lit like
 *   the world; padDim() quiets the face when the player can't pay.
 * - createPadSign / createShopSign: snow-capped wooden boards with cream lettering (brass trim for level pads and the
 *   shop); createMatModel: the cabin's striped doormat.
 * Fredoka may load after the first draw, so every texture redraws itself once when the font is ready. Every colour
 * comes from render/palette.ts (PAD); the small item icons keep their item colours.
 * 0.9.10 (D8) colour-blind hook: with Settings › Colour-blind friendly on (fx/comfort), the greens that carry meaning
 * on a pad (the tick of a finished requirement, the cash still to pay, the plus on a BUILD tile) turn the Okabe-Ito
 * sky blue the HUD uses (tagInks), and every live pad face and tag redraws when the switch flips. The honey ring and
 * fill, the brass LV rosette and the MANAGE board use no red or green, so they stay as they are.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAMERA, COLORS, PALETTE, type PadDef } from '../config';
import { GAME_FONT, basic, geo, makeCanvasTexture, mesh, toon, toonUnique } from '../render/materials';
import { PAD, UI_TONES, mixHex, type PadLook } from '../render/palette';
import { comfort, onComfortChange } from '../fx/comfort';
import { MATERIALS } from '../eras/data';
import { motionScale } from '../fx/padJuice';
import { registerGlow } from '../world/env/glow';
import { wearTagLook } from '../ui/worldTag';
import { materialIcon, materialLabel } from '../ui/materialIcons';
import { MANAGE_BOARD_H, MANAGE_BOARD_W, MANAGE_POST_H, UPRIGHT } from '../fx/manageSign';

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
  g.fillStyle = cutColor;
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
  g.fillStyle = cutColor;
  g.fillRect(-56, 40, 112, 3);
  g.fillStyle = hex(PAD.ink);
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

/**
 * [0.9.10 — D8] The inks that say "done" (a tick) and "cash still to pay" on pads and tags: pine and sage normally,
 * the colour-blind friendly sky blue (a deeper one for the cash text, readable on the cream tag) when asked.
 */
export function tagInks(colorBlind: boolean = comfort().colorBlind): { done: number; cash: number } {
  return colorBlind ? { done: UI_TONES.cbgood, cash: mixHex(UI_TONES.cbgood, PAD.ink, 0.4) } : { done: PAD.done, cash: PAD.cashInk };
}

/** Check mark (a requirement that is complete). */
function drawCheck(g: CanvasRenderingContext2D, x: number, y: number, color = tagInks().done): void {
  g.save();
  g.lineWidth = 12;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = hex(color);
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
  kind: 'pad' | 'construction' | 'build';
  icon: PadIcon | ShelterIcon;
  text: string;
  ratio: number;
  /** Level pads: the brass "LV n" rosette. */
  badge?: string | undefined;
  /** Construction pads: requirement rows. */
  logs?: { left: number; total: number };
  cash?: { left: number; total: number };
  /** Third requirement (Grand Market toys). */
  extra?: { left: number; total: number; kind: string };
  /** Construction pads on preview (0.9 era pads before their gate is met): frosted, a padlock + this note. */
  locked?: string | undefined;
  /** The look this texture was made in (padStyle() when it was created). */
  style: PadStyle;
}

const params = new WeakMap<THREE.CanvasTexture, PadTextureParams>();
const fontHooked = new WeakSet<THREE.CanvasTexture>();
/** 0.9.10: every pad face drawn so far (weakly held), redrawn when the colour-blind switch flips. */
const liveFaces = new Set<WeakRef<THREE.CanvasTexture>>();
let facesColorBlind = comfort().colorBlind;
onComfortChange((s) => {
  if (s.colorBlind === facesColorBlind) return;
  facesColorBlind = s.colorBlind;
  for (const ref of liveFaces) {
    const t = ref.deref();
    const p = t ? params.get(t) : undefined;
    if (!t || !p) liveFaces.delete(ref);
    else draw(t, p);
  }
});

// ---------------------------------------------------------------------------
// The three looks (0.9.8, DIRECTION D6)
// ---------------------------------------------------------------------------

/** Stitched snow quilt, wooden pressure plate, frosted ice lantern. */
export type PadStyle = keyof typeof PAD.looks;
export const PAD_STYLES: readonly PadStyle[] = ['quilt', 'plate', 'lantern'];
/** Dino's pick (2026-10-17): the frosted ice lantern. */
export const DEFAULT_PAD_STYLE: PadStyle = 'lantern';

/** `?pads=plate` previews another look (gallery and screenshots); anything else is the default. */
function readStyle(): PadStyle {
  try {
    const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('pads');
    if (q && (PAD_STYLES as readonly string[]).includes(q)) return q as PadStyle;
  } catch {
    /* no location */
  }
  return DEFAULT_PAD_STYLE;
}

let style: PadStyle = readStyle();

/** The look new pads are made in. */
export function padStyle(): PadStyle {
  return style;
}

/** Run `make` with pads made in look `s` (the gallery's side-by-side options). */
export function withPadStyle<T>(s: PadStyle, make: () => T): T {
  const prev = style;
  style = s;
  try {
    return make();
  } finally {
    style = prev;
  }
}

/** Inset and corner radius of the tile face (the 3D snow rim covers its edge). */
const FACE_INSET = 4;
const FACE_R = CORNER + 4;
/** The icon medallion: centre and radius (raised a little when the price has no tag and sits on the tile). */
const MEDAL_R = 64;

function facePath(g: CanvasRenderingContext2D): void {
  roundedRectPath(g, FACE_INSET, FACE_INSET, SIZE - FACE_INSET * 2, SIZE - FACE_INSET * 2, FACE_R);
}

/** Tiny deterministic random (a redraw per cash bundle must never make the decoration jump). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rgba = (c: number, a: number): string => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

/** Quilt: a 3 × 3 patchwork, every patch puffed (highlight and shade) and edged with running stitches. */
function paintQuilt(g: CanvasRenderingContext2D, L: PadLook): void {
  const cell = (SIZE - FACE_INSET * 2) / 3;
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const x = FACE_INSET + i * cell;
      const y = FACE_INSET + j * cell;
      const patch = (i + j) % 2 === 0 ? L.patch[(i + j * 3) % L.patch.length]! : L.face;
      roundedRectPath(g, x + 2, y + 2, cell - 4, cell - 4, 16);
      g.fillStyle = hex(patch);
      g.fill();
      const puff = g.createRadialGradient(x + cell * 0.35, y + cell * 0.3, 2, x + cell * 0.5, y + cell * 0.5, cell * 0.75);
      puff.addColorStop(0, 'rgba(255,255,255,0.42)');
      puff.addColorStop(0.55, 'rgba(255,255,255,0)');
      puff.addColorStop(1, 'rgba(110,70,50,0.16)');
      g.fillStyle = puff;
      g.fill();
      g.save();
      g.setLineDash([7, 6]);
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.strokeStyle = rgba(L.line, 0.95);
      roundedRectPath(g, x + 10, y + 10, cell - 20, cell - 20, 10);
      g.stroke();
      g.restore();
    }
  }
  // little cross-stitches where the patches meet
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.strokeStyle = rgba(PAD.honeyDeep, 0.55);
  for (let j = 1; j < 3; j++) {
    for (let i = 1; i < 3; i++) {
      const x = FACE_INSET + i * cell;
      const y = FACE_INSET + j * cell;
      g.beginPath();
      g.moveTo(x - 5, y - 5);
      g.lineTo(x + 5, y + 5);
      g.moveTo(x + 5, y - 5);
      g.lineTo(x - 5, y + 5);
      g.stroke();
    }
  }
}

/** Plate: four honey-pine planks with soft grain, a knot and a nail head at each end. */
function paintPlate(g: CanvasRenderingContext2D, L: PadLook): void {
  const rnd = seeded(7);
  const n = 4;
  const w = (SIZE - FACE_INSET * 2) / n;
  for (let i = 0; i < n; i++) {
    const x = FACE_INSET + i * w;
    const grad = g.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, hex(mixHex(L.patch[i % L.patch.length]!, 0xffffff, 0.12)));
    grad.addColorStop(1, hex(L.patch[i % L.patch.length]!));
    g.fillStyle = grad;
    g.fillRect(x, 0, w, SIZE);
    // grain: long soft waves down the plank
    g.lineWidth = 2;
    g.strokeStyle = rgba(L.line, 0.32);
    for (let k = 0; k < 3; k++) {
      const gx = x + w * (0.25 + k * 0.25) + (rnd() - 0.5) * 6;
      g.beginPath();
      g.moveTo(gx, 0);
      g.bezierCurveTo(gx + 8 * (rnd() - 0.5), SIZE * 0.33, gx + 10 * (rnd() - 0.5), SIZE * 0.66, gx + 6 * (rnd() - 0.5), SIZE);
      g.stroke();
    }
    if (i === 1 || i === 3) {
      const ky = SIZE * (i === 1 ? 0.78 : 0.24);
      g.beginPath();
      g.ellipse(x + w * 0.5, ky, 7, 11, 0, 0, Math.PI * 2);
      g.strokeStyle = rgba(L.line, 0.45);
      g.lineWidth = 2.5;
      g.stroke();
    }
    // seam
    if (i > 0) {
      g.fillStyle = rgba(L.line, 0.55);
      g.fillRect(x - 1.5, 0, 3, SIZE);
    }
    // nail heads
    for (const ny of [26, SIZE - 26]) {
      g.beginPath();
      g.arc(x + w / 2, ny, 4.5, 0, Math.PI * 2);
      g.fillStyle = hex(PAD.boardDark);
      g.fill();
      g.beginPath();
      g.arc(x + w / 2 - 1.2, ny - 1.4, 1.6, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,240,215,0.75)';
      g.fill();
    }
  }
}

/** Lantern: frosted glass with a warm candle heart, frost ferns creeping from the corners and a few glints. */
function paintLantern(g: CanvasRenderingContext2D, L: PadLook): void {
  const heart = g.createRadialGradient(SIZE / 2, SIZE / 2, 10, SIZE / 2, SIZE / 2, SIZE * 0.62);
  heart.addColorStop(0, rgba(L.patch[2]!, 1));
  heart.addColorStop(0.5, rgba(L.patch[2]!, 0.5));
  heart.addColorStop(1, rgba(L.patch[2]!, 0));
  g.fillStyle = heart;
  g.fillRect(0, 0, SIZE, SIZE);
  const rnd = seeded(11);
  g.strokeStyle = rgba(L.line, 0.75);
  g.lineCap = 'round';
  const fern = (x: number, y: number, a: number, len: number, depth: number): void => {
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    g.lineWidth = 1 + depth;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(ex, ey);
    g.stroke();
    if (depth <= 0) return;
    for (let k = 1; k <= 3; k++) {
      const t = k / 4;
      const bx = x + (ex - x) * t;
      const by = y + (ey - y) * t;
      fern(bx, by, a + 0.7, len * 0.36, depth - 1);
      fern(bx, by, a - 0.7, len * 0.36, depth - 1);
    }
  };
  const c = FACE_INSET + 14;
  fern(c, c, Math.PI / 4 + (rnd() - 0.5) * 0.3, 62, 2);
  fern(SIZE - c, c, (Math.PI * 3) / 4 + (rnd() - 0.5) * 0.3, 54, 2);
  fern(c, SIZE - c, -Math.PI / 4 + (rnd() - 0.5) * 0.3, 54, 2);
  fern(SIZE - c, SIZE - c, (-Math.PI * 3) / 4 + (rnd() - 0.5) * 0.3, 62, 2);
  // glints
  g.fillStyle = 'rgba(255,255,255,0.9)';
  for (let k = 0; k < 6; k++) {
    const x = 30 + rnd() * (SIZE - 60);
    const y = 30 + rnd() * (SIZE - 60);
    const r = 2 + rnd() * 3;
    g.beginPath();
    g.moveTo(x, y - r * 2);
    g.lineTo(x + r * 0.5, y);
    g.lineTo(x, y + r * 2);
    g.lineTo(x - r * 0.5, y);
    g.closePath();
    g.moveTo(x - r * 2, y);
    g.lineTo(x, y + r * 0.5);
    g.lineTo(x + r * 2, y);
    g.lineTo(x, y - r * 0.5);
    g.closePath();
    g.fill();
  }
}

/**
 * Warm honey rising from the bottom as the pad is paid: a gentle wave on top (its phase moves with every bundle, so
 * it sloshes as it fills), a light meniscus, a glint, deepening toward the bottom. Lets the face show through a little.
 */
function paintHoney(g: CanvasRenderingContext2D, ratio: number): void {
  if (ratio <= 0) return;
  const span = SIZE - FACE_INSET * 2;
  const top = FACE_INSET + span * (1 - Math.min(1, ratio));
  const amp = ratio >= 1 ? 0 : 5;
  const phase = ratio * 9;
  const surface = (x: number): number => top + Math.sin((x / SIZE) * Math.PI * 3 + phase) * amp;
  g.beginPath();
  g.moveTo(0, SIZE);
  for (let x = 0; x <= SIZE; x += 8) g.lineTo(x, surface(x));
  g.lineTo(SIZE, SIZE);
  g.closePath();
  const hg = g.createLinearGradient(0, top - amp, 0, SIZE);
  hg.addColorStop(0, rgba(PAD.honeyLight, 0.9));
  hg.addColorStop(0.3, rgba(PAD.honey, 0.86));
  hg.addColorStop(1, rgba(PAD.honeyDeep, 0.9));
  g.fillStyle = hg;
  g.fill();
  if (ratio < 1) {
    g.beginPath();
    for (let x = 0; x <= SIZE; x += 8) {
      if (x === 0) g.moveTo(x, surface(x) + 2);
      else g.lineTo(x, surface(x) + 2);
    }
    g.lineWidth = 5;
    g.strokeStyle = rgba(0xfff3cf, 0.85);
    g.stroke();
  }
  // a glint riding in the honey
  const gy = Math.min(SIZE - 30, Math.max(top + 18, SIZE - 40));
  if (gy < SIZE - 20) {
    g.beginPath();
    g.ellipse(40, gy, 12, 5, -0.3, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,250,232,0.5)';
    g.fill();
  }
}

/** The look's face (gradient + decoration) with the honey fill and a soft shade under the snow rim, clipped. */
function paintFace(g: CanvasRenderingContext2D, s: PadStyle, ratio: number): void {
  const L: PadLook = PAD.looks[s];
  g.save();
  facePath(g);
  g.clip();
  const grad = g.createLinearGradient(0, 0, 0, SIZE);
  grad.addColorStop(0, hex(L.face));
  grad.addColorStop(1, hex(L.faceShade));
  g.fillStyle = grad;
  g.fillRect(0, 0, SIZE, SIZE);
  if (s === 'quilt') paintQuilt(g, L);
  else if (s === 'plate') paintPlate(g, L);
  else paintLantern(g, L);
  paintHoney(g, ratio);
  if (L.edge) {
    facePath(g);
    g.lineWidth = 34;
    g.strokeStyle = rgba(L.side, L.edge);
    g.stroke();
  }
  facePath(g);
  g.lineWidth = 30;
  g.strokeStyle = 'rgba(90,55,40,0.13)';
  g.stroke();
  g.restore();
}

/** The colour icon cut-outs are filled with (the medallion's, so details read as holes). */
let cutColor = '#ffffff';

/** Round medallion with the icon in warm ink (readable at 40 px on every look). */
function paintMedal(g: CanvasRenderingContext2D, s: PadStyle, cy: number, drawIcon: (g: CanvasRenderingContext2D) => void, iconScale: number): void {
  const L = PAD.looks[s];
  const cx = SIZE / 2;
  g.beginPath();
  g.arc(cx, cy + 5, MEDAL_R, 0, Math.PI * 2);
  g.fillStyle = 'rgba(80,45,30,0.2)';
  g.fill();
  g.beginPath();
  g.arc(cx, cy, MEDAL_R, 0, Math.PI * 2);
  const mg = g.createRadialGradient(cx - 18, cy - 22, 6, cx, cy, MEDAL_R);
  mg.addColorStop(0, hex(mixHex(L.medal, 0xffffff, 0.5)));
  mg.addColorStop(1, hex(L.medal));
  g.fillStyle = mg;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = hex(L.medalRim);
  g.stroke();
  if (s === 'quilt') {
    g.save();
    g.setLineDash([6, 5]);
    g.lineWidth = 2.5;
    g.strokeStyle = hex(L.medalRim);
    g.beginPath();
    g.arc(cx, cy, MEDAL_R - 10, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  g.save();
  g.translate(cx, cy);
  g.scale(iconScale, iconScale);
  g.fillStyle = hex(PAD.ink);
  g.strokeStyle = hex(PAD.ink);
  cutColor = hex(L.medal);
  drawIcon(g);
  cutColor = '#ffffff';
  g.restore();
}

/** Brass rosette with ribbon tails: "LV" over the level number. */
function paintBadge(g: CanvasRenderingContext2D, badge: string): void {
  const cx = 198;
  const cy = 58;
  g.fillStyle = hex(PAD.honeyDeep);
  for (const dx of [-12, 12]) {
    g.beginPath();
    g.moveTo(cx + dx - 9, cy + 18);
    g.lineTo(cx + dx + 9, cy + 18);
    g.lineTo(cx + dx + 9 + dx * 0.25, cy + 60);
    g.lineTo(cx + dx + dx * 0.25, cy + 51);
    g.lineTo(cx + dx - 9 + dx * 0.25, cy + 60);
    g.closePath();
    g.fill();
  }
  g.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = i % 2 === 0 ? 46 : 41;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = hex(PAD.brass);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = hex(PAD.honeyDeep);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, 33, 0, Math.PI * 2);
  g.fillStyle = hex(PAD.tag);
  g.fill();
  const num = badge.replace(/^LV\s*/i, '');
  g.fillStyle = hex(PAD.ink);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 15px ${GAME_FONT}`;
  g.fillText('LV', cx, cy - 16);
  g.font = `700 ${num.length > 1 ? 30 : 34}px ${GAME_FONT}`;
  g.fillText(num, cx, cy + 7, 56);
}

/** Frost wash and a padlock over the medallion (a preview pad: for sale, not yet). */
function paintLockedFace(g: CanvasRenderingContext2D, cy: number): void {
  g.save();
  facePath(g);
  g.fillStyle = rgba(PAD.frost, 0.62);
  g.fill();
  g.translate(SIZE / 2, cy);
  g.lineWidth = 11;
  g.lineCap = 'round';
  g.strokeStyle = hex(PAD.ink);
  g.beginPath();
  g.arc(0, -16, 20, Math.PI, 0);
  g.lineTo(20, 0);
  g.moveTo(-20, 0);
  g.lineTo(-20, -16);
  g.stroke();
  roundedRectPath(g, -32, -2, 64, 50, 10);
  g.fillStyle = hex(PAD.ink);
  g.fill();
  g.fillStyle = hex(PAD.tag);
  g.beginPath();
  g.arc(0, 18, 7, 0, Math.PI * 2);
  g.fill();
  g.fillRect(-3, 20, 6, 14);
  g.restore();
}

/** No tag hung (a stand-alone tile): the price sits on a little cream label on the tile instead. */
function paintTilePrice(g: CanvasRenderingContext2D, text: string): void {
  if (!text) return;
  g.font = `700 40px ${GAME_FONT}`;
  const w = Math.min(SIZE - 40, g.measureText(text).width + 40);
  roundedRectPath(g, SIZE / 2 - w / 2, 190, w, 50, 18);
  g.fillStyle = hex(PAD.tag);
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = hex(PAD.tagEdge);
  g.stroke();
  g.fillStyle = hex(PAD.ink);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, SIZE / 2, 217, w - 20);
}

/** The "build here" icon of an empty town lot: a little house with a plus. */
function drawBuildIcon(g: CanvasRenderingContext2D): void {
  g.beginPath();
  poly(g, [[-58, 4], [-6, -48], [46, 4], [36, 4], [36, 50], [-48, 50], [-48, 4]]);
  addRoundedRect(g, -18, 18, 22, 32, 4);
  g.fill('evenodd');
  g.save();
  g.translate(38, -30);
  g.beginPath();
  g.arc(0, 0, 24, 0, Math.PI * 2);
  g.fillStyle = hex(tagInks().cash);
  g.fill();
  g.lineCap = 'round';
  g.lineWidth = 9;
  g.strokeStyle = hex(PAD.tag);
  g.beginPath();
  g.moveTo(0, -12);
  g.lineTo(0, 12);
  g.moveTo(-12, 0);
  g.lineTo(12, 0);
  g.stroke();
  g.restore();
}

function draw(texture: THREE.CanvasTexture, p: PadTextureParams): void {
  const g = (texture.image as HTMLCanvasElement).getContext('2d')!;
  const ratio = Math.min(1, Math.max(0, p.ratio));
  const tag = tags.get(texture);
  g.clearRect(0, 0, SIZE, SIZE);
  paintFace(g, p.style, ratio);
  const cy = tag || p.kind === 'build' ? SIZE / 2 : 104;
  if (p.kind === 'construction') {
    const rows = (p.logs && p.logs.total > 0 ? 1 : 0) + (p.extra ? 1 : 0) + (p.cash ? 1 : 0);
    paintMedal(g, p.style, cy, SHELTER_ICONS[p.icon as ShelterIcon], rows >= 3 ? 0.72 : 0.78);
  } else if (p.kind === 'build') {
    paintMedal(g, p.style, cy, drawBuildIcon, 0.82);
  } else {
    paintMedal(g, p.style, cy, ICONS[p.icon as PadIcon], 0.84);
  }
  if (p.badge) paintBadge(g, p.badge);
  if (p.locked !== undefined) paintLockedFace(g, cy);
  if (tag) paintTag(tag, p);
  else if (p.locked) paintTilePrice(g, p.locked);
  else if (p.kind === 'pad') paintTilePrice(g, p.text);
  else if (p.kind === 'construction' && p.cash && p.cash.left > 0) paintTilePrice(g, formatCost(p.cash.left));
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
  const p: PadTextureParams = { kind: 'pad', icon: iconType, text: costText, ratio: progressRatio, badge, style: params.get(texture)?.style ?? style };
  params.set(texture, p);
  draw(texture, p);
  hookFont(texture);
  return texture;
}

/** The empty town lot's BUILD tile (town/LotPad.ts): a house with a plus on the medallion, no price. */
export function createBuildTexture(): THREE.CanvasTexture {
  const texture = makeCanvasTexture(SIZE, SIZE).texture;
  const p: PadTextureParams = { kind: 'build', icon: 'lot', text: '', ratio: 0, style };
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


// ---------------------------------------------------------------------------
// Construction pads
// ---------------------------------------------------------------------------

/**
 * Construction pad face: the shelter icon on the medallion, the fill rising with the combined progress; the
 * requirement rows ("log icon + logs left", "bill icon + cash left", a finished one ticked) go on the hanging tag.
 * Redraws `target` in place. `locked` (a preview pad): the face is frosted under a padlock and the tag shows that note.
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
  const p: PadTextureParams = {
    kind: 'construction',
    icon,
    text: '',
    ratio,
    logs,
    cash,
    ...(extra ? { extra } : {}),
    locked,
    style: params.get(texture)?.style ?? style,
  };
  params.set(texture, p);
  draw(texture, p);
  hookFont(texture);
  return texture;
}

/** Fredoka may finish loading after the first draw: redraw once with the latest parameters. */
function hookFont(texture: THREE.CanvasTexture): void {
  if (fontHooked.has(texture)) return;
  fontHooked.add(texture);
  liveFaces.add(new WeakRef(texture));
  if (typeof document === 'undefined' || !document.fonts) return;
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
// The hanging price tag
// ---------------------------------------------------------------------------

/** 0.9.11: the tag canvas is wider than tall (TAG_W_PX × TAG_PX) so a material row can spell its name ("12 Clay"). */
const TAG_PX = 256;
const TAG_W_PX = 384;
/**
 * World height of the tag's canvas (sign-local units: the sign's scale applies); the width follows the canvas.
 * 0.9.11 (Dino: "the upgrade tiles are small, I can't see what I need to bring"): 1.75 → 2.3.
 */
const TAG_WORLD = 2.3;
/** The sign board is raised this much so the tag hangs about where the board used to be. */
const TAG_LIFT = 0.82;
const SIGN_W = 2.5;
const SIGN_H = 0.625;

interface Tag {
  mesh: THREE.Mesh;
  g: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  /** What the rows said last time (a change makes the tag swing). */
  key: string;
  kickAt: number;
  phase: number;
}

const tags = new WeakMap<THREE.CanvasTexture, Tag>();

interface TagRow {
  icon: (g: CanvasRenderingContext2D, x: number, y: number) => void;
  /** null: the requirement is done (a tick instead of a number). */
  text: string | null;
  /** 0.9.11: the item's name after the amount ("Clay"), so look-alike icons (clay and bricks) never get mixed up. */
  label?: string;
}

/**
 * 0.9.11: the item icons of the HUD and the market (ui/materialIcons.ts SVGs) as images for the tags, so a tag shows
 * exactly the picture the rest of the game uses for that item. Loaded once per kind; until an image is ready the
 * tinted canvas icon stands in, and every live face redraws when one arrives.
 */
const itemImages = new Map<string, HTMLImageElement>();
function itemImage(kind: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  let img = itemImages.get(kind);
  if (!img) {
    img = new Image();
    const svg = materialIcon(kind as Parameters<typeof materialIcon>[0]).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" ');
    img.onload = () => {
      for (const ref of liveFaces) {
        const t = ref.deref();
        const p = t ? params.get(t) : undefined;
        if (!t || !p) liveFaces.delete(ref);
        else if (p.extra?.kind === kind) draw(t, p);
      }
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    itemImages.set(kind, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** An item's tag icon: its HUD picture on a soft white disc when loaded, else the canvas fallback. */
function drawItemIcon(g: CanvasRenderingContext2D, x: number, y: number, kind: string): void {
  const img = itemImage(kind);
  if (!img) {
    if (kind === 'toy') drawToyIcon(g, x, y, 0.56);
    else if (kind === 'crate') drawCrateIcon(g, x, y, 0.52);
    else if (kind === 'log') drawLogIcon(g, x, y, 0.62);
    else drawMaterialIcon(g, x, y, kind, 0.52);
    return;
  }
  g.save();
  g.beginPath();
  g.arc(x, y, 25, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fill();
  g.drawImage(img, x - 23, y - 23, 46, 46);
  g.restore();
}

function drawTagLock(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.save();
  g.translate(x, y);
  g.lineWidth = 6;
  g.strokeStyle = hex(PAD.ink);
  g.beginPath();
  g.arc(0, -8, 10, Math.PI, 0);
  g.lineTo(10, 0);
  g.moveTo(-10, 0);
  g.lineTo(-10, -8);
  g.stroke();
  roundedRectPath(g, -16, -2, 32, 24, 6);
  g.fillStyle = hex(PAD.ink);
  g.fill();
  g.restore();
}

function tagRows(p: PadTextureParams): TagRow[] {
  if (p.locked !== undefined) return [{ icon: drawTagLock, text: p.locked || 'Soon' }];
  if (p.kind === 'pad') return [{ icon: (g, x, y) => drawBill(g, x, y, 0.5), text: p.text }];
  if (p.kind !== 'construction') return [];
  const row = (req: { left: number; total: number }, icon: TagRow['icon'], cash = false): TagRow => ({
    icon,
    text: req.left <= 0 ? null : cash ? formatCost(req.left) : `${req.left}`,
  });
  const rows: TagRow[] = [];
  if (p.logs && p.logs.total > 0) rows.push(row(p.logs, (g, x, y) => drawLogIcon(g, x, y, 0.62)));
  if (p.extra) {
    const k = p.extra.kind;
    const r = row(p.extra, (g, x, y) => drawItemIcon(g, x, y, k));
    if (r.text !== null) r.label = materialLabel(k as Parameters<typeof materialLabel>[0]);
    rows.push(r);
  }
  if (p.cash) rows.push(row(p.cash, (g, x, y) => drawBill(g, x, y, 0.5), true));
  return rows;
}

/** A luggage tag: clipped top corners, softly rounded bottom. */
function tagPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const c = 16;
  const r = 12;
  g.beginPath();
  g.moveTo(x + c, y);
  g.lineTo(x + w - c, y);
  g.lineTo(x + w, y + c);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + c);
  g.closePath();
}

function paintTag(tag: Tag, p: PadTextureParams): void {
  const g = tag.g;
  const rows = tagRows(p);
  g.clearRect(0, 0, TAG_W_PX, TAG_PX);
  tag.mesh.visible = rows.length > 0;
  if (rows.length === 0) {
    tag.texture.needsUpdate = true;
    return;
  }
  const three = rows.length >= 3;
  const rowH = three ? 50 : 56;
  const font = three ? 42 : 50;
  g.font = `700 ${font}px ${GAME_FONT}`;
  const labelFont = `600 ${Math.round(font * 0.72)}px ${GAME_FONT}`;
  let textW = 0;
  for (const r of rows) {
    let rw = r.text === null ? 44 : g.measureText(r.text).width;
    if (r.label && r.text !== null) {
      g.font = labelFont;
      rw += 10 + g.measureText(r.label).width;
      g.font = `700 ${font}px ${GAME_FONT}`;
    }
    textW = Math.max(textW, rw);
  }
  const w = Math.max(138, Math.min(TAG_W_PX - 10, 72 + textW + 22));
  const x0 = TAG_W_PX / 2 - w / 2;
  const top = 42;
  const hole = top + 17;
  const h = 34 + rows.length * rowH + 6;
  // twine up to the board, knotted through the eyelet
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 4;
  g.strokeStyle = hex(PAD.twine);
  g.beginPath();
  g.moveTo(TAG_W_PX / 2 - 46, 0);
  g.lineTo(TAG_W_PX / 2, hole);
  g.lineTo(TAG_W_PX / 2 + 46, 0);
  g.stroke();
  // card, its shadow and a stitched edge
  g.save();
  g.translate(3, 5);
  tagPath(g, x0, top, w, h);
  g.fillStyle = 'rgba(70,45,30,0.22)';
  g.fill();
  g.restore();
  tagPath(g, x0, top, w, h);
  const cg = g.createLinearGradient(0, top, 0, top + h);
  cg.addColorStop(0, hex(PAD.tag));
  cg.addColorStop(1, hex(mixHex(PAD.tag, PAD.tagEdge, 0.25)));
  g.fillStyle = cg;
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = hex(PAD.tagEdge);
  g.stroke();
  g.save();
  g.setLineDash([5, 5]);
  g.lineWidth = 2;
  g.strokeStyle = rgba(PAD.tagEdge, 0.9);
  tagPath(g, x0 + 7, top + 7, w - 14, h - 14);
  g.stroke();
  g.restore();
  // brass eyelet
  g.beginPath();
  g.arc(TAG_W_PX / 2, hole, 9, 0, Math.PI * 2);
  g.fillStyle = hex(PAD.brass);
  g.fill();
  g.beginPath();
  g.arc(TAG_W_PX / 2, hole, 4.5, 0, Math.PI * 2);
  g.fillStyle = hex(PAD.boardDark);
  g.fill();
  // rows: icon, then the amount (or a tick)
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const y = top + 34 + i * rowH + rowH / 2;
    r.icon(g, x0 + 38, y);
    if (r.text === null) drawCheck(g, x0 + 72, y, tagInks().done);
    else {
      g.font = `700 ${font}px ${GAME_FONT}`;
      g.fillStyle = hex(r.text.startsWith('$') ? tagInks().cash : PAD.ink);
      g.fillText(r.text, x0 + 70, y + 2, w - 84);
      if (r.label) {
        const tw = g.measureText(r.text).width;
        g.font = labelFont;
        g.fillStyle = hex(PAD.ink);
        g.globalAlpha = 0.78;
        g.fillText(r.label, x0 + 70 + tw + 10, y + 4, Math.max(20, w - 94 - tw));
        g.globalAlpha = 1;
      }
    }
  }
  tag.texture.needsUpdate = true;
  const key = rows.map((r) => r.text ?? '✓').join('|');
  if (tag.key && key !== tag.key) tag.kickAt = nowSeconds();
  tag.key = key;
}

const nowSeconds = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now()) / 1000;

let tagGeo: THREE.PlaneGeometry | null = null;
let raisedBoard: THREE.PlaneGeometry | null = null;

/**
 * Hang a price tag under a pad's sign (createPadSign), on twine: from now on the price (or the construction rows, or a
 * preview pad's note) is drawn on the tag every time `texture` redraws, and the tile keeps only its icon. The board
 * rises so the tag hangs about where the board used to be. The tag sways a little and swings when the amount changes
 * (a bundle lands); it holds still under Reduce motion. Returns the tag (a child of the sign).
 */
export function hangPriceTag(sign: THREE.Mesh, texture: THREE.CanvasTexture): THREE.Mesh {
  const had = tags.get(texture);
  if (had) return had.mesh;
  const { ctx: g, texture: tex } = makeCanvasTexture(TAG_W_PX, TAG_PX);
  tagGeo ??= new THREE.PlaneGeometry((TAG_WORLD * TAG_W_PX) / TAG_PX, TAG_WORLD).translate(0, -TAG_WORLD / 2, 0);
  raisedBoard ??= new THREE.PlaneGeometry(SIGN_W, SIGN_H).translate(0, TAG_LIFT, 0);
  const m = new THREE.Mesh(tagGeo, basic(0xffffff, { map: tex, transparent: true, depthWrite: false }));
  m.name = 'padTag';
  m.renderOrder = 4;
  m.castShadow = false;
  m.receiveShadow = false;
  m.position.set(0, -SIGN_H / 2 + TAG_LIFT + 0.03, -0.004);
  sign.geometry = raisedBoard;
  sign.add(m);
  const tag: Tag = { mesh: m, g, texture: tex, key: '', kickAt: -10, phase: Math.random() * Math.PI * 2 };
  tags.set(texture, tag);
  m.onBeforeRender = () => {
    let a = 0;
    if (motionScale() >= 1) {
      const now = nowSeconds();
      a = 0.03 * Math.sin(now * 1.2 + tag.phase);
      const k = now - tag.kickAt;
      if (k < 1.8) a += 0.11 * Math.exp(-k * 3) * Math.sin(k * 10);
    }
    if (a !== m.rotation.z) {
      m.rotation.z = a;
      m.updateMatrixWorld();
    }
  };
  const p = params.get(texture);
  if (p) draw(texture, p);
  return m;
}

/** Free the canvas of a sign's hanging tag (the sign's own texture is the caller's). */
export function disposePriceTag(sign: THREE.Mesh): void {
  for (const c of sign.children) {
    if (c.name !== 'padTag') continue;
    const mat = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const SLAB_HEIGHT = 0.16;
const bodyCache = new Map<string, THREE.BufferGeometry>();
let bodyMat: THREE.MeshToonMaterial | null = null;

/** One shared vertex-coloured toon material for every pad body (slab + snow rim). */
function padBodyMaterial(): THREE.MeshToonMaterial {
  if (!bodyMat) {
    bodyMat = toonUnique(0xffffff);
    bodyMat.vertexColors = true;
  }
  return bodyMat;
}

function roundedSquare(h: number, r: number): THREE.Shape {
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
  return s;
}

function colorize(g: THREE.BufferGeometry, color: (y: number, ny: number) => THREE.Color): void {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = color(pos.getY(i), nor.getY(i));
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
}

/**
 * A fat, lumpy snow roll along the tile's edge (the snow-globe rim): a tube swept around the rounded square, its
 * radius wobbling so it reads as packed snow, flattened underneath, lit white on top and blue-grey below.
 */
function snowRim(h: number, r: number, side: number): THREE.BufferGeometry {
  const r0 = side * 0.052;
  const inset = r0 * 0.5;
  const a = h - inset - Math.max(0.02, r - inset);
  const rr = Math.max(0.02, r - inset);
  const K = 6;
  const S = 10;
  const pts: { x: number; z: number; nx: number; nz: number }[] = [];
  const corners = [
    [a, a],
    [-a, a],
    [-a, -a],
    [a, -a],
  ] as const;
  for (let i = 0; i < 4; i++) {
    const [cx, cz] = corners[i]!;
    for (let j = 0; j <= K; j++) {
      const t = ((i + j / K) * Math.PI) / 2;
      pts.push({ x: cx + rr * Math.cos(t), z: cz + rr * Math.sin(t), nx: Math.cos(t), nz: Math.sin(t) });
    }
    const t = ((i + 1) * Math.PI) / 2;
    const [dx, dz] = corners[(i + 1) % 4]!;
    for (let j = 1; j < S; j++) {
      const k = j / S;
      pts.push({ x: cx + (dx - cx) * k + rr * Math.cos(t), z: cz + (dz - cz) * k + rr * Math.sin(t), nx: Math.cos(t), nz: Math.sin(t) });
    }
  }
  const M = 9;
  const n = pts.length;
  const pos = new Float32Array(n * M * 3);
  const col = new Float32Array(n * M * 3);
  const lit = new THREE.Color(PAD.snow);
  const shade = new THREE.Color(PAD.snowShade);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const u = i / n;
    const f = 1 + 0.17 * Math.sin(u * Math.PI * 2 * 9) + 0.08 * Math.sin(u * Math.PI * 2 * 17 + 1.7);
    for (let j = 0; j < M; j++) {
      const th = (j / M) * Math.PI * 2;
      const up = Math.sin(th);
      const out = Math.cos(th);
      const rad = r0 * f;
      const v = (i * M + j) * 3;
      pos[v] = p.x + p.nx * out * rad;
      pos[v + 1] = SLAB_HEIGHT + r0 * 0.2 + up * rad * (up < 0 ? 0.35 : 0.9);
      pos[v + 2] = p.z + p.nz * out * rad;
      c.copy(shade).lerp(lit, Math.min(1, Math.max(0, 0.45 + up * 0.75)));
      col[v] = c.r;
      col[v + 1] = c.g;
      col[v + 2] = c.b;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      const a0 = i * M + j;
      const a1 = i2 * M + j;
      const b0 = i * M + j2;
      const b1 = i2 * M + j2;
      index.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Slab (the look's side colour, a hair darker at the foot) + snow rim, merged: one draw call per pad body. */
function padBodyGeometry(side: number, s: PadStyle): THREE.BufferGeometry {
  const key = `${side.toFixed(3)}|${s}`;
  let g = bodyCache.get(key);
  if (!g) {
    const L: PadLook = PAD.looks[s];
    const r = ((CORNER + BORDER / 2) / SIZE) * side;
    const h = side / 2;
    const bev = Math.min(0.04, side * 0.018);
    const slab = new THREE.ExtrudeGeometry(roundedSquare(h - bev, Math.max(0.01, r - bev)), {
      depth: SLAB_HEIGHT - bev * 2,
      bevelEnabled: true,
      bevelThickness: bev,
      bevelSize: bev,
      bevelSegments: 2,
      curveSegments: 6,
    });
    slab.rotateX(-Math.PI / 2); // extrusion now points up (+Y)
    slab.translate(0, bev, 0);
    slab.deleteAttribute('uv');
    const top = new THREE.Color(L.side);
    const foot = new THREE.Color(mixHex(L.side, PAD.ink, L.foot ?? 0.25));
    const c = new THREE.Color();
    colorize(slab, (y) => c.copy(foot).lerp(top, Math.min(1, y / SLAB_HEIGHT)));
    const merged = mergeGeometries([slab, snowRim(h, r, side)]);
    slab.dispose();
    g = merged ?? slab;
    bodyCache.set(key, g);
  }
  return g;
}

export interface PadModelOptions {
  /**
   * Rotation of the tile around Y. Default: the camera yaw, so the texture's "up" points to the top of the
   * screen and the icon reads upright. The tile is then a square on screen (a diamond-in-diamond on the ground).
   */
  yaw?: number;
  /** Side of the visible tile as a fraction of `size` (default 1). */
  fill?: number;
}

/**
 * Floor tile showing `texture` (in the look it was drawn in) on a chunky rounded slab with a snow rim; origin at the
 * tile's floor centre. The face is lit like the world (it takes the player's shadow) with a soft warm lamplight of its
 * own at night; padDim() dims it.
 */
export function createPadModel(size: number, texture: THREE.Texture, opts: PadModelOptions = {}): THREE.Group {
  const yaw = opts.yaw ?? THREE.MathUtils.degToRad(CAMERA.yawDeg);
  const side = size * (opts.fill ?? 1);
  const s = params.get(texture as THREE.CanvasTexture)?.style ?? style;
  const root = new THREE.Group();
  root.name = 'padModel';
  root.add(mesh(padBodyGeometry(side, s), padBodyMaterial(), { cast: false, receive: true }));
  // lit like the world by day; at night the face keeps a soft warm lamplight of its own (the glow registry, so the
  // comfort Glow slider scales it) and stays readable
  // (the ice lantern glows the most: its candle heart is the point of it)
  const lantern = s === 'lantern';
  const topMat = toonUnique(0xffffff, { map: texture, transparent: true, depthWrite: false, emissive: PAD.night, emissiveIntensity: lantern ? 0.1 : 0.05 });
  topMat.emissiveMap = texture;
  registerGlow(topMat, lantern ? 6 : 7);
  const top = mesh(geo.ground(side, side), topMat, { cast: false, receive: true });
  top.position.y = SLAB_HEIGHT + 0.004;
  top.renderOrder = 3;
  root.add(top);
  root.rotation.y = yaw;
  const holder = new THREE.Group();
  holder.userData.padTop = topMat;
  holder.add(root);
  return holder;
}

/** Dim a pad model's face by `k` (0 = as drawn, 1 = the "can't pay yet" dim): no shake, just quieter. */
export function padDim(model: THREE.Object3D, k: number): void {
  const m = model.userData.padTop as THREE.MeshToonMaterial | undefined;
  if (!m) return;
  const v = 1 - 0.26 * Math.max(0, Math.min(1, k));
  if (m.color.r !== v) m.color.setScalar(v);
}

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------

/** The snow cap of a board whose top edge runs from (bx, by) `bw` px wide: soft bumps with a couple of drips. */
function paintSnowCap(g: CanvasRenderingContext2D, bx: number, by: number, bw: number): void {
  const seg = 34;
  const n = Math.floor((bw - 40) / seg);
  const x0 = bx + (bw - n * seg) / 2;
  g.beginPath();
  g.moveTo(x0, by + 8);
  for (let i = 0; i < n; i++) {
    const cx = x0 + i * seg + seg / 2;
    g.quadraticCurveTo(cx, by - 14 - (i % 3 === 1 ? 4 : 0), x0 + (i + 1) * seg, by + 4);
  }
  for (let i = n; i > 0; i--) {
    const x = x0 + i * seg;
    const drip = i % 4 === 2 ? 9 : 0;
    g.quadraticCurveTo(x - seg / 2, by + 12 + drip, x - seg, by + 9);
  }
  g.closePath();
  const sg = g.createLinearGradient(0, by - 14, 0, by + 16);
  sg.addColorStop(0, hex(PAD.snow));
  sg.addColorStop(1, hex(PAD.snowShade));
  g.fillStyle = sg;
  g.fill();
}

/** A snow-capped wooden board (two planks, soft grain), brass-trimmed when `gold`. Fills the canvas width. */
function paintBoard(g: CanvasRenderingContext2D, w: number, h: number, gold: boolean): { x: number; y: number; w: number; h: number } {
  const bx = 8;
  const by = 18;
  const bw = w - 16;
  const bh = h - by - 6;
  roundedRectPath(g, bx, by + 4, bw, bh, 26);
  g.fillStyle = 'rgba(60,35,22,0.3)';
  g.fill();
  roundedRectPath(g, bx, by, bw, bh, 26);
  const bg = g.createLinearGradient(0, by, 0, by + bh);
  bg.addColorStop(0, hex(PAD.boardLight));
  bg.addColorStop(1, hex(PAD.board));
  g.fillStyle = bg;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = rgba(PAD.boardDark, 0.45);
  g.fillRect(bx, by + bh / 2 - 1.5, bw, 3);
  g.strokeStyle = rgba(PAD.boardDark, 0.22);
  g.lineWidth = 2;
  for (let k = 0; k < 4; k++) {
    const y = by + 12 + k * (bh / 4);
    g.beginPath();
    g.moveTo(bx, y);
    g.bezierCurveTo(bx + bw * 0.3, y - 4, bx + bw * 0.6, y + 5, bx + bw, y - 2);
    g.stroke();
  }
  g.restore();
  roundedRectPath(g, bx, by, bw, bh, 26);
  g.lineWidth = gold ? 8 : 6;
  g.strokeStyle = hex(gold ? PAD.brass : PAD.boardDark);
  g.stroke();
  if (gold) {
    g.fillStyle = hex(PAD.brass);
    for (const [x, y] of [
      [bx + 22, by + 16],
      [bx + bw - 22, by + 16],
      [bx + 22, by + bh - 16],
      [bx + bw - 22, by + bh - 16],
    ] as const) {
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
  }
  paintSnowCap(g, bx, by, bw);
  return { x: bx, y: by, w: bw, h: bh };
}

const signPainters = new WeakMap<THREE.Mesh, (label: string) => void>();

/** Floating label sign ("HARVESTER"): a snow-capped wooden board with cream lettering. Face it to the camera. */
export function createPadSign(label: string, gold = false): THREE.Mesh {
  const w = 512;
  const h = 128;
  const { ctx: g, texture } = makeCanvasTexture(w, h);
  let text = label;
  const paint = (): void => {
    g.clearRect(0, 0, w, h);
    const b = paintBoard(g, w, h, gold);
    g.font = `700 58px ${GAME_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 9;
    g.strokeStyle = hex(PAD.boardDark);
    g.fillStyle = hex(PAD.tag);
    const ty = b.y + b.h / 2 + 4;
    g.strokeText(text, w / 2, ty, w - 70);
    g.fillText(text, w / 2, ty, w - 70);
    texture.needsUpdate = true;
  };
  paint();
  if (typeof document !== 'undefined' && document.fonts) {
    void document.fonts
      .load(`700 58px ${GAME_FONT}`)
      .catch(() => undefined)
      .then(paint);
  }
  const m = new THREE.Mesh(geo.plane(SIGN_W, SIGN_H), basic(0xffffff, { map: texture, transparent: true, depthWrite: false }));
  wearTagLook(m, SIGN_H, 58 / 128); // 0.9.8 brief 14: soft distance fade + 13 px lettering floor
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

/**
 * [0.9.9] The MANAGE board of a built machine or building (Dino: "the manage boards are kinda small and in weird spots
 * next to the buildings"). A cream card with a brass trim and a snow cap, a honey cog beside "MANAGE" and the building's
 * own name under it, standing on a short wooden post. The origin is the post's foot: owners plant it on the ground
 * just outside the manage tile on the building's side, so the board reads as the building's own sign.
 * - One mesh, one draw call: the board and the post are two quads of one shared geometry over one texture (the post
 *   samples a strip of wood painted under the board).
 * - It stands upright (fx/manageSign.ts faceCameraUpright turns it to the camera around Y only), so the post really is
 *   vertical and the board never leans into the wall behind it; the geometry is stretched by 1/cos(pitch) so it shows
 *   at its nominal size on screen.
 * - The texture is shared per name; every sign has its own material (the owners fade each one with the player's
 *   distance), so disposeManageSign frees the material only.
 */
const MB_PX_W = 384;
const MB_PX_H = 208;
/** The board's rows of the canvas (the rest holds the post's wood strip). */
const MB_BOARD_PX = 160;
const MB_FONT = 52;
const MB_NAME_FONT = 34;
const MB_POST_W = 0.2;
const manageTextures = new Map<string, THREE.CanvasTexture>();
let manageGeo: THREE.BufferGeometry | null = null;

function drawCog(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const teeth = 8;
  g.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.74;
    g.lineTo(cx + Math.cos(a0 + 0.06) * rr, cy + Math.sin(a0 + 0.06) * rr);
    g.lineTo(cx + Math.cos(a1 - 0.06) * rr, cy + Math.sin(a1 - 0.06) * rr);
  }
  g.closePath();
  g.fillStyle = hex(PAD.honey);
  g.fill();
  g.lineWidth = 3.5;
  g.lineJoin = 'round';
  g.strokeStyle = hex(PAD.ink);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
  g.fillStyle = hex(PAD.tag);
  g.fill();
  g.stroke();
}

function paintManageBoard(g: CanvasRenderingContext2D, name: string): void {
  g.clearRect(0, 0, MB_PX_W, MB_PX_H);
  const bx = 6;
  const by = 16;
  const bw = MB_PX_W - 12;
  const bh = MB_BOARD_PX - by - 7;
  roundedRectPath(g, bx, by + 4, bw, bh, 24);
  g.fillStyle = 'rgba(60,35,22,0.3)';
  g.fill();
  roundedRectPath(g, bx, by, bw, bh, 24);
  const bg = g.createLinearGradient(0, by, 0, by + bh);
  bg.addColorStop(0, hex(mixHex(PAD.tag, 0xffffff, 0.45)));
  bg.addColorStop(1, hex(mixHex(PAD.tag, PAD.tagEdge, 0.35)));
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = hex(PAD.brass);
  g.stroke();
  roundedRectPath(g, bx + 8, by + 8, bw - 16, bh - 16, 17);
  g.lineWidth = 2;
  g.strokeStyle = rgba(PAD.tagEdge, 0.9);
  g.stroke();
  g.fillStyle = hex(PAD.brass);
  for (const [x, y] of [
    [bx + 17, by + 17],
    [bx + bw - 17, by + 17],
    [bx + 17, by + bh - 17],
    [bx + bw - 17, by + bh - 17],
  ] as const) {
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
  }
  // "MANAGE" with a honey cog in front, centred as one group
  g.font = `700 ${MB_FONT}px ${GAME_FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const ty = by + bh * 0.37 + 2;
  const cogR = 20;
  const gap = 12;
  const maxText = bw - 60 - cogR * 2 - gap;
  const tw = Math.min(maxText, g.measureText('MANAGE').width);
  const x0 = (MB_PX_W - (cogR * 2 + gap + tw)) / 2;
  drawCog(g, x0 + cogR, ty, cogR);
  g.fillStyle = hex(PAD.ink);
  g.fillText('MANAGE', x0 + cogR * 2 + gap, ty, maxText);
  // the building's name on a soft divider
  const dy = by + bh * 0.63;
  g.strokeStyle = rgba(PAD.tagEdge, 0.85);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(bx + 44, dy);
  g.lineTo(bx + bw - 44, dy);
  g.stroke();
  g.font = `600 ${MB_NAME_FONT}px ${GAME_FONT}`;
  g.textAlign = 'center';
  g.fillStyle = hex(mixHex(PAD.ink, PAD.honeyDeep, 0.35));
  g.fillText(name, MB_PX_W / 2, by + bh * 0.81, bw - 64);
  paintSnowCap(g, bx, by, bw);
  // the post's wood strip (sampled by the post quad), below the board rows
  const pg = g.createLinearGradient(0, 0, 24, 0);
  pg.addColorStop(0, hex(PAD.boardDark));
  pg.addColorStop(0.35, hex(PAD.boardLight));
  pg.addColorStop(0.7, hex(PAD.board));
  pg.addColorStop(1, hex(PAD.boardDark));
  g.fillStyle = pg;
  g.fillRect(0, MB_BOARD_PX + 4, 24, MB_PX_H - MB_BOARD_PX - 4);
}

function manageTexture(name: string): THREE.CanvasTexture {
  let t = manageTextures.get(name);
  if (t) return t;
  const { ctx: g, texture } = makeCanvasTexture(MB_PX_W, MB_PX_H);
  paintManageBoard(g, name);
  if (typeof document !== 'undefined' && document.fonts) {
    void document.fonts
      .load(`700 ${MB_FONT}px ${GAME_FONT}`)
      .catch(() => undefined)
      .then(() => {
        paintManageBoard(g, name);
        texture.needsUpdate = true;
      });
  }
  manageTextures.set(name, texture);
  t = texture;
  return t;
}

function manageGeometry(): THREE.BufferGeometry {
  if (manageGeo) return manageGeo;
  const k = UPRIGHT;
  const bh = MANAGE_BOARD_H;
  const vBoard = 1 - MB_BOARD_PX / MB_PX_H;
  const u = (px: number): number => px / MB_PX_W;
  const v = (py: number): number => 1 - py / MB_PX_H;
  const quad = (x0: number, x1: number, y0: number, y1: number, z: number, u0: number, u1: number, v0: number, v1: number): THREE.BufferGeometry => {
    const q = new THREE.BufferGeometry();
    q.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0 * k, z, x1, y0 * k, z, x1, y1 * k, z, x0, y1 * k, z], 3));
    q.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
    q.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    q.setIndex([0, 1, 2, 0, 2, 3]);
    return q;
  };
  const post = quad(-MB_POST_W / 2, MB_POST_W / 2, 0, MANAGE_POST_H + 0.25, -0.01, u(2), u(22), v(MB_PX_H - 2), v(MB_BOARD_PX + 7));
  const board = quad(-MANAGE_BOARD_W / 2, MANAGE_BOARD_W / 2, MANAGE_POST_H - 0.04, MANAGE_POST_H - 0.04 + bh, 0, 0, 1, vBoard, 1);
  manageGeo = mergeGeometries([post, board])!;
  post.dispose();
  board.dispose();
  return manageGeo;
}

/** A MANAGE board for the building called `name` (origin = the post's foot; see above). */
export function createManageSign(name: string): THREE.Mesh {
  // drawn over what stands in front of it: the board is a label, and turned to the camera its ends can reach into the
  // wall it stands beside
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: manageTexture(name), transparent: true, depthWrite: false, depthTest: false });
  const m = new THREE.Mesh(manageGeometry(), mat);
  // lettering floor on the "MANAGE" line (on-screen metres, as wearTagLook measures the nominal plane)
  wearTagLook(m, (MANAGE_BOARD_W * MB_FONT) / MB_PX_W, 1);
  m.renderOrder = 4;
  m.castShadow = false;
  m.receiveShadow = false;
  m.name = 'manageSign';
  return m;
}

/** Show another building's name on a MANAGE board (a rebuilt lot); no-op when unchanged. */
export function setManageSignName(sign: THREE.Mesh, name: string): void {
  const mat = sign.material as THREE.MeshBasicMaterial;
  const t = manageTexture(name);
  if (mat.map !== t) mat.map = t;
}

/** Free a MANAGE board's own material (its texture is shared by name and kept). */
export function disposeManageSign(sign: THREE.Mesh): void {
  (sign.material as THREE.Material).dispose();
}

/** The cabin doormat's floating sign: a brass-trimmed board with a honey up-arrow and "UPGRADES". */
export function createShopSign(): THREE.Mesh {
  const w = 512;
  const h = 160;
  const { ctx: g, texture } = makeCanvasTexture(w, h);
  const paint = (): void => {
    g.clearRect(0, 0, w, h);
    const b = paintBoard(g, w, h, true);
    const cy = b.y + b.h / 2 + 2;
    // up arrow
    g.save();
    g.translate(88, cy);
    g.beginPath();
    poly(g, [[0, -42], [36, -4], [15, -4], [15, 40], [-15, 40], [-15, -4], [-36, -4]]);
    g.fillStyle = hex(PAD.honey);
    g.fill();
    g.lineWidth = 7;
    g.lineJoin = 'round';
    g.strokeStyle = hex(PAD.boardDark);
    g.stroke();
    g.restore();
    g.font = `700 66px ${GAME_FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 9;
    g.strokeStyle = hex(PAD.boardDark);
    g.fillStyle = hex(PAD.tag);
    g.strokeText('UPGRADES', 146, cy + 4, w - 176);
    g.fillText('UPGRADES', 146, cy + 4, w - 176);
    texture.needsUpdate = true;
  };
  paint();
  if (typeof document !== 'undefined' && document.fonts) {
    void document.fonts
      .load(`700 66px ${GAME_FONT}`)
      .catch(() => undefined)
      .then(paint);
  }
  const m = new THREE.Mesh(geo.plane(2.6, 0.8125), basic(0xffffff, { map: texture, transparent: true, depthWrite: false }));
  wearTagLook(m, 0.8125, 66 / 160); // 0.9.8 brief 14
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


/** Gallery: a pad with its sign and hanging tag, tilted to face the gallery's isometric camera. */
function previewPad(s: PadStyle, icon: PadIcon, text: string, ratio: number, label: string, badge?: string): THREE.Object3D {
  return withPadStyle(s, () => {
    const tex = createPadTexture(icon, text, ratio, undefined, badge);
    const group = new THREE.Group();
    group.add(createPadModel(2.2, tex));
    const sign = createPadSign(label, !!badge);
    hangPriceTag(sign, tex);
    sign.scale.setScalar(0.85);
    sign.position.y = 2.0;
    sign.rotation.order = 'YXZ';
    sign.rotation.set(-THREE.MathUtils.degToRad(CAMERA.pitchDeg), THREE.MathUtils.degToRad(CAMERA.yawDeg), 0);
    group.add(sign);
    return group;
  });
}

/** Gallery: a construction pad (three rows on its tag) in look `s`. */
function previewBuild(s: PadStyle): THREE.Object3D {
  return withPadStyle(s, () => {
    const tex = createConstructionTexture('grandMarket', { left: 90, total: 120 }, { left: 0, total: 60000 }, undefined, { left: 14, total: 20, kind: 'toy' });
    const group = new THREE.Group();
    group.add(createPadModel(1.8, tex));
    const sign = createPadSign('GRAND MARKET');
    hangPriceTag(sign, tex);
    sign.scale.setScalar(0.72);
    sign.position.y = 1.7;
    sign.rotation.order = 'YXZ';
    sign.rotation.set(-THREE.MathUtils.degToRad(CAMERA.pitchDeg), THREE.MathUtils.degToRad(CAMERA.yawDeg), 0);
    group.add(sign);
    return group;
  });
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
  padBuild: () => createPadModel(1.8, createBuildTexture()),
  shopMat: () => createMatModel(2.2, 1.6),
  padSign: () => {
    // Tilted to face the gallery's isometric camera (the in-game sign copies the camera quaternion instead).
    const sign = createPadSign('MEGA SAWMILL');
    sign.rotation.order = 'YXZ';
    sign.rotation.set(-THREE.MathUtils.degToRad(CAMERA.pitchDeg), THREE.MathUtils.degToRad(CAMERA.yawDeg), 0);
    return new THREE.Group().add(sign);
  },
};

// 0.9.8: the three looks side by side (`?gallery=pads`): an unlock pad, a level pad and a construction pad each
for (const s of PAD_STYLES) {
  padCatalog[`look_${s}_unlock`] = () => previewPad(s, 'saw', '$150', 0.45, 'HARVESTER');
  padCatalog[`look_${s}_level`] = () => previewPad(s, 'megasaw', '$3200', 0.7, 'MEGA SAWMILL LV 4', 'LV 4');
  padCatalog[`look_${s}_build`] = () => previewBuild(s);
}
