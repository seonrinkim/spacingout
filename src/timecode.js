// 타임코드 계산과 표시
export function formatTimecode(sec, fps = 30) {
  fps = Math.max(1, Math.round(fps));
  const total = Math.floor(sec * fps + 1e-6);
  const ff = total % fps;
  const s = Math.floor(total / fps);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 60))}:${p(s % 60)}:${p(ff)}`;
}

export class TimecodeLayer {
  constructor(el, cfg) {
    this.el = el;
    this.cfg = cfg;
    this.items = [];
    this.applyVars();
  }

  applyVars() {
    const r = document.documentElement.style;
    r.setProperty('--tc-fade-in', `${this.cfg.timecode.fadeIn}ms`);
    r.setProperty('--tc-fade-out', `${this.cfg.timecode.fadeOut}ms`);
  }

  add(text) {
    this.applyVars();
    const node = document.createElement('div');
    node.className = 'tc';
    node.textContent = text;
    this.el.appendChild(node);
    this.place(node);
    this.items.push(node);
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('show')));
    while (this.items.length > this.cfg.timecode.maxVisible) this.fade(this.items.shift());
  }

  // 기존 타임코드와 최대한 떨어진 임의 위치
  place(node) {
    const W = innerWidth, H = innerHeight;
    const w = node.offsetWidth || 80, h = node.offsetHeight || 16;
    const m = this.cfg.timecode.margin * Math.min(W, H);
    const others = this.items.map((n) => ({
      x: (parseFloat(n.style.left) / 100) * W,
      y: (parseFloat(n.style.top) / 100) * H,
    }));
    let best = null, bestScore = -1;
    for (let i = 0; i < 40; i++) {
      const x = m + Math.random() * Math.max(1, W - 2 * m - w);
      const y = m + Math.random() * Math.max(1, H - 2 * m - h);
      let score = Infinity;
      for (const o of others) score = Math.min(score, Math.hypot(o.x - x, o.y - y));
      if (!others.length) score = 1;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    node.style.left = `${(best.x / W) * 100}%`;
    node.style.top = `${(best.y / H) * 100}%`;
  }

  fade(node) {
    if (!node) return;
    node.classList.add('hide');
    node.classList.remove('show');
    setTimeout(() => node.remove(), this.cfg.timecode.fadeOut + 100);
  }

  clear() {
    this.applyVars();
    for (const n of this.items) this.fade(n);
    this.items = [];
  }
}
