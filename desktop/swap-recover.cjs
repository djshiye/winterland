/**
 * 0.9.10 (READINESS F9): finish off an update whose file swap was cut short (a power cut, a killed script), so the game
 * never runs as a half-old, half-new mix. Kept free of Electron so tests can run it against a temporary folder.
 *
 * The "Update Winterland" scripts (desktop/updater/update.sh and update.ps1) and this file share one layout, inside
 * the game folder (Linux, Windows) or the folder that holds Winterland.app (macOS):
 *   .winterland-update-lock/pid    the running updater (nothing here is touched while that process is alive)
 *   .winterland-update-new/        the update in progress:
 *     unpacked/<top>/...           the new files, before they are moved in
 *     swap.txt                     written before the first file moves: one line per top-level name the new version
 *                                  ships, "1 <name>" when the game folder had that name before, "0 <name>" when not
 *     old/<name>                   (Linux, Windows) an old file or folder, moved aside until the swap is done
 *     old.app                      (macOS) the old Winterland.app, moved aside until the new one is in place
 *   .winterland-update-done/       a finished swap's leftovers (the folder above, renamed in one step): just removed
 *
 * Recovery always goes BACK to the old version, which is complete in old/ until the swap has finished: every name in
 * swap.txt that has an old copy gets it back (the new one in its place is removed), and every name that is new in
 * this version is removed. The game folder ends up exactly as before the update; the update can simply run again.
 * Only names listed in swap.txt (plain names, no paths) are ever touched; the save is not in these folders.
 */
const fs = require('node:fs');
const path = require('node:path');

const STAGE = '.winterland-update-new';
const DONE = '.winterland-update-done';
const LOCK = '.winterland-update-lock';
const JOURNAL = 'swap.txt';

const exists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
const remove = (p) => fs.rmSync(p, { recursive: true, force: true });

/** A plain file or folder name (no separators, no `.`/`..`), as the updater writes them. */
function safeName(name) {
  return typeof name === 'string' && name.length > 0 && name.length < 256 && name !== '.' && name !== '..' && !/[/\\\0\r\n]/.test(name);
}

/** The swap journal's entries, or null when there is none or it doesn't read as one. */
function readJournal(stage) {
  let text;
  try {
    text = fs.readFileSync(path.join(stage, JOURNAL), 'utf8');
  } catch {
    return null;
  }
  const out = [];
  for (const line of text.split('\n')) {
    const l = line.replace(/\r$/, '');
    if (!l) continue;
    const m = /^([01]) (.+)$/.exec(l);
    if (!m || !safeName(m[2])) return null;
    out.push({ had: m[1] === '1', name: m[2] });
  }
  return out;
}

/** True while the updater that holds the lock is still running. */
function updaterRunning(folder) {
  const lock = path.join(folder, LOCK);
  if (!exists(lock)) return false;
  let pid = 0;
  try {
    pid = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8').trim());
  } catch {
    return true; // the lock is being taken right now: leave everything alone
  }
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM'; // alive but not ours
  }
}

/**
 * Put the game folder back as it was before an interrupted update. `platform`: process.platform. `app` (macOS): the
 * running Winterland.app, when known. Returns:
 *   'none'         nothing was left over
 *   'busy'         an updater is running right now: nothing touched
 *   'cleaned'      leftovers of a finished (or never started) swap were removed; the game files were already whole
 *   'rolled-back'  the old version was put back (the caller should start it again)
 *   'incomplete'   something could not be put back; the leftovers stay for the next try
 */
function recoverSwap(folder, platform, app = '') {
  try {
    if (updaterRunning(folder)) return 'busy';
    let result = 'none';
    const done = path.join(folder, DONE);
    if (exists(done)) {
      remove(done);
      result = 'cleaned';
    }
    const stage = path.join(folder, STAGE);
    if (!exists(stage)) return result;

    if (platform === 'darwin') {
      const old = path.join(stage, 'old.app');
      const appPath = app || path.join(folder, 'Winterland.app');
      if (exists(old) && !exists(appPath)) {
        fs.renameSync(old, appPath);
        remove(stage);
        return 'rolled-back';
      }
      remove(stage); // the new app is in place (one rename), or the swap never started
      return 'cleaned';
    }

    const oldDir = path.join(stage, 'old');
    const journal = readJournal(stage);
    if (journal) {
      let ok = true;
      for (const { had, name } of journal) {
        const live = path.join(folder, name);
        const kept = path.join(oldDir, name);
        try {
          if (had) {
            if (exists(kept)) {
              if (exists(live)) remove(live); // the new copy that replaced it
              fs.renameSync(kept, live);
            }
          } else if (exists(live)) {
            remove(live); // only the new version has this name
          }
        } catch {
          ok = false;
        }
      }
      if (!ok) return 'incomplete';
      remove(stage);
      return 'rolled-back';
    }

    // An update from 0.9.8 / 0.9.9 (no journal): put back each old file that has no replacement, as those did.
    let moved = 0;
    if (exists(oldDir)) {
      for (const name of fs.readdirSync(oldDir)) {
        if (!safeName(name) || exists(path.join(folder, name))) continue;
        fs.renameSync(path.join(oldDir, name), path.join(folder, name));
        moved++;
      }
      if (fs.readdirSync(oldDir).length > 0) return moved ? 'rolled-back' : 'incomplete';
    }
    remove(stage);
    return moved ? 'rolled-back' : 'cleaned';
  } catch {
    return 'incomplete';
  }
}

module.exports = { DONE, JOURNAL, LOCK, STAGE, recoverSwap, readJournal, safeName };
