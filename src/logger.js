// 세션 이벤트 기록. 이미지·얼굴 데이터는 남기지 않고 번호, 시간, 좌표, 상태 이벤트만 저장한다.
// 관객이 여러 명이면 세션도 동시에 여러 개 열린다.
import { downloadJSON } from './config.js';

const LS_KEY = 'spacingout.log';
const MAX_SESSIONS = 500;
const MAX_SYSTEM = 300;

export class Logger {
  constructor() {
    this.sessions = [];
    this.systemEvents = [];
    this.listeners = new Set();
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (saved) {
        this.sessions = saved.sessions || [];
        this.systemEvents = saved.system || [];
      }
    } catch { /* noop */ }
    this.persistTimer = null;
  }

  on(fn) {
    this.listeners.add(fn);
  }

  wall(t) {
    return new Date(performance.timeOrigin + t * 1000).toISOString();
  }

  emit(e) {
    for (const fn of this.listeners) {
      try { fn(e); } catch { /* noop */ }
    }
  }

  // 반환: 세션 로그 핸들 { id, event, stamp, end }
  openSession({ t0, t, number, track }) {
    const d = new Date(performance.timeOrigin + t0 * 1000);
    const id = `S${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${String(number).padStart(5, '0')}`;
    const rec = { id, number, t0: this.wall(t0), events: [] };
    this.sessions.push(rec);
    if (this.sessions.length > MAX_SESSIONS) this.sessions.splice(0, this.sessions.length - MAX_SESSIONS);
    const stamp = (tt) => ({ at: this.wall(tt), rel: +(tt - t0).toFixed(3) });
    const handle = {
      id,
      number,
      stamp,
      event: (type, data = {}, tt = performance.now() / 1000) => {
        const e = { type, number, ...stamp(tt), ...data };
        rec.events.push(e);
        this.emit(e);
        this.schedulePersist();
        return e;
      },
      end: (tt, lastSeen) => {
        handle.event('session-end', lastSeen != null ? { lastSeen: stamp(lastSeen) } : {}, tt);
        rec.end = this.wall(tt);
        this.persist();
      },
    };
    handle.event('session-start', { sessionId: id, track }, t);
    return handle;
  }

  system(type, data = {}) {
    const e = { type, at: new Date().toISOString(), ...data, system: true };
    this.systemEvents.push(e);
    if (this.systemEvents.length > MAX_SYSTEM) this.systemEvents.shift();
    this.emit(e);
    this.schedulePersist();
  }

  schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = null; this.persist(); }, 2000);
  }

  persist() {
    const write = () => localStorage.setItem(LS_KEY, JSON.stringify({ sessions: this.sessions, system: this.systemEvents }));
    try {
      write();
    } catch {
      // 용량 초과 시 오래된 세션부터 버린다
      if (this.sessions.length > 10) {
        this.sessions.splice(0, Math.ceil(this.sessions.length / 2));
        try { write(); } catch { /* noop */ }
      }
    }
  }

  download() {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
    downloadJSON({ exportedAt: new Date().toISOString(), sessions: this.sessions, system: this.systemEvents }, `spacingout-log-${stamp}.json`);
  }

  clear() {
    this.sessions = this.sessions.filter((s) => !s.end); // 진행 중인 세션은 남긴다
    this.systemEvents = [];
    this.persist();
  }
}
