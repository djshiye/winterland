/**
 * [items builder] 0.9.5: item shapes of the new era 5–7 materials (eras/data.ts MATERIALS: girder, snowplow, quartz
 * uses the shared crystal, bulb, radio, gas, fuel, snowmobile). Same contract as assets/eraItems.ts: each builder
 * works in the item's own box (width X, height Y, depth Z, front +Z, y0 = the floor) from the material's colour and
 * accent; eraItems.ts merges, centres and fits the result, so one item is ONE draw call.
 *
 * Toy-diorama style: chunky, rounded proportions, warm metals, one friendly highlight per item.
 */
import * as THREE from 'three';
import type { MaterialDef } from '../eras/data';
import type { Batch } from '../render/batch';

type Builder = (b: Batch, m: MaterialDef) => void;

const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
const cyl = (rTop: number, rBottom: number, h: number, seg = 12): THREE.BufferGeometry => new THREE.CylinderGeometry(rTop, rBottom, h, seg);
const ball = (r: number, w = 10, h = 8): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h);

const _c = new THREE.Color();
/** `c` toward black (k < 1) or toward white (k > 1). */
function shade(c: number, k: number): THREE.Color {
  _c.set(c);
  if (k <= 1) return new THREE.Color().copy(_c).multiplyScalar(k);
  return new THREE.Color().copy(_c).lerp(new THREE.Color(0xffffff), Math.min(1, k - 1));
}

/** Era 5 girder: a short riveted I-beam lying along X, with a painted orange end cap. */
const buildGirder: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const fl = h * 0.22;
  b.add(box(w, fl, d), m.color, 0, y0 + fl / 2, 0);
  b.add(box(w, fl, d), shade(m.color, 1.15), 0, y0 + h - fl / 2, 0);
  b.add(box(w - 0.01, h - 2 * fl + 0.01, d * 0.2), shade(m.color, 0.85), 0, 0, 0);
  // rivet rows along both top flange edges
  for (let i = 0; i < 6; i++) {
    const x = -w / 2 + w * (0.09 + i * 0.164);
    for (const s of [-1, 1]) b.add(cyl(0.013, 0.013, 0.012, 6), shade(m.color, 1.45), x, y0 + h + 0.004, s * d * 0.32);
  }
  // safety-orange end caps
  for (const s of [-1, 1]) b.add(box(0.014, h, d + 0.004), m.accent, s * (w / 2 - 0.006), 0, 0);
};

/** Era 5 snowplow: a little toy plow truck with a big curved orange blade in front. */
const buildPlow: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const wheelR = h * 0.17;
  // chassis + cab
  b.add(box(w * 0.62, h * 0.24, d * 0.62), m.color, 0, y0 + wheelR + h * 0.12, -d * 0.08);
  b.add(box(w * 0.42, h * 0.34, d * 0.34), shade(m.color, 1.12), 0, y0 + wheelR + h * 0.24 + h * 0.17, -d * 0.18);
  b.add(box(w * 0.36, h * 0.16, 0.012), 0xbfe3f2, 0, y0 + wheelR + h * 0.47, -d * 0.01);
  // beacon on the roof
  b.add(cyl(0.035, 0.04, h * 0.08, 8), 0xffc23d, 0, y0 + wheelR + h * 0.62, -d * 0.18);
  // wheels
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(cyl(wheelR, wheelR, w * 0.12, 12), 0x2d3033, sx * w * 0.3, y0 + wheelR, sz * d * 0.22 - d * 0.08, { rz: Math.PI / 2 });
      b.add(cyl(wheelR * 0.45, wheelR * 0.45, w * 0.125, 8), shade(m.accent, 1.1), sx * w * 0.3, y0 + wheelR, sz * d * 0.22 - d * 0.08, { rz: Math.PI / 2 });
    }
  }
  // the blade: three tilted strips make a curved mouldboard
  for (let i = 0; i < 3; i++) {
    b.add(box(w, h * 0.13, 0.035), shade(m.accent, 1 - i * 0.08), 0, y0 + h * (0.08 + i * 0.12), d * (0.44 - i * 0.02), { rx: -0.25 + i * 0.25 });
  }
  b.add(box(w * 1.0, h * 0.04, 0.04), shade(m.color, 0.6), 0, y0 + h * 0.03, d * 0.46);
  b.add(box(w * 0.12, h * 0.08, d * 0.2), shade(m.color, 0.7), 0, y0 + wheelR + h * 0.06, d * 0.3);
};

/** Era 6 light bulb in a little cardboard sleeve: a warm glass globe, a brass screw base. */
const buildBulb: Builder = (b, m) => {
  const { w, h } = m.size;
  const y0 = -h / 2;
  const R = w * 0.42;
  // sleeve
  b.add(box(w * 0.9, h * 0.28, w * 0.9), shade(m.accent, 1.0), 0, y0 + h * 0.14, 0);
  b.add(box(w * 0.92, h * 0.05, w * 0.92), shade(m.accent, 1.25), 0, y0 + h * 0.27, 0);
  // screw base rising out of the sleeve
  for (let i = 0; i < 3; i++) b.add(cyl(R * 0.48, R * 0.48, h * 0.05, 10), shade(0xc9a14a, 1 - (i % 2) * 0.15), 0, y0 + h * (0.31 + i * 0.05), 0);
  b.add(cyl(R * 0.62, R * 0.5, h * 0.08, 12), shade(m.color, 0.95), 0, y0 + h * 0.48, 0);
  // globe + a soft highlight
  b.add(ball(R, 14, 10), m.color, 0, y0 + h * 0.48 + R * 0.95, 0);
  b.add(ball(R * 0.22, 8, 6), shade(m.color, 1.6), -R * 0.4, y0 + h * 0.48 + R * 1.3, R * 0.55);
  // filament glint
  b.add(box(R * 0.5, 0.02, 0.02), 0xffb347, 0, y0 + h * 0.48 + R * 0.9, 0);
};

/** Era 6 radio: a wooden cabinet with a cream cloth grille, two knobs and an arched top. */
const buildRadio: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const bodyH = h * 0.72;
  b.add(box(w, bodyH, d), m.color, 0, y0 + bodyH / 2, 0);
  // arched top
  b.add(cyl(w / 2, w / 2, d, 16, ), shade(m.color, 1.08), 0, y0 + bodyH, 0, { rx: Math.PI / 2, sy: 1, sz: (h - bodyH) / (w / 2) });
  // grille panel + slats
  b.add(box(w * 0.66, bodyH * 0.5, 0.014), m.accent, 0, y0 + bodyH * 0.62, d / 2 + 0.004);
  for (let i = 0; i < 4; i++) b.add(box(w * 0.6, 0.012, 0.01), shade(m.color, 0.8), 0, y0 + bodyH * (0.44 + i * 0.1), d / 2 + 0.012);
  // dial + knobs
  b.add(box(w * 0.4, bodyH * 0.12, 0.012), 0xffe2a0, -w * 0.06, y0 + bodyH * 0.24, d / 2 + 0.006);
  for (const s of [-1, 1]) b.add(cyl(0.032, 0.032, 0.03, 10), shade(m.color, 0.55), s * w * 0.34, y0 + bodyH * 0.22, d / 2 + 0.015, { rx: Math.PI / 2 });
  // feet
  for (const s of [-1, 1]) b.add(box(w * 0.14, 0.02, d * 0.8), shade(m.color, 0.6), s * w * 0.36, y0 + 0.01, 0);
};

/** Era 7 gas: a rounded gas cylinder with a white shoulder band, a valve and a little guard ring. */
const buildCanister: Builder = (b, m) => {
  const { w, h } = m.size;
  const y0 = -h / 2;
  const R = w / 2;
  b.add(cyl(R, R, h * 0.66, 16), m.color, 0, y0 + h * 0.33, 0);
  b.add(ball(R, 16, 8), m.color, 0, y0 + h * 0.66, 0, { sy: 0.45 });
  b.add(cyl(R * 1.01, R * 1.01, h * 0.1, 16), m.accent, 0, y0 + h * 0.56, 0);
  b.add(cyl(R * 0.9, R * 1.0, h * 0.05, 16), shade(m.color, 0.7), 0, y0 + h * 0.025, 0);
  // valve + guard
  b.add(cyl(R * 0.16, R * 0.2, h * 0.14, 8), 0xc9a14a, 0, y0 + h * 0.66 + R * 0.45 + h * 0.05, 0);
  b.add(cyl(R * 0.5, R * 0.5, h * 0.05, 12, ), shade(m.color, 0.85), 0, y0 + h * 0.93, 0);
  b.add(cyl(R * 0.36, R * 0.36, h * 0.06, 12), shade(m.color, 1.3), 0, y0 + h * 0.93, 0);
};

/** Era 7 fuel: a chunky jerrycan with an X-pressed side, a three-bar handle and a spout cap. */
const buildJerrycan: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const bodyH = h * 0.82;
  b.add(box(w, bodyH, d), m.color, 0, y0 + bodyH / 2, 0);
  // pressed X on both sides
  for (const s of [-1, 1]) {
    b.add(box(0.012, bodyH * 0.9, w * 0.08), shade(m.color, 0.82), 0, y0 + bodyH / 2, s * (d / 2 + 0.004), { rz: 0.55 });
    b.add(box(0.012, bodyH * 0.9, w * 0.08), shade(m.color, 0.82), 0, y0 + bodyH / 2, s * (d / 2 + 0.004), { rz: -0.55 });
  }
  // handle bars
  for (const x of [-0.22, 0, 0.22]) b.add(box(0.03, h - bodyH, d * 0.18), shade(m.color, 0.7), x * w, y0 + bodyH + (h - bodyH) / 2, 0);
  b.add(box(w * 0.56, 0.03, d * 0.2), shade(m.color, 0.7), 0, y0 + h - 0.015, 0);
  // spout cap
  b.add(cyl(0.04, 0.045, h * 0.12, 10), m.accent, w * 0.38, y0 + bodyH + h * 0.04, 0);
  // white label
  b.add(box(w * 0.4, bodyH * 0.24, 0.006), 0xf4efe4, -w * 0.08, y0 + bodyH * 0.6, d / 2 + 0.008);
};

/** Era 7 snowmobile: a sleek toy sled body on two skis and a rubber track, with a windscreen and a seat. */
const buildSnowmobile: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  // skis in front (along Z = forward)
  for (const s of [-1, 1]) {
    b.add(box(0.035, 0.02, d * 0.5), shade(m.accent, 0.5), s * w * 0.32, y0 + 0.01, d * 0.22);
    b.add(box(0.035, 0.03, 0.05), shade(m.accent, 0.5), s * w * 0.32, y0 + 0.03, d * 0.46, { rx: -0.6 });
    b.add(box(0.02, h * 0.2, 0.02), shade(m.accent, 0.6), s * w * 0.32, y0 + h * 0.12, d * 0.24);
  }
  // track at the back
  b.add(box(w * 0.5, h * 0.18, d * 0.48), 0x2d3033, 0, y0 + h * 0.09, -d * 0.22);
  for (let i = 0; i < 4; i++) b.add(box(w * 0.52, 0.012, 0.025), 0x45494d, 0, y0 + 0.006, -d * (0.04 + i * 0.12));
  // hood + body
  b.add(box(w * 0.7, h * 0.26, d * 0.62), m.color, 0, y0 + h * 0.3, -d * 0.04);
  b.add(box(w * 0.6, h * 0.2, d * 0.3), shade(m.color, 1.12), 0, y0 + h * 0.42, d * 0.16, { rx: 0.35 });
  b.add(box(w * 0.72, h * 0.06, d * 0.64), m.accent, 0, y0 + h * 0.2, -d * 0.04);
  // windscreen, handlebars, seat
  b.add(box(w * 0.5, h * 0.22, 0.015), 0xbfe3f2, 0, y0 + h * 0.62, d * 0.04, { rx: -0.4 });
  b.add(box(w * 0.6, 0.02, 0.02), 0x2d3033, 0, y0 + h * 0.58, -d * 0.04);
  b.add(box(w * 0.4, h * 0.12, d * 0.34), 0x2d3033, 0, y0 + h * 0.5, -d * 0.24);
  // headlight
  b.add(cyl(0.035, 0.035, 0.02, 10), 0xffe9a8, 0, y0 + h * 0.38, d * 0.3, { rx: Math.PI / 2 });
};

/** Builders for the new era 5–7 shapes (eras/data.ts MaterialShape). */
/**
 * 0.9.6 era 5 pig iron (ARGON spec docs/art/05-pig-iron.md): a sand-cast "sow and pigs" bar: a rusty sand-crust
 * base, three sooty knuckles with flat tops (stacking plane) split by two ember-orange V-notches, and a snapped
 * pour-spout runner front to back.
 */
const buildPigBar: Builder = (b, m) => {
  const { w, h, d } = m.size;
  const y0 = -h / 2;
  const crust = 0x7a4b3a;
  const slag = 0x2d2830;
  const ember = m.accent;
  // sand-cast base, a little narrower than the knuckles
  b.add(box(w * 0.955, h * 0.5, d * 0.91), crust, 0, y0 + h * 0.25, 0);
  // three knuckles, the outer two a touch wider, tops co-planar at h
  const kw = [w * 0.295, w * 0.273, w * 0.295];
  const kx = [-w * 0.33, 0, w * 0.33];
  for (let i = 0; i < 3; i++) {
    b.add(box(kw[i]!, h * 0.5, d), m.color, kx[i]!, y0 + h * 0.75, 0);
    // darker chamfer band low on each knuckle
    b.add(box(kw[i]! * 1.01, h * 0.1, d * 1.01), slag, kx[i]!, y0 + h * 0.52, 0);
  }
  // ember-orange V-notches between the knuckles (glow in the groove, gold fleck on top)
  for (const s of [-1, 1]) {
    b.add(box(w * 0.04, h * 0.44, d * 1.02), ember, s * w * 0.164, y0 + h * 0.72, 0);
    b.add(box(w * 0.022, h * 0.06, d * 1.03), 0xf3a833, s * w * 0.164, y0 + h * 0.97, 0);
  }
  // pour-spout runner, hexagonal, poking out front and back with glowing snapped ends
  b.add(cyl(h * 0.22, h * 0.22, d * 1.09, 6), slag, 0, y0 + h * 0.44, 0, { rx: Math.PI / 2 });
  for (const s of [-1, 1]) b.add(cyl(h * 0.16, h * 0.16, 0.012, 6), ember, 0, y0 + h * 0.44, s * d * 0.55, { rx: Math.PI / 2 });
};

export const ERA5_7_ITEM_BUILDERS = {
  girder: buildGirder,
  plow: buildPlow,
  bulb: buildBulb,
  radio: buildRadio,
  canister: buildCanister,
  jerrycan: buildJerrycan,
  snowmobile: buildSnowmobile,
  pigbar: buildPigBar,
} as const satisfies Record<string, Builder>;
export type Era5to7Shape = keyof typeof ERA5_7_ITEM_BUILDERS;
