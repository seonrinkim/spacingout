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
  minFaceSize: 0.06, // 얼굴 폭 / 영상 폭. 이보다 작은 얼굴은 분석하지 않는다
  maxJump: 0.25, // 한 프레임 랜드마크 평균 이동 / 얼굴 폭 (이보다 크면 튐으로 보고 제외)
  // 다중 관객
  maxPeople: 4,
  matchDistance: 0.12, // 트랙 매칭 거리 상한(영상 폭 기준)
  graceTime: 1.0, // 매칭되지 않은 미확정 트랙 유예(초). 확정된 관객은 sessionEnd 까지 이어 붙는다
  maskMode: 'pose', // 'pose' | 'voronoi'
  voronoiMaxDistance: 0.35, // voronoi: 얼굴에서 이보다 먼 칸은 아무에게도 배정하지 않는다
  drawUntracked: false,
  eyeBufferSeconds: 90, // 눈 중앙 좌표 링버퍼 길이(초)
  mirror: true,
  useBaseVideo: false,

  // 숫자 실루엣 (WebGL)
  silhouette: {
    enabled: true,
    gridW: 160,
    gridH: 90,
    lumThreshold: 0.18, // 정규화 명도 0~1
    autoContrast: true, // 사람 영역 명도를 5~95% 백분위로 펼친다
    alphaMin: 0.12,
    alphaGamma: 1.3,
    glyphScale: 1.15, // 칸 높이 대비 글자 크기
    sizeMin: 0.75,
    sizeMax: 1.3,
    jitter: 0.35, // 가로 지터(칸 폭 배수)
    color: '#ffffff',
    untrackedColor: '#808080',
    untrackedAlpha: 0.35,
    maskThreshold: 0.5,
    maskInputWidth: 384, // 포즈/세그멘테이션 입력 폭(px)
    dprMax: 1.5,
  },

  perf: {
    auto: true,
    budgetMs: 26, // 카메라 프레임당 처리 시간 예산
    level: 0, // auto=false 일 때 고정 단계
  },
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
    drawPaths: true, // 같은 관객의 '멍하니' 타임코드를 순서대로 빨간 선으로 잇는다
    fadeOld: false,
    fadeOldCount: 300, // 이 개수만큼 지나면 fadeOldMin 까지 흐려진다
    fadeOldMin: 0.15,
  },

  video: { src: 'assets/base.mp4' },
  model: {
    path: 'models/face_landmarker.task',
    posePath: 'models/pose_landmarker_lite.task',
    segPath: 'models/selfie_segmenter.tflite',
    wasm: 'wasm',
    delegate: 'GPU',
  },
  camera: { width: 1280, height: 720, fps: 30, deviceId: '' },
  exhibit: {
    autoFullscreen: true,
    frameTimeout: 4, // 이 시간 동안 카메라 프레임이 없으면 재연결
    reloadOnFatal: true,
  },
};

// 디버그 패널 슬라이더 정의: [경로, min, max, step, 라벨] 또는 [경로, 'bool'|'color'|옵션배열, 라벨]
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
    ['minFaceSize', 0.02, 0.3, 0.005, '최소 얼굴 폭'],
    ['maxJump', 0.02, 1, 0.01, '튐 한계'],
  ]],
  ['타임코드', [
    ['fps', 12, 60, 1, 'fps'],
    ['timecodeOrigin', ['arrival', 'lastReturn'], '기준점'],
    ['timecode.fadeIn', 0, 5000, 100, '페이드인(ms)'],
    ['timecode.drawPaths', 'bool', '빨간 경로선'],
    ['timecode.fadeOld', 'bool', '오래된 것 흐리게'],
    ['timecode.fadeOldCount', 10, 2000, 10, '흐려지는 개수'],
    ['timecode.fadeOldMin', 0, 1, 0.05, '최소 불투명도'],
  ]],
  ['다중 관객', [
    ['maxPeople', 1, 6, 1, '최대 인원'],
    ['matchDistance', 0.02, 0.5, 0.01, '트랙 매칭 거리'],
    ['graceTime', 0.1, 5, 0.1, '유예 시간(초)'],
    ['maskMode', ['pose', 'voronoi'], '마스크 방식'],
    ['voronoiMaxDistance', 0.05, 1, 0.05, 'voronoi 최대 거리'],
    ['drawUntracked', 'bool', '미추적 영역 00000'],
    ['mirror', 'bool', '거울 반전'],
  ]],
  ['숫자 실루엣', [
    ['silhouette.enabled', 'bool', '실루엣 표시'],
    ['silhouette.gridW', 40, 320, 8, '격자 가로'],
    ['silhouette.gridH', 24, 180, 6, '격자 세로'],
    ['silhouette.lumThreshold', 0, 1, 0.01, '명도 임계'],
    ['silhouette.autoContrast', 'bool', '자동 대비'],
    ['silhouette.alphaMin', 0, 1, 0.01, '최소 불투명도'],
    ['silhouette.alphaGamma', 0.3, 3, 0.05, '감마'],
    ['silhouette.glyphScale', 0.3, 3, 0.05, '글자 크기'],
    ['silhouette.sizeMin', 0.2, 1.5, 0.05, '크기 변화 최소'],
    ['silhouette.sizeMax', 0.5, 3, 0.05, '크기 변화 최대'],
    ['silhouette.jitter', 0, 2, 0.05, '가로 지터'],
    ['silhouette.maskThreshold', 0.1, 0.9, 0.05, '마스크 임계'],
    ['silhouette.color', 'color', '색'],
  ]],
  ['성능', [
    ['perf.auto', 'bool', '자동 단계 조정'],
    ['perf.budgetMs', 10, 60, 1, '프레임 예산(ms)'],
    ['perf.level', 0, 8, 1, '고정 단계(auto 끔)'],
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
