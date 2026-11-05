// What the three lamps do with the music. The lamps hang at the corners of a triangle on one
// chandelier, so movement goes round the triangle, not left to right. Each mode drives three
// voices, one per lamp; a voice
// holds a steady base light and a flash that decays. The engine smooths, limits and sends the
// result, so nothing here knows about Bluetooth.

import { hexToRgb, hsvToRgb, rgbToHsv, mixRgb, clamp01 } from './color.js';

export const MODES = {
  flow: 'Chill',
  pulse: 'Colour pulse',
  artist: 'Artist',
  spark: 'Spark',
  bass: 'Bass reactive',
  beat: 'Beat sync',
  split: 'Frequency split',
  wave: 'Colour spin',
  ambient: 'Ambient',
  strobe: 'Strobe',
  manual: 'Manual colour',
  show: 'PARTY',
};

export const MODE_NOTES = {
  show: 'Works like a lighting designer: a new look every phrase, lamps taking turns round the triangle in different colours, dim breathing in a break and one big hit on the drop.',
  artist: 'Three colours that sit well together, each lamp its own, so the room is lit in a blend. Every so often they melt into a new set.',
  flow: 'A soft gradient that crawls slowly round the triangle, so the light turns round the room like a lazy snake. Easy on the eyes.',
  spark: 'Colour on every lamp, pulsing with the beat. Now and then one lamp breaks into a short strobe burst while the others keep their colours.',
  pulse: 'One colour of your choice, gently breathing with the beat: up on each beat, easing down before the next.',
  bass: 'Each lamp flashes its own colour on bass hits. Harder hits flash brighter.',
  beat: 'Pulses on every beat. The lead lamp moves round the triangle and the colours turn every bar.',
  split: 'Each lamp follows its own band, set below: low, mid and high by default.',
  wave: 'Each beat sends a pulse of colour round the triangle, over slow turning light. The direction flips every 4 bars.',
  ambient: 'Slow colour drift. Louder, busier music moves it faster and brighter.',
  strobe: 'Short flashes on the beat, at most 3 a second.',
  manual: 'A steady colour or white, with no music.',
};

export const BANDS = { bass: 'Low', mid: 'Mid', high: 'High', level: 'Whole mix' };

export const PALETTES = {
  auto: { label: 'Changes by itself', colors: null },
  custom: { label: 'My lamp colours', colors: null },
  neon: { label: 'Neon', colors: ['#ff1fa2', '#25e8ff', '#7a22ff'] },
  fire: { label: 'Fire', colors: ['#ff2b1f', '#ff8a1e', '#ffd23a'] },
  club: { label: 'Club', colors: ['#2a2bff', '#ff2f9a', '#e8ecff'] },
  acid: { label: 'Acid', colors: ['#16ff5c', '#ffe600', '#d81bff'] },
  ice: { label: 'Ice', colors: ['#7fe9ff', '#3a5bff', '#e8f4ff'] },
  sunset: { label: 'Sunset', colors: ['#ff3f6e', '#ff9a3c', '#7a3cff'] },
  rave: { label: 'Rave', colors: ['#ff0040', '#00ff9c', '#3a00ff'] },
  dusk: { label: 'Soft dusk', colors: ['#ff9a4a', '#ff5e7a', '#9b6bff', '#2a7bff', '#1fd1c1'] },
};
export const CURATED = Object.keys(PALETTES).filter((k) => PALETTES[k].colors && k !== 'dusk');

const WHITE = [1, 1, 1];
const pick = (pal, i) => pal[((i % pal.length) + pal.length) % pal.length];

export class Voice {
  constructor() { this.reset(); }
  reset() { this.base = 0; this.baseRgb = [...WHITE]; this.env = 0; this.tau = 0.2; this.flashRgb = [...WHITE]; }
  // A weaker flash over a stronger one keeps the stronger one's colour.
  flash(rgb, s, tau) {
    if (s >= this.env * 0.8) { this.flashRgb = rgb; this.tau = tau; }
    this.env = Math.max(this.env, clamp01(s));
  }
  hold(rgb, level) { this.baseRgb = rgb; this.base = clamp01(level); }
  decay(dt) { this.env *= Math.exp(-dt / Math.max(0.02, this.tau)); }
  out() {
    const lit = this.env > this.base;
    return { on: true, white: false, kelvin: 4000, rgb: lit ? this.flashRgb : this.baseRgb, bri: Math.max(this.base, this.env) };
  }
}

// --- simple modes -------------------------------------------------------------------------

// --- calm modes ------------------------------------------------------------------------

// Sets of three chosen for how they mix on walls and ceiling, not just how they look as dots.
export const HARMONIES = [
  { name: 'Golden hour', colors: ['#ff9a4a', '#ff5e7a', '#ffc77a'] },
  { name: 'Lagoon', colors: ['#1fd1c1', '#2a6bff', '#66f0ff'] },
  { name: 'Lavender dusk', colors: ['#9b6bff', '#ff7ad9', '#5a4bff'] },
  { name: 'Aurora', colors: ['#3dff9e', '#2a9dff', '#b04bff'] },
  { name: 'Peach and teal', colors: ['#ffb08a', '#2ad1c9', '#ff7a59'] },
  { name: 'Ember', colors: ['#ff3d1f', '#ff8a1e', '#b0102c'] },
  { name: 'Candy', colors: ['#ff6ad5', '#8a7bff', '#6ae0ff'] },
  { name: 'Neon noir', colors: ['#ff2a6d', '#05d9e8', '#7a22ff'] },
  { name: 'Forest', colors: ['#3ddc84', '#b8ff5a', '#1aa37a'] },
  { name: 'Desert rose', colors: ['#ffb347', '#e0485a', '#ff8f6b'] },
].map((h) => ({ ...h, rgb: h.colors.map(hexToRgb) }));

const ease = (x) => x * x * (3 - 2 * x);

function artist(c, v, s) {
  if (s.i === undefined) { s.i = Math.floor(Math.random() * HARMONIES.length); s.from = s.i; s.since = 0; s.fade = 1; }
  s.since += c.dt;
  if (c.artist.next || s.since > c.artist.every) {
    c.artist.next = false;
    s.from = s.i;
    s.i = (s.i + 1 + Math.floor(Math.random() * (HARMONIES.length - 1))) % HARMONIES.length;
    s.since = 0;
    s.fade = 0;
  }
  s.fade = Math.min(1, s.fade + c.dt / 8);       // eight seconds to melt into the next set
  const k = ease(s.fade);
  const a = HARMONIES[s.from].rgb;
  const b = HARMONIES[s.i].rgb;
  s.name = HARMONIES[s.i].name;
  s.lift = (s.lift || 0) + (c.f.level * c.sens - (s.lift || 0)) * (1 - Math.exp(-c.dt / 1.5));
  const depth = [0.92, 0.78, 0.86];
  v.forEach((x, i) => {
    const drift = 0.04 * Math.sin(c.t * 0.21 + i * 2.1);
    x.hold(mixRgb(a[i], b[i], k), clamp01(depth[i] * 0.85 + drift + 0.15 * clamp01(s.lift)));
  });
}

// A loop through the palette, smoothly blended, sampled at three points a third apart.
function gradientAt(pal, p) {
  const n = pal.length;
  const x = (((p % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  return mixRgb(pal[i % n], pal[(i + 1) % n], ease(x - i));
}

function flow(c, v, s) {
  s.p = ((s.p || 0) + c.dt / Math.max(4, c.flow.period)) % 1;
  s.lift = (s.lift || 0) + (c.f.level * c.sens - (s.lift || 0)) * (1 - Math.exp(-c.dt / 2));
  v.forEach((x, i) => {
    const p = s.p + i / 3;
    // The lamp at the head of the snake is a little brighter, so the turn is felt as well as seen.
    const head = 0.5 + 0.5 * Math.cos((p * 3 % 1) * Math.PI * 2);
    x.hold(gradientAt(c.pal, p), clamp01(0.6 + 0.2 * head + 0.15 * clamp01(s.lift)));
  });
}

// Colour on all three, and now and then a strobe burst on one lamp. The burst is four flashes
// at 3 a second, never on two lamps at once. Without the strobe acknowledgement it is one soft flash.
const SPARK_GAP = { rare: 32, sometimes: 16, often: 8 };

function spark(c, v, s) {
  s.beats = s.beats || 0;
  const turnEvery = 16;
  const shift = Math.floor(s.beats / turnEvery);
  v.forEach((x, i) => x.hold(pick(c.pal, i + shift), 0.45));
  if (c.beat) {
    s.beats++;
    v.forEach((x, i) => { if (!s.burst || s.burst.lamp !== i) x.flash(pick(c.pal, i + shift), 0.9 * c.sens, c.beatLen * 0.55); });
    const gap = SPARK_GAP[c.spark.often] || 16;
    const since = s.beats - (s.lastBurst ?? -gap);
    if (!s.burst && since >= gap && (c.hit >= 0.5 || since >= gap * 1.5)) {
      let lamp = Math.floor(Math.random() * 3);
      if (lamp === s.lastLamp) lamp = (lamp + 1) % 3;
      s.lastLamp = lamp;
      s.lastBurst = s.beats;
      s.burst = c.strobeAllowed ? { lamp, next: c.t, left: 4 } : { lamp, next: c.t, left: 1, soft: true };
    }
  }
  const b = s.burst;
  if (b) {
    v[b.lamp].hold(WHITE, 0);
    v[b.lamp].env = Math.min(v[b.lamp].env, v[b.lamp].flashRgb === WHITE ? 1 : 0);
    if (c.t >= b.next) {
      v[b.lamp].flash(WHITE, 1, b.soft ? 0.3 : 0.05);
      b.left--;
      b.next += 1 / 3;
    }
    if (b.left <= 0 && c.t >= b.next - 1 / 3 + (b.soft ? 0.6 : 0.15)) s.burst = null;
  }
}

// One colour, soft pulse. The rise is eased over a short moment, never a flash, and the fall
// takes most of the beat, so the light breathes with the music.
function pulse(c, v, s) {
  const rgb = hexToRgb(c.pulse.color);
  const low = 1 - c.pulse.depth / 100;
  if (c.beat) { s.at = c.t; s.start = s.u || 0; s.peak = Math.min(1, 0.7 + 0.3 * c.beat * c.sens); }
  const since = c.t - (s.at ?? -100);
  const rise = 0.09;
  const fall = Math.max(0.1, c.beatLen * 0.4);
  s.u = since < rise
    ? s.start + (s.peak - s.start) * (0.5 - 0.5 * Math.cos((since / rise) * Math.PI))
    : (s.peak || 0) * Math.exp(-(since - rise) / fall);
  v.forEach((x) => x.hold(rgb, low + (1 - low) * s.u));
}

function bass(c, v) {
  v.forEach((x, i) => x.hold(pick(c.pal, i), c.floor));
  if (c.hit > 0) v.forEach((x, i) => x.flash(pick(c.pal, i), c.hit * c.sens, 0.22));
  const sway = c.f.bass * c.sens * 0.6;
  v.forEach((x) => { x.base = Math.max(x.base, sway); });
}

function beat(c, v, s) {
  if (c.beat) {
    s.n = (s.n || 0) + 1;
    const lead = turn(0, s.n);
    const bar = Math.floor(s.n / 4);
    v.forEach((x, i) => x.flash(pick(c.pal, i + bar), (i === lead ? 1 : 0.45) * c.sens, c.beatLen * 0.6));
  }
  v.forEach((x, i) => x.hold(pick(c.pal, i + Math.floor((s.n || 0) / 4)), c.floor));
}

function split(c, v) {
  v.forEach((x, i) => {
    const band = c.bands[i] || 'level';
    x.hold(pick(c.pal, i), c.floor + (1 - c.floor) * clamp01(c.f[band] * c.sens));
  });
}

function wave(c, v, s) {
  s.pulses = s.pulses || [];
  if (c.beat) {
    s.k = (s.k || 0) + 1;
    if (s.k % 16 === 0) s.dir = -(s.dir || 1);
    s.pulses.push({ t: c.t, rgb: pick(c.pal, s.k), dir: s.dir || 1, from: s.k % 3 });
  }
  const gap = Math.min(0.2, c.beatLen / 4);
  s.pulses = s.pulses.filter((p) => c.t - p.t < gap * 3 + 0.05);
  v.forEach((x, i) => {
    const slow = 0.5 + 0.5 * Math.sin((c.t * 0.5 * (s.dir || 1) - i / 3) * Math.PI * 2);
    x.hold(pick(c.pal, i), c.floor + slow * 0.25 * c.sens);
  });
  s.pulses.forEach((p) => {
    for (let k = 0; k < 3; k++) {
      if (c.t - p.t >= k * gap && !p[`d${k}`]) { p[`d${k}`] = 1; v[turn(p.from, k * p.dir)].flash(p.rgb, c.sens, 0.25); }
    }
  });
}

function ambient(c, v, s) {
  s.hue = ((s.hue ?? rgbToHsv(c.pal[0])[0]) + c.dt * (3 + c.energy * 20 * c.sens)) % 360;
  const bri = 0.2 + 0.55 * clamp01(c.energy * c.sens);
  v.forEach((x, i) => {
    const breathe = 0.85 + 0.15 * Math.sin(c.t * 0.7 + i * 2.1);
    x.hold(hsvToRgb(s.hue + i * 40, 0.75 + 0.2 * c.energy, 1), Math.max(c.floor, bri * breathe));
  });
}

// At most 3 flashes a second, the usual photosensitivity ceiling (WCAG 2.3.1).
function strobe(c, v, s) {
  v.forEach((x) => x.hold(WHITE, 0));
  if (!c.strobeAllowed) return;
  s.last = s.last ?? -10;
  const minGap = 1 / Math.min(3, Math.max(0.5, c.strobeHz));
  const fire = c.strobeSync === 'free' ? c.t - s.last >= minGap : c.beat > 0;
  if (fire && c.t - s.last >= 1 / 3) {
    s.last = c.t;
    const rgb = c.strobeColour ? pick(c.pal, (s.n = (s.n || 0) + 1)) : WHITE;
    v.forEach((x) => x.flash(rgb, c.sens, 0.06));
  }
}

// --- PARTY: a small lighting designer (called show in the code) ------------------------------------------------------
// It counts beats into phrases and changes the look at the start of each one, picking looks that
// suit how loud and busy the music is. Lamps take turns more than they move together: the whole
// rig flashes as one only on a drop or the first beat of a strong phrase.

const turn = (i, k) => (((i + k) % 3) + 3) % 3;

const LOOKS = {
  spin: {
    label: 'Spin', energy: [0.3, 1],
    beat(c, v, s) { v[turn(0, s.beats * s.dir)].flash(pick(c.pal, s.beats), c.sens, c.beatLen * 0.75); },
    base: 0.05,
  },
  double: {
    label: 'Double spin', energy: [0.55, 1],
    beat(c, v, s) {
      const i = turn(0, s.beats * s.dir);
      v[i].flash(pick(c.pal, s.beats), c.sens, c.beatLen * 0.35);
      s.half = { at: c.t + c.beatLen / 2, i: turn(i, s.dir), rgb: pick(c.pal, s.beats + 1) };
    },
    hold(c, v, s) { if (s.half && c.t >= s.half.at) { v[s.half.i].flash(s.half.rgb, 0.8 * c.sens, c.beatLen * 0.35); s.half = null; } },
    base: 0.04,
  },
  call: {
    label: 'Call and answer', energy: [0.35, 1],
    // Two lamps answer the kick, the third the snare. Which lamp stands alone moves every bar.
    beat(c, v, s) {
      const solo = turn(0, Math.floor(s.beats / 4));
      v.forEach((x, i) => { if (i !== solo) x.flash(c.pal[0], c.sens, 0.22); });
    },
    mid(c, v, s) { v[turn(0, Math.floor(s.beats / 4))].flash(pick(c.pal, 1), c.sens * 0.9, 0.16); },
    high(c, v, s) { const solo = turn(0, Math.floor(s.beats / 4)); v[turn(solo, (s.side = -(s.side || 1)))].flash(pick(c.pal, 2), 0.45 * c.sens, 0.07); },
    base: 0.04,
  },
  rotate: {
    label: 'Colours round', energy: [0, 0.75],
    hold(c, v, s) { v.forEach((x, i) => x.hold(pick(c.pal, i + s.beats * s.dir), 0.35 + 0.25 * c.energy)); },
    beat(c, v, s) { const i = turn(0, s.beats * s.dir); v[i].flash(pick(c.pal, i + s.beats * s.dir), c.sens, c.beatLen * 0.5); },
  },
  sparkle: {
    label: 'Sparkle', energy: [0.2, 1],
    hold(c, v) { v.forEach((x) => x.hold(c.pal[0], 0.12)); },
    beat(c, v, s) { v[turn(0, s.beats)].flash(pick(c.pal, 1), 0.6 * c.sens, 0.3); },
    high(c, v, s) {
      let i = Math.floor(Math.random() * 3);
      if (i === s.lastSpark) i = (i + 1) % 3;
      s.lastSpark = i;
      v[i].flash(Math.random() < 0.4 ? WHITE : pick(c.pal, 2), c.sens, 0.08);
    },
  },
  bands: {
    label: 'Low, mid, high', energy: [0.3, 1],
    hold(c, v) { ['bass', 'mid', 'high'].forEach((b, i) => v[i].hold(pick(c.pal, i), 0.04 + 0.9 * clamp01(c.f[b] * c.sens))); },
  },
  breathe: {
    label: 'Breathing', energy: [0, 0.35],
    hold(c, v) {
      v.forEach((x, i) => {
        const k = 0.5 + 0.5 * Math.sin(c.t * (Math.PI * 2) / 4 - (i * Math.PI * 2) / 3);
        x.hold(pick(c.pal, i), 0.12 + 0.4 * k);   // a slow turn round the triangle
      });
    },
  },
};
export const LOOK_LABELS = Object.fromEntries(Object.entries(LOOKS).map(([k, l]) => [k, l.label]));

function choose(s, energy, rand = Math.random) {
  s.dir = rand() < 0.5 ? 1 : -1;
  const fits = Object.keys(LOOKS).filter((k) => k !== s.look && k !== 'breathe' && energy >= LOOKS[k].energy[0] - 0.05 && energy <= LOOKS[k].energy[1]);
  const list = fits.length ? fits : ['rotate'];
  return list[Math.floor(rand() * list.length)];
}

function show(c, v, s) {
  if (!s.look) Object.assign(s, { look: 'rotate', beats: 0, phrase: 0, mood: 'play', quietFor: 0, palTurn: 0, dir: 1 });
  // A break: the music fell well under its recent level and the beat went away.
  const quiet = c.fast < c.energy * 0.55 && c.t - c.lastBeatAt > 1.2;
  s.quietFor = quiet ? s.quietFor + c.dt : 0;
  if (s.mood !== 'break' && s.quietFor > 0.6) { s.mood = 'break'; s.breakAt = c.t; s.prev = s.look; s.look = 'breathe'; }

  if (c.beat) {
    if (s.mood === 'break' && c.hit >= 0.55 && c.t - s.breakAt > 1.5) {
      // The drop: everything at once, then straight into a busy look.
      s.mood = 'play';
      v.forEach((x) => x.flash(mixRgb(c.pal[0], WHITE, 0.35), 1, 0.55));
      s.look = choose(s, 1);
      s.beats = 0;
      s.phrase++;
      s.palTurn++;
    } else if (s.mood === 'break') {
      s.mood = 'play';
      s.look = s.prev || 'rotate';
    } else {
      s.beats++;
      const len = c.energy > 0.45 ? 16 : 32;   // four bars, or eight when it is calm
      if (s.beats % len === 0) {
        s.phrase++;
        s.look = choose(s, c.energy);
        if (s.phrase % 4 === 0) s.palTurn++;
        if (c.energy > 0.55 && s.phrase % 2 === 0) v.forEach((x, i) => x.flash(pick(c.pal, i), 0.9 * c.sens, 0.3));
      }
    }
  }
  s.palette = c.autoPalette ? CURATED[s.palTurn % CURATED.length] : null;
  const look = LOOKS[s.look];
  v.forEach((x, i) => x.hold(pick(c.pal, i), look.base ?? 0));
  look.hold?.(c, v, s);
  if (c.beat && s.mood === 'play') look.beat?.(c, v, s);
  if (c.onsetMid) look.mid?.(c, v, s);
  if (c.onsetHigh) look.high?.(c, v, s);
}

function manual(c, v) {
  v.forEach((x, i) => x.hold(c.manual[i].rgb, c.manual[i].bri));
}

const RUN = { show, artist, flow, spark, pulse, bass, beat, split, wave, ambient, strobe, manual };

export function runMode(mode, c, voices, memo) {
  memo[mode] = memo[mode] || {};
  (RUN[mode] || manual)(c, voices, memo[mode]);
}

// The palette a mode plays from: curated, the one PARTY is cycling through, or the lamps' own colours.
export function resolvePalette(key, showMemo, custom, mode) {
  if (key === 'custom') return custom.map(hexToRgb);
  // Left to itself, Chill plays its own soft gradient; PARTY cycles through the bright sets.
  const calm = mode === 'flow' ? 'dusk' : 'neon';
  const k = key === 'auto' ? (mode === 'show' && showMemo?.palette) || calm : key;
  return (PALETTES[k]?.colors || PALETTES.neon.colors).map(hexToRgb);
}

// Small onset finder for one band, so PARTY can answer a snare or a hi-hat as well as the kick.
export class Onset {
  constructor() { this.avg = 0; this.last = -10; this.armed = true; }
  update(t, dt, x) {
    this.avg += (x - this.avg) * (1 - Math.exp(-dt / 0.35));
    const rise = x - this.avg;
    let hit = false;
    if (this.armed && rise > 0.14 && x > 0.25 && t - this.last > 0.12) { hit = true; this.armed = false; this.last = t; }
    if (rise < 0.04) this.armed = true;
    return hit;
  }
}
