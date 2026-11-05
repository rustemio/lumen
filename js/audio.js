// Local audio analysis, taken from PULSE. Nothing here records, stores or transmits audio:
// the input only ever reaches an AnalyserNode, whose frequency bins are read once per frame.

const BPM = 124;
const STEP = 60 / BPM / 4;
const BARS = 16;

// One bar of 16 steps. The last two bars of each 16 are a break, so the music has real pauses.
const KICK = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const CLAP = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
const HAT = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1];
const BASS = [36, 0, 0, 36, 0, 0, 36, 0, 39, 0, 0, 36, 0, 34, 0, 0];
const STAB = [0, 0, 0, 63, 0, 0, 0, 0, 0, 0, 63, 0, 0, 0, 0, 0];

const SPECTRUM_BANDS = 32;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const isBreak = (bar) => bar % BARS >= BARS - 2;

class DemoSynth {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.nextStep = 0;
    this.timer = null;
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  start(atStep = 0) {
    this.stepIndex = atStep;
    this.nextStep = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.schedule(), 40);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  schedule() {
    while (this.nextStep < this.ctx.currentTime + 0.14) {
      this.playStep(this.stepIndex, this.nextStep);
      this.stepIndex++;
      this.nextStep += STEP;
    }
  }

  playStep(i, t) {
    const s = i % 16;
    const bar = Math.floor(i / 16);
    const brk = isBreak(bar);
    if (!brk && KICK[s]) this.kick(t);
    if (!brk && CLAP[s]) this.burst(t, 1400, 0.16, 0.34, 'bandpass');
    if (HAT[s]) this.burst(t, 8000, 0.05, brk ? 0.1 : 0.2, 'highpass');
    if (!brk && BASS[s]) this.bass(t, midi(BASS[s]));
    if (STAB[s]) this.stab(t, midi(STAB[s]), brk ? 0.2 : 0.11);
  }

  env(g, t, peak, decay) {
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
  }

  kick(t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
    this.env(g, t, 1, 0.28);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + 0.3);
  }

  burst(t, freq, decay, peak, type) {
    const n = this.ctx.createBufferSource();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    n.buffer = this.noise;
    n.loop = true;
    f.type = type;
    f.frequency.value = freq;
    this.env(g, t, peak, decay);
    n.connect(f).connect(g).connect(this.out);
    n.start(t, Math.random() * 0.8); n.stop(t + decay + 0.02);
  }

  bass(t, freq) {
    const o = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 0.16);
    this.env(g, t, 0.34, 0.2);
    o.connect(f).connect(g).connect(this.out);
    o.start(t); o.stop(t + 0.22);
  }

  stab(t, freq, peak) {
    [1, 1.5, 2.01].forEach((r) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq * r;
      this.env(g, t, peak, 0.26);
      o.connect(g).connect(this.out);
      o.start(t); o.stop(t + 0.28);
    });
  }
}

// Same pattern as the synth, as data. Browsers keep audio suspended until the first user gesture,
// so until then the demo drives the visuals from this model and the stage is alive from the first frame.
class DemoModel {
  constructor() { this.t = 0; this.lastStep = -1; this.env = { kick: 0, hat: 0, mid: 0 }; }

  update(dt) {
    this.t += dt;
    const i = Math.floor(this.t / STEP);
    const fall = (x, tau) => x * Math.exp(-dt / tau);
    this.env.kick = fall(this.env.kick, 0.09);
    this.env.hat = fall(this.env.hat, 0.03);
    this.env.mid = fall(this.env.mid, 0.12);
    let hit = 0;
    if (i !== this.lastStep) {
      this.lastStep = i;
      const s = i % 16;
      const brk = isBreak(Math.floor(i / 16));
      if (!brk && KICK[s]) { this.env.kick = 1; hit = 0.85; }
      if (!brk && CLAP[s]) this.env.mid = 1;
      if (!brk && BASS[s] && !KICK[s]) { this.env.kick = Math.max(this.env.kick, 0.55); hit = 0.3; }
      if (STAB[s]) this.env.mid = Math.max(this.env.mid, 0.6);
      if (HAT[s]) this.env.hat = brk ? 0.5 : 1;
    }
    const { kick, hat, mid } = this.env;
    return { bass: kick, mid, high: hat, level: Math.min(1, kick * 0.7 + mid * 0.25 + hat * 0.12), hit };
  }
}

const BASS_HZ = 120;
const GATE_DB = -58;            // quieter than this is silence, whatever it does
const LOOKBACK = 0.14;          // seconds a rise is measured over
const MIN_RISE_DB = 3;          // a smaller rise is not an attack at all
const REARM_DB = 4;             // a sustained 808 must fall this far before it can hit again
const NEAR_PEAK_DB = 15;        // how far under the loudest recent hit still counts
const ATTACK_WINDOW = 0.12;     // seconds a hit may keep growing
const SHARE_DB = 7;             // bass this far under the full mix still counts in full

// Finds hits in the bass band only. The strength of a hit is how far the bass jumped and how
// close it landed to the loudest bass of the last few seconds, so a quiet verse does not fire
// but a verse's real drop does, whatever the mix's overall level.
export class BassHitDetector {
  constructor() { this.reset(); }

  reset() {
    this.peak = -40;
    this.history = [];
    this.armed = true;
    this.id = 0;
    this.strength = 0;
    this.start = -10;
    this.attackPeak = -200;
  }

  // levelDb is the whole mix: a bump that is tiny next to everything else is not a bass hit.
  update(t, dt, db, levelDb) {
    const h = this.history;
    h.push(t, db);
    while (h.length > 2 && h[0] < t - LOOKBACK) h.splice(0, 2);
    let low = db;
    for (let i = 1; i < h.length; i += 2) low = Math.min(low, h[i]);
    const rise = db - low;
    this.peak = Math.max(db, this.peak - dt * 1.2, GATE_DB);

    // Small bumps from a vocal must not block the real hit that follows: once an attack has had its
    // window, a clear new high starts another even though the level never fell in between.
    const past = t - this.start > ATTACK_WINDOW && db > this.attackPeak + MIN_RISE_DB;
    if ((this.armed || past) && db > GATE_DB && rise >= MIN_RISE_DB) {
      this.armed = false;
      this.id++;
      this.start = t;
      this.attackPeak = db;
      this.strength = 0;
    }
    if (!this.armed) {
      this.attackPeak = Math.max(this.attackPeak, db);
      if (db < this.attackPeak - REARM_DB) this.armed = true;
    }
    if (t - this.start <= ATTACK_WINDOW) {
      const near = Math.max(0, 1 - (this.peak - db) / NEAR_PEAK_DB);
      const jump = Math.min(1, Math.max(0, (rise - MIN_RISE_DB) / 15));
      const share = Math.max(0, Math.min(1, 1 - (levelDb - db - SHARE_DB) / 10));
      this.strength = Math.max(this.strength, near * share * (0.3 + 0.7 * jump));
    } else {
      this.strength = 0;
    }
    return this.strength;
  }
}

// One band as 0..1: 1 at its recent peak, 0 at its steady noise floor. Room noise and a constantly
// loud mix both sit near 0, so what moves the visuals is the music moving, not its volume.
class BandLevel {
  constructor(range) {
    this.range = range;
    this.reset();
  }

  reset() {
    this.peak = -40;
    this.floor = -70;
  }

  update(dt, db, autoLevel) {
    this.peak = Math.max(db, this.peak - dt * 1.2, GATE_DB);
    this.floor = db < this.floor ? db : this.floor + dt * 0.6;
    const top = autoLevel ? this.peak : -6;
    const bottom = Math.max(top - this.range, Math.min(this.floor + 3, top - 3));
    const v = Math.max(0, Math.min(1, (db - bottom) / (top - bottom)));
    return v * v;
  }
}

// Called by an engine each frame. Each hit is handed out once, when it is strong enough for it.
export function takeHit(owner, f, threshold) {
  if (f.hitId === owner.lastHitId || f.hit <= 0 || f.hit < threshold) return 0;
  owner.lastHitId = f.hitId;
  return f.hit;
}

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.mode = 'demo';               // 'demo' | 'input' | 'system' | 'file'
    this.retry = () => this.useInput();
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.deviceId = '';
    this.devices = [];
    this.status = { kind: 'ok', text: '' };
    this.onChange = () => {};
    this.demo = null;
    this.model = new DemoModel();
    this.modelSteps = 0;
    this.f = { level: 0, bass: 0, mid: 0, high: 0, hit: 0, hitId: 0, lastHit: 0, beat: 0, env: 0, bpm: 0, live: false, spectrum: new Float32Array(SPECTRUM_BANDS) };
    this.detector = new BassHitDetector();
    this.levels = { bass: new BandLevel(30), mid: new BandLevel(30), high: new BandLevel(30), level: new BandLevel(36) };
    this.spectrumTop = -30;
    this.beatId = 0;
    this.modelHitId = 0;
    this.beatTimes = [];
    this.lastBeat = 0;
    this.now = 0;
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => this.refreshDevices());
    }
  }

  ensureGraph() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.inputGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.55;
    this.analyser.minDecibels = -100;
    this.bins = new Float32Array(this.analyser.frequencyBinCount);
    this.inputGain.connect(this.analyser);
    // Each band gets real filters and its own loudness meter, so a hi-hat cannot reach the bass reading.
    const c = this.ctx;
    const filter = (type, freq) => {
      const n = c.createBiquadFilter();
      n.type = type;
      n.frequency.value = freq;
      n.Q.value = 0.707;
      return n;
    };
    const meter = (size, ...chain) => {
      const a = c.createAnalyser();
      a.fftSize = size;
      a.smoothingTimeConstant = 0;
      [this.inputGain, ...chain].reduce((prev, node) => prev.connect(node));
      chain[chain.length - 1].connect(a);
      return { node: a, data: new Float32Array(size) };
    };
    this.meters = {
      // Two low-pass stages make a 24 dB per octave slope: vocals and snares fall off fast.
      bass: meter(2048, filter('highpass', 28), filter('lowpass', BASS_HZ), filter('lowpass', BASS_HZ)),
      mid: meter(1024, filter('highpass', 300), filter('lowpass', 2500)),
      high: meter(1024, filter('highpass', 4000)),
      level: meter(1024, c.createGain()),
    };
    this.demoBus = this.ctx.createGain();
    this.demoBus.connect(this.inputGain);
    // Monitor path is demo-only. A live input is never routed to the speakers, so no feedback.
    this.monitor = this.ctx.createGain();
    this.monitor.gain.value = this.settings.monitor ? 0.8 : 0;
    this.demoBus.connect(this.monitor).connect(this.ctx.destination);
    this.demo = new DemoSynth(this.ctx, this.demoBus);
    this.applyGain();
  }

  // Called on the first gesture and again on any later one, for browsers that re-suspend audio.
  async unlock() {
    this.ensureGraph();
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { return; }
    }
    if (this.mode === 'demo' && !this.demo.timer && this.ctx.state === 'running') {
      this.demo.start(this.model.lastStep + 1);
      this.onChange();
    }
  }

  // A music file from this computer, played through the speakers and analysed as it plays.
  async useFile(file) {
    this.retry = () => {};
    this.closeStream();
    await this.unlock();
    if (!this.ctx) return false;
    this.demo?.stop();
    if (!this.player) {
      this.player = new Audio();
      this.player.loop = true;
      this.playerNode = this.ctx.createMediaElementSource(this.player);
      this.playerGain = this.ctx.createGain();
      this.playerNode.connect(this.playerGain);
      this.playerGain.connect(this.ctx.destination);
    }
    if (this.fileUrl) URL.revokeObjectURL(this.fileUrl);
    this.fileUrl = URL.createObjectURL(file);
    this.player.src = this.fileUrl;
    this.playerGain.connect(this.inputGain);
    this.mode = 'file';
    this.fileName = file.name;
    this.resetAnalysis();
    try {
      await this.player.play();
      this.setStatus('ok', `Playing ${file.name}`);
      return true;
    } catch (err) {
      this.setStatus('error', `Could not play this file (${err?.name || 'unknown error'}).`);
      return false;
    }
  }

  stopFile() {
    if (!this.player) return;
    this.player.pause();
    try { this.playerGain.disconnect(this.inputGain); } catch { /* not connected */ }
  }

  applyGain() {
    if (this.inputGain) this.inputGain.gain.value = Math.pow(10, this.settings.gain / 20);
  }

  setMonitor(on) {
    this.settings.monitor = on;
    if (this.monitor) this.monitor.gain.value = on ? 0.8 : 0;
  }

  useDemo() {
    this.closeStream();
    this.mode = 'demo';
    this.resetAnalysis();
    this.setStatus('ok', '');
    this.unlock();
  }

  closeStream() {
    if (this.mode === 'file') this.stopFile();
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  setStatus(kind, text) {
    this.status = { kind, text };
    this.onChange();
  }

  // Connects a captured stream to the analyser. Whatever it is, it never reaches the speakers.
  attachStream(stream, mode, endedMessage) {
    this.closeStream();
    this.stream = stream;
    this.ensureGraph();
    this.demo?.stop();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.inputGain);
    this.mode = mode;
    this.resetAnalysis();
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      this.useDemo();
      this.setStatus('error', endedMessage);
    });
  }

  async useInput(deviceId = this.deviceId) {
    this.retry = () => this.useInput();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.setStatus('error', 'Live input needs HTTPS or localhost. The demo signal keeps running.');
      return false;
    }
    await this.unlock();
    this.setStatus('wait', 'Waiting for browser permission…');
    const audio = {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      this.attachStream(stream, 'input', 'The input device was disconnected. Back on the demo signal.');
      this.deviceId = stream.getAudioTracks()[0]?.getSettings().deviceId || deviceId || '';
      await this.refreshDevices();
      this.setStatus('ok', '');
      return true;
    } catch (err) {
      this.setStatus('error', AudioEngine.describeError(err));
      if (this.mode === 'demo') this.unlock();
      return false;
    }
  }

  get systemAudioSupported() {
    return !!navigator.mediaDevices?.getDisplayMedia && matchMedia('(pointer: fine)').matches;
  }

  // Computer audio goes through the browser's screen-share prompt, the only door a web page has
  // to it. The picture is dropped immediately: only the sound is analysed.
  async useSystem() {
    this.retry = () => this.useSystem();
    if (!this.systemAudioSupported) {
      this.setStatus('error', 'A phone browser cannot listen to the phone’s own sound. Use Mic here, or open LUMEN in Chrome or Edge on a computer and choose Computer there.');
      return false;
    }
    await this.unlock();
    this.setStatus('wait', 'In the share window, choose Entire Screen and turn on system audio. For music in a browser tab, choose that tab and turn on tab audio.');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
      });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        this.setStatus('error', 'No sound was shared. Try again and turn on the audio switch in the share window. A single app window cannot share sound. The demo signal keeps running.');
        if (this.mode === 'demo') this.unlock();
        return false;
      }
      stream.getVideoTracks().forEach((t) => t.stop());
      this.attachStream(stream, 'system', 'Computer audio sharing stopped. Back on the demo signal.');
      this.setStatus('ok', 'Listening to computer audio. Your music keeps playing as normal.');
      return true;
    } catch (err) {
      this.setStatus('error', AudioEngine.describeShareError(err));
      if (this.mode === 'demo') this.unlock();
      return false;
    }
  }

  static describeShareError(err) {
    if (err?.name === 'NotAllowedError' && /system/i.test(err.message || '')) {
      return 'macOS is blocking capture for this browser. Allow it in System Settings, Privacy & Security, Screen & System Audio Recording, then restart the browser and try again.';
    }
    if (err?.name === 'NotAllowedError') return 'Sharing was cancelled. The demo signal keeps running.';
    return `Could not share computer audio (${err?.name || 'unknown error'}).`;
  }

  static describeError(err) {
    switch (err?.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Microphone access was denied. Allow it in your browser’s site settings, then try again. The demo signal keeps running.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No audio input was found. Connect a device, then try again. The demo signal keeps running.';
      case 'NotReadableError':
      case 'AbortError':
        return 'The input is busy or unavailable. Close other apps using it, then try again.';
      default:
        return `Could not open the input (${err?.name || 'unknown error'}).`;
    }
  }

  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.devices = all.filter((d) => d.kind === 'audioinput');
    } catch { this.devices = []; }
    this.onChange();
  }

  resetAnalysis() {
    this.beatTimes.length = 0;
    this.f.bpm = 0;
    this.f.lastHit = 0;
    this.detector.reset();
    Object.values(this.levels).forEach((l) => l.reset());
    this.spectrumTop = -30;
  }

  get usingModel() {
    return this.mode === 'demo' && !(this.ctx && this.ctx.state === 'running' && this.demo?.timer);
  }

  // Loudness of one filtered band over its last few milliseconds, in dB.
  meterDb(name) {
    const m = this.meters[name];
    m.node.getFloatTimeDomainData(m.data);
    let sum = 0;
    for (let i = 0; i < m.data.length; i++) sum += m.data[i] * m.data[i];
    return 10 * Math.log10(sum / m.data.length + 1e-12);
  }

  // Average loudness of a span of FFT bins, in dB.
  binsDb(fromHz, toHz) {
    const hzPerBin = this.ctx.sampleRate / this.analyser.fftSize;
    const a = Math.max(1, Math.floor(fromHz / hzPerBin));
    const b = Math.min(this.bins.length - 1, Math.ceil(toHz / hzPerBin));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += Math.pow(10, Math.max(this.bins[i], -100) / 10);
    return 10 * Math.log10(sum / (b - a + 1) + 1e-12);
  }

  update(dt) {
    this.now += dt;
    const f = this.f;
    const prevHitId = f.hitId;
    let raw;
    if (this.usingModel) {
      raw = this.model.update(dt);
      if (raw.hit > 0) this.modelHitId++;
      f.hitId = this.modelHitId;
      f.hit = raw.hit;
    } else {
      const auto = this.settings.autoLevel;
      const bassDb = this.meterDb('bass');
      const levelDb = this.meterDb('level');
      raw = {
        bass: this.levels.bass.update(dt, bassDb, auto),
        mid: this.levels.mid.update(dt, this.meterDb('mid'), auto),
        high: this.levels.high.update(dt, this.meterDb('high'), auto),
        level: this.levels.level.update(dt, levelDb, auto),
      };
      f.hit = this.detector.update(this.now, dt, bassDb, levelDb);
      f.hitId = this.detector.id;
    }

    const release = Math.max(0.001, this.settings.smoothing / 1000);
    const follow = (cur, x) => (x > cur ? x : cur + (x - cur) * (1 - Math.exp(-dt / release)));
    f.bass = follow(f.bass, raw.bass);
    f.mid = follow(f.mid, raw.mid);
    f.high = follow(f.high, raw.high);
    f.level = follow(f.level, raw.level);
    f.live = !this.usingModel;

    // A beat is a hit that is clearly there. It is reported once, as soon as it qualifies.
    f.beat = 0;
    if (f.hit >= 0.3 && f.hitId !== this.beatId) {
      this.beatId = f.hitId;
      f.beat = Math.min(1, 0.55 + f.hit);
      this.trackTempo();
    }
    if (f.hit > 0) {
      f.env = Math.max(f.env, Math.min(1, 0.3 + f.hit * 0.7));
      f.lastHit = Math.max(f.hitId !== prevHitId ? 0 : f.lastHit, f.hit);
    }
    f.env *= Math.exp(-dt / 0.16);
    this.updateSpectrum(dt, raw);
    return f;
  }

  // Log-spaced bands with fast attack and slow fall, as a level display behaves.
  updateSpectrum(dt, raw) {
    const out = this.f.spectrum;
    const fall = Math.exp(-dt / 0.14);
    if (!this.usingModel) this.analyser.getFloatFrequencyData(this.bins);
    let loudest = -100;
    for (let i = 0; i < SPECTRUM_BANDS; i++) {
      const u = i / (SPECTRUM_BANDS - 1);
      let v;
      if (this.usingModel) {
        const wob = 0.75 + 0.25 * Math.sin(this.now * (3 + i * 0.7) + i * 2.1);
        v = (raw.bass * Math.exp(-u * 4.5) + raw.mid * 0.75 * Math.exp(-((u - 0.45) ** 2) * 22) + raw.high * 0.6 * Math.exp(-((u - 0.85) ** 2) * 30)) * wob;
      } else {
        const db = this.binsDb(40 * Math.pow(350, u), 40 * Math.pow(350, u + 1 / SPECTRUM_BANDS));
        loudest = Math.max(loudest, db);
        const top = this.settings.autoLevel ? this.spectrumTop : -20;
        const x = Math.max(0, Math.min(1, (db - (top - 42)) / 42));
        v = x * x;
      }
      out[i] = Math.max(v, out[i] * fall);
    }
    if (!this.usingModel) this.spectrumTop = Math.max(loudest, this.spectrumTop - dt * 1.5, -70);
  }

  // Median inter-onset interval, folded into a DJ's usual tempo range.
  trackTempo() {
    const b = this.beatTimes;
    b.push(this.now);
    if (b.length > 24) b.shift();
    if (b.length < 6) return;
    const ioi = [];
    for (let i = 1; i < b.length; i++) ioi.push(b[i] - b[i - 1]);
    ioi.sort((x, y) => x - y);
    let bpm = 60 / ioi[ioi.length >> 1];
    while (bpm < 80) bpm *= 2;
    while (bpm > 170) bpm /= 2;
    this.f.bpm = bpm;
  }
}
