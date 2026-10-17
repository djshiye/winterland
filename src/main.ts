// Bundled font (latin subset), so the game looks the same offline (desktop builds) as on the web.
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import './style.css';
import { SAVE } from './config';
import { Game, RECOVERED_FLAG } from './game/Game';
import { freshRequested } from './core/Save';
import { pushBackup } from './core/saveVault';
import { afterPaint, hideSplash } from './ui/splash';

function showFatal(message: string): void {
  hideSplash();
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
 * 0.9.6: the save is only cleared once its copy is safely stored (read back), and the fresh game tells the player
 * where it is (RECOVERED_FLAG → a notice; Settings → Game → Earlier saves lists `<key>.bak`).
 */
function recoverFromBadSave(): boolean {
  try {
    if (freshRequested() || sessionStorage.getItem(RECOVERY_FLAG)) return false;
    const raw = localStorage.getItem(SAVE.key);
    if (!raw) return false;
    sessionStorage.setItem(RECOVERY_FLAG, '1');
    const older = localStorage.getItem(`${SAVE.key}.bak`);
    if (older && older !== raw) pushBackup(older); // an earlier rescue copy is not dropped either
    try {
      localStorage.setItem(`${SAVE.key}.bak`, raw);
    } catch {
      /* checked just below */
    }
    // never clear a save that could not be copied first (storage full): show the crash instead
    if (localStorage.getItem(`${SAVE.key}.bak`) !== raw) return false;
    localStorage.setItem(RECOVERED_FLAG, String(Date.now()));
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
  hideSplash();
  import('./debug/Gallery')
    .then(({ Gallery }) => new Gallery(app).start())
    .catch((err: unknown) => showFatal(`Gallery failed: ${err instanceof Error ? err.message : String(err)}`));
} else {
  // 0.9.7: let the loading splash paint before the long world build, and fade it once the first frame is drawn
  void afterPaint().then(() => {
    try {
      const game = new Game(app, hud);
      game.start();
      requestAnimationFrame(() => requestAnimationFrame(hideSplash));
      setTimeout(hideSplash, 1500); // a hidden tab draws no frames
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
  });
}
