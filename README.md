# spacing out — 집중 이탈 포착

웹캠으로 관객 한 명의 얼굴과 시선을 분석해서, 집중이 떠난 순간까지의 경과 시간을 `MM:SS:FF` 타임코드로 남긴다.
모든 처리는 브라우저 안에서만 한다. 카메라 영상은 저장하거나 전송하지 않는다.

## 실행

```bash
npm install        # 의존성 설치 + wasm 복사 + 모델(public/models/face_landmarker.task) 내려받기
npm run dev        # http://127.0.0.1:5173
npm run build      # dist/ 에 배포용 빌드 (npm run preview 로 확인)
```

- 카메라는 `localhost`/`127.0.0.1`(또는 https)에서만 켜진다.
- 배경 영상은 `public/assets/base.mp4`에 넣는다. 파일이 없으면 검은 화면이 나온다.
- 모델과 wasm을 로컬에서 읽지 못하면 온라인 경로를 대신 쓴다.

## 키

| 키 | 동작 |
|---|---|
| `D` | 디버그 오버레이 켜기/끄기 |
| `F` | 전체화면 켜기/끄기 (첫 클릭 때도 전체화면으로 들어간다) |
| `P` | (디버그 중) 프로브를 수동으로 띄우기 |

## 구조

| 파일 | 역할 |
|---|---|
| `src/tracker.js` | 웹캠과 Face Landmarker 연결, 재연결, GPU→CPU 대체 |
| `src/signals.js` | 머리 yaw/pitch, 홍채 비율, 시선 좌표, 분산, 고정 지속, 깜빡임, 움직임 계산 |
| `src/session.js` | 세션 시작/종료(1초/5초), 캘리브레이션 기준값 |
| `src/attention.js` | 상태 머신, 프로브 반응 판정, 이탈 시점 소급, 타임코드 기록 |
| `src/probe.js` | 시선에서 먼 곳에 띄우는 작은 시각 변화 |
| `src/timecode.js` | 타임코드 형식과 표시 |
| `src/logger.js` | 세션 이벤트 JSON 로그(localStorage, 내려받기) |
| `src/debug.js` | 디버그 오버레이(카메라·랜드마크·그래프·슬라이더) |
| `src/exhibit.js` | 전체화면, 커서 숨김, 화면 꺼짐 방지, 오류 복구, 프레임 멈춤 감시 |
| `public/config.json` | 모든 임계값과 옵션 |
| `src/style.css` | 타임코드와 프로브 스타일(`:root` CSS 변수) |

## 판정 흐름

1. 얼굴이 연속 1초 검출되면 세션이 시작된다. `t0`는 기본값으로 연속 검출이 시작된 순간이다(`t0AtFirstDetection`).
2. 처음 15초 동안 신호의 평균과 표준편차를 그 관객의 기준값으로 저장한다. 시선 좌표의 중심(정면)도 이때 정한다.
3. 시선 분산이 `기준평균 + fixationZ × 표준편차` 아래로 내려가면 "고정"으로 본다(하한과 상한이 있다). 고정이 `fixationThreshold`(4초) 이상 이어지면 **DRIFTING**이 된다.
4. DRIFTING에서 쿨다운이 지났으면 프로브를 띄운다. `responseWindow` 안에 아래 중 하나가 있으면 반응으로 본다.
   - 시선이 프로브 직전 중심에서 `responseBreakRadius` 이상 벗어남
   - 머리가 `responseHeadDeg` 이상 움직임
   - 고정 판정이 풀림
   `requireProbeDirection`을 켜면 프로브 쪽으로 움직였을 때만 반응으로 친다.
5. 놓침이 `missesToConfirm`번이 되면 **LEFT**가 된다. 이탈 시각은 프로브를 띄운 시각이 아니라 그 고정이 시작된 시각으로 소급하고, 타임코드도 이 값으로 계산한다.
6. LEFT에서 시선이 움직이거나 다음 프로브에 반응하면 **RETURNED**를 거쳐 **WATCHING**으로 돌아간다.
7. 머리가 기준 각도에서 ±25° 넘게 벗어난 상태가 2초 이어지면 **AWAY**가 된다. 세션 중에 얼굴이 2초 넘게 사라져도 AWAY다(`missingCountsAsAway`). `countAwayAsLeave`가 켜져 있으면 AWAY도 이탈로 기록한다. DRIFTING 중에 AWAY가 되면 고정이 시작된 시각으로 소급한다.
8. 얼굴이 5초 동안 사라지면 세션이 끝난다. 화면의 타임코드는 페이드아웃된다.

신뢰도가 낮은 프레임은 판정에서 뺀다. 얼굴이 너무 작은 프레임, 랜드마크가 한 프레임에 튄 프레임이 여기에 해당한다. 눈을 감은 프레임에서는 홍채 위치를 갱신하지 않는다. 안경 반사나 깜빡임 때문에 생기는 오작동을 줄이려는 것이다.

## 튜닝 (작가용)

1. `D`를 눌러 디버그를 켜고 화면 앞에 앉는다.
2. 화면의 초록 원(추정 시선)이 머리와 눈을 따라 대략 맞는 방향으로 움직이는지 확인한다. 반대로 움직이면 `gaze.flipX`/`flipY`를 바꾼다. 움직임이 너무 작거나 크면 이득(gain) 값을 조정한다.
3. 영상을 보듯 시선을 움직일 때와 멍하니 한 곳을 볼 때 `시선 분산` 그래프가 빨간 임계선 위아래로 갈리는지 본다. 원이 주황색이면 고정 상태다. 갈리지 않으면 `fixationZ`와 하한/상한을 조정한다.
4. 슬라이더로 바꾼 값은 localStorage에 바로 저장된다. 마음에 들면 **config.json 내보내기**를 눌러 받은 파일을 `public/config.json`에 덮어쓴다. **설정 초기화**를 누르면 파일 값으로 돌아간다.
5. **로그 내려받기**를 누르면 세션별 이벤트 JSON을 받는다(시간·상태만 들어 있다).

## 전시 설치

Chrome 키오스크 모드로 실행하면 카메라 허용 창 없이 바로 시작한다.

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --kiosk --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --app=http://127.0.0.1:4173
```

(먼저 `npm run build && npm run preview`를 실행해 둔다.)

- 카메라 트랙이 끊기거나 4초 넘게 프레임이 없으면 자동으로 재연결한다. 재연결 간격은 1초에서 시작해 최대 10초까지 늘어난다.
- 루프 오류가 계속되면 트래커를 다시 초기화한다. 그래도 반복되면 페이지를 새로고침한다(1분에 최대 1회).
