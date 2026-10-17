/**
 * 0.9.8 [17] The rendered instrument buffers, made on first use and kept for the session (fx/music/instruments.ts).
 * About 2.4 MB for every instrument at once; a theme uses 4 to 7 of them. `warm(ids)` renders a theme's set ahead of
 * time, a few per idle moment, so walking into a new era never stalls a frame on rendering.
 */
import { INSTRUMENTS, SAMPLE_RATE, renderInstrument, type InstrumentId } from './instruments';

export class SampleBank {
  private readonly buffers = new Map<InstrumentId, AudioBuffer>();

  constructor(private readonly ac: BaseAudioContext) {}

  /** The buffer of an instrument (rendered now if it isn't yet). */
  get(id: InstrumentId): AudioBuffer {
    let b = this.buffers.get(id);
    if (!b) {
      const data = renderInstrument(id);
      b = this.ac.createBuffer(1, data.length, SAMPLE_RATE);
      b.getChannelData(0).set(data);
      this.buffers.set(id, b);
    }
    return b;
  }

  has(id: InstrumentId): boolean {
    return this.buffers.has(id);
  }

  /** Render these in the background, one per idle callback (or timer where there is none). */
  warm(ids: readonly InstrumentId[]): void {
    const todo = ids.filter((id, i) => !this.buffers.has(id) && ids.indexOf(id) === i);
    const step = (): void => {
      const id = todo.shift();
      if (!id) return;
      try {
        this.get(id);
      } catch {
        /* never break the game */
      }
      if (todo.length) later(step);
    };
    if (todo.length) later(step);
  }

  /** Play rate for a MIDI note on an instrument. */
  static rate(id: InstrumentId, midi: number): number {
    const def = INSTRUMENTS[id];
    return def.unpitched ? 1 : Math.pow(2, (midi - def.ref) / 12);
  }
}

function later(fn: () => void): void {
  const w = globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 60);
}
