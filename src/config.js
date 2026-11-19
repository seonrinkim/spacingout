// 모든 임계값/옵션의 기본값. public/config.json 이 이 위에 덮어쓰고,
// 디버그 슬라이더로 바꾼 값(localStorage)이 다시 그 위에 덮어쓴다.
// 시간 단위: 별도 표기가 없으면 초. 시선 좌표는 화면 폭/높이 기준 0~1.
export const DEFAULTS = {
  fps: 30,
  timecodeOrigin: 'arrival', // 'arrival' | 'lastReturn'
  countAwayAsLeave: true,

  // 관객 세션
  sessionStart: 1.0,
  sessionEnd: 5.0,
  presenceGapTolerance: 0.3, // 시작 판정 중 이보다 짧은 검출 누락은 무시
  t0AtFirstDetection: true, // true: 연속 검출이 시작된 순간을 t0로, false: 세션이 확정된 순간을 t0로
  calibrationDuration: 15,

  // 고정(fixation) / 표류(DRIFTING)
  fixationThreshold: 4,
  dispersionWindow: 3,
  fixationZ: -0.8, // 기준 분산 평균 + z*표준편차 아래면 고정
  fixationDispersionFloor: 0.008,
  fixationDispersionCap: 0.8, // 임계값 상한 = 기준 분산 평균 × 이 값
  fixationDispersionDefault: 0.03, // 기준값이 없을 때
  fixationHysteresis: 1.35, // 고정 해제 = 임계값 × 이 값 초과
  saccadeAmplitude: 0.1,
  saccadeWindow: 0.15,

  // 프로브 반응 판정
  probeCooldown: 8,
  responseWindow: 1.5,
  missesToConfirm: 1,
  responseBreakRadius: 0.07, // 프로브 직전 시선 중심에서 이만큼 벗어나면 반응
  responseHeadDeg: 4,
  responseOnFixationBreak: true,
  requireProbeDirection: false,
  directionCosMin: 0.3,
  probeCentroidWindow: 1.0,
  probeInLeft: true, // LEFT 상태에서도 쿨다운마다 프로브를 띄워 복귀를 확인

  // 복귀
  returnSaccadeAmplitude: 0.12,
  leftMinHold: 1.0,
  returnHold: 0.5,

  // AWAY
  yawLimit: 25,
  pitchLimit: 25,
  awayDuration: 2,
  awayHysteresisDeg: 5,
  awayReturnDuration: 1,
  awayRelativeToBaseline: true, // 캘리브레이션에서 잰 평소 머리 각도를 0°로 본다
  missingCountsAsAway: true, // 세션 중 얼굴이 awayDuration 이상 안 보이면 AWAY

  // 깜빡임
  blinkOn: 0.5,
  blinkOff: 0.35,
  blinkWindow: 60,

  // 검출 품질
  minFaceSize: 0.08, // 얼굴 폭 / 영상 폭
  maxJump: 0.25, // 한 프레임 랜드마크 평균 이동 / 얼굴 폭 (이보다 크면 튐으로 보고 제외)
  numFaces: 1,
  minFaceDetectionConfidence: 0.6,
  minFacePresenceConfidence: 0.6,
  minTrackingConfidence: 0.6,

  // 시선 추정 (정밀하지 않음)
  gaze: {
    eyeGainX: 3.0,
    eyeGainY: 3.0,
    headGainX: 1.0, // 30° 당 화면 폭 1배
    headGainY: 1.0, // 20° 당 화면 높이 1배
    flipX: false,
    flipY: false,
  },

  smoothing: {
    gazeMinCutoff: 1.2,
    gazeBeta: 0.8,
    headMinCutoff: 1.0,
    headBeta: 0.3,
    movementTau: 1.0,
  },

  probe: {
    type: 'digits', // 'digits' | 'dot' | 'bar'
    size: 11, // px
    duration: 300, // ms
    blinks: 1, // duration 동안 켜지는 횟수
    count: 3, // digits 개수
    opacity: 0.55,
    color: '#ffffff',
    minDistance: 0.45, // 추정 시선에서 최소 거리(화면 높이 기준)
    margin: 0.06,
  },

  timecode: {
    fadeIn: 1200, // ms
    fadeOut: 2000, // ms
    maxVisible: 12,
    margin: 0.08,
  },

  video: { src: 'assets/base.mp4' },
  model: {
    path: 'models/face_landmarker.task',
    wasm: 'wasm',
    delegate: 'GPU',
  },
  camera: { width: 640, height: 480, fps: 30, deviceId: '' },
  exhibit: {
    autoFullscreen: true,
    frameTimeout: 4, // 이 시간 동안 카메라 프레임이 없으면 재연결
    reloadOnFatal: true,
  },
};

// 디버그 패널 슬라이더 정의: [경로, min, max, step, 라벨] 또는 [경로, 'bool'|옵션배열, 라벨]
export const TUNABLES = [
  ['세션', [
    ['sessionStart', 0.2, 5, 0.1, '시작: 연속 검출(초)'],
    ['sessionEnd', 1, 20, 0.5, '종료: 얼굴 사라짐(초)'],
    ['calibrationDuration', 3, 60, 1, '캘리브레이션(초)'],
    ['t0AtFirstDetection', 'bool', 't0 = 첫 검출 순간'],
  ]],
  ['고정 / DRIFTING', [
    ['fixationThreshold', 1, 15, 0.5, 'DRIFTING 진입 고정(초)'],
    ['dispersionWindow', 1, 6, 0.5, '분산 창(초)'],
    ['fixationZ', -3, 1, 0.05, '고정 임계 z'],
    ['fixationDispersionFloor', 0.001, 0.1, 0.001, '고정 임계 하한'],
    ['fixationDispersionCap', 0.2, 1.5, 0.05, '고정 임계 상한(×기준평균)'],
    ['fixationDispersionDefault', 0.005, 0.2, 0.005, '기준값 없을 때 임계'],
    ['fixationHysteresis', 1, 2.5, 0.05, '고정 해제 배수'],
    ['saccadeAmplitude', 0.02, 0.4, 0.01, '사카드 크기'],
    ['saccadeWindow', 0.05, 0.5, 0.01, '사카드 창(초)'],
  ]],
  ['프로브 반응', [
    ['probeCooldown', 2, 30, 0.5, '쿨다운(초)'],
    ['responseWindow', 0.5, 4, 0.1, '반응 창(초)'],
    ['missesToConfirm', 1, 5, 1, '이탈 확정 놓침 수'],
    ['responseBreakRadius', 0.01, 0.3, 0.005, '시선 이탈 반경'],
    ['responseHeadDeg', 1, 20, 0.5, '머리 반응 각도(°)'],
    ['responseOnFixationBreak', 'bool', '고정 해제도 반응으로'],
    ['requireProbeDirection', 'bool', '프로브 방향 일치 요구'],
    ['directionCosMin', -1, 1, 0.05, '방향 일치 cos 최소'],
    ['probeInLeft', 'bool', 'LEFT 중에도 프로브'],
  ]],
  ['프로브 형태', [
    ['probe.type', ['digits', 'dot', 'bar'], '형태'],
    ['probe.size', 4, 60, 1, '크기(px)'],
    ['probe.duration', 50, 1500, 10, '지속(ms)'],
    ['probe.blinks', 1, 5, 1, '깜빡 횟수'],
    ['probe.count', 1, 8, 1, '숫자 개수'],
    ['probe.opacity', 0.05, 1, 0.01, '불투명도'],
    ['probe.minDistance', 0.1, 1, 0.05, '시선에서 최소 거리'],
    ['probe.margin', 0, 0.3, 0.01, '가장자리 여백'],
  ]],
  ['복귀', [
    ['returnSaccadeAmplitude', 0.02, 0.5, 0.01, '복귀 사카드 크기'],
    ['leftMinHold', 0, 5, 0.1, 'LEFT 최소 유지(초)'],
    ['returnHold', 0, 3, 0.1, 'RETURNED 유지(초)'],
  ]],
  ['AWAY', [
    ['yawLimit', 5, 60, 1, 'yaw 한계(°)'],
    ['pitchLimit', 5, 60, 1, 'pitch 한계(°)'],
    ['awayDuration', 0.5, 10, 0.5, 'AWAY 진입(초)'],
    ['awayHysteresisDeg', 0, 15, 1, '복귀 히스테리시스(°)'],
    ['awayReturnDuration', 0.2, 5, 0.1, 'AWAY 복귀(초)'],
    ['countAwayAsLeave', 'bool', 'AWAY도 이탈로 기록'],
    ['missingCountsAsAway', 'bool', '얼굴 사라짐도 AWAY'],
    ['awayRelativeToBaseline', 'bool', '기준 머리각 기준'],
  ]],
  ['시선 추정 / 스무딩', [
    ['gaze.eyeGainX', 0, 8, 0.1, '눈 이득 X'],
    ['gaze.eyeGainY', 0, 8, 0.1, '눈 이득 Y'],
    ['gaze.headGainX', 0, 4, 0.05, '머리 이득 X'],
    ['gaze.headGainY', 0, 4, 0.05, '머리 이득 Y'],
    ['gaze.flipX', 'bool', 'X 반전'],
    ['gaze.flipY', 'bool', 'Y 반전'],
    ['smoothing.gazeMinCutoff', 0.1, 5, 0.1, '시선 minCutoff'],
    ['smoothing.gazeBeta', 0, 3, 0.05, '시선 beta'],
    ['smoothing.headMinCutoff', 0.1, 5, 0.1, '머리 minCutoff'],
    ['smoothing.headBeta', 0, 3, 0.05, '머리 beta'],
    ['smoothing.movementTau', 0.1, 5, 0.1, '움직임 평균(초)'],
  ]],
  ['깜빡임 / 품질', [
    ['blinkOn', 0.2, 0.9, 0.01, '깜빡임 on'],
    ['blinkOff', 0.1, 0.8, 0.01, '깜빡임 off'],
    ['blinkWindow', 10, 120, 5, '분당 횟수 창(초)'],
    ['minFaceSize', 0.02, 0.5, 0.01, '최소 얼굴 폭'],
    ['maxJump', 0.02, 1, 0.01, '튐 한계'],
  ]],
  ['타임코드', [
    ['fps', 12, 60, 1, 'fps'],
    ['timecodeOrigin', ['arrival', 'lastReturn'], '기준점'],
    ['timecode.fadeIn', 0, 5000, 100, '페이드인(ms)'],
    ['timecode.fadeOut', 0, 8000, 100, '페이드아웃(ms)'],
    ['timecode.maxVisible', 1, 50, 1, '최대 표시 개수'],
    ['timecode.margin', 0, 0.3, 0.01, '가장자리 여백'],
  ]],
];

const LS_KEY = 'spacingout.config.overrides';

// 배포 base(/spacingout/) 아래 경로를 절대 URL로 바꾼다
export const assetUrl = (p) =>
  /^https?:/.test(p) ? p : new URL(p.replace(/^\//, ''), location.origin + (import.meta.env?.BASE_URL ?? '/')).href;

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

export function deepMerge(a, b) {
  const out = structuredClone(a);
  for (const k of Object.keys(b || {})) {
    if (isObj(b[k]) && isObj(out[k])) out[k] = deepMerge(out[k], b[k]);
    else out[k] = b[k];
  }
  return out;
}

export const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

export function setPath(o, p, v) {
  const ks = p.split('.');
  let c = o;
  for (let i = 0; i < ks.length - 1; i++) {
    if (!isObj(c[ks[i]])) c[ks[i]] = {};
    c = c[ks[i]];
  }
  c[ks[ks.length - 1]] = v;
}

function readOverrides() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export async function loadConfig() {
  let file = {};
  try {
    const r = await fetch(assetUrl('config.json'), { cache: 'no-store' });
    if (r.ok) file = await r.json();
  } catch (e) {
    console.warn('[config] config.json 을 읽지 못해 기본값을 씁니다', e);
  }
  const base = deepMerge(DEFAULTS, file);
  const cfg = deepMerge(base, readOverrides());
  return { cfg, base };
}

export function saveOverride(path, value) {
  try {
    const ov = readOverrides();
    setPath(ov, path, value);
    localStorage.setItem(LS_KEY, JSON.stringify(ov));
  } catch {
    /* 저장 불가 환경이면 무시 */
  }
}

export function clearOverrides() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* noop */
  }
}

export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
