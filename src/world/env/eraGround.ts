/**
 * [0.9.8 — world threads 10a / 10b / 10c] The hook every era's base board plugs into, so the world threads never
 * have to edit frontier.ts, plots.ts or frontierProps.ts for their eras: one line in MODULES per era file.
 *
 * An era module (world/env/ground/eraNN.ts) may give any of:
 * - `wild(k, l, rng)`: what stands on the region from the start, also while it is for sale under the snow wash: the
 *   tree belt, boulders, the field's wild dressing. With `wild`, frontier.ts skips its random decals and era props.
 * - `open(k, l, P, rng)`: what appears once the region is bought: zone floors (the yard band and the processing floor
 *   under the machine grid), paths, kerbs, lanterns. With `open`, frontier.ts skips its zone tints and paths and
 *   plots.ts skips its plain yard paving and cell lines (the module marks the cells itself).
 * - `keepOut(l)`: world rects frontier.ts's random props never land on (a landmark the module builds itself).
 * - `props`: tall / mid / low prop geometries that replace frontierProps.ts's 0.9.0 ones for the era.
 *
 * The board (the ground tile under the whole plot) is palette(n).floor.board, which frontier.ts animates from the
 * snow wash to on unlock. Everything a module adds goes through a GroundKit: one floor batch (flat, receives shadows,
 * casts none), one solid batch (casts), one glow batch (lantern panes: glowMaterial, blooms and brightens at night),
 * halo spots (night halos and warm pools, world/env/glow.ts) and instanced kinds (trees, rocks). So a region costs a
 * handful of draw calls whatever the module draws: floor 1, solids 1 (+1 shadow), glow 1, halos 1 at night, one per
 * instanced kind (+1 shadow each when it casts).
 */
import * as THREE from 'three';
import type { Rect } from '../../config';
import type { PlotPlaces, RegionLayout } from '../../eras/layout';
import { Batch, vcMat } from '../../render/batch';
import { glowMaterial } from '../../render/paletteMaterials';
import { buildHalos, type HaloSpot } from './glow';
import { instanced, type Placement, Rng } from './common';
import type { PropRole } from '../../assets/frontierProps';
import { era01Dress } from './ground/era01';
import { era02 } from './ground/era02';
import { era03 } from './ground/era03';
import { era08 } from './ground/era08';
import { era09 } from './ground/era09';
import { era10 } from './ground/era10';

/** Everything an era module builds into. Read-only for modules except through its batches and lists. */
export class GroundKit {
  /** Flat ground pieces: receive shadows, cast none (zone floors, paths, decals, snow drifts). */
  readonly floor = new Batch();
  /** Small solids that cast shadows (kerbs, rails, lantern posts, boulders, stumps). */
  readonly solid = new Batch();
  /** Lantern panes, windows, embers: vertex-coloured glowMaterial (blooms; brightens at night). */
  readonly glow = new Batch();
  /** Night halo + ground pool per lamp (world/env/glow.ts buildHalos). */
  readonly lamps: HaloSpot[] = [];
  /** Objects a module builds itself (an animated arc, a flame), added as they are. They animate in onBeforeRender, so the kit needs no update hook. */
  readonly extra: THREE.Object3D[] = [];
  private readonly kinds = new Map<string, { geometry: () => THREE.BufferGeometry; cast: boolean; items: Placement[] }>();

  /** Place one instance of a shared geometry (one draw call per kind, whatever the count). */
  put(kind: string, geometry: () => THREE.BufferGeometry, p: Placement, cast = true): void {
    let k = this.kinds.get(kind);
    if (!k) {
      k = { geometry, cast, items: [] };
      this.kinds.set(kind, k);
    }
    k.items.push(p);
  }

  /** Bake into one group (the kit is consumed). */
  build(name: string): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    if (!this.floor.empty) {
      const m = this.floor.mesh({ cast: false, receive: true });
      m.name = `${name}:floor`;
      g.add(m);
    }
    if (!this.solid.empty) {
      const m = this.solid.mesh({ cast: true, receive: true });
      m.name = `${name}:solid`;
      g.add(m);
    }
    if (!this.glow.empty) {
      const m = this.glow.mesh({ cast: false, receive: false, material: glowMaterial(0xffffff, { vertexColors: true }) });
      m.name = `${name}:glow`;
      g.add(m);
    }
    for (const [kind, k] of this.kinds) {
      const m = instanced(k.geometry(), vcMat(), k.items, { cast: k.cast, receive: true });
      m.name = `${name}:${kind}`;
      g.add(m);
    }
    for (const o of this.extra) g.add(o);
    if (this.lamps.length) g.add(buildHalos(this.lamps, { size: 1.8, pool: 4.6 }));
    return g;
  }
}

export interface EraGroundModule {
  wild?(k: GroundKit, l: RegionLayout, rng: Rng): void;
  open?(k: GroundKit, l: RegionLayout, P: PlotPlaces, rng: Rng): void;
  keepOut?(l: RegionLayout): Rect[];
  props?: Partial<Record<PropRole, () => THREE.BufferGeometry>>;
}

/** One entry per era that has its own base board (eras 2..10; era 1's old map is dressed by `eraOneDress`). */
const MODULES: Record<number, EraGroundModule> = {
  2: era02,
  3: era03,
  8: era08,
  9: era09,
  10: era10,
};

/** Era n's module, if it has one. */
export function eraGround(n: number): EraGroundModule | null {
  return MODULES[n] ?? null;
}

/** World rects era n's random props avoid (none without a module). */
export function eraKeepOut(n: number, l: RegionLayout): Rect[] {
  return MODULES[n]?.keepOut?.(l) ?? [];
}

/** An era's replacement prop geometry for a role, if its module has one (frontierProps.ts eraPropGeometry). */
export function eraPropOverride(n: number, role: PropRole): (() => THREE.BufferGeometry) | null {
  return MODULES[n]?.props?.[role] ?? null;
}

/** Build era n's wild dressing (shown from the start), or null when its module has none. */
export function buildEraWild(n: number, l: RegionLayout): THREE.Group | null {
  const m = MODULES[n];
  if (!m?.wild) return null;
  const k = new GroundKit();
  m.wild(k, l, new Rng(7300 + n * 53));
  return k.build(`region${n}:wild`);
}

/** Build era n's bought-region ground (zone floors, paths, lanterns), or null when its module has none. */
export function buildEraOpen(n: number, l: RegionLayout, P: PlotPlaces): THREE.Group | null {
  const m = MODULES[n];
  if (!m?.open) return null;
  const k = new GroundKit();
  m.open(k, l, P, new Rng(7700 + n * 61));
  return k.build(`region${n}:ground`);
}

/** True when era n's module draws its own processing floor (plots.ts then skips its plain paving and cell lines). */
export function eraOwnsFloor(n: number): boolean {
  return !!MODULES[n]?.open;
}

/** Era 1 (the old map): the yard's packed earth, plank walkways, stumps (world/env/ground.ts calls it). */
export function eraOneDress(): THREE.Group {
  const k = new GroundKit();
  era01Dress(k, new Rng(7101));
  return k.build('era1:ground');
}
