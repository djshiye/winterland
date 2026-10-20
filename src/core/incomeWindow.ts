/**
 * [0.9.6] A rolling sales rate for rewards that should feel the same in every era (core/Contracts.ts era contracts,
 * core/quests.ts rewards from era 2 on): dollars per second over the last few minutes of play, from the same 'sale'
 * events the SalesMeter reads (Jack's discards left out). Fed by `add`, advanced by `tick(dt)`; pure, no DOM.
 */

/** Seconds per bucket and buckets kept (5 minutes). */
export const INCOME_BUCKET = 10;
export const INCOME_BUCKETS = 30;

export class IncomeWindow {
  private readonly buckets: number[] = [0];
  private clock = 0;
  private played = 0;

  /** `carried`: a rate ($/s) from before this session that fills the part of the window not played yet (0.9.12, E4). */
  constructor(private readonly carried = 0) {}

  add(amount: number): void {
    if (Number.isFinite(amount) && amount > 0) this.buckets[this.buckets.length - 1]! += amount;
  }

  tick(dt: number): void {
    if (!(dt > 0)) return;
    this.played += dt;
    this.clock += dt;
    while (this.clock >= INCOME_BUCKET) {
      this.clock -= INCOME_BUCKET;
      this.buckets.push(0);
      if (this.buckets.length > INCOME_BUCKETS) this.buckets.shift();
    }
  }

  /** Dollars per second over what has been played of the window (at least one bucket long, so a burst never spikes it). */
  get rate(): number {
    const sum = this.buckets.reduce((a, b) => a + b, 0);
    const window = INCOME_BUCKET * INCOME_BUCKETS;
    const carried = Number.isFinite(this.carried) && this.carried > 0 ? this.carried : 0;
    if (carried > 0 && this.played < window) return (sum + carried * (window - this.played)) / window;
    return sum / Math.max(INCOME_BUCKET, Math.min(this.played, window));
  }
}

/** Round to two significant digits ($1,234,567 → $1,200,000), so rewards read cleanly. */
export function sig2Money(n: number): number {
  if (!(n > 0)) return 0;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}
