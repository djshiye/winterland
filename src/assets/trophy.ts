/**
 * [0.9.7 — assets] The Winterland Complete trophy (procedural): a gold cup on a plinth with a little star on top and a
 * soft glow, placed on the Great Lodge plaza for good once a season reaches 100 % (core/completionTracker.ts).
 * 0.9.8 (brief 14): restyled as a snow-globe toy: a round wooden drum with a fat snow cap, a palette-gold cup with a
 * rounded bowl, a red prize rosette on the front, and a bevelled (soft-pointed) star. Colours come from the palette
 * module only; the glow uses additiveKeepAlpha so it never cancels the bloom behind it.
 *
 * createTrophyModel(stars): { root, spin }. Local frame: origin on the ground at the plinth's centre, about 1.6 m tall,
 * 0.9 m across (the tracker shows it at TROPHY_SCALE, a landmark you see from across the yard). `stars` (1..5) small
 * gold stars ring the plinth, one per season completed. `spin` is the star on top, which the tracker turns slowly
 * (reduced motion: still).
 */
import * as THREE from 'three';
import { additiveKeepAlpha, toon } from '../render/materials';
import { CREAM, GOLD, SNOW, mixHex, palette } from '../render/palette';

export interface TrophyModel {
  readonly root: THREE.Group;
  readonly spin: THREE.Object3D;
}

/** The cup's gold, its deeper foot, the wooden drum, its trim and the rosette (era 1's red). */
const CUP = GOLD;
const CUP_DEEP = mixHex(GOLD, palette(1).trim, 0.22);
const WOOD = palette(1).body;
const WOOD_TRIM = palette(1).fence;
const ROSETTE = palette(1).accent;
const STONE = mixHex(CREAM, palette(2).body, 0.35);

function starShape(outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

/** A soft star: a fat inner radius and a bevel round off the points (DIRECTION: no sharp spikes). */
function softStar(outer: number, depth: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(starShape(outer, outer * 0.52), {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.5,
    bevelSize: outer * 0.12,
    bevelSegments: 2,
  });
  g.center();
  return g;
}

export function createTrophyModel(stars = 1): TrophyModel {
  const root = new THREE.Group();
  root.name = 'trophy';
  const gold = toon(CUP, { emissive: mixHex(CUP, 0x000000, 0.6), emissiveIntensity: 0.35 });
  const goldDeep = toon(CUP_DEEP);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, parent: THREE.Object3D = root): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  // the plinth: a round wooden drum on a stone step, wrapped in two trim bands, with a fat overhanging snow cap
  add(new THREE.CylinderGeometry(0.47, 0.5, 0.14, 28), toon(STONE), 0.07);
  add(new THREE.CylinderGeometry(0.36, 0.38, 0.4, 28), toon(WOOD), 0.34);
  const trim = toon(WOOD_TRIM);
  for (const y of [0.2, 0.48]) {
    const band = add(new THREE.TorusGeometry(0.375, 0.022, 8, 32), trim, y);
    band.rotation.x = Math.PI / 2;
  }
  add(new THREE.CylinderGeometry(0.41, 0.4, 0.07, 28), toon(SNOW), 0.57);
  const lip = add(new THREE.TorusGeometry(0.4, 0.035, 8, 32), toon(SNOW), 0.56);
  lip.rotation.x = Math.PI / 2;
  // the prize rosette on the drum's front: a red disc with a gold button and two ribbon tails
  const rosette = toon(ROSETTE);
  const disc = add(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16), rosette, 0.36);
  disc.rotation.x = Math.PI / 2;
  disc.position.z = 0.375;
  const button = add(new THREE.SphereGeometry(0.045, 12, 8), gold, 0.36);
  button.position.z = 0.4;
  for (const side of [-1, 1]) {
    const tail = add(new THREE.BoxGeometry(0.05, 0.16, 0.015), rosette, 0.24);
    tail.position.set(side * 0.04, 0.24, 0.372);
    tail.rotation.z = side * 0.25;
  }
  // the cup: foot, stem, a rounded bowl (a lathe) with a rolled rim, two handles
  add(new THREE.CylinderGeometry(0.17, 0.22, 0.08, 24), goldDeep, 0.64);
  add(new THREE.CylinderGeometry(0.05, 0.08, 0.2, 14), gold, 0.78);
  const bowl = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.1, 0.0),
    new THREE.Vector2(0.19, 0.06),
    new THREE.Vector2(0.25, 0.17),
    new THREE.Vector2(0.27, 0.29),
    new THREE.Vector2(0.27, 0.36),
  ];
  add(new THREE.LatheGeometry(bowl, 28), gold, 0.87);
  const rim = add(new THREE.TorusGeometry(0.27, 0.025, 8, 32), gold, 1.23);
  rim.rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) {
    const h = add(new THREE.TorusGeometry(0.1, 0.028, 8, 16, Math.PI * 1.2), gold, 1.06);
    h.position.x = side * 0.28;
    h.rotation.z = side > 0 ? -Math.PI * 0.6 : Math.PI * 1.6;
  }
  // a spinning soft star above the bowl
  const spin = add(softStar(0.13, 0.03), gold, 1.5);
  // small stars on the drum, one per season completed (up to 5), above the rosette
  const small = softStar(0.05, 0.012);
  const n = Math.max(1, Math.min(5, Math.floor(stars)));
  for (let i = 0; i < n; i++) {
    const a = ((i - (n - 1) / 2) * 0.36);
    const m = add(small, gold, 0.5);
    m.position.set(Math.sin(a) * 0.38, 0.5 - Math.abs(i - (n - 1) / 2) * 0.012, Math.cos(a) * 0.38);
    m.rotation.y = a;
  }
  // a soft gold glow on the snow around the plinth (no light: one additive disc), so it reads from across the yard
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 32),
    additiveKeepAlpha(new THREE.MeshBasicMaterial({ color: mixHex(CUP, CREAM, 0.3), transparent: true, opacity: 0.28, depthWrite: false })),
  );
  glow.name = 'trophy-glow';
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.015;
  glow.renderOrder = 1;
  root.add(glow);
  return { root, spin };
}
