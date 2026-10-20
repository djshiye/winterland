/**
 * 0.9.13 (review E10): the SURVEY KIT an empty machine slot shows, so a half-built yard reads as a place getting ready
 * instead of a bare slab with faint grid lines: four survey stakes with string pegged out round where the machine will
 * stand, a survey flag in the era's colour, a stack of crates and a bundle of the era's bars, and a few boot prints
 * from the BUILD tile to the crates.
 *
 * Everything stands inside the machine's own footprint (rules.ts MACHINE_NOMINAL), behind the BUILD tile (local −v,
 * away from the front yard), so the belt lane, the corridors and the workers' aisles stay free (eras/belts.ts,
 * npc/EraWorker.ts planPath). Local frame like a machine: origin at the slot centre, +Z (v) toward the front yard.
 *
 * Built once per era as two mirrored variants; eras/Region.ts draws every slot's kit as instances of them (two draw
 * calls per region), hidden once the machine stands.
 */
import * as THREE from 'three';
import { Batch } from '../render/batch';
import { geo } from '../render/materials';
import { MACHINE_NOMINAL } from '../eras/rules';
import { mixHex, palette, SNOW } from '../render/palette';

/** Where the crate stack stands in the slot's frame (u across, v toward the front yard) and its half size (collider). */
export const KIT_CRATES = { u: 1.75, v: -1.75, half: 0.62 } as const;

const STAKE = 0xe8763a;

export function createSurveyKit(era: number, mirror: boolean): THREE.BufferGeometry {
  const p = palette(era);
  const b = new Batch();
  const m = mirror ? -1 : 1;
  const hw = MACHINE_NOMINAL.w / 2 - 0.25;
  const hd = MACHINE_NOMINAL.d / 2 - 0.25;
  // stakes at the footprint's corners, flagging tape at their tops, string along the ground between them
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    b.add(geo.box(0.06, 0.55, 0.06), 0xc9a56a, su * hw, 0.27, sv * hd);
    b.add(geo.box(0.08, 0.1, 0.08), STAKE, su * hw, 0.5, sv * hd);
  }
  b.add(geo.box(hw * 2, 0.014, 0.045), STAKE, 0, 0.05, -hd).add(geo.box(hw * 2, 0.014, 0.045), STAKE, 0, 0.05, hd);
  b.add(geo.box(0.045, 0.014, hd * 2), STAKE, -hw, 0.05, 0).add(geo.box(0.045, 0.014, hd * 2), STAKE, hw, 0.05, 0);
  // the survey flag at the back corner opposite the crates
  const fu = -m * 1.85;
  const fv = -1.9;
  b.add(geo.cylinder(0.03, 0.04, 1.7, 6), 0xf0e4cb, fu, 0.85, fv);
  b.add(geo.box(0.02, 0.32, 0.5), p.accent, fu, 1.52, fv + 0.26);
  b.add(geo.cylinder(0.12, 0.14, 0.08, 8), 0x8a857c, fu, 0.04, fv);
  // the crate stack and a bundle of bars: timber up to the Steam Age, the era's own body colour after
  const crate = era <= 4 ? 0xb07a4a : mixHex(p.body, 0xf0e4cb, 0.25);
  const band = era <= 4 ? 0x6a4a32 : p.trim;
  const cu = m * KIT_CRATES.u;
  const cv = KIT_CRATES.v;
  const put = (u: number, v: number, y: number, s: number, ry: number): void => {
    b.add(geo.boxBase(s, s, s), crate, cu + u, y, cv + v, { ry });
    b.add(geo.box(s + 0.02, 0.06, s + 0.02), band, cu + u, y + s * 0.5, cv + v, { ry });
  };
  put(-0.22, -0.18, 0, 0.62, 0.1);
  put(0.38, 0.1, 0, 0.5, -0.25);
  put(-0.12, -0.12, 0.62, 0.46, 0.45);
  b.add(geo.box(0.5, 0.05, 0.5), SNOW, cu - 0.12, 1.1, cv - 0.12, { ry: 0.45 });
  for (let k = 0; k < 4; k++) b.add(geo.box(0.09, 0.09, 1.0), era <= 3 ? 0x8a5a3b : 0x8f969c, cu + m * (0.66 + (k & 1) * 0.11), 0.05 + (k >> 1) * 0.09, cv + 0.2);
  // boot prints from the BUILD tile's back edge to the crates (trodden snow, not ink)
  const print = mixHex(SNOW, p.ground, 0.4);
  for (let k = 0; k < 6; k++) {
    const t = (k + 0.5) / 6;
    const side = k % 2 ? 0.12 : -0.12;
    b.add(geo.circleGround(1, 8), print, m * (0.4 + t * 0.9) + side, 0.045, -1.4 - t * 0.3, { sx: 0.08, sz: 0.13, ry: m * 0.6 });
  }
  return b.geometry();
}
