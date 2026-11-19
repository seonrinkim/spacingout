// 상태 머신: CALIBRATING → WATCHING → DRIFTING → LEFT → (RETURNED → WATCHING), 별도로 AWAY
import { formatTimecode } from './timecode.js';

export const S = {
  IDLE: 'IDLE',
  CALIBRATING: 'CALIBRATING',
  WATCHING: 'WATCHING',
  DRIFTING: 'DRIFTING',
  LEFT: 'LEFT',
  RETURNED: 'RETURNED',
  AWAY: 'AWAY',
};

export class AttentionMachine {
  constructor(cfg, { probe, timecodes, logger, processor }) {
    this.cfg = cfg;
    this.probe = probe;
    this.timecodes = timecodes;
    this.logger = logger;
    this.processor = processor;
    this.reset();
  }

  reset() {
    this.state = S.IDLE;
    this.stateSince = 0;
    this.t0 = null;
    this.pending = null;
    this.lastProbeT = -Infinity;
    this.misses = 0;
    this.driftFixStart = null;
    this.lastReturnT = null;
    this.offSince = null;
    this.onSince = null;
    this.lastValidT = null;
    this.leaves = [];
    this.lastFrame = null;
  }

  setState(s, t) {
    if (s === this.state) return;
    const prev = this.state;
    this.state = s;
    this.stateSince = t;
    this.logger.event('state', { from: prev, to: s }, t);
  }

  start(t0, t) {
    this.reset();
    this.t0 = t0;
    this.lastValidT = t;
    this.setState(S.CALIBRATING, t);
  }

  finishCalibration(t) {
    if (this.state !== S.CALIBRATING) return;
    this.logger.event('calibrated', {}, t);
    this.setState(S.WATCHING, t);
  }

  end(t) {
    this.cancelProbe(t, 'session-end');
    this.reset();
  }

  headOffsets(f) {
    const b = this.processor.baseline;
    const rel = this.cfg.awayRelativeToBaseline && b;
    return { yaw: f.yaw - (rel ? b.yaw.mean : 0), pitch: f.pitch - (rel ? b.pitch.mean : 0) };
  }

  update(f, t) {
    if (this.state === S.IDLE) return;
    const c = this.cfg;
    if (f.valid) this.lastFrame = f;

    // 머리가 화면을 벗어났는지 (AWAY 판정용, 히스테리시스 포함)
    if (f.valid) {
      this.lastValidT = t;
      const { yaw, pitch } = this.headOffsets(f);
      const m = this.state === S.AWAY ? c.awayHysteresisDeg : 0;
      const off = Math.abs(yaw) > c.yawLimit - m || Math.abs(pitch) > c.pitchLimit - m;
      if (off) {
        if (this.offSince === null) this.offSince = t;
        this.onSince = null;
      } else {
        if (this.onSince === null) this.onSince = t;
        this.offSince = null;
      }
    } else if (c.missingCountsAsAway) {
      if (this.offSince === null) this.offSince = this.lastValidT ?? t;
      this.onSince = null;
    }

    if (this.state === S.CALIBRATING) return;

    if (this.state !== S.AWAY && this.offSince !== null && t - this.offSince >= c.awayDuration) {
      this.enterAway(t);
      return;
    }

    const s0 = this.state;
    if (this.pending) this.evaluateProbe(f, t);
    if (this.state !== s0) return;

    switch (this.state) {
      case S.WATCHING:
        if (f.valid && f.fixating && f.fixationDuration >= c.fixationThreshold) {
          this.driftFixStart = f.fixationStart;
          this.misses = 0;
          this.setState(S.DRIFTING, t);
        }
        break;

      case S.DRIFTING:
        if (!this.pending && f.valid) {
          if (!f.fixating) {
            this.setState(S.WATCHING, t);
          } else if (t - this.lastProbeT >= c.probeCooldown) {
            this.fireProbe(f, t);
          }
        }
        break;

      case S.LEFT:
        if (!this.pending && f.valid) {
          const moved = !f.fixating || (f.saccade && f.saccade.amp >= c.returnSaccadeAmplitude);
          if (moved && t - this.stateSince >= c.leftMinHold) {
            this.doReturn(t, 'gaze');
          } else if (c.probeInLeft && t - this.lastProbeT >= c.probeCooldown) {
            this.fireProbe(f, t);
          }
        }
        break;

      case S.AWAY:
        if (this.onSince !== null && t - this.onSince >= c.awayReturnDuration) this.doReturn(t, 'head');
        break;

      case S.RETURNED:
        if (t - this.stateSince >= c.returnHold) this.setState(S.WATCHING, t);
        break;
    }
  }

  fireProbe(f, t) {
    const c = this.cfg;
    const centroid = this.processor.gazeCentroid(t, c.probeCentroidWindow) || { x: f.gazeX, y: f.gazeY };
    const pos = this.probe.show(centroid);
    this.lastProbeT = t;
    this.pending = {
      t,
      pos,
      centroid,
      head0: { x: f.headGX, y: f.headGY },
      yaw0: f.yaw,
      pitch0: f.pitch,
      state: this.state,
    };
    this.logger.event('probe', { x: +pos.x.toFixed(3), y: +pos.y.toFixed(3), state: this.state }, t);
  }

  // 디버그용 수동 프로브
  forceProbe(t) {
    if (this.pending || !this.lastFrame || this.state === S.IDLE || this.state === S.CALIBRATING || this.state === S.AWAY) return false;
    this.fireProbe(this.lastFrame, t);
    return true;
  }

  evaluateProbe(f, t) {
    const p = this.pending, c = this.cfg;
    let how = null;
    if (f.valid) {
      const d = { x: p.pos.x - p.centroid.x, y: p.pos.y - p.centroid.y };
      const dl = Math.hypot(d.x, d.y) || 1;
      const towardProbe = (vx, vy) =>
        !c.requireProbeDirection || (vx * d.x + vy * d.y) / ((Math.hypot(vx, vy) || 1) * dl) >= c.directionCosMin;
      const gx = f.gazeX - p.centroid.x, gy = f.gazeY - p.centroid.y;
      const hx = f.headGX - p.head0.x, hy = f.headGY - p.head0.y;
      const headDeg = Math.hypot(f.yaw - p.yaw0, f.pitch - p.pitch0);
      if (Math.hypot(gx, gy) >= c.responseBreakRadius && towardProbe(gx, gy)) how = 'gaze';
      else if (headDeg >= c.responseHeadDeg && towardProbe(hx, hy)) how = 'head';
      else if (c.responseOnFixationBreak && !c.requireProbeDirection && !f.fixating) how = 'fixation-break';
    }
    if (how) {
      this.pending = null;
      this.misses = 0;
      this.logger.event('probe-result', { result: 'response', how, latency: +(t - p.t).toFixed(3) }, t);
      this.processor.breakFixation(t);
      if (this.state === S.DRIFTING) this.setState(S.WATCHING, t);
      else if (this.state === S.LEFT) this.doReturn(t, 'probe');
      return;
    }
    if (t - p.t >= c.responseWindow) {
      this.pending = null;
      this.misses++;
      this.logger.event('probe-result', { result: 'miss', misses: this.misses }, t);
      if (this.state === S.DRIFTING && this.misses >= c.missesToConfirm) {
        this.recordLeave(this.driftFixStart ?? p.t, t, 'probe-miss');
        this.setState(S.LEFT, t);
      }
    }
  }

  cancelProbe(t, reason) {
    if (!this.pending) return;
    this.pending = null;
    this.probe.hide();
    this.logger.event('probe-result', { result: 'cancelled', reason }, t);
  }

  recordLeave(leaveT, t, cause) {
    const c = this.cfg;
    const origin = c.timecodeOrigin === 'lastReturn' ? this.lastReturnT ?? this.t0 : this.t0;
    const elapsed = Math.max(0, leaveT - origin);
    const timecode = formatTimecode(elapsed, c.fps);
    this.leaves.push({ t: leaveT, timecode, cause });
    this.logger.event(
      'leave',
      {
        cause,
        estimatedLeave: this.logger.stamp(leaveT),
        timecode,
        elapsed: +elapsed.toFixed(3),
        origin: c.timecodeOrigin,
      },
      t
    );
    this.timecodes.add(timecode);
  }

  enterAway(t) {
    const prev = this.state;
    this.cancelProbe(t, 'away');
    if (this.cfg.countAwayAsLeave && prev !== S.LEFT) {
      const leaveT = prev === S.DRIFTING && this.driftFixStart != null ? Math.min(this.driftFixStart, this.offSince) : this.offSince;
      this.recordLeave(leaveT, t, 'away');
    }
    this.setState(S.AWAY, t);
  }

  doReturn(t, cause) {
    this.lastReturnT = t;
    this.misses = 0;
    this.driftFixStart = null;
    this.processor.breakFixation(t);
    this.logger.event('return', { cause }, t);
    this.setState(S.RETURNED, t);
  }
}
