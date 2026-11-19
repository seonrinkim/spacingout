// 관객별 캘리브레이션 (세션 시작/종료는 people.js)
import { Welford } from './filters.js';
import { STD_FLOOR } from './signals.js';

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
