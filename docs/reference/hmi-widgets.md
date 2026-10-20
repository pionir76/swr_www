# HMI 빌더 — 위젯 속성 정의

> 최초 2026-10-14, 최종 갱신 2026-10-16.
> 구현: `js/whmi-widgets.js`(위젯·기본값), `js/whmi-runtime.js`(값 바인딩·품질). 편집기 속성 창의 폼은 `js/whmi-schema.js`가 정의한다(§4).
> 태그·값 API는 `referencs/api-spec.md` §14.

---

## 1. 위젯 공통 속성

```json
{ "id": "tk1", "type": "tank", "x": 50, "y": 110, "w": 150, "h": 290,
  "tag": "TK1_LEVEL",
  "props": { "fillColor": "#3fa7ff" } }
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | ● | 화면 내 고유 id |
| `type` | ● | 위젯 타입 (§3) |
| `x`,`y`,`w`,`h` | ● | 설계 해상도 기준 위치·크기(px) |
| `tag` | | 바인딩할 **HMI 태그 id**(`referencs/api-spec.md` §14). 정적 위젯(rect/label)은 생략 |
| `props` | | 타입별 속성. 생략 시 기본값. 편집기는 기본값과 다른 값만 저장한다 |
| `enableWhen` | | 쓰기 허용 조건 `{ "tag": "MODE", "equals": 1 }` — 다른 태그 값이 `equals`와 같을 때만 쓰기 가능(쓰기 위젯 전용). 조건 태그는 위젯이 없어도 함께 폴링 |

그리기 순서 = `widgets` 배열 순서(z-order). 모르는 타입은 빨간 점선 상자로 표시하고 계속 진행(런타임 변경 없이 위젯 확장 가능).

---

## 2. 값 바인딩 규칙

### 2.1 데이터 흐름
- **태그 정의**(`min`/`max`/`access`/`name` 등)는 화면 진입 시 `GET /api/hmi/tags` **1회** 조회해 캐시
- **실시간 값**(`v`/`q`/`unit`/`decimals`/`access`)은 `GET /api/hmi/values?tags=...` **폴링**으로 갱신 — 화면에 바인딩된 태그만 요청
- 위젯이 보는 최종 `unit`/`decimals`/`access`는 **매 폴링 응답값 우선**(서버가 상속·오버라이드 적용 완료 상태로 내려줌), 응답에 없으면 태그 정의값, 그것도 없으면 위젯 `props`가 지정한 값
- `min`/`max`는 `/api/hmi/values` 응답에 없으므로 **태그 정의 → 위젯 `props` 오버라이드 → 기본값(0/100)** 순
- 우선순위 요약:

| 항목 | 1순위 | 2순위 | 3순위 |
|---|---|---|---|
| `unit`/`decimals`/`access` | 위젯 `props` (명시한 경우만) | 실시간 값 응답 | 태그 정의 |
| `min`/`max` | 위젯 `props` | 태그 정의 | 기본값(0/100) |

`props`의 `min`/`max`/`unit`/`decimals`는 값 위젯(numeric·input·bar·gauge·tank) 공통 덮어쓰기다. 편집기 속성 창 "값" 그룹에서 비워 두면 태그 값을 쓴다.

### 2.2 품질(`q`) 3단계 처리

백엔드가 폴링 지연 정도에 따라 3단계로 내려준다(`referencs/api-spec.md` §14 참고). WHMI 원본은 good/bad 이분법이라 **런타임에 normal 단계를 추가**해야 한다.

| `q` | 의미 | 위젯 표시 |
|---|---|---|
| `good` | 정상 | 평소대로 표시 |
| `normal` | 폴링 지연(1.5×~3× interval) | **값은 그대로 표시**(데이터 자체는 유효) + 연한 경고 표시만 추가(가는 호박색 테두리/작은 점). 깜빡이거나 값을 가리지 않음 |
| `bad` | 통신 끊김(3× 초과) 또는 값 없음 | 위젯을 흐리게(투명도 45%) + 숫자는 `----`로 대체. **마지막 값을 정상처럼 유지하지 않는다**(WHMI §7 안전 원칙 그대로 유지) |
| `disabled` | 소스 장비가 통신 비활성(`v`는 `null`) | `bad`와 똑같이 표시하고 쓰기를 막는다(서버도 409로 거부) |

`v`가 `null`(=bad이거나 값 없음)이면 무조건 `bad` 취급.

CSS 클래스: `.w.q-bad`(흐리게), `.w.q-normal`(연한 호박색 글로우, opacity는 건드리지 않음).

---

## 3. 위젯별 속성

### 정적 위젯 (바인딩 없음)

| type | 용도 | props (기본값) |
|---|---|---|
| `rect` | 패널·구분 박스 | `fill`(`#1b212b`), `stroke`(`#2e3846`), `strokeWidth`(1), `radius`(8) |
| `image` | 이미지(로고 등) | `src`(data URL — 편집기에서 파일을 고르면 긴 변 1024px 이하, 150KB 이하로 자동 축소해 화면 데이터에 넣음, 작은 SVG는 그대로), `fit`(ratio=비율 고정(기본, 상자가 그림 비율을 유지) \| stretch=상자에 맞춤), `ratio`(그림 원래 너비/높이 — 편집기가 기록, 폼에는 없음), `opacity`(1), `radius`(0) |
| `label` | 고정 텍스트 | `preset`(title\|subtitle\|caption\|info\|caution\|danger\|neon — 고른 스타일 값이 기본값), `text`, `fontSize`(15), `color`(`#e6e9ef`), `align`(left\|center\|right), `bold`(false), `italic`(false), `padding`(0, 안쪽 여백 — 정렬한 쪽), `bg`/`border`(null=없음, 위젯 상자 전체), `radius`(4), `glow`(false, 글자 발광), `shadow`(false, 글자 그림자) |

### 표시 위젯 (읽기, `access` 무관하게 표시만)

| type | 용도 | props (기본값) |
|---|---|---|
| `numeric` | 디지털 숫자 표시기 | `color`(`#7cfc9a`), `bg`, `border`, `ranges`/`rangeTarget`(text\|bg\|border, 구간 `blink:true`), `animMs`(0=끔), `flashOnChange`, `showTrend`, 공통 상자 옵션(아래) |
| `lamp` | 상태 램프(불리언) | `preset`(warning\|error\|info\|ok\|alarm — 모양·색 묶음), `shape`(circle\|square\|warning(▲+!)\|error(●+×)\|info(●+i)\|ok(●+체크)\|panel(알림창: 상자 전체가 표시등, 글자 안쪽 가운데) — 기호는 SVG, 기호·알림창 글자 색은 바탕 밝기로 자동), `onColor`(`#2ecc71`), `offColor`(`#3a4250`), `onValue`(생략 시 truthy 판정), `bit`(숫자 하나면 `(값 >> bit) & 1`로 판정, 목록 `[1,2]`면 그중 하나라도 1이면 켜짐 — 속성 창은 0~15 비트 격자), `blink`(false), `text`, `fontSize`(15), `textColor` |
| `status` | 상태 표시(값·비트 → 글자·색) | `mode`(value=값 일치(기본) \| bit=그 비트가 1), `states`(`[{ value?, bit?, text, color?, bg?, blink? }]` — 위에서부터 처음 맞는 줄, 줄 순서 = 우선순위, 기본 0=정지·1=운전), `noneText`(`—`)/`noneColor`/`noneBg`(맞는 줄 없음), `border`, `radius`(6), `fontSize`(15), `bold`(true), `align`(center\|left\|right), `padding`(8). 통신 불량이면 `----` |
| `tank` | 탱크 수위 | `fillColor`(`#3fa7ff`), `bgColor`, `shellColor`, `ranges`, `showValue`(true), `showScale`(true), `ticks`(5) |
| `bar` | 막대 게이지 | `preset`(meter 계기\|traffic 신호등\|led LED 세그먼트\|neon 네온\|slim 슬림\|blue 블루 계기\|heat 열 세그먼트), `segments`(0, 2 이상이면 칸으로 나눔)/`segmentGap`(2), `colorRamp`(traffic\|blue\|heat — 범위 전체 색 띠, gradient가 우선), `glow`(false, 채움 발광), `orientation`(v\|h), `fillColor`, `bgColor`, `border`, `radius`(3), `ranges`, `thickness`(생략 시 자동), `showScale`(false)/`ticks`(5)/`minorTicks`(0)/`tickLabels`(true), `showMinMax`(false), `scalePosition`(after\|before), `gradient`(`[{at: 값, color}]`, ranges보다 우선), `shade`(false), `showValue`(false), `valueAlign`(start\|center\|end\|follow, 기본 end), `origin`(생략 시 min부터 채움), 두께를 지정하고 옆 표시(눈금 등)가 없으면 트랙은 상자 가운데, `showRanges`(false), `markers`(`[{value, color?}]`), `tickColor`/`labelColor`/`fontSize`, `animMs`(400, 0=끔) |
| `gauge` | 원형(아크) 게이지 | `startAngle`(-135), `endAngle`(135), `arcColor`, `trackColor`, `ranges`, `title`, `thickness`, `animMs`(400, 0=끔), `lineCap`(butt\|round) |

**공통 상자 옵션(numeric·input)**: `preset`(led\|lcd\|vfd — 색·효과 묶음, 위젯 props가 우선), `font`(mono\|seg7\|sans), `fontSize`(생략 시 h×0.55), `italic`, `align`(end\|start\|center), `showUnit`(true), `unitAlign`(bottom\|middle\|top, 기본 bottom), `unitColor`, `ghost`/`ghostOpacity`(seg7 잔상), `glow`, `caption`/`captionColor`, `radius`(4), `borderWidth`, `bevel`, `glass`, `padding`(8, 안쪽 여백 — 정렬한 쪽 가장자리와 숫자 사이, 이름표·추세 표시는 2px 더 바깥).
- 숫자와 단위는 한 `<text>` 안의 두 조각(`<tspan>`)이라 정렬을 바꾸면 **함께 움직인다**.
- 단위 글꼴은 숫자와 같다. 단 7세그먼트(DSEG7)는 숫자 전용이라 단위는 고정폭 글꼴.
- `unitAlign`은 숫자·단위의 **실제 글자 획**(캔버스로 측정) 기준: bottom = 바닥선, middle = 획 가운데, top = 획 윗줄. 숫자도 획 가운데가 상자 가운데에 온다.
- 단위는 문자열을 그대로 그리므로 어떤 단위든 표시된다. 단, 브라우저 글꼴에 그 문자(예: `℃`, `㎥`)가 있어야 하고, 긴 단위는 숫자 자리를 줄인다.

**애니메이션 `animMs`**: 0이면 애니메이션 없이 바로 그린다(편집기에서는 "사용" 체크로 끄고 켬).

공통: **색상 구간 `ranges`**: `[{ "from"?, "to"?, "color" }]` — 첫 번째로 일치하는 구간의 색 적용(numeric/tank/bar/gauge 공용). `outOfRange`(범위 초과) 같은 백엔드 판정은 별도 처리하지 않고 **ranges로 화면에서 직접 시각화**한다 — 품질(§2.2)과 역할을 겹치지 않게 분리.

### 조작 위젯 (쓰기, `access:"rw"`인 태그만 활성)

| type | 용도 | props (기본값) |
|---|---|---|
| `button` | 값 기록 버튼 | `text`, `fontSize`(16), `action`(set\|toggle), `value`(set일 때 쓸 값 — **기본값 없음, 비어 있으면 쓰지 않고 상태줄에 알림**. 쓰고 나면 0으로 돌아가는 명령 레지스터는 toggle이 아니라 set 버튼 두 개로), `onValue`(true)/`offValue`(false, toggle과 켜짐 판정), `onText`/`offText`(켜짐·꺼짐일 때 글자), `color`, `activeColor`(켜짐일 때 색), `textColor`, `confirm`(확인 문구 — 전환이면 켤 때), `confirmOff`(전환에서 끌 때 문구, 비면 confirm을 양쪽에) |
| `switch` | 토글 스위치 | `onValue`(true), `offValue`(false), `onText`/`offText`, `onColor`/`offColor`, `confirm`(켤 때)/`confirmOff`(끌 때, 비면 confirm) |
| `input` | 숫자 입력 | `color`, `bg`, `border`, `confirm`, 공통 상자 옵션 — 클릭 시 입력 대화상자, min/max로 검증 |
| `selector` | 로터리 셀렉터 | `options`(`[{value, text}]`), `startAngle`(-45)/`endAngle`(45), `ringColor`, `knobColor`, `handleColor`, `labelColor`, `activeColor`, `fontSize`(14), `confirm`, `animMs`(300) — 라벨 클릭 시 그 위치로, 노브 클릭 시 다음 위치로 |

- 쓰기 위젯(button·switch·input·selector)은 위젯 필드 `enableWhen`(§1)으로 쓰기 허용 조건을 걸 수 있다
- 태그가 `access:"rw"`가 아니면 자동으로 비활성(클릭 무시) — `access`는 매 폴링 갱신되므로, 운영 중 권한이 바뀌면(관리자가 태그를 r로 변경 등) 화면도 다음 폴링에 바로 반영됨
- **순간 동작(누르고 있는 동안 1, 떼면 0) 미지원** — HTTP 지연/연결 끊김 시 값이 눌린 상태로 남을 위험 때문에 1차 범위에서 제외(WHMI §7 그대로 유지)
- 쓰기 값 타입: **불리언 태그는 `v`에 JSON boolean(`true`/`false`)을 그대로 전송** — 숫자 태그는 엔지니어링 단위 숫자 그대로(서버가 `raw = round(v/scale)` 변환)

### 화면 이동

| type | 용도 | props (기본값) |
|---|---|---|
| `screenlink` | 다른 화면으로 이동하는 버튼 | `screen`(이동할 화면 id), `text`('화면 이동'), `fontSize`(16), `color`, `textColor`, `mode`(replace — modal은 미지원). 태그 없이 항상 클릭 가능 |

---

## 4. 바운딩 박스 규칙

**위젯이 그리는 내용은 바운딩 박스(x/y/w/h) 밖으로 나갈 수 없다.**

- 위젯 구현은 내용을 상자 안에 배치한다. 상자 크기와 함께 커지는 그림(게이지 호, 탱크 몸통 등)은 끝 숫자·선 두께까지 상자 안에 들어가게 계산한다.
  - 탱크: 눈금이 있으면 몸통을 위아래로 7px씩 줄이고, 눈금 칸 폭은 가장 긴 눈금 숫자(위젯 min/max → 태그 정의)에 맞춤. 눈금 숫자는 오른쪽 끝 정렬.
  - 막대: 세로 막대는 끝 숫자 자리만큼 주축을 줄임. 마커 선은 상자 안에서 자름.
  - 게이지: 각도와 상관없이 원 전체가 상자에 들어가게 잡고(부분 호도 같은 원 크기), 선 두께 절반·구간 띠·호 끝 아래 min/max 숫자 자리만큼 반지름을 줄임. 반원·부채꼴은 빈 공간이 남지만 계산이 단순함.
- 글자 크기·글자 길이처럼 상자와 무관하게 커지는 내용은 **편집기가 상자를 넓힌다**: 속성 변경·태그 변경·크기 조절·w/h 입력 뒤에 `WHMI.contentBox(g)`(잘림 영역 반영, 선 두께·필터 번짐 제외)로 그린 범위를 재서 넘치면 넓힘. 자동으로 줄이지는 않음. 크기 조절은 반대쪽 변을 고정하고 끌던 변만 되돌아감. 격자 맞춤이면 넓힌 변을 격자에 맞춤. 넓혀도 넘침이 줄지 않으면 되돌리고 멈춤.
- 실행 중 값이 길어져 넘치는 경우(예: 범위보다 큰 값)는 처리하지 않는다 — 디자인할 때 상자를 넉넉히 잡는다.
- **안쪽 여백(`padding`)**: 상자 테두리에서 안쪽으로 내용까지의 여백(바깥 여백 margin은 쓰지 않음 — 위젯은 좌표로 배치). 글자를 한쪽에 정렬하는 위젯(라벨, 숫자 표시·입력)에만 있다. 가운데 정렬 위젯(버튼 등)과 상자 크기에 맞춰 그리는 그림 위젯에는 두지 않는다(상자를 키우거나 옮기는 것과 같음).
- 새 위젯을 만들 때 이 규칙을 지킨다. 확인은 위젯·옵션 조합별로 `contentBox`를 재는 방식으로 한다.

## 5. 편집기 속성 정의(`js/whmi-schema.js`)

편집기 속성 창의 폼은 위젯 타입별 필드 목록으로 만든다. 기본값은 여기 두지 않고 위젯 구현의 `defaults`(numeric·input은 `presets`까지)를 그대로 쓴다.

- 필드: `{ key, label, type, group, min?, max?, step?, options?, placeholder?, when?(p) }`
- 칸 `id`: 같은 속성(key)을 조건(`when`)에 따라 다른 칸으로 보여 줄 때 구분 이름(예: 램프 `onValue` — 비트가 없으면 "켜짐 값" 입력, 있으면 "켜짐 조건" 선택). select 칸 `numeric`(숫자로 저장)·`nullAs`(값이 없을 때 보일 항목)
- 목록(`list`) 칸: `type`(num\|text\|color\|value\|bool\|select+options), `width?`, `when?(p)`(거짓이면 숨김 — 숨은 칸 값은 보존), `newRow(rows, p)`
- 입력 종류: `text`, `opttext`, `num`, `optnum`, `color`, `optcolor`, `bool`, `select`, `screen`, `value`(true/false/숫자/글자), `list`(행 추가/삭제), `anim`(사용 체크 + ms), `enable`(위젯 필드 `enableWhen`)
- 그룹: 기본 / 눈금 / 값 / 색상 / 동작 / 효과
- 색(`color`/`optcolor`) 값은 `#RRGGBB` 또는 투명도가 있는 `#RRGGBBAA`. 속성 창은 색 + 투명도(%) 칸으로 편집하고, 100%면 6자리로 저장한다. 목록 안의 색(구간 색 등)과 화면 배경색은 투명도 없음.

**위젯에 속성을 추가하면 `whmi-schema.js`에도 필드를 추가한다.** 편집기에는 JSON 편집 칸이 없으므로, 빠뜨리면 그 속성은 편집기에서 바꿀 수 없다(화면 JSON에 들어 있는 값은 그대로 동작·보존).
