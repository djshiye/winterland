// Bundled font (latin subset), so the game looks the same offline (desktop builds) as on the web.
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import './style.css';
import { SAVE } from './config';
import { Game } from './game/Game';
import { freshRequested } from './core/Save';

function showFatal(message: string): void {
  const el = document.createElement('div');
  el.className = 'fatal';
  el.textContent = message;
  document.body.appendChild(el);
}

const RECOVERY_FLAG = 'winterland.recovery';

/**
 * Starting the game threw. If a save exists it is the likely culprit (a corrupt / incompatible save would otherwise
 * brick the game on every reload): move it to `<key>.bak`, clear it and reload ONCE into a fresh game. A
 * sessionStorage flag stops the retry loop when the crash has another cause. Returns true when a reload was started.
 */
function recoverFromBadSave(): boolean {
  try {
    if (freshRequested() || sessionStorage.getItem(RECOVERY_FLAG)) return false;
    const raw = localStorage.getItem(SAVE.key);
    if (!raw) return false;
    sessionStorage.setItem(RECOVERY_FLAG, '1');
    try {
      localStorage.setItem(`${SAVE.key}.bak`, raw);
    } catch {
      // backup is best effort (storage full): still clear the broken save
    }
    localStorage.removeItem(SAVE.key);
    location.reload();
    return true;
  } catch {
    return false;
  }
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const app = document.getElementById('app');
const hud = document.getElementById('hud');

if (!app || !hud) {
  showFatal('Winterland failed to start: missing #app/#hud.');
} else if (!hasWebGL()) {
  showFatal('Winterland needs WebGL. Try a recent Chrome, Firefox or Safari.');
} else if (new URLSearchParams(location.search).has('gallery')) {
  // Asset review page: every AssetFactory model on one screen (loaded on demand, not part of the game).
  import('./debug/Gallery')
    .then(({ Gallery }) => new Gallery(app).start())
    .catch((err: unknown) => showFatal(`Gallery failed: ${err instanceof Error ? err.message : String(err)}`));
} else {
  try {
    const game = new Game(app, hud);
    game.start();
    // Started fine: the next crash (e.g. after another bad save in this tab) may recover again.
    try {
      sessionStorage.removeItem(RECOVERY_FLAG);
    } catch {
      // no sessionStorage
    }
  } catch (err) {
    console.error(err);
    if (!recoverFromBadSave()) {
      showFatal(`Winterland crashed while starting: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
