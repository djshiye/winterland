/**
 * Thrown when restoring a save (merge / sanitize / migrate) fails at startup. main.ts sets a save aside (recoverFromBadSave)
 * only for this: a render or asset failure that has nothing to do with the save leaves it untouched.
 */
export class SaveLoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'SaveLoadError';
    this.cause = cause;
  }
}

/** Run a save-restoring step; anything it throws is tagged as a SaveLoadError. */
export function restoringSave<T>(step: () => T): T {
  try {
    return step();
  } catch (err) {
    throw err instanceof SaveLoadError ? err : new SaveLoadError(err);
  }
}
