// MediaPipe wasm 파일을 public/wasm 으로 복사하고, 모델이 없으면 public/models 에 받아 둔다.
// 전시장에서 인터넷 없이 돌아가게 하려는 것. `npm install` 뒤에 자동으로 실행된다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const MODELS = {
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  'pose_landmarker_lite.task':
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  'selfie_segmenter.tflite':
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
};

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

// 모델은 저장소에 포함되어 있다. 없을 때만 받는다.
async function fetchModels() {
  for (const [name, url] of Object.entries(MODELS)) {
    const dst = path.join(pub, 'models', name);
    if (fs.existsSync(dst) && fs.statSync(dst).size > 100_000) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    console.log(`[setup] ${name} 내려받는 중…`);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(dst, Buffer.from(await res.arrayBuffer()));
      console.log(`[setup] 저장 완료 → public/models/${name}`);
    } catch (e) {
      console.warn(`[setup] ${name} 를 받지 못했습니다(${e.message}).`);
    }
  }
}

fs.mkdirSync(path.join(pub, 'assets'), { recursive: true });
copyWasm();
await fetchModels();
