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
  TENTATIVE: '#444',
  IDLE: '#666',
  CALIBRATING: '#8a8aff',
  WATCHING: '#4caf50',
  DRIFTING: '#ffb300',
  LEFT: '#ff5252',
  RETURNED: '#40c4ff',
  AWAY: '#bb86fc',
};

const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d));

// 두 번 눌러야 실행되는 버튼 (alert/confirm 대신)
function armable(btn, label, action) {
  let timer = null;
  btn.textContent = label;
  btn.addEventListener('click', () => {
    if (btn.dataset.armed) {
      clearTimeout(timer);
      delete btn.dataset.armed;
      btn.textContent = label;
      action();
    } else {
      btn.dataset.armed = '1';
      btn.textContent = '한 번 더 누르면 실행';
      timer = setTimeout(() => {
        delete btn.dataset.armed;
        btn.textContent = label;
      }, 3000);
    }
  });
}

export class DebugOverlay {
  constructor(cfg, deps) {
    this.cfg = cfg;
    Object.assign(this, deps); // tracker, logger, people, counter, timecodes, subtitles, probe, silhouette, perf, view, scheduler, base, app
    this.root = document.getElementById('debug');
    this.markers = document.getElementById('markers');
    this.probeMarker = document.getElementById('probe-marker');
    this.visible = false;
    this.selectedId = null;
    this.series = new Map(); // track id → { key: Series }, state Series
    this.logLines = [];
    this.logDirty = true;
    this.lastDraw = 0;
    this.camFrames = 0;
    this.camFpsT = 0;
    this.camFps = 0;
    this.build();
    this.logger.on((e) => this.onEvent(e));
  }

  build() {
    this.root.innerHTML = `
      <div class="dbg-left">
        <div class="dbg-head">DEBUG — D 닫기 · P 프로브 · F 전체화면</div>
        <div class="dbg-views">
          <canvas class="dbg-cam" width="320" height="180"></canvas>
          <canvas class="dbg-mask" width="320" height="180"></canvas>
        </div>
        <pre class="dbg-status"></pre>
        <div class="dbg-people"></div>
        <div class="dbg-sub dbg-gtitle">신호</div>
        <div class="dbg-graphs"></div>
        <div class="dbg-sub">이벤트</div>
        <div class="dbg-log"></div>
      </div>
      <div class="dbg-right">
        <div class="dbg-buttons">
          <button data-act="export">config.json 내보내기</button>
          <button data-act="reset">설정 초기화</button>
          <button data-act="log">로그 내려받기</button>
          <button data-act="clearlog"></button>
          <button data-act="probe">프로브 테스트</button>
          <button data-act="session">세션 모두 종료</button>
        </div>
        <div class="dbg-sub">관객 번호 · 타임코드</div>
        <div class="dbg-buttons">
          <button data-act="backup">JSON 백업</button>
          <button data-act="restore">JSON 복원</button>
          <button data-act="wipe" class="danger"></button>
          <input type="file" accept="application/json,.json" hidden />
        </div>
        <div class="dbg-sub">자막</div>
        <div class="dbg-buttons">
          <button data-act="sub-start">자막 시작</button>
          <button data-act="sub-reset">자막 리셋</button>
        </div>
        <div class="dbg-tunables"></div>
      </div>`;
    this.cam = this.root.querySelector('.dbg-cam');
    this.camCtx = this.cam.getContext('2d');
    this.maskCv = this.root.querySelector('.dbg-mask');
    this.maskCtx = this.maskCv.getContext('2d');
    this.statusEl = this.root.querySelector('.dbg-status');
    this.peopleEl = this.root.querySelector('.dbg-people');
    this.gtitle = this.root.querySelector('.dbg-gtitle');
    this.logEl = this.root.querySelector('.dbg-log');
    this.fileInput = this.root.querySelector('input[type=file]');

    const graphs = this.root.querySelector('.dbg-graphs');
    this.graphs = {};
    for (const [k, label] of [...GRAPH_KEYS, ['state', '상태']]) {
      const wrap = document.createElement('div');
      wrap.className = 'dbg-graph';
      wrap.innerHTML = `<div class="dbg-glabel"></div><canvas width="320" height="${k === 'state' ? 10 : 36}"></canvas>`;
      graphs.appendChild(wrap);
      this.graphs[k] = { label, labelEl: wrap.firstElementChild, canvas: wrap.lastElementChild };
    }

    const q = (a) => this.root.querySelector(`[data-act="${a}"]`);
    armable(q('clearlog'), '로그 비우기', () => this.logger.clear());
    armable(q('wipe'), '번호·타임코드 초기화', () => {
      this.counter.set(0);
      this.timecodes.clearAll();
      this.logger.system('wipe-counter-timecodes');
    });
    this.root.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (act === 'export') downloadJSON(this.cfg, 'config.json');
      if (act === 'reset') this.resetConfig();
      if (act === 'log') this.logger.download();
      if (act === 'probe') this.app.forceProbe();
      if (act === 'session') this.app.resetSession();
      if (act === 'backup') this.backup();
      if (act === 'sub-start') this.subtitles.forceStart();
      if (act === 'sub-reset') this.subtitles.reset();
      if (act === 'restore') this.fileInput.click();
      const pid = e.target?.closest?.('.dbg-person')?.dataset?.id;
      if (pid) this.selectedId = +pid;
    });
    this.fileInput.addEventListener('change', () => this.restore());
    this.buildTunables();
  }

  backup() {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
    downloadJSON(
      { kind: 'spacingout-backup', exportedAt: new Date().toISOString(), counter: this.counter.value, timecodes: this.timecodes.entries },
      `spacingout-backup-${stamp}.json`
    );
  }

  async restore() {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.timecodes)) throw new Error('timecodes 가 없습니다');
      this.counter.set(Math.max(data.counter | 0, ...data.timecodes.map((e) => e.number | 0)));
      this.timecodes.replaceAll(data.timecodes);
      this.logger.system('restore', { counter: this.counter.value, timecodes: data.timecodes.length });
    } catch (e) {
      this.logger.system('restore-failed', { message: String(e.message || e) });
    }
  }

  buildTunables() {
    const box = this.root.querySelector('.dbg-tunables');
    box.innerHTML = '';
    this.inputs = [];
    for (const [group, items] of TUNABLES) {
      const det = document.createElement('details');
      det.open = false;
      det.innerHTML = `<summary>${group}</summary>`;
      for (const item of items) {
        const [path] = item;
        const row = document.createElement('label');
        row.className = 'dbg-row';
        let input, valEl = null;
        if (item[1] === 'bool' || item[1] === 'color') {
          row.innerHTML = `<span>${item[2]}</span>`;
          input = document.createElement('input');
          input.type = item[1] === 'bool' ? 'checkbox' : 'color';
          input.addEventListener(item[1] === 'bool' ? 'change' : 'input', () =>
            this.setValue(path, item[1] === 'bool' ? input.checked : input.value)
          );
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
    box.querySelector('details').open = true;
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
    if (path.startsWith('timecode.')) this.timecodes.refresh();
    if (path.startsWith('subtitle')) this.subtitles.applyVars();
  }

  resetConfig() {
    clearOverrides();
    for (const k of Object.keys(this.base)) this.cfg[k] = structuredClone(this.base[k]);
    this.timecodes.refresh();
    this.subtitles.applyVars();
    this.refreshTunables();
  }

  toggle(force) {
    this.visible = force ?? !this.visible;
    this.root.hidden = !this.visible;
    this.markers.hidden = !this.visible;
    document.body.classList.toggle('debug', this.visible);
    this.logDirty = true;
  }

  onEvent(e) {
    const time = (e.at || '').slice(11, 22);
    const { type, at, rel, system, number, ...rest } = e;
    const extra = Object.entries(rest)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? (v?.rel ?? JSON.stringify(v)) : v}`)
      .join(' ');
    const who = number != null ? `#${String(number).padStart(5, '0')}` : '';
    const relTxt = rel != null ? ` +${rel.toFixed(1)}s` : '';
    this.logLines.unshift({ cls: system ? 'sys' : type, text: `${time} ${who}${relTxt} ${type} ${extra}` });
    if (this.logLines.length > 80) this.logLines.pop();
    this.logDirty = true;
  }

  seriesFor(p) {
    let s = this.series.get(p.id);
    if (!s) {
      s = { state: new Series(30) };
      for (const [k] of GRAPH_KEYS) s[k] = new Series(30);
      this.series.set(p.id, s);
    }
    return s;
  }

  render(t, newFrame) {
    const people = this.people.people;
    if (newFrame) {
      this.camFrames++;
      if (t - this.camFpsT >= 1) {
        this.camFps = this.camFrames / (t - this.camFpsT);
        this.camFrames = 0;
        this.camFpsT = t;
      }
      for (const p of people) {
        if (!p.confirmed) continue;
        const s = this.seriesFor(p);
        if (p.f?.valid) for (const [k] of GRAPH_KEYS) s[k].push(t, p.f[k]);
        s.state.push(t, p.state);
      }
      for (const id of this.series.keys()) if (!people.some((p) => p.id === id)) this.series.delete(id);
    }
    if (!this.visible) return;

    this.drawMarkers(people);
    const pl = this.probe.last;
    const showProbe = pl && performance.now() - pl.at < 1500;
    this.probeMarker.hidden = !showProbe;
    if (showProbe) {
      this.probeMarker.style.left = `${pl.x * 100}%`;
      this.probeMarker.style.top = `${pl.y * 100}%`;
    }

    if (newFrame) {
      this.drawCamera(people);
      this.drawMask();
    }
    if (t - this.lastDraw < 0.1) return;
    this.lastDraw = t;
    this.drawStatus(t);
    this.drawPeople(t, people);
    this.drawGraphs(t, people);
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

  // 화면 위: 관객별 추정 시선(원)과 눈 중앙점(점)
  drawMarkers(people) {
    const want = people.filter((p) => p.confirmed);
    while (this.markers.children.length < want.length * 2) {
      const d = document.createElement('div');
      this.markers.appendChild(d);
    }
    [...this.markers.children].forEach((el, k) => {
      const p = want[k >> 1];
      if (!p) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.setProperty('--c', p.color);
      if (k % 2 === 0) {
        el.className = 'mk-gaze' + (p.f?.fixating ? ' fix' : '');
        const gx = p.f?.valid ? p.f.gazeX : null;
        if (gx == null) { el.style.display = 'none'; return; }
        el.style.left = `${Math.min(1, Math.max(0, p.f.gazeX)) * 100}%`;
        el.style.top = `${Math.min(1, Math.max(0, p.f.gazeY)) * 100}%`;
      } else {
        el.className = 'mk-eye';
        if (!p.eye) { el.style.display = 'none'; return; }
        el.style.left = `${p.eye.x * 100}%`;
        el.style.top = `${p.eye.y * 100}%`;
        el.dataset.label = p.label;
      }
    });
  }

  drawCamera(people) {
    const ctx = this.camCtx, w = this.cam.width, h = this.cam.height, v = this.tracker.video;
    const mirror = this.cfg.mirror;
    ctx.save();
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    if (v.readyState >= 2) ctx.drawImage(v, 0, 0, w, h);
    else { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h); }
    for (const p of people) {
      const lm = p.face?.landmarks;
      if (!lm) continue;
      ctx.fillStyle = p.confirmed ? p.color : '#888';
      ctx.globalAlpha = p.excluded ? 0.3 : 0.75;
      for (let i = 0; i < 468; i += 2) ctx.fillRect(lm[i].x * w, lm[i].y * h, 1.2, 1.2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      for (const i of [468, 473]) ctx.fillRect(lm[i].x * w - 1.5, lm[i].y * h - 1.5, 3, 3);
    }
    ctx.restore();
    // 트랙 라벨
    ctx.font = '10px monospace';
    for (const p of people) {
      if (!p.face) continue;
      const x = (mirror ? 1 - p.cx : p.cx) * w, y = (p.cy - p.w * 0.9) * h;
      ctx.fillStyle = p.confirmed ? p.color : '#aaa';
      ctx.fillText(`T${p.id} ${p.label}${p.excluded ? ' ✕' : ''}`, x - 30, Math.max(10, y));
    }
  }

  // 칸별 주인(사람별 마스크) — 화면 좌표 기준
  drawMask() {
    const s = this.silhouette, ctx = this.maskCtx, w = this.maskCv.width, h = this.maskCv.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (!s.owner || !s.gw) return;
    const cw = w / s.gw, ch = h / s.gh;
    for (let j = 0; j < s.gh; j++) {
      for (let i = 0; i < s.gw; i++) {
        const o = s.owner[j * s.gw + i];
        if (o === -1) continue;
        ctx.fillStyle = o === -2 ? '#555' : s.ownerPeople[o]?.color || '#fff';
        ctx.fillRect(i * cw, j * ch, Math.ceil(cw), Math.ceil(ch));
      }
    }
    // 눈 중앙점
    for (const p of s.ownerPeople) {
      if (!p.eye) continue;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.eye.x * w, p.eye.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawStatus(t) {
    const c = this.cfg, tr = this.tracker;
    const cool = Math.max(0, c.probeCooldown - (t - this.scheduler.lastProbeT));
    const lines = [
      `트래커   ${tr.status}  ${tr.modelInfo || ''}`,
      `카메라   ${fmt(this.camFps, 1)}fps  ${tr.video.videoWidth}×${tr.video.videoHeight}${tr.lastError ? ' · ' + tr.lastError : ''}`,
      `성능     ${this.perf.label}  마스크 ${this.app.lastDet?.maskMode || '–'}  격자 ${this.silhouette.gw}×${this.silhouette.gh}  글자 ${this.silhouette.count}`,
      `관객     트랙 ${this.people.people.length}  세션 ${this.people.confirmed.length}  (최대 ${c.maxPeople})`,
      `프로브   전역 쿨다운 ${fmt(cool, 1)}s`,
      `누적     관객 번호 ${String(this.counter.value).padStart(5, '0')}  타임코드 ${this.timecodes.entries.length}개`,
      `자막     ${this.subtitles.label}`,
    ];
    this.statusEl.textContent = lines.join('\n');
  }

  drawPeople(t, people) {
    const c = this.cfg;
    const html = people
      .map((p) => {
        const f = p.f?.valid ? p.f : null;
        const m = p.machine;
        const head = f && m ? m.headOffsets(f) : null;
        const calibLeft = m?.state === 'CALIBRATING' ? Math.max(0, c.calibrationDuration - (t - p.startedAt)) : null;
        const sel = p.id === this.selectedId ? ' sel' : '';
        const st = p.state;
        const rows = p.confirmed
          ? [
              `${st} ${fmt(t - (m?.stateSince ?? t), 1)}s${calibLeft != null ? ` · 보정 ${fmt(calibLeft, 0)}s` : ''} · t0+${fmt(t - p.t0, 0)}s`,
              `고정 ${f?.fixating ? 'Y' : 'n'} ${fmt(f?.fixationDuration, 1)}/${c.fixationThreshold}s · 분산 ${fmt(f?.dispersion, 3)}/${fmt(f?.dispThr, 3)}`,
              `yaw ${fmt(head?.yaw, 0)}° pitch ${fmt(head?.pitch, 0)}° · 깜빡 ${fmt(f?.blinkRate, 0)}/분 · 움직임 ${fmt(f?.movement, 2)}`,
              `${p.f && !p.f.valid ? `제외(${p.f.reason || '얼굴 없음'})` : '유효'} · 폭 ${fmt(p.w, 3)} · 매칭 ${fmt(p.matchDist, 3)} · 놓침 ${m?.misses ?? 0}${m?.pending ? ' · 프로브 판정 중' : ''}`,
              `타임코드 ${m?.leaves.map((l) => l.timecode).join(' ') || '–'}`,
            ]
          : [`미확정 ${fmt(t - p.runStart, 1)}s / ${c.sessionStart}s · 폭 ${fmt(p.w, 3)}`];
        return `<div class="dbg-person${sel}" data-id="${p.id}" style="--c:${p.confirmed ? p.color : '#666'};--s:${STATE_COLORS[st] || '#666'}">
          <b>T${p.id} · ${p.label}</b>${rows.map((r) => `<div>${r}</div>`).join('')}</div>`;
      })
      .join('');
    this.peopleEl.innerHTML = html || '<div class="dbg-empty">관객 없음</div>';
  }

  drawGraphs(t, people) {
    const conf = people.filter((p) => p.confirmed);
    let p = conf.find((q) => q.id === this.selectedId);
    if (!p) {
      p = conf[0];
      this.selectedId = p?.id ?? null;
    }
    this.gtitle.textContent = p ? `신호 — T${p.id} · ${p.label} (패널을 눌러 바꾸기)` : '신호 — 관객 없음';
    const series = p ? this.seriesFor(p) : null;
    const b = p?.processor.baseline, c = this.cfg;
    for (const [k] of GRAPH_KEYS) {
      const g = this.graphs[k];
      const ctx = g.canvas.getContext('2d'), w = g.canvas.width, h = g.canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, 0, w, h);
      const s = series?.[k];
      const cur = s?.length ? s.v[s.length - 1] : null;
      const z = zScore(b, k, cur);
      const bk = b && b[k];
      g.labelEl.textContent = `${g.label}  ${fmt(cur, 3)}   기준 ${bk ? `${fmt(bk.mean, 3)}±${fmt(bk.std, 3)}` : '–'}   z ${fmt(z, 2)}`;
      g.labelEl.classList.toggle('hot', z != null && Math.abs(z) > 2);
      if (!s?.length) continue;
      const refs = [];
      if (k === 'dispersion' && p.f?.dispThr) refs.push(p.f.dispThr);
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
      ctx.strokeStyle = p.color;
      ctx.beginPath();
      for (let i = 0; i < s.length; i++) {
        const x = X(s.t[i]), y = Y(s.v[i]);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    const g = this.graphs.state, ctx = g.canvas.getContext('2d'), w = g.canvas.width, h = g.canvas.height;
    g.labelEl.textContent = '상태 (30초)';
    ctx.clearRect(0, 0, w, h);
    const s = series?.state;
    if (!s) return;
    for (let i = 0; i < s.length; i++) {
      const x0 = w - ((t - s.t[i]) / 30) * w;
      const x1 = i + 1 < s.length ? w - ((t - s.t[i + 1]) / 30) * w : w;
      ctx.fillStyle = STATE_COLORS[s.v[i]] || '#666';
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }
  }
}
