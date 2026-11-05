// The musical clock behind quantized scene changes. It only claims a beat grid when it has one:
// a manual or tapped tempo, or an analysed tempo whose beats are arriving evenly.

const TAP_RESET_S = 2.2;
const BEATS_PER_BAR = 4;
const LOCK_WINDOW = 12;

export class Clock {
  constructor(settings) {
    this.settings = settings;
    this.now = 0;
    this.phaseAt = 0;     // a moment that falls exactly on a beat
    this.barAt = 0;       // a moment that falls exactly on bar one
    this.taps = [];
    this.iois = [];
    this.lastBeat = -10;
    this.autoBpm = 0;
    this.autoConfidence = 0;
    this.lastHeard = -100;
    this.lastLock = -100;
  }

  get bpm() { return this.settings.mode === 'manual' ? this.settings.bpm : this.autoBpm; }

  // Usable only with a tempo and, for analysed audio, beats that have been regular and recent.
  get usable() {
    if (this.settings.mode === 'manual') return this.settings.bpm > 0;
    return this.autoBpm > 0 && this.autoConfidence >= 0.7 && this.now - this.lastHeard < 4;
  }

  get label() {
    if (this.settings.mode === 'manual') return `${this.settings.bpm.toFixed(2)} BPM, manual`;
    if (!this.autoBpm) return 'No tempo found yet';
    const n = Math.round(this.autoConfidence * 100);
    return this.usable ? `~${this.autoBpm.toFixed(1)} BPM, locked ${n}%` : `~${this.autoBpm.toFixed(1)} BPM, not steady enough (${n}%)`;
  }

  update(dt, f) {
    this.now += dt;
    if (f.beat > 0) this.heardBeat(f);
  }

  heardBeat(f) {
    const gap = this.now - this.lastBeat;
    this.lastBeat = this.now;
    this.lastHeard = this.now;
    if (gap > 0.15 && gap < 3) {
      this.iois.push(gap);
      if (this.iois.length > LOCK_WINDOW) this.iois.shift();
    }
    if (f.bpm) {
      this.autoBpm = f.bpm;
      // Music hits between the beats too, so gaps are judged against a sixteenth-note grid. Random
      // hits land on it about one time in five, far below what counts as locked.
      const sixteenth = 15 / f.bpm;
      const fits = this.iois.filter((g) => {
        const n = Math.max(1, Math.round(g / sixteenth));
        return Math.abs(g - n * sixteenth) < sixteenth * 0.12;
      }).length;
      const full = Math.min(1, this.iois.length / 8);
      this.autoConfidence = this.iois.length ? (fits / this.iois.length) * full : 0;
    }
    // Only strong hits set the beat grid: the lighter ones are often off the beat.
    if (this.settings.mode === 'auto' && this.autoBpm && f.hit >= 0.6) {
      const beat = 60 / this.autoBpm;
      const off = ((this.now - this.phaseAt + beat / 2) % beat + beat) % beat - beat / 2;
      if (this.now - this.lastLock > 4) this.phaseAt = this.now;
      else if (Math.abs(off) < beat * 0.2) this.phaseAt += off * 0.25;
      this.lastLock = this.now;
    }
  }

  tap() {
    const t = this.now;
    if (this.taps.length && t - this.taps[this.taps.length - 1] > TAP_RESET_S) this.taps.length = 0;
    this.taps.push(t);
    if (this.taps.length > 8) this.taps.shift();
    this.phaseAt = t;
    if (this.taps.length >= 2) {
      const span = this.taps[this.taps.length - 1] - this.taps[0];
      const bpm = 60 / (span / (this.taps.length - 1));
      this.settings.mode = 'manual';
      this.settings.bpm = Math.round(Math.min(240, Math.max(40, bpm)) * 100) / 100;
    }
    return this.taps.length;
  }

  // Makes the moment of this press bar one, for a performer who wants to set the downbeat.
  downbeat() {
    this.phaseAt = this.now;
    this.barAt = this.now;
  }

  // Seconds until the next beat or bar line, or null when no grid can be trusted.
  until(unit) {
    if (!this.usable) return null;
    const beat = 60 / this.bpm;
    const size = unit === 'bar' ? beat * BEATS_PER_BAR : beat;
    const origin = unit === 'bar' ? this.nearestBeat(this.barAt) : this.phaseAt;
    const pos = ((this.now - origin) % size + size) % size;
    const left = size - pos;
    return left < 0.012 ? left + size : left;
  }

  nearestBeat(t) {
    const beat = 60 / this.bpm;
    return this.phaseAt + Math.round((t - this.phaseAt) / beat) * beat;
  }

  // 0 to 1 through the current beat, for the LFOs and the beat indicator.
  get beatPhase() {
    const b = this.bpm;
    if (!b) return 0;
    const beat = 60 / b;
    return (((this.now - this.phaseAt) % beat) + beat) % beat / beat;
  }
}
