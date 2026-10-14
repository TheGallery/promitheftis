import './style.css';
import { App } from './ui/app';
import { Sounds } from './ui/audio';
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
    now: () => performance.now(),
    random: () => Math.random(),
  },
  () => draw(),
);

function draw(): void {
  document.body.dataset.theme = app.blue ? 'blue' : 'green';
  screen!.innerHTML = screenHtml(app);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
  // Reloading and developer tools stay available; every other key belongs to the game.
  if (e.key === 'F5' || e.key === 'F11' || e.key === 'F12') return;
  const used = app.press({ key: e.key, shift: e.shiftKey, repeat: e.repeat });
  if (used || e.key === 'Tab' || /^F\d+$/.test(e.key)) e.preventDefault();
});

draw();
