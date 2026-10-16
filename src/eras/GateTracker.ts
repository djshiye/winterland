/**
 * [MAIN] Computed 'gate:progress' (docs/EXPANSION.md §C "Event"): watches the next era's gate and announces when it
 * moves. Nothing is saved: the state is the truth, so a restored save seeds the tracker silently.
 *
 * - Marked dirty by 'upgrade:bought', 'settlement:changed', 'machine:built', 'pad:unlocked', 'quarters:built',
 *   'village:changed' (the Great Lodge opens the climb) and 'era:unlocked' (the next gate starts).
 * - update() re-counts once per frame at most (gateCount, no prices), so a frame that finishes several rows (a city
 *   build that also meets the settlement, a debug jump) is ONE event with `gained` = the rows it finished.
 * - Emits only on a change of the counts, and only once the climb is open with a next era to reach. A new era resets
 *   the baseline without an event (its rows start from wherever the upgrades already are).
 */
import type { GameContext } from '../core/types';
import { climbOpen, gateCount, type GateCount } from './gate';

export class GateTracker {
  private era = 0;
  private last: GateCount | null = null;
  private dirty = true;

  constructor(private readonly ctx: GameContext) {
    const mark = (): void => {
      this.dirty = true;
    };
    const ev = ctx.events;
    ev.on('upgrade:bought', mark);
    ev.on('settlement:changed', mark);
    ev.on('machine:built', mark);
    ev.on('pad:unlocked', mark);
    ev.on('quarters:built', mark);
    ev.on('village:changed', mark);
    ev.on('era:unlocked', mark);
    this.seed();
    ctx.addUpdatable(this);
  }

  /** Baseline from the state as it is (load, a new era): no event. */
  private seed(): void {
    const s = this.ctx.state;
    this.era = s.eras.age + 1;
    this.last = climbOpen(s) ? gateCount(s, this.era) : null;
    this.dirty = false;
  }

  update(_dt: number): void {
    if (!this.dirty) return;
    this.dirty = false;
    const s = this.ctx.state;
    if (s.eras.age + 1 !== this.era) {
      this.seed();
      return;
    }
    if (!climbOpen(s)) return;
    const now = gateCount(s, this.era);
    const prev = this.last;
    this.last = now;
    if (now.total === 0) return; // past the last era
    if (prev && now.ok === prev.ok && now.settlement === prev.settlement && now.ready === prev.ready) return;
    this.ctx.events.emit('gate:progress', {
      era: this.era,
      ok: now.ok,
      total: now.total,
      gained: Math.max(0, now.ok - (prev?.ok ?? now.ok)),
      settlement: now.settlement,
      settlementNeed: now.settlementNeed,
      ready: now.ready,
      readyNow: now.ready && !(prev?.ready ?? false),
    });
  }
}
