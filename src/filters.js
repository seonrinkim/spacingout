// 스무딩/통계 도구. 시간 단위는 초.

// One Euro filter: 느린 움직임은 강하게, 빠른 움직임(사카드)은 약하게 스무딩한다.
export class OneEuro {
  constructor(minCutoff = 1, beta = 0, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x, t) {
    if (this.x === null) {
      this.x = x;
      this.t = t;
      return x;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (x - this.x);
    return this.x;
  }
}

// 시간 상수 기반 지수 이동 평균
export class EMA {
  constructor(tau = 1) {
    this.tau = tau;
    this.v = null;
  }
  reset() {
    this.v = null;
  }
  update(x, dt) {
    if (this.v === null) return (this.v = x);
    const a = 1 - Math.exp(-dt / Math.max(1e-3, this.tau));
    this.v += a * (x - this.v);
    return this.v;
  }
}

// 최근 maxAge 초만 보관하는 시계열
export class Series {
  constructor(maxAge) {
    this.maxAge = maxAge;
    this.t = [];
    this.v = [];
  }
  push(t, v) {
    this.t.push(t);
    this.v.push(v);
    this.prune(t);
  }
  prune(now) {
    let i = 0;
    while (i < this.t.length && now - this.t[i] > this.maxAge) i++;
    if (i) {
      this.t.splice(0, i);
      this.v.splice(0, i);
    }
  }
  clear() {
    this.t.length = 0;
    this.v.length = 0;
  }
  get length() {
    return this.t.length;
  }
  span() {
    return this.t.length ? this.t[this.t.length - 1] - this.t[0] : 0;
  }
  // 시각 t 이전(포함)의 가장 최근 값
  valueAt(t) {
    for (let i = this.t.length - 1; i >= 0; i--) if (this.t[i] <= t) return this.v[i];
    return this.v[0];
  }
  // 시각 since 이후의 값들
  since(since) {
    const out = [];
    for (let i = this.t.length - 1; i >= 0 && this.t[i] >= since; i--) out.push(this.v[i]);
    return out;
  }
}

// 온라인 평균/표준편차
export class Welford {
  constructor() {
    this.reset();
  }
  reset() {
    this.n = 0;
    this.mean = 0;
    this.m2 = 0;
  }
  push(x) {
    if (!Number.isFinite(x)) return;
    this.n++;
    const d = x - this.mean;
    this.mean += d / this.n;
    this.m2 += d * (x - this.mean);
  }
  get std() {
    return this.n > 1 ? Math.sqrt(this.m2 / (this.n - 1)) : 0;
  }
}
