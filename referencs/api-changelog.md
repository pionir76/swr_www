# API 변경 이력 (프론트엔드 참고)

---

## 2026-10-13

### 신규: 언어 설정 API (`/api/system/language`)

프론트 요청으로 추가된 엔드포인트입니다.

#### GET /api/system/language
- **인증 불필요** — 로그인 전에도 호출 가능
- 응답: `{ "language": "ko" }`
- 앱 초기 로드 시 언어 설정을 읽어올 때 사용

#### PUT /api/system/language
- **권한: ManagerOrAbove** (일반 User는 403)
- 요청 바디: `{ "language": "ko" }`
- 허용 값: `"ko"` | `"en"` | `"ja"` | `"zh"`
- 허용 값 외 전송 시 **400** 반환
- 설정은 `config.json`에 저장되며 재시작 후에도 유지됨

---

> 전체 API 명세는 같은 폴더의 `api-spec.md` 참고.

---

## 2026-10-15 (2차) — 장비 활성/비활성

프론트 검토 의견(값 정책 재조율, 실시간 목록 포함, 상위 쓰기 0x04)을 모두 반영해 구현했습니다. 장치에 배포되어 있습니다. 조율 경위는 `device-enable-api-review.md` 참고.

### 확정 동작

| 항목 | 동작 |
|---|---|
| 전환 시점 | **폴링 중지 상태에서만** 전환(폴링 중 409). 다음 폴링 시작부터 적용 |
| 단일 전환 | `PUT /api/devices/{id}` `{ "enabled": false }` |
| 일괄 전환 | `PUT /api/devices/enabled` — 전부 적용 또는 전부 미적용, 없는 id면 404이며 아무것도 바뀌지 않음 |
| 장비 상태 | `GET /api/devices/status`에 `enabled` 추가, 비활성이면 `state: "disabled"`. `lastPollTimestamp` 등은 비활성화 직전 값 유지 |
| 다시 활성화 | 폴링 시작 시 `state: "unknown"`, `consecutiveErrors: 0`에서 시작 |
| 대시보드 | `kpi.disabledDevices` 추가, `errorDevices`·`unknownDevices`에서 제외. `devices[]`에 `enabled` |
| 실시간 목록 | **모든 레지스터가 항상 포함**. 비활성 장비는 `quality: "disabled"`, 마지막 값 유지 |
| HMI 값 | `q: "disabled"`, `v`는 마지막 값 유지 |
| 쓰기 | REST(`/api/registers/{id}/write`, `/api/hmi/write`) 409 `{ "error": "device disabled", "deviceId": n }` |
| 상위 Modbus | 읽기는 마지막 값, 쓰기는 예외 **0x04** |
| 트렌드 | 마지막 값으로 계속 기록 |
| 백업·복원 | `devices.json`에 `enabled` 포함, 예전 백업은 `true`로 복원 |
| 로그 | `Device disabled: NOVAST540 (id=14) by admin` / `Polling started. Total devices: 5 (disabled: 2)` |

**재부팅**: 비활성 설정은 유지되지만 마지막 값은 메모리에만 있어 사라집니다. 비활성인 채로 재부팅하면 그 장비는 값이 없는 상태로 시작합니다. 실시간 목록에는 그대로 나오며 `isValid: false`, HMI `v: null`, 상위 Modbus 0입니다.

### 함께 바뀐 점 — 확인 부탁드립니다

- **실시간 목록은 폴링 시작 직후부터 전체 레지스터를 포함합니다.** 이전에는 첫 응답이 올 때까지 목록에 없었습니다. 첫 응답 전 레지스터는 `isValid: false`, `quality: "bad"`, `lastUpdated: ""`입니다. 트렌드 설정 저장 시 채널이 사라지던 문제는 백엔드에서 해소됐습니다. 그래도 트렌드 설정은 실시간 목록이 아니라 레지스터 설정 목록을 기준으로 저장하도록 바꾸시는 것을 권합니다. 폴링을 한 번도 시작하지 않은 상태에서는 여전히 목록이 비어 있습니다.
- **명세 정정 — `lastPollTimestamp`는 문자열이 아니라 Unix epoch 밀리초 정수입니다.** 원래부터 정수로 내려가고 있었고, 명세에만 `"2026-10-13T12:00:00"`로 잘못 적혀 있었습니다. 폴링 이력이 없으면 `0`입니다.

### 장치 검증 결과

장치에서 14번(시리얼)·16번(TCP)을 비활성화해 확인했습니다.
- 폴링 중 전환 409, 없는 id 404(변경 없음), 형식 오류 400
- 14·16번 `state: "disabled"`, 14번 `lastPollTimestamp` 유지, KPI `disabledDevices: 2`, `errorDevices: 0`(원래 오류였던 16번 제외)
- 같은 시리얼 버스의 다른 장비 실측 주기 **3680ms → 2153ms**
- 실시간 37개 전부 포함, 14번 레지스터 `disabled` + 마지막 값(700) 유지
- HMI `q: "disabled"` + 마지막 값, REST·HMI 쓰기 409, 활성 장비 쓰기는 정상
- 상위 Modbus: 비활성 장비 쓰기 0x04, 읽기 마지막 값(700), 활성 장비 쓰기 정상
- 비활성 상태로 서비스 재시작: 설정 유지, 목록에 포함(`isValid: false`), HMI `v: null`
- 다시 활성화: `unknown`·오류 0회로 시작 → 정상 복귀

테스트 후 장치는 원래 상태(전 장비 활성, 상위 Modbus 꺼짐)로 되돌렸습니다. 테스트로 바꾼 레지스터 값도 원래대로 돌렸습니다.

---

## 2026-10-15

### 신규: HMI 화면 저장/불러오기 API

조율 문서(`hmi-screen-api-review.md`) 합의 내용대로 구현했습니다. 장치에 배포되어 있습니다.

| 메서드 / 경로 | 권한 |
|---|---|
| `GET /api/hmi/project` | Any |
| `PUT /api/hmi/project` | ManagerOrAbove |
| `GET /api/hmi/screens/{id}` | Any |
| `POST /api/hmi/screens` | ManagerOrAbove |
| `PUT /api/hmi/screens/{id}` | ManagerOrAbove |
| `DELETE /api/hmi/screens/{id}` | ManagerOrAbove |

요청서 대비 합의로 바뀐 점:
- `POST`/`DELETE` 응답에 `projectRevision`, `startScreen` 포함
- 마지막 화면 삭제 허용 → `startScreen: null`
- 화면이 있는 상태에서 `PUT project`로 `startScreen: null` → 400
- 화면 개수 초과 409에 `maxScreens` 포함: `{ "error": "too many screens", "maxScreens": 50 }`

**프로젝트 revision 초기값 주의**: 빈 프로젝트의 `revision`이 항상 0은 아닙니다. 화면을 만들었다 지운 이력이 있으면 0보다 큽니다. 첫 `PUT /api/hmi/project` 전에는 반드시 `GET`으로 현재 revision을 받아 쓰세요.

장치 현재 상태: 화면 0개(빈 프로젝트), 기존 HMI 태그 28개 그대로. `main`, `chiller` 이관 POST를 그대로 진행하시면 됩니다.

### 변경: 백업/복원에 HMI 포함

- 백업 ZIP의 `hmi.json`에 프로젝트·화면·태그 전체 포함 (`manifest.contents.hmi: true`)
- `restore/validate` 응답의 `hmi`: `available` 실제 값, `count` = 화면 개수, `warning` = 교체 안내
- HMI 태그가 있는 백업이면 `warnings` 배열에 레지스터 의존 경고 포함 → `options.hmi: true` + `options.registers: false` 조합일 때 표시해 주세요
- `restore/apply`의 `options.hmi` 기본값 `false` → **`true`** (복원 화면 체크박스 기본 상태 확인 필요)
- HMI 복원은 전체 교체

**레지스터 id 문의 회신**: 복원 시 레지스터 id는 **유지되지 않습니다** (새 id로 다시 생성). 그래서 `hmi.json`의 태그는 `registerId` 대신 `unifiedAddress`로 레지스터를 가리키도록 저장하고, 복원 시 `unifiedAddress`로 현재 레지스터를 찾아 새 `registerId`로 연결합니다. 복원 직후 HMI 화면이 엉뚱한 값을 보여주는 문제는 생기지 않습니다. 현재 장치에 해당 `unifiedAddress`가 없는 태그는 건너뜁니다.

> 참고: `hmi.json`은 백엔드 내부 형식이라 프론트가 직접 읽을 일은 없습니다. REST API의 태그는 계속 `registerId`를 씁니다.

### 수정: 장비만 복원할 때 HMI 태그가 사라지던 문제

**증상**: 복원 옵션을 `devices: true`, `hmi: false`로 주면 HMI 태그가 전부 삭제되었습니다. 장비를 지우면 그 레지스터와, 레지스터를 가리키는 HMI 태그까지 연쇄 삭제되기 때문입니다. 화면은 남는데 화면이 쓰는 태그만 없어지는 상태가 됐습니다.

**수정 후 동작**: 장비를 지우기 전에 현재 HMI 태그를 `unifiedAddress`와 함께 보관해 두었다가, 레지스터를 다시 만든 뒤 같은 `unifiedAddress`를 가진 새 레지스터에 다시 연결합니다. 태그 id·이름·오버라이드 값(unit/min/max/decimals/access)·생성/수정 시각은 그대로 유지되고 `registerId`만 새 값으로 바뀝니다.

**프론트 확인 사항**
- 복원 후 HMI 태그의 `registerId`는 복원 전과 **다른 값**이 됩니다. 태그 목록이나 `registerId`를 캐시하고 있다면 복원 후 다시 조회해 주세요. 화면은 태그를 `id`로 참조하므로 영향이 없습니다.
- 백업에 없는 레지스터를 가리키던 태그는 **삭제**됩니다 (연결할 레지스터가 없으므로). 그 태그를 쓰던 화면 위젯은 값을 받지 못합니다.
- 삭제된 태그 id는 현재 **시스템 로그(warning)에만** 남고 `restore/apply` 응답에는 포함되지 않습니다. 복원 결과 화면에 표시가 필요하면 알려주세요. 응답에 `warnings` 배열을 추가하겠습니다.
- API 계약 변경은 없습니다.

**장치 검증 결과 (2026-10-15)**: 장치에서 자체 백업을 `devices: true`, `registers: true`, `hmi: false`로 복원해 확인했습니다.
- 태그 28개 전부 유지, 28개 모두 `registerId`만 새 값으로 바뀜 (예: `ALARM_STATUS` 16 → 70)
- `unifiedAddress`, 이름, 오버라이드 값, `createdAt` 변화 없음
- HMI 화면과 시작 화면은 그대로 유지
- 복원 후 `/api/hmi/values`가 `q: "good"`으로 정상 값 반환

> **참고**: 이 테스트로 장치의 **장비 id가 9~13 → 14~18로 바뀌었습니다** (복원은 장비도 새 id로 다시 만듭니다). 개발 중 장비 id를 하드코딩하거나 캐시해 두었다면 다시 조회해 주세요. HMI 화면은 여전히 0개(빈 프로젝트)입니다.

### 정정: 트렌드 채널 설정은 복원 영향 없음

백엔드 내부 검토 중 트렌드 채널의 `regId`도 복원 시 어긋날 수 있다고 봤으나, 확인 결과 `regId`에는 실제로 `unifiedAddress` 값이 담겨 있어 복원 후에도 같은 레지스터를 가리킵니다. 문제없습니다. (이름이 `regId`라 헷갈릴 수 있으니 참고하세요.)

### 변경: 공장 초기화

HMI 프로젝트·화면·태그도 함께 삭제됩니다.

### 수정: 상위 Modbus 서버 쓰기

REST API 변경은 없습니다. 상위 Modbus 서버 동작만 바뀌었습니다.

- **쓰기가 실제로 장비에 전달됩니다.** 기존에는 상위가 쓴 값 대신 장비의 현재 값을 다시 보내고 있어서, 상위 쓰기는 정상 응답을 받아도 실제로는 아무 효과가 없었습니다.
- **같은 값을 반복해서 써도 매번 전달됩니다.** 기존에는 직전에 쓴 값과 같으면 전달되지 않았습니다.
- **읽기 전용 레지스터에 쓰면 Modbus 예외 0x04로 거부됩니다.** 기존에는 정상 응답 후 조용히 버려졌습니다. 다중 쓰기(FC16)에 읽기 전용이 하나라도 포함되면 요청 전체가 거부되고 아무 값도 쓰이지 않습니다.

장치에서 수정 전·후 바이너리를 같은 테스트로 비교 검증했습니다.

### 확인 사항: content 숫자 정밀도·배열 순서

장치 Qt 6.8.3에서 직접 검증했습니다. `0.1`→`0.1`, `0.30000000000000004`→그대로, 정수는 정수로, `widgets` 배열 순서 유지. 객체 키는 알파벳순으로 재정렬됩니다(합의대로 무관).

---

## 2026-10-14 (2차)

### 디바이스 폴링 주기 자동 조정 모드 (`pollMode`)

#### 변경된 엔드포인트

**GET /api/devices** — 응답에 `pollMode` 필드 추가
```json
{ "pollMode": "auto" }   // 또는 "manual"
```

**POST /api/devices** — 요청 바디에 `pollMode` 추가 (생략 시 `"auto"`)
```json
{ ..., "pollMode": "auto" }
```
응답 201에 `pollMode` 포함

**PUT /api/devices/{id}** — `pollMode` 변경 가능
```json
{ "pollMode": "manual", "intervalMs": 1000 }
```
응답 200이 body를 포함하도록 변경됨:
```json
{ "ok": true, "pollMode": "manual" }
```
`pollMode: "manual"` + `intervalMs`가 실측 소요시간보다 짧으면 **저장은 허용하되** `"warning"` 필드 포함:
```json
{ "ok": true, "pollMode": "manual", "warning": "설정 주기(500ms)가 실측 소요시간(800ms)보다 짧습니다" }
```

**GET /api/devices/status** — `pollMode`, `effectiveIntervalMs` 추가
```json
{
  "pollMode": "auto",
  "effectiveIntervalMs": 1200,
  "lastPollDurationMs": 45,
  ...
}
```
- `effectiveIntervalMs`: 실제 측정된 poll 시작 간격(ms). auto/manual 공통.
- `pollMode`: 현재 이 장치에 적용 중인 모드.

#### 동작 방식 (참고)

| 모드 | 동작 |
|------|------|
| `auto` (기본) | 실측 버스 소요시간 기반 자동 조정. `intervalMs` 무시. 버스 공유 장치끼리 자연스럽게 공평 배분. |
| `manual` | `intervalMs` 그대로 사용. 비현실적 설정 시 서버가 경고 반환. |

기존 장치(마이그레이션 전)는 모두 `"auto"`로 처리됩니다.

---

## 2026-10-14 (1차)

### 신규: HMI 태그 API

#### CRUD — `GET/POST/PUT/DELETE /api/hmi/tags`
- `GET` / `GET /{id}`: 인증 필요 (Any)
- `POST` / `PUT` / `DELETE`: ManagerOrAbove
- `POST` 201 Created, `DELETE` 404 시 error 반환

#### 실시간 값 조회 — `GET /api/hmi/values?tags=A,B`
- 인증 필요 (Any)
- `tags` 파라미터 생략 시 전체 태그 반환
- 응답 `"q"` 값은 **3단계**: `"good"` / `"normal"` / `"bad"` — 모두 처리 필요
  - `"bad"` 상태이거나 아직 값 없으면 `"v": null`
- `"unit"`, `"decimals"`, `"access"` 포함 (상속값 적용 후)

#### 쓰기 — `POST /api/hmi/write`
- ManagerOrAbove
- 바디: `{ "tag": "LEVEL_SP", "v": 75.0 }`
- coil 타입: `"v"` 에 JSON boolean(`true`/`false`) 또는 숫자(`0`/`1`) 가능
- 서버가 엔지니어링 단위 → raw 변환 (`raw = round(v / scale)`)
- `access: "r"` 태그 쓰기 시도 시 **405** 반환

#### decimals 자동 추론
`decimals` 생략(null) 시 서버가 `scale`에서 자동 계산:
`scale=1.0 → 0`, `scale=0.1 → 1`, `scale=0.01 → 2`  
명시하면 오버라이드.

---

> 전체 API 명세는 같은 폴더의 `api-spec.md` 참고.
