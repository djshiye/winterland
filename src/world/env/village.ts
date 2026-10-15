/**
 * Village scenery: packed-snow street + lot squares, picket fence (with the town gap in its east side), and the
 * era-driven street dressing (wave 9, env/eras.ts): torches → lanterns → iron lamps, the street surface (snow track →
 * gravel → cobbles), bunting from Town and festive string lights + wreaths from Winter City. Every variant is built
 * once; `registerEra` only flips visibility.
 */
import * as THREE from 'three';
import { LAYOUT } from '../../config';
import { palisadeMaterial, palisadePostGeometry } from '../../assets/scenery';
import { toon } from '../../render/materials';
import { Batch, instanced, type EnvPart, type Placement } from './common';
import { addSparkleSpot, registerEra } from './eras';
import { addBunting, addLightString, addWreath } from './festive';
import { bulbMaterial } from './glow';
import { cobbleTexture, gravelTexture } from './groundTex';
import { buildLampVariants, LAMP_TOP, type LampSpot } from './lamps';

const V = LAYOUT.village;

/** The village street lamps: two rows along the street. The east lamp at the town corridor mouth is left out. */
export const VILLAGE_LAMP_Z = [15.2, 18.8, 22.4, 26.0] as const;
export function villageLamps(): LampSpot[] {
  const street = V.street;
  const spots: LampSpot[] = [];
  for (const z of VILLAGE_LAMP_Z) {
    spots.push({ x: street.minX + 0.05, z });
    if (z < LAYOUT.town.gate.minZ - 0.8) spots.push({ x: street.maxX - 0.05, z });
  }
  return spots;
}

/** Street + lot ground, a low picket fence on the east and south sides, and the era-dressed street lamps. */
export function buildVillageScenery(): EnvPart {
  const group = new THREE.Group();
  group.name = 'villageScenery';

  // ---- ground ---------------------------------------------------------------
  const g = new Batch();
  const street = V.street;
  const sw = street.maxX - street.minX;
  const sd = street.maxZ - street.minZ;
  const slab = (w: number, d: number, x: number, z: number, y: number, color: number, t = 0.03): void => {
    g.add(new THREE.BoxGeometry(w, t, d), color, x, y - t / 2 + 0.02, z);
  };
  slab(sw, sd, (street.minX + street.maxX) / 2, (street.minZ + street.maxZ) / 2, 0.012, 0xd3deea);
  // wheel / foot lines down the middle lane
  for (const dx of [-0.35, 0.35]) slab(0.18, sd - 0.6, (street.minX + street.maxX) / 2 + dx, (street.minZ + street.maxZ) / 2, 0.026, 0xbccadb, 0.01);
  // lot squares (slightly trampled snow)
  for (const p of V.plots) slab(V.plotSize, V.plotSize, p.x, p.z, 0.016, 0xdfe8f2);
  // forecourt of the Great Lodge
  const gl = V.greatLodge;
  slab(gl.w + 0.8, gl.d + 0.8, gl.x, gl.z, 0.016, 0xdfe8f2);
  slab(sw + 1.2, 1.4, gl.x, street.maxZ + 0.1, 0.014, 0xd3deea);
  group.add(g.mesh({ cast: false, receive: true }));

  // ---- street surfaces by era (gravel, cobbles) over the snow track ---------------------------
  const cx = (street.minX + street.maxX) / 2;
  const cz = (street.minZ + street.maxZ) / 2;
  const surfaces: Record<'gravel' | 'cobble', THREE.Mesh> = {
    gravel: new THREE.Mesh(new THREE.PlaneGeometry(sw, sd).rotateX(-Math.PI / 2), toon(0xffffff, { map: gravelTexture(sw, sd) })),
    cobble: new THREE.Mesh(
      new THREE.PlaneGeometry(sw, sd).rotateX(-Math.PI / 2),
      toon(0xffffff, { map: cobbleTexture(sw, sd, { seed: 3, kerb: 0.2, snow: 0.4 }) }),
    ),
  };
  for (const [k, m] of Object.entries(surfaces)) {
    m.name = `era:surface:${k}`;
    m.position.set(cx, 0.05, cz);
    m.castShadow = false;
    m.receiveShadow = true;
    m.visible = false;
    group.add(m);
  }

  // ---- picket fence (east + south sides; the west side is the customer-path fence) ---------
  const A = V.area;
  const pickets: Placement[] = [];
  const spacing = 0.22;
  const east = A.maxX + 0.3;
  const south = A.maxZ + 0.45;
  const tg = LAYOUT.town.gate;
  for (let z = A.minZ; z <= south; z += spacing) {
    if (z > tg.minZ - 0.05 && z < tg.maxZ + 0.05) continue; // the Market Town gap (env/town.ts hangs the gate in it)
    pickets.push({ x: east, z, sx: 0.8, sy: 0.5, sz: 0.8 });
  }
  for (const z of [tg.minZ - 0.1, tg.maxZ + 0.1]) pickets.push({ x: east, z, sx: 1.25, sy: 0.95, sz: 1.25 }); // gate posts
  for (let x = A.minX + 0.2; x <= east; x += spacing) pickets.push({ x, z: south, sx: 0.8, sy: 0.5, sz: 0.8 });
  group.add(instanced(palisadePostGeometry(), palisadeMaterial(), pickets, { cast: false }));

  // ---- lamps (3 generations), bunting, festive lights --------------------------------------
  const spots = villageLamps();
  const lamps = buildLampVariants(spots);
  group.add(lamps.group);

  const bunting = new Batch();
  const lights = new Batch();
  const wreaths = new Batch();
  const west = spots.filter((s) => s.x < cx);
  const eastRow = spots.filter((s) => s.x > cx);
  const top = LAMP_TOP.iron - 0.12;
  const at = (s: LampSpot, y = top): { x: number; y: number; z: number } => ({ x: s.x, y, z: s.z });
  // across the street between the pairs
  for (const w of west) {
    const e = eastRow.find((s) => s.z === w.z);
    if (e) addBunting(bunting, at(w), at(e), 0.5, Math.round(w.z));
  }
  // along each side
  for (const row of [west, eastRow]) {
    for (let i = 0; i + 1 < row.length; i++) addBunting(bunting, at(row[i]!, top - 0.1), at(row[i + 1]!, top - 0.1), 0.38, i * 2 + 1);
  }
  // festive: warm strings along the sides, a coloured string between the lamp pairs, wreaths on the posts
  for (const row of [west, eastRow]) {
    for (let i = 0; i + 1 < row.length; i++) addLightString(lights, at(row[i]!, top - 0.45), at(row[i + 1]!, top - 0.45), 0.45, i);
  }
  for (let i = 0; i + 1 < VILLAGE_LAMP_Z.length; i++) {
    const z = (VILLAGE_LAMP_Z[i]! + VILLAGE_LAMP_Z[i + 1]!) / 2;
    addLightString(lights, { x: street.minX + 0.05, y: top - 0.2, z }, { x: street.maxX - 0.05, y: top - 0.2, z }, 0.55, i * 3);
  }
  for (const s of spots) addWreath(wreaths, s.x + (s.x < cx ? 0.0 : -0.3), 1.55, s.z, 0.9);

  const buntingMesh = bunting.mesh({ cast: false });
  const festive = new THREE.Group();
  festive.add(lights.mesh({ cast: false, receive: false, material: bulbMaterial() }), wreaths.mesh({ cast: false }));
  buntingMesh.name = 'era:bunting';
  festive.name = 'era:festive';
  buntingMesh.visible = false;
  festive.visible = false;
  group.add(buntingMesh, festive);

  for (const s of spots) addSparkleSpot(s.x, 3, s.z);
  registerEra((look) => {
    lamps.show(look.lamp);
    surfaces.gravel.visible = look.surface === 'gravel';
    surfaces.cobble.visible = look.surface === 'cobble';
    buntingMesh.visible = look.bunting;
    festive.visible = look.festive;
  });
  return { group };
}
