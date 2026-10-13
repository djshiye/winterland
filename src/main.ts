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
} else {
  try {
    const game = new Game(app, hud);
    game.start();
  } catch (err) {
    console.error(err);
    showFatal(`Winterland crashed while starting: ${err instanceof Error ? err.message : String(err)}`);
  }
}
