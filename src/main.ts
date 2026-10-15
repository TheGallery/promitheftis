import './style.css';
import { App } from './ui/app';
import { Sounds } from './ui/audio';
import { gameKey } from './ui/keys';
import { browserStore } from './ui/store';
import { screenHtml } from './ui/view';

const screen = document.getElementById('screen');
if (!screen) throw new Error('missing #screen');

const sounds = new Sounds();
const app: App = new App(
  {
    cue: (moment, arg) => sounds.cue(moment, arg),
    print: (lines) => sounds.print(lines),
    later: (fn, ms) => void window.setTimeout(fn, ms),
    toggleSound: () => sounds.toggle(),
    setSound: (on) => void (sounds.enabled = on),
    store: browserStore(),
    now: () => performance.now(),
    random: () => Math.random(),
  },
  () => draw(),
);

/** While the key for a new run is held down, the button fills a little more on every frame. */
let filling = false;

function frame(): void {
  filling = false;
  app.tick();
}

function draw(): void {
  document.body.dataset.theme = app.blue ? 'blue' : 'green';
  screen!.innerHTML = screenHtml(app);
  if (app.holding && !filling) {
    filling = true;
    window.requestAnimationFrame(frame);
  }
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
  // Reloading and developer tools stay available; every other key belongs to the game.
  if (e.key === 'F5' || e.key === 'F11' || e.key === 'F12') return;
  const used = app.press({ key: gameKey(e), shift: e.shiftKey, repeat: e.repeat });
  if (used || e.key === 'Tab' || /^F\d+$/.test(e.key)) e.preventDefault();
});

window.addEventListener('keyup', (e) => app.release(gameKey(e)));
window.addEventListener('blur', () => app.releaseAll());

draw();
