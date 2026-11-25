# LUSH 레시피북 — three.js 모듈

책 한 권을 three.js 씬에 넣어 쓰는 모듈입니다. 책이 하는 일은 모두 이 모듈 안에 들어 있습니다.

- 덮인 책이 펼쳐지는 애니메이션: 표지와 속지가 넘어가고, 책등이 휘어져 펴집니다.
- 감정 선택 페이지: 감정을 고르면 빨간 색연필 밑줄과 체크가 그려지고, 페이지가 넘어가 해당 배쓰밤 레시피가 나옵니다.
- 레시피별 재료 퀘스트: 완료한 재료에 줄을 긋고, 화살표가 다음 재료로 옮겨 가 깜빡이며 가리킵니다.

씬, 카메라, 조명, 입력(마우스나 VR)은 사용하는 쪽 프로젝트가 맡습니다.

## 폴더 구성

```
src/RecipeBook.js     ← 모듈 본체 (이 파일 하나만 import)
assets/
  models/             책 GLB 2개 (덮인 모델: 표지·책등 / 펼친 모델: 종이 묶음)
  pages/              페이지 이미지 2240×1600 (emotion.jpg, recipe_<id>.jpg)
  ui/                 화살표 · 취소선 · 감정 체크 표시 · 넘어가는 종이 텍스쳐
example/              사용 예시 (씬 구성, 카메라 이동, 마우스 피킹)
preview/              참고용 완성 뷰어 — index.html 더블클릭으로 바로 열림 (서버 불필요)
```

> `preview/`는 기획에서 확인하던 뷰어를 그대로 넣은 참고용입니다. 모든 자산이 `models.js` 한 파일에 묶여 있어서 코드 재사용에는 맞지 않습니다. 동작과 모션이 어떻게 보여야 하는지 확인하는 기준으로만 써 주세요.

## 실행해 보기

- **결과만 보려면:** 압축을 푼 뒤 맨 위의 `index.html`(또는 `preview/index.html`)을 더블클릭하세요. 서버 없이 열립니다.
- **개발용 예시:** `example/`은 아래처럼 웹 서버로 실행해야 합니다.

```bash
npm install
npm run dev          # http://localhost:5173/example/ 이 열림
```

> GLB와 이미지를 `fetch`로 불러오기 때문에 반드시 웹 서버로 열어야 합니다. `index.html`을 더블클릭해서 여는 `file://` 방식은 동작하지 않습니다.

## 기본 사용법

```js
import { createRecipeBook } from './src/RecipeBook.js';

const book = await createRecipeBook({ renderer, assetsUrl: '/assets/' });
scene.add(book.object);          // 위치·회전·크기는 book.object에 자유롭게 지정
book.warmup(scene, camera);      // 선택: 셰이더를 미리 컴파일해서 첫 인터랙션 때 멈칫하지 않게

// 매 프레임 호출
book.update(deltaSeconds);

book.open();                     // 펼치기 애니메이션
book.pickFromRay(raycaster);     // 레이가 닿은 감정 카드를 선택
book.completeIngredient();       // 현재 재료 퀘스트 완료
```

- 단위는 미터입니다. 덮인 책은 약 0.30 × 0.43 m이고, 바닥면이 y = 0입니다.
- three.js r160 이상을 기준으로 만들었습니다. `three`는 peerDependency라서 사용하는 프로젝트의 three를 그대로 씁니다.

## API

| 이름 | 설명 |
| --- | --- |
| `object` | 씬에 추가할 `THREE.Group` |
| `update(dt)` | 매 프레임 호출. `dt`는 초 단위 |
| `warmup(scene, camera)` | 선택. 셰이더 미리 컴파일 |
| `open(view?)` | 펼치기 애니메이션 재생. 끝나면 `'view'` 이벤트로 `'opening'` 또는 `'reading'`을 보냄 |
| `openInstant()` | 애니메이션 없이 바로 감정 선택 페이지로 펼침 |
| `close()` | 덮인 상태로 돌아감 |
| `pickFromRay(raycaster)` | 레이가 닿은 감정 카드를 선택. 선택되면 `true` |
| `pick(u, v)` | 페이지 텍스쳐 좌표(0~1, v는 위→아래)로 선택 |
| `emotionUnderRay(raycaster)` | 레이 아래에 있는 감정 카드 번호(0~5). 없으면 -1. 호버 표시용 |
| `selectEmotion(i)` | 번호로 감정 선택. 0 Excitement, 1 Refreshment, 2 Warmth, 3 Coziness, 4 Serenity, 5 Freshness |
| `completeIngredient()` | 현재 재료에 줄 긋기 → 화살표가 다음 재료로 이동 |
| `resetQuests()` | 현재 레시피의 퀘스트 진행 초기화 |
| `backToEmotions()` | 페이지를 뒤로 넘겨 감정 선택 페이지로 돌아감 |
| `on('change', fn)` | 상태가 바뀔 때마다 `snapshot`을 전달 |
| `on('view', fn)` | 카메라를 옮기기 좋은 시점을 알려줌: `'closed'` / `'opening'` / `'reading'` |
| `snapshot` | `{ state, page, recipe, recipeLabel, ingredient, questDone, questTotal, message }` |
| `pageMeshes` | 페이지 그림이 그려지는 메시들. 직접 레이캐스트할 때 사용 |
| `EMOTIONS`, `RECIPES` | 감정 → 레시피 대응표, 레시피별 재료 이름 |

- `state`: `'closed'` / `'opening'` / `'open'`
- `page`: `'emotion'` / `'marking'` / `'flipping'` / `'recipe'`

### 감정 → 레시피 대응

| 감정 | 레시피 id | 배쓰밤 |
| --- | --- | --- |
| Excitement & Joy | `santa` | 매지컬 산타 |
| Refreshment & Vitality | `tree` | 크리스마스 트리 |
| Warmth & Support | `ginger` | 진저브레드 스파클 |
| Coziness & Relaxation | `snowman` | 스노우맨 드리밍 |
| Serenity & Comfort | `silent` | 사일런트 나이트 |
| Freshness & Renewal | `drift` | 스노우드리프트 |

퀘스트 진행은 레시피마다 따로 기억합니다. 재료 순서는 Fairy Sugar → Star Powder → 레시피 재료 3개입니다.

## VR(손가락) 연결

클릭 판정은 화면 좌표가 아니라 **페이지의 어느 지점에 닿았는지**로 합니다. 그래서 컨트롤러나 손끝 위치로 `Raycaster`를 만들어 `book.pickFromRay(raycaster)`에 넘기면 됩니다.

- **손끝으로 찌르는 방식:** 손끝 바로 위에서 손끝 쪽으로 쏘는 짧은 레이(`raycaster.far ≈ 0.02`)를 쓰면 페이지에 닿는 순간 선택됩니다.
- **호버 표시:** `emotionUnderRay()`가 -1이 아닐 때 카드에 하이라이트나 햅틱을 주면 됩니다.

## 페이지·이미지 교체

- **페이지 이미지:** 크기 **2240 × 1600**을 그대로 유지해야 합니다. 왼쪽 절반이 왼쪽 페이지, 오른쪽 절반이 오른쪽 페이지입니다. `assets/pages/`의 같은 이름 파일을 덮어쓰면 됩니다.
- **감정 카드 위치:** 클릭 영역은 `RecipeBook.js`의 `EMOTIONS[].box`(픽셀 좌표)입니다. 카드 배치를 바꾸면 이 값도 함께 고쳐야 합니다.
- **재료 줄 위치:** `RECIPES[].rows`의 `y0`(글자 윗선)와 `x1`(글자 끝)로 정합니다. 재료 이름이 바뀌어 길이가 달라지면 `x1`을 고칩니다.
- **화살표·취소선 이미지:** `assets/ui/arrow.png`(투명 PNG, 왼쪽 아래가 화살촉)와 `strike.png`를 교체하면 됩니다.
- **페이지에 미리 그려 넣지 말 것:** 체크, 밑줄, 취소선, 화살표는 모듈이 애니메이션으로 그립니다. 페이지 이미지에 이미 그려 두면 이중으로 보입니다.

## 참고

- 페이지 재질은 톤매핑을 끈(`toneMapped: false`) 발광 재질이라, 씬 조명과 상관없이 원본 그림 색이 그대로 나옵니다. 조명은 살짝 음영만 더합니다.
- 페이지는 내부적으로 2D 캔버스에 그려서 텍스쳐로 씁니다. 그래서 DOM이 있는 브라우저 환경이 필요합니다.
- 블렌더로 열어볼 GLB가 필요하면 `assets/models`의 파일을 블렌더에서 **File ▸ Import ▸ glTF 2.0**으로 불러오세요. 책등과 종이 묶음이 휘는 동작은 코드로 만드는 것이라, 이 파일에는 원본 형태만 들어 있습니다.
