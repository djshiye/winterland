/** 0.9.12 wording pass (full review, bundle 4: Appendix A severity A, R7, M3, S2): the generated sentences read right. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENTS, UPGRADES } from '../src/config';
import { contractItem } from '../src/core/Contracts';
import { QUEST_DEFS } from '../src/core/quests';
import { createGameState, type ItemKind } from '../src/core/types';
import { upgradeRequirement } from '../src/core/Upgrades';
import { countOf, eraNoun, lowerLabel, MATERIALS, MAX_ERA } from '../src/eras/data';
import { gateNote, gateRuleShort, gateRuleText } from '../src/eras/gate';
import { reachNote } from '../src/ui/agesLogic';
import { allBookEntries } from '../src/ui/guideBook';
import { FAIL_TEXT } from '../src/ui/UpdateCard';

describe('era names in sentences (A5)', () => {
  it('never says "era era" or "Age era"', () => {
    for (let n = 1; n <= MAX_ERA; n++) {
      const s = `Needs the ${eraNoun(n)}`;
      expect(s).not.toMatch(/\b(Era|Age) era\b/);
      expect(s).toMatch(/\b(era|Age|Era)$/);
    }
    expect(eraNoun(10)).toBe('AI Era');
    expect(eraNoun(5)).toBe('Industrial era');
    expect(eraNoun(3)).toBe('Iron Age');
    expect(reachNote(6)).toBe('Reach the Industrial era first');
  });

  it('shop requirements and quests name eras cleanly', () => {
    const s = createGameState();
    for (const id of Object.keys(UPGRADES) as (keyof typeof UPGRADES)[]) {
      const r = upgradeRequirement(s, id);
      if (r) expect(r, id).not.toMatch(/\b(Era|Age) era\b/);
    }
    for (const q of QUEST_DEFS) expect(q.title).not.toMatch(/\b(Era|Age) era\b/);
  });
});

describe('material names in sentences (A4, A10)', () => {
  it('keeps AI upper case and counts in singular and plural', () => {
    expect(lowerLabel('AI Cores')).toBe('AI cores');
    expect(countOf('Gears', 1)).toBe('1 gear');
    expect(countOf('Batteries', 1)).toBe('1 battery');
    expect(countOf('Gas', 1)).toBe('1 gas');
    expect(countOf('Stone', 1)).toBe('1 stone');
    expect(countOf('Microchips', 1000)).toBe('1,000 microchips');
    expect(contractItem('gear' as ItemKind, 1)).toBe('1 gear');
    expect(contractItem('aiCore' as ItemKind, 24)).toBe('24 AI cores');
    for (const m of Object.values(MATERIALS)) expect(countOf(m.label, 2)).not.toMatch(/\bai\b/);
  });

  it('the guidebook never lower-cases an acronym', () => {
    for (const e of allBookEntries()) expect(e.text, e.id).not.toMatch(/\bai cores?\b/);
  });
});

describe('gate and guide lines', () => {
  it('spells out Settlement and avoids "Flats\'s" (A9, B4)', () => {
    expect(gateNote({ ok: 37, total: 48, settlement: { level: 8 }, settlementNeed: 10 })).toBe('37/48 · Settlement 8/10');
    for (let n = 2; n <= MAX_ERA + 1; n++) {
      expect(gateRuleText(n)).not.toMatch(/s's\b/);
      expect(gateRuleShort(n)).not.toMatch(/'s\b/);
    }
  });

  it('the guidebook names the hold key and the shop has no "Buy press" (A1, A3)', () => {
    const tip = (id: string): string => allBookEntries().find((e) => e.id === `tip:${id}`)!.text;
    expect(tip('chop')).toContain('hold E');
    expect(tip('pads')).toContain('hold E');
    expect(tip('shop')).not.toContain('Buy press');
    expect(tip('away')).toContain('2 hours');
  });
});

describe('event hints and update errors (A6, A7, R7)', () => {
  it('match what the events do', () => {
    expect(EVENTS.kinds.festival.hint).toContain('twice as often');
    expect(EVENTS.kinds.snowstorm.hint).not.toContain('burn');
  });

  it('never shows a terminal command', () => {
    for (const t of Object.values(FAIL_TEXT)) expect(t).not.toMatch(/sudo|apt /);
  });
});

describe('keyboard: Up / Down leave a one-line text box (PR #95 note)', () => {
  it('the guidebook search no longer traps Down', () => {
    const nav = readFileSync(resolve(__dirname, '..', 'src/input/menuNav.ts'), 'utf8');
    expect(nav).toContain("!(lineInput(target) && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))");
  });
});
