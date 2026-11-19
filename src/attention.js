// 관객 한 명의 상태 머신:
//   CALIBRATING → WATCHING → DRIFTING → LEFT → (RETURNED → WATCHING), 별도로 AWAY
// 프로브는 전역 스케줄러(ProbeScheduler)가 띄우고, 각 관객의 머신이 각자 반응을 판정한다.
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
  // log: 세션 로그 { event(type, data, t), stamp(t) }
  // onLeave({ leaveT, posT, timecode, cause, elapsed })
  constructor(cfg, { log, processor, onLeave }) {
    this.cfg = cfg;
    this.log = log;
    this.processor = processor;
    this.onLeave = onLeave;
    this.reset();
  }

  reset() {
    this.state = S.IDLE;
    this.stateSince = 0;
    this.t0 = null;
    this.pending = null;
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
    this.log.event('state', { from: prev, to: s }, t);
  }

  start(t0, t) {
    this.reset();
    this.t0 = t0;
    this.lastValidT = t;
    this.setState(S.CALIBRATING, t);
  }

  finishCalibration(t) {
    if (this.state !== S.CALIBRATING) return;
    this.log.event('calibrated', {}, t);
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
        if (!this.pending && f.valid && !f.fixating) this.setState(S.WATCHING, t);
        break;

      case S.LEFT:
        if (!this.pending && f.valid) {
          const moved = !f.fixating || (f.saccade && f.saccade.amp >= c.returnSaccadeAmplitude);
          if (moved && t - this.stateSince >= c.leftMinHold) this.doReturn(t, 'gaze');
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

  // ── 프로브 (전역 스케줄러와의 약속) ──────────────────────────
  // 이 관객이 프로브를 원하는가
  wantsProbe(t) {
    if (this.pending || !this.isProbeEligible(t)) return false;
    if (this.state === S.DRIFTING) return true;
    return this.state === S.LEFT && this.cfg.probeInLeft && t - this.stateSince >= this.cfg.leftMinHold;
  }

  // 프로브가 뜨면 판정에 참여할 수 있는가
  isProbeEligible(t) {
    return (
      !this.pending &&
      !!this.lastFrame &&
      this.lastValidT != null &&
      t - this.lastValidT < 0.5 &&
      [S.WATCHING, S.DRIFTING, S.LEFT, S.RETURNED].includes(this.state)
    );
  }

  gazeCentroid(t) {
    const f = this.lastFrame;
    return this.processor.gazeCentroid(t, this.cfg.probeCentroidWindow) || (f ? { x: f.gazeX, y: f.gazeY } : null);
  }

  beginProbe(pos, t) {
    const f = this.lastFrame;
    const centroid = this.gazeCentroid(t);
    this.pending = {
      t,
      pos,
      centroid,
      head0: { x: f.headGX, y: f.headGY },
      yaw0: f.yaw,
      pitch0: f.pitch,
      state: this.state,
    };
    this.log.event('probe', { x: +pos.x.toFixed(3), y: +pos.y.toFixed(3), state: this.state }, t);
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
      this.log.event('probe-result', { result: 'response', how, latency: +(t - p.t).toFixed(3), stateAtProbe: p.state }, t);
      this.processor.breakFixation(t);
      if (p.state === S.WATCHING) return; // WATCHING 관객은 기록만
      this.misses = 0;
      if (this.state === S.DRIFTING) this.setState(S.WATCHING, t);
      else if (this.state === S.LEFT) this.doReturn(t, 'probe');
      return;
    }
    if (t - p.t >= c.responseWindow) {
      this.pending = null;
      if (p.state === S.DRIFTING && this.state === S.DRIFTING) {
        this.misses++;
        this.log.event('probe-result', { result: 'miss', misses: this.misses, stateAtProbe: p.state }, t);
        if (this.misses >= c.missesToConfirm) {
          const leaveT = this.driftFixStart ?? p.t;
          this.recordLeave(leaveT, leaveT, t, 'probe-miss');
          this.setState(S.LEFT, t);
        }
      } else {
        this.log.event('probe-result', { result: 'miss', stateAtProbe: p.state }, t);
      }
    }
  }

  cancelProbe(t, reason) {
    if (!this.pending) return;
    this.pending = null;
    this.log.event('probe-result', { result: 'cancelled', reason }, t);
  }

  // leaveT: 타임코드 값의 기준 시각, posT: 타임코드 위치를 꺼낼 시각
  recordLeave(leaveT, posT, t, cause) {
    const c = this.cfg;
    const origin = c.timecodeOrigin === 'lastReturn' ? this.lastReturnT ?? this.t0 : this.t0;
    const elapsed = Math.max(0, leaveT - origin);
    const timecode = formatTimecode(elapsed, c.fps);
    this.leaves.push({ t: leaveT, timecode, cause });
    this.log.event(
      'leave',
      { cause, estimatedLeave: this.log.stamp(leaveT), timecode, elapsed: +elapsed.toFixed(3), origin: c.timecodeOrigin },
      t
    );
    this.onLeave?.({ leaveT, posT, timecode, cause, elapsed });
  }

  enterAway(t) {
    const prev = this.state;
    this.cancelProbe(t, 'away');
    if (this.cfg.countAwayAsLeave && prev !== S.LEFT) {
      const offStart = this.offSince;
      const leaveT = prev === S.DRIFTING && this.driftFixStart != null ? Math.min(this.driftFixStart, offStart) : offStart;
      this.recordLeave(leaveT, offStart, t, 'away');
    }
    this.setState(S.AWAY, t);
  }

  doReturn(t, cause) {
    this.lastReturnT = t;
    this.misses = 0;
    this.driftFixStart = null;
    this.processor.breakFixation(t);
    this.log.event('return', { cause }, t);
    this.setState(S.RETURNED, t);
  }
}

// 전역 프로브 스케줄러: 화면은 하나이므로 프로브도 하나다.
export class ProbeScheduler {
  constructor(cfg, probeLayer, logger) {
    this.cfg = cfg;
    this.probe = probeLayer;
    this.logger = logger;
    this.lastProbeT = -Infinity;
    this.activeUntil = -Infinity;
  }

  update(people, t, force = false) {
    const c = this.cfg;
    if (t < this.activeUntil) return false;
    const machines = people.map((p) => p.machine).filter(Boolean);
    if (!force) {
      if (t - this.lastProbeT < c.probeCooldown) return false;
      if (!machines.some((m) => m.wantsProbe(t))) return false;
    }
    const eligible = machines.filter((m) => m.isProbeEligible(t));
    if (!eligible.length) return false;
    const gazes = eligible.map((m) => m.gazeCentroid(t)).filter(Boolean);
    const pos = this.probe.show(gazes);
    this.lastProbeT = t;
    this.activeUntil = t + c.responseWindow;
    for (const m of eligible) m.beginProbe(pos, t);
    this.logger.system('probe', { x: +pos.x.toFixed(3), y: +pos.y.toFixed(3), audience: eligible.length });
    return true;
  }
}
