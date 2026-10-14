# 스마트웹라우터 미니 웹 HMI (WHMI) — 설계 검토 v0.1

## 1. 목표와 범위

| 항목 | 내용 |
|---|---|
| 목표 | 라우터가 여러 기기에서 수집 중인 값을 웹 화면에서 그래픽 요소(탱크·게이지·램프 등)로 표시하고, 제한적으로 조작(스위치·버튼·입력) |
| 원칙 | **디자인 파일(JSON)만 바꾸면 화면이 바뀐다.** 런타임 코드는 고정, 화면은 데이터 |
| 1차 범위 | 단일 화면, 절대좌표 배치, 위젯 10종, 폴링 기반 값 갱신, 단일 태그 바인딩 |
| 제외 (후속) | 화면 편집기, 다중 화면 이동, 트렌드/알람 이력, 조건식·스크립트, 사용자 권한 |

## 2. 전체 구조

```
 [기기들] ──(Modbus 등, 기존 수집 기능)──▶ [스마트웹라우터]
                                              │  ① 정적 파일: index.html, js/, project/*.json
                                              │  ② 값 API:   GET /api/values, POST /api/write
                                              ▼
                                         [브라우저 런타임]
                   project.json → tags.json + screens/*.json 로드 → SVG 렌더 → 주기 폴링 → 위젯 갱신
```

- **라우터 측 부담 최소화:** 디자인 JSON은 라우터가 해석하지 않고 정적 파일로 내려주기만 한다. 라우터가 새로 구현할 것은 값 API 2개(§5)뿐.
- **렌더링은 SVG:** `viewBox`로 설계 해상도(예: 1280×720)를 지정하면 브라우저 크기에 맞춰 자동 확대/축소. 외부 라이브러리 없음(런타임 + 위젯 약 25KB, 비압축).

## 3. 핵심 설계 결정

| 결정 | 선택 | 이유 |
|---|---|---|
| 파일 포맷 | **JSON** (XML 아님) | 브라우저에서 파싱 비용 0, 라우터 펌웨어에서도 경량 파서(cJSON 등)로 처리 가능, 이후 편집기 구현이 쉬움 |
| 데이터와 화면 분리 | `tags.json`(무엇을) / `screen.json`(어떻게 보여줄지) | 같은 값을 여러 위젯·화면에서 재사용. min/max/단위는 태그에 한 번만 정의 |
| 좌표계 | 화면별 설계 해상도 기준 **절대좌표** (x, y, w, h) | 가장 단순하고 편집기(드래그 배치)와 1:1 대응. 반응형 레이아웃은 하지 않고 비율 유지 스케일링 |
| 위젯 속성 구조 | 공통 속성(최상위) + 타입별 속성(`props`) | 공통 처리(배치·바인딩·품질 표시)는 런타임이, 고유 처리는 위젯이 담당. 스키마 검증도 깔끔 |
| 그리기 순서 | `widgets` 배열 순서 = z-order | 별도 z-index 불필요 |
| 확장 방식 | 위젯 레지스트리 `WHMI.register(type, impl)` | 새 위젯 추가 시 런타임 수정 없음. 모르는 타입은 빨간 점선 상자로 표시하고 계속 진행 |
| 버전 | 모든 파일에 `format`, `version` | 이후 구조 변경 시 마이그레이션 근거 |

## 4. 데이터 구조

파일 구성:

```
web/project/
  project.json          프로젝트: 태그 파일, 화면 목록, 데이터 소스
  tags.json             태그(데이터 포인트) 정의
  screens/main.json     화면 1개 = 파일 1개
```

### 4.1 project.json

```json
{
  "format": "whmi.project", "version": "0.1",
  "name": "1공장 용수 설비",
  "tags": "tags.json",
  "screens": [ { "id": "main", "file": "screens/main.json" } ],
  "startScreen": "main",
  "dataSource": { "type": "http", "readUrl": "/api/values", "writeUrl": "/api/write", "pollMs": 1000 }
}
```

### 4.2 tags.json — 태그 정의 (최소/최대/현재값)

```json
{ "id": "TK1_LEVEL", "name": "1번 탱크 수위", "device": "PLC-01",
  "type": "number", "unit": "%", "min": 0, "max": 100, "decimals": 1, "access": "r" }
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | ● | 고유 식별자. 위젯은 이 id로 바인딩 |
| `name` | | 표시용 이름 (입력 대화상자 제목 등) |
| `device` | | 소속 기기 (정보용. 실제 매핑은 라우터 기존 설정) |
| `type` | ● | `number` \| `bool` (후속: `string`, `enum`) |
| `unit`, `decimals` | | 단위, 소수 자릿수 |
| `min`, `max` | number 권장 | 값의 범위. 게이지/탱크/바 스케일과 입력값 검증에 사용 |
| `access` | ● | `r` 읽기 전용 \| `rw` 쓰기 가능 |

**현재값은 태그 파일에 넣지 않는다.** 현재값은 실시간 API(§5)로만 온다.
기기가 최소/최대를 실시간으로 제공하는 경우 API 응답의 `min`/`max`로 덮어쓸 수 있다.

min/max 결정 우선순위: **위젯 `props.min/max` > 실시간 값의 `min/max` > 태그 정의 > 기본값(0/100)**

> `tags.json`은 라우터의 기존 수집 포인트 설정에서 자동 생성하는 것을 권장 (중복 관리 방지).

### 4.3 screen.json — 화면

```json
{
  "format": "whmi.screen", "version": "0.1",
  "id": "main", "title": "1공장 용수 설비 모니터링",
  "size": { "w": 1280, "h": 720 },
  "background": "#14181f",
  "widgets": [ ... ]
}
```

### 4.4 위젯 공통 속성

```json
{ "id": "tk1", "type": "tank", "x": 50, "y": 110, "w": 150, "h": 290,
  "tag": "TK1_LEVEL",
  "props": { "fillColor": "#3fa7ff", "ranges": [ { "from": 90, "color": "#e5534b" } ] } }
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | ● | 화면 내 고유 |
| `type` | ● | 위젯 타입 (§4.5) |
| `x`, `y`, `w`, `h` | ● | 설계 해상도 기준 위치·크기(px) |
| `tag` | | 바인딩할 태그 id. 정적 위젯(label, rect)은 생략 |
| `props` | | 타입별 속성. 생략 시 위젯 기본값 |

공통 규칙:
- **색상 구간 `ranges`**: `[{ "from"?, "to"?, "color" }]` — 첫 번째로 일치하는 구간의 색 적용. from/to 생략 시 무한대. numeric·tank·bar·gauge 공용.
- **품질 표시**: 값이 `q: "bad"`이거나 통신 실패 시 위젯을 흐리게(투명도 45%) 하고 숫자는 `----`로 표시. **마지막 값을 정상처럼 유지하지 않는다.**
- **쓰기 위젯**: 태그가 `access: "rw"`가 아니면 자동으로 비활성(클릭 무시).

### 4.5 위젯 목록 및 고유 속성 (`props`)

**정적**

| type | 용도 | 주요 props (기본값) |
|---|---|---|
| `rect` | 패널·구분 박스 | `fill`, `stroke`, `strokeWidth`(1), `radius`(8) |
| `label` | 고정 텍스트 | `text`, `fontSize`(15), `color`, `align`(left\|center\|right), `bold` |

**표시 (읽기)**

| type | 용도 | 주요 props (기본값) |
|---|---|---|
| `numeric` | 디지털 숫자 표시기 | `color`, `bg`, `border`, `fontSize`(h×0.55), `ranges`, `showUnit`(true), `decimals`/`unit`(태그값 대체) |
| `lamp` | 상태 램프 | `onColor`, `offColor`, `onValue`(생략 시 참/거짓), `blink`(false), `text` |
| `tank` | 탱크 수위 | `fillColor`, `bgColor`, `shellColor`, `ranges`, `showValue`(true), `showScale`(true), `ticks`(5) |
| `bar` | 막대 게이지 | `orientation`(v\|h), `fillColor`, `bgColor`, `ranges` |
| `gauge` | 원형(아크) 게이지 | `startAngle`(-135), `endAngle`(135), `arcColor`, `trackColor`, `ranges`, `title`, `thickness` |

**조작 (쓰기)**

| type | 용도 | 주요 props (기본값) |
|---|---|---|
| `button` | 값 기록 버튼 | `text`, `action`(set\|toggle), `value`(true), `color`, `activeColor`, `confirm`(확인 문구) |
| `switch` | 토글 스위치 | `onValue`(true), `offValue`(false), `onText`/`offText`, `onColor`/`offColor`, `confirm` |
| `input` | 숫자 입력 | `color`, `bg`, `border`, `confirm` — 클릭 시 입력 대화상자, 태그 min/max로 검증 |

`min`, `max`, `unit`, `decimals`는 모든 바인딩 위젯의 `props`에서 태그값을 덮어쓸 수 있다.

## 5. 라우터 값 API (펌웨어 구현 대상)

참조 구현: [tools/devserver.js](../tools/devserver.js)

**읽기**

```
GET /api/values?tags=TK1_LEVEL,PUMP1_RUN
200 { "ts": 1700000000000,
      "values": { "TK1_LEVEL": { "v": 56.9, "q": "good" },
                  "PUMP1_RUN": { "v": true, "q": "good" } } }
```

- `q`: `good` | `bad` (기기 통신 단절, 미정의 태그 등)
- 선택: `min`, `max` (기기가 실시간으로 범위를 제공하는 경우)
- 화면에 바인딩된 태그만 요청하므로 태그가 많아도 응답이 작다.

**쓰기**

```
POST /api/write   { "tag": "LEVEL_SP", "v": 75.0 }
200 { "ok": true }
400 타입/범위 오류 · 403 읽기 전용 태그 · 404 미정의 태그
```

- **서버에서 반드시 재검증** (access, 타입, min/max). 브라우저 검증은 편의용일 뿐.

## 6. 단계별 로드맵

| 단계 | 내용 | 상태 |
|---|---|---|
| **1. 표시** | rect, label, numeric, lamp, tank, bar, gauge / 폴링 / 품질 표시 | 프로토타입 완료 |
| **2. 조작** | button, switch, input / 확인 대화상자 / 서버측 검증 | 프로토타입 완료 |
| 3. 화면 확장 | 다중 화면 + 화면 이동 버튼, 이미지/아이콘, 선·배관(pipe), 그룹 | |
| 4. 동적 속성 | 조건부 색/표시(`visibleWhen`, `colorWhen`), 다중 상태 램프(`states`), 레이블 내 값 템플릿 | |
| 5. 데이터 고도화 | WebSocket/SSE 푸시, 트렌드 차트, 알람 목록·이력 | |
| 6. 편집기 | 웹 기반 드래그&드롭 편집기 (같은 JSON을 저장), JSON Schema 검증 | |
| 7. 보안 | 로그인/권한(조회 전용 vs 조작), 쓰기 감사 로그 | |

구조 확장 원칙: 새 기능은 **새 `type` 또는 새 선택 필드 추가**로만 확장하고, 기존 필드의 의미는 바꾸지 않는다 (v0.1 파일은 이후 버전에서도 그대로 열려야 함).

## 7. 안전 관련 결정

- 통신 실패 시 시뮬레이션 값이나 마지막 값으로 **조용히 대체하지 않는다** — 화면 전체를 품질 불량으로 표시하고 상단 상태줄에 오류 표시.
- 정지·운전 변경 등 중요한 조작은 `confirm` 속성으로 확인 대화상자를 띄운다.
- `button`의 순간 동작(누르는 동안 1, 떼면 0)은 HTTP 지연·연결 끊김 시 값이 1로 남을 위험이 있어 1차 범위에서 제외. 필요하면 라우터/PLC 측 자동 복귀(펄스) 방식으로 설계할 것.

## 8. 확인이 필요한 사항

1. 라우터 HW/OS 사양과 웹서버 종류 (정적 파일 서빙, POST 처리 가능 여부, 플래시 용량)
2. 기존 수집 포인트 설정 포맷 → `tags.json` 자동 생성 가능 여부
3. 예상 태그 수, 동시 접속 브라우저 수 → 폴링 주기 / 푸시 방식 전환 시점 결정
4. 웹에서 기기로의 쓰기를 허용할지, 허용 시 권한 체계
5. 대상 화면 (PC 브라우저 / 태블릿 / 패널 PC) → 설계 해상도 기본값

## 9. 프로토타입 실행

```
node tools/devserver.js        # http://localhost:8080/
```

- `?screen=<id>` 로 화면 선택, `?project=<경로>` 로 다른 프로젝트 파일 지정
- 개발 서버는 값을 시뮬레이션함 (P1/P2 지령 → 운전 상태, 회전수, 유량, 수위 연동)
