// 세션 이벤트 기록. 이미지·얼굴 데이터는 남기지 않고 시간과 상태 이벤트만 저장한다.
import { downloadJSON } from './config.js';

const LS_KEY = 'spacingout.log';
const MAX_SESSIONS = 300;
const MAX_SYSTEM = 200;

export class Logger {
  constructor() {
    this.sessions = [];
    this.systemEvents = [];
    this.current = null;
    this.currentT0 = null;
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

  // 성능 시계(초) → { at: ISO 시각, rel: t0 기준 초 }
  stamp(t) {
    return { at: this.wall(t), rel: this.currentT0 == null ? null : +(t - this.currentT0).toFixed(3) };
  }

  emit(e) {
    for (const fn of this.listeners) {
      try { fn(e); } catch { /* noop */ }
    }
  }

  startSession(t0, t) {
    const d = new Date(performance.timeOrigin + t0 * 1000);
    const id = `S${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`;
    this.currentT0 = t0;
    this.current = { id, t0: this.wall(t0), events: [] };
    this.sessions.push(this.current);
    if (this.sessions.length > MAX_SESSIONS) this.sessions.splice(0, this.sessions.length - MAX_SESSIONS);
    this.event('session-start', { sessionId: id }, t);
  }

  event(type, data = {}, t = performance.now() / 1000) {
    const e = { type, ...this.stamp(t), ...data };
    if (this.current) this.current.events.push(e);
    this.emit(e);
    this.schedulePersist();
    return e;
  }

  endSession(t, lastSeen) {
    if (!this.current) return;
    this.event('session-end', lastSeen != null ? { lastSeen: this.stamp(lastSeen) } : {}, t);
    this.current.end = this.wall(t);
    this.current = null;
    this.currentT0 = null;
    this.persist();
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
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ sessions: this.sessions, system: this.systemEvents }));
    } catch {
      // 용량 초과 시 오래된 세션부터 버린다
      if (this.sessions.length > 10) {
        this.sessions.splice(0, Math.ceil(this.sessions.length / 2));
        try { localStorage.setItem(LS_KEY, JSON.stringify({ sessions: this.sessions, system: this.systemEvents })); } catch { /* noop */ }
      }
    }
  }

  download() {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
    downloadJSON({ exportedAt: new Date().toISOString(), sessions: this.sessions, system: this.systemEvents }, `spacingout-log-${stamp}.json`);
  }

  clear() {
    this.sessions = this.current ? [this.current] : [];
    this.systemEvents = [];
    this.persist();
  }
}
