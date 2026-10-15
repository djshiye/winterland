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
 * - Settlement 6..50 (docs/EXPANSION.md §B): after every city / machine build or demolish and every era, the saved
 *   best level is raised to what the city population reaches (core/demand.ts refreshSettlement). A new level emits
 *   'settlement:changed' and 'settlement:levelUp' (never while loading) and pays a gift into the walk-collect gift
 *   pile on the city avenue: SETTLEMENT.giftSeconds of city income per level, + charterSeconds for a completed band.
 *   City income is × Renown × Mastery (climbMult) and its happiness gets the decor perk (settlementHappiness).
 */
import * as THREE from 'three';
import { ECONOMY, SETTLEMENT } from '../config';
import { CITY_BUILDINGS, CITY_RANKS, CITY_TICK, DISTRICTS, MAX_ERA, districtDef, type CityBuildingId } from '../eras/data';
import { cityPopulation, climbMult, refreshSettlement, settledCityTotals, settlementBand, settlementLevel } from '../core/demand';
import type { GameContext } from '../core/types';
import { CashPile } from '../stations/CashPile';
import { Skyline } from '../world/env/skyline';
import { District } from './District';
import { cityTotals, incomeSplit, rankFor, settlePaidCity } from './rules';

export class City {
  /** Everything the city draws hangs under this group. */
  readonly root = new THREE.Group();
  private readonly districts = new Map<number, District>();
  private readonly skyline = new Skyline();
  private timer = 0;
  private lastRank = 0;
  /** Highest rank announced this session: a demolish / rebuild across a threshold must not replay the banner. */
  private maxRank = 0;
  private lastPopulation = -1;
  /** Settlement level last seen (settlementLevel), so a rise is announced once. */
  private lastSettlement = 0;
  /** The settlement gift pile, made the first time it is needed (a gift or a restored save). */
  private gift: CashPile | null = null;

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
    // machine staff count toward the city population (settlement levels)
    ctx.events.on('machine:built', () => this.recompute(true));
    ctx.events.on('machine:demolished', () => this.recompute(true));
    refreshSettlement(ctx.state);
    this.lastSettlement = settlementLevel(ctx.state);
    this.lastRank = rankFor(this.totalPopulation, ctx.state.eras.age);
    this.maxRank = this.lastRank;
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

  /** City income per second right now (rent + staffed businesses, × happiness × City Hall × Renown × Mastery). */
  get incomeRate(): number {
    return incomeSplit(settledCityTotals(this.ctx.state), this.ctx.upgrades.value('taxOffice')).total * climbMult(this.ctx.state);
  }

  /** Dollars waiting on the settlement gift pile (save snapshot). */
  get giftValue(): number {
    return this.gift?.value ?? 0;
  }

  /** Restoring a save: put the uncollected settlement gift back on its pile. */
  restoreGift(value: number): void {
    if (value > 0) this.giftPile().restoreValue(value);
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
    // the gift pile only draws while something is on it
    if (this.gift) this.gift.pile.root.visible = this.gift.value > 0;
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
    const split = incomeSplit(settledCityTotals(this.ctx.state), this.ctx.upgrades.value('taxOffice'));
    const amount = Math.round(split.total * CITY_TICK * climbMult(this.ctx.state));
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
      if (rank > this.maxRank) ctx.events.emit('city:rankUp', { rank, name: CITY_RANKS[rank]!.name, position: null });
      if (rank !== this.lastRank || total !== this.lastPopulation) ctx.events.emit('city:changed', { population: total, rank });
    }
    this.lastRank = rank;
    this.maxRank = Math.max(this.maxRank, rank);
    this.lastPopulation = total;
    this.recomputeSettlement(announce);
  }

  /** Raise the saved settlement to the city's population; announce a new level and pay its gift when `announce`. */
  private recomputeSettlement(announce: boolean): void {
    const ctx = this.ctx;
    refreshSettlement(ctx.state);
    const level = settlementLevel(ctx.state);
    const from = this.lastSettlement;
    if (level === from) return;
    this.lastSettlement = level;
    ctx.events.emit('settlement:changed', { level, cityPopulation: cityPopulation(ctx.state) });
    if (!announce || level <= from || level <= SETTLEMENT.band) return;
    // every level crossed is a gift; a level that completes its band (j = 5) is a Charter
    let seconds = 0;
    let charter = false;
    for (let L = Math.max(from, SETTLEMENT.band) + 1; L <= level; L++) {
      seconds += SETTLEMENT.giftSeconds;
      if (L % SETTLEMENT.band === 0) {
        seconds += SETTLEMENT.charterSeconds;
        charter = true;
      }
    }
    // whole cash bundles, so the pile holds exactly what the card announces
    const b = ECONOMY.cashBundleValue;
    const gift = Math.max(SETTLEMENT.giftMin, Math.round((this.incomeRate * seconds) / b) * b);
    const district = districtDef(Math.min(MAX_ERA, settlementBand(level))).rect;
    const position = new THREE.Vector3((district.minX + district.maxX) / 2, 0, (district.minZ + district.maxZ) / 2);
    const pile = this.giftPile();
    pile.pay(gift, new THREE.Vector3(pile.opts.x, 6, pile.opts.z));
    ctx.events.emit('settlement:levelUp', { level, from, gift, charter, position });
  }

  private giftPile(): CashPile {
    if (!this.gift) {
      const g = SETTLEMENT.giftPile;
      this.gift = new CashPile(this.ctx, { id: 'pile:settlementGift', x: g.x, z: g.z, grid: g.grid, zone: g.zone });
    }
    return this.gift;
  }
}
