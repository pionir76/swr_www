---
from: frontend
to: backend
status: open
waiting_on: frontend
reply: docs/backend-realtime-raw-values-response.md
---

# 실시간 레지스터 값을 원본(raw) 기준으로 전환 — 백엔드 API 요청서

> 작성: 2026-11-20 (프론트엔드)
> 대상: SmartRoute 백엔드(swr)
> 관련 명세: `referencs/api-spec.md` §2 대시보드, §5 레지스터(`GET /api/registers/realtime`)
> 관련 원칙: `docs/architecture/overview.md` §5.1 "원본 데이터 원칙"
> 앞선 사례: `docs/backend-hmi-raw-values-request.md` (HMI는 같은 방식으로 전환 완료)

---

## 1. 배경

원본 데이터 원칙상 **백엔드는 원본 워드만 주고, 배율(스케일)·부호 해석은 프론트가 합니다.** HMI와 트렌드는 이미 이렇게 동작합니다. 남은 곳이 실시간 모니터링과 대시보드입니다. 지금은 서버가 계산한 `scaledValue`와 `outOfRange`를 그대로 보여 줍니다.

| 화면 | 지금 쓰는 값 | 전환 후 |
|---|---|---|
| 실시간 모니터링 표·상세 | `scaledValue`, `outOfRange` | `rawWord`(+부호·스케일)로 프론트가 계산 |
| 실시간 쓰기 창 | 입력값 ÷ `scale` → `rawValues` (프론트 계산, 음수 처리 없음) | 같은 계산 규칙(음수는 2의 보수) |
| 대시보드 "실시간 주요 레지스터" | `scaledValue` | 위와 같음 |

2026-11-20 장치에서 36개 레지스터의 `scaledValue`와 `rawWord × scale`(부호 반영)을 비교했을 때 모두 같았습니다. 따라서 화면에 보이는 값은 바뀌지 않고, 계산하는 곳만 옮겨집니다.

**문제:** 실시간 응답 항목에는 `isSigned`와 `length`가 없습니다. 프론트가 원본으로 계산하려면 레지스터 목록을 장비마다 따로 받아 짝을 맞춰야 합니다. 응답에 함께 내려 주시면 요청 한 번으로 끝납니다.

---

## 2. 요청 사항

### 2.1 실시간 항목에 레지스터 정보 추가 (응답 전용)

대상: `GET /api/registers/realtime`의 `registers[]`, `GET /api/dashboard`의 `realtimeRegisters[]`

| 필드 | 출처 | 쓰는 곳 |
|---|---|---|
| `isSigned` | 레지스터 `isSigned` | 원본 uint16을 부호 있는 값으로 해석 |
| `length` | 레지스터 `length`(워드 수) | 1워드만 `rawWord`로 계산. 2워드 이상은 §2.2 |
| `rawWords` | 레지스터 `length`만큼의 원본 워드 배열(uint16), 읽은 순서 그대로 | 2워드 이상 레지스터를 프론트가 조립(§2.2). 1워드면 `[rawWord]` |

`rawWord`는 그대로 둡니다(= `rawWords[0]`). 값이 없으면(통신 전 등) `rawWords`는 `null`로 주세요.

### 2.2 2워드 이상 레지스터의 조립 규칙 (질문)

지금 장치의 레지스터는 모두 1워드지만, 레지스터 화면에서 1~4워드를 고를 수 있습니다. 프론트가 같은 값을 만들 수 있도록, 서버가 지금 `scaledValue`를 만들 때 쓰는 규칙을 알려 주세요.

1. 워드 순서: `byteOrder`(`default`/`big`/`little`)가 워드 순서인가요, 워드 안의 바이트 순서인가요? `default`는 장비 설정을 따른다는 뜻으로 아는데, 그 장비 설정 값도 응답에 필요할까요?
2. 부호: 32비트·48비트·64비트에서 `isSigned`는 전체 정수의 최상위 비트 기준인가요?
3. 실수(float) 해석은 없고 정수만 맞나요?

### 2.3 `scaledValue` / `outOfRange` 관련 질문

1. `scaledValue`는 레지스터 `minValue`/`maxValue` 범위로 **잘린 값**인가요? (HMI 답변서에서 예전 `v`가 그렇다고 하셨습니다.) 잘린다면 프론트 계산값과 범위 밖일 때 달라집니다. 프론트는 잘리지 않은 실제 값을 보여 주고 "범위 초과"로 표시할 예정입니다.
2. `outOfRange`는 서버 안에서 경보·로그(예: "범위 초과" 경보)에도 쓰이나요? 쓰인다면 서버 내부 판정은 그대로 두고 API 응답에서만 빼는 것을 제안합니다. 화면 표시는 프론트가 같은 규칙(계산값 < `minValue` 또는 > `maxValue`, "제한 없음"은 비교 안 함)으로 판정합니다.

---

## 3. 전환 순서

HMI 때와 같이 화면이 중간에 깨지지 않게 진행합니다.

1. **백엔드:** §2.1 필드를 추가하고 §2.2·§2.3 질문에 답해 주세요. `scaledValue`·`outOfRange`는 **남겨 둡니다**.
2. **프론트:** 실시간·대시보드·쓰기 창을 원본 계산으로 바꿉니다. 1워드 부분은 이 요청서를 보내면서 바로 시작하고, 필드가 들어오기 전에는 `scaledValue`를 그대로 쓰도록 만들어 둡니다. 2워드 이상은 §2.2 답을 받은 뒤 반영합니다.
3. **백엔드:** 프론트 완료 알림 후 응답에서 `scaledValue`·`outOfRange`를 뺍니다(§2.3-2 답에 따라 `outOfRange`는 내부 유지 가능).

---

## 4. 이번 범위가 아닌 것

- 레지스터 설정 API(`GET/POST/PUT /api/devices/{id}/registers`): 변경 없음
- 쓰기 API(`POST /api/registers/{id}/write`): 이미 원본(`rawValues`)을 받으므로 변경 없음
- `bitLabels`: 화면에서는 2026-11-13부터 쓰지 않습니다. 정리(폐지)는 이번에 함께 하셔도 되고 나중에 하셔도 됩니다. 프론트 영향은 없습니다
