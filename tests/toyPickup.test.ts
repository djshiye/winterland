/** A shop whose product the player's arms can carry (the toy factory) has a pickup strip on its counter pile. */
import { describe, expect, it } from 'vitest';
import { BUSINESSES, LAYOUT, TOWN, inflate, type BusinessId, type Rect } from '../src/config';
import { CARRY_KINDS } from '../src/core/types';
import { layoutFor, lotFrame, queueSpotOf, worldRect, type LRect } from '../src/town/rules';

const T = LAYOUT.town;
const FRONTS = [0.9, 1.2, 1.5, 1.8];
const overlap = (a: Rect, b: Rect): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const inside = (r: Rect, x: number, z: number): boolean => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const lrect = (f: ReturnType<typeof lotFrame>, r: LRect): Rect => worldRect(f, r.u0, r.u1, r.v0, r.v1);

describe('shop pickup zone', () => {
  it('only shops with a carryable output have one (toy factory yes; bakery / butcher no)', () => {
    for (const id of Object.keys(BUSINESSES) as BusinessId[]) {
      const def = BUSINESSES[id];
      if (def.kind !== 'shop') continue;
      const carry = !!def.output && (CARRY_KINDS as readonly string[]).includes(def.output);
      for (const depth of FRONTS) {
        for (let lot = 0; lot < T.lots.length; lot++) {
          const L = layoutFor(def, depth, lotFrame(lot).variant);
          expect(L.pickup !== null, `${id} lot ${lot}`).toBe(carry);
        }
      }
    }
    expect(layoutFor(BUSINESSES.toyFactory, 1.2).pickup).not.toBeNull();
    expect(layoutFor(BUSINESSES.bakery, 1.2).pickup).toBeNull();
    expect(layoutFor(BUSINESSES.butcher, 1.2).pickup).toBeNull();
  });

  it('toy factory pickup clears the hopper, counter, till, other zones and queue spots on every lot', () => {
    for (const depth of FRONTS) {
      for (let lot = 0; lot < T.lots.length; lot++) {
        const f = lotFrame(lot);
        const L = layoutFor(BUSINESSES.toyFactory, depth, f.variant);
        const pk = lrect(f, L.pickup!);
        const label = `lot ${lot} front ${depth}`;
        // solids = [hopper box, counter box]
        for (const s of L.solids) expect(overlap(pk, lrect(f, s)), `${label} solid`).toBe(false);
        const till = L.till!;
        const tillBox = worldRect(f, till.u - 0.52, till.u + 0.52, till.v - 0.37, till.v + 0.37);
        expect(overlap(pk, tillBox), `${label} till`).toBe(false);
        for (const z of [L.feed!, L.collect!]) expect(overlap(pk, lrect(f, z)), `${label} zone`).toBe(false);
        for (let i = 0; i < TOWN.queuePerShop; i++) {
          const p = queueSpotOf(f, L, i, { x: 0, z: 0 });
          expect(inside(inflate(pk, 0.25), p.x, p.z), `${label} queue ${i}`).toBe(false);
        }
        // inside the lot's own width, so neighbouring lots' zones are unaffected
        expect(L.pickup!.u0).toBeGreaterThanOrEqual(-T.lotSize / 2);
        expect(L.pickup!.u1).toBeLessThanOrEqual(T.lotSize / 2);
        expect(L.pickup!.u1 - L.pickup!.u0).toBeGreaterThan(0.6);
      }
    }
  });
});
