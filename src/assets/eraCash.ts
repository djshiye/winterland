/**
 * 0.9.7 AssetFactory: an era's own cash machine model for the region market (eras/CashMachine.ts). Each era has its
 * recipe in the era machine files (config eraCashMachine(n): strongbox, mintChute, pneumaticTubes in eraMachines2.ts;
 * bankVault, tillLine, driveThruVault in eraMachines3.ts; atmNetwork, atomicVault, quantumBank in eraMachines4.ts).
 * Those are yard-sized machines, so this factory scales the model down uniformly until it fits the market's vault spot
 * (eras/market.ts `vault`): a footprint within CASH_FIT.w × CASH_FIT.d and at most CASH_FIT.h tall, so it never hides
 * the level pad 2.6 m east of the cash pile. The model is recentred on its footprint (origin = floor centre).
 *
 * `mouth` (local) is the point the bundles fly into, near the top of the model. `animate(dt, working)` is the machine's
 * own animation; the cash machine runs it with working = true while a bundle is being banked.
 * Eras without a model (or an unknown id) fall back to the generic safe (assets/cashMachine.ts).
 */
import * as THREE from 'three';
import { eraCashMachine } from '../config';
import { ERAS } from '../eras/data';
import { CASH_MACHINE_SIZE, createCashMachineModel } from './cashMachine';
import type { MachineModel } from './eraMachines';
import { ERA_MACHINE_2_IDS, createEraMachine2Model, type EraMachine2Id } from './eraMachines2';
import { ERA5_7_MACHINE_IDS, createEra5to7MachineModel, type Era5to7MachineId } from './eraMachines3';
import { ERA4_MACHINE_IDS, createEraMachine4, type Era4MachineId } from './eraMachines4';

export interface EraCashModel {
  root: THREE.Group;
  /** Footprint (metres, centred on the origin) for the collider, and height. */
  w: number;
  d: number;
  h: number;
  /** Local point the bundles fly into (the model's top). */
  mouth: THREE.Vector3;
  /** Advance its animation; `working` while a bundle is banked. */
  animate(dt: number, working: boolean): void;
  /** The era recipe it was built from ('safe' = the generic fallback). */
  id: string;
}

/** The market's vault spot: the model is scaled down to fit this footprint and height. */
export const CASH_FIT = { w: 2.2, d: 2.0, h: 2.6 } as const;

/** The era's own machine model, unscaled (null when the era has none). */
function eraModel(id: string): MachineModel | null {
  if ((ERA_MACHINE_2_IDS as readonly string[]).includes(id)) return createEraMachine2Model(id as EraMachine2Id);
  if ((ERA5_7_MACHINE_IDS as readonly string[]).includes(id)) return createEra5to7MachineModel(id as Era5to7MachineId);
  if ((ERA4_MACHINE_IDS as readonly string[]).includes(id)) return createEraMachine4(id as Era4MachineId);
  return null;
}

/** The generic safe in the era's colours (eras without a model of their own). */
function safeModel(era: number): EraCashModel {
  const c = ERAS[era]?.colors ?? { accent: 0xb85239, body: 0x8c857b, trim: 0x5c4028 };
  const m = createCashMachineModel(c.accent, c.body, c.trim);
  let spin = 0;
  return {
    root: m.root,
    w: CASH_MACHINE_SIZE.w,
    d: CASH_MACHINE_SIZE.d,
    h: CASH_MACHINE_SIZE.h,
    mouth: m.mouth.clone(),
    id: 'safe',
    animate: (dt, working) => {
      // the door wheel spins while it banks (and coasts to a stop)
      spin = working ? 9 : Math.max(0, spin - dt * 18);
      m.wheel.rotation.z -= dt * spin;
    },
  };
}

/** Era `era`'s cash machine model, fitted to the market's vault spot. */
export function createEraCashModel(era: number): EraCashModel {
  const id = eraCashMachine(era)?.id;
  const inner = id ? eraModel(id) : null;
  if (!id || !inner) return safeModel(era);

  // measure the model at rest (its own footprint covers the moving part at any angle)
  inner.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner.root);
  const size = box.getSize(new THREE.Vector3());
  const w0 = Math.max(inner.w, size.x);
  const d0 = Math.max(inner.d, size.z);
  const h0 = Math.max(0.01, box.max.y);
  const s = Math.min(1, CASH_FIT.w / w0, CASH_FIT.d / d0, CASH_FIT.h / h0);

  const root = new THREE.Group();
  root.name = `eraCash:${id}`;
  inner.root.scale.setScalar(s);
  // recentre the solid part on the origin, feet on the floor
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  inner.root.position.set(-cx * s, -Math.min(0, box.min.y) * s, -cz * s);
  root.add(inner.root);
  const w = Math.round(w0 * s * 100) / 100;
  const d = Math.round(d0 * s * 100) / 100;
  const h = (h0 - Math.min(0, box.min.y)) * s;
  return {
    root,
    w,
    d,
    h,
    mouth: new THREE.Vector3(0, h * 0.95, 0),
    id,
    animate: (dt, working) => inner.animate(dt, working),
  };
}
