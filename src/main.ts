// Bundled font (latin subset), so the game looks the same offline (desktop builds) as on the web.
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import './style.css';
import { Game } from './game/Game';

function showFatal(message: string): void {
  const el = document.createElement('div');
  el.className = 'fatal';
  el.textContent = message;
  document.body.appendChild(el);
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
  } catch (err) {
    console.error(err);
    showFatal(`Winterland crashed while starting: ${err instanceof Error ? err.message : String(err)}`);
  }
}
