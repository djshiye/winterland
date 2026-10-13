/** Minimal typed event emitter. */
export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<(payload: never) => void>>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as (payload: never) => void);
    return () => this.off(type, fn);
  }

  once<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof E>(type: K, fn: (payload: E[K]) => void): void {
    this.handlers.get(type)?.delete(fn as (payload: never) => void);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) {
      try {
        (fn as (payload: E[K]) => void)(payload);
      } catch (err) {
        console.error(`[events] handler for "${String(type)}" threw`, err);
      }
    }
  }
}
