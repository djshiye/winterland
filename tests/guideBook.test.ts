import { describe, expect, it } from 'vitest';
import { UPGRADES, type UpgradeDef } from '../src/config';
import { introEra } from '../src/core/ladder';
import { CITY_BUILDING_IDS, ERAS, MACHINES, MAX_ERA } from '../src/eras/data';
import { eraContent } from '../src/eras/template';
import { allBookEntries, bookEntries, BOOK_SECTIONS, chapterEntries, chapterFlag, newChapters, searchBook } from '../src/ui/guideBook';

describe('guidebook', () => {
  it('never shows a page from an era the player has not reached', () => {
    for (let age = 1; age <= MAX_ERA; age++) {
      for (const e of bookEntries(age)) expect(e.era).toBeLessThanOrEqual(age);
      expect(chapterEntries(age, age + 1, 'goods')).toEqual([]);
      for (const e of searchBook(age, 'the')) expect(e.era).toBeLessThanOrEqual(age);
    }
  });

  it('has a page for every machine, material, city building and era upgrade', () => {
    const ids = new Set(allBookEntries().map((e) => e.id));
    for (const id of Object.keys(MACHINES)) expect(ids.has(`machine:${id}`), id).toBe(true);
    for (let n = 2; n <= MAX_ERA; n++) for (const m of eraContent(n).materials) expect(ids.has(`good:${m}`), m).toBe(true);
    for (const id of CITY_BUILDING_IDS) expect(ids.has(`town:${id}`), id).toBe(true);
    for (const d of Object.values(UPGRADES) as UpgradeDef[]) {
      // machine levels are on the machine pages (era 1's on its pads, eras 2+'s per machine id / cash machine)
      if (d.group === 'machine') continue;
      const key = d.group === 'crew' ? `crew:${d.id}` : `upgrade:${d.id}`;
      expect(ids.has(key), d.id).toBe(true);
    }
  });

  it('puts every page in its own era and a known section, with unique ids and text', () => {
    const all = allBookEntries();
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    const sections = new Set(BOOK_SECTIONS.map((s) => s.id));
    for (const e of all) {
      expect(sections.has(e.section)).toBe(true);
      expect(e.name.length).toBeGreaterThan(1);
      expect(e.text.length).toBeGreaterThan(8);
      expect(e.text).not.toMatch(/undefined|NaN|\.\./);
    }
    for (const d of Object.values(UPGRADES) as UpgradeDef[]) {
      const e = all.find((x) => x.id === `upgrade:${d.id}` || x.id === `crew:${d.id}`);
      if (e) expect(e.era).toBe(introEra(d));
    }
  });

  it('gives every reached era something in each main section', () => {
    for (let n = 1; n <= MAX_ERA; n++) {
      if (n > 1 && !ERAS[n]) continue;
      for (const s of ['goods', 'machines', 'crew', 'upgrades', 'town'] as const) expect(chapterEntries(MAX_ERA, n, s).length, `${n} ${s}`).toBeGreaterThan(0);
    }
    expect(chapterEntries(1, 1, 'tips').length).toBeGreaterThan(0);
    expect(chapterEntries(2, 2, 'tips').length).toBeGreaterThan(0);
  });

  it('searches by every word', () => {
    const hits = searchBook(MAX_ERA, 'brick kiln');
    expect(hits.some((e) => e.id === 'machine:kiln')).toBe(true);
    expect(searchBook(1, 'kiln')).toEqual([]);
    expect(searchBook(5, '   ')).toEqual([]);
  });

  it('marks unread chapters 2..age as new, never Survival', () => {
    expect(newChapters(1, {})).toEqual([]);
    expect(newChapters(3, {})).toEqual([2, 3]);
    expect(newChapters(3, { [chapterFlag(2)]: true })).toEqual([3]);
  });
});

describe('guidebook save migration', () => {
  it('marks the eras an older save already reached as read, once, and leaves a fresh game alone', async () => {
    const { createGameState } = await import('../src/core/types');
    const { migrateState, MIGRATIONS } = await import('../src/core/Save');
    const m = MIGRATIONS.find((x) => x.id === '0.9.11-guidebook')!;
    expect(m).toBeTruthy();
    const old = createGameState();
    old.eras.age = 4;
    migrateState(old, false, { salesRate: 0 }, [m]);
    expect(newChapters(4, old.flags)).toEqual([]);
    expect(old.flags[chapterFlag(5)]).toBeUndefined();
    const fresh = createGameState();
    migrateState(fresh, true, { salesRate: 0 }, [m]);
    expect(fresh.migrations['0.9.11-guidebook']).toBe(true);
    expect(fresh.flags[chapterFlag(2)]).toBeUndefined();
  });
});
