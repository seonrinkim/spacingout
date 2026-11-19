// 숫자 실루엣. 웹캠 영상을 격자로 줄이고, 사람 영역 안의 밝은 칸마다 그 관객의 번호 숫자를 찍는다.
// WebGL2 인스턴싱으로 그린다(숫자 글리프 아틀라스는 시작할 때 한 번 만든다).

const VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aInst;   // x(px), y(px), size(px), digit
layout(location=2) in vec4 aColor;  // r, g, b, alpha
uniform vec2 uRes;
uniform float uAspect;
out vec2 vUV;
out vec4 vColor;
void main() {
  vec2 sz = vec2(aInst.z * uAspect, aInst.z);
  vec2 p = aInst.xy + (aCorner - 0.5) * sz;
  vec2 clip = p / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUV = vec2((aInst.w + 0.06 + aCorner.x * 0.88) / 10.0, aCorner.y);
  vColor = aColor;
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec4 vColor;
uniform sampler2D uAtlas;
out vec4 o;
void main() {
  float a = texture(uAtlas, vUV).r * vColor.a;
  o = vec4(vColor.rgb * a, a);
}`;

const GLYPH_W = 48, GLYPH_H = 64;
const FLOATS = 8;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const hash = (i, j) => {
  const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export class Silhouette {
  constructor(canvas, cfg) {
    this.canvas = canvas;
    this.cfg = cfg;
    this.ok = false;
    this.lumCanvas = document.createElement('canvas');
    this.lumCtx = this.lumCanvas.getContext('2d', { willReadFrequently: true });
    this.owner = null; // 디버그: 칸별 소유자 (-1 없음, -2 미추적, k = people 인덱스)
    this.ownerPeople = [];
    this.gw = 0;
    this.gh = 0;
    this.lo = 0;
    this.hi = 1;
    this.count = 0;
    try {
      this.initGL();
      this.ok = true;
    } catch (e) {
      console.warn('[silhouette] WebGL2 를 쓸 수 없어 실루엣을 끕니다', e);
    }
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  initGL() {
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.uRes = gl.getUniformLocation(prog, 'uRes');
    this.uAspect = gl.getUniformLocation(prog, 'uAspect');

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instBuf = gl.createBuffer();
    this.capacity = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS * 4, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FLOATS * 4, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    // 숫자 아틀라스 (시작할 때 한 번만 만든다)
    const atlas = document.createElement('canvas');
    atlas.width = GLYPH_W * 10;
    atlas.height = GLYPH_H;
    const ctx = atlas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, atlas.width, atlas.height);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${GLYPH_H * 0.86}px Menlo, "SF Mono", Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = 0; d < 10; d++) ctx.fillText(String(d), d * GLYPH_W + GLYPH_W / 2, GLYPH_H / 2 + 2);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, this.cfg.silhouette.dprMax || 1.5);
    this.dpr = dpr;
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
  }

  clear() {
    if (!this.ok) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.count = 0;
  }

  // 칸마다 주인(관객)을 정한다. people: 확정된 관객 목록
  assignOwners(det, people, view, gw, gh) {
    const c = this.cfg, s = c.silhouette;
    const n = gw * gh;
    if (!this.owner || this.owner.length !== n) this.owner = new Int16Array(n);
    const owner = this.owner;
    owner.fill(-1);
    if (!det || !det.mw || (!det.masks.length && !det.segMask)) return;
    const { mw, mh } = det;
    const ar = view.camAspect;
    const thr = s.maskThreshold;
    // 지금 보이는 관객만
    const cand = people.map((p, k) => ({ p, k })).filter(({ p }) => p.face);

    if (det.maskMode === 'pose' && det.masks.length) {
      // 포즈마다 코 위치로 가장 가까운 얼굴 트랙에 연결
      const poseOwner = det.poses.map((lm) => {
        const nose = lm?.[0];
        if (!nose) return -2;
        let best = -2, bd = c.matchDistance * 1.5;
        for (const { p, k } of cand) {
          const d = Math.hypot((nose.x - p.cx) * ar, nose.y - p.cy) / ar;
          if (d < bd) { bd = d; best = k; }
        }
        return best;
      });
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          const cam = view.screenToCam((i + 0.5) / gw, (j + 0.5) / gh);
          if (cam.x < 0 || cam.x >= 1 || cam.y < 0 || cam.y >= 1) continue;
          const idx = Math.floor(cam.y * mh) * mw + Math.floor(cam.x * mw);
          let bestV = thr, bestK = -1;
          for (let k = 0; k < det.masks.length; k++) {
            const v = det.masks[k][idx];
            if (v > bestV) { bestV = v; bestK = k; }
          }
          if (bestK >= 0) owner[j * gw + i] = poseOwner[bestK] ?? -2;
        }
      }
    } else if (det.segMask) {
      // voronoi: 마스크 하나를 가장 가까운 얼굴 트랙에 나눠 준다
      const m = det.segMask;
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          const cam = view.screenToCam((i + 0.5) / gw, (j + 0.5) / gh);
          if (cam.x < 0 || cam.x >= 1 || cam.y < 0 || cam.y >= 1) continue;
          const v = m[Math.floor(cam.y * mh) * mw + Math.floor(cam.x * mw)];
          if (!(v > thr)) continue;
          let best = -2, bd = c.voronoiMaxDistance;
          for (const { p, k } of cand) {
            // 몸은 얼굴 아래로 길게 이어지므로 세로 거리는 덜 친다
            const dy = cam.y > p.cy ? (cam.y - p.cy) * 0.35 : cam.y - p.cy;
            const d = Math.hypot((cam.x - p.cx) * ar, dy) / ar;
            if (d < bd) { bd = d; best = k; }
          }
          owner[j * gw + i] = best;
        }
      }
    }
  }

  render(video, det, people, view, gridScale = 1) {
    if (!this.ok) return;
    const c = this.cfg, s = c.silhouette;
    if (!s.enabled || !video || video.readyState < 2) {
      this.clear();
      return;
    }
    const gw = Math.max(8, Math.round(s.gridW * gridScale));
    const gh = Math.max(6, Math.round(s.gridH * gridScale));
    this.gw = gw;
    this.gh = gh;
    this.ownerPeople = people;

    // 1) 명도: 화면에 보이는 카메라 구간을 격자 크기로 줄여서 읽는다
    if (this.lumCanvas.width !== gw || this.lumCanvas.height !== gh) {
      this.lumCanvas.width = gw;
      this.lumCanvas.height = gh;
    }
    const vw = video.videoWidth, vh = video.videoHeight;
    const lc = this.lumCtx;
    lc.setTransform(view.mirror ? -1 : 1, 0, 0, 1, view.mirror ? gw : 0, 0);
    lc.drawImage(video, view.ox * vw, view.oy * vh, view.visW * vw, view.visH * vh, 0, 0, gw, gh);
    lc.setTransform(1, 0, 0, 1, 0, 0);
    const px = lc.getImageData(0, 0, gw, gh).data;

    // 2) 칸별 주인
    this.assignOwners(det, people, view, gw, gh);
    const owner = this.owner;

    // 3) 사람 영역 안 명도 범위 (자동 대비)
    const n = gw * gh;
    if (!this.lum || this.lum.length !== n) this.lum = new Float32Array(n);
    const lum = this.lum;
    const hist = new Uint32Array(64);
    let inside = 0;
    for (let q = 0; q < n; q++) {
      const o = q * 4;
      const L = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
      lum[q] = L;
      if (owner[q] !== -1) {
        hist[Math.min(63, (L * 64) | 0)]++;
        inside++;
      }
    }
    if (s.autoContrast && inside > 20) {
      const pct = (f) => {
        let acc = 0;
        const target = inside * f;
        for (let b = 0; b < 64; b++) {
          acc += hist[b];
          if (acc >= target) return (b + 0.5) / 64;
        }
        return 1;
      };
      const lo = pct(0.05), hi = Math.max(lo + 0.05, pct(0.95));
      this.lo += 0.15 * (lo - this.lo);
      this.hi += 0.15 * (hi - this.hi);
    } else if (!s.autoContrast) {
      this.lo = 0;
      this.hi = 1;
    }

    // 4) 인스턴스 만들기
    if (this.capacity < n) {
      this.capacity = n;
      this.inst = new Float32Array(n * FLOATS);
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    }
    const inst = this.inst;
    const W = this.canvas.width, H = this.canvas.height;
    const cw = W / gw, ch = H / gh;
    const [r, g, b] = hexToRgb(s.color);
    const [ur, ug, ub] = hexToRgb(s.untrackedColor);
    const labels = people.map((p) => p.label);
    const thr = s.lumThreshold, range = Math.max(0.02, this.hi - this.lo);
    let count = 0;
    for (let j = 0; j < gh; j++) {
      const rowShift = Math.floor(hash(j, 7) * 5);
      for (let i = 0; i < gw; i++) {
        const q = j * gw + i;
        const o = owner[q];
        if (o === -1) continue;
        if (o === -2 && !c.drawUntracked) continue;
        const nl = Math.min(1, Math.max(0, (lum[q] - this.lo) / range));
        if (nl < thr) continue;
        const k = (nl - thr) / Math.max(0.01, 1 - thr);
        const label = o >= 0 ? labels[o] : '00000';
        const digit = label.charCodeAt((i + rowShift) % label.length) - 48;
        const hv = hash(i, j);
        const size = ch * s.glyphScale * (s.sizeMin + (s.sizeMax - s.sizeMin) * hv) * (0.85 + 0.3 * k);
        const x = (i + 0.5) * cw + (Math.random() - 0.5) * 2 * s.jitter * cw;
        const y = (j + 0.5) * ch + (hash(j, i) - 0.5) * 0.3 * ch;
        let a = s.alphaMin + (1 - s.alphaMin) * Math.pow(k, s.alphaGamma);
        const bright = 0.55 + 0.45 * k;
        const f = count * FLOATS;
        inst[f] = x;
        inst[f + 1] = y;
        inst[f + 2] = size;
        inst[f + 3] = digit >= 0 && digit <= 9 ? digit : 0;
        if (o >= 0) {
          inst[f + 4] = r * bright;
          inst[f + 5] = g * bright;
          inst[f + 6] = b * bright;
        } else {
          a *= s.untrackedAlpha;
          inst[f + 4] = ur;
          inst[f + 5] = ug;
          inst[f + 6] = ub;
        }
        inst[f + 7] = a;
        count++;
      }
    }
    this.count = count;

    // 5) 그리기
    const gl = this.gl;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!count) return;
    gl.useProgram(this.prog);
    gl.uniform2f(this.uRes, W, H);
    gl.uniform1f(this.uAspect, (GLYPH_W / GLYPH_H) * 0.88);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, count * FLOATS);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }
}
