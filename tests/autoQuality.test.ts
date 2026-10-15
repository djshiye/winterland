/** [B4] AutoQuality: one-way drop to Low after 8 s under 40 fps, skipping warm-up, hidden tab, manual / noauto / webdriver. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoQuality } from '../src/ui/AutoQuality';

let now = 0;
let store: Record<string, string> = {};
let search = '';
let webdriver = false;
const doc = { hidden: false, addEventListener: () => undefined };

function setup(quality: 'high' | 'low' = 'high') {
  const setQuality = vi.fn();
  const notify = vi.fn();
  const ctx = { renderer: { quality, setQuality } } as never;
  const aq = new AutoQuality(ctx, notify);
  return { aq, setQuality, notify };
}

/** Run frames of `ms` each for `seconds` of real time. */
function run(aq: AutoQuality, seconds: number, ms: number): void {
  const n = Math.round((seconds * 1000) / ms);
  for (let i = 0; i < n; i++) {
    now += ms;
    aq.update();
  }
}

beforeEach(() => {
  now = 1000;
  store = {};
  search = '';
  webdriver = false;
  doc.hidden = false;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  });
  vi.stubGlobal('location', {
    get search() {
      return search;
    },
  });
  vi.stubGlobal('navigator', {
    get webdriver() {
      return webdriver;
    },
  });
  vi.stubGlobal('document', doc);
});

afterEach(() => vi.unstubAllGlobals());

describe('AutoQuality', () => {
  it('switches to Low once after 8 s under 40 fps (after the 5 s warm-up)', () => {
    const { aq, setQuality, notify } = setup();
    run(aq, 5, 50); // warm-up
    run(aq, 7, 50); // 20 fps, not long enough yet
    expect(setQuality).not.toHaveBeenCalled();
    run(aq, 2, 50);
    expect(setQuality).toHaveBeenCalledWith('low');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(store['winterland:autoQuality']).toBe('low');
    run(aq, 30, 50);
    expect(setQuality).toHaveBeenCalledTimes(1); // one shot
  });

  it('does not fire at 60 fps, and a good bucket restarts the streak', () => {
    const { aq, setQuality } = setup();
    run(aq, 5.5, 16);
    run(aq, 30, 16);
    expect(setQuality).not.toHaveBeenCalled();
    run(aq, 6, 50);
    run(aq, 1, 16);
    run(aq, 6, 50);
    expect(setQuality).not.toHaveBeenCalled();
  });

  it('ignores pauses and fast-forward bursts', () => {
    const { aq, setQuality } = setup();
    run(aq, 6, 50);
    for (let i = 0; i < 50; i++) {
      now += 2500; // paused: huge gaps
      aq.update();
    }
    for (let i = 0; i < 2000; i++) {
      now += 2; // simulate(): updates back to back
      aq.update();
    }
    expect(setQuality).not.toHaveBeenCalled();
  });

  it('skips while the tab is hidden', () => {
    const { aq, setQuality } = setup();
    run(aq, 6, 50);
    doc.hidden = true;
    run(aq, 20, 50);
    expect(setQuality).not.toHaveBeenCalled();
  });

  it.each([
    ['?noauto', () => (search = '?fresh&noauto')],
    ['webdriver', () => (webdriver = true)],
    ['manual choice', () => (store['winterland:autoQuality'] = 'manual')],
    ['already decided', () => (store['winterland:autoQuality'] = 'low')],
    ['hand-set quality from before', () => (store['winterland:quality'] = 'high')],
  ])('never runs with %s', (_name, arrange) => {
    arrange();
    const { aq, setQuality } = setup();
    run(aq, 40, 50);
    expect(setQuality).not.toHaveBeenCalled();
  });

  it('never runs when already on Low, and yields if the player picks quality meanwhile', () => {
    const low = setup('low');
    run(low.aq, 40, 50);
    expect(low.setQuality).not.toHaveBeenCalled();
    const { aq, setQuality } = setup();
    run(aq, 9, 50);
    store['winterland:autoQuality'] = 'manual';
    run(aq, 20, 50);
    expect(setQuality).not.toHaveBeenCalled();
  });
});
