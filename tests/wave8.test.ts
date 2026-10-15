/** Wave 8 core services: day/night curve, quests, rush hours. */
import { describe, expect, it } from 'vitest';
import { DAYNIGHT, RUSH } from '../src/config';
import { darknessAt } from '../src/core/DayNight';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { QUEST_DEFS, Quests } from '../src/core/quests';
import { RushHours } from '../src/core/Rush';
import { createGameState, type GameEvents } from '../src/core/types';

describe('darknessAt', () => {
  it('is day in the morning, night after dusk, and rises smoothly', () => {
    expect(darknessAt(0)).toBe(0);
    expect(darknessAt(DAYNIGHT.startAt)).toBe(0);
    expect(darknessAt((DAYNIGHT.nightFull + DAYNIGHT.dawnStart) / 2)).toBe(1);
    let prev = 0;
    for (let p = DAYNIGHT.duskStart; p <= DAYNIGHT.nightFull; p += 0.01) {
      const d = darknessAt(p);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
    expect(darknessAt(0.999)).toBe(0);
  });

  it('starts a fresh game at the configured time of day', () => {
    expect(createGameState().clock).toBeCloseTo(DAYNIGHT.startAt * DAYNIGHT.cycleSeconds);
  });
});

describe('Quests', () => {
  const make = () => {
    const state = createGameState();
    const events = new EventBus<GameEvents>();
    const economy = new Economy(events, state, 0);
    const done: string[] = [];
    events.on('quest:done', ({ id }) => done.push(id));
    return { state, economy, quests: new Quests(state, economy, events), done };
  };

  it('ids are unique and rewards are whole bundles', () => {
    expect(new Set(QUEST_DEFS.map((q) => q.id)).size).toBe(QUEST_DEFS.length);
    for (const q of QUEST_DEFS) expect(q.reward % 5).toBe(0);
  });

  it('shows three at a time and completes them one by one, paying the reward', () => {
    const { state, economy, quests, done } = make();
    expect(quests.active().map((q) => q.def.id)).toEqual(QUEST_DEFS.slice(0, 3).map((q) => q.id));
    state.stats.planksSold = 10;
    state.unlocked.harvester = true;
    quests.update(0.3);
    expect(done).toEqual(['planks10']);
    quests.update(0.3); // still inside the gap between completions
    expect(done).toEqual(['planks10']);
    quests.update(2);
    expect(done).toEqual(['planks10', 'harvester']);
    expect(economy.money).toBe(QUEST_DEFS[0]!.reward + QUEST_DEFS[1]!.reward);
    expect(state.quests.planks10).toBe(true);
  });
});

describe('RushHours', () => {
  it('waits for the village, then runs a rush and ends it', () => {
    const state = createGameState();
    const events = new EventBus<GameEvents>();
    const seen: string[] = [];
    events.on('rush:start', () => seen.push('start'));
    events.on('rush:end', () => seen.push('end'));
    const rush = new RushHours(state, events);
    rush.update(RUSH.every[1] + 1);
    expect(rush.active).toBe(false);
    state.village.level = RUSH.minVillageLevel;
    rush.update(RUSH.every[1] + 1);
    expect(rush.active).toBe(true);
    expect(rush.spawnMult).toBe(RUSH.spawnMult);
    rush.update(RUSH.seconds + 1);
    expect(rush.active).toBe(false);
    expect(seen).toEqual(['start', 'end']);
  });

  it('ignores a non-positive length instead of re-firing rush:start every frame', () => {
    const state = createGameState();
    const events = new EventBus<GameEvents>();
    let starts = 0;
    events.on('rush:start', () => starts++);
    const rush = new RushHours(state, events);
    rush.start(0);
    rush.start(-3);
    for (let i = 0; i < 10; i++) rush.update(1 / 60);
    expect(starts).toBe(0);
    expect(rush.active).toBe(false);
  });
});
