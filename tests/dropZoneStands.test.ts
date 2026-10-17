/**
 * 0.9.9: log haulers, porters and the foreman all load from the era 1 drop zone. Every soak up to 0.9.8 found a
 * porter standing inside a log hauler there (they shared DROP_POST and its lanes). Each crew now has its own row /
 * lane, so no two stand spots are closer than a body width, and every spot is on free yard ground.
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT, type Rect, type XZ } from '../src/config';
import { dropZoneStands } from '../src/npc/crewHelpers';
import { DROP_STAND } from '../src/npc/Foreman';
import { ColliderWorld } from '../src/world/Colliders';
import fixture from './fixtures/townColliders.json';

type Dump = { tag: string; box?: Rect; circle?: { x: number; z: number; r: number } };

/** Two standing characters (radius ~0.3) must not touch. */
const MIN_GAP = 0.6;

describe('drop zone stand spots', () => {
  const { logHauler, porter } = dropZoneStands();
  const all: { who: string; p: XZ }[] = [
    ...logHauler.map((p, i) => ({ who: `logHauler.${i}`, p })),
    ...porter.map((p, i) => ({ who: `porter.${i}`, p })),
    { who: 'foreman', p: DROP_STAND },
  ];

  it('keeps every hauler, porter and the foreman a body width apart', () => {
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        expect(Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z), `${a.who} vs ${b.who}`).toBeGreaterThanOrEqual(MIN_GAP);
      }
  });

  it('puts every spot on free yard ground, off the drop zone pile', () => {
    const w = new ColliderWorld();
    w.setBounds(LAYOUT.yard);
    for (const c of fixture as Dump[]) {
      if (c.box) w.addBox(c.box, c.tag);
      else if (c.circle) w.addCircle(c.circle.x, c.circle.z, c.circle.r, c.tag);
    }
    for (const { who, p } of all) expect(w.overlaps(p.x, p.z, 0.3), who).toBe(false);
  });
});
