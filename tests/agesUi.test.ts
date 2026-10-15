/** 0.9.0 Ages UI: the pure helpers behind the shop tabs, era labels, cost lines, income ticker and the map list. */
import { describe, expect, it } from 'vitest';
import {
  costText,
  eraChipVisible,
  eraRoman,
  eraTitle,
  expansionCostText,
  formatPopulation,
  groupTravelPoints,
  IncomeTicker,
  industryEraNote,
  industryEraShown,
  industryErasShown,
  itemLabel,
  rankName,
  reachNote,
  settlementTitle,
  shopTabs,
  travelNote,
} from '../src/ui/agesLogic';
import { ERAS, unlockCash } from '../src/eras/data';
import type { TravelPoint } from '../src/eras/layout';

describe('era labels', () => {
  it('has roman numerals up to X', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(eraRoman)).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']);
    expect(eraRoman(0)).toBe('');
    expect(eraRoman(11)).toBe('');
  });

  it('titles an era banner', () => {
    expect(eraTitle(4)).toBe('ERA IV · STEAM AGE');
    expect(eraTitle(10)).toBe('ERA X · AI ERA');
  });

  it('calls village levels settlements, not eras', () => {
    expect(settlementTitle('Winter City')).toBe('SETTLEMENT · WINTER CITY');
    expect(settlementTitle('Camp')).not.toMatch(/ERA/);
  });
});

describe('cost text', () => {
  it('labels items', () => {
    expect(itemLabel('stone')).toBe('Stone');
    expect(itemLabel('crate')).toBe('Crates');
    expect(itemLabel('brick')).toBe('Bricks');
  });

  it('joins money and a material', () => {
    expect(costText(27_000, { kind: 'stone', count: 12 })).toBe('$27,000 + 12 Stone');
    expect(costText(40_000, null)).toBe('$40,000');
    expect(costText(1_500_000, { kind: 'crate', count: 0 })).toBe('$1.5M');
  });

  it('prices every era expansion from the data', () => {
    expect(expansionCostText(2)).toBe('Expansion: $150,000 + 40 Crates');
    for (let n = 2; n <= 10; n++) {
      const t = expansionCostText(n);
      expect(t.startsWith('Expansion: $')).toBe(true);
      expect(t).toContain(`${ERAS[n]!.unlock.extra.count} `);
    }
    expect(unlockCash(3)).toBe(450_000);
    expect(expansionCostText(1)).toBe('');
  });

  it('says what a locked region needs first', () => {
    expect(reachNote(2)).toBe('Reach Winter City first');
    expect(reachNote(4)).toBe('Reach the Iron Age first');
  });
});

describe('shop tabs and era groups', () => {
  it('always shows Finance, Industry once the first expansion is near', () => {
    expect(shopTabs(1, false)).toEqual(['lumberjack', 'crew', 'sales', 'finance']);
    expect(shopTabs(1, true)).toEqual(['lumberjack', 'crew', 'sales', 'industry', 'finance']);
    expect(shopTabs(2, false)).toContain('industry');
  });

  it('lists eras up to one past the current age', () => {
    expect(industryErasShown(1)).toEqual([2]);
    expect(industryErasShown(3)).toEqual([2, 3, 4]);
    expect(industryErasShown(10)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('shows the next era locked with a reason', () => {
    expect(industryEraShown(4, 3)).toBe(true);
    expect(industryEraShown(5, 3)).toBe(false);
    expect(industryEraShown(1, 3)).toBe(false);
    expect(industryEraNote(4, 3)).toBe('Needs the Steam Age era');
    expect(industryEraNote(3, 3)).toBeNull();
  });
});

describe('era chip', () => {
  it('appears with the first expansion offer or era 2', () => {
    expect(eraChipVisible(1, false)).toBe(false);
    expect(eraChipVisible(1, true)).toBe(true);
    expect(eraChipVisible(2, false)).toBe(true);
  });

  it('formats population and rank', () => {
    expect(formatPopulation(1234)).toBe('1,234');
    expect(formatPopulation(12_345)).toBe('12.3K');
    expect(formatPopulation(120_000)).toBe('120K');
    expect(formatPopulation(1_500_000)).toBe('1.5M');
    expect(formatPopulation(-5)).toBe('0');
    expect(rankName(0)).toBe('Town');
    expect(rankName(2)).toBe('Big City');
    expect(rankName(99)).toBe('Metropolis');
  });
});

describe('income ticker', () => {
  it('batches events instead of one line per event', () => {
    const t = new IncomeTicker(3);
    t.add('rent', 5_000);
    t.add('business', 7_500);
    expect(t.update(1)).toBeNull();
    t.add('rent', 0);
    t.add('rent', -10);
    expect(t.update(1)).toBeNull();
    const b = t.update(1.5);
    expect(b).not.toBeNull();
    expect(b!.amount).toBe(12_500);
    expect(b!.text).toBe('+$12,500 city');
    expect(t.update(10)).toBeNull();
    expect(t.waiting).toBe(0);
  });

  it('labels a batch by its biggest source', () => {
    const t = new IncomeTicker(1);
    t.add('rent', 100);
    t.add('trade', 4_000);
    t.add('jack', 50);
    expect(t.update(1)!.text).toBe('+$4,150 trade');
  });

  it('starts a fresh batch after a flush', () => {
    const t = new IncomeTicker(1);
    t.add('interest', 2_000_000);
    expect(t.update(1)!.text).toBe('+$2M interest');
    t.add('jack', 300);
    expect(t.update(1)!.text).toBe('+$300 Jack');
  });
});

describe('map travel list', () => {
  const pt = (id: string, kind: TravelPoint['kind'], era: number, open: boolean): TravelPoint => ({ id, label: id, kind, era, x: 0, z: 0, open });

  it('groups Home / Regions / City and drops empty groups', () => {
    const g = groupTravelPoints([pt('yard', 'home', 1, true), pt('region:2', 'region', 2, true), pt('district:2', 'district', 2, false)]);
    expect(g.map((x) => x.title)).toEqual(['Home', 'Regions', 'City']);
    expect(groupTravelPoints([pt('yard', 'home', 1, true)]).map((x) => x.title)).toEqual(['Home']);
  });

  it('shows the expansion price and the era needed for locked regions', () => {
    const locked = travelNote(pt('region:3', 'region', 3, false), 1);
    expect(locked.cost).toBe(expansionCostText(3));
    expect(locked.need).toBe('Reach the Frontier first');
    const offered = travelNote(pt('region:2', 'region', 2, true), 1);
    expect(offered.cost).toBe(expansionCostText(2));
    expect(offered.need).toMatch(/open/i);
    expect(travelNote(pt('region:2', 'region', 2, true), 2)).toEqual({ cost: null, need: null });
  });

  it('notes locked districts and unfound places', () => {
    expect(travelNote(pt('district:4', 'district', 4, false), 2).need).toBe('Needs the Steam Age era');
    expect(travelNote(pt('district:2', 'district', 2, true), 2).need).toBeNull();
    expect(travelNote(pt('town', 'home', 1, false), 1).need).toBe('Not found yet');
    expect(travelNote(pt('yard', 'home', 1, true), 1)).toEqual({ cost: null, need: null });
  });
});
