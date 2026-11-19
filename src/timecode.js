// 타임코드 계산, 표시, 누적 저장.
// 타임코드는 이탈 순간 그 관객의 눈 중앙 자리에 고정되고, 전시 기간 내내 쌓인다.
const LS_KEY = 'spacingout.timecodes';
const SVG_NS = 'http://www.w3.org/2000/svg';

export function formatTimecode(sec, fps = 30) {
  fps = Math.max(1, Math.round(fps));
  const total = Math.floor(sec * fps + 1e-6);
  const ff = total % fps;
  const s = Math.floor(total / fps);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 60))}:${p(s % 60)}:${p(ff)}`;
}

// entry: { tc, x, y, number, at, kind: 'drift' | 'away' }
//   모든 타임코드는 빨간색이고, 기록 순서대로 빨간 선 하나로 이어진다. kind 는 기록용.
export class TimecodeLayer {
  constructor(el, cfg) {
    this.el = el;
    this.cfg = cfg;
    this.entries = [];
    this.nodes = [];
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'tc-paths');
    this.svg.setAttribute('viewBox', '0 0 100 100');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.el.appendChild(this.svg);
    this.load();
    this.applyVars();
    this.renderAll(false);
  }

  applyVars() {
    document.documentElement.style.setProperty('--tc-fade-in', `${this.cfg.timecode.fadeIn}ms`);
  }

  load() {
    try {
      const a = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      this.entries = Array.isArray(a) ? a.filter((e) => e && typeof e.tc === 'string') : [];
    } catch {
      this.entries = [];
    }
  }

  save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.entries));
    } catch (e) {
      console.warn('[timecode] 저장 실패', e);
    }
  }

  add(entry) {
    const e = {
      tc: entry.tc,
      x: +entry.x.toFixed(4),
      y: +entry.y.toFixed(4),
      number: entry.number,
      at: entry.at || new Date().toISOString(),
      kind: entry.kind || 'drift',
    };
    this.entries.push(e);
    this.save();
    this.nodes.push(this.makeNode(e, true));
    this.renderPaths();
    this.applyFade();
  }

  makeNode(e, animate) {
    const n = document.createElement('div');
    n.className = `tc tc-${e.kind}`;
    n.textContent = e.tc;
    n.style.left = `${e.x * 100}%`;
    n.style.top = `${e.y * 100}%`;
    this.el.appendChild(n);
    if (animate) requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add('show')));
    else n.classList.add('show', 'instant');
    return n;
  }

  renderAll(animate) {
    for (const n of this.nodes) n.remove();
    this.nodes = this.entries.map((e) => this.makeNode(e, animate));
    this.renderPaths();
    this.applyFade();
  }

  // 모든 타임코드를 기록 순서대로 하나의 선으로 잇는다
  renderPaths() {
    this.svg.replaceChildren();
    if (!this.cfg.timecode.drawPaths || this.entries.length < 2) return;
    const pl = document.createElementNS(SVG_NS, 'polyline');
    pl.setAttribute('points', this.entries.map((e) => `${e.x * 100},${e.y * 100}`).join(' '));
    pl.setAttribute('vector-effect', 'non-scaling-stroke');
    this.svg.appendChild(pl);
  }

  applyFade() {
    const c = this.cfg.timecode;
    const n = this.nodes.length;
    this.nodes.forEach((node, i) => {
      if (!c.fadeOld) {
        node.style.removeProperty('--tc-age');
        return;
      }
      const age = n - 1 - i; // 0 = 가장 최근
      const k = Math.min(1, age / Math.max(1, c.fadeOldCount));
      node.style.setProperty('--tc-age', String(1 - k * (1 - c.fadeOldMin)));
    });
  }

  // 설정이 바뀌었을 때 다시 그린다
  refresh() {
    this.applyVars();
    this.renderPaths();
    this.applyFade();
  }

  replaceAll(entries) {
    this.entries = Array.isArray(entries) ? entries : [];
    this.save();
    this.renderAll(false);
  }

  clearAll() {
    this.replaceAll([]);
  }
}
