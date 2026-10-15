/**
 * 0.9.0 city districts east of the Market Town: one per era (eras/data.ts DISTRICTS), lots chosen through
 * 'choose:open' and paid on construction pads (cash + the era's refined material), demolished through 'manage:open';
 * population, happiness, rank (CITY_RANKS) and income (rent + staffed businesses, credited every CITY_TICK as
 * 'income'); an instanced skyline that grows with the population.
 *
 * - A district (city/District.ts) opens when state.eras.age >= its era: on 'era:unlocked' (with the usual effects) or
 *   silently at construction for a restored save. Level constructs and updates this class.
 * - The economy is derived from state.city by the pure rules in city/rules.ts (nothing extra is saved). Every
 *   CITY_TICK seconds income x CITY_TICK is credited ('income' {source: 'business' | 'rent'}, stats.cityEarned).
 * - 'city:changed' fires when the whole-settlement population or the rank changes; 'city:rankUp' on a rank increase
 *   (never while loading).
 * - The skyline (world/env/skyline.ts) is a child of `root` and re-sizes with the population and era.
 */
import * as THREE from 'three';
import { CITY_BUILDINGS, CITY_RANKS, CITY_TICK, DISTRICTS, MAX_ERA, type CityBuildingId } from '../eras/data';
import type { GameContext } from '../core/types';
import { Skyline } from '../world/env/skyline';
import { District } from './District';
import { cityTotals, incomePerSecond, incomeSplit, rankFor, settlePaidCity } from './rules';

export class City {
  /** Everything the city draws hangs under this group. */
  readonly root = new THREE.Group();
  private readonly districts = new Map<number, District>();
  private readonly skyline = new Skyline();
  private timer = 0;
  private lastRank = 0;
  private lastPopulation = -1;

  constructor(protected readonly ctx: GameContext) {
    this.root.name = 'city';
    ctx.scene.add(this.root);
    this.root.add(this.skyline.group);
    // a save written with the last bundle still flying holds a fully paid, never-completed lot: finish it silently
    ctx.state.stats.cityBuilt += settlePaidCity(ctx.state);
    this.openDistricts(true);
    ctx.events.on('era:unlocked', () => {
      this.openDistricts(false);
      this.recompute(true);
    });
    ctx.events.on('village:changed', () => this.recompute(true));
    this.lastRank = rankFor(this.totalPopulation, ctx.state.eras.age);
    this.recompute(false);
  }

  /** Residents of every district (not counting the village / Market Town). */
  get population(): number {
    return cityTotals(this.ctx.state.city).residents;
  }

  /** Whole settlement: village + Market Town + districts. */
  get totalPopulation(): number {
    return this.ctx.state.village.population + this.population;
  }

  /** Index into CITY_RANKS. */
  get rank(): number {
    return rankFor(this.totalPopulation, this.ctx.state.eras.age);
  }

  /** Name of the current rank ("Metropolis"). */
  get rankName(): string {
    return CITY_RANKS[this.rank]!.name;
  }

  /** City income per second right now (rent + staffed businesses, × happiness × City Hall). */
  get incomeRate(): number {
    return incomePerSecond(cityTotals(this.ctx.state.city), this.ctx.upgrades.value('taxOffice'));
  }

  /** The district of era n, once it is open. */
  district(n: number): District | null {
    return this.districts.get(n) ?? null;
  }

  /** Skyline towers standing now (tests / debug). */
  get skylineTowers(): number {
    return this.skyline.towers;
  }

  /** Debug / tests: building `id` on lot `lot` of district n, fully built. False if the district is closed / bad ids. */
  build(n: number, lot: number, id: string, instant = true): boolean {
    const def = CITY_BUILDINGS[id as CityBuildingId];
    if (!def || def.era !== n || n < 2 || n > MAX_ERA || this.ctx.state.eras.age < n) return false;
    this.openDistricts(true);
    const d = this.districts.get(n);
    if (!d || lot < 0 || lot >= d.size) return false;
    d.activate();
    return d.debugBuild(lot, def.id, instant);
  }

  update(dt: number): void {
    for (const d of this.districts.values()) d.update(dt);
    this.timer += dt;
    while (this.timer >= CITY_TICK) {
      this.timer -= CITY_TICK;
      this.pay();
    }
  }

  // ---- internals -------------------------------------------------------------------------------------------
  /** Open every district whose era is reached (silently for a restore). */
  private openDistricts(_silent: boolean): void {
    const age = this.ctx.state.eras.age;
    for (let n = 2; n <= MAX_ERA; n++) {
      if (age < n || this.districts.has(n) || !DISTRICTS[n]) continue;
      const d = new District(this.ctx, n, () => this.recompute(true));
      this.districts.set(n, d);
      this.root.add(d.root);
    }
  }

  /** Credit one tick of income. */
  private pay(): void {
    const t = cityTotals(this.ctx.state.city);
    const split = incomeSplit(t, this.ctx.upgrades.value('taxOffice'));
    const amount = Math.round(split.total * CITY_TICK);
    if (amount < 1) return;
    this.ctx.economy.add(amount);
    this.ctx.state.stats.cityEarned += amount;
    this.ctx.events.emit('income', { source: split.business > 0 ? 'business' : 'rent', amount, position: null });
  }

  /** Population / rank / skyline follow the state; emit the events when `announce`. */
  private recompute(announce: boolean): void {
    const ctx = this.ctx;
    const total = this.totalPopulation;
    const rank = rankFor(total, ctx.state.eras.age);
    this.skyline.setSize(total, ctx.state.eras.age);
    if (announce) {
      if (rank > this.lastRank) ctx.events.emit('city:rankUp', { rank, name: CITY_RANKS[rank]!.name, position: null });
      if (rank !== this.lastRank || total !== this.lastPopulation) ctx.events.emit('city:changed', { population: total, rank });
    }
    this.lastRank = rank;
    this.lastPopulation = total;
  }
}
