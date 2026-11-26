import { assetUrl } from './config.js';

// 전시 모드: 전체화면, 커서 숨김, 화면 꺼짐 방지, 오류 시 자동 복구, 카메라 재연결 감시.

export function setupBackground(cfg, video) {
  video.addEventListener('error', () => { video.style.visibility = 'hidden'; });
  video.addEventListener('loadeddata', () => { video.style.visibility = 'visible'; });
  video.style.visibility = 'hidden';
  if (!cfg.useBaseVideo) {
    // 기본은 검은 배경. 빈 <video> 가 남아 있으면 Safari 가 가운데에 재생 버튼 원을 그리므로 아예 뺀다.
    video.remove();
    return;
  }
  video.preload = 'auto';
  video.src = assetUrl(cfg.video.src);
  const kick = () => { if (video.paused && video.readyState >= 2) video.play().catch(() => {}); };
  video.addEventListener('pause', () => setTimeout(kick, 500));
  video.addEventListener('stalled', () => setTimeout(kick, 1000));
  setInterval(kick, 5000);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}

export function setupExhibit({ cfg, tracker, debug, logger, app }) {
  // 키보드
  addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && e.key !== 'Escape') return;
    const k = e.key.toLowerCase();
    if (k === 'd') debug.toggle();
    else if (k === 'f') toggleFullscreen();
    else if (k === 'p' && debug.visible) app.forceProbe();
  });

  // 브라우저는 사용자 입력이 있어야 전체화면을 허용한다: 첫 클릭/키 입력 때 진입
  if (cfg.exhibit.autoFullscreen) {
    const once = () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      removeEventListener('pointerdown', once);
    };
    addEventListener('pointerdown', once);
  }

  // 화면 꺼짐 방지
  let wakeLock = null;
  const requestWake = async () => {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* noop */ }
  };
  requestWake();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!wakeLock || wakeLock.released)) requestWake();
  });

  // 전역 오류 기록
  addEventListener('error', (e) => logger.system('error', { message: String(e.message || e.error || '') }));
  addEventListener('unhandledrejection', (e) => logger.system('rejection', { message: String(e.reason?.message || e.reason || '') }));

  // 루프 오류: 짧은 시간에 많이 나면 트래커 재초기화, 그래도 계속되면 페이지 새로고침
  let reinitCount = 0;
  app.onLoopError = (e) => {
    const t = performance.now() / 1000;
    app.loopErrors.push(t);
    while (app.loopErrors.length && t - app.loopErrors[0] > 10) app.loopErrors.shift();
    if (app.loopErrors.length === 1) {
      console.error('[loop]', e);
      logger.system('loop-error', { message: String(e?.message || e) });
    }
    if (app.loopErrors.length > 60) {
      app.loopErrors.length = 0;
      reinitCount++;
      if (reinitCount > 3 && cfg.exhibit.reloadOnFatal) safeReload('loop-errors');
      else tracker.reinit('loop-errors');
    }
  };

  // 감시: 카메라 프레임이 멈추면 재연결
  setInterval(() => {
    const t = performance.now() / 1000;
    if (tracker.status === 'running' && t - app.lastFrameT > cfg.exhibit.frameTimeout) {
      tracker.restart('stall');
      app.lastFrameT = t;
    }
    if (tracker.status === 'running' && reinitCount && t - app.lastFrameT < 1) reinitCount = 0;
  }, 1000);
}

function safeReload(reason) {
  try {
    const last = +sessionStorage.getItem('spacingout.lastReload') || 0;
    if (Date.now() - last < 60000) return; // 새로고침 반복 방지
    sessionStorage.setItem('spacingout.lastReload', String(Date.now()));
  } catch { /* noop */ }
  console.warn('[exhibit] reload:', reason);
  location.reload();
}
