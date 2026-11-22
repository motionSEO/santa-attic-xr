# 에셋 전달 가이드

지금 체험에 나오는 도구, 재료, 배쓰밤, 포장, 편지, UI는 모두 **임시 그래픽**입니다.
진짜 에셋을 받으면 `assets/` 폴더에 넣고 `assets/manifest.json`에 한 줄씩 적기만 하면 교체됩니다. 코드는 고치지 않아도 됩니다.
적지 않은 항목은 임시 그래픽 그대로 남기 때문에 한꺼번에 줄 필요 없이 준비되는 대로 나눠 줘도 됩니다.

## 한눈에 보기: 무엇을 어떤 형식으로

| 종류 | 형식 | 비고 |
|---|---|---|
| 3D 오브젝트 | **.glb** (glTF 바이너리, 텍스처 포함) | Draco 압축 가능. .fbx/.blend도 받을 수 있지만 제가 .glb로 변환합니다 |
| UI 이미지 (책 페이지, 편지지, 버튼 배경 등) | **.png** 또는 **.webp** | 투명 배경이면 png. 아래 "이미지 크기" 참고 |
| 텍스처 (포장지 무늬 등) | .webp / .png / .jpg | 한 변 1024~2048px, 2의 거듭제곱 권장 |
| 문구 (재료 이름, 레시피, 편지 내용) | **.json** | `assets/content.example.json` 형식 |
| 소리 | .mp3 또는 .ogg | 효과음은 1초 안팎, 배경음은 반복 재생용 |
| 화면 디자인 시안 | .png / .pdf / Figma 링크 | 참고용. 제가 보고 맞춰 그립니다 |

**HTML은 필요 없습니다.** VR 안에서는 HTML 화면이 보이지 않아서 UI도 결국 3D 공간 안의 이미지로 그려야 합니다.
**JSON은 문구와 데이터용**으로 주시면 됩니다(재료 이름, 레시피 설명, 감정 목록, 편지 문구).

## 3D 모델 규칙 (.glb)

- 단위는 **미터, 실제 크기 그대로** (절구 지름 약 15cm면 0.15).
- **Y축이 위**, 정면은 +Z.
- **피벗(원점)은 바닥 가운데**. 테이블 위에 놓였을 때 바닥면이 y=0.
- 오브젝트 하나당 파일 하나. 폴리곤은 소품 하나에 1만 개 이하면 퀘스트3에서 충분히 가볍습니다.
- 재질은 PBR(Base Color, Roughness, Metallic, Normal). 텍스처 한 변 최대 2048px.
- 실제 크기로 만들었다면 manifest의 `fit`에 `"none"`을 적어 주세요. 적지 않으면(`contain`) 임시 그래픽 크기에 맞춰 자동으로 줄이거나 키웁니다.

## 에셋 ID 목록 (manifest의 `models` 키)

| ID | 무엇 | 위치 / 쓰임 |
|---|---|---|
| `book` | 레시피북 표지 | 테이블 위. 펼친 페이지는 이미지(`BookPages`)로 따로 그림 |
| `mortar` | 절구 | 테이블 가운데 |
| `pestle` | 절굿공이 | 절구 옆 (손잡이 위쪽이 +Y) |
| `board` | 도마 | 과일, 진저 자르는 곳 |
| `knife` | 칼 | 도마 옆 |
| `basket` | 과일 바구니 | 뒤 선반 |
| `fruit_bergamot`, `fruit_lemon` | 통 과일 | 바구니 안 |
| `half_bergamot`, `half_lemon` | 반으로 자른 과일 | 자른 뒤 |
| `bottle_fairySugar`, `bottle_starDust`, `bottle_benzoin`, `bottle_turmeric`, `bottle_coconutOil` | 재료 병 5종 | 뒤 선반. 병 입구가 +Y |
| `firPot` | 전나무 화분 | 허브 트레이 옆 |
| `ing_rosewood`, `ing_cedarwood`, `ing_cinnamon`, `ing_vanilla`, `ing_eucalyptus`, `ing_ginger` | 서랍에서 나오는 재료 | 책장 서랍 6칸 |
| `pieces_<재료ID>` | 부러뜨리거나 찢거나 썬 조각 | 예: `pieces_cinnamon` |
| `mold_round`, `mold_tree`, `mold_santa`, `mold_gingerbread`, `mold_snowflake`, `mold_snowman` | 배쓰밤 틀 6종 | 레시피에 따라 하나만 등장 |
| `moldLid` | 틀 뚜껑 | |
| `bathbomb_<모양>` | 완성 배쓰밤 6종 | 모양은 위 틀과 같음. 예: `bathbomb_tree` |
| `decor_christmasTree`, `decor_magicalSanta` | 올려 놓는 장식 (금빛 별, 산타 수염) | |
| `shaker_gingerbread`, `shaker_snowdrift`, `shaker_silentNight`, `shaker_snowmanDreaming` | 뿌리는 장식통 4종 | 기울여서 뿌림 |
| `wrapPaper` | 펼쳐진 포장지 | 텍스처는 지금 `giftwrap.webp` |
| `giftBox` | 포장된 선물 상자 | 보내는 선물, 받는 선물 둘 다 |
| `inkPot` | 잉크병 | 그림 편지 옆 5개 |
| `pen` | 펜 | 펜 끝이 -Y |
| `envelope` | 접힌 편지 봉투 | |
| `basin` | 마법 수반 | 벽난로 옆 바닥. 물 높이 약 0.84m |

허브(민트, 레몬그라스, 장미, 라벤더)와 머그는 원래 공간 파일(room.glb)에 들어 있는 것을 그대로 씁니다.

## UI 이미지 (manifest의 `images` 키)

글자와 버튼은 코드가 이미지 위에 덧그립니다. 그래서 **배경 그림만** 주면 됩니다.
글자까지 그려진 완성 이미지를 주면 제가 버튼 위치만 맞춰 드릴게요.

| 이름 | 무엇 | 비율 (가로:세로) | 권장 크기 |
|---|---|---|---|
| `Parchment` | 벽난로에서 날아오는 산타의 편지 | 4 : 5 | 800 × 1000 |
| `BookPages` | 레시피북 펼친 두 페이지 | 14 : 9 | 1400 × 900 |
| `LetterPaper` | 그림 편지지 | 26 : 19 | 760 × 556 |
| `EndPanel` | 마지막 "다른 산타의 선물" 카드 | 5 : 3 | 1100 × 660 |
| `ReceivedLetter` | 받은 그림 편지 | 26 : 19 | 760 × 556 |
| `HintPanel` | VR 안내 말풍선 | 10 : 3 | 1000 × 300 |

## 문구 (manifest의 `content` 키 → .json)

`assets/content.example.json`을 복사해서 바꾸고 싶은 항목만 적으면 됩니다. 적은 항목만 덮어씁니다.
재료 ID, 레시피 ID, 감정 ID는 위 표와 `modules/flow.js` 맨 위 데이터와 같습니다.

```json
{
  "intro": { "title": "...", "body": ["줄1", "줄2"] },
  "ingredients": { "fairySugar": { "name": "요정설탕", "real": "베이킹 소다" } },
  "emotions": [ { "id": "fresh", "label": "상쾌함 · 활력", "sub": "..." } ],
  "recipes": { "christmasTree": { "name": "크리스마스 트리", "powderDesc": "..." } }
}
```

## 소리 (manifest의 `sounds` 키)

| 이름 | 언제 |
|---|---|
| `bgm` | 시작부터 계속 (반복) |
| `fire` | 벽난로에 불이 붙을 때 |
| `letter` | 편지가 날아올 때 |
| `click` | 책, 편지, 버튼 누를 때 |
| `pour` | 병에서 재료를 쏟을 때 |
| `add` | 그 밖의 재료를 절구에 넣을 때 |
| `cut` | 칼로 자를 때 |
| `break` | 부러뜨리거나 찢을 때 |
| `pound` | 절구 빻을 때 (5번) |
| `reveal` | 틀을 열어 배쓰밤이 나올 때 |
| `wrap` | 포장이 끝날 때 |
| `splash` | 수반에 넣을 때 |
| `arrive` | 다른 산타의 선물이 도착할 때 |
| `wrong` | 맞지 않는 재료를 넣으려 할 때 |

## manifest.json 예시

`assets/manifest.example.json`을 `assets/manifest.json`으로 복사해서 씁니다.

```json
{
  "models": { "mortar": "assets/models/mortar.glb" },
  "fit":    { "mortar": "none" },
  "images": { "BookPages": "assets/ui/book_pages.webp" },
  "sounds": { "bgm": "assets/sounds/bgm.mp3" },
  "content": "assets/content.json"
}
```

## 전달 방법

파일을 그대로 이 대화에 올려 주거나, 폴더째 압축해서 주면 됩니다. 파일 이름을 위 ID로 맞춰 주면 가장 빠르고, 이름이 달라도 어떤 오브젝트인지만 알려 주면 제가 연결합니다.
