import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { fullscreenOptions, isFullscreenKey } = require('../desktop/window-options.cjs') as {
  fullscreenOptions(mode: string): Record<string, unknown>;
  isFullscreenKey(input: Record<string, unknown>, platform: string): boolean;
};

describe('desktop fullscreen (0.9.3 Mac fix)', () => {
  it('never passes fullscreen: false, which disables fullscreen on macOS', () => {
    expect(fullscreenOptions('windowed')).not.toHaveProperty('fullscreen');
    expect(fullscreenOptions('windowed').fullscreenable).toBe(true);
    expect(fullscreenOptions('fullscreen')).toEqual({ fullscreen: true, fullscreenable: true });
  });

  it('F11 and Alt+Enter toggle on every platform', () => {
    for (const p of ['linux', 'win32', 'darwin']) {
      expect(isFullscreenKey({ key: 'F11' }, p)).toBe(true);
      expect(isFullscreenKey({ key: 'Enter', alt: true }, p)).toBe(true);
      expect(isFullscreenKey({ key: 'Enter' }, p)).toBe(false);
    }
  });

  it('Ctrl+Cmd+F toggles on macOS only', () => {
    expect(isFullscreenKey({ key: 'f', control: true, meta: true }, 'darwin')).toBe(true);
    expect(isFullscreenKey({ key: 'f', meta: true }, 'darwin')).toBe(false);
    expect(isFullscreenKey({ key: 'f', control: true, meta: true }, 'win32')).toBe(false);
  });
});
