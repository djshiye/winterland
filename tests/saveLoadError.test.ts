import { describe, expect, it } from 'vitest';
import { restoringSave, SaveLoadError } from '../src/core/saveLoadError';

describe('restoringSave', () => {
  it('tags a failure while restoring as a SaveLoadError and passes results through', () => {
    expect(restoringSave(() => 5)).toBe(5);
    const boom = new Error('bad field');
    try {
      restoringSave(() => {
        throw boom;
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SaveLoadError);
      expect((e as Error).message).toBe('bad field');
      expect((e as Error).cause).toBe(boom);
    }
  });
  it('an error from elsewhere is not a SaveLoadError', () => {
    expect(new Error('render failed')).not.toBeInstanceOf(SaveLoadError);
  });
});
