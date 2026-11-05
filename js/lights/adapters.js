// The one door between the Lighting Engine and a real or virtual bulb. The engine, the music
// modes and the panel only ever talk to this contract, so a confirmed Bluetooth protocol, or a
// bridge on another machine, can be added later without touching any of them.
//
// A lamp state is { on, rgb: [r, g, b] 0..1, bri 0..1, white, kelvin }. With white on, the bulb
// is asked for white light at that colour temperature and rgb is only the preview's guess.
//
// Status values: 'virtual' | 'disconnected' | 'connecting' | 'connected' | 'error'.

export class LightDeviceAdapter {
  constructor() {
    this.kind = 'base';
    this.label = 'No adapter';
    this.onStatus = () => {};      // (lampId, status, message) => void
  }

  // Whether this adapter can work in this browser at all, with a reason when it cannot.
  support() { return { ok: false, reason: 'Not implemented.' }; }

  async connect(lampId) { throw new Error(`${this.label} cannot connect ${lampId}.`); }

  async disconnect(lampId) { this.onStatus(lampId, 'disconnected', ''); }

  // Resolves once the transport has accepted the command. The scheduler measures that time.
  // A rejection is a failed write: the scheduler counts it and the engine may reconnect.
  async send(lampId, state) { throw new Error(`${this.label} cannot send to ${lampId}.`); }

  // What the bulb is showing as far as this adapter knows, for the preview. Null when unknown.
  shown(lampId) { return null; }
}

// Three bulbs that exist only in this page. They behave like slow radio devices: each command
// takes a while to arrive, only one is in flight at a time, and a lamp can drop off on request,
// so the scheduler, the reconnect logic and the preview can all be tested without hardware.
export class MockAdapter extends LightDeviceAdapter {
  constructor(settings) {
    super();
    this.kind = 'mock';
    this.label = 'Virtual bulbs';
    this.settings = settings;            // { delay ms, jitter ms, fade ms }
    this.lamps = new Map();
  }

  support() { return { ok: true, reason: '' }; }

  lamp(id) {
    if (!this.lamps.has(id)) this.lamps.set(id, { connected: false, state: null, dropNext: false });
    return this.lamps.get(id);
  }

  async connect(id) {
    const l = this.lamp(id);
    this.onStatus(id, 'connecting', '');
    await wait(250 + Math.random() * 250);
    l.connected = true;
    l.dropNext = false;
    this.onStatus(id, 'virtual', '');
  }

  async disconnect(id) {
    this.lamp(id).connected = false;
    this.onStatus(id, 'disconnected', '');
  }

  // For testing: the next command to this lamp fails as if it went out of range.
  simulateDrop(id) { this.lamp(id).dropNext = true; }

  async send(id, state) {
    const l = this.lamp(id);
    if (!l.connected) throw new Error('Not connected');
    const { delay, jitter } = this.settings;
    await wait(delay + Math.random() * jitter);
    if (l.dropNext) {
      l.connected = false;
      l.dropNext = false;
      this.onStatus(id, 'error', 'Virtual lamp dropped off (simulated).');
      throw new Error('Simulated drop');
    }
    // A bulb that fades by itself starts each change from wherever it is showing now.
    l.from = this.shown(id);
    l.at = performance.now();
    l.state = { ...state, rgb: [...state.rgb] };
  }

  shown(id) {
    const l = this.lamp(id);
    const fade = this.settings.fade || 0;
    if (!l.state || !l.from || !fade) return l.state;
    const k = Math.min(1, (performance.now() - l.at) / fade);
    if (k >= 1) return l.state;
    const m = (a, b) => a + (b - a) * k;
    return { ...l.state, bri: m(l.from.bri, l.state.bri), rgb: l.state.rgb.map((c, i) => m(l.from.rgb[i], c)) };
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
