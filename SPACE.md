# Santa Attic (WebXR) — 개발자 인수인계

Meta Quest(손 추적, 컨트롤러 없음) + PC(마우스)용 Three.js(r169, CDN importmap) 장면.
빌드 도구 없음. 일반 `<script>` + 인라인 `<script type="module">` 구조라서 `index.html` 더블클릭(`file://`)으로도 열린다.

## 실행
- PC: `index.html` 더블클릭 (인터넷 필요: three.js CDN, KTX2 변환기 WASM).
- Quest: `실행.bat` (로컬 서버를 띄움) 후 헤드셋 브라우저에서 접속. `?quest` 를 붙이면 PC에서도 Quest 프로필로 렌더.
- URL 옵션: `?nostats` (FPS 패널 숨김), `?quest` (Quest 프로필).

## 폴더
| 경로 | 내용 |
|---|---|
| `index.html` | 장면 전체 (방 배치, 조명, 창밖, 성능 패스, 모듈 연결). 약 1000줄 |
| `room.glb` | Blender 내보내기 원본 (**수정 금지, 소스**) |
| `room.glb.js` | `room.glb`를 KTX2로 변환 후 base64로 감싼 것. **실제로 로드되는 파일** |
| `trees.glb.js` | 밖의 소나무 (base64) |
| `modules/` | 기능 모듈 (아래 표) |
| `Sound/` | 원본 mp3 (BGM, SFX). 실제 재생은 `modules/audio.data.js` 에 박힌 사본 사용 |
| `../_tools/` | 변환 도구 (`ktx2room.mjs`), `scratch/` 는 임시 테스트 스크립트 |
| `*-test.html` | 모듈 단독 테스트 페이지 (herb, mug, drawer, snowglobe) |

## 모듈 (`modules/`)
모두 **일반 스크립트**이고 `window.xxxReady`(Promise)로 로딩 완료를 알린다. `index.html` 이 순서대로 로드한다.

| 파일 | 하는 일 | 의존 |
|---|---|---|
| `herbs.js` | 허브 화분(리깅), 손 핀치·주먹 인식, 마우스 입력. **입력 허브** (`HerbGarden`) | 없음 |
| `mug.js` | 핫초코 머그: 마시기, 리필, 김, 식음/녹음 | herbs |
| `drawers.js` + `drawers.painted.js` | 작은 서랍장 6개 열기 + 페인팅 텍스처 | herbs |
| `turntable.js` + `turntable.glb.js` | LP 턴테이블, `Jukebox`(BGM 순환, LP 필터) | audio3d |
| `props.js` + `props.data.js` | 천사·눈사람·사슴·탁자 (`Prop`) | herbs |
| `kitchen.js` + `kitchen.data.js` | 병 5종(가루 3 / 액체 2), 레몬(한 번만 자름), 칼 | herbs, audio3d |
| `nametag.js` + `nametag.data.js` | 종이 이름표 `createNameTag({text,width,color,curl})` | 없음 |
| `audio3d.js` + `audio.data.js` | 3D 공간음 (`Audio3D`) | 없음 |
| `snowglobe.js` + `snowglobe.glb(.js)` | 스노우글로브 (단독 테스트: `snowglobe-test.html`) | herbs |

`*.data.js` / `*.glb.js` 는 에셋을 base64로 박은 파일이다 (`file://` 에서는 fetch/`<audio>` 라우팅이 막히기 때문). 서버로만 돌릴 거면 일반 파일 로드로 바꿔도 된다.

## 입력 구조 (중요)
`HerbGarden` (`herbs.js`) 이 손/마우스를 읽고, 잡을 수 있는 물건은 `garden.extras.push(obj)` 로 등록한다.
`obj` 가 구현할 것:
```js
get center()          // 마우스 조준용 월드 좌표 (Vector3)
tryGrab(source)       // 주먹/클릭 시. 잡았으면 true. source.hold = 손 위치
drop(source)          // 놓을 때. source.hvel = 손 속도
update(dt)            // 매 프레임
```
새 물건을 추가하려면 `kitchen.js` 의 `Grab` 클래스를 쓰면 된다 (원점 = 물건 중심, 바닥까지 거리 `base`, 충돌 박스 `Box3`). 놓으면 아래로 떨어져 `garden.colliders` 위에 멈춘다. 너무 멀리 던지면 `home` 으로 복귀.

- 손: 허브는 **핀치**, 머그/서랍/소품/병은 **주먹**. 마우스: 왼쪽 버튼 = 잡기, 오른쪽 드래그 = 시점 회전.
- 허브 한 번 뜯으면 `BUNCH`(herbs.js 상단)줄기가 한 다발로 나옴.

## 자주 바꾸는 값 (`index.html`)
| 값 | 의미 |
|---|---|
| `LITE`, `QUEST` | 성능 프로필 (그림자 끔, Lambert 변환, 텍스처 크기 제한, 해상도/foveation) |
| `LIFT`, `SHELF_LIFT`, `moveW(...)` | 런타임 레이아웃 보정 (책상 0.2m 올림, 책장 등) |
| `DRAWER_GAIN`, `DRAWER_FILL` | 서랍 페인팅 텍스처 밝기 보정 |
| `TAG_TEXT` | 서랍 이름표 글자 6개 |
| `BGM` | BGM 파일 수 (실제 곡은 `audio.data.js`) |
| 선반 위 배치 (`kitchenObjs` 근처) | 병/레몬/칼 위치. 선반은 63.4° 회전, 바닥 41×19 cm. `at(a,b)` 헬퍼 사용 |
| `SHOW_STATS` | FPS 패널 (Quest 는 시야 고정 3D 패널) |

## Blender → 웹
1. Blender 에서 `room.glb` 로 내보내 `web/` 에 덮어쓴다.
2. `room.glb 변경후_실행.bat` 실행 → `../_tools/ktx2room.mjs` 로 텍스처를 KTX2로 압축하고(오브젝트 크기별 256~2048) `room.glb.js` 재생성.
   - 최초 1회: `cd ../_tools && npm i` (node 필요).
3. GLTFLoader 는 노드 이름의 `.` 을 지운다 (`Cube.002` → `Cube002`). 코드는 지워진 이름을 쓴다.

## 알아둘 함정
- **영(0) 길이 법선**은 NaN 조명 → 블룸이 화면에 검은 사각형을 만든다. 모델을 추가할 때 법선을 확인하거나 Unlit 재질을 쓸 것. 방지용 NaN 가드 패스가 컴포저에 있음 (XR 에는 컴포저 없음).
- 정적 메시는 `matrixAutoUpdate=false` 로 얼린다. 움직이는 부품은 `userData.dynamic = true` 로 표시해야 한다 (서랍 부품이 그 예).
- 오디오는 사용자 입력(클릭/키/XR 시작) 후에야 시작된다.
- `file://` 에서 `<audio>` 를 Web Audio 에 연결하면 **무음**이다 → 그래서 소리를 디코딩 버퍼로 재생한다.
- 오래된 Quest 에서 KTX2 변환기 WASM 은 CDN(jsdelivr)에서 받는다. 오프라인이면 방이 로드되지 않는다.

## 알려진 한계 / 하고 싶은 것
- 서랍 UV 조각이 많다(약 3,400개). 가장자리 번짐이 보이면 서랍을 단순화해 다시 풀어야 한다.
- 병은 잡아서 옮기기만 가능 (따르기·마개 열기 없음). 레몬은 가운데에서 한 번만 잘린다.
- Quest 실기기 FPS 는 패널 숫자로 확인 필요 (PC 헤드리스로만 검증됨).
