# HMI 빌더 — 위젯 속성 정의 (v1)

> 2026-10-14. [referencs/whmi-main](../../referencs/whmi-main)(설계 프로토타입)을 바탕으로, 실제 백엔드 HMI 태그 API(`referencs/api-spec.md` §14)에 맞춰 정리한 1차 위젯 스펙이다.
> 화면 JSON 포맷과 위젯 구현은 `js/whmi-runtime.js`/`js/whmi-widgets.js`(포팅본)를 그대로 따르되, 아래 내용(품질 3단계, 태그 모델)은 WHMI 원본과 다르므로 런타임 수정이 필요하다.

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
| `props` | | 타입별 속성. 생략 시 기본값 |

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

### 2.2 품질(`q`) 3단계 처리

백엔드가 폴링 지연 정도에 따라 3단계로 내려준다(`referencs/api-spec.md` §14 참고). WHMI 원본은 good/bad 이분법이라 **런타임에 normal 단계를 추가**해야 한다.

| `q` | 의미 | 위젯 표시 |
|---|---|---|
| `good` | 정상 | 평소대로 표시 |
| `normal` | 폴링 지연(1.5×~3× interval) | **값은 그대로 표시**(데이터 자체는 유효) + 연한 경고 표시만 추가(가는 호박색 테두리/작은 점). 깜빡이거나 값을 가리지 않음 |
| `bad` | 통신 끊김(3× 초과) 또는 값 없음 | 위젯을 흐리게(투명도 45%) + 숫자는 `----`로 대체. **마지막 값을 정상처럼 유지하지 않는다**(WHMI §7 안전 원칙 그대로 유지) |

`v`가 `null`(=bad이거나 값 없음)이면 무조건 `bad` 취급.

CSS 클래스: 기존 `.w.q-bad`는 유지, `.w.q-normal`을 신설(테두리색만 추가, opacity는 건드리지 않음).

---

## 3. 위젯별 속성

### 정적 위젯 (바인딩 없음)

| type | 용도 | props (기본값) |
|---|---|---|
| `rect` | 패널·구분 박스 | `fill`(`#1b212b`), `stroke`(`#2e3846`), `strokeWidth`(1), `radius`(8) |
| `label` | 고정 텍스트 | `text`, `fontSize`(15), `color`(`#e6e9ef`), `align`(left\|center\|right), `bold`(false) |

### 표시 위젯 (읽기, `access` 무관하게 표시만)

| type | 용도 | props (기본값) |
|---|---|---|
| `numeric` | 디지털 숫자 표시기 | `color`(`#7cfc9a`), `bg`, `border`, `fontSize`(h×0.55), `ranges`, `showUnit`(true) |
| `lamp` | 상태 램프(불리언) | `onColor`(`#2ecc71`), `offColor`(`#3a4250`), `onValue`(생략 시 truthy 판정), `blink`(false), `text` |
| `tank` | 탱크 수위 | `fillColor`(`#3fa7ff`), `bgColor`, `shellColor`, `ranges`, `showValue`(true), `showScale`(true), `ticks`(5) |
| `bar` | 막대 게이지 | `orientation`(v\|h), `fillColor`, `bgColor`, `ranges` |
| `gauge` | 원형(아크) 게이지 | `startAngle`(-135), `endAngle`(135), `arcColor`, `trackColor`, `ranges`, `title`, `thickness` |

공통: **색상 구간 `ranges`**: `[{ "from"?, "to"?, "color" }]` — 첫 번째로 일치하는 구간의 색 적용(numeric/tank/bar/gauge 공용). `outOfRange`(범위 초과) 같은 백엔드 판정은 별도 처리하지 않고 **ranges로 화면에서 직접 시각화**한다 — 품질(§2.2)과 역할을 겹치지 않게 분리.

### 조작 위젯 (쓰기, `access:"rw"`인 태그만 활성)

| type | 용도 | props (기본값) |
|---|---|---|
| `button` | 값 기록 버튼 | `text`, `action`(set\|toggle), `value`(true), `color`, `activeColor`, `confirm` |
| `switch` | 토글 스위치 | `onValue`(true), `offValue`(false), `onText`/`offText`, `onColor`/`offColor`, `confirm` |
| `input` | 숫자 입력 | `color`, `bg`, `border`, `confirm` — 클릭 시 입력 대화상자, 태그 min/max로 검증 |

- 태그가 `access:"rw"`가 아니면 자동으로 비활성(클릭 무시) — `access`는 매 폴링 갱신되므로, 운영 중 권한이 바뀌면(관리자가 태그를 r로 변경 등) 화면도 다음 폴링에 바로 반영됨
- **순간 동작(누르고 있는 동안 1, 떼면 0) 미지원** — HTTP 지연/연결 끊김 시 값이 눌린 상태로 남을 위험 때문에 1차 범위에서 제외(WHMI §7 그대로 유지)
- 쓰기 값 타입: **불리언 태그는 `v`에 JSON boolean(`true`/`false`)을 그대로 전송** — 숫자 태그는 엔지니어링 단위 숫자 그대로(서버가 `raw = round(v/scale)` 변환)

---

## 4. 다음 단계와의 연결

이 스펙은 2단계(기본 메인 페이지 샘플)에서 바로 쓸 수 있는 형태다. 3단계(데이터 연동)에서 실제로 바뀌는 부분은 §2에서 정리한 것처럼 제한적이다:

1. `whmi-runtime.js`에 데이터소스 분기 추가 (`HttpSource` 대신 `/api/hmi/*`를 호출하는 소스로 교체, `apiFetch` 사용으로 인증도 같이 해결)
2. `info()` 계산에 §2.1 우선순위 규칙 반영, `q` 3단계 처리(§2.2) 반영
3. 위젯 props 스키마 자체는 변경 없음 — WHMI 포팅본(`js/whmi-widgets.js`) 그대로 사용 가능
