/* LUMEN © 2026 Rustem Tukhbetov. All rights reserved. https://creativeoglu.com */
// The whole interface: a header with the sound source, the chandelier preview, and four tabs.

import { MODES, MODE_NOTES, PALETTES, BANDS, LOOK_LABELS } from './lights/modes.js';
import { bleSupport, probeDevice } from './lights/ble-probe.js';
import { litRgb, hexToRgb, rgbToHex, hsvToRgb, rgbToHsv } from './lights/color.js';

const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k.startsWith('aria') || k === 'for' || k === 'role') n.setAttribute(k.replace(/^aria/, 'aria-').toLowerCase(), v);
    else n[k] = v;
  });
  kids.flat(Infinity).forEach((c) => c != null && n.append(c));
  return n;
};

// Marks what only "More settings" shows. The simple view keeps what everyone needs.
const adv = (n) => { n.classList.add('adv'); return n; };

const STATUS_TEXT = {
  virtual: 'Virtual', connected: 'Connected', connecting: 'Connecting…', disconnected: 'Off line', error: 'Lost, retrying', unsupported: 'Not available',
};

// Bulb corners of the triangle, as fractions of the stage. A at the top, B and C below.
const CORNERS = [[0.5, 0.2], [0.2, 0.74], [0.8, 0.74]];

export class UI {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.syncers = [];
    this.selected = 'all';     // which lamp the colour wheel edits
    this.previewWanted = true;     // the preview shows the lamps' intended light
    this.build();
    this.syncAll();
  }

  get s() { return this.app.lights.s; }

  add(control) { this.syncers.push(control.sync); return control.node; }

  changed() { this.app.lights.changed(); this.syncAll(); }

  // --- small controls ---------------------------------------------------------------------

  slider({ label, min, max, step = 1, unit = '', hint = '' }, get, set) {
    const range = el('input', { type: 'range', min, max, step, ariaLabel: label });
    const val = el('output');
    const sync = () => {
      range.value = get();
      range.style.setProperty('--fill', `${((get() - min) / (max - min)) * 100}%`);
      val.textContent = `${get()}${unit ? ` ${unit}` : ''}`;
    };
    range.addEventListener('input', () => { set(Number(range.value)); sync(); this.app.lights.changed(); });
    sync();
    return this.add({ node: el('label', { class: 'slider', title: hint }, el('span', { class: 'lbl', text: label }), val, range), sync });
  }

  toggle(label, get, set, hint = '') {
    const btn = el('button', { type: 'button', class: 'toggle', title: hint, onclick: () => { set(!get()); this.changed(); } }, el('span', { text: label }), el('i'));
    const sync = () => btn.setAttribute('aria-pressed', String(!!get()));
    sync();
    return this.add({ node: btn, sync });
  }

  seg(items, get, set, cls = '') {
    const buttons = Object.entries(items).map(([v, text]) => el('button', { type: 'button', text, dataset: { v }, onclick: () => { set(v); this.changed(); } }));
    const sync = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(Object.keys(items)[i] === String(get()))));
    sync();
    return this.add({ node: el('div', { class: `seg ${cls}`, role: 'group' }, buttons), sync });
  }

  select(label, items, get, set) {
    const sel = el('select', { ariaLabel: label, onchange: () => { set(sel.value); this.changed(); } },
      Object.entries(items).map(([v, t]) => el('option', { value: v, text: typeof t === 'string' ? t : t.label })));
    const sync = () => { sel.value = get(); };
    sync();
    return this.add({ node: el('label', { class: 'field' }, el('span', { class: 'lbl', text: label }), sel), sync });
  }

  // A hue and saturation disc. Brightness is set elsewhere, so the disc is always full colour.
  wheel(get, set) {
    const size = 168;
    const c = el('canvas', { class: 'wheel', width: size * 2, height: size * 2, ariaLabel: 'Colour wheel', role: 'img' });
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size * 2, size * 2);
    const r = size;
    for (let y = 0; y < size * 2; y++) {
      for (let x = 0; x < size * 2; x++) {
        const dx = x - r; const dy = y - r;
        const d = Math.hypot(dx, dy) / r;
        const o = (y * size * 2 + x) * 4;
        if (d > 1) { img.data[o + 3] = 0; continue; }
        const [cr, cg, cb] = hsvToRgb((Math.atan2(dy, dx) * 180) / Math.PI + 90, d, 1);
        img.data[o] = cr * 255; img.data[o + 1] = cg * 255; img.data[o + 2] = cb * 255;
        img.data[o + 3] = 255 * Math.min(1, (1 - d) * r);
      }
    }
    ctx.putImageData(img, 0, 0);
    const dot = el('i', { class: 'wheel-dot' });
    const wrap = el('div', { class: 'wheel-wrap' }, c, dot);
    const pickAt = (e) => {
      const b = c.getBoundingClientRect();
      const dx = (e.clientX - b.left) / b.width * 2 - 1;
      const dy = (e.clientY - b.top) / b.height * 2 - 1;
      const sat = Math.min(1, Math.hypot(dx, dy));
      const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      set(rgbToHex(hsvToRgb(hue, sat, 1)));
      sync();
      this.app.lights.changed();
      this.syncAll();
    };
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); pickAt(e); });
    c.addEventListener('pointermove', (e) => { if (c.hasPointerCapture(e.pointerId)) pickAt(e); });
    const sync = () => {
      const [h, sat] = rgbToHsv(hexToRgb(get()));
      const a = ((h - 90) * Math.PI) / 180;
      dot.style.left = `${50 + Math.cos(a) * sat * 50}%`;
      dot.style.top = `${50 + Math.sin(a) * sat * 50}%`;
      dot.style.background = get();
    };
    sync();
    return this.add({ node: wrap, sync });
  }

  // --- layout ----------------------------------------------------------------------------

  build() {
    const { audio } = this.app;
    // Until a source is chosen a silent built-in beat keeps the preview alive. It has no button.
    this.srcButtons = {
      input: el('button', { type: 'button', text: 'Mic', title: 'Listen through the microphone', onclick: () => audio.useInput() }),
      system: el('button', { type: 'button', text: 'Computer', title: 'Sound playing on this computer, through the share window', onclick: () => audio.useSystem() }),
    };
    // A phone browser cannot hear the phone's own sound, so there the button is left out.
    if (!audio.systemAudioSupported) this.srcButtons.system.hidden = true;
    this.meter = el('i');
    this.led = el('span', { class: 'led' });
    this.bpm = el('b', { text: '—' });
    this.audioStatus = el('div', { class: 'status', role: 'status' });
    const tap = el('button', { type: 'button', class: 'mini', text: 'Tap', title: 'Tap the tempo', onclick: () => { this.app.clock.tap(); } });
    const auto = el('button', { type: 'button', class: 'mini', text: 'Auto', title: 'Tempo from the music again', onclick: () => { this.app.clock.settings.mode = 'auto'; } });
    this.blackout = el('button', { type: 'button', class: 'blackout', text: 'Blackout', title: 'All lamps dark (B)', onclick: () => this.toggleBlackout() });
    addEventListener('keydown', (e) => { if (e.code === 'KeyB' && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) this.toggleBlackout(); });

    const header = el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'logo' }, el('i'), el('i'), el('i')), 'LUMEN'),
      el('div', { class: 'src' }, el('div', { class: 'seg', role: 'group', ariaLabel: 'Sound source' }, Object.values(this.srcButtons))),
      el('div', { class: 'reading' }, this.led, el('span', { class: 'meter' }, this.meter), el('span', {}, this.bpm), tap, auto),
      this.blackout,
    );

    // Preview: three small dots in the chandelier's triangle and the mode's name. Kept quiet on purpose.
    this.bulbs = [0, 1, 2].map((i) => {
      const core = el('i', { class: 'core' });
      const node = el('button', { type: 'button', class: 'bulb', title: this.s.lamps[i].name, ariaLabel: `${this.s.lamps[i].name} colour`, onclick: () => { this.selected = String(i); this.showTab('Lamps'); this.syncAll(); } }, core);
      node.style.left = `${CORNERS[i][0] * 100}%`;
      node.style.top = `${CORNERS[i][1] * 100}%`;
      return { node, core };
    });
    this.nowLook = el('div', { class: 'now' });
    this.previewNote = el('button', { type: 'button', class: 'view-toggle adv', onclick: () => { this.previewWanted = !this.previewWanted; this.syncAll(); } });
    const stage = el('section', { class: 'stage', ariaLabel: 'Lamp preview' },
      el('div', { class: 'tri' }, this.bulbs.map((b) => b.node)), this.nowLook, this.previewNote);

    // Tabs
    this.tabs = { Music: this.musicTab(), Lamps: this.lampsTab(), Devices: this.devicesTab(), Presets: this.presetsTab() };
    this.tabButtons = Object.keys(this.tabs).map((n) => el('button', { type: 'button', role: 'tab', text: n, onclick: () => this.showTab(n) }));
    this.fault = el('div', { class: 'status error', hidden: true });
    const panel = el('section', { class: 'panel' },
      el('div', { class: 'tabs', role: 'tablist' }, this.tabButtons),
      this.fault, Object.values(this.tabs));

    this.helpDialog = this.buildHelp();
    this.root.append(this.helpDialog);
    this.root.append(header, el('div', { class: 'audio-status' }, this.audioStatus), el('main', {}, stage, panel));
    let more = false;
    try { more = localStorage.getItem('lumen.more') === '1'; } catch { /* no storage */ }
    this.setMore(more);
    let tab = 'Music';
    try { tab = localStorage.getItem('lumen.tab') || tab; } catch { /* no storage */ }
    this.showTab(this.tabs[tab] ? tab : 'Music');
  }

  // A short guide to connecting, one screen, opened from Devices.
  buildHelp() {
    const step = (n, title, ...body) => el('li', {}, el('b', { text: title }), el('p', {}, ...body));
    const close = el('button', { type: 'button', class: 'mini', text: 'Close', onclick: () => d.close() });
    const d = el('dialog', { class: 'help', ariaLabel: 'How to connect' },
      el('div', { class: 'help-head' }, el('h2', { text: 'How to connect' }), close),
      el('p', { class: 'note', text: 'Right now LUMEN plays three virtual bulbs. The real ones need one check at home first, to learn how they talk.' }),
      el('ol', {},
        step(1, 'Sound', 'Tap ', el('b', { text: 'Mic' }), ' and allow the microphone. On a Mac, ', el('b', { text: 'Computer' }), ' listens to what is playing on it.'),
        step(2, 'Use Chrome on the Mac', 'Safari and every iPhone browser cannot use Bluetooth. If macOS asks, allow Bluetooth for Chrome in System Settings → Privacy & Security → Bluetooth.'),
        step(3, 'Free the bulb', 'Switch the bulbs on. Close Wolta Home or Smart Life on the iPhone, or turn its Bluetooth off: a bulb talks to one device at a time.'),
        step(4, 'Scan', 'Open ', el('b', { text: 'Devices → Scan for a bulb' }), ' and pick the bulb. To find it in the list, switch it off and on and see which name comes back. The scan only reads, it never changes the bulb.'),
        step(5, 'Send the report', 'Tap ', el('b', { text: 'Copy report' }), ' and send it. It shows how the bulbs talk, and the real connection is built from it.')),
      el('p', { class: 'note', text: 'Bulb names and the scan history are kept in this browser only.' }));
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    return d;
  }

  showTab(name) {
    Object.entries(this.tabs).forEach(([n, view]) => { view.hidden = n !== name; });
    this.tabButtons.forEach((b) => b.setAttribute('aria-selected', String(b.textContent === name)));
    try { localStorage.setItem('lumen.tab', name); } catch { /* no storage */ }
  }

  toggleBlackout() { this.s.blackout = !this.s.blackout; this.changed(); }

  musicTab() {
    const s = this.s;
    this.modeNote = el('p', { class: 'note' });
    const warn = () => el('div', { class: 'warn' },
      el('b', { text: 'Photosensitivity warning.' }),
      ' Flashing light can trigger seizures in people with photosensitive epilepsy. Do not use it if anyone present may be affected. Flashes are held to 3 a second and turned off when the system asks for reduced motion.');
    const strobeWarn = warn();
    this.strobeBox = el('div', { class: 'box' }, strobeWarn,
      this.toggle('I understand, allow flashes', () => s.strobe.ack, (v) => { s.strobe.ack = v; }),
      adv(this.seg({ beat: 'On the beat', free: 'Steady rate' }, () => s.strobe.sync, (v) => { s.strobe.sync = v; })),
      adv(this.slider({ label: 'Rate', min: 0.5, max: 3, step: 0.5, unit: '/s' }, () => s.strobe.hz, (v) => { s.strobe.hz = v; })),
      adv(this.toggle('Colour flashes', () => s.strobe.colour, (v) => { s.strobe.colour = v; })),
      this.app.lights.reducedMotion ? el('p', { class: 'note', text: 'Your system asks for reduced motion, so the strobe stays off.' }) : null);
    this.manualBox = el('div', { class: 'box' },
      this.toggle('White light', () => s.manual.white, (v) => { s.manual.white = v; }),
      adv(this.slider({ label: 'Colour temperature', min: 2700, max: 6500, step: 100, unit: 'K', hint: 'Only used for white light' }, () => s.manual.kelvin, (v) => { s.manual.kelvin = v; })),
      this.slider({ label: 'Brightness', min: 1, max: 100, unit: '%' }, () => s.manual.brightness, (v) => { s.manual.brightness = v; }),
      el('p', { class: 'note', text: 'Colours are set per lamp in the Lamps tab.' }));
    this.pulseBox = el('div', { class: 'box' },
      adv(this.wheel(() => s.pulse.color, (hex) => { s.pulse.color = hex; })),
      adv(this.slider({ label: 'Pulse depth', min: 10, max: 100, unit: '%', hint: 'How far the light falls between beats' }, () => s.pulse.depth, (v) => { s.pulse.depth = v; })),
      el('div', { class: 'swatches' }, ['#ff3a6e', '#ff8a1e', '#ffd23a', '#16ff5c', '#25e8ff', '#3a5bff', '#7a22ff', '#ff1fa2', '#ffffff'].map((c) =>
        el('button', { type: 'button', class: 'swatch', ariaLabel: `Colour ${c}`, style: `--c:${c}`, onclick: () => { s.pulse.color = c; this.changed(); } }))));
    this.sparkBox = el('div', { class: 'box' },
      this.toggle('Allow strobe bursts', () => s.strobe.ack, (v) => { s.strobe.ack = v; }, 'Without it, a lamp gives one soft white flash instead'),
      adv(warn()),
      adv(this.seg({ rare: 'Rarely', sometimes: 'Sometimes', often: 'Often' }, () => s.spark.often, (v) => { s.spark.often = v; })),
      this.app.lights.reducedMotion ? el('p', { class: 'note', text: 'Your system asks for reduced motion, so bursts are one soft flash.' }) : null);
    this.artistBox = el('div', { class: 'box' },
      adv(this.slider({ label: 'New colours every', min: 15, max: 300, step: 5, unit: 's' }, () => s.artist.every, (v) => { s.artist.every = v; })),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'mini', text: 'Next colours', onclick: () => { this.app.lights.artistCtl.next = true; } })));
    this.flowBox = el('div', { class: 'box adv' },
      this.slider({ label: 'One turn round the room', min: 10, max: 300, step: 5, unit: 's' }, () => s.flow.period, (v) => { s.flow.period = v; }),
      el('p', { class: 'note', text: 'The gradient is made from the palette.' }));
    this.measured = el('button', { type: 'button', class: 'mini', onclick: () => { const ms = Math.round(this.app.lights.measuredLatency()); if (ms) { s.latency = Math.min(400, ms); this.changed(); } } });
    return this.arrange(el('div', { class: 'tab' },
      el('h3', { text: 'Mode' }),
      this.coreModes(this.seg(MODES, () => s.mode, (v) => { s.mode = v; }, 'modes')),
      adv(this.modeNote),
      this.artistBox, this.flowBox, this.sparkBox, this.pulseBox, this.strobeBox, this.manualBox,
      el('div', { class: 'palette-block' },
        el('h3', { text: 'Palette' }),
        this.paletteChips()),
      el('div', { class: 'gap' }),
      this.slider({ label: 'Brightness', min: 5, max: 100, unit: '%' }, () => s.master, (v) => { s.master = v; }),
      adv(el('h3', { text: 'Feel' })),
      adv(this.slider({ label: 'Sensitivity', min: 20, max: 200, unit: '%', hint: 'How hard the lamps answer the music' }, () => s.sensitivity, (v) => { s.sensitivity = v; })),
      adv(this.slider({ label: 'Smoothing', min: 0, max: 600, step: 10, unit: 'ms', hint: 'How slowly light fades back down' }, () => s.smoothing, (v) => { s.smoothing = v; })),
      adv(this.slider({ label: 'Dark level', min: 0, max: 40, unit: '%', hint: 'How much light stays on between hits' }, () => s.floor, (v) => { s.floor = v; })),
      adv(this.toggle('Move as one', () => s.group, (v) => { s.group = v; }, 'All three lamps copy lamp A')),
      adv(el('h3', { text: 'Timing' })),
      adv(this.slider({ label: 'Bulb delay compensation', min: 0, max: 400, step: 5, unit: 'ms', hint: 'With a steady tempo, beats are sent this much early' }, () => s.latency, (v) => { s.latency = v; })),
      adv(el('div', { class: 'row' }, this.measured)),
      adv(el('p', { class: 'note', text: 'Works once the tempo is locked. Until then lamps answer each beat as it is heard, so they trail by the bulb delay.' })),
    ));
  }

  // The simple view keeps four modes; the rest wait behind More settings.
  coreModes(node) {
    [...node.children].forEach((b) => { if (!['flow', 'pulse', 'artist', 'spark', 'show'].includes(b.dataset.v)) adv(b); });
    return node;
  }

  // Simple controls first, then More settings, then what it reveals, so the button sits right
  // above the extra settings and never at the bottom behind the tab bar.
  arrange(tab) {
    const kids = [...tab.children];
    const extra = kids.filter((n) => n.classList.contains('adv'));
    tab.replaceChildren(...kids.filter((n) => !extra.includes(n)), this.moreButton(), ...extra);
    return tab;
  }

  // One switch for every tab, remembered in this browser.
  moreButton() {
    const b = el('button', { type: 'button', class: 'more-btn', onclick: () => {
      // The button stays where the finger is; what it opens appears under it.
      const panel = b.closest('.panel');
      const before = b.getBoundingClientRect().top;
      this.setMore(!document.body.classList.contains('more'));
      const top = Math.max(panel.getBoundingClientRect().top + 8, Math.min(before, innerHeight * 0.3));
      panel.scrollTop += b.getBoundingClientRect().top - top;
      b.blur();
    } });
    this.moreButtons = [...(this.moreButtons || []), b];
    return b;
  }

  setMore(on) {
    document.body.classList.toggle('more', on);
    this.moreButtons.forEach((b) => { b.textContent = on ? 'Fewer settings' : 'More settings'; b.setAttribute('aria-pressed', String(on)); });
    try { localStorage.setItem('lumen.more', on ? '1' : ''); } catch { /* no storage */ }
  }

  paletteChips() {
    const s = this.s;
    const buttons = Object.entries(PALETTES).map(([k, p]) => {
      const dots = el('span', { class: 'dots' }, [0, 1, 2].map(() => el('i')));
      const b = el('button', { type: 'button', class: `pal pal-${k}`, onclick: () => { s.palette = k; this.changed(); } }, dots, el('span', { text: p.label }));
      return { b, dots, k, p };
    });
    const sync = () => buttons.forEach(({ b, dots, k, p }) => {
      b.setAttribute('aria-pressed', String(s.palette === k));
      const cols = k === 'custom' ? s.lamps.map((l) => l.color) : p.colors;
      if (cols) [...dots.children].forEach((d, i) => { d.style.background = cols[i]; });
    });
    sync();
    return this.add({ node: el('div', { class: 'pals' }, buttons.map((x) => x.b)), sync });
  }

  lampsTab() {
    const s = this.s;
    const lampItems = { all: 'All', 0: 'A', 1: 'B', 2: 'C' };
    this.lampSel = this.seg(lampItems, () => this.selected, (v) => { this.selected = v; });
    const getColor = () => s.lamps[this.selected === 'all' ? 0 : Number(this.selected)].color;
    const setColor = (hex) => {
      if (this.selected === 'all') s.lamps.forEach((l) => { l.color = hex; });
      else s.lamps[Number(this.selected)].color = hex;
      if (s.palette !== 'custom' && s.mode !== 'manual') s.palette = 'custom';
    };
    this.lampRows = s.lamps.map((l, i) => {
      const name = el('input', { type: 'text', class: 'name-in', maxLength: 20, value: l.name, ariaLabel: `Lamp ${'ABC'[i]} name`,
        oninput: () => { l.name = name.value || `Lamp ${'ABC'[i]}`; this.app.lights.changed(); this.syncStage(); } });
      const sw = el('input', { type: 'color', value: l.color, ariaLabel: `${l.name} colour`, oninput: () => { l.color = sw.value; this.changed(); } });
      this.syncers.push(() => { sw.value = l.color; if (document.activeElement !== name) name.value = l.name; });
      const on = this.toggle('On', () => l.on, (v) => { l.on = v; }, `${l.name} on or off`);
      on.classList.add('switch-only');
      return el('div', { class: 'lamp-row' },
        el('div', { class: 'lamp-head' }, el('b', { text: 'ABC'[i] }), name, sw, on),
        adv(this.select('Band', BANDS, () => l.band, (v) => { l.band = v; })));
    });
    return this.arrange(el('div', { class: 'tab' },
      el('h3', { text: 'Colour' }),
      this.lampSel,
      this.wheel(getColor, setColor),
      adv(el('p', { class: 'note', text: 'Picking a colour switches the palette to your lamp colours. Positions on the chandelier: A at the top, B and C below.' })),
      el('h3', { text: 'Lamps' }),
      this.lampRows,
      adv(el('p', { class: 'note', text: 'Band is used by Frequency split. Names are stored in this browser.' })),
    ));
  }

  devicesTab() {
    const { lights } = this.app;
    const s = this.s;
    this.devRows = lights.ids.map((id, i) => {
      const dot = el('span', { class: 'sdot' });
      const name = el('b');
      const state = el('span', { class: 'dim' });
      const stats = adv(el('span', { class: 'dim num' }));
      const conn = el('button', { type: 'button', class: 'mini', onclick: () => { const st = lights.status[id].state; if (st === 'virtual' || st === 'connected') lights.disconnect(id); else lights.connect(id); } });
      const drop = el('button', { type: 'button', class: 'mini adv', text: 'Drop', title: 'Simulate the lamp going out of range', onclick: () => lights.adapter?.simulateDrop?.(id) });
      return { node: el('div', { class: 'dev-row' }, dot, el('div', { class: 'dev-main' }, el('div', {}, name, ' ', state), stats), conn, drop), dot, name, state, stats, conn, drop, id, i };
    });
    const support = bleSupport();
    this.scanLog = el('pre', { class: 'log' });
    this.report = el('pre', { class: 'log report', hidden: true });
    this.copyBtn = el('button', { type: 'button', class: 'mini', text: 'Copy report', hidden: true, onclick: async () => {
      try { await navigator.clipboard.writeText(this.report.textContent); this.copyBtn.textContent = 'Copied'; } catch { this.copyBtn.textContent = 'Select the text and copy it'; }
    } });
    const scan = el('button', { type: 'button', class: 'primary', text: 'Scan for a bulb', disabled: !support.ok, onclick: () => this.scan() });
    this.known = el('div', {});
    return this.arrange(el('div', { class: 'tab' },
      el('button', { type: 'button', class: 'help-btn', text: 'How to connect', onclick: () => this.helpDialog.showModal() }),
      el('h3', { text: 'Your bulbs' }),
      el('p', { class: 'note', text: 'Not connected yet. Follow How to connect: one scan at home tells how the bulbs talk, and the connection is built from it.' }),
      adv(el('h3', { text: 'Test bulbs, for development' })),
      adv(this.seg({ mock: 'Test bulbs on', none: 'Off' }, () => s.adapter, (v) => { lights.useAdapter(v); })),
      this.devRows.map((r) => adv(r.node)),
      adv(el('h3', { text: 'Virtual bulb radio' })),
      adv(this.slider({ label: 'Delay', min: 0, max: 400, step: 5, unit: 'ms' }, () => s.mock.delay, (v) => { s.mock.delay = v; })),
      adv(this.slider({ label: 'Jitter', min: 0, max: 200, step: 5, unit: 'ms' }, () => s.mock.jitter, (v) => { s.mock.jitter = v; })),
      adv(this.slider({ label: 'Bulb fades by itself', min: 0, max: 500, step: 10, unit: 'ms', hint: 'Some bulbs glide to each new colour on their own. 0 shows the worst case: a jump at every command' }, () => s.mock.fade, (v) => { s.mock.fade = v; })),
      adv(el('p', { class: 'note', text: 'Whether the Wolta bulbs glide between colours, and how fast, is only known once one is tested. 0 shows the worst case.' })),
      adv(el('h3', { text: 'Radio limits' })),
      adv(this.slider({ label: 'Commands per lamp', min: 1, max: 30, unit: '/s', hint: 'Never more than this to one bulb' }, () => s.rate, (v) => { s.rate = v; })),
      adv(this.slider({ label: 'Commands in total', min: 2, max: 60, unit: '/s', hint: 'Shared by all three bulbs' }, () => s.budget, (v) => { s.budget = v; })),
      adv(this.slider({ label: 'Skip changes under', min: 0, max: 10, unit: '%', hint: 'Smaller changes wait, so airtime goes to big ones' }, () => s.threshold, (v) => { s.threshold = v; })),
      el('h3', { text: 'Bluetooth diagnostics' }),
      el('p', { class: support.ok ? 'note' : 'status error', text: support.ok ? 'Read only: lists the services a bulb shows. It never writes to the bulb, pairs with it or tries a key.' : support.reason }),
      el('div', { class: 'row' }, scan, this.copyBtn),
      this.scanLog, this.report,
      adv(el('h3', { text: 'Seen before' })),
      adv(this.known),
    ));
  }

  async scan() {
    const lines = [];
    const log = (t) => { lines.push(t); this.scanLog.textContent = lines.join('\n'); };
    this.report.hidden = true;
    this.copyBtn.hidden = true;
    try {
      const report = await probeDevice(log);
      this.app.lights.rememberDevice(report);
      report.hints.forEach((h) => log(`→ ${h}`));
      this.report.textContent = JSON.stringify(report, null, 2);
      this.report.hidden = false;
      this.copyBtn.hidden = false;
      this.copyBtn.textContent = 'Copy report';
    } catch (err) {
      log(err?.name === 'NotFoundError' ? 'No device was chosen.' : `Scan failed: ${err?.message || err}`);
    }
    this.syncAll();
  }

  presetsTab() {
    const name = el('input', { type: 'text', class: 'name-in', placeholder: 'Name, e.g. Friday party', maxLength: 32, ariaLabel: 'Preset name' });
    const save = el('button', { type: 'button', class: 'primary', text: 'Save', onclick: () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      this.app.lights.savePreset(n);
      name.value = '';
      this.syncAll();
    } });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    this.presetList = el('div', { class: 'presets' });
    const reset = el('button', { type: 'button', class: 'mini', text: '↺ Reset the look', onclick: () => { this.app.lights.resetLook(); this.syncAll(); } });
    return el('div', { class: 'tab' },
      el('h3', { text: 'Save what is playing' }),
      el('div', { class: 'row' }, name, save),
      el('p', { class: 'note', text: 'Keeps the mode, palette, feel and lamp colours. Not the devices.' }),
      el('h3', { text: 'Presets' }),
      this.presetList,
      el('div', { class: 'row' }, reset),
      el('div', { class: 'about' },
        el('b', { text: 'LUMEN' }),
        el('span', { text: '© 2026 Rustem Tukhbetov. All rights reserved.' }),
        el('a', { href: 'https://creativeoglu.com', target: '_blank', rel: 'noopener', text: 'creativeoglu.com' }),
        el('a', { href: 'mailto:rustem@creativeoglu.com', text: 'rustem@creativeoglu.com' })));
  }

  // --- syncing ---------------------------------------------------------------------------

  syncAll() {
    this.syncers.forEach((f) => f());
    const s = this.s;
    this.modeNote.textContent = MODE_NOTES[s.mode] || '';
    this.strobeBox.hidden = s.mode !== 'strobe';
    this.manualBox.hidden = s.mode !== 'manual';
    this.pulseBox.hidden = s.mode !== 'pulse';
    this.artistBox.hidden = s.mode !== 'artist';
    this.flowBox.hidden = s.mode !== 'flow';
    this.sparkBox.hidden = s.mode !== 'spark';
    this.root.querySelector('.palette-block').hidden = ['pulse', 'manual', 'artist'].includes(s.mode);
    this.blackout.setAttribute('aria-pressed', String(s.blackout));
    // A small switch: the bulbs' confirmed state, or what the engine wants before the radio.
    this.previewNote.textContent = this.previewWanted ? 'Intent' : 'Bulbs';
    this.previewNote.setAttribute('aria-pressed', String(this.previewWanted));
    this.previewNote.title = this.previewWanted ? 'Showing what the engine wants, before the radio. Tap for what the bulbs got' : 'Showing what the bulbs got, after the radio delay. Tap for what the engine wants';
    this.presetList.replaceChildren(...Object.keys(s.presets).map((n) => el('div', { class: 'preset' },
      el('span', { text: n }),
      el('button', { type: 'button', class: 'mini', text: 'Load', onclick: () => { this.app.lights.loadPreset(n); this.syncAll(); } }),
      el('button', { type: 'button', class: 'mini', text: 'Delete', onclick: () => { this.app.lights.deletePreset(n); this.syncAll(); } }))));
    if (!Object.keys(s.presets).length) this.presetList.append(el('p', { class: 'note', text: 'Nothing saved yet.' }));
    this.known.replaceChildren(...(s.discovered.length ? s.discovered.map((d) => el('div', { class: 'known' },
      el('b', { text: d.name }), el('span', { class: 'dim', text: ` ${new Date(d.at).toLocaleString()}` }),
      el('div', { class: 'dim', text: d.hints?.[0] || `${d.services.length} services` }))) : [el('p', { class: 'note', text: 'No bulb scanned yet.' })]));
    this.syncLights();
    this.syncAudio();
  }

  syncLights() {
    const { lights } = this.app;
    this.devRows?.forEach((r) => {
      const st = lights.status[r.id];
      r.name.textContent = this.s.lamps[r.i].name;
      r.state.textContent = st.message && st.state === 'error' ? `${STATUS_TEXT[st.state]}` : STATUS_TEXT[st.state] || st.state;
      r.state.title = st.message || '';
      r.dot.dataset.state = st.state;
      const live = st.state === 'virtual' || st.state === 'connected';
      r.conn.textContent = live ? 'Disconnect' : 'Connect';
      r.conn.hidden = !lights.adapter;
      r.drop.hidden = lights.s.adapter !== 'mock' || !live;
    });
    this.syncStage();
  }

  syncStage() {
    this.bulbs?.forEach((b, i) => { b.node.title = this.s.lamps[i].name; });
  }

  syncAudio() {
    const { audio } = this.app;
    Object.entries(this.srcButtons).forEach(([k, b]) => b.setAttribute('aria-pressed', String(audio.mode === k)));
    // Only errors and waits get a line; the idle hint lives on the Mic button itself.
    this.audioStatus.textContent = audio.status.kind === 'ok' && audio.mode === 'demo' ? '' : audio.status.text;
    this.audioStatus.className = `status ${audio.status.kind}`;
    this.srcButtons.input.title = audio.mode === 'input' ? 'Listening through the microphone' : 'Tap to play the lamps to your music. Until then they follow a built-in beat';
  }

  lightFault(err) {
    this.fault.hidden = false;
    this.fault.textContent = `Lighting error: ${err?.message || err}. The music keeps going.`;
  }

  // --- every frame -----------------------------------------------------------------------

  tick(f) {
    const { lights, clock } = this.app;
    this.meter.style.transform = `scaleX(${f.level.toFixed(3)})`;
    this.led.classList.toggle('lit', f.env > 0.25);
    const now = performance.now();
    if (now - (this.slowAt || 0) > 250) {
      this.slowAt = now;
      this.bpm.textContent = clock.bpm ? `${Math.round(clock.bpm)} BPM${clock.usable ? '' : '?'}` : '— BPM';
      this.bpm.title = clock.label;
      const info = lights.showInfo();
      const s = this.s;
      let text = MODES[s.mode];
      if (s.mode === 'artist' && info.harmony) text = `Artist · ${info.harmony}`;
      if (s.mode === 'show' && info.look) text = `${LOOK_LABELS[info.look] || info.look}${info.mood === 'break' ? ' · break' : ''} · ${PALETTES[s.palette === 'auto' ? info.palette : s.palette]?.label || ''}`;
      if (s.blackout) text = 'Blackout';
      this.nowLook.textContent = text;
      const ms = Math.round(lights.measuredLatency());
      this.measured.textContent = ms ? `Use measured: ${ms} ms` : 'Measuring the delay…';
      this.measured.disabled = !ms;
      this.devRows.forEach((r) => {
        const st = lights.stats(r.i);
        r.stats.textContent = `${st.rate}/s · ${Math.round(st.latency)} ms · ${st.failed} failed`;
      });
    }
    this.bulbs.forEach((b, i) => {
      const state = this.previewWanted ? lights.wanted(i) : lights.shown(i);
      const rgb = state ? litRgb({ on: state.on, rgb: state.rgb, bri: state.bri }) : [0, 0, 0];
      const css = `rgb(${rgb.map((c) => Math.round(c * 255)).join(',')})`;
      const k = Math.max(...rgb);
      b.core.style.background = k > 0.01 ? css : '#1c1c22';
      b.core.style.boxShadow = k > 0.01 ? `0 0 ${6 + k * 26}px ${k * 3}px ${css}` : 'none';
    });
  }
}
