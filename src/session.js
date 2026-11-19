// 관객 세션(얼굴 등장/퇴장)과 캘리브레이션
import { Welford } from './filters.js';
import { STD_FLOOR } from './signals.js';

export class Presence {
  constructor(cfg) {
    this.cfg = cfg;
    this.reset();
  }
  reset() {
    this.active = false;
    this.presentSince = null;
    this.lastSeen = null;
    this.t0 = null;
    this.startedAt = null;
  }
  // 반환: 'start' | 'end' | null
  update(hasFace, t) {
    const c = this.cfg;
    if (hasFace) {
      if (this.presentSince === null || (this.lastSeen !== null && t - this.lastSeen > c.presenceGapTolerance)) {
        if (!this.active) this.presentSince = t;
      }
      this.lastSeen = t;
      if (!this.active && t - this.presentSince >= c.sessionStart) {
        this.active = true;
        this.startedAt = t;
        this.t0 = c.t0AtFirstDetection ? this.presentSince : t;
        return 'start';
      }
    } else if (this.active && this.lastSeen !== null && t - this.lastSeen >= c.sessionEnd) {
      const lastSeen = this.lastSeen;
      this.reset();
      this.endedLastSeen = lastSeen;
      return 'end';
    } else if (!this.active && this.lastSeen !== null && t - this.lastSeen > c.presenceGapTolerance) {
      this.presentSince = null;
    }
    return null;
  }
}

export const BASELINE_KEYS = ['yaw', 'pitch', 'gazeX', 'gazeY', 'dispersion', 'fixationDuration', 'blinkRate', 'movement'];

export class Calibrator {
  constructor() {
    this.reset();
  }
  reset() {
    this.stats = Object.fromEntries(BASELINE_KEYS.map((k) => [k, new Welford()]));
  }
  push(f) {
    for (const k of BASELINE_KEYS) this.stats[k].push(f[k]);
  }
  get samples() {
    return this.stats.yaw.n;
  }
  finish() {
    const out = {};
    for (const k of BASELINE_KEYS) {
      const w = this.stats[k];
      out[k] = { mean: w.n ? w.mean : 0, std: Math.max(w.std, STD_FLOOR[k] ?? 1e-3), n: w.n };
    }
    return out;
  }
}
