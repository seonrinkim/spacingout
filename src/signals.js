// 매 프레임 측정 신호 계산: 머리 방향, 시선 위치, 시선 분산, 고정 지속시간, 깜빡임, 움직임 양.
import { OneEuro, EMA, Series, Welford } from './filters.js';

const DEG = 180 / Math.PI;

// a = 영상 왼쪽 눈꼬리, b = 영상 오른쪽 눈꼬리 (좌우 반전하지 않은 카메라 영상 기준)
const EYES = [
  { a: 33, b: 133, top: 159, bottom: 145 }, // 관객의 오른쪽 눈
  { a: 362, b: 263, top: 386, bottom: 374 }, // 관객의 왼쪽 눈
];
const IRIS_CENTERS = [468, 473];
const MOTION_IDX = [1, 4, 6, 10, 152, 168, 234, 454, 33, 263, 61, 291];

// 기준값 표준편차 하한 (z-score 폭주 방지)
export const STD_FLOOR = {
  yaw: 1,
  pitch: 1,
  gazeX: 0.01,
  gazeY: 0.01,
  dispersion: 0.003,
  fixationDuration: 0.5,
  blinkRate: 2,
  movement: 0.01,
};

export function zScore(baseline, key, v) {
  const b = baseline && baseline[key];
  if (!b || !Number.isFinite(v)) return null;
  return (v - b.mean) / Math.max(b.std, STD_FLOOR[key] ?? 1e-3);
}

function faceBox(lm) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (let i = 0; i < 468; i++) {
    const p = lm[i];
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// facial transformation matrix(열 우선 4x4)에서 yaw/pitch/roll(도)
export function headPose(matrix) {
  const d = matrix.data;
  let fx = d[8], fy = d[9], fz = d[10]; // 얼굴 정면 방향 벡터(회전행렬 3번째 열)
  if (fz < 0) { fx = -fx; fy = -fy; fz = -fz; }
  return {
    yaw: Math.atan2(fx, fz) * DEG,
    pitch: Math.atan2(fy, Math.hypot(fx, fz)) * DEG,
    roll: Math.atan2(d[1], d[0]) * DEG,
  };
}

// 홍채가 눈 양 끝(h: 0~1)과 위아래 눈꺼풀(v: 0~1) 사이 어디에 있는지
function eyeRatios(lm, e, aspect) {
  const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y });
  const A = P(e.a), B = P(e.b), T = P(e.top), Bo = P(e.bottom);
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  let I = P(IRIS_CENTERS[0]);
  const I2 = P(IRIS_CENTERS[1]);
  if ((I2.x - mid.x) ** 2 + (I2.y - mid.y) ** 2 < (I.x - mid.x) ** 2 + (I.y - mid.y) ** 2) I = I2;
  const ax = B.x - A.x, ay = B.y - A.y;
  const len = Math.hypot(ax, ay) || 1e-6;
  const ux = ax / len, uy = ay / len;
  const nx = -uy, ny = ux; // 아래쪽 법선
  const h = ((I.x - A.x) * ux + (I.y - A.y) * uy) / len;
  const tp = (T.x - A.x) * nx + (T.y - A.y) * ny;
  const bp = (Bo.x - A.x) * nx + (Bo.y - A.y) * ny;
  const ip = (I.x - A.x) * nx + (I.y - A.y) * ny;
  const span = bp - tp;
  const v = Math.abs(span) < 1e-6 ? 0.5 : (ip - tp) / span;
  return { h, v };
}

export class SignalProcessor {
  constructor(cfg) {
    this.cfg = cfg;
    this.yawF = new OneEuro();
    this.pitchF = new OneEuro();
    this.hF = new OneEuro();
    this.vF = new OneEuro();
    this.gxF = new OneEuro();
    this.gyF = new OneEuro();
    this.moveEMA = new EMA();
    this.gaze = new Series(6);
    this.centerStats = { h: new Welford(), v: new Welford(), yaw: new Welford(), pitch: new Welford() };
    this.resetSession(0);
  }

  // 관객이 바뀔 때마다 초기화
  resetSession(t) {
    for (const f of [this.yawF, this.pitchF, this.hF, this.vF, this.gxF, this.gyF]) f.reset();
    this.moveEMA.reset();
    this.gaze.clear();
    for (const w of Object.values(this.centerStats)) w.reset();
    this.centersFrozen = false;
    this.baseline = null;
    this.prevLm = null;
    this.lastT = null;
    this.h = 0.5;
    this.v = 0.5;
    this.blinking = false;
    this.blinkTimes = [];
    this.resetT = t;
    this.fixating = false;
    this.fixationStart = null;
    this.lastSaccadeT = -Infinity;
    this.breakT = -Infinity;
    this.last = null;
  }

  setBaseline(baseline) {
    this.baseline = baseline;
    this.centersFrozen = true;
  }

  // 외부(프로브 반응/복귀)에서 고정 상태를 강제로 끊는다
  breakFixation(t) {
    this.fixating = false;
    this.fixationStart = null;
    this.breakT = t;
  }

  // 최근 win 초 시선 평균
  gazeCentroid(t, win) {
    const pts = this.gaze.since(t - win);
    if (!pts.length) return null;
    let x = 0, y = 0;
    for (const p of pts) { x += p.x; y += p.y; }
    return { x: x / pts.length, y: y / pts.length };
  }

  fixationThresholdValue() {
    const c = this.cfg;
    const b = this.baseline && this.baseline.dispersion;
    if (!b) return c.fixationDispersionDefault;
    const thr = b.mean + c.fixationZ * Math.max(b.std, STD_FLOOR.dispersion);
    return Math.max(c.fixationDispersionFloor, Math.min(thr, b.mean * c.fixationDispersionCap));
  }

  // face: {landmarks, blendshapes, matrix, aspect} 또는 null
  process(face, t) {
    const c = this.cfg;
    if (!face) return (this.last = { face: false, valid: false, t });
    const lm = face.landmarks;
    if (!lm || lm.length < 478 || !face.matrix) {
      return (this.last = { face: true, valid: false, t, reason: 'incomplete' });
    }
    const aspect = face.aspect || 4 / 3;
    const box = faceBox(lm);
    const dt = this.lastT == null ? 1 / 30 : Math.min(0.5, Math.max(1e-3, t - this.lastT));

    // 움직임: 주요 랜드마크의 프레임 간 평균 이동(얼굴 폭 단위)
    let jump = 0;
    if (this.prevLm) {
      for (const i of MOTION_IDX) {
        jump += Math.hypot((lm[i].x - this.prevLm[i].x) * aspect, lm[i].y - this.prevLm[i].y);
      }
      jump /= MOTION_IDX.length * Math.max(1e-3, box.w * aspect);
    }
    this.prevLm = lm.map((p) => ({ x: p.x, y: p.y }));

    // 품질 검사: 너무 작은 얼굴, 한 프레임에 튄 랜드마크
    if (box.w < c.minFaceSize) return (this.last = { face: true, valid: false, t, box, reason: 'small' });
    if (this.lastT != null && t - this.lastT < 0.2 && jump > c.maxJump) {
      this.lastT = t;
      return (this.last = { face: true, valid: false, t, box, reason: 'jump' });
    }
    this.lastT = t;

    // 깜빡임
    const bs = {};
    for (const cat of face.blendshapes || []) bs[cat.categoryName] = cat.score;
    const blink = ((bs.eyeBlinkLeft ?? 0) + (bs.eyeBlinkRight ?? 0)) / 2;
    if (!this.blinking && blink > c.blinkOn) {
      this.blinking = true;
      this.blinkTimes.push(t);
    } else if (this.blinking && blink < c.blinkOff) {
      this.blinking = false;
    }
    while (this.blinkTimes.length && t - this.blinkTimes[0] > c.blinkWindow) this.blinkTimes.shift();
    const elapsed = Math.min(c.blinkWindow, t - this.resetT);
    const blinkRate = (this.blinkTimes.length * 60) / Math.max(10, elapsed);
    const eyesClosed = blink > c.blinkOff;

    // 머리 방향
    const sm = c.smoothing;
    this.yawF.minCutoff = this.pitchF.minCutoff = sm.headMinCutoff;
    this.yawF.beta = this.pitchF.beta = sm.headBeta;
    const pose = headPose(face.matrix);
    const yaw = this.yawF.filter(pose.yaw, t);
    const pitch = this.pitchF.filter(pose.pitch, t);

    // 홍채 위치 (눈 감은 프레임은 홍채 랜드마크가 흔들리므로 이전 값 유지)
    this.hF.minCutoff = this.vF.minCutoff = sm.gazeMinCutoff;
    this.hF.beta = this.vF.beta = sm.gazeBeta;
    if (!eyesClosed) {
      const r0 = eyeRatios(lm, EYES[0], aspect);
      const r1 = eyeRatios(lm, EYES[1], aspect);
      this.h = this.hF.filter((r0.h + r1.h) / 2, t);
      this.v = this.vF.filter((r0.v + r1.v) / 2, t);
    }

    // 관객별 중심(정면을 볼 때의 값): 캘리브레이션이 끝날 때까지 누적 평균
    const cs = this.centerStats;
    if (!this.centersFrozen) {
      if (!eyesClosed) { cs.h.push(this.h); cs.v.push(this.v); }
      cs.yaw.push(yaw);
      cs.pitch.push(pitch);
    }
    const h0 = cs.h.n ? cs.h.mean : 0.5, v0 = cs.v.n ? cs.v.mean : 0.5;

    // 시선 좌표 추정 = 머리 방향 + 눈 안의 홍채 위치. 영상 x 증가 = 관객의 왼쪽 = 화면 왼쪽.
    const g = c.gaze;
    const sx = g.flipX ? -1 : 1, sy = g.flipY ? -1 : 1;
    const headGX = -sx * g.headGainX * (yaw - cs.yaw.mean) / 30;
    const headGY = -sy * g.headGainY * (pitch - cs.pitch.mean) / 20;
    const eyeGX = -sx * g.eyeGainX * (this.h - h0);
    const eyeGY = sy * g.eyeGainY * (this.v - v0);
    this.gxF.minCutoff = this.gyF.minCutoff = sm.gazeMinCutoff;
    this.gxF.beta = this.gyF.beta = sm.gazeBeta;
    const clamp = (x) => Math.max(-0.5, Math.min(1.5, x));
    const gazeX = this.gxF.filter(clamp(0.5 + headGX + eyeGX), t);
    const gazeY = this.gyF.filter(clamp(0.5 + headGY + eyeGY), t);

    // 시선 분산: 최근 dispersionWindow 초 시선 좌표의 표준편차
    this.gaze.maxAge = Math.max(6, c.dispersionWindow + 1);
    this.gaze.push(t, { x: gazeX, y: gazeY });
    const pts = this.gaze.since(t - c.dispersionWindow);
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= pts.length; my /= pts.length;
    let vx = 0, vy = 0;
    for (const p of pts) { vx += (p.x - mx) ** 2; vy += (p.y - my) ** 2; }
    const dispersion = Math.sqrt((vx + vy) / Math.max(1, pts.length - 1));
    const oldest = this.gaze.valueAt(t - c.dispersionWindow);
    const coverage = Math.min(1, this.gaze.span() / c.dispersionWindow);

    // 사카드: saccadeWindow 초 사이의 급격한 시선 이동
    let saccade = null;
    const past = this.gaze.valueAt(t - c.saccadeWindow);
    if (past) {
      const dx = gazeX - past.x, dy = gazeY - past.y;
      const amp = Math.hypot(dx, dy);
      if (amp >= c.saccadeAmplitude && t - this.lastSaccadeT > 0.25) {
        saccade = { t, dx, dy, amp };
        this.lastSaccadeT = t;
      }
    }

    // 고정 판정 (히스테리시스)
    const thr = this.fixationThresholdValue();
    if (!this.fixating) {
      if (coverage > 0.8 && dispersion < thr && oldest) {
        this.fixating = true;
        // 분산 창 때문에 판정이 늦으므로, 마지막 사카드나 창 시작 시점으로 소급한다
        this.fixationStart = Math.max(this.lastSaccadeT, t - c.dispersionWindow, this.breakT, this.resetT);
      }
    } else if (dispersion > thr * c.fixationHysteresis || saccade) {
      this.fixating = false;
      this.fixationStart = null;
    }
    const fixationDuration = this.fixating ? t - this.fixationStart : 0;

    // 몸/머리 움직임 양 (얼굴 폭/초, 이동 평균)
    this.moveEMA.tau = sm.movementTau;
    const movement = this.moveEMA.update(jump / dt, dt);

    return (this.last = {
      face: true,
      valid: true,
      t,
      box,
      landmarks: lm,
      aspect,
      yaw,
      pitch,
      roll: pose.roll,
      h: this.h,
      v: this.v,
      gazeX,
      gazeY,
      headGX,
      headGY,
      dispersion,
      dispThr: thr,
      fixating: this.fixating,
      fixationStart: this.fixationStart,
      fixationDuration,
      blink,
      eyesClosed,
      blinkRate,
      movement,
      saccade,
    });
  }
}
