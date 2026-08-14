import './styles.css';
import { Game } from './game/Game';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Rattleworks needs an #app root.');

const game = new Game(root);

// Read-only inspection hook for local browser QA. Portal builds do not expose
// the game instance.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  (window as Window & { __RATTLEWORKS_QA__?: Game }).__RATTLEWORKS_QA__ = game;
}
