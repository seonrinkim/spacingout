// MediaPipe wasm 파일을 public/wasm 으로 복사하고, Face Landmarker 모델을 public/models 에 받아 둔다.
// 전시장에서 인터넷 없이 돌아가게 하려는 것. `npm install` 뒤에 자동으로 실행된다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

function copyWasm() {
  const src = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
  const dst = path.join(pub, 'wasm');
  if (!fs.existsSync(src)) {
    console.warn('[setup] @mediapipe/tasks-vision 가 아직 설치되지 않았습니다.');
    return;
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  console.log('[setup] wasm 복사 완료 → public/wasm');
}

async function fetchModel() {
  const dst = path.join(pub, 'models', 'face_landmarker.task');
  if (fs.existsSync(dst) && fs.statSync(dst).size > 1_000_000) {
    console.log('[setup] 모델 파일이 이미 있습니다 → public/models/face_landmarker.task');
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  console.log('[setup] Face Landmarker 모델 내려받는 중…');
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
    console.log('[setup] 모델 저장 완료 → public/models/face_landmarker.task');
  } catch (e) {
    console.warn('[setup] 모델을 받지 못했습니다(' + e.message + '). 실행 시 온라인 경로로 대체합니다.');
  }
}

fs.mkdirSync(path.join(pub, 'assets'), { recursive: true });
copyWasm();
await fetchModel();
