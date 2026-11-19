// 웹캠 + MediaPipe (Face Landmarker, Pose Landmarker 마스크, Selfie Segmenter).
// 영상은 메모리에서만 처리하고 저장/전송하지 않는다.
import { FaceLandmarker, PoseLandmarker, ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';
import { assetUrl } from './config.js';

/* global __MP_VERSION__ */
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${__MP_VERSION__}/wasm`;

export class Tracker {
  constructor(cfg, video, logger) {
    this.cfg = cfg;
    this.video = video;
    this.logger = logger;
    this.face = null;
    this.pose = null;
    this.seg = null;
    this.fileset = null;
    this.stream = null;
    this.status = 'idle';
    this.lastError = '';
    this.retry = 0;
    this.reconnectTimer = null;
    this.lastVideoTime = -1;
    this.lastTs = 0;
    this.detections = 0;
    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: false });
    this.numFaces = 0;
  }

  async init() {
    await this.loadModel();
    await this.startCamera();
    navigator.mediaDevices?.addEventListener?.('devicechange', () => {
      this.logger?.system('camera-devicechange');
      if (!this.isLive()) this.scheduleReconnect(500);
    });
  }

  async getFileset() {
    if (this.fileset) return this.fileset;
    for (const wasm of [assetUrl(this.cfg.model.wasm), CDN_WASM]) {
      try {
        this.fileset = await FilesetResolver.forVisionTasks(wasm);
        return this.fileset;
      } catch (e) {
        console.warn('[tracker] wasm 로드 실패', wasm, e);
      }
    }
    throw new Error('wasm 로드 실패');
  }

  async create(Task, modelPath, options) {
    const fileset = await this.getFileset();
    const delegates = [...new Set([this.cfg.model.delegate || 'GPU', 'CPU'])];
    for (const delegate of delegates) {
      try {
        const task = await Task.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: assetUrl(modelPath), delegate },
          runningMode: 'VIDEO',
          ...options,
        });
        return { task, delegate };
      } catch (e) {
        console.warn('[tracker] 모델 로드 실패', modelPath, delegate, e);
        this.lastError = String(e?.message || e);
      }
    }
    return { task: null };
  }

  async loadModel() {
    const c = this.cfg;
    this.status = 'model-loading';
    this.numFaces = Math.max(1, c.maxPeople | 0);
    const f = await this.create(FaceLandmarker, c.model.path, {
      numFaces: this.numFaces,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: c.minFaceDetectionConfidence,
      minFacePresenceConfidence: c.minFacePresenceConfidence,
      minTrackingConfidence: c.minTrackingConfidence,
    });
    if (!f.task) {
      this.status = 'model-error';
      throw new Error('Face Landmarker 모델을 불러오지 못했습니다');
    }
    this.face = f.task;
    // 마스크용 모델은 실패해도 얼굴 분석은 계속한다
    const p = await this.create(PoseLandmarker, c.model.posePath, {
      numPoses: this.numFaces,
      outputSegmentationMasks: true,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    this.pose = p.task;
    const s = await this.create(ImageSegmenter, c.model.segPath, {
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    this.seg = s.task;
    this.modelInfo = `face ${f.delegate}${this.pose ? ' · pose ' + p.delegate : ' · pose ✕'}${this.seg ? ' · seg ' + s.delegate : ' · seg ✕'}`;
    this.logger?.system('model-ready', { info: this.modelInfo });
    this.status = 'model-ready';
  }

  // maxPeople 이 바뀌면 검출 개수를 갱신
  async syncPeople() {
    const n = Math.max(1, this.cfg.maxPeople | 0);
    if (n === this.numFaces) return;
    this.numFaces = n;
    try {
      await this.face?.setOptions({ numFaces: n });
      await this.pose?.setOptions({ numPoses: n });
    } catch (e) {
      console.warn('[tracker] setOptions 실패', e);
    }
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
        this.logger?.system('camera-started');
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
      if (!this.face) {
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
    for (const t of [this.face, this.pose, this.seg]) {
      try { t?.close(); } catch { /* noop */ }
    }
    this.face = this.pose = this.seg = null;
    this.stopCamera();
    this.scheduleReconnect(0);
  }

  get aspect() {
    return this.video.videoWidth && this.video.videoHeight ? this.video.videoWidth / this.video.videoHeight : 16 / 9;
  }

  // 새 카메라 프레임이 있으면 결과, 없으면 undefined
  // 반환: { faces: [{landmarks, blendshapes, matrix, aspect}], poses, masks: Float32Array[], segMask, mw, mh }
  detect(tsMs, maskMode) {
    if (!this.face || this.status !== 'running') return undefined;
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this.lastVideoTime) return undefined;
    this.lastVideoTime = v.currentTime;
    const ts = Math.max(tsMs, this.lastTs + 1);
    this.lastTs = ts;
    this.detections++;

    const fr = this.face.detectForVideo(v, ts);
    const aspect = this.aspect;
    const faces = (fr.faceLandmarks || []).map((lm, i) => ({
      landmarks: lm,
      blendshapes: fr.faceBlendshapes?.[i]?.categories || [],
      matrix: fr.facialTransformationMatrixes?.[i] || null,
      aspect,
    }));

    const out = { faces, poses: [], masks: [], segMask: null, mw: 0, mh: 0, maskMode: null };
    if (!this.cfg.silhouette.enabled && !document.body.classList.contains('debug')) return out;

    // 마스크는 작은 입력으로 계산한다
    const mw = Math.max(64, this.cfg.silhouette.maskInputWidth | 0);
    const mh = Math.round(mw / aspect);
    if (this.maskCanvas.width !== mw || this.maskCanvas.height !== mh) {
      this.maskCanvas.width = mw;
      this.maskCanvas.height = mh;
    }
    this.maskCtx.drawImage(v, 0, 0, mw, mh);
    out.mw = mw;
    out.mh = mh;

    const mode = maskMode === 'pose' && this.pose ? 'pose' : this.seg ? 'voronoi' : this.pose ? 'pose' : null;
    out.maskMode = mode;
    try {
      if (mode === 'pose') {
        const pr = this.pose.detectForVideo(this.maskCanvas, ts);
        out.poses = pr.landmarks || [];
        out.masks = (pr.segmentationMasks || []).map((m) => {
          const a = m.getAsFloat32Array().slice();
          out.mw = m.width;
          out.mh = m.height;
          m.close?.();
          return a;
        });
        pr.close?.();
      } else if (mode === 'voronoi') {
        const sr = this.seg.segmentForVideo(this.maskCanvas, ts);
        const cm = sr.confidenceMasks || [];
        if (cm.length) {
          const m = cm[cm.length === 1 ? 0 : cm.length - 1];
          out.segMask = m.getAsFloat32Array().slice(); // 마스크가 여러 개면 마지막이 사람
          out.mw = m.width;
          out.mh = m.height;
        }
        for (const m of cm) m.close?.();
        sr.close?.();
      }
    } catch (e) {
      console.warn('[tracker] 마스크 계산 실패', e);
    }
    return out;
  }
}
