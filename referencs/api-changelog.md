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
