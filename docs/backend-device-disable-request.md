# 장비 비활성화 기능 — 백엔드 API 요청서

> 작성: 2026-10-15 (프론트엔드)
> 대상: SmartRoute 백엔드(swr)
> 관련 명세: `referencs/api-spec.md` §2 대시보드, §4 장비, §5 레지스터, §14 HMI

---

## 1. 배경과 목적

현장에서는 장비를 하나씩 따로 시험(단위 테스트)할 수 있어야 문제 원인을 빨리 찾을 수 있습니다. 장비와 레지스터를 등록해 둔 상태에서 **특정 장비만 "비활성화"해서 통신 대상에서 빼는 기능**을 요청합니다.

- 비활성 장비는 폴링하지 않습니다.
- 사용자는 실시간 데이터, 대시보드, HMI 등 모든 화면에서 비활성 장비와 그 값을 구분할 수 있어야 합니다.
- 비활성은 **사용자가 일부러 끈 상태**입니다. 통신 오류(`error`/`bad`)와 섞이지 않게 별도 상태로 다뤄 주세요.

---

## 2. 확정된 정책

| 항목 | 정책 |
|---|---|
| 저장 범위 | 장비 설정으로 **영구 저장**합니다. 재부팅 후에도 유지되고 백업·복원에 포함됩니다 |
| 전환 시점 | **폴링 중에도** 바로 전환할 수 있어야 합니다. 폴링을 멈추고 바꾸는 방식은 목적에 맞지 않습니다 |
| 상위(Modbus 서버)로 나가는 값 | **마지막 값을 유지**합니다. 비활성 중 값이 갱신되지 않는 것은 사용자가 감수할 사항입니다 |
| 트렌드 기록 | **마지막 값을 유지**해서 계속 기록합니다(끊김 처리 없음). 사용자 의도에 따른 결과로 봅니다 |
| 쓰기 | 비활성 장비의 레지스터에 쓰는 요청은 **거부**합니다 |
| 알람·오류 로그 | 비활성 장비는 통신 오류 알람이나 오류 로그를 만들지 않습니다 |
| 권한 | 장비 수정과 같은 `ManagerOrAbove`. 누가 언제 바꿨는지 로그로 남깁니다 |

---

## 3. 요청 사항

### 3.1 장비 모델에 `enabled` 추가

```json
// GET /api/devices — devices[] 항목에 추가
{ "id": 1, "deviceCode": "DEV01", "name": "PLC-1", "...": "...", "enabled": true }
```

- 기본값은 `true`입니다. 기존 장비도 마이그레이션 시 `true`로 채워 주세요.
- `POST /api/devices`, `PUT /api/devices/{id}` 바디에서도 `enabled`를 받아 주세요. 이 두 API는 지금처럼 폴링 중 409를 유지해도 됩니다. 폴링 중 전환은 3.2의 전용 API로 합니다.
- **백업/복원:** `devices.json`에 `enabled`를 포함해 주세요. 예전 백업에 이 필드가 없으면 `true`로 복원합니다.

### 3.2 활성/비활성 전환 API (폴링 중 허용)

장비 하나와 여러 장비를 한꺼번에 바꾸는 API를 요청합니다. 여러 장비 API는 프론트의 "이 장비만 통신(단독 테스트)"과 "되돌리기"에서 장비마다 다른 상태로 한 번에 바꿀 때 씁니다.

```
PUT /api/devices/{id}/enabled
권한: ManagerOrAbove (폴링 중에도 허용)

요청: { "enabled": false }
응답 200: { "ok": true, "id": 1, "enabled": false }
에러 404: 장비 없음
```

```
PUT /api/devices/enabled
권한: ManagerOrAbove (폴링 중에도 허용)

요청: { "changes": [ { "id": 1, "enabled": true }, { "id": 2, "enabled": false }, { "id": 3, "enabled": false } ] }
응답 200: { "ok": true, "devices": [ { "id": 1, "enabled": true }, { "id": 2, "enabled": false }, { "id": 3, "enabled": false } ] }
에러 400: 형식 오류 / 404: 없는 장비 id 포함 (이때는 아무것도 바꾸지 않음)
```

**동작**
- 저장과 적용이 바로 일어나야 합니다. 비활성으로 바꾸면 그 장비는 **다음 폴링 순번부터** 요청을 보내지 않습니다. 이미 보낸 요청 1건은 끝나도 됩니다.
- 여러 장비 API는 **전부 적용하거나 전부 적용하지 않기**(트랜잭션)를 요청합니다.
- 이미 같은 상태인 장비가 포함돼도 오류로 보지 않습니다.
- 비활성 장비는 같은 버스의 폴링 스케줄과 자동 주기(`pollMode: auto`) 계산에서도 빠져야 합니다. 그래야 다른 장비의 실제 주기가 짧아져 단위 테스트에 도움이 됩니다.

### 3.3 장비 상태에 `disabled` 추가

```json
// GET /api/devices/status — devices[] 항목
{
  "deviceId": 1,
  "deviceCode": "DEV01",
  "displayName": "PLC 1번",
  "enabled": false,
  "state": "disabled",
  "disabledAt": "2026-10-15T14:00:00",
  "disabledBy": "admin",
  "lastPollTimestamp": "2026-10-15T13:59:58",
  "lastPollDurationMs": 45,
  "effectiveIntervalMs": 0,
  "consecutiveErrors": 0,
  "lastError": ""
}
```

- `state`: `"ok"` | `"error"` | `"unknown"` | **`"disabled"`**
- `lastPollTimestamp`는 마지막으로 실제 통신한 시각을 **그대로 유지**해 주세요. "언제부터 끊겼는지" 표시에 씁니다.
- `disabledAt`, `disabledBy`는 가능하면 넣어 주세요. 어렵다면 빼도 됩니다(4번 질문 참고).
- **다시 활성화하면:** 첫 응답이 올 때까지 `state: "unknown"`으로 두고, `consecutiveErrors`는 0으로 초기화해 주세요.

### 3.4 대시보드

```json
// GET /api/dashboard
"kpi": { "totalDevices": 5, "okDevices": 2, "errorDevices": 1, "unknownDevices": 0, "disabledDevices": 2 }
```

- `devices[].state`에 `"disabled"`를 반영해 주세요.
- `errorDevices`와 `unknownDevices`에는 비활성 장비를 **넣지 않습니다**.

### 3.5 레지스터 실시간 값

```json
// GET /api/registers/realtime — registers[] 항목
{ "id": 1001, "deviceId": 1, "scaledValue": 25.3, "rawWord": 253, "isValid": true, "quality": "disabled", "lastUpdated": "2026-10-15T13:59:58Z" }
```

- `quality`: `"good"` | `"normal"` | `"bad"` | **`"disabled"`**
- 값(`scaledValue`, `rawWord`)은 **마지막 값을 유지**합니다. `lastUpdated`는 마지막으로 실제 갱신된 시각입니다.
- 비활성 장비 레지스터에는 경과 시간으로 정하는 품질 규칙(good/normal/bad) 대신 `disabled`를 우선 적용해 주세요.

### 3.6 HMI 값

```json
// GET /api/hmi/values
"values": { "TK1_LEVEL": { "v": 56.9, "q": "disabled", "unit": "%", "decimals": 1, "access": "r" } }
```

- `q`: `"good"` | `"normal"` | `"bad"` | **`"disabled"`** — 소스 레지스터의 장비가 비활성이면 `disabled`
- `v`는 **마지막 값을 유지**합니다. `bad`일 때처럼 `null`로 만들지 않습니다.
- `access`는 원래 값을 그대로 둡니다. 쓰기 가능 여부는 프론트가 `q`를 보고 막고, 최종 거부는 3.7에서 합니다.

### 3.7 쓰기 거부

`POST /api/registers/{registerId}/write`와 `POST /api/hmi/write`에서, 대상 레지스터의 장비가 비활성이면:

```json
409 { "error": "device disabled", "deviceId": 1 }
```

### 3.8 상위 Modbus 서버

- 비활성 장비 레지스터에 매핑된 영역은 **마지막 값을 그대로** 응답합니다.
- 상위에서 그 영역에 쓰는 요청을 어떻게 처리할지는 4번 질문 1을 참고해 주세요.

### 3.9 트렌드 기록

- 비활성 장비 채널도 **마지막 값으로 계속 기록**합니다. 기록 형식은 바꾸지 않습니다.

### 3.10 로그

| 시점 | 레벨 | 예시 |
|---|---|---|
| 비활성화 | INFO | `Device disabled: PLC-1 (id=1) by admin` |
| 활성화 | INFO | `Device enabled: PLC-1 (id=1) by admin` |
| 여러 장비 전환 | INFO | 장비마다 한 줄, 또는 한 줄에 목록 |

- 비활성 장비는 통신 실패나 타임아웃 같은 오류·경고 로그와 알람(`alerts`)을 만들지 않습니다.

---

## 4. 백엔드 확인이 필요한 사항

1. **상위 Modbus 서버의 쓰기:** 상위에서 비활성 장비 영역에 쓰려 할 때의 동작을 제안해 주세요. 예: Modbus 예외 응답(어떤 코드인지) 또는 무시. 프론트는 어느 쪽이든 괜찮습니다.
2. **진행 중인 요청:** 비활성으로 바꾸는 순간 이미 보낸 요청은 끝까지 기다리는지, 그 응답 값을 반영하는지 알려주세요. 프론트는 "반영해도 무방"입니다.
3. **여러 장비 API의 원자성:** 전부 적용하거나 전부 적용하지 않는 방식이 어려우면 알려주세요.
4. **`disabledAt` / `disabledBy`:** 넣을 수 있는지 알려주세요. 장비 상세에 "언제, 누가 껐는지"를 보여주려는 용도입니다.

---

## 5. 참고 — 프론트에서 만들 화면

API 설계에 참고하시라고 적습니다.

- **장비 목록:** 행마다 활성 토글, 체크한 장비 일괄 전환, 비활성 행 흐리게 + "비활성" 배지
- **상단바:** 비활성 장비가 있을 때 "비활성 N" 배지(테스트 후 다시 켜는 것을 잊지 않게)
- **이 장비만 통신(단독 테스트):** 나머지 장비를 잠시 비활성화하고, 상단에 "단독 테스트 중 [전체 복귀]" 표시. 복귀하면 원래 상태로 돌림 → 3.2 여러 장비 API 사용
- **되돌리기 알림:** 토글 직후 "PLC-1 비활성화됨 [되돌리기]" → 3.2 API 사용
- **실시간 / 대시보드 / 장비 상세:** 회색 "비활성" 표시. 값은 마지막 값을 흐리게 보여주고 마지막 통신 시각 표시
- **HMI:** 위젯에 비활성 품질 표시(통신 불량 표시와 구분), 쓰기 위젯 비활성화

---

## 6. 정리

| # | 요청 | 비고 |
|---|---|---|
| 3.1 | 장비 `enabled` 필드(영구 저장, 백업·복원 포함) | 기본 `true` |
| 3.2 | 전환 API — 장비 하나 / 여러 장비, **폴링 중 허용** | 여러 장비는 원자적으로 |
| 3.3 | 장비 상태 `disabled`, `disabledAt`/`disabledBy` | 마지막 통신 시각 유지 |
| 3.4 | 대시보드 KPI `disabledDevices` | 오류 개수에서 제외 |
| 3.5 | 레지스터 품질 `disabled`, 마지막 값 유지 | |
| 3.6 | HMI 품질 `disabled`, 마지막 값 유지(`v` null 아님) | |
| 3.7 | 쓰기 거부 409 `device disabled` | |
| 3.8 | 상위 Modbus 서버: 마지막 값 유지 | 쓰기 처리는 질문 1 |
| 3.9 | 트렌드: 마지막 값으로 계속 기록 | |
| 3.10 | 전환 로그, 비활성 장비 오류·알람 생성 안 함 | |

구현 후 `api-spec.md`와 `api-changelog.md` 갱신을 부탁드립니다.
