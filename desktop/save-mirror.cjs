/**
 * 0.9.10 (READINESS A5): a copy of the save on disk, next to Electron's own data (the user-data folder:
 * ~/.config/Winterland on Linux, %APPDATA%\Winterland on Windows, ~/Library/Application Support/Winterland on macOS).
 * The game's real save stays in localStorage; this copy is there for the day that store is lost or unreadable, when
 * the game offers to bring it back (src/game/Game.ts, the save notices).
 *
 * Kept free of Electron so tests can run it against a temporary folder. It only ever touches its own files:
 *   save.json      the latest copy
 *   save.json.bak  the copy as it was when this session started (one older generation)
 *   save.json.tmp  a write in progress (written, flushed to disk, then renamed over save.json, so a power cut leaves
 *                  either the old copy or the new one, never half of one)
 *   save.json.replaced-<ms>, save.json.bak.replaced-<ms>
 *                  copies moved aside, never deleted, before a different game is copied here (the player started
 *                  fresh, or the copy held something the game couldn't open or later progress than its own save)
 * The page decides whether a copy may be written at all (src/core/Save.ts setMirrorWrites): never while the copy on
 * disk holds a game the player hasn't chosen about yet, and only after a copy holding a different game is set aside.
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = 'save.json';
/** Larger texts are not a Winterland save (a late-game save is about 30 KB). */
const MAX_BYTES = 8 * 1024 * 1024;

/** True for text that looks like a save: a JSON object with a `state` object. The page checks the rest. */
function looksLikeSave(text) {
  if (typeof text !== 'string' || text.length === 0 || Buffer.byteLength(text, 'utf8') > MAX_BYTES) return false;
  try {
    const d = JSON.parse(text);
    return !!d && typeof d === 'object' && !Array.isArray(d) && !!d.state && typeof d.state === 'object';
  } catch {
    return false;
  }
}

function readSmall(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Write `text` to `file` atomically: a temp file in the same folder, flushed, then renamed over it. */
function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/**
 * The mirror in `dir`. `offer(text)` hands it the newest save (kept in memory, cheap); `flush()` writes the newest
 * one to disk if it changed. The first write of a session first copies the save.json it found into save.json.bak.
 */
function createMirror(dir) {
  const file = path.join(dir, FILE);
  const bak = `${file}.bak`;
  let pending = null;
  let rotated = false;

  return {
    file,
    /** Both copies on disk as text (null when missing or too big); the page parses them. */
    read() {
      return { save: readSmall(file), bak: readSmall(bak) };
    },
    /** Remember the newest save; false (and nothing kept) when the text is not a save. */
    offer(text) {
      if (!looksLikeSave(text)) return false;
      pending = text;
      return true;
    },
    /**
     * Move save.json and save.json.bak aside (renamed, never deleted) and forget anything not yet written, so the
     * next write starts a new copy. True when both are aside or weren't there.
     */
    setAside(now) {
      const stamp = Number.isFinite(now) ? Math.floor(now) : Date.now();
      pending = null;
      rotated = true; // nothing left to keep in .bak this session
      let ok = true;
      for (const f of [file, bak]) {
        try {
          if (fs.existsSync(f)) fs.renameSync(f, `${f}.replaced-${stamp}`);
        } catch {
          ok = false;
        }
      }
      return ok;
    },
    /** Write the remembered save, if any. True when it is on disk (or there was nothing new to write). */
    flush() {
      if (pending === null) return true;
      const text = pending;
      try {
        fs.mkdirSync(dir, { recursive: true });
        if (!rotated) {
          const old = readSmall(file);
          if (old !== null && old !== text) writeAtomic(bak, old);
          rotated = true;
        }
        writeAtomic(file, text);
        if (pending === text) pending = null;
        return true;
      } catch {
        return false; // a full disk or a read-only folder: the save in localStorage is unaffected
      }
    },
  };
}

module.exports = { FILE, MAX_BYTES, createMirror, looksLikeSave };
