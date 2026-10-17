/**
 * [B4] AutoQuality: 0.9.8 steps one tier down after 8 s under 40 fps and back up after 20 s at ~60 fps (never into a
 * tier it left for being slow), skipping warm-up, hidden tab, manual / noauto / webdriver.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoQuality } from '../src/ui/AutoQuality';

let now = 0;
let store: Record<string, string> = {};
let search = '';
let webdriver = false;
const doc = { hidden: false, addEventListener: () => undefined };

function setup(quality: 'high' | 'medium' | 'low' = 'high') {
  const renderer = { quality: quality as string, setQuality: vi.fn((q: string) => void (renderer.quality = q)) };
  const notify = vi.fn();
  const ctx = { renderer } as never;
  const aq = new AutoQuality(ctx, notify);
  return { aq, setQuality: renderer.setQuality, notify, renderer };
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
  it('steps down one tier after 8 s under 40 fps (after the 5 s warm-up), then again', () => {
    const { aq, setQuality, notify } = setup();
    run(aq, 5, 50); // warm-up
    run(aq, 7, 50); // 20 fps, not long enough yet
    expect(setQuality).not.toHaveBeenCalled();
    run(aq, 2, 50);
    expect(setQuality).toHaveBeenLastCalledWith('medium');
    expect(notify).toHaveBeenLastCalledWith('medium', false);
    expect(store['winterland:autoQuality']).toBe('medium');
    run(aq, 3, 50); // settling after the change: not judged yet
    expect(setQuality).toHaveBeenCalledTimes(1);
    run(aq, 10, 50);
    expect(setQuality).toHaveBeenLastCalledWith('low');
    run(aq, 30, 50);
    expect(setQuality).toHaveBeenCalledTimes(2); // nothing below Low
  });

  it('steps back up after 20 s of smooth frames, but never into a tier it left for being slow', () => {
    const { aq, setQuality, renderer } = setup('low');
    run(aq, 5.5, 16);
    run(aq, 21, 16);
    expect(setQuality).toHaveBeenLastCalledWith('medium');
    expect(renderer.quality).toBe('medium');
    run(aq, 25, 16);
    expect(setQuality).toHaveBeenLastCalledWith('high');
    run(aq, 13, 50); // too slow on High
    expect(setQuality).toHaveBeenLastCalledWith('medium');
    run(aq, 60, 16); // smooth again: stays on Medium
    expect(renderer.quality).toBe('medium');
    expect(setQuality).toHaveBeenCalledTimes(3);
  });

  it('judges against the Frame rate setting (a 30 fps cap is not slow)', () => {
    store['winterland:fps'] = '30';
    const { aq, setQuality } = setup();
    run(aq, 5.5, 34);
    run(aq, 30, 34);
    expect(setQuality).not.toHaveBeenCalled();
  });

  it('does not change at a steady in-between rate, and a good bucket restarts the streak', () => {
    const { aq, setQuality } = setup();
    run(aq, 5.5, 20); // 50 fps: neither slow nor smooth enough to step up
    run(aq, 40, 20);
    expect(setQuality).not.toHaveBeenCalled();
    run(aq, 6, 50);
    run(aq, 1, 20);
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
    ['hand-set quality from before', () => (store['winterland:quality'] = 'high')],
  ])('never runs with %s', (_name, arrange) => {
    arrange();
    const { aq, setQuality } = setup();
    run(aq, 40, 50);
    run(aq, 40, 16);
    expect(setQuality).not.toHaveBeenCalled();
  });

  it("keeps running after its own earlier choice (0.9.7's one-way 'low' included)", () => {
    store['winterland:autoQuality'] = 'low';
    store['winterland:quality'] = 'low';
    const { aq, setQuality } = setup('low');
    run(aq, 5.5, 16);
    run(aq, 21, 16);
    expect(setQuality).toHaveBeenLastCalledWith('medium');
  });

  it('yields if the player picks quality meanwhile', () => {
    const { aq, setQuality } = setup();
    run(aq, 9, 50);
    store['winterland:autoQuality'] = 'manual';
    run(aq, 20, 50);
    expect(setQuality).not.toHaveBeenCalled();
  });
});
