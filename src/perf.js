// 성능 단계. 프레임 처리 시간이 예산을 넘으면 순서대로 낮춘다:
//   1~2: 격자 축소 → 3: maskMode voronoi → 4~: 가장 작은 얼굴부터 분석 제외
export class PerfManager {
  constructor(cfg) {
    this.cfg = cfg;
    this.level = 0;
    this.ema = null;
    this.overSince = null;
    this.underSince = null;
  }

  get maxLevel() {
    return 3 + Math.max(0, (this.cfg.maxPeople | 0) - 1);
  }

  update(ms, t) {
    const p = this.cfg.perf;
    this.ema = this.ema == null ? ms : this.ema + 0.1 * (ms - this.ema);
    if (!p.auto) {
      this.level = Math.min(this.maxLevel, Math.max(0, p.level | 0));
      return;
    }
    if (this.ema > p.budgetMs) {
      this.underSince = null;
      if (this.overSince == null) this.overSince = t;
      if (t - this.overSince > 2 && this.level < this.maxLevel) {
        this.level++;
        this.overSince = t;
      }
    } else if (this.ema < p.budgetMs * 0.6) {
      this.overSince = null;
      if (this.underSince == null) this.underSince = t;
      if (t - this.underSince > 10 && this.level > 0) {
        this.level--;
        this.underSince = t;
      }
    } else {
      this.overSince = this.underSince = null;
    }
  }

  get gridScale() {
    return this.level >= 2 ? 0.5 : this.level >= 1 ? 0.75 : 1;
  }

  get maskMode() {
    return this.level >= 3 ? 'voronoi' : this.cfg.maskMode;
  }

  get maxAnalyzed() {
    return this.level >= 4 ? Math.max(1, (this.cfg.maxPeople | 0) - (this.level - 3)) : this.cfg.maxPeople;
  }

  get label() {
    const parts = [`단계 ${this.level}/${this.maxLevel}`, `${(this.ema ?? 0).toFixed(1)}ms`];
    if (this.level >= 1) parts.push(`격자×${this.gridScale}`);
    if (this.level >= 3) parts.push('voronoi');
    if (this.level >= 4) parts.push(`분석 ${this.maxAnalyzed}명`);
    return parts.join(' · ');
  }
}
