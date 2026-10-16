/**
 * [PURE] The game's version (package.json, injected by vite.config.ts as __GAME_VERSION__) and x.y.z comparison.
 * Every save carries the version that wrote it (SaveData.game), so a save from a newer build is spotted before an
 * older build overwrites the parts it does not know about.
 */
declare const __GAME_VERSION__: string | undefined;

export const GAME_VERSION: string = typeof __GAME_VERSION__ === 'string' ? __GAME_VERSION__ : '0.0.0';

/** x.y.z → [x, y, z], or null for anything else (the updater and releases only use 3-part versions). */
export function parseVersion(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `a` is a strictly newer x.y.z than `b` (false when either is not a version). */
export function isNewerVersion(a: unknown, b: unknown): boolean {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}
