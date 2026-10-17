/**
 * [0.9.7 — assets] The Winterland Complete trophy (procedural): a snowy stone plinth with a gold cup, a little star on
 * top and a soft glow, placed on the Great Lodge plaza for good once a season reaches 100 % (core/completionTracker.ts).
 *
 * createTrophyModel(stars): { root, spin }. Local frame: origin on the ground at the plinth's centre, about 1.6 m tall,
 * 0.9 m square (the tracker shows it at TROPHY_SCALE, a landmark you see from across the yard). `stars` (1..5) small gold stars ring the plinth, one per season completed. `spin` is the star on top,
 * which the tracker turns slowly (reduced motion: still).
 */
import * as THREE from 'three';
import { COLORS } from '../config';
import { toon } from '../render/materials';

export interface TrophyModel {
  readonly root: THREE.Group;
  readonly spin: THREE.Object3D;
}

const GOLD = 0xffcc33;
const GOLD_DEEP = 0xe0a020;
const STONE = 0xb9b2c8;
const SNOW = COLORS.SNOW_WHITE;

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

export function createTrophyModel(stars = 1): TrophyModel {
  const root = new THREE.Group();
  root.name = 'trophy';
  const gold = toon(GOLD, { emissive: 0x6a4a00, emissiveIntensity: 0.35 });
  const goldDeep = toon(GOLD_DEEP);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, parent: THREE.Object3D = root): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  // plinth: two stone steps with a snow cap
  add(new THREE.BoxGeometry(0.9, 0.18, 0.9), toon(STONE), 0.09);
  add(new THREE.BoxGeometry(0.66, 0.34, 0.66), toon(STONE), 0.35);
  add(new THREE.BoxGeometry(0.72, 0.06, 0.72), toon(SNOW), 0.55);
  // the cup: base, stem, bowl (a lathe), two handles
  add(new THREE.CylinderGeometry(0.2, 0.24, 0.08, 20), goldDeep, 0.62);
  add(new THREE.CylinderGeometry(0.05, 0.08, 0.22, 12), gold, 0.77);
  const bowl = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.09, 0.0),
    new THREE.Vector2(0.17, 0.05),
    new THREE.Vector2(0.24, 0.16),
    new THREE.Vector2(0.27, 0.3),
    new THREE.Vector2(0.28, 0.38),
    new THREE.Vector2(0.25, 0.38),
  ];
  add(new THREE.LatheGeometry(bowl, 24), gold, 0.87);
  for (const side of [-1, 1]) {
    const h = add(new THREE.TorusGeometry(0.1, 0.022, 8, 16, Math.PI * 1.2), gold, 1.06);
    h.position.x = side * 0.28;
    h.rotation.z = side > 0 ? -Math.PI * 0.6 : Math.PI * 1.6;
  }
  // a spinning star above the bowl
  const starGeo = new THREE.ExtrudeGeometry(starShape(0.13, 0.055), { depth: 0.04, bevelEnabled: false });
  starGeo.center();
  const spin = add(starGeo, gold, 1.5);
  // small stars around the plinth, one per season completed (up to 5)
  const small = new THREE.ExtrudeGeometry(starShape(0.06, 0.026), { depth: 0.02, bevelEnabled: false });
  small.center();
  const n = Math.max(1, Math.min(5, Math.floor(stars)));
  for (let i = 0; i < n; i++) {
    const m = add(small, gold, 0.35);
    const x = (i - (n - 1) / 2) * 0.13;
    m.position.set(x, 0.35, 0.335);
  }
  // a soft gold glow on the snow around the plinth (no light: one additive disc), so it reads from across the yard
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  glow.name = 'trophy-glow';
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.015;
  glow.renderOrder = 1;
  root.add(glow);
  return { root, spin };
}
