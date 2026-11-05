// Sends lamp states without flooding the radio. Per lamp it keeps only the newest wanted state,
// so a state the radio had no time for is replaced, never queued. One command per lamp is in
// flight at a time, each lamp has its own rate limit, and all lamps share a budget per second.

import { stateDistance } from './color.js';

export class Scheduler {
  constructor(settings) {
    this.settings = settings;     // { rate per lamp per second, budget per second, threshold 0..1 }
    this.lanes = new Map();
    this.tokens = 0;
    this.lastRefill = performance.now();
  }

  lane(id) {
    if (!this.lanes.has(id)) {
      this.lanes.set(id, {
        pending: null, sent: null, busy: false, lastAt: 0,
        stats: { sent: 0, replaced: 0, failed: 0, latency: 0, latencyN: 0, window: [] },
      });
    }
    return this.lanes.get(id);
  }

  // Called every frame with what the lamp should show now.
  want(id, state) {
    const l = this.lane(id);
    if (l.pending) l.stats.replaced++;
    l.pending = state;
  }

  clear(id) {
    const l = this.lane(id);
    l.pending = null;
    l.sent = null;
  }

  // Sends what is due. send(id, state) returns a promise; onFail(id, err) is told about failures.
  pump(send, canSend, onFail) {
    const now = performance.now();
    const { rate, budget, threshold } = this.settings;
    this.tokens = Math.min(budget, this.tokens + ((now - this.lastRefill) / 1000) * budget);
    this.lastRefill = now;
    for (const [id, l] of this.lanes) {
      if (!l.pending || l.busy || !canSend(id)) continue;
      if (now - l.lastAt < 1000 / rate) continue;
      // A small change is not worth airtime, but the lamp still gets the final value within a second.
      const far = stateDistance(l.pending, l.sent);
      if (far < 0.002) { l.pending = null; continue; }
      if (far < threshold && now - l.lastAt < 1000) { l.pending = null; continue; }
      if (this.tokens < 1) break;
      this.tokens -= 1;
      const state = l.pending;
      l.pending = null;
      l.busy = true;
      l.lastAt = now;
      const t0 = performance.now();
      Promise.resolve()
        .then(() => send(id, state))
        .then(() => {
          const ms = performance.now() - t0;
          const s = l.stats;
          s.sent++;
          s.latency = s.latencyN ? s.latency * 0.9 + ms * 0.1 : ms;
          s.latencyN++;
          s.window.push(performance.now());
          l.sent = state;
        })
        .catch((err) => { l.stats.failed++; l.sent = null; onFail(id, err); })
        .finally(() => { l.busy = false; });
    }
  }

  // Commands per second actually delivered to one lamp over the last second.
  rateOf(id) {
    const w = this.lane(id).stats.window;
    const cut = performance.now() - 1000;
    while (w.length && w[0] < cut) w.shift();
    return w.length;
  }
}
