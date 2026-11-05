/* LUMEN © 2026 Rustem Tukhbetov. All rights reserved. https://creativeoglu.com */
// Entry point: audio, clock and Lighting Engine on one timeline, then the interface.

import { AudioEngine } from './audio.js';
import { Clock } from './clock.js';
import { LightingEngine } from './lights/engine.js';
import { UI } from './ui.js';

const audioSettings = { gain: 0, smoothing: 120, autoLevel: true, monitor: false };   // the built-in beat is never heard
const audio = new AudioEngine(audioSettings);
const clock = new Clock({ mode: 'auto', bpm: 120 });
const lights = new LightingEngine({ clock });
const ui = new UI(document.getElementById('app'), { audio, clock, lights, audioSettings });
audio.onChange = () => ui.syncAudio();
lights.onChange = () => ui.syncLights();

// Browsers keep sound suspended until the first click or key press.
const unlock = () => audio.unlock();
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

let last = performance.now();
let lightError = 0;

// One step for everything: the music is analysed once and every part reads the same result.
function step() {
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  const f = audio.update(dt);
  clock.update(dt, f);
  try {
    lights.update(dt, f);
  } catch (err) {
    // A lighting fault is shown, not thrown: the music and the page carry on.
    if (now - lightError > 2000) { lightError = now; ui.lightFault(err); console.error(err); }
  }
  ui.tick(f, dt);
}

// Frames stop in a hidden tab, but the bulbs must keep playing, so a timer takes over there.
// Browsers slow timers in background tabs that make no sound; playing a file or the demo keeps it going.
let timer = null;
function loop() {
  if (document.hidden) return;
  step();
  requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { timer = setInterval(step, 33); }
  else { clearInterval(timer); timer = null; last = performance.now(); requestAnimationFrame(loop); }
});
requestAnimationFrame(loop);

window.__lumen = { audio, clock, lights, ui, step };

// Offline copy for the phone. Skipped on a plain local server, where it would only get in the way of edits.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* the app still works online */ });
}

// The free Netlify plan adds a "Powered by Netlify" badge in the bottom right corner. When it is
// there, the tab bar moves up above it, so the badge has its own strip and covers nothing.
const markBadge = () => document.body.classList.toggle('has-badge', !!document.getElementById('nl-badge-frame'));
new MutationObserver(markBadge).observe(document.body, { childList: true });
markBadge();
