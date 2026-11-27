// 이탈 후 자막. 화면 앞 누군가의 첫 이탈(첫 타임코드) 뒤에 한 줄씩 재생하고,
// 마지막 줄(출처)까지 나오면 끝난다. 새 관객이 들어오거나 화면 앞이 비면 리셋된다.
// 판정 로직과는 독립적으로 타이머로만 돈다(측정/상태 머신/프로브/타임코드에 관여하지 않음).
import { assetUrl } from './config.js';

export class SubtitleLayer {
  constructor(el, cfg, logger) {
    this.el = el;
    this.cfg = cfg;
    this.logger = logger;
    this.lines = [];
    this.state = 'idle'; // 'idle' | 'delay' | 'playing' | 'done'
    this.index = -1; // 현재 줄(0부터)
    this.timer = null;
    this.node = null;
    this.applyVars();
  }

  async load() {
    try {
      const r = await fetch(assetUrl('subtitles.json'), { cache: 'no-store' });
      const a = r.ok ? await r.json() : [];
      this.lines = Array.isArray(a) ? a.filter((s) => typeof s === 'string') : [];
    } catch (e) {
      console.warn('[subtitle] subtitles.json 을 읽지 못했습니다', e);
      this.lines = [];
    }
  }

  applyVars() {
    const c = this.cfg, s = this.el.style;
    s.setProperty('--sub-right', `${c.subtitleMarginRight * 100}vw`);
    s.setProperty('--sub-top', `${c.subtitleMarginTop * 100}vh`);
    s.setProperty('--sub-max-width', `${c.subtitleMaxWidth * 100}vw`);
    s.setProperty('--sub-size', `${c.subtitleFontSize}vh`);
    s.setProperty('--sub-opacity', String(c.subtitleOpacity));
    s.setProperty('--sub-source-scale', String(c.subtitleSourceScale));
    s.setProperty('--sub-source-opacity', String(c.subtitleSourceOpacity));
    s.setProperty('--sub-fade', `${c.subtitleFadeMs}ms`);
    if (this.node) this.fitTwoLines(this.node);
  }

  get label() {
    if (this.state === 'idle') return '대기';
    if (this.state === 'delay') return '시작 지연 중';
    if (this.state === 'playing') return `재생 중 (${this.index + 1}/${this.lines.length})`;
    return '완료';
  }

  // 첫 이탈 때 호출. 대기 상태일 때만 시작한다.
  trigger() {
    if (this.state !== 'idle' || !this.cfg.subtitleEnabled || !this.lines.length) return;
    this.state = 'delay';
    this.logger?.system('subtitle-start');
    this.after(this.cfg.subtitleStartDelayMs, () => this.show(0));
  }

  // 디버그용 수동 시작: 어떤 상태든 처음부터
  forceStart() {
    this.reset(true);
    this.trigger();
  }

  reset(quiet = false) {
    if (this.state === 'idle' && !this.node) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.state = 'idle';
    this.index = -1;
    this.hideNode();
    if (!quiet) this.logger?.system('subtitle-reset');
  }

  after(ms, fn) {
    clearTimeout(this.timer);
    this.timer = setTimeout(fn, Math.max(0, ms));
  }

  show(i) {
    const c = this.cfg;
    const text = this.lines[i];
    if (text == null) return this.finish();
    this.state = 'playing';
    this.index = i;
    const isSource = i === this.lines.length - 1;
    const n = document.createElement('div');
    n.className = 'sub-line' + (isSource ? ' sub-source' : '');
    n.textContent = text;
    this.el.appendChild(n);
    this.node = n;
    this.fitTwoLines(n);
    requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add('show')));
    const hold = Math.max(c.subtitleMinMs, [...text].length * c.subtitleMsPerChar);
    this.after(c.subtitleFadeMs + hold, () => {
      this.hideNode();
      if (isSource) return this.after(c.subtitleFadeMs, () => this.finish());
      this.after(c.subtitleFadeMs + c.subtitleGapMs, () => this.show(i + 1));
    });
  }

  finish() {
    this.state = 'done';
    this.logger?.system('subtitle-done');
  }

  hideNode() {
    const n = this.node;
    if (!n) return;
    this.node = null;
    n.classList.remove('show');
    setTimeout(() => n.remove(), this.cfg.subtitleFadeMs + 50);
  }

  // 한 자막이 2줄을 넘지 않도록 글자 크기를 조금씩 줄인다
  fitTwoLines(n) {
    n.style.fontSize = '';
    const base = parseFloat(getComputedStyle(n).fontSize);
    if (!base) return;
    for (let k = 1; k >= 0.6; k -= 0.05) {
      n.style.fontSize = `${base * k}px`;
      const lh = parseFloat(getComputedStyle(n).lineHeight) || base * k * 1.4;
      if (n.scrollHeight <= lh * 2 + 1) return;
    }
  }
}
