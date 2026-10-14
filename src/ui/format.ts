/** [B4] Number / time formatting shared by the HUD panels and the juice. */

/** "$12,500", compact above a million: "$1.25M", "$12.5M", "$125M", "$1.2B". Negative values keep their sign. */
export function formatMoney(value: number): string {
  const neg = value < 0;
  const n = Math.abs(Math.round(value));
  const sign = neg ? '-' : '';
  if (n < 1_000_000) return `${sign}$${n.toLocaleString('en-US')}`;
  const compact = (v: number, suffix: string): string => {
    const d = v < 10 ? 2 : v < 100 ? 1 : 0;
    const s = v.toFixed(d).replace(/\.?0+$/, '');
    return `${sign}$${s}${suffix}`;
  };
  if (n < 1_000_000_000) return compact(n / 1_000_000, 'M');
  return compact(n / 1_000_000_000, 'B');
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
