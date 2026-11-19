// 다중 관객 추적. MediaPipe 는 프레임 간 ID를 주지 않으므로 얼굴 중심 거리로 직접 이어 붙인다.
// 세션 단위였던 모든 상태(t0, 관객 번호, 기준값, 신호, 상태 머신, 눈 위치 버퍼, 이탈 기록)는 Person 에 있다.
import { SignalProcessor } from './signals.js';
import { Calibrator } from './session.js';
import { AttentionMachine, S } from './attention.js';
import { Series } from './filters.js';
import { eyeMidpoint } from './view.js';

export const PALETTE = ['#4fc3f7', '#ffb74d', '#aed581', '#f06292', '#ba68c8', '#4db6ac', '#fff176', '#90a4ae'];

function faceInfo(face) {
  const lm = face.landmarks;
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let i = 0; i < 468; i++) {
    const p = lm[i];
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, nose: lm[1] };
}

let nextTrackId = 1;

export class Person {
  constructor(cfg, info, t) {
    this.id = nextTrackId++;
    this.cfg = cfg;
    this.color = PALETTE[(this.id - 1) % PALETTE.length];
    this.firstSeen = t;
    this.lastSeen = t;
    this.runStart = t; // 연속 검출 시작 (미확정 트랙)
    this.cx = info.cx;
    this.cy = info.cy;
    this.w = info.w;
    this.confirmed = false;
    this.number = null;
    this.face = null; // 이번 프레임에 매칭된 얼굴
    this.excluded = false; // 성능 단계로 분석 제외
    this.processor = new SignalProcessor(cfg);
    this.calib = new Calibrator();
    this.machine = null;
    this.log = null;
    this.startedAt = null;
    this.t0 = null;
    this.eyeBuf = new Series(cfg.eyeBufferSeconds);
    this.eye = null; // 최근 눈 중앙(화면 좌표)
    this.f = null; // 최근 신호
  }

  get state() {
    return this.machine ? this.machine.state : 'TENTATIVE';
  }

  get label() {
    return this.number != null ? String(this.number).padStart(5, '0') : '-----';
  }
}

export class PeopleTracker {
  // deps: { counter, logger, view, onLeave(person, leave) }
  constructor(cfg, deps) {
    this.cfg = cfg;
    Object.assign(this, deps);
    this.people = [];
  }

  get confirmed() {
    return this.people.filter((p) => p.confirmed);
  }

  // faces: tracker 의 얼굴 목록. 매 카메라 프레임 호출.
  match(faces, t) {
    const c = this.cfg;
    const infos = faces.map((f) => ({ face: f, info: faceInfo(f) }));
    const ar = faces[0]?.aspect || 16 / 9;
    for (const p of this.people) p.face = null;

    // 탐욕적 매칭: 가까운 쌍부터
    const pairs = [];
    infos.forEach((d, i) => {
      for (const p of this.people) {
        const dist = Math.hypot((d.info.cx - p.cx) * ar, d.info.cy - p.cy) / ar;
        // 오래 놓친 트랙일수록 조금 더 멀리까지 허용
        const gate = c.matchDistance * (t - p.lastSeen > 0.5 ? 1.5 : 1);
        if (dist <= gate) pairs.push({ i, p, dist });
      }
    });
    pairs.sort((a, b) => a.dist - b.dist);
    const usedFace = new Set(), usedP = new Set();
    for (const { i, p, dist } of pairs) {
      if (usedFace.has(i) || usedP.has(p)) continue;
      usedFace.add(i);
      usedP.add(p);
      this.assign(p, infos[i], t);
      p.matchDist = dist;
    }

    // 매칭 안 된 얼굴 → 새 미확정 트랙 (충분히 큰 얼굴만)
    infos.forEach((d, i) => {
      if (usedFace.has(i) || d.info.w < c.minFaceSize) return;
      if (this.people.length >= c.maxPeople * 2) return;
      const p = new Person(c, d.info, t);
      this.people.push(p);
      this.assign(p, d, t);
    });

    // 미확정 트랙: 유예 시간 넘게 놓치면 삭제
    this.people = this.people.filter((p) => p.confirmed || t - p.lastSeen <= c.graceTime);
  }

  assign(p, d, t) {
    const c = this.cfg;
    if (!p.confirmed && t - p.lastSeen > c.presenceGapTolerance) p.runStart = t;
    p.face = d.face;
    p.cx = d.info.cx;
    p.cy = d.info.cy;
    p.w = d.info.w;
    p.lastSeen = t;
  }

  // 분석 제외: 가장 작은 얼굴부터 (성능 단계)
  applyAnalysisLimit(maxAnalyzed) {
    const seen = this.people.filter((p) => p.face).sort((a, b) => b.w - a.w);
    seen.forEach((p, k) => (p.excluded = k >= maxAnalyzed));
    for (const p of this.people) if (!p.face) p.excluded = false;
  }

  // 세션 시작/종료, 신호 처리, 상태 머신. 반환: 이번 프레임에 끝난 관객 목록
  step(t, newFrame) {
    const c = this.cfg;
    const ended = [];

    for (const p of this.people) {
      // 확정: 연속 sessionStart 초 이상 검출
      if (!p.confirmed && p.face && !p.excluded && t - p.runStart >= c.sessionStart) this.startSession(p, t);
      if (!p.confirmed) continue;

      // 종료: sessionEnd 초 이상 사라짐
      if (t - p.lastSeen >= c.sessionEnd) {
        ended.push(p);
        continue;
      }
      if (!newFrame && t - p.lastSeen < 0.5) continue;

      let f;
      if (p.face && p.excluded) f = { face: true, valid: false, t, reason: 'perf' };
      else f = p.processor.process(p.face, t);
      p.f = f;

      if (p.face) {
        const em = eyeMidpoint(p.face.landmarks);
        if (em) {
          p.eye = this.view.camToScreen(em.x, em.y);
          p.eyeBuf.maxAge = c.eyeBufferSeconds;
          p.eyeBuf.push(t, p.eye);
        }
      }

      const m = p.machine;
      if (m.state === S.CALIBRATING) {
        if (f.valid) p.calib.push(f);
        if (t - p.startedAt >= c.calibrationDuration) {
          p.processor.setBaseline(p.calib.finish());
          m.finishCalibration(t);
        }
      }
      m.update(f, t);
    }

    for (const p of ended) this.endSession(p, t);
    return ended;
  }

  startSession(p, t) {
    const c = this.cfg;
    p.confirmed = true;
    p.number = this.counter.next();
    p.startedAt = t;
    p.t0 = c.t0AtFirstDetection ? p.runStart : t;
    p.processor.resetSession(t);
    p.calib.reset();
    p.log = this.logger.openSession({ t0: p.t0, t, number: p.number, track: p.id });
    p.machine = new AttentionMachine(c, {
      log: p.log,
      processor: p.processor,
      onLeave: (leave) => this.onLeave(p, leave),
    });
    p.machine.start(p.t0, t);
  }

  endSession(p, t) {
    p.machine?.end(t);
    p.log?.end(t, p.lastSeen);
    this.people = this.people.filter((q) => q !== p);
  }

  endAll(t) {
    for (const p of [...this.people]) if (p.confirmed) this.endSession(p, t);
    this.people = [];
  }

  // 이탈 시점의 눈 중앙 좌표
  eyeAt(p, t) {
    return p.eyeBuf.valueAt(t) || p.eye;
  }
}
