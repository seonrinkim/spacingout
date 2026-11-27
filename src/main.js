import './style.css';
import { loadConfig } from './config.js';
import { Tracker } from './tracker.js';
import { PeopleTracker } from './people.js';
import { ProbeScheduler } from './attention.js';
import { ProbeLayer } from './probe.js';
import { TimecodeLayer } from './timecode.js';
import { SubtitleLayer } from './subtitle.js';
import { Logger } from './logger.js';
import { Counter } from './counter.js';
import { Silhouette } from './silhouette.js';
import { PerfManager } from './perf.js';
import { View } from './view.js';
import { DebugOverlay } from './debug.js';
import { setupExhibit, setupBackground } from './exhibit.js';

const now = () => performance.now() / 1000;

async function boot() {
  const { cfg, base } = await loadConfig();
  setupBackground(cfg, document.getElementById('bg'));

  const logger = new Logger();
  const counter = new Counter();
  const view = new View(cfg);
  const probe = new ProbeLayer(document.getElementById('probe-layer'), cfg);
  const timecodes = new TimecodeLayer(document.getElementById('timecode-layer'), cfg);
  const subtitles = new SubtitleLayer(document.getElementById('subtitle-layer'), cfg, logger);
  await subtitles.load();
  const silhouette = new Silhouette(document.getElementById('silhouette'), cfg);
  const perf = new PerfManager(cfg);
  const tracker = new Tracker(cfg, document.getElementById('cam'), logger);
  const scheduler = new ProbeScheduler(cfg, probe, logger);

  const people = new PeopleTracker(cfg, {
    counter,
    logger,
    view,
    // 이탈: 그 시점의 눈 중앙 자리에 타임코드를 고정한다
    onLeave(p, leave) {
      const pos = people.eyeAt(p, leave.posT) || { x: 0.5, y: 0.5 };
      timecodes.add({
        tc: leave.timecode,
        x: Math.min(1, Math.max(0, pos.x)),
        y: Math.min(1, Math.max(0, pos.y)),
        number: p.number,
        kind: leave.cause === 'away' ? 'away' : 'drift',
      });
      subtitles.trigger(); // 첫 이탈일 때만 시작한다(재생 중/완료면 무시)
    },
    // 새 관객이 들어오면 자막을 지우고 처음으로
    onSessionStart() {
      subtitles.reset();
    },
    // 화면 앞에 아무도 없으면 리셋
    onSessionEnd() {
      if (people.confirmed.length === 0) subtitles.reset();
    },
  });

  const app = {
    lastFrameT: now(),
    loopErrors: [],
    lastDet: null,
    forceProbe() {
      scheduler.update(people.confirmed, now(), true);
    },
    resetSession() {
      people.endAll(now());
    },
  };

  const debug = new DebugOverlay(cfg, { tracker, logger, people, counter, timecodes, subtitles, probe, silhouette, perf, view, scheduler, base, app });
  window.spacingout = { cfg, people, tracker, logger, counter, timecodes, subtitles, perf, silhouette, view }; // 콘솔 디버깅용

  function step() {
    const t = now();
    const t1 = performance.now();
    const det = tracker.detect(t * 1000, perf.maskMode);
    const newFrame = det !== undefined;
    // 카메라 프레임이 끊겨도 세션 종료 판정은 계속 돌아가게 한다
    if (!newFrame && t - app.lastFrameT < 0.5) {
      debug.render(t, false);
      return;
    }
    if (newFrame) app.lastFrameT = t;
    view.update(tracker.aspect);

    people.match(newFrame ? det.faces : [], t);
    people.applyAnalysisLimit(perf.maxAnalyzed);
    people.step(t, newFrame);
    scheduler.update(people.confirmed, t);

    if (newFrame) {
      silhouette.render(tracker.video, det, people.confirmed, view, perf.gridScale);
      app.lastDet = det;
      perf.update(performance.now() - t1, t);
      tracker.syncPeople();
    } else {
      silhouette.clear();
    }
    debug.render(t, newFrame);
  }

  function loop() {
    requestAnimationFrame(loop);
    try {
      step();
    } catch (e) {
      app.onLoopError(e);
    }
  }

  setupExhibit({ cfg, tracker, debug, logger, app });
  requestAnimationFrame(loop);

  try {
    await tracker.init();
  } catch (e) {
    logger.system('tracker-init-failed', { error: String(e?.message || e) });
    tracker.scheduleReconnect(5000);
  }
}

boot().catch((e) => {
  console.error(e);
  setTimeout(() => location.reload(), 10000);
});
