/** Save accounting: money / items that are mid-flight must stay visible to the save snapshot. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ECONOMY, LAYOUT } from '../src/config';
import { Economy } from '../src/core/Economy';
import { EventBus } from '../src/core/EventBus';
import { TweenManager } from '../src/core/Tween';
import { createGameState, type GameContext, type GameEvents } from '../src/core/types';
import { CashStack } from '../src/items/CashStack';
import { FlightSystem } from '../src/items/FlightSystem';
import { ItemPool } from '../src/items/ItemPool';
import { Pile } from '../src/items/Pile';
import { transferOne } from '../src/items/transfer';
import { CashPile } from '../src/stations/CashPile';

function makeCtx(startMoney = 0) {
  const events = new EventBus<GameEvents>();
  const state = createGameState();
  const updatables: { update(dt: number): void }[] = [];
  const c: Record<string, unknown> = {
    events,
    state,
    scene: new THREE.Scene(),
    economy: new Economy(events, state, startMoney),
    time: { frame: 0, elapsed: 0 },
    addUpdatable: (u: { update(dt: number): void }) => updatables.push(u),
    zones: { addTransfer: () => ({}) },
    player: {},
  };
  const ctx = c as unknown as GameContext;
  (c as { tweens: unknown }).tweens = new TweenManager();
  (c as { items: unknown }).items = new ItemPool(ctx);
  (c as { flights: unknown }).flights = new FlightSystem(ctx);
  const anchor = new THREE.Group();
  ctx.scene.add(anchor);
  const back = new CashStack(ctx, { id: 'back', anchor, maxVisual: 6 });
  (ctx.player as unknown as { back: CashStack }).back = back;
  const step = (dt = 1 / 60): void => {
    ctx.time.frame++;
    ctx.time.elapsed += dt;
    for (const u of updatables) u.update(dt);
    ctx.flights.update(dt);
    ctx.tweens.update(dt);
  };
  return { ctx, back, step };
}

describe('CashStack.inFlightValue', () => {
  it('tracks reserve -> receive and reserve -> cancel by the reserved value', () => {
    const { ctx, back } = makeCtx(0);
    const a = ctx.items.create('cash', 40);
    const b = ctx.items.create('cash', 25);
    const sa = back.reserve(a);
    const sb = back.reserve(b);
    expect(back.inFlightValue).toBe(65);
    a.value = 0; // release() zeroes values: the remembered value must be used
    back.receive(a, sa);
    expect(back.inFlightValue).toBe(25);
    expect(ctx.economy.money).toBe(40);
    back.cancel(sb);
    expect(back.inFlightValue).toBe(0);
    back.cancel(sb); // double settle never goes negative
    expect(back.inFlightValue).toBe(0);
  });

  it('money + inFlightValue never dips while a pile is collected', () => {
    const { ctx, back, step } = makeCtx(0);
    const grid = { cols: 2, rows: 1, layers: 1, spacing: new THREE.Vector3(0.5, 0.2, 0.5) } as never;
    const pile = new Pile(ctx, { id: 'p', accepts: ['cash'], position: new THREE.Vector3(), grid, overflowMerge: true });
    for (let i = 0; i < 6; i++) pile.fill('cash', 1, 100);
    const total = pile.totalValue();
    for (let i = 0; i < 6; i++) {
      transferOne(ctx, pile, back, ['cash'], { duration: 0.15 });
      expect(ctx.economy.money + back.inFlightValue + pile.totalValue()).toBe(total);
    }
    for (let f = 0; f < 60; f++) {
      step();
      expect(ctx.economy.money + back.inFlightValue + pile.totalValue()).toBe(total);
    }
    expect(back.inFlightValue).toBe(0);
    expect(ctx.economy.money).toBe(total);
  });
});

describe('FlightSystem.inFlightTo', () => {
  it('counts live flights per holder and kind, and cash value', () => {
    const { ctx, back, step } = makeCtx(0);
    const other = new Pile(ctx, { id: 'o', accepts: ['log'], position: new THREE.Vector3(), grid: LAYOUT.walkInCash.grid });
    const c = ctx.items.create('cash', 30);
    ctx.flights.launch(c, back, back.reserve(c));
    const l = ctx.items.create('log');
    ctx.flights.launch(l, other, other.reserve(l));
    expect(ctx.flights.inFlightTo(back)).toBe(1);
    expect(ctx.flights.inFlightTo(back, 'cash')).toBe(1);
    expect(ctx.flights.inFlightTo(back, 'log')).toBe(0);
    expect(ctx.flights.inFlightTo(other, 'log')).toBe(1);
    expect(ctx.flights.valueInFlightTo(back)).toBe(30);
    expect(ctx.flights.valueInFlightTo(other)).toBe(0);
    for (let f = 0; f < 30; f++) step();
    expect(ctx.flights.inFlightTo(back)).toBe(0);
    expect(ctx.flights.inFlightTo(other, 'log')).toBe(0);
  });
});

describe('CashPile.value', () => {
  it('includes bundles waiting in pay() delays and in the air, and never dips or double counts', () => {
    const { ctx, step } = makeCtx(0);
    const w = LAYOUT.walkInCash;
    const cp = new CashPile(ctx, { id: 'pile:t', x: w.x, z: w.z, grid: w.grid, zone: w.zone });
    cp.restoreValue(50);
    cp.pay(100, new THREE.Vector3(0, 1, 0));
    expect(cp.value).toBe(150);
    let landedAt = -1;
    for (let f = 0; f < 120; f++) {
      step();
      expect(cp.value).toBe(150);
      if (landedAt < 0 && cp.inFlightValue === 0) landedAt = f;
    }
    expect(landedAt).toBeGreaterThan(10);
    expect(cp.pile.totalValue()).toBe(150);
    expect(cp.inFlightValue).toBe(0);
  });

  it('survives overflow merging into a full pile (subtracts once)', () => {
    const { ctx, step } = makeCtx(0);
    const w = LAYOUT.walkInCash;
    const cp = new CashPile(ctx, { id: 'pile:t2', x: w.x, z: w.z, grid: w.grid, zone: w.zone });
    const cap = cp.pile.capacity;
    cp.restoreValue(cap * ECONOMY.cashBundleValue);
    expect(cp.pile.isFull()).toBe(true);
    const before = cp.value;
    cp.pay(60, new THREE.Vector3(0, 1, 0));
    for (let f = 0; f < 120; f++) {
      step();
      expect(cp.value).toBe(before + 60);
    }
    expect(cp.inFlightValue).toBe(0);
  });
});
