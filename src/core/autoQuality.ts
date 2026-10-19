/**
 * Whether automatic graphics quality runs this session (ui/AutoQuality.ts has the rules). Shared with the Renderer,
 * which keeps screen edge smoothing available when Auto may drop the game to Low mid-play (0.9.11).
 */
export const AUTO_QUALITY_KEY = 'winterland:autoQuality';
const QUALITY_KEY = 'winterland:quality';

export function autoQualityOn(): boolean {
  try {
    if (new URLSearchParams(location.search).has('noauto')) return false;
    if ((navigator as Navigator & { webdriver?: boolean }).webdriver) return false;
    const mark = localStorage.getItem(AUTO_QUALITY_KEY);
    if (mark === 'manual') return false; // chosen by hand
    if (mark === null && localStorage.getItem(QUALITY_KEY) !== null) return false; // a hand-set quality from before the marker existed
  } catch {
    /* storage unavailable: still fine to run, nothing to read */
  }
  return true;
}
