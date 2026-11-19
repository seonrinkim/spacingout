// 프로브: 추정 시선에서 먼 곳에 아주 작고 짧은 시각 변화를 준다.
export class ProbeLayer {
  constructor(el, cfg) {
    this.el = el;
    this.cfg = cfg;
    this.node = null;
    this.timers = [];
    this.last = null;
  }

  // 모든 관객의 추정 시선에서 최대한 먼 곳
  pickPosition(gazes) {
    const c = this.cfg.probe;
    const W = innerWidth, H = innerHeight, ar = W / H;
    const gs = (gazes.length ? gazes : [{ x: 0.5, y: 0.5 }]).map((g) => ({
      x: Math.min(1, Math.max(0, g.x)),
      y: Math.min(1, Math.max(0, g.y)),
    }));
    const cand = [];
    const cols = 9, rows = 5;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = c.margin + ((1 - 2 * c.margin) * (i + 0.5)) / cols + (Math.random() - 0.5) * 0.04;
        const y = c.margin + ((1 - 2 * c.margin) * (j + 0.5)) / rows + (Math.random() - 0.5) * 0.04;
        let d = Infinity; // 화면 높이 단위, 가장 가까운 시선까지 거리
        for (const g of gs) d = Math.min(d, Math.hypot((x - g.x) * ar, y - g.y));
        cand.push({ x, y, d });
      }
    }
    cand.sort((a, b) => b.d - a.d);
    let pool = cand.filter((p) => p.d >= c.minDistance);
    if (pool.length < 3) pool = cand.slice(0, 3);
    pool = pool.slice(0, Math.max(3, Math.ceil(pool.length * 0.3)));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  show(gazes) {
    this.hide();
    const c = this.cfg.probe;
    const pos = this.pickPosition(Array.isArray(gazes) ? gazes : [gazes]);
    const n = document.createElement('div');
    n.className = `probe probe-${c.type}`;
    n.style.left = `${pos.x * 100}%`;
    n.style.top = `${pos.y * 100}%`;
    n.style.opacity = '0';
    n.style.color = c.color;
    if (c.type === 'digits') {
      n.style.fontSize = `${c.size}px`;
      n.textContent = Array.from({ length: c.count }, () => Math.floor(Math.random() * 10)).join('');
    } else if (c.type === 'dot') {
      n.style.width = n.style.height = `${c.size}px`;
      n.style.background = c.color;
    } else {
      n.style.width = `${c.size * 3}px`;
      n.style.height = `${Math.max(1, c.size / 5)}px`;
      n.style.background = c.color;
    }
    this.el.appendChild(n);
    this.node = n;

    // duration 동안 blinks 번 켜졌다 꺼진다
    const blinks = Math.max(1, c.blinks | 0);
    const seg = c.duration / (2 * blinks - 1);
    for (let k = 0; k < 2 * blinks - 1; k++) {
      this.timers.push(setTimeout(() => { n.style.opacity = k % 2 === 0 ? String(c.opacity) : '0'; }, k * seg));
    }
    this.timers.push(setTimeout(() => this.hide(), c.duration));
    this.last = { x: pos.x, y: pos.y, at: performance.now() };
    return { x: pos.x, y: pos.y };
  }

  hide() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.node) this.node.remove();
    this.node = null;
  }
}
