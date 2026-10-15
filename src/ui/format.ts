/** [B4] Number / time formatting shared by the HUD panels and the juice. */

/** Compact tiers, largest first. */
const TIERS: readonly [number, string][] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
];

/**
 * "$12,500" below a million, compact above: "$1M", "$1.25M", "$12.5M", "$125M", "$1.2B", "$3T". Three significant
 * digits, trailing zeros dropped only after a decimal point, and a value that rounds up to 1000 of a tier moves to the
 * next one ("$999.5M" -> "$1B"). Negative values keep their sign; NaN / Infinity show "$0".
 */
export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  const n = Math.abs(Math.round(value));
  const sign = value < 0 && n > 0 ? '-' : '';
  if (n < 1_000_000) return `${sign}$${n.toLocaleString('en-US')}`;
  for (let t = 0; t < TIERS.length; t++) {
    const [unit, suffix] = TIERS[t]!;
    if (n < unit) continue;
    const v = n / unit;
    const s = v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0);
    if (Number(s) >= 1000 && t > 0) return `${sign}$1${TIERS[t - 1]![1]}`;
    return `${sign}$${s.includes('.') ? s.replace(/\.?0+$/, '') : s}${suffix}`;
  }
  return `${sign}$${n.toLocaleString('en-US')}`;
}

/** Plain count with thousands separators ("12,345"). */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** "1 h 20 min", "45 min", "30 s". Hours and minutes only above a minute. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const totalMin = Math.round(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
