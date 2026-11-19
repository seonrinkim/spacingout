// 디버그 오버레이 (D 키). 작가가 직접 앉아서 기준을 조정하는 용도.
import { TUNABLES, getPath, setPath, saveOverride, clearOverrides, downloadJSON } from './config.js';
import { Series } from './filters.js';
import { zScore } from './signals.js';

const GRAPH_KEYS = [
  ['yaw', 'yaw °'],
  ['pitch', 'pitch °'],
  ['gazeX', '시선 x'],
  ['gazeY', '시선 y'],
  ['dispersion', '시선 분산'],
  ['fixationDuration', '고정 지속(초)'],
  ['blinkRate', '깜빡임/분'],
  ['movement', '움직임'],
];

const STATE_COLORS = {
  IDLE: '#666',
  CALIBRATING: '#8a8aff',
  WATCHING: '#4caf50',
  DRIFTING: '#ffb300',
  LEFT: '#ff5252',
  RETURNED: '#40c4ff',
  AWAY: '#bb86fc',
};

const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d));

export class DebugOverlay {
  constructor(cfg, deps) {
    this.cfg = cfg;
    Object.assign(this, deps); // tracker, logger, machine, presence, processor, calib, timecodes, probe, base, app
    this.root = document.getElementById('debug');
    this.gazeMarker = document.getElementById('gaze-marker');
    this.probeMarker = document.getElementById('probe-marker');
    this.visible = false;
    this.series = Object.fromEntries(GRAPH_KEYS.map(([k]) => [k, new Series(30)]));
    this.stateSeries = new Series(30);
    this.logLines = [];
    this.logDirty = true;
    this.lastDraw = 0;
    this.camFrames = 0;
    this.camFpsT = 0;
    this.camFps = 0;
    this.lastFace = null;
    this.build();
    this.logger.on((e) => this.onEvent(e));
  }

  build() {
    this.root.innerHTML = `
      <div class="dbg-left">
        <div class="dbg-head">DEBUG — D 닫기 · P 프로브 · F 전체화면</div>
        <canvas class="dbg-cam" width="320" height="240"></canvas>
        <pre class="dbg-status"></pre>
        <div class="dbg-graphs"></div>
        <div class="dbg-sub">이벤트</div>
        <div class="dbg-log"></div>
      </div>
      <div class="dbg-right">
        <div class="dbg-buttons">
          <button data-act="export">config.json 내보내기</button>
          <button data-act="reset">설정 초기화</button>
          <button data-act="log">로그 내려받기</button>
          <button data-act="clearlog">로그 비우기</button>
          <button data-act="probe">프로브 테스트</button>
          <button data-act="session">세션 리셋</button>
        </div>
        <div class="dbg-tunables"></div>
      </div>`;
    this.cam = this.root.querySelector('.dbg-cam');
    this.camCtx = this.cam.getContext('2d');
    this.statusEl = this.root.querySelector('.dbg-status');
    this.logEl = this.root.querySelector('.dbg-log');

    const graphs = this.root.querySelector('.dbg-graphs');
    this.graphs = {};
    for (const [k, label] of [...GRAPH_KEYS, ['state', '상태']]) {
      const wrap = document.createElement('div');
      wrap.className = 'dbg-graph';
      wrap.innerHTML = `<div class="dbg-glabel"></div><canvas width="320" height="${k === 'state' ? 10 : 40}"></canvas>`;
      graphs.appendChild(wrap);
      this.graphs[k] = { label, labelEl: wrap.firstElementChild, canvas: wrap.lastElementChild };
    }

    this.root.querySelector('.dbg-buttons').addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (act === 'export') downloadJSON(this.cfg, 'config.json');
      if (act === 'reset') this.resetConfig();
      if (act === 'log') this.logger.download();
      if (act === 'clearlog' && confirm('저장된 로그를 모두 지울까요?')) this.logger.clear();
      if (act === 'probe') this.app.forceProbe();
      if (act === 'session') this.app.resetSession();
    });
    this.buildTunables();
  }

  buildTunables() {
    const box = this.root.querySelector('.dbg-tunables');
    box.innerHTML = '';
    this.inputs = [];
    for (const [group, items] of TUNABLES) {
      const det = document.createElement('details');
      det.open = true;
      det.innerHTML = `<summary>${group}</summary>`;
      for (const item of items) {
        const [path] = item;
        const row = document.createElement('label');
        row.className = 'dbg-row';
        let input, valEl = null;
        if (item[1] === 'bool') {
          row.innerHTML = `<span>${item[2]}</span>`;
          input = document.createElement('input');
          input.type = 'checkbox';
          input.addEventListener('change', () => this.setValue(path, input.checked));
          row.appendChild(input);
        } else if (Array.isArray(item[1])) {
          row.innerHTML = `<span>${item[2]}</span>`;
          input = document.createElement('select');
          for (const o of item[1]) input.add(new Option(o, o));
          input.addEventListener('change', () => this.setValue(path, input.value));
          row.appendChild(input);
        } else {
          const [, min, max, step, label] = item;
          row.innerHTML = `<span>${label}</span>`;
          input = document.createElement('input');
          Object.assign(input, { type: 'range', min, max, step });
          valEl = document.createElement('em');
          input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            valEl.textContent = v;
            this.setValue(path, v);
          });
          row.append(input, valEl);
        }
        this.inputs.push({ path, input, valEl });
        det.appendChild(row);
      }
      box.appendChild(det);
    }
    this.refreshTunables();
  }

  refreshTunables() {
    for (const { path, input, valEl } of this.inputs) {
      const v = getPath(this.cfg, path);
      if (input.type === 'checkbox') input.checked = !!v;
      else input.value = v;
      if (valEl) valEl.textContent = v;
    }
  }

  setValue(path, v) {
    setPath(this.cfg, path, v);
    saveOverride(path, v);
    if (path.startsWith('timecode.')) this.timecodes.applyVars();
  }

  resetConfig() {
    clearOverrides();
    for (const k of Object.keys(this.base)) this.cfg[k] = structuredClone(this.base[k]);
    this.timecodes.applyVars();
    this.refreshTunables();
  }

  toggle(force) {
    this.visible = force ?? !this.visible;
    this.root.hidden = !this.visible;
    this.gazeMarker.hidden = !this.visible;
    document.body.classList.toggle('debug', this.visible);
    this.logDirty = true;
  }

  onEvent(e) {
    const time = (e.at || '').slice(11, 22);
    const { type, at, rel, system, ...rest } = e;
    const extra = Object.entries(rest)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? (v?.rel ?? JSON.stringify(v)) : v}`)
      .join(' ');
    const relTxt = rel != null ? ` +${rel.toFixed(1)}s` : '';
    this.logLines.unshift({ cls: system ? 'sys' : type, text: `${time}${relTxt} ${type} ${extra}` });
    if (this.logLines.length > 80) this.logLines.pop();
    this.logDirty = true;
  }

  render(t, f, newFrame) {
    if (newFrame) {
      this.camFrames++;
      if (t - this.camFpsT >= 1) {
        this.camFps = this.camFrames / (t - this.camFpsT);
        this.camFrames = 0;
        this.camFpsT = t;
      }
    }
    if (f && newFrame) {
      if (f.valid) {
        for (const [k] of GRAPH_KEYS) this.series[k].push(t, f[k]);
        this.lastFace = f;
      }
      this.stateSeries.push(t, this.machine.state);
    }
    if (!this.visible) return;

    // 시선 마커 / 마지막 프로브 위치
    const lf = this.lastFace;
    if (lf) {
      this.gazeMarker.style.left = `${Math.min(1, Math.max(0, lf.gazeX)) * 100}%`;
      this.gazeMarker.style.top = `${Math.min(1, Math.max(0, lf.gazeY)) * 100}%`;
      this.gazeMarker.classList.toggle('fix', !!lf.fixating);
    }
    const pl = this.probe.last;
    const showProbe = pl && performance.now() - pl.at < 1500;
    this.probeMarker.hidden = !showProbe;
    if (showProbe) {
      this.probeMarker.style.left = `${pl.x * 100}%`;
      this.probeMarker.style.top = `${pl.y * 100}%`;
    }

    if (newFrame) this.drawCamera(f);
    if (t - this.lastDraw < 0.066) return;
    this.lastDraw = t;
    this.drawStatus(t, f);
    this.drawGraphs(t);
    if (this.logDirty) {
      this.logDirty = false;
      this.logEl.innerHTML = '';
      for (const l of this.logLines.slice(0, 40)) {
        const d = document.createElement('div');
        d.className = `l-${l.cls}`;
        d.textContent = l.text;
        this.logEl.appendChild(d);
      }
    }
  }

  drawCamera(f) {
    const ctx = this.camCtx, w = this.cam.width, h = this.cam.height, v = this.tracker.video;
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1); // 거울처럼 보이게
    if (v.readyState >= 2) ctx.drawImage(v, 0, 0, w, h);
    else { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h); }
    if (f?.valid && f.landmarks) {
      const lm = f.landmarks;
      ctx.fillStyle = 'rgba(0,255,180,0.7)';
      for (let i = 0; i < 468; i++) ctx.fillRect(lm[i].x * w, lm[i].y * h, 1.2, 1.2);
      ctx.fillStyle = '#ff4081';
      for (const i of [468, 473]) {
        ctx.beginPath();
        ctx.arc(lm[i].x * w, lm[i].y * h, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffeb3b';
      for (const i of [33, 133, 362, 263, 159, 145, 386, 374]) ctx.fillRect(lm[i].x * w - 1, lm[i].y * h - 1, 2.5, 2.5);
    }
    ctx.restore();
    if (f && !f.valid) {
      ctx.fillStyle = '#ff5252';
      ctx.font = '12px monospace';
      ctx.fillText(f.face ? `제외된 프레임: ${f.reason}` : '얼굴 없음', 8, 16);
    }
  }

  drawStatus(t, f) {
    const m = this.machine, p = this.presence, c = this.cfg, pr = this.processor;
    const lf = f?.valid ? f : null;
    const calibLeft = m.state === 'CALIBRATING' && p.startedAt != null ? Math.max(0, c.calibrationDuration - (t - p.startedAt)) : null;
    const head = lf ? m.headOffsets(lf) : null;
    const cool = Math.max(0, c.probeCooldown - (t - m.lastProbeT));
    const lines = [
      `상태     ${m.state}  (${fmt(t - m.stateSince, 1)}s)${calibLeft != null ? `  캘리브레이션 남은 ${fmt(calibLeft, 1)}s (${this.calib.samples})` : ''}`,
      `세션     ${p.active ? `진행 중  t0+${fmt(t - p.t0, 1)}s` : '대기'}`,
      `트래커   ${this.tracker.status}  ${this.tracker.modelInfo || ''}  cam ${fmt(this.camFps, 1)}fps ${this.tracker.lastError ? '· ' + this.tracker.lastError : ''}`,
      `얼굴     ${f ? (f.valid ? '유효' : f.face ? '제외(' + f.reason + ')' : '없음') : '–'}  폭 ${fmt(f?.box?.w, 2)}  깜빡 ${fmt(lf?.blink, 2)}`,
      `고정     ${lf?.fixating ? 'YES' : 'no '}  지속 ${fmt(lf?.fixationDuration, 1)}/${c.fixationThreshold}s  분산 ${fmt(lf?.dispersion, 4)} / 임계 ${fmt(lf?.dispThr, 4)}`,
      `머리     yaw ${fmt(head?.yaw, 1)}°  pitch ${fmt(head?.pitch, 1)}°  (한계 ±${c.yawLimit}/${c.pitchLimit})${m.offSince != null ? `  벗어남 ${fmt(t - m.offSince, 1)}s` : ''}`,
      `프로브   ${m.pending ? `대기 중 ${fmt(t - m.pending.t, 2)}s` : '–'}  쿨다운 ${fmt(cool, 1)}s  놓침 ${m.misses}/${c.missesToConfirm}`,
      `타임코드 ${m.leaves.map((l) => l.timecode).join('  ') || '–'}`,
      `기준값   ${pr.baseline ? '저장됨' : '없음'}`,
    ];
    this.statusEl.textContent = lines.join('\n');
    this.statusEl.style.borderLeftColor = STATE_COLORS[m.state] || '#666';
  }

  drawGraphs(t) {
    const b = this.processor.baseline, c = this.cfg;
    for (const [k] of GRAPH_KEYS) {
      const g = this.graphs[k], s = this.series[k];
      const ctx = g.canvas.getContext('2d'), w = g.canvas.width, h = g.canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, 0, w, h);
      const cur = s.length ? s.v[s.length - 1] : null;
      const z = zScore(b, k, cur);
      const bk = b && b[k];
      g.labelEl.textContent = `${g.label}  ${fmt(cur, 3)}   기준 ${bk ? `${fmt(bk.mean, 3)}±${fmt(bk.std, 3)}` : '–'}   z ${fmt(z, 2)}`;
      g.labelEl.classList.toggle('hot', z != null && Math.abs(z) > 2);
      if (!s.length) continue;
      const refs = [];
      if (k === 'dispersion' && this.lastFace) refs.push(this.lastFace.dispThr);
      if (k === 'fixationDuration') refs.push(c.fixationThreshold);
      let lo = Math.min(...s.v), hi = Math.max(...s.v);
      if (bk) { lo = Math.min(lo, bk.mean - bk.std); hi = Math.max(hi, bk.mean + bk.std); }
      for (const r of refs) { lo = Math.min(lo, r); hi = Math.max(hi, r); }
      if (hi - lo < 1e-6) { hi += 0.5; lo -= 0.5; }
      const pad = (hi - lo) * 0.1;
      lo -= pad; hi += pad;
      const X = (tt) => w - ((t - tt) / 30) * w;
      const Y = (v) => h - ((v - lo) / (hi - lo)) * h;
      if (bk) {
        ctx.fillStyle = 'rgba(120,160,255,0.18)';
        ctx.fillRect(0, Y(bk.mean + bk.std), w, Y(bk.mean - bk.std) - Y(bk.mean + bk.std));
        ctx.strokeStyle = 'rgba(120,160,255,0.6)';
        ctx.beginPath(); ctx.moveTo(0, Y(bk.mean)); ctx.lineTo(w, Y(bk.mean)); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,82,82,0.8)';
      for (const r of refs) { ctx.beginPath(); ctx.moveTo(0, Y(r)); ctx.lineTo(w, Y(r)); ctx.stroke(); }
      ctx.strokeStyle = '#e0e0e0';
      ctx.beginPath();
      for (let i = 0; i < s.length; i++) {
        const x = X(s.t[i]), y = Y(s.v[i]);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // 상태 띠
    const g = this.graphs.state, ctx = g.canvas.getContext('2d'), w = g.canvas.width, h = g.canvas.height, s = this.stateSeries;
    g.labelEl.textContent = '상태 (30초)';
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < s.length; i++) {
      const x0 = w - ((t - s.t[i]) / 30) * w;
      const x1 = i + 1 < s.length ? w - ((t - s.t[i + 1]) / 30) * w : w;
      ctx.fillStyle = STATE_COLORS[s.v[i]] || '#666';
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }
  }
}
