# spacing out — 집중 이탈 포착

웹캠으로 화면 앞 관객들의 얼굴과 시선을 분석한다. 관객마다 집중이 떠난 순간을 추정해 `MM:SS:FF` 타임코드로 남긴다.
타임코드는 그 순간 관객의 두 눈 사이 자리에 고정된다. 화면에는 관객의 실루엣이 그 관객의 번호(예: `00042`) 숫자로 그려진다.

모든 처리는 브라우저 안에서만 한다. 카메라 영상이나 이미지는 저장하거나 전송하지 않는다.
저장되는 것은 번호, 시간, 좌표, 상태뿐이다.

- **배포 주소:** https://seonrinkim.github.io/spacingout/ (HTTPS라서 카메라 권한이 동작한다)

## 로컬 실행

```bash
npm install        # 의존성 설치 + wasm 복사 (모델은 public/models 에 들어 있다)
npm run dev        # http://127.0.0.1:5173/spacingout/
npm run build      # dist/ 에 배포용 빌드 (npm run preview 로 확인)
```

- 카메라는 `localhost`/`127.0.0.1` 또는 https에서만 켜진다.
- 배경 영상을 쓰려면 `public/assets/base.mp4`를 넣고 `useBaseVideo: true`로 켠다. 기본은 검은 배경이다.

## 배포 (GitHub Pages)

`main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 `npm ci` → `npm run build` → `dist`를 Pages에 올린다.
저장소 Settings → Pages의 Source는 "GitHub Actions"로 되어 있어야 한다.
`vite.config.js`의 `base`는 `/spacingout/`이다. 저장소 이름을 바꾸면 이 값도 바꾼다.
코드 안의 config, 모델, 에셋 경로는 모두 `assetUrl()`을 거쳐 이 base 아래로 간다.

## 키

| 키 | 동작 |
|---|---|
| `D` | 디버그 오버레이 켜기/끄기 |
| `F` | 전체화면 켜기/끄기 (첫 클릭 때도 전체화면으로 들어간다) |
| `P` | (디버그 중) 프로브를 수동으로 띄우기 |

## 화면 레이어 (아래 → 위)

1. 검은 배경 (`useBaseVideo`일 때만 배경 영상)
2. 숫자 실루엣 — WebGL2 인스턴싱. 숫자 글리프 아틀라스는 시작할 때 한 번 만든다.
3. 프로브 — 시선에서 먼 곳에 작은 숫자 몇 개가 약 300ms 깜빡인다.
4. 타임코드 — 빨간색은 멍하니 바라보다 프로브를 놓친 이탈이다. 같은 관객의 빨간 타임코드는 기록 순서대로 빨간 선으로 잇는다. 흰색은 고개를 돌린(AWAY) 이탈이다.
5. 디버그 오버레이

카메라 영상은 기본적으로 거울처럼 좌우 반전된다(`mirror`). 실루엣, 눈 위치, 타임코드, 디버그 표시는 모두 같은 변환(`src/view.js`)을 쓴다.

## 구조

| 파일 | 역할 |
|---|---|
| `src/tracker.js` | 웹캠, Face Landmarker(얼굴 여러 개), Pose Landmarker(사람별 마스크), Selfie Segmenter(voronoi용), 재연결 |
| `src/people.js` | 다중 관객 추적. 얼굴 중심 거리로 트랙을 매칭한다. 관객별 세션·번호·기준값·신호·상태 머신·눈 위치 버퍼를 가진다 |
| `src/signals.js` | 머리 yaw/pitch, 홍채 비율, 시선 좌표, 분산, 고정 지속, 깜빡임, 움직임 |
| `src/session.js` | 관객별 캘리브레이션 기준값 |
| `src/attention.js` | 관객별 상태 머신과 전역 프로브 스케줄러 |
| `src/silhouette.js` | 격자 다운샘플, 칸별 주인(관객) 배정, 숫자 실루엣 WebGL 렌더링 |
| `src/timecode.js` | 타임코드 형식, 표시, 빨간 경로선, localStorage 누적 |
| `src/counter.js` | 관객 번호 카운터 (localStorage) |
| `src/perf.js` | 성능 단계 자동 조정 |
| `src/view.js` | 카메라 ↔ 화면 좌표 변환 (cover + mirror) |
| `src/logger.js` | 세션 이벤트 JSON 로그 |
| `src/debug.js` | 디버그 오버레이 |
| `src/exhibit.js` | 전체화면, 커서 숨김, 화면 꺼짐 방지, 오류 복구 |
| `public/config.json` | 모든 임계값과 옵션 (배포 후에도 읽힌다) |
| `src/style.css` | 타임코드·경로선·프로브 스타일 (`:root` CSS 변수) |

## 판정 흐름 (관객마다 따로)

1. **검출:** 얼굴을 최대 `maxPeople`명까지 찾는다. 얼굴 폭이 화면의 `minFaceSize`(6%)보다 작으면 분석하지 않는다.
2. **추적:** 프레임마다 얼굴 중심 거리로 기존 트랙과 매칭한다(탐욕적, 상한 `matchDistance`).
   - 미확정 트랙은 `graceTime`(1초) 넘게 놓치면 지운다.
   - 확정된 관객은 `sessionEnd`(5초)까지 다시 이어 붙는다. 고개를 크게 돌려 얼굴이 잠깐 안 잡혀도 같은 사람으로 남는다.
3. **세션 시작:** 새 얼굴이 1초 연속 검출되면 세션이 시작되고 관객 번호를 받는다. 같은 사람이 다시 와도 새 번호를 받는다.
4. **캘리브레이션:** 처음 15초 동안 신호의 평균과 표준편차를 그 관객의 기준값으로 저장한다.
5. **DRIFTING:** 시선 분산이 기준 대비 낮은 상태(고정)가 `fixationThreshold`(4초) 이상 이어지면 DRIFTING이 된다.
6. **프로브:** 누군가 DRIFTING이고 전역 쿨다운이 지났으면 프로브 하나를 띄운다. 위치는 모든 관객의 시선에서 가장 먼 곳이다.
   - 반응 창 동안 화면 앞의 모든 관객을 각자 판정한다.
   - 놓쳤을 때 LEFT가 될 수 있는 사람은 DRIFTING이던 관객뿐이다. WATCHING이던 관객은 반응 여부를 로그에만 남긴다.
7. **LEFT:** 이탈 시각은 그 고정이 시작된 시각으로 소급한다. 타임코드는 그 시각의 눈 중앙 좌표(링버퍼에서 꺼낸 값)에 놓이고 빨간색으로 표시된다.
8. **AWAY:** 머리가 기준 각도에서 ±25° 넘게 벗어난 채 2초가 지나면 AWAY가 된다. 타임코드는 고개가 벗어나기 시작한 시점의 눈 위치에 흰색으로 놓인다.
9. **세션 종료:** 트랙이 5초 이상 사라지면 세션이 끝난다. 타임코드는 지우지 않는다.

## 숫자 실루엣

- **명도 격자:** 매 프레임 카메라 영상을 `silhouette.gridW × gridH`(160×90) 격자로 줄여 칸마다 명도를 구한다.
- **칸 배정 — `maskMode: "pose"`(기본):** Pose Landmarker의 사람별 마스크를 쓰고, 포즈의 코 위치로 얼굴 트랙과 연결한다.
- **칸 배정 — `maskMode: "voronoi"`:** 셀피 세그멘테이션 마스크 하나를 쓰고, 마스크 안의 각 칸을 가장 가까운 얼굴 트랙에 배정한다.
- **미추적 영역:** 어느 트랙에도 연결되지 않은 사람 영역은 그리지 않는다. `drawUntracked`를 켜면 회색 `00000`으로 그린다.
- **숫자 찍기:** 자동 대비(5~95% 백분위)를 적용한 뒤 명도가 `lumThreshold` 이상인 칸에 관객 번호의 숫자를 순서대로 찍는다.
  - 밝을수록 진하고 조금 크다.
  - 칸마다 크기를 조금씩 다르게 하고, 가로 지터를 준다.

## 성능 단계

처리 시간이 `perf.budgetMs`를 2초 넘게 넘으면 단계를 올린다. 여유가 10초 이어지면 내린다.

| 단계 | 내용 |
|---|---|
| 1 | 격자 ×0.75 |
| 2 | 격자 ×0.5 |
| 3 | maskMode → voronoi |
| 4~ | 가장 작은 얼굴부터 분석 제외 |

현재 단계는 디버그 오버레이의 "성능" 줄에 나온다.

## 누적 저장과 백업

- 관객 번호(`spacingout.counter`)와 모든 타임코드(`spacingout.timecodes`: 값, 정규화 좌표, 관객 번호, 기록 시각, 종류)는 localStorage에 저장된다. 시작할 때 전부 다시 그린다.
- 디버그 오버레이에서 **JSON 백업**, **JSON 복원**, **번호·타임코드 초기화**를 쓸 수 있다. 초기화는 두 번 눌러야 실행된다.
- localStorage는 브라우저·주소별로 따로다. 전시용 컴퓨터를 옮기기 전에 백업을 받아 둔다.

## 설정 (`public/config.json`)

디버그 슬라이더로 바꾼 값은 localStorage에 저장되고 `config.json`보다 우선한다.
**config.json 내보내기**로 받은 파일을 `public/config.json`에 덮어쓰면 기본값이 된다. **설정 초기화**를 누르면 파일 값으로 돌아간다.

이번에 추가된 값:

| 키 | 기본 | 설명 |
|---|---|---|
| `maxPeople` | 4 | 동시에 분석하는 최대 인원 |
| `minFaceSize` | 0.06 | 이보다 작은 얼굴(영상 폭 대비)은 분석하지 않음 |
| `matchDistance` | 0.12 | 트랙 매칭 거리 상한 (영상 폭 기준) |
| `graceTime` | 1.0 | 미확정 트랙 유예 시간(초) |
| `maskMode` | `"pose"` | `"pose"` 또는 `"voronoi"` |
| `voronoiMaxDistance` | 0.35 | voronoi에서 얼굴과 이보다 먼 칸은 배정하지 않음 |
| `drawUntracked` | false | 미추적 사람 영역을 회색 `00000`으로 |
| `eyeBufferSeconds` | 90 | 눈 중앙 좌표 링버퍼 길이 |
| `mirror` | true | 카메라 좌우 반전 |
| `useBaseVideo` | false | 배경 영상 사용 |
| `silhouette.*` | | `gridW/gridH`, `lumThreshold`, `autoContrast`, `alphaMin`, `alphaGamma`, `glyphScale`, `sizeMin/sizeMax`, `jitter`, `color`, `untrackedColor`, `untrackedAlpha`, `maskThreshold`, `maskInputWidth`, `dprMax` |
| `perf.*` | | `auto`, `budgetMs`, `level`(auto를 끌 때 고정 단계) |
| `timecode.*` | | `fadeIn`, `drawPaths`, `fadeOld`(오래된 것부터 흐려짐), `fadeOldCount`, `fadeOldMin` |

타임코드와 경로선의 색·크기·글꼴은 `src/style.css`의 `--tc-*` 변수로 바꾼다.

## 튜닝 (작가용)

1. `D`를 눌러 디버그를 켜고 화면 앞에 앉는다.
2. 왼쪽 위 카메라 미리보기와 그 아래 마스크 맵에서 관객별 색과 번호가 맞게 나뉘는지 본다.
3. 관객 패널을 누르면 그 관객의 신호 그래프가 나온다.
4. 원(추정 시선)이 바라보는 방향으로 움직이는지 본다. 반대로 움직이면 `gaze.flipX`/`flipY`를 바꾼다.
5. 멍하니 있을 때 "시선 분산" 그래프가 빨간 임계선 아래로 내려가는지 본다. 내려가지 않으면 `fixationZ`를 조정한다.

## 전시 설치

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --kiosk --use-fake-ui-for-media-stream --app=https://seonrinkim.github.io/spacingout/
```

- 카메라가 끊기거나 4초 넘게 프레임이 없으면 자동으로 재연결한다.
- 루프 오류가 계속되면 트래커를 다시 초기화하고, 그래도 반복되면 페이지를 새로고침한다(1분에 최대 1회).
