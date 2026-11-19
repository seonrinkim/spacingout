// 웹캠 + MediaPipe Face Landmarker. 영상은 메모리에서만 처리하고 저장/전송하지 않는다.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { assetUrl } from './config.js';

/* global __MP_VERSION__ */
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${__MP_VERSION__}/wasm`;
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const abs = assetUrl;

export class Tracker {
  constructor(cfg, video, logger) {
    this.cfg = cfg;
    this.video = video;
    this.logger = logger;
    this.landmarker = null;
    this.stream = null;
    this.status = 'idle';
    this.lastError = '';
    this.retry = 0;
    this.reconnectTimer = null;
    this.lastVideoTime = -1;
    this.lastTs = 0;
    this.detections = 0;
  }

  async init() {
    await this.loadModel();
    await this.startCamera();
    navigator.mediaDevices?.addEventListener?.('devicechange', () => {
      this.logger?.system('camera-devicechange');
      if (!this.isLive()) this.scheduleReconnect(500);
    });
  }

  async loadModel() {
    const c = this.cfg;
    this.status = 'model-loading';
    const sources = [
      { wasm: abs(c.model.wasm), model: abs(c.model.path) },
      { wasm: CDN_WASM, model: CDN_MODEL },
    ];
    const delegates = [...new Set([c.model.delegate || 'GPU', 'CPU'])];
    for (const src of sources) {
      for (const delegate of delegates) {
        try {
          const fileset = await FilesetResolver.forVisionTasks(src.wasm);
          this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: src.model, delegate },
            runningMode: 'VIDEO',
            numFaces: Math.max(1, c.numFaces | 0),
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            minFaceDetectionConfidence: c.minFaceDetectionConfidence,
            minFacePresenceConfidence: c.minFacePresenceConfidence,
            minTrackingConfidence: c.minTrackingConfidence,
          });
          this.modelInfo = `${delegate} · ${src.model === CDN_MODEL ? 'online' : 'local'}`;
          this.logger?.system('model-ready', { delegate, source: src.model === CDN_MODEL ? 'online' : 'local' });
          this.status = 'model-ready';
          return;
        } catch (e) {
          console.warn('[tracker] 모델 로드 실패', src.model, delegate, e);
          this.lastError = String(e?.message || e);
        }
      }
    }
    this.status = 'model-error';
    throw new Error('Face Landmarker 모델을 불러오지 못했습니다');
  }

  async startCamera() {
    this.stopCamera();
    this.status = 'camera-starting';
    const c = this.cfg.camera;
    const base = {
      width: { ideal: c.width },
      height: { ideal: c.height },
      frameRate: { ideal: c.fps || 30 },
    };
    const attempts = c.deviceId ? [{ ...base, deviceId: { exact: c.deviceId } }, base] : [base];
    for (const video of attempts) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
        const track = this.stream.getVideoTracks()[0];
        track.addEventListener('ended', () => {
          this.logger?.system('camera-ended');
          this.status = 'camera-lost';
          this.scheduleReconnect();
        });
        this.video.srcObject = this.stream;
        await this.video.play();
        this.status = 'running';
        this.retry = 0;
        this.lastVideoTime = -1;
        this.lastError = '';
        this.logger?.system('camera-started', { label: track.label ? 'ok' : '' });
        return;
      } catch (e) {
        this.lastError = `${e?.name || ''} ${e?.message || e}`.trim();
        console.warn('[tracker] 카메라 시작 실패', e);
      }
    }
    this.status = 'camera-error';
    this.logger?.system('camera-error', { error: this.lastError });
    this.scheduleReconnect();
  }

  stopCamera() {
    if (this.stream) for (const tr of this.stream.getTracks()) tr.stop();
    this.stream = null;
    this.video.srcObject = null;
  }

  isLive() {
    const tr = this.stream?.getVideoTracks()[0];
    return !!tr && tr.readyState === 'live';
  }

  scheduleReconnect(delay) {
    if (this.reconnectTimer) return;
    const d = delay ?? Math.min(10000, 1000 * 2 ** this.retry);
    this.retry++;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.landmarker) {
        try { await this.loadModel(); } catch { this.scheduleReconnect(); return; }
      }
      await this.startCamera();
    }, d);
  }

  restart(reason) {
    this.logger?.system('camera-restart', { reason });
    this.status = 'camera-restarting';
    this.scheduleReconnect(0);
  }

  async reinit(reason) {
    this.logger?.system('tracker-reinit', { reason });
    try { this.landmarker?.close(); } catch { /* noop */ }
    this.landmarker = null;
    this.stopCamera();
    this.scheduleReconnect(0);
  }

  get aspect() {
    return this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 4 / 3;
  }

  // 새 카메라 프레임이 있으면 결과, 없으면 undefined
  detect(tsMs) {
    if (!this.landmarker || this.status !== 'running') return undefined;
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime) return undefined;
    this.lastVideoTime = v.currentTime;
    const ts = Math.max(tsMs, this.lastTs + 1);
    this.lastTs = ts;
    const res = this.landmarker.detectForVideo(v, ts);
    this.detections++;
    return res;
  }
}

// 결과에서 가장 큰 얼굴 하나를 고른다
export function pickLargestFace(res, aspect) {
  const faces = res?.faceLandmarks;
  if (!faces || !faces.length) return null;
  let best = 0, bestW = -1;
  faces.forEach((lm, i) => {
    let x0 = 1, x1 = 0;
    for (const p of lm) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; }
    if (x1 - x0 > bestW) { bestW = x1 - x0; best = i; }
  });
  return {
    landmarks: faces[best],
    blendshapes: res.faceBlendshapes?.[best]?.categories || [],
    matrix: res.facialTransformationMatrixes?.[best] || null,
    aspect,
  };
}
