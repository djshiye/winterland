/**
 * [T4 — wave 9] Eras: the settlement-wide visual upgrades that follow the village level (VILLAGE.levels:
 * Camp → Hamlet → Village → Town → Winter City → Winterland).
 *
 * - `eraFor(level)` is a PURE table (no three / DOM) saying which lamps, street surface and decorations a level has.
 * - Scenery builders (env/village.ts, env/town.ts) build EVERY variant once at construction and `registerEra()` one
 *   switcher that only toggles `.visible` flags. `applyEra()` (driven by EraController from 'village:changed') calls
 *   them. Nothing is rebuilt per frame; late registrations (the Village is constructed after the Environment) are
 *   brought up to date at once. This is the same registry pattern as env/glow.ts.
 * - EraController (owned by Environment) also scatters the Winterland sparkle.
 */
import * as THREE from 'three';
import { VILLAGE } from '../../config';
import type { GameContext } from '../../core/types';
import { twinkleBulbs } from './glow';

export type LampKind = 'torch' | 'lantern' | 'iron';
export type SurfaceKind = 'snow' | 'gravel' | 'cobble';

export interface EraLook {
  /** Village level (clamped to VILLAGE.levels). */
  level: number;
  /** Lamps along the village street, the corridor and the square: torches → lanterns → iron street lamps. */
  lamp: LampKind;
  /** The village street surface: snow track → gravel → cobbles. */
  surface: SurfaceKind;
  /** Flag bunting between the lamps (Town, level 3). */
  bunting: boolean;
  /** Festive string lights + wreaths (Winter City, level 4). */
  festive: boolean;
  /** Extra sparkle in the air (Winterland, level 5). */
  sparkle: boolean;
}

/** What the settlement looks like at village level `level`. Pure. */
export function eraFor(level: number): EraLook {
  const max = VILLAGE.levels.length - 1;
  const lv = Math.max(0, Math.min(max, Math.floor(Number.isFinite(level) ? level : 0)));
  return {
    level: lv,
    lamp: lv <= 1 ? 'torch' : lv === 2 ? 'lantern' : 'iron',
    surface: lv <= 1 ? 'snow' : lv === 2 ? 'gravel' : 'cobble',
    bunting: lv >= 3,
    festive: lv >= 4,
    sparkle: lv >= 5,
  };
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Roman numeral for 1..10 (0 and out-of-range give ''). */
export function romanNumeral(n: number): string {
  return ROMAN[Math.floor(n)] ?? '';
}

/** "Era III · Town" for a village level; the starting Camp has no era number and is just "Camp". */
export function eraLabel(level: number): string {
  const lv = Math.max(0, Math.min(VILLAGE.levels.length - 1, Math.floor(level)));
  const name = VILLAGE.levels[lv]!.name;
  return lv === 0 ? name : `Era ${romanNumeral(lv)} · ${name}`;
}

// ---------------------------------------------------------------------------
// Registry (module level, like env/glow.ts)
// ---------------------------------------------------------------------------

type EraListener = (look: EraLook) => void;
const listeners: EraListener[] = [];
let current: EraLook | null = null;

/** Register a view switcher. It is called at once if an era is already applied. Returns an unregister function. */
export function registerEra(fn: EraListener): () => void {
  listeners.push(fn);
  if (current) fn(current);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** Switch every registered view to village level `level`. Cheap (visibility flags); a no-op when nothing changed. */
export function applyEra(level: number): EraLook {
  const look = eraFor(level);
  if (current && current.level === look.level) return current;
  current = look;
  for (const fn of listeners) fn(look);
  return look;
}

/** The era last applied (null before the first applyEra). */
export function currentEra(): EraLook | null {
  return current;
}

/** Forget everything (tests, a new Environment in the same page). */
export function resetEras(): void {
  listeners.length = 0;
  current = null;
}

// ---------------------------------------------------------------------------
// Sparkle spots (lamp heads / arches the Winterland sparkle drifts around)
// ---------------------------------------------------------------------------

const sparkleSpots: Array<[number, number, number]> = [];

/** Scenery builders register a place where Winterland sparkle appears (world x, y, z). */
export function addSparkleSpot(x: number, y: number, z: number): void {
  sparkleSpots.push([x, y, z]);
}

/** Drives the era views from the village level and scatters sparkle at level 5. Owned by the Environment. */
export class EraController {
  private sparkleTimer = 0;
  private time = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly ctx: GameContext) {
    applyEra(ctx.state.village.level);
    ctx.events.on('village:changed', (e) => {
      applyEra(e.level);
    });
  }

  get look(): EraLook {
    return currentEra() ?? eraFor(this.ctx.state.village.level);
  }

  update(dt: number): void {
    this.time += dt;
    twinkleBulbs(this.time);
    if (!currentEra()?.sparkle || sparkleSpots.length === 0) return;
    this.sparkleTimer -= dt;
    if (this.sparkleTimer > 0) return;
    this.sparkleTimer = 0.16 + Math.random() * 0.2;
    const s = sparkleSpots[(Math.random() * sparkleSpots.length) | 0]!;
    this.tmp.set(s[0] + (Math.random() - 0.5) * 1.4, s[1] + (Math.random() - 0.3) * 1.2, s[2] + (Math.random() - 0.5) * 1.4);
    this.ctx.particles.sparkle(this.tmp, Math.random() < 0.5 ? 0xfff2b0 : 0xbfe8ff);
  }
}
