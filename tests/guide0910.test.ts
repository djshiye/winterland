/** 0.9.10 first hour and new-era guide (READINESS C2, C5, C7): the shared next goal, the early quest panel, first trade. */
import { describe, expect, it } from 'vitest';
import { VILLAGE } from '../src/config';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { QUEST_DEFS, Quests, TRADE_FLAG, questEra } from '../src/core/quests';
import { createGameState, type GameEvents, type GameState } from '../src/core/types';
import { chipGoalText, guideGoal, isExpandGoal, setGuideGoal } from '../src/progression/guideGoal';
import { questStartCollapse } from '../src/ui/QuestPanel';
import { starterSteps } from '../src/progression/eraStarter';
import { ERAS } from '../src/eras/data';

const def = (id: string) => QUEST_DEFS.find((q) => q.id === id)!;

function eraState(age: number): GameState {
  const s = createGameState();
  s.village.level = VILLAGE.levels.length - 1;
  s.village.greatLodge.tier = 0;
  s.eras.age = age;
  for (let n = 2; n <= age; n++) s.eras.regions[n]!.unlocked = true;
  return s;
}

describe('one next goal for the chip and the banner (C2)', () => {
  it('keeps the banner goal per game and clears it when the banner goes quiet', () => {
    const a = createGameState();
    const b = createGameState();
    expect(guideGoal(a)).toBeNull();
    setGuideGoal(a, 'Build a quarry in Granite Hollow');
    expect(guideGoal(a)).toBe('Build a quarry in Granite Hollow');
    expect(guideGoal(b)).toBeNull(); // another game (a test, a New Season) never sees it
    setGuideGoal(a, null);
    expect(guideGoal(a)).toBeNull();
    setGuideGoal(a, '');
    expect(guideGoal(a)).toBeNull();
    // a starter's long reading step reaches the chip in its short form
    setGuideGoal(a, '1/5 · Granite Hollow runs on stone and clay, fired into bricks and roof tiles', 'Explore Granite Hollow');
    expect(guideGoal(a)).toBe('Explore Granite Hollow');
  });

  it("gives the starter's reading and walking steps a short chip line", () => {
    for (let n = 2; n <= 10; n++) {
      const steps = starterSteps(n);
      expect(steps[0]!.chip).toBe(`Explore ${ERAS[n]!.region}`);
      expect(steps[4]!.chip).toContain(ERAS[n]!.region);
      for (const st of steps) expect((st.chip ?? chipGoalText(st.text)).length).toBeLessThanOrEqual(44);
    }
  });

  it("drops a starter step's tag in the chip and spots the expansion step", () => {
    expect(chipGoalText('2/5 · Chip the Great Boulder for stone')).toBe('Chip the Great Boulder for stone');
    expect(chipGoalText('Feed the brick kiln')).toBe('Feed the brick kiln');
    expect(isExpandGoal('Expand to Iron Ridge ($50M)')).toBe(true);
    expect(isExpandGoal('Bring 35 bricks to Iron Ridge')).toBe(true);
    expect(isExpandGoal('Bring logs to the village')).toBe(false);
    expect(isExpandGoal('Feed the brick kiln')).toBe(false);
  });
});

describe('quest panel on a fresh game (C5)', () => {
  it('holds collapsed until the harvester on every screen, then the stored choice or the screen default applies', () => {
    for (const width of [390, 1280, 1920]) expect(questStartCollapse(null, width, false).early).toBe(true);
    expect(questStartCollapse('0', 1920, false).early).toBe(true);
    expect(questStartCollapse(null, 1280, true)).toEqual({ early: false, preferred: false });
    expect(questStartCollapse(null, 390, true)).toEqual({ early: false, preferred: true });
    expect(questStartCollapse('1', 1920, true)).toEqual({ early: false, preferred: true });
    expect(questStartCollapse('0', 390, true)).toEqual({ early: false, preferred: false });
  });
});

describe('first trade quest (C7)', () => {
  it('is a small era-2 quest, no bigger than an early quest, shown from era 2 only', () => {
    const q = def('trade1');
    expect(q.target).toBe(1);
    expect(questEra('trade1')).toBe(2);
    expect(q.reward).toBeLessThanOrEqual(def('jack1').reward);
    expect(q.unlocked!(createGameState())).toBe(false);
    expect(q.unlocked!(eraState(2))).toBe(true);
  });

  it('counts a buy, a held good, a profit, and a sale at a loss (the market:trade flag)', () => {
    const q = def('trade1');
    const s = eraState(2);
    expect(q.progress(s)).toBe(0);
    s.market.holdings.brick = 3;
    expect(q.progress(s)).toBe(1);
    delete s.market.holdings.brick;
    s.stats.tradeProfit = 10;
    expect(q.progress(s)).toBe(1);
    s.stats.tradeProfit = 0;
    expect(q.progress(s)).toBe(0);
    const events = new EventBus<GameEvents>();
    new Quests(s, new Economy(events, s, 0), events);
    events.emit('market:trade', { kind: 'brick', units: 2, side: 'sell', amount: 40, profit: -5 });
    expect(s.flags[TRADE_FLAG]).toBe(true);
    expect(q.progress(s)).toBe(1);
  });
});
