/** Wave 13: delivery contracts (core/Contracts). */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONTRACTS } from '../src/config';
import { Contracts, contractClock, contractItem } from '../src/core/Contracts';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { sanitizeState } from '../src/core/Save';
import { createGameState, type GameEvents, type ItemKind } from '../src/core/types';

function setup(level = 3) {
  const state = createGameState();
  state.village.level = level;
  const events = new EventBus<GameEvents>();
  const economy = new Economy(events, state, 0);
  const contracts = new Contracts(state, economy, events);
  const log: string[] = [];
  const offered: ItemKind[] = [];
  events.on('contract:offered', (e) => {
    log.push('offered');
    offered.push(e.kind);
  });
  events.on('contract:done', () => log.push('done'));
  events.on('contract:failed', () => log.push('failed'));
  const sell = (kind: ItemKind, count: number): void =>
    events.emit('sale', { buyer: 'townsfolk', kind, count, amount: count * 10, position: new THREE.Vector3() });
  return { state, events, economy, contracts, log, offered, sell };
}

const def = (kind: ItemKind) => CONTRACTS.offers.find((o) => o.kind === kind)!;

describe('canMake', () => {
  it('null is always makeable, a pad needs state.unlocked, a business needs a built lot', () => {
    const { state, contracts } = setup();
    expect(contracts.canMake(null)).toBe(true);
    expect(contracts.canMake('processor')).toBe(false);
    state.unlocked.processor = true;
    expect(contracts.canMake('processor')).toBe(true);
    expect(contracts.canMake('workshop')).toBe(false);
    state.unlocked.workshop = true;
    expect(contracts.canMake('workshop')).toBe(true);
    expect(contracts.canMake('bakery')).toBe(false);
    state.town.lots[0]!.building = 'bakery';
    state.town.lots[0]!.tier = -1; // for sale, not built
    expect(contracts.canMake('bakery')).toBe(false);
    state.town.lots[0]!.tier = 0;
    expect(contracts.canMake('bakery')).toBe(true);
    expect(contracts.canMake('butcher')).toBe(false);
  });
});

describe('offering', () => {
  it('only offers makeable kinds (a fresh game: planks) and writes the contract', () => {
    const { state, contracts, offered } = setup();
    for (let i = 0; i < 20; i++) contracts.offer();
    expect(new Set(offered)).toEqual(new Set(['plank']));
    expect(state.contract).toEqual({ kind: 'plank', target: def('plank').count, progress: 0, left: CONTRACTS.seconds, bonus: def('plank').bonus });
  });

  it('never repeats the previous kind while another is makeable', () => {
    const { state, contracts, offered } = setup();
    state.unlocked.processor = true;
    state.town.lots[0]!.building = 'bakery';
    state.town.lots[0]!.tier = 0;
    for (let i = 0; i < 60; i++) contracts.offer();
    for (let i = 1; i < offered.length; i++) expect(offered[i]).not.toBe(offered[i - 1]);
    expect(new Set(offered)).toEqual(new Set(['plank', 'crate', 'bread']));
  });

  it('offer(kind) forces that kind', () => {
    const { state, contracts } = setup();
    contracts.offer('toy');
    expect(state.contract.kind).toBe('toy');
    expect(state.contract.target).toBe(def('toy').count);
  });

  it('waits for the village level, then offers within CONTRACTS.every[1] seconds', () => {
    const low = setup(CONTRACTS.minVillageLevel - 1);
    low.contracts.update(5000);
    expect(low.log).toEqual([]);
    const { contracts, log, state } = setup(CONTRACTS.minVillageLevel);
    contracts.update(CONTRACTS.every[0] - 1);
    expect(log).toEqual([]);
    contracts.update(CONTRACTS.every[1]);
    expect(log).toEqual(['offered']);
    expect(state.contract.kind).toBe('plank');
    contracts.update(1);
    expect(log).toEqual(['offered']); // one at a time
  });
});

describe('progress, completion, failure', () => {
  it('counts only matching sales', () => {
    const { state, contracts, sell, economy } = setup();
    contracts.offer('plank');
    sell('crate', 5);
    sell('log', 5);
    expect(state.contract.progress).toBe(0);
    sell('plank', 3);
    sell('plank', 4);
    expect(state.contract.progress).toBe(7);
    expect(economy.money).toBe(0);
  });

  it('pays the bonus, emits done and clears when the target is met, then restarts the gap', () => {
    const { state, contracts, sell, economy, log } = setup();
    contracts.offer('plank');
    sell('plank', def('plank').count - 1);
    expect(contracts.active).toBe(true);
    sell('plank', 5); // overshoot still completes once
    expect(economy.money).toBe(def('plank').bonus);
    expect(log).toEqual(['offered', 'done']);
    expect(state.contract).toEqual({ kind: '', target: 0, progress: 0, left: 0, bonus: 0 });
    sell('plank', 50); // nothing active: ignored
    expect(economy.money).toBe(def('plank').bonus);
    contracts.update(CONTRACTS.every[0] - 1);
    expect(log).toEqual(['offered', 'done']); // the gap restarted
  });

  it('fails when the time runs out', () => {
    const { state, contracts, log, economy } = setup();
    contracts.offer('plank');
    contracts.update(CONTRACTS.seconds - 1);
    expect(state.contract.left).toBeCloseTo(1, 5);
    expect(log).toEqual(['offered']);
    contracts.update(1.5);
    expect(log).toEqual(['offered', 'failed']);
    expect(state.contract.kind).toBe('');
    expect(economy.money).toBe(0);
  });

  it('resumes a saved active contract without re-offering', () => {
    const state = createGameState();
    state.village.level = 4;
    Object.assign(state.contract, { kind: 'plank', target: 40, progress: 12, left: 90, bonus: 800 });
    const events = new EventBus<GameEvents>();
    const contracts = new Contracts(state, new Economy(events, state, 0), events);
    let offered = 0;
    events.on('contract:offered', () => offered++);
    contracts.update(10);
    expect(offered).toBe(0);
    expect(state.contract.left).toBeCloseTo(80, 5);
    expect(state.contract.progress).toBe(12);
  });
});

describe('save sanitising', () => {
  it('clears a bogus saved kind and clamps a real one', () => {
    const a = createGameState();
    Object.assign(a.contract, { kind: 'banana', target: 5, progress: 3, left: 50, bonus: 100 });
    sanitizeState(a);
    expect(a.contract).toEqual({ kind: '', target: 0, progress: 0, left: 0, bonus: 0 });
    const b = createGameState();
    Object.assign(b.contract, { kind: 'bread', target: 20, progress: 99, left: 99999, bonus: 1500 });
    sanitizeState(b);
    expect(b.contract.kind).toBe('bread');
    expect(b.contract.progress).toBe(20);
    expect(b.contract.left).toBe(CONTRACTS.seconds);
  });
});

describe('labels', () => {
  it('formats the item and the clock', () => {
    expect(contractItem('bread', 20)).toBe('20 loaves');
    expect(contractItem('furniture', 1)).toBe('1 chair');
    expect(contractClock(161)).toBe('2:41');
    expect(contractClock(180)).toBe('3:00');
    expect(contractClock(-3)).toBe('0:00');
  });
});

describe('carried sales rate (F4)', () => {
  it('a restored Contracts starts from the saved rate and sizes the next era contract the same', () => {
    const a = setup(3);
    a.contracts.update(1);
    a.sell('plank', 100);
    for (let i = 0; i < 30; i++) a.contracts.update(1);
    const saved = a.contracts.salesRate;
    expect(saved).toBeGreaterThan(0);
    const state = createGameState();
    const events = new EventBus<GameEvents>();
    const restored = new Contracts(state, new Economy(events, state, 0), events, saved);
    expect(restored.salesRate).toBeCloseTo(saved, 6);
    expect(new Contracts(createGameState(), new Economy(events, state, 0), events).salesRate).toBe(0);
  });
});
