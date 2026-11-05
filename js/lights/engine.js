// The Lighting Engine. Every frame it reads the analysed music, lets the chosen mode drive three
// voices, smooths and limits the result and hands it to the scheduler, which talks to whichever
// adapter is in use. A failing bulb is retried on its own and never stops the music or the page.

import { MockAdapter } from './adapters.js';
import { Scheduler } from './scheduler.js';
import { Voice, Onset, runMode, resolvePalette, MODES, PALETTES } from './modes.js';
import { hexToRgb, kelvinToRgb, mixRgb, clamp01 } from './color.js';

const STORE_KEY = 'lumen.v1';
const LOOK_FADE = 1.2;     // seconds to crossfade into a new mode or palette
const LEVEL_GLIDE = 0.3;   // seconds for brightness, blackout and on/off to settle

export const DEFAULTS = {
  mode: 'flow', palette: 'auto',
  sensitivity: 100, smoothing: 80, master: 85, floor: 6, latency: 0, group: false,
  rate: 8, budget: 20, threshold: 2,
  mock: { delay: 80, jitter: 40, fade: 0 },
  strobe: { ack: false, hz: 2, sync: 'beat', colour: false },
  manual: { white: false, kelvin: 3000, brightness: 80 },
  pulse: { color: '#ff3a6e', depth: 55 },
  artist: { every: 60 },
  flow: { period: 60 },
  spark: { often: 'sometimes' },
  blackout: false,
  lamps: [
    { name: 'Lamp A', color: '#ff1fa2', band: 'bass', on: true },
    { name: 'Lamp B', color: '#25e8ff', band: 'mid', on: true },
    { name: 'Lamp C', color: '#7a22ff', band: 'high', on: true },
  ],
  adapter: 'mock',
  discovered: [],
  presets: {},
};

// What a preset keeps: the look, not the devices.
const PRESET_KEYS = ['mode', 'palette', 'sensitivity', 'smoothing', 'master', 'floor', 'group', 'manual', 'pulse', 'artist', 'flow', 'spark'];

const clone = (x) => JSON.parse(JSON.stringify(x));

function load() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { stored = null; }
  const s = clone(DEFAULTS);
  if (stored && typeof stored === 'object') {
    Object.keys(DEFAULTS).forEach((k) => {
      if (stored[k] === undefined) return;
      if (k === 'lamps' && Array.isArray(stored.lamps)) s.lamps = s.lamps.map((l, i) => ({ ...l, ...(stored.lamps[i] || {}) }));
      else if (DEFAULTS[k] && typeof DEFAULTS[k] === 'object' && !Array.isArray(DEFAULTS[k])) s[k] = { ...s[k], ...stored[k] };
      else s[k] = stored[k];
    });
  }
  if (!MODES[s.mode]) s.mode = DEFAULTS.mode;
  if (!PALETTES[s.palette]) s.palette = DEFAULTS.palette;
  s.strobe.ack = false;          // the warning is read again in every session
  s.blackout = false;
  return s;
}

export class LightingEngine {
  constructor({ clock }) {
    this.clock = clock;
    this.s = load();
    this.ids = ['a', 'b', 'c'];
    this.voices = this.ids.map(() => new Voice());
    this.memo = {};
    this.onsets = { mid: new Onset(), high: new Onset() };
    this.t = 0;
    this.slow = 0;
    this.fast = 0;
    this.lastBeatAt = -10;
    this.lastHitId = -1;
    this.predKey = null;
    this.artistCtl = { next: false, every: 60 };
    this.out = this.ids.map(() => ({ on: false, rgb: [0, 0, 0], bri: 0, white: false, kelvin: 3000 }));
    this.final = this.ids.map(() => ({ rgb: [0, 0, 0], bri: 0 }));
    this.lit = this.ids.map(() => ({ on: false, rgb: [0, 0, 0], bri: 0 }));
    this.lampGain = this.ids.map(() => 0);
    this.gain = 0;          // starts dark and fades up, so opening the app never flashes the room
    this.look = '';
    this.status = Object.fromEntries(this.ids.map((id) => [id, { state: 'disconnected', message: '', retries: 0, retryAt: 0 }]));
    this.scheduler = new Scheduler(this.liveLimits());
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.onChange = () => {};
    this.useAdapter(this.s.adapter);
    this.saveSoon = this.debounce(() => this.save(), 400);
  }

  debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  liveLimits() {
    const s = this.s;
    return { get rate() { return s.rate; }, get budget() { return s.budget; }, get threshold() { return s.threshold / 100; } };
  }

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.s)); } catch { /* private window: settings last this session only */ }
  }

  changed() { this.saveSoon(); this.onChange(); }

  // --- devices -----------------------------------------------------------------------------

  useAdapter(kind) {
    this.ids.forEach((id) => this.adapter?.disconnect(id));
    this.s.adapter = kind;
    if (kind === 'mock') {
      this.adapter = new MockAdapter(this.s.mock);
    } else {
      // No real protocol is confirmed for these bulbs yet, so there is nothing to connect to.
      this.adapter = null;
    }
    if (this.adapter) this.adapter.onStatus = (id, state, message) => this.setStatus(id, state, message);
    this.ids.forEach((id) => {
      this.scheduler.clear(id);
      this.setStatus(id, this.adapter ? 'disconnected' : 'unsupported', this.adapter ? '' : 'Real bulbs: protocol not confirmed yet. See Devices.');
      if (this.adapter) this.connect(id);
    });
  }

  setStatus(id, state, message = '') {
    const st = this.status[id];
    st.state = state;
    st.message = message;
    if (state === 'virtual' || state === 'connected') st.retries = 0;
    if (state === 'error' && this.adapter) {
      // Back off 1, 2, 4… up to 15 seconds, then keep trying at that pace.
      st.retryAt = performance.now() + Math.min(15000, 1000 * 2 ** st.retries);
      st.retries++;
    }
    this.onChange();
  }

  async connect(id) {
    if (!this.adapter) return;
    try { await this.adapter.connect(id); } catch (err) { this.setStatus(id, 'error', err.message); }
  }

  disconnect(id) { this.adapter?.disconnect(id); this.status[id].retryAt = 0; }

  canSend(id) {
    const st = this.status[id].state;
    return st === 'virtual' || st === 'connected';
  }

  // --- the frame -------------------------------------------------------------------------

  update(dt, f) {
    this.t += dt;
    const s = this.s;
    const clock = this.clock;

    if (f.beat > 0) this.lastBeatAt = this.t;
    const kslow = 1 - Math.exp(-dt / 5);
    const kfast = 1 - Math.exp(-dt / 0.4);
    this.slow += (f.level - this.slow) * kslow;
    this.fast += (f.level - this.fast) * kfast;

    // With a steady tempo the beat comes from the grid, which ignores hits between beats and lets
    // each beat leave early by the bulb delay. Without one, every clear hit heard counts as a beat.
    let beat = 0;
    if (clock.usable) {
      const len = 60 / clock.bpm;
      const idx = Math.floor((clock.now + s.latency / 1000 - clock.phaseAt) / len);
      if (this.predKey !== null && idx !== this.predKey) beat = Math.max(0.8, f.beat);
      this.predKey = idx;
    } else {
      this.predKey = null;
      if (f.beat > 0) beat = f.beat;
    }

    let hit = 0;
    if (f.hitId !== this.lastHitId && f.hit > 0) { this.lastHitId = f.hitId; hit = f.hit; }

    const pal = resolvePalette(s.palette, this.memo.show, s.lamps.map((l) => l.color), s.mode);
    const ctx = {
      dt, t: this.t, f, pal, beat, hit,
      sens: s.sensitivity / 100,
      floor: s.floor / 100,
      bands: s.lamps.map((l) => l.band),
      beatLen: clock.bpm ? 60 / clock.bpm : f.bpm ? 60 / f.bpm : 0.5,
      energy: clamp01(this.slow * 1.5),
      fast: clamp01(this.fast * 1.5),
      lastBeatAt: this.lastBeatAt,
      onsetMid: this.onsets.mid.update(this.t, dt, f.mid),
      onsetHigh: this.onsets.high.update(this.t, dt, f.high),
      autoPalette: s.palette === 'auto',
      pulse: s.pulse,
      artist: Object.assign(this.artistCtl, { every: s.artist.every }),
      flow: s.flow,
      spark: s.spark,
      strobeAllowed: s.strobe.ack && !this.reducedMotion,
      strobeHz: s.strobe.hz, strobeSync: s.strobe.sync, strobeColour: s.strobe.colour,
      manual: s.lamps.map((l) => ({ rgb: s.manual.white ? kelvinToRgb(s.manual.kelvin) : hexToRgb(l.color), bri: s.manual.brightness / 100 })),
    };
    this.voices.forEach((v) => v.decay(dt));
    runMode(s.mode, ctx, this.voices, this.memo);

    const release = Math.max(0.001, s.smoothing / 1000);
    const k = 1 - Math.exp(-dt / release);
    // Changing mode or palette crossfades from the old light to the new one, and brightness,
    // blackout and a lamp's on/off glide rather than jump, so nothing snaps in a dark room.
    const look = `${s.mode}|${s.palette}`;
    if (look !== this.look) {
      if (this.look) { this.fadeFrom = this.final.map((o) => ({ rgb: [...o.rgb], bri: o.bri })); this.fadeAt = this.t; }
      this.look = look;
    }
    let fk = 1;
    if (this.fadeFrom) {
      const x = Math.min(1, (this.t - this.fadeAt) / LOOK_FADE);
      fk = x * x * (3 - 2 * x);
      if (x >= 1) this.fadeFrom = null;
    }
    const glide = 1 - Math.exp(-dt / LEVEL_GLIDE);
    this.gain += ((s.blackout ? 0 : s.master / 100) - this.gain) * glide;
    this.ids.forEach((id, i) => {
      const want = this.voices[s.group ? 0 : i].out();
      const cur = this.out[i];
      if (want.bri >= cur.bri) { cur.bri = want.bri; cur.rgb = [...want.rgb]; }
      else { cur.bri += (want.bri - cur.bri) * k; cur.rgb = mixRgb(cur.rgb, want.rgb, k); }
      const lamp = s.lamps[i];
      this.lampGain[i] += ((lamp.on ? 1 : 0) - this.lampGain[i]) * glide;
      const from = this.fadeFrom?.[i];
      const rgb = from ? mixRgb(from.rgb, cur.rgb, fk) : [...cur.rgb];
      const raw = from ? from.bri + (cur.bri - from.bri) * fk : cur.bri;
      this.final[i] = { rgb, bri: raw };
      const bri = clamp01(raw * this.gain * this.lampGain[i]);
      const on = bri > 0.002 || (lamp.on && !s.blackout);
      const white = s.mode === 'manual' && s.manual.white;
      this.lit[i] = { on, rgb, bri };
      this.scheduler.want(id, { on, rgb, bri, white, kelvin: s.manual.kelvin });
      this.status[id].sentBri = bri;
    });

    this.retryDue();
    this.scheduler.pump(
      (id, st) => this.adapter.send(id, st),
      (id) => this.adapter && this.canSend(id),
      (id, err) => { if (this.status[id].state !== 'error') this.setStatus(id, 'error', err.message); },
    );
  }

  retryDue() {
    const now = performance.now();
    this.ids.forEach((id) => {
      const st = this.status[id];
      if (st.state === 'error' && st.retryAt && now >= st.retryAt) {
        st.retryAt = 0;
        this.connect(id);
      }
    });
  }

  // What the preview shows: the bulb's last confirmed state, or nothing when it has none.
  shown(i) {
    const id = this.ids[i];
    if (!this.adapter || !this.canSend(id)) return null;
    return this.adapter.shown(id);
  }

  // The state the engine wants right now, before the radio.
  wanted(i) { return this.lit[i]; }

  stats(i) {
    const id = this.ids[i];
    const lane = this.scheduler.lane(id);
    return { rate: this.scheduler.rateOf(id), latency: lane.stats.latency, failed: lane.stats.failed, replaced: lane.stats.replaced, sent: lane.stats.sent };
  }

  measuredLatency() {
    const xs = this.ids.map((id) => this.scheduler.lane(id).stats).filter((x) => x.latencyN > 3).map((x) => x.latency);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  }

  showInfo() {
    const m = this.memo.show;
    return { look: m?.look, mood: m?.mood, palette: m?.palette, harmony: this.memo.artist?.name };
  }

  // --- presets ---------------------------------------------------------------------------

  savePreset(name) {
    const p = Object.fromEntries(PRESET_KEYS.map((k) => [k, clone(this.s[k])]));
    p.colors = this.s.lamps.map((l) => l.color);
    p.bands = this.s.lamps.map((l) => l.band);
    this.s.presets[name] = p;
    this.changed();
  }

  loadPreset(name) {
    const p = this.s.presets[name];
    if (!p) return;
    PRESET_KEYS.forEach((k) => { if (p[k] !== undefined) this.s[k] = clone(p[k]); });
    p.colors?.forEach((c, i) => { if (this.s.lamps[i]) this.s.lamps[i].color = c; });
    p.bands?.forEach((b, i) => { if (this.s.lamps[i]) this.s.lamps[i].band = b; });
    this.memo = {};
    this.changed();
  }

  deletePreset(name) { delete this.s.presets[name]; this.changed(); }

  resetLook() {
    const keep = { lamps: this.s.lamps.map((l) => ({ name: l.name })), presets: this.s.presets, discovered: this.s.discovered, adapter: this.s.adapter };
    const fresh = clone(DEFAULTS);
    Object.assign(this.s, fresh, { presets: keep.presets, discovered: keep.discovered, adapter: keep.adapter });
    this.s.lamps.forEach((l, i) => { l.name = keep.lamps[i].name; });
    this.adapter && (this.adapter.settings = this.s.mock);
    this.memo = {};
    this.changed();
  }

  rememberDevice(report) {
    const d = report.device;
    if (!d) return;
    const list = this.s.discovered.filter((x) => x.id !== d.id);
    list.unshift({ id: d.id, name: d.name, at: report.at, services: report.services.map((x) => x.uuid), hints: report.hints });
    this.s.discovered = list.slice(0, 10);
    this.changed();
  }
}
