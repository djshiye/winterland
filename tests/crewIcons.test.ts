/** V6: crew icons tell era (headgear) and role (colour + tool badge) apart. */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ERA_ROLES } from '../src/config';
import { ERAS } from '../src/eras/data';
import { upgradeIcon } from '../src/ui/icons';

const eras = ERAS.filter((e) => e !== null);
const ids = (key: string): string[] => [`${key}Crew`, ...ERA_ROLES.map((r) => `${key}${r.key}`)];

describe('crew icons', () => {
  it('covers eras 2-10', () => expect(eras.map((e) => e!.n)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]));
  for (const era of eras) {
    it(`era ${era!.n}: hauler and six roles are all distinct and valid SVG`, () => {
      const icons = ids(era!.key).map((id) => upgradeIcon(id as never));
      expect(new Set(icons).size).toBe(7);
      for (const s of icons) {
        expect(s.startsWith('<svg')).toBe(true);
        expect(s).not.toMatch(/undefined|NaN/);
      }
    });
  }
  it('the same role differs between eras', () => {
    for (const r of ['Crew', ...ERA_ROLES.map((x) => x.key)]) {
      const set = new Set(eras.map((e) => upgradeIcon(`${e!.key}${r}` as never)));
      expect(set.size).toBe(eras.length);
    }
  });
  it('optional dump for the visual check', () => {
    const out = process.env.CREW_ICON_DUMP;
    if (!out) return;
    const rows = eras.map((e) => ids(e!.key).map((id) => upgradeIcon(id as never)));
    writeFileSync(out, JSON.stringify(rows));
  });
});
