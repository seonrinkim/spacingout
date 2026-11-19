import './style.css';
import { loadConfig } from './config.js';
import { Tracker, pickLargestFace } from './tracker.js';
import { SignalProcessor } from './signals.js';
import { Presence, Calibrator } from './session.js';
import { AttentionMachine, S } from './attention.js';
import { ProbeLayer } from './probe.js';
import { TimecodeLayer } from './timecode.js';
import { Logger } from './logger.js';
import { DebugOverlay } from './debug.js';
import { setupExhibit, setupBackground } from './exhibit.js';

const now = () => performance.now() / 1000;

async function boot() {
  const { cfg, base } = await loadConfig();
  setupBackground(cfg, document.getElementById('bg'));

  const logger = new Logger();
  const probe = new ProbeLayer(document.getElementById('probe-layer'), cfg);
  const timecodes = new TimecodeLayer(document.getElementById('timecode-layer'), cfg);
  const processor = new SignalProcessor(cfg);
  const presence = new Presence(cfg);
  const calib = new Calibrator();
  const machine = new AttentionMachine(cfg, { probe, timecodes, logger, processor });
  const tracker = new Tracker(cfg, document.getElementById('cam'), logger);

  const app = {
    lastFrameT: now(),
    loopErrors: [],
    forceProbe() {
      machine.forceProbe(now());
    },
    resetSession() {
      const t = now();
      if (presence.active) endSession(t);
      presence.reset();
    },
  };

  const debug = new DebugOverlay(cfg, { tracker, logger, machine, presence, processor, calib, timecodes, probe, base, app });
  window.spacingout = { cfg, machine, processor, presence, tracker, logger }; // 콘솔 디버깅용

  function startSession(t) {
    processor.resetSession(t);
    calib.reset();
    logger.startSession(presence.t0, t);
    machine.start(presence.t0, t);
  }

  function endSession(t, lastSeen) {
    machine.end(t);
    probe.hide();
    timecodes.clear();
    logger.endSession(t, lastSeen);
    processor.resetSession(t);
  }

  function step() {
    const t = now();
    const res = tracker.detect(t * 1000);
    const newFrame = res !== undefined;
    // 카메라 프레임이 끊겨도 세션 종료 판정은 계속 돌아가게 한다
    if (!newFrame && t - app.lastFrameT < 0.5) {
      debug.render(t, null, false);
      return;
    }
    if (newFrame) app.lastFrameT = t;
    const face = newFrame ? pickLargestFace(res, tracker.aspect) : null;
    const f = processor.process(face, t);

    const lastSeen = presence.lastSeen;
    const ev = presence.update(f.face, t);
    if (ev === 'start') startSession(t);
    else if (ev === 'end') endSession(t, lastSeen);

    if (presence.active) {
      if (machine.state === S.CALIBRATING) {
        if (f.valid) calib.push(f);
        if (t - presence.startedAt >= cfg.calibrationDuration) {
          processor.setBaseline(calib.finish());
          machine.finishCalibration(t);
        }
      }
      machine.update(f, t);
    }
    debug.render(t, f, newFrame);
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
