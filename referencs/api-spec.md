# SmartRoute REST API 명세

> 최종 수정: 2026-11-20 (실시간·대시보드 원본값만(`scaledValue`·`outOfRange` 폐지), HMI 내보내기·불러오기, HMI `pollMs`)  
> Base URL: `http://<device-ip>:8080`  
> 응답 형식: `application/json` (바이너리 응답 제외)

---

## 공통

### 인증

`Authorization: Bearer <token>` 헤더를 모든 보호된 엔드포인트에 포함해야 합니다.  
토큰은 `POST /api/login` 성공 시 발급됩니다.

**세션 만료와 무효화** (2026-11-11부터)

- 인증이 필요한 요청을 보낼 때마다 그 토큰의 마지막 사용 시각이 갱신됩니다.
- 보안 정책의 `sessionTimeoutMinutes` 동안 인증 요청이 없으면 토큰은 무효가 되고, 이후 요청은 **401**입니다. `autoLogout` 값과 상관없이 항상 적용됩니다.
- 정책을 바꾸면 이미 발급된 토큰에도 바로 새 시간이 적용됩니다.
- 시간은 장치 부팅 후 경과 시간으로 잽니다. NTP 동기화나 수동 시간 설정으로 시계가 바뀌어도 세션은 끊기지 않습니다.
- 다음 경우에도 토큰이 바로 무효가 됩니다(이후 401).
  - 사용자 상태를 `disabled` 또는 `locked`로 변경: 그 사용자의 모든 토큰
  - 사용자 삭제: 그 사용자의 모든 토큰
  - 비밀번호 변경: 본인이 바꾸면 그 요청에 쓴 토큰을 뺀 나머지, 관리자가 다른 사용자의 것을 바꾸면 그 사용자의 모든 토큰
- 로그인 실패가 쌓여 계정이 자동 잠금될 때는 이미 로그인한 토큰을 끊지 않습니다(새 로그인만 막힘).
- 장치(swr)를 재시작하면 모든 토큰이 무효가 됩니다.

### 권한 등급

| 등급 | 대상 |
|---|---|
| `Any` | 로그인한 모든 사용자 |
| `ManagerOrAbove` | Manager, Admin |
| `AdminOnly` | Admin 전용 |
| 없음 | 인증 불필요 |

### 공통 에러 응답

```json
{ "error": "에러 메시지" }
```

| 상태 코드 | 의미 |
|---|---|
| `400 Bad Request` | 잘못된 요청 파라미터 |
| `401 Unauthorized` | 미인증 / 세션 만료 |
| `403 Forbidden` | 권한 부족 / 보호된 계정 |
| `404 Not Found` | 리소스 없음 |
| `409 Conflict` | 상태 충돌 (폴링 중 수정, 이미 녹화 중 등) |
| `422 Unprocessable Entity` | 복원 파일 무결성 검증 실패 |
| `500 Internal Server Error` | 서버 내부 오류 |

---

## 1. 인증 / 세션

### POST /api/login
인증 불필요.

**Request Body**
```json
{ "username": "admin", "password": "1234" }
```

**Response 200**
```json
{ "token": "uuid-token-string" }
```

**에러 응답**

| 상태 | reason 필드 | 설명 |
|---|---|---|
| 401 | — | 비밀번호 불일치 |
| 403 | `"disabled"` | 계정 비활성화 |
| 403 | `"locked"` | 계정 잠금 (최대 시도 초과) |

---

### POST /api/logout
인증 불필요 (만료 토큰으로도 로그아웃 가능).

**Response 200** (body 없음)

---

### GET /api/session
권한: `Any`

**Response 200**
```json
{ "valid": true }
```

> 다른 인증 요청과 마찬가지로 토큰의 마지막 사용 시각을 갱신합니다. 만료되었거나 무효화된 토큰이면 **401**입니다.

---

## 2. 대시보드

### GET /api/dashboard
권한: `Any`

**Response 200**
```json
{
  "polling": { "running": true },
  "kpi": {
    "totalDevices": 3,
    "okDevices": 2,
    "errorDevices": 1,
    "unknownDevices": 0
  },
  "devices": [
    {
      "id": 1,
      "name": "PLC-1",
      "deviceCode": "DEV01",
      "connType": "serial",
      "protocol": "modbus_rtu",
      "state": "ok",
      "lastPollDurationMs": 45,
      "consecutiveErrors": 0,
      "lastError": ""
    }
  ],
  "realtimeRegisters": [ /* 최대 20개, GET /api/registers/realtime 항목과 같음(registerId만 없음) */ ],
  "alerts": [
    { "id": 10, "timestamp": "2026-10-13T12:00:00", "level": "WARN", "message": "..." }
  ],
  "logs": [
    { "id": 9, "timestamp": "2026-10-13T12:00:00", "level": "INFO", "message": "..." }
  ]
}
```

> `state`: `"ok"` | `"error"` | `"unknown"`
>
> `alerts`의 통신 경보(`[경보] … 통신 불능 (연속 N회)`)는 장비가 **연속 3주기** 실패했을 때만 남습니다. 장비 `state`·`consecutiveErrors`는 지금처럼 매 주기 바뀝니다(2026-11-20).

---

## 3. 폴링 제어

### GET /api/polling/status
권한: `Any`

**Response 200**
```json
{ "running": true }
```

---

### POST /api/polling/start
권한: `Any`

**Response 200**
```json
{ "running": true }
```

**에러** 409: 이미 실행 중

> `enabled: false`인 장비는 폴링 대상에서 제외됩니다. 시작 시 모든 레지스터 값이 초기화되므로 비활성 장비의 레지스터는 실시간 목록에 나오지 않습니다.

---

### POST /api/polling/stop
권한: `Any`

**Response 200**
```json
{ "running": false }
```

---

## 4. 장비

### GET /api/devices
권한: `Any`

**Response 200**
```json
{
  "devices": [
    {
      "id": 1,
      "deviceCode": "DEV01",
      "name": "PLC-1",
      "displayName": "PLC 1번",
      "connType": "serial",
      "protocol": "modbus_rtu",
      "ipAddress": "",
      "tcpPort": 502,
      "slaveId": 1,
      "timeoutMs": 1000,
      "intervalMs": 1000,
      "retryCount": 3,
      "pollMode": "auto",
      "byteOrder": "big",
      "enabled": true
    }
  ]
}
```

> `connType`: `"serial"` | `"tcp"`  
> `protocol`: `"modbus_rtu"` | `"modbus_tcp"` | `"modbus_ascii"` | `"pclink"` | `"pclink_sum"`  
> `byteOrder`: `"big"` | `"little"` | `"default"`  
> `pollMode`: `"auto"` | `"manual"` (기본값 `"auto"`)  
> `enabled`: `false`이면 통신하지 않는 장비. 다음 폴링 시작부터 적용. 영구 저장되며 백업·복원에 포함

---

### GET /api/devices/status
권한: `Any`

**Response 200**
```json
{
  "devices": [
    {
      "deviceId": 1,
      "deviceCode": "DEV01",
      "displayName": "PLC 1번",
      "pollMode": "auto",
      "state": "ok",
      "lastPollTimestamp": 1792051708698,
      "lastPollDurationMs": 45,
      "effectiveIntervalMs": 1200,
      "consecutiveErrors": 0,
      "lastError": ""
    }
  ]
}
```

> `lastPollTimestamp`: 마지막 폴링 시작 시각, Unix epoch 밀리초(정수). 폴링 이력이 없으면 `0`  
> 비활성 장비는 폴링하지 않으므로 상태가 갱신되지 않음. 비활성 여부는 `GET /api/devices`의 `enabled`로 판단

---

### POST /api/devices
권한: `ManagerOrAbove` | 폴링 중 409

**Request Body**
```json
{
  "deviceCode": "DEV01",
  "name": "PLC-1",
  "displayName": "PLC 1번",
  "connType": "serial",
  "protocol": "modbus_rtu",
  "ipAddress": "",
  "tcpPort": 502,
  "slaveId": 1,
  "timeoutMs": 1000,
  "intervalMs": 1000,
  "retryCount": 3,
  "pollMode": "auto",
  "byteOrder": "big",
  "enabled": true
}
```

> 필수: `name`, `byteOrder`(`"big"` 또는 `"little"` 필수, `"default"` 불가)  
> `protocol` 생략 시: `connType=serial` → `modbus_rtu`, `connType=tcp` → `modbus_tcp`  
> `pollMode` 생략 시 `"auto"`. `"manual"` 선택 시 `intervalMs` 사용.  
> `enabled` 생략 시 `true`

**Response 201**
```json
{ "name": "PLC-1", "pollMode": "auto" }
```

---

### PUT /api/devices/{id}
권한: `ManagerOrAbove` | 폴링 중 409

**Request Body** (변경할 필드만 포함)
```json
{
  "name": "PLC-1-updated",
  "slaveId": 2,
  "pollMode": "manual",
  "intervalMs": 2000
}
```

**Response 200**
```json
{ "ok": true, "pollMode": "manual" }
```
`enabled`를 보내면 통신 사용/사용 안 함 전환 (다음 폴링 시작부터 적용)
`pollMode:"manual"` 설정 시 비현실적인 `intervalMs`(실측 소요시간보다 짧음)를 넣으면 저장은 허용하되 `"warning"` 필드 포함:
```json
{ "ok": true, "pollMode": "manual", "warning": "설정 주기(500ms)가 실측 소요시간(800ms)보다 짧습니다" }
```

**에러** 404: 장비 없음

---

### DELETE /api/devices/{id}
권한: `ManagerOrAbove` | 폴링 중 409

**Response 200** (body 없음)

---

## 5. 레지스터

### GET /api/devices/{deviceId}/registers
권한: `Any`

**Response 200**
```json
{
  "registers": [
    {
      "id": 1,
      "tagName": "TEMP_01",
      "displayName": "온도 1번",
      "localAddress": 100,
      "type": "holding_register",
      "readOnly": false,
      "length": 1,
      "unit": "℃",
      "scale": 0.1,
      "isSigned": true,
      "bitLabels": "",
      "minValue": -50.0,
      "maxValue": 150.0,
      "byteOrder": "default",
      "unifiedAddress": 1001
    }
  ]
}
```

> `type`: `"coil"` | `"discrete_input"` | `"input_register"` | `"holding_register"`  
> `byteOrder`: `"default"` | `"big"` | `"little"`

---

### POST /api/devices/{deviceId}/registers
권한: `ManagerOrAbove` | 폴링 중 409

**Request Body**
```json
{
  "tagName": "TEMP_01",
  "displayName": "온도 1번",
  "localAddress": 100,
  "type": "holding_register",
  "readOnly": false,
  "length": 1,
  "unit": "℃",
  "scale": 0.1,
  "isSigned": true,
  "bitLabels": "",
  "minValue": -50.0,
  "maxValue": 150.0,
  "byteOrder": "default",
  "unifiedAddress": 1001
}
```

> 필수: `tagName`, `type`  
> `unifiedAddress` 생략 시 자동 할당 (0–4999). 수동 지정 시 `>= 5000` 이어야 함.

**Response 201**
```json
{
  "tagName": "TEMP_01",
  "localAddress": 100,
  "type": "holding_register",
  "unifiedAddress": 1001
}
```

**에러** 409: `unifiedAddress` 중복

---

### PUT /api/registers/{registerId}
권한: `ManagerOrAbove` | 폴링 중 409

**Request Body** (변경할 필드만 포함, `tagName` 필수)
```json
{
  "tagName": "TEMP_01",
  "scale": 0.01,
  "unit": "°C"
}
```

**Response 200** (body 없음)  
**에러** 404: 레지스터 없음 | 409: `unifiedAddress` 중복

---

### DELETE /api/registers/{registerId}
권한: `ManagerOrAbove` | 폴링 중 409

**Response 200** (body 없음)

---

### GET /api/registers/unified-id/check?id={unifiedAddress}
권한: `Any`

**Query Parameter**: `id` (정수, ≥ 0)

**Response 200**
```json
{ "available": true }
```

---

### POST /api/registers/{registerId}/write
권한: `ManagerOrAbove`

**Request Body**
```json
{ "rawValues": [1234] }
```

> `rawValues`: `quint16` 배열. Coil 타입은 0/1만 유효.  
> 쓰기는 큐에 등록 후 다음 폴링 사이클에서 실행됩니다.

**Response 202**
```json
{ "ok": true }
```

**에러** 400: readOnly 레지스터 | 404: 레지스터 없음  
**에러** 409: 장비 비활성 `{ "error": "device disabled", "deviceId": 1 }`

---

### GET /api/registers/realtime
권한: `Any`

**Response 200**
```json
{
  "registers": [
    {
      "id": 1001,
      "registerId": 1,
      "tagName": "TEMP_01",
      "displayName": "온도 1번",
      "deviceId": 1,
      "localAddress": 100,
      "sourceType": "holding_register",
      "unit": "℃",
      "minValue": -50.0,
      "maxValue": 150.0,
      "scale": 0.1,
      "rawWord": 253,
      "rawWords": [253],
      "isSigned": false,
      "length": 1,
      "bitLabels": "",
      "readOnly": false,
      "isValid": true,
      "quality": "good",
      "lastUpdated": "2026-10-13T12:00:00Z",
      "errorMessage": ""
    }
  ]
}
```

> `quality`: `"good"` | `"normal"` | `"bad"`

| 필드 | 설명 |
|---|---|
| `rawWords` | 장비에서 읽은 **원본 워드 배열**(uint16), 길이 = `length`. **이미 워드 순서가 맞춰져 있어 항상 상위 워드가 먼저**입니다(`byteOrder`는 수집할 때 적용됨, 워드 안의 바이트는 그대로). coil·discrete_input은 비트마다 `0`/`1`. 아직 값을 받지 못했으면 `null`. 읽기에 실패해도 마지막 값이 남습니다(신선도는 `quality`로 판단) |
| `isSigned` | 레지스터 부호 여부. 부호는 **전체 정수(`length`×16비트)의 최상위 비트** 기준(2의 보수) |
| `length` | 워드 수(1–4) |

> **값 계산은 프론트가 합니다**(2026-11-20부터 `scaledValue`·`outOfRange` 없음). 정수 = `rawWords`를 상위 워드부터 이어 붙임(`isSigned`면 전체 비트 수 기준 2의 보수) → 물리값 = 정수 × `scale`. 범위 초과 표시는 물리값을 `minValue`/`maxValue`와 비교합니다(±1.7976931348623157e308은 제한 없음).
| `rawWord` | `rawWords[0]`과 같음(호환용). coil·discrete_input과 값이 없을 때는 `0` |

---

## 6. 로그

### GET /api/logs
권한: `Any`

**Query Parameters** (모두 선택)

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `limit` | int | 1000 | 최대 조회 건수 |
| `offset` | int | 0 | 시작 오프셋 |
| `level` | string | ALL | `INFO` \| `WARN` \| `ERROR` |
| `from` | string | — | 시작일 `YYYY-MM-DD` |
| `to` | string | — | 종료일 `YYYY-MM-DD` |

**Response 200**
```json
{
  "logs": [
    { "id": 1, "timestamp": "2026-10-13T12:00:00", "level": "INFO", "message": "..." }
  ],
  "count": 20,
  "total": 150,
  "limit": 20,
  "offset": 0,
  "level": "ALL",
  "from": "",
  "to": ""
}
```

- **보관:** 장치는 시스템 로그를 최신 **10,000건**까지 보관하고, 넘치면 오래된 것부터 지웁니다. 로그는 플래시에 저장되어 **재부팅·정전 뒤에도 남습니다**(공장 초기화 때만 지워짐). 대시보드 `alerts`·`logs`도 같은 저장소에서 읽습니다.

---

## 7. 사용자 관리

### GET /api/users
권한: `Any`

**Response 200**
```json
{
  "users": [
    {
      "id": 0,
      "username": "admin",
      "displayName": "관리자",
      "description": "",
      "role": "admin",
      "status": "active",
      "failedLoginCount": 0,
      "lastLoginAt": "2026-10-13T12:00:00",
      "lastLoginIp": "192.168.0.10"
    }
  ]
}
```

> `role`: `"admin"` | `"manager"` | `"user"`  
> `status`: `"active"` | `"locked"` | `"disabled"`

---

### POST /api/users
권한: `ManagerOrAbove`

**Request Body**
```json
{
  "username": "user1",
  "displayName": "사용자1",
  "description": "현장 운영자",
  "password": "pass1234",
  "role": "user"
}
```

> 필수: `username`, `password`, `role`  
> `password` 최소 길이: 보안 정책의 `minPasswordLength` (기본 8자)

**Response 201**
```json
{ "username": "user1", "role": "user" }
```

**에러** 409: 사용자명 중복

---

### PUT /api/users/{username}
권한: `ManagerOrAbove` | id=0(admin) 수정 불가(403)

**Request Body** (변경할 필드만 포함)
```json
{
  "displayName": "새 이름",
  "description": "메모",
  "role": "manager"
}
```

**Response 200**
```json
{
  "username": "user1",
  "displayName": "새 이름",
  "description": "메모",
  "role": "manager"
}
```

---

### DELETE /api/users/{username}
권한: `ManagerOrAbove` | id=0(admin) 삭제 불가(403)

**Response 200** (body 없음)  
**에러** 404: 사용자 없음

> 삭제된 사용자의 토큰은 모두 바로 무효가 됩니다.

---

### PUT /api/users/{username}/password
권한: `Any`

**동작 규칙**
- 본인(`isSelf=true`) + 비관리자: `currentPassword` 필수, 일치 검증 후 변경
- Admin 계정으로 타인 변경: `currentPassword` 불필요
- 타인 + 비관리자: 403

**Request Body**
```json
{
  "currentPassword": "old1234",
  "newPassword": "new1234"
}
```

> `newPassword` 최소 길이: 보안 정책의 `minPasswordLength`

**Response 200**
```json
{ "username": "user1" }
```

**에러 응답**

| 상태 | error | 설명 |
|---|---|---|
| 400 | `"newPassword must be at least N characters"` | 새 비밀번호가 너무 짧음 |
| 400 | `"currentPassword is required"` | 본인 변경인데 현재 비밀번호 없음 |
| 400 | `"Current password is incorrect"` | 현재 비밀번호 틀림 (2026-11-11 전에는 401) |
| 403 | `"Permission denied."` | 타인 + 비관리자 |
| 404 | `"User not found: …"` | 사용자 없음 |

> 변경에 성공하면 그 사용자의 다른 토큰은 무효가 됩니다. 본인이 바꾼 경우 요청에 쓴 토큰은 그대로 유지됩니다.

---

### PUT /api/users/{username}/status
권한: `ManagerOrAbove` | id=0(admin) 변경 불가(403)

**Request Body**
```json
{ "status": "active" }
```

> `status`: `"active"` | `"locked"` | `"disabled"`  
> `active` 설정 시 `failedLoginCount` 자동 0 초기화  
> `locked` 또는 `disabled`로 바꾸면 그 사용자의 토큰은 모두 바로 무효가 됩니다.

**Response 200**
```json
{ "username": "user1", "status": "active" }
```

---

### GET /api/users/login-history
권한: `ManagerOrAbove`

**Query Parameters** (선택)

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `limit` | int | 100 | 최대 조회 건수 |
| `username` | string | — | 특정 사용자 필터 |

**Response 200**
```json
{
  "history": [
    {
      "id": 1,
      "timestamp": "2026-10-13T12:00:00",
      "username": "admin",
      "action": "login",
      "result": "success",
      "ip": "192.168.0.10"
    }
  ],
  "count": 1
}
```

> `action`: `"login"` | `"logout"`  
> `result`: `"success"` | `"invalid_password"` | `"account_disabled"` | `"account_locked"`

---

### DELETE /api/users/login-history
권한: `ManagerOrAbove`

**Query Parameters** (선택)

| 파라미터 | 설명 |
|---|---|
| `username` | 특정 사용자 이력만 삭제. 생략 시 전체 삭제 |

**Response 200** (body 없음)

---

### GET /api/users/security-policy
권한: `ManagerOrAbove`

**Response 200**
```json
{
  "maxFailedAttempts": 5,
  "sessionTimeoutMinutes": 30,
  "minPasswordLength": 8,
  "autoLogout": true
}
```

---

### PUT /api/users/security-policy
권한: `ManagerOrAbove`

**Request Body** (변경할 필드만 포함)
```json
{
  "maxFailedAttempts": 5,
  "sessionTimeoutMinutes": 30,
  "minPasswordLength": 8,
  "autoLogout": true
}
```

> 유효 범위: `maxFailedAttempts` 1–20 | `sessionTimeoutMinutes` 1–1440 | `minPasswordLength` 4–32

**Response 200** — 저장된 값 전체 반환 (GET과 동일)

> `sessionTimeoutMinutes`: 인증 요청 없이 이 시간이 지나면 토큰이 무효가 됩니다(공통 › 인증 참고). 바꾸면 기존 토큰에도 바로 적용됩니다.  
> `autoLogout`: 서버 동작에는 영향이 없습니다. 웹의 무조작 자동 로그아웃 켜기·끄기용입니다.

---

## 8. 시스템 설정

### GET /api/config
권한: `Any`

**Response 200**
```json
{
  "network": {
    "interfaces": [
      {
        "name": "eth1",
        "role": "field",
        "enabled": true,
        "mode": "static",
        "ipAddress": "192.168.0.150",
        "netmask": "255.255.255.0",
        "gateway": "192.168.0.1",
        "dns": "8.8.8.8"
      },
      {
        "name": "eth0",
        "role": "service",
        "enabled": true,
        "mode": "static",
        "ipAddress": "192.168.1.150",
        "netmask": "255.255.255.0",
        "gateway": "",
        "dns": ""
      }
    ]
  },
  "serial": {
    "device": "/dev/ttymxc1",
    "baudRate": 9600,
    "dataBits": 8,
    "parity": "none",
    "stopBits": 1
  },
  "system": {
    "hostname": "smartroute",
    "ntpServer": "pool.ntp.org"
  },
  "modbusServer": {
    "enabled": false,
    "port": 502,
    "slaveId": 1
  },
  "trend": {
    "sampleIntervalSec": 10,
    "channels": [
      {
        "regId": 1001,
        "name": "온도1",
        "unit": "℃",
        "scale": 0.1,
        "isSigned": true,
        "minValue": 0,
        "maxValue": 65535
      }
    ]
  }
}
```

> `network` (2026-11-13부터): 설정 파일이 아니라 **장치의 실제 포트 상태**입니다. 항상 필드 포트(`role: "field"`) → 서비스 포트(`role: "service"`) 순서이고, `name`은 리눅스 이름(필드 = `eth1`, 서비스 = `eth0`)입니다. 포트를 찾지 못하면 `name`은 빈 문자열, `enabled`는 `false`입니다. 기존 화면 호환용으로 남겨 둔 것이며, 새 화면은 `GET /api/system/network`를 쓰세요.

---

### POST /api/config/reset
권한: `ManagerOrAbove`

설정 파일을 출고 기본값으로 초기화합니다. DB(장비/레지스터/사용자)는 변경하지 않습니다.

**Response 200**
```json
{
  "serial":  { /* 초기화된 시리얼 설정 */ },
  "system":  { /* 초기화된 시스템 설정 */ },
  "modbusServer": { /* 초기화된 Modbus 서버 설정 */ },
  "restartRequired": true
}
```

---

### PUT /api/config/network
권한: `ManagerOrAbove` | **폐지 (2026-11-13)**

포트 주소는 OS 이미지가 고정합니다(필드 포트 192.168.0.150/24, 서비스 포트 192.168.1.150/24). 이 API는 설정 파일에 저장만 하고 실제로 적용하지 않았기 때문에 폐지했습니다. 인증·권한 확인 뒤 항상 아래 응답을 돌려줍니다.

**Response 410**
```json
{ "error": "Network settings are fixed by the OS image and cannot be changed. Use GET /api/system/network to read them." }
```

---

### PUT /api/config/serial
권한: `ManagerOrAbove`

**Request Body** (변경할 필드만 포함)
```json
{
  "baudRate": 19200,
  "dataBits": 8,
  "parity": "none",
  "stopBits": 1
}
```

> `parity`: `"none"` | `"even"` | `"odd"`

**Response 200**
```json
{ "restartRequired": true }
```

---

### PUT /api/config/system
권한: `ManagerOrAbove`

**Request Body** (변경할 필드만 포함)
```json
{
  "hostname": "smartroute",
  "ntpServer": "pool.ntp.org"
}
```

**Response 200**
```json
{ "restartRequired": true }
```

---

### PUT /api/config/modbus-server
권한: `ManagerOrAbove`

**Request Body** (변경할 필드만 포함)
```json
{
  "enabled": true,
  "port": 502,
  "slaveId": 1
}
```

> `port`: 1–65535 | `slaveId`: 1–247

**Response 200**
```json
{ "restartRequired": true }
```

**상위 Modbus 서버 동작** (Holding Register 영역, 주소 = 레지스터 `unifiedAddress`)
- 읽기(FC03): 레지스터의 현재 raw 값
- 쓰기(FC06/FC16): 쓴 값을 해당 장비로 전달. 같은 값을 반복해서 써도 매번 전달
- 읽기 전용 레지스터 또는 비활성 장비의 레지스터에 쓰기: Modbus 예외 **0x04**(Server Device Failure)로 거부. 다중 쓰기(FC16)에 하나라도 포함되면 요청 전체를 거부하며 아무 값도 쓰지 않음
- 비활성 장비의 레지스터 읽기: 값이 없으므로 0
- 레지스터가 매핑되지 않은 주소에 쓰기: 무시(정상 응답)

---

## 9. 시스템 정보 / 제어

### GET /api/system/info
권한: `Any`

**Response 200**
```json
{
  "info": {
    "ver": "1",
    "rev": "0",
    "zcode": "0",
    "schemaVersion": 1,
    "lastUpdateDate": "2026-10-13"
  },
  "disk": {
    "total": 7516192768,
    "used": 1234567890,
    "available": 6000000000,
    "usedPercent": 16.5
  },
  "summary": {
    "deviceCount": 3,
    "registerCount": 24,
    "userCount": 2,
    "logCount": 150,
    "pollingActive": true
  },
  "ntp": {
    "server": "pool.ntp.org",
    "synced": true,
    "maxErrorMs": 12
  }
}
```

---

### GET /api/system/network
권한: `Any`

이더넷 포트 2개의 실제 상태를 OS에서 읽어 돌려줍니다. 항상 `ports[0]` = 필드 포트, `ports[1]` = 서비스 포트입니다.

| 포트 | 위치 | 리눅스 이름 | 주소 (OS 이미지 고정) | 용도 |
|---|---|---|---|---|
| 필드 포트 (`field`) | 위쪽 RJ45 | eth1 | 192.168.0.150/24, GW 192.168.0.1 | 현장 장비, 현장망, NTP |
| 서비스 포트 (`service`) | 아래쪽 RJ45 | eth0 | 192.168.1.150/24, GW 없음 | 유지보수 노트북 직결 |

포트는 리눅스 이름이 아니라 보드 위치로 찾습니다(이름은 위아래와 반대).

**Response 200**
```json
{
  "ports": [
    {
      "role": "field",
      "iface": "eth1",
      "present": true,
      "linkUp": true,
      "speedMbps": 100,
      "duplex": "full",
      "macAddress": "AE:D2:89:44:54:8F",
      "ipAddress": "192.168.0.150",
      "prefixLength": 24,
      "netmask": "255.255.255.0",
      "gateway": "192.168.0.1",
      "dns": ["8.8.8.8"],
      "rxBytes": 112550,
      "txBytes": 164840
    },
    {
      "role": "service",
      "iface": "eth0",
      "present": true,
      "linkUp": false,
      "speedMbps": 0,
      "duplex": "",
      "macAddress": "1E:CF:37:A8:73:D3",
      "ipAddress": "192.168.1.150",
      "prefixLength": 24,
      "netmask": "255.255.255.0",
      "gateway": "",
      "dns": [],
      "rxBytes": 32904,
      "txBytes": 36010
    }
  ]
}
```

| 필드 | 설명 |
|---|---|
| `present` | 포트를 찾았는지. `false`이면 나머지는 빈 값 |
| `linkUp` | 케이블 연결(링크) 여부 |
| `speedMbps`, `duplex` | 링크가 있을 때만 값이 있음. 없으면 `0`, `""` |
| `macAddress` | 현재 시제품 보드는 MAC이 기록되지 않아 **부팅마다 바뀝니다** |
| `ipAddress`, `prefixLength`, `netmask` | 첫 번째 IPv4 주소. 없으면 `""`, `-1`, `""` |
| `gateway` | 이 포트로 나가는 기본 게이트웨이. 없으면 `""` |
| `dns` | 이 포트에 설정된 DNS 목록 |
| `rxBytes`, `txBytes` | 부팅 후 누적 바이트 |

---

### GET /api/system/resources
권한: `Any`

3초 주기로 백그라운드에서 샘플링한 캐시 값을 즉시 반환합니다.

**Response 200**
```json
{
  "cpu": {
    "usagePercent": 15.3,
    "loadAvg1": 0.12,
    "loadAvg5": 0.08,
    "loadAvg15": 0.05,
    "tempCelsius": 52.0
  },
  "memory": {
    "totalKb": 524288,
    "usedKb": 102400,
    "usagePercent": 19.5
  },
  "swap": {
    "totalKb": 0,
    "usedKb": 0,
    "usagePercent": 0.0
  },
  "disk": [
    { "mount": "/",    "totalMb": 7168, "usedMb": 1178, "usagePercent": 16.4 },
    { "mount": "/var", "totalMb": 1024, "usedMb": 50,   "usagePercent": 4.9  }
  ],
  "network": {
    "eth0": { "rxBytes": 1234567, "txBytes": 890123 },
    "eth1": { "rxBytes": 0,       "txBytes": 0       }
  },
  "uptimeSeconds": 86400,
  "cachedAt": "2026-10-13T12:00:00"
}
```

> `network` 키는 리눅스 이름입니다. **`eth1` = 필드 포트(위쪽), `eth0` = 서비스 포트(아래쪽)**. 포트별 표시는 `GET /api/system/network`의 `role`을 쓰는 것을 권합니다.

---

### POST /api/system/restart
권한: `ManagerOrAbove`

300ms 후 프로세스를 종료합니다. systemd `Restart=always` 설정으로 자동 재시작됩니다.

**Response 200**
```json
{ "restarting": true }
```

---

## 10. 시스템 시간

### GET /api/system/time
권한: `Any`

**Response 200**
```json
{
  "ntpEnabled": true,
  "synced": true,
  "timezone": "Asia/Seoul",
  "localTime": "2026-10-13T21:00:00+09:00",
  "utcTime":   "2026-10-13T12:00:00Z"
}
```

---

### PUT /api/system/ntp
권한: `Any`

**Request Body**
```json
{ "enabled": true }
```

**Response 200**
```json
{ "ok": true, "ntpEnabled": true }
```

> 장치에서 약 10초 걸립니다(ntpd 시작/중지 완료 후 응답).

**에러** 500: `timedatectl` 실패 또는 20초 안에 끝나지 않음 (`"timedatectl set-ntp timed out"`)

---

### PUT /api/system/timezone
권한: `Any`

NTP 활성 여부와 무관하게 적용됩니다.  
⚠️ 타임존 변경 후 기존 .tnd 파일의 STIME 기반 타임스탬프 계산이 어긋날 수 있습니다.

**Request Body**
```json
{ "timezone": "Asia/Seoul" }
```

> IANA 타임존 식별자 (예: `"UTC"`, `"Asia/Seoul"`, `"America/New_York"`)  
> `;`, `&`, `..` 포함 시 400

**Response 200**
```json
{ "ok": true, "timezone": "Asia/Seoul" }
```

**에러** 400: 유효하지 않은 타임존 식별자

---

### PUT /api/system/time
권한: `Any`  
⚠️ NTP가 활성화된 상태에서는 **409** 반환. 먼저 `PUT /api/system/ntp { "enabled": false }` 를 호출해야 합니다.

**Request Body**
```json
{ "datetime": "2026-10-13T21:00:00" }
```

> ISO 8601 형식. 시스템 시각 변경 후 외부 RTC(`hwclock --systohc`)에도 반영됩니다.

**Response 200**
```json
{ "ok": true, "localTime": "2026-10-13T21:00:00" }
```

**에러** 409: NTP 활성 상태  
**에러** 400: OS 빌드 날짜보다 이른 시간 `{ "error": "Time is earlier than the OS build date. Enter a later date and time." }` (기준일은 OS 이미지마다 다름, 현재 2026-03-13)

---

## 11. 언어 설정

### GET /api/system/language
권한: `없음 (인증 불필요)`

**응답** 200:
```json
{ "language": "ko" }
```

### PUT /api/system/language
권한: `ManagerOrAbove`

**요청 바디:**
```json
{ "language": "ko" }
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `language` | string | ✅ | 언어 코드. 허용값: `"ko"` \| `"en"` \| `"ja"` \| `"zh"` |

**응답** 200:
```json
{ "ok": true, "language": "ko" }
```

**에러** 400: `language` 필드 누락 또는 허용되지 않는 값

---

## 12. 트렌드 설정 (채널 구성)

### GET /api/trend/config
권한: `Any`

**Response 200**
```json
{
  "sampleIntervalSec": 10,
  "channels": [
    {
      "regId": 1001,
      "name": "온도1",
      "tag": "TEMP_01",
      "unit": "℃",
      "scale": 0.1,
      "isSigned": true,
      "minValue": 0,
      "maxValue": 65535
    }
  ]
}
```

---

### PUT /api/trend/config
권한: `ManagerOrAbove`

**Request Body** (변경할 필드만 포함)
```json
{
  "sampleIntervalSec": 10,
  "channels": [
    {
      "regId": 1001,
      "name": "온도1",
      "tag": "TEMP_01",
      "unit": "℃",
      "scale": 0.1,
      "isSigned": true,
      "minValue": 0,
      "maxValue": 65535
    }
  ]
}
```

> `sampleIntervalSec`: `1` | `5` | `10` | `30` | `60`  
> `channels` 최대 16개. `tag` 생략 시 `"CH_01"` 형식으로 자동 부여 (최대 16자)

**Response 200** — 저장된 설정 전체 반환 (GET과 동일)

---

## 13. 트렌드 파일 (레코딩)

### POST /api/tfile/start
권한: `Any`

현재 트렌드 설정(`GET /api/trend/config`)을 기반으로 새 `.tnd` 파일 레코딩을 시작합니다.

**Response 200**
```json
{ "ok": true, "filename": "261013_210000.tnd" }
```

**에러**  
- 400: 트렌드 채널 미설정  
- 409: 이미 녹화 중

---

### POST /api/tfile/stop
권한: `Any`

**Response 200**
```json
{ "ok": true }
```

---

### GET /api/tfile/status
권한: `Any`

**Response 200**
```json
{
  "recording": true,
  "filename": "261013_210000.tnd",
  "elapsedSec": 3600,
  "fileSize": 10485760,
  "fileSizeLimit": 4294967296,
  "recordCount": 360,
  "freq": 10
}
```

> 녹화 중이 아닐 때: `recording=false`, `filename`은 마지막 파일명, `elapsedSec=0`

---

### GET /api/tfile/files
권한: `Any`

**Response 200**
```json
{
  "files": [
    {
      "filename": "261013_210000.tnd",
      "fileSize": 10485760,
      "startTime": 1760450400,
      "endTime":   1760454000,
      "recordCount": 360,
      "freq": 10,
      "chCount": 4
    }
  ]
}
```

> `startTime`, `endTime`: Unix 초 (UTC)

---

### DELETE /api/tfile/files/{filename}
권한: `Any`

**에러**  
- 400: 잘못된 파일명 (경로 포함, `..` 포함)  
- 404: 파일 없음  
- 409: 현재 녹화 중인 파일 삭제 시도

**Response 200**
```json
{ "ok": true }
```

---

### GET /api/tfile/header?file={filename}
권한: `Any`

Content-Type: `application/octet-stream`  
**Response**: `.tnd` 파일 메인 헤더 512 bytes (binary)

> 파싱 방법은 `TrendHandler/` 폴더의 헤더 포맷 또는 `api-spec.md` 내 tfile 섹션 참조

---

### GET /api/tfile/latest?file={filename}
권한: `Any`

Content-Type: `application/octet-stream`  
**Response**: 마지막 유효 레코드 32 bytes (16채널 × uint16, binary)

> 녹화 중인 파일에도 요청 가능. 실시간 1초 폴링에 사용.

---

### GET /api/tfile/sample?file={filename}&from={unix}&to={unix}&step={N}
권한: `Any`

| 파라미터 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `file` | string | ✓ | 파일명 |
| `from` | uint32 | ✓ | 조회 시작 Unix 초 (UTC) |
| `to` | uint32 | ✓ | 조회 종료 Unix 초 (UTC) |
| `step` | uint16 | — | 레코드 건너뛰기 간격 (기본 1) |

> 서버는 `(to-from)/step > 50,000` 이면 `step`을 자동 상향 조정합니다.  
> `step` 계산 권장: `step = max(1, ceil((to-from)/FREQ / canvas_width_px))`

Content-Type: `application/octet-stream`  
**Response**: 레코드 배열 (헤더 없음), 각 레코드 = 16 × uint16 = 32 bytes

---

## 14. HMI (태그 / 화면)

레지스터 `tagName`과 별도의 독립된 네임스페이스. 레지스터를 "소스"로 느슨하게 참조하며, 레지스터 이름이 바뀌어도 HMI 화면은 영향받지 않음.

태그 종류(`kind`)는 세 가지입니다(`expr`은 2026-11-24, `param`은 2026-11-25부터).

| `kind` | 뜻 | 값 |
|---|---|---|
| `register` | 레지스터 하나를 가리키는 태그 | 원본 `raw` |
| `expr` | 다른 태그로 계산하는 태그(계산 태그). 쓰기 불가 | 서버가 계산한 `value` |
| `param` | 사용자가 HMI에서 바꾸는 값을 장치에 저장해 두는 태그(설정 태그). 장비와 무관 | 저장된 현재 `value` |

### 데이터 모델 — register 태그

```json
{
  "id": "TK1_LEVEL",
  "name": "1번 탱크 수위",
  "kind": "register",
  "source": {
    "registerId": 123,
    "deviceId": 3,
    "deviceCode": "DEV03",
    "deviceDisplayName": "1번 탱크 제어기",
    "registerTagName": "LEVEL",
    "registerDisplayName": "탱크 수위",
    "localAddress": 100,
    "unifiedAddress": 12,
    "registerType": "holding_register",
    "length": 1,
    "scale": 0.1,
    "isSigned": false,
    "minValue": 0.0,
    "maxValue": 1000.0
  },
  "unit": "%",
  "min": 0.0,
  "max": 100.0,
  "scale": 0.01,
  "access": "r",
  "createdAt": "2026-10-14T10:00:00",
  "updatedAt": "2026-10-14T10:00:00"
}
```

- `source.registerId`만 저장되는 값. 나머지 `source` 필드는 **응답 전용**으로, 응답할 때마다 현재 장비·레지스터에서 채움(장비·레지스터 이름을 바꾸면 바로 반영)

| `source` 필드 | 출처 |
|---|---|
| `deviceId` | 레지스터가 속한 장비 id |
| `deviceCode` | 장비 `deviceCode` |
| `deviceDisplayName` | 장비 `displayName` |
| `registerTagName` | 레지스터 `tagName` |
| `registerDisplayName` | 레지스터 `displayName` |
| `localAddress` | 레지스터 `localAddress` (장비 안 주소) |
| `unifiedAddress` | 레지스터 `unifiedAddress` |
| `registerType` | 레지스터 `type` (`coil`·`discrete_input`이면 원본은 0/1) |
| `length` | 레지스터 `length` (워드 수). HMI 태그는 **1워드만 지원**. 2 이상이면 `values`의 `raw`는 `null`, 쓰기는 422 |
| `scale` | 레지스터 `scale`. 태그 `scale`이 `null`일 때 상속 |
| `isSigned` | 레지스터 `isSigned`. 원본 uint16을 부호 있는 값으로 해석할지 |
| `minValue` / `maxValue` | 레지스터 `minValue` / `maxValue` (레지스터 배율 기준) |

- 소스 레지스터를 찾을 수 없으면 `registerId` 외의 `source` 필드는 모두 `null` (필드는 항상 포함)
- 소스 레지스터를 삭제하면 그 HMI 태그도 **함께 삭제**됨 (장비 삭제 시 그 장비의 태그도 모두 삭제). 그 태그를 참조하던 계산 태그는 **남고**, 값은 `bad`, `missingRefs`에 표시됩니다
- **원본 데이터 원칙:** register 태그의 값은 응답·쓰기 모두 **원본 그대로**입니다. 표시 값 변환(부호 해석 × 배율, 배율의 소수 자릿수로 반올림)은 프론트가 하고, 서버는 같은 변환을 **계산 태그 평가와 쓰기 범위 검사 안에서만** 씁니다(응답에 싣지 않음).
- `scale`: `null`이면 레지스터 `scale` 상속. 허용 값은 `100`, `10`, `1`, `0.1`, `0.01`, `0.001`, 그 밖의 값은 400. 레지스터 설정과 무관하게 **원본값 기준**입니다(원본 1234, 태그 `scale` 0.01 → 12.34)
- `min` / `max`: 태그 배율을 적용한 값 기준. `null`이면 레지스터 `minValue`/`maxValue`를 태그 배율로 환산해 물려받습니다(`레지스터 값 ÷ 레지스터 배율 × 태그 배율`, 프론트 `WHMI.raw.limits`와 같음). 서버는 이 범위로 쓰기를 검사합니다
- `unit` / `access`: 생략(null) 시 소스 레지스터 값 상속(`values` 응답에는 상속을 적용한 값이 나감)
- `decimals`는 2026-11-13에 폐지. 요청에 들어와도 무시하고 응답에 없음
- `access`: `"r"` | `"rw"` — 레지스터 `readOnly` 상속 또는 오버라이드
- `id` 허용 문자: 영숫자 + `_` + `-`, 최대 64자
- 태그 수는 종류와 관계없이 **최대 1,000개**

### 데이터 모델 — expr 태그(계산 태그)

```json
{
  "id": "RUNNING",
  "name": "운전중",
  "kind": "expr",
  "source": {
    "valueType": "bool",
    "expr": { "op": "bitAny", "args": [ { "tag": "NOW_STS" }, { "value": [0] } ] }
  },
  "unit": null,
  "decimals": null,
  "min": null, "max": null, "scale": null,
  "access": "r",
  "missingRefs": [],
  "createdAt": "2026-11-24 05:47:10",
  "updatedAt": "2026-11-24 05:47:10"
}
```

| 필드 | 규칙 |
|---|---|
| `source.valueType` | `bool` / `number` / `string`. 필수. 결과를 이 타입으로 바꿔 내보냄 |
| `source.expr` | 식(AST). 필수 |
| `unit` | 선택. 숫자 결과에 붙일 단위 |
| `decimals` | 선택. 정수 0–6 또는 `null`. `valueType`이 `number`일 때만 씀: 식의 **최종 결과**를 이 자릿수로 반올림(중간 계산은 그대로). `null`이면 반올림 안 함. `bool`·`string` 태그는 무시하고 `null`로 저장·응답(범위 검사도 안 함). register 태그에는 없음 |
| `min` / `max` / `scale` / `access` | 쓰지 않음. 요청에 있어도 무시, 응답은 `null`(`access`는 `"r"`) |
| `missingRefs` | **응답 전용.** 식이 참조하는데 지금 없는 태그 id(정렬). 없으면 `[]` |

### 데이터 모델 — param 태그(설정 태그)

```json
{
  "id": "ALARM_TEMP",
  "name": "경보 기준 온도",
  "kind": "param",
  "source": { "valueType": "number", "initial": 80 },
  "value": 85.5,
  "unit": "°C",
  "min": 0, "max": 150,
  "decimals": 1,
  "scale": null,
  "access": "rw",
  "createdAt": "2026-11-25 05:47:10",
  "updatedAt": "2026-11-25 05:47:10"
}
```

| 필드 | 규칙 |
|---|---|
| `source.valueType` | `bool` / `number` / `string`. 필수. 만든 뒤에도 바꿀 수 있음 |
| `source.initial` | 필수. 처음 값이자 되돌릴 기준. 타입·범위 규칙은 아래 "값"과 같음. 숫자면 `decimals`로 반올림해 저장 |
| `value` | **응답 전용.** 현재 값. 쓰기(`POST /api/hmi/write`)로만 바뀌고 재부팅 뒤에도 남음 |
| `min` / `max` | 숫자 태그의 허용 범위. `null`이면 그쪽 제한 없음. `min` > `max`면 422 |
| `decimals` | 숫자 태그의 소수 자릿수 0–6 또는 `null`. 쓸 때 이 자릿수로 반올림해 저장 |
| `unit` | 숫자 태그의 단위 |
| `access` / `scale` | 받지 않음. 응답은 `"rw"` / `null` |

- `bool`·`string` 태그의 `min`·`max`·`decimals`·`unit`은 무시하고 `null`로 저장합니다(범위 검사도 안 함).
- **값의 타입은 엄격합니다:** `number`는 JSON 숫자(`"85"` 같은 글자는 안 됨), `bool`은 `true`/`false`(`0`/`1`은 안 됨), `string`은 글자 0–64자(JavaScript `length`). `null`은 어느 타입에도 안 됩니다.
- 품질은 항상 `good`입니다. 태그 수 한도 1,000개에 함께 셉니다. 다른 태그를 참조하지 않으므로 순환·깊이 검사와 무관합니다.
- **PUT으로 정의를 고칠 때 현재 값:** `initial`만 고치면 그대로, `valueType`을 바꾸면 새 `initial`로, 범위를 좁혀 밖이 되면 가까운 끝으로, `decimals`를 바꾸면 새 자릿수로 반올림합니다. 바디에 `value`가 있어도 무시합니다. 값이 바뀌면 시스템 로그에 남습니다.
- **변경 기록:** 값이 바뀔 때마다 시스템 로그 INFO 한 줄. `HMI param ALARM_TEMP: 80 → 85.5 (admin)`, PUT으로 바뀌면 `(range changed, admin)`·`(type changed, admin)`·`(decimals changed, admin)`. 글자 값은 따옴표로 감쌉니다. 불러오기·복원은 한 줄씩 남기지 않습니다.

**식(AST):** 노드는 세 가지입니다. 노드에 다른 키가 더 있어도 무시합니다.

```json
{ "tag": "ID" }                       // 태그 참조
{ "value": 3 }                        // 상수: 숫자·글자·true/false·null (배열은 비트 목록 자리에만)
{ "op": "이름", "args": [ ... ] }     // 연산
```

| 연산자 | 인수 | 결과 | 규칙 |
|---|---|---|---|
| `eq` `ne` | `[a, b]` | bool | 둘 다 숫자로 읽히면 숫자 비교, 아니면 글자 비교 |
| `gt` `ge` `lt` `le` | `[a, b]` | bool | 둘 다 숫자로 읽힐 때만 비교, 아니면 거짓 |
| `range` | `[a, 최소, 최대]` | bool | 최소 ≤ a ≤ 최대. 최소·최대가 `null`이면 그쪽 끝없음 |
| `bitAny` / `bitNone` | `[a, { "value": [비트…] }]` | bool | a를 정수로 자른 뒤 비트 하나라도 1 / 모두 0. 비트 목록은 **상수 배열**, 0–15. 빈 목록은 거짓 |
| `and` `or` | 2개 이상 | bool | 인수를 참/거짓으로 읽음 |
| `not` | 1개 | bool | |
| `select` | `[조건, 값, 조건, 값, …, 기본값]` 홀수 개, 3개 이상 | 값 | 처음 참인 조건의 값, 없으면 기본값. 조건·값·기본값 자리 모두 상수·태그·연산이 올 수 있음 |
| `add` | 2개 이상 | number | 모두 더함 |
| `sub` | `[a, b]` | number | a − b |
| `mul` | 2개 이상 | number | 모두 곱함 |
| `div` | `[a, b]` | number | a ÷ b. b가 0이면 `bad` |
| `min` `max` | 2개 이상 | number | 가장 작은 / 큰 값 |
| `avg` | 2개 이상 | number | 합 ÷ 개수 |
| `abs` | 1개 | number | 절댓값 |

- **숫자로 읽기:** 참/거짓은 1/0, 숫자 모양 글자(앞뒤 공백 무시)는 숫자, 그 밖은 숫자 아님
- **참/거짓으로 읽기:** 숫자 0, `false`, 빈 글자, 글자 `"0"`·`"false"`는 거짓, 나머지는 참
- **태그 참조의 값:** register 태그는 표시 값(원본 → 부호 해석 × 배율, 배율 자릿수로 반올림. 코일·접점은 0/1), expr 태그는 그 결과, param 태그는 현재 값 그대로(품질 `good`)
- **산술(`add`~`abs`):** 인수를 숫자로 읽습니다. 하나라도 숫자로 읽히지 않거나(`null` 포함) 결과가 유한한 수가 아니면(0으로 나눔, 넘침) `bad`. 배정밀도 실수로 계산하고 중간에 반올림하지 않습니다(`24.72 − 12.45` → `12.269999999999998`, 자릿수는 `decimals`로)
- **지름길 계산 없음:** 모든 인수를 계산합니다. `or`의 한쪽이 참이어도 다른 쪽이 `bad`면 결과는 `bad`. `select`도 마찬가지라서 `select(ne(B,0), div(A,B), 0)`은 B가 0이면 `bad`입니다(고르지 않은 가지도 계산)
- **품질:** 참조한 태그(이어 쓴 계산 태그 포함) 중 하나라도 `bad`/`disabled`면 `bad`, `normal`이 섞이면 `normal`, 아니면 `good`. 없는 태그, register 태그의 `raw`가 `null`이면 `bad`. `bad`일 때 `value`는 `null`
- **`valueType` 변환:** `bool`은 참/거짓으로, `number`는 숫자로(숫자로 읽히지 않으면 `bad`), `string`은 JavaScript `String()`과 같은 글자로
- **`decimals` 반올림:** register 태그 배율 자릿수와 같은 방식(JavaScript `Number(x.toFixed(n))`과 같음). 정확히 절반은 0에서 먼 쪽(12.5 → 13, 0.125 → 0.13). 실수 표현 때문에 1.005는 1.00499…라서 1.00. `-0`은 `0`. 다른 계산 태그가 참조하면 반올림된 값을 받습니다
- **한도(저장할 때 검사):** 식 하나의 노드 64개, 식 하나가 참조하는 태그 32개, 계산 태그 → 계산 태그 참조 깊이 8단, 순환 참조 금지
- 공통 시험 데이터: `referencs/hmi-testdata-convert.json`, `referencs/hmi-testdata-expr.json`(서버 시험도 같은 파일을 씀)

### GET /api/hmi/tags
권한: `Any`

**응답** 200:
```json
{ "tags": [ { ...HmiTag... } ] }
```

### POST /api/hmi/tags
권한: `ManagerOrAbove`

**요청 바디:**
```json
{
  "id": "TK1_LEVEL",
  "name": "1번 탱크 수위",
  "source": { "registerId": 123 },
  "unit": "%",
  "min": 0.0,
  "max": 100.0,
  "scale": 0.01,
  "access": "r"
}
```
`id / name / source.registerId` 필수, 나머지 선택. `source`의 응답 전용 필드가 들어와도 무시. `kind`가 없으면 `register`

설정 태그(만들 때 현재 값 = `initial`):
```json
{
  "id": "ALARM_TEMP",
  "name": "경보 기준 온도",
  "kind": "param",
  "source": { "valueType": "number", "initial": 80 },
  "unit": "°C", "min": 0, "max": 150, "decimals": 1
}
```

계산 태그:
```json
{
  "id": "CAN_START",
  "name": "기동 가능",
  "kind": "expr",
  "source": { "valueType": "bool",
              "expr": { "op": "and", "args": [ { "op": "not", "args": [ { "tag": "RUNNING" } ] },
                                               { "op": "eq", "args": [ { "tag": "ALSTS" }, { "value": 0 } ] } ] } },
  "unit": ""
}
```
숫자 계산 태그는 `"decimals": 1`처럼 자릿수를 줄 수 있습니다(없으면 `null`).

**응답** 201: 생성된 HmiTag 객체  
**에러** 400: 유효하지 않은 id 형식 / registerId 없음 / access 값 오류 / scale 값 오류 / `kind`가 `register`·`expr`·`param`이 아님 / `source.valueType` 오류 / `source.expr` 없음 / 설정 태그의 `source.initial` 없음, 숫자 태그의 `min`·`max`가 숫자·`null`이 아님  
**에러** 409: id 중복  
**에러** 422: 식 검증 실패 — 문제 노드의 위치를 `path`로 줍니다(맨 위 노드는 `""`)
```json
{ "error": "bit numbers must be integers 0–15", "path": "args[1].args[1]" }
{ "error": "tag not found: NOPE", "path": "args[1].args[0]" }
{ "error": "circular reference: CAN_START → RUNNING → CAN_START", "path": "" }
```
422가 되는 경우: 모르는 연산자, 인수 개수, 노드 모양, 비트 목록, 없는 태그 참조, 순환 참조, 노드·참조·깊이 한도, 태그 수 1,000개 초과(`{ "error": ..., "maxTags": 1000 }`, `path` 없음), 숫자 계산 태그의 `decimals`가 정수 0–6·`null`이 아님(`path` 없음)

설정 태그의 422(`path` 없음): `initial` 타입이 틀림·`null`, 숫자 `initial`이 `min`~`max` 밖(반올림 뒤), 글자 64자 초과, `min` > `max`, `decimals`가 정수 0–6·`null`이 아님

### GET /api/hmi/tags/{id}
권한: `Any`

**응답** 200: HmiTag 객체  
**에러** 404

### PUT /api/hmi/tags/{id}
권한: `ManagerOrAbove`

요청 바디: POST와 동일 (`id`는 URL에서 받음). `kind`를 생략하면 지금 종류 그대로. **전체 교체**라서 빠진 선택 필드(`unit`, `decimals` 등)는 비워집니다. 계산 태그의 `decimals`를 유지하려면 항상 보내세요

**응답** 200: 수정된 HmiTag 객체  
**에러** 400: POST와 같음 / **`kind` 변경 시도**(만든 뒤 바꿀 수 없음)  
**에러** 404  
**에러** 422: POST와 같음(식 검증 실패, `path` 포함)

### DELETE /api/hmi/tags/{id}
권한: `ManagerOrAbove`

**응답** 200: `{ "ok": true }`  
**에러** 404  
**에러** 409: 계산 태그가 이 태그를 참조 중
```json
{ "error": "HMI tag 'RUNNING' is used by computed tag(s): CAN_START, STATE_TXT", "referencedBy": ["CAN_START", "STATE_TXT"] }
```
레지스터·장비 삭제, 시스템 복원, HMI 불러오기로 register 태그가 사라지는 것은 막지 않습니다. 그때 참조가 끊긴 계산 태그는 남고 `missingRefs`에 표시됩니다.

### GET /api/hmi/values?tags=A,B
권한: `Any`

`tags` 쿼리 파라미터 생략 시 전체 태그 반환

계산 태그는 **이 요청을 받을 때** 계산합니다. 요청한 태그와 그 태그가 참조하는 태그만 계산하고, 한 요청 안에서 같은 태그는 한 번만 계산합니다.

**응답** 200:
```json
{
  "ts": "2026-10-14T02:26:05Z",
  "values": {
    "TK1_LEVEL": {
      "raw": 569,
      "q": "good",
      "unit": "%",
      "access": "r"
    },
    "RUNNING": {
      "value": true,
      "q": "good",
      "unit": "",
      "access": "r"
    }
  }
}
```

- register 태그는 `raw`, 계산 태그는 `value`(원본이 아니므로). 계산 태그의 `q`는 `good`/`normal`/`bad`이고, `bad`면 `value`는 `null`
- 계산 태그의 `unit`은 태그 값(없으면 `""`), `access`는 항상 `"r"`
- 설정 태그: `{ "value": 85.5, "q": "good", "unit": "°C", "access": "rw" }`. 품질은 항상 `good`
- 장치 실측(2026-11-24): 태그 3개 요청 약 20ms. 전체 요청은 태그 9개 약 13ms, 계산 태그 100개(노드 14개씩)를 더하면 약 66ms

| `q` 값 | 의미 |
|--------|------|
| `"good"` | 마지막 폴링 경과 < 1.5× interval |
| `"normal"` | 1.5× ~ 3× interval (응답 지연) |
| `"bad"` | 3× 초과 또는 응답 없음 |
| `"disabled"` | 소스 레지스터의 장비가 비활성 (`raw`는 `null`) |

| 필드 | 설명 |
|---|---|
| `raw` | 장비에서 읽은 **원본 워드 그대로**(uint16, 0–65535). 부호 해석·배율 적용 없음. `registers/realtime`의 `rawWord`와 같은 값. coil·discrete_input은 `0`/`1`. `q`가 `bad`·`disabled`이거나 아직 값이 없거나 2워드 이상 레지스터면 `null` |
| `unit` / `access` | 태그 값, 없으면 레지스터에서 상속한 값 |

### POST /api/hmi/write
권한: `ManagerOrAbove`

**요청 바디:**
```json
{ "tag": "LEVEL_SP", "raw": 7500 }
```

- `raw`: 장비에 쓸 **원본 워드**(정수 0–65535). 서버는 배율 계산 없이 그대로 씁니다. 음수는 프론트가 2의 보수로 바꿔 보냅니다(`-5` → `65531`). `POST /api/registers/{id}/write`의 `rawValues`와 같은 규칙
- coil: `raw`는 `0` 또는 `1`
- **설정 태그는 `raw` 대신 `value`**를 보냅니다: `{ "tag": "ALARM_TEMP", "value": 85.5 }`. 장비에 쓰지 않고 장치에 저장하므로 바로 반영됩니다(다음 `values`와 이 태그를 참조하는 계산부터). 처리 순서는 타입 검사 → `decimals`로 반올림 → `min`/`max` 검사 → 저장. 같은 값을 다시 써도 저장합니다. 쓸 때마다 플래시에 한 번 저장하므로 슬라이더 같은 위젯은 손을 뗄 때 한 번만 쓰세요. "초기값으로 되돌리기"는 `initial`을 쓰면 됩니다
- **범위 검사(2026-11-24부터):** 서버가 `raw`를 표시 값으로 바꿔 태그 `min`/`max`와 비교합니다. 태그 값이 비면 레지스터 `minValue`/`maxValue`를 태그 배율로 환산해 씁니다(±1.797e308은 제한 없음). coil·discrete_input은 0/1 검사만 합니다. 프론트 입력 창 검사(`WHMI.raw.limits`)와 같은 규칙이고, 프론트 검사는 편의용으로 남겨 둡니다

**응답** 202: `{ "ok": true, "tag": "LEVEL_SP" }`  
**응답** 200(설정 태그): `{ "ok": true, "tag": "ALARM_TEMP", "value": 85.5 }` — 저장된 값(반올림 뒤)  
**에러** 400: `tag` 없음 / register 태그에 `raw` 없음·`value`를 보냄(예전 `v`만 보내도 400) / 설정 태그에 `value` 없음·`raw`를 보냄 / `raw`가 정수가 아니거나 범위 밖(coil은 0/1 밖)  
**에러** 404: 태그 없음  
**에러** 405: `access: "r"` 태그 쓰기 시도 / **계산 태그** 쓰기 시도  
**에러** 409: 소스 레지스터의 장비가 비활성 `{ "error": "device disabled", "deviceId": 1 }`  
**에러** 422: 소스 레지스터 없음 / 2워드 이상 레지스터 / **표시 값이 허용 범위 밖** / 설정 태그 값의 타입이 틀림·글자 64자 초과·**범위 밖**(같은 모양, `value`는 반올림 뒤 값)
```json
{ "error": "value 17 is outside the allowed range of HMI tag 'PID_INH'", "min": 0, "max": 16, "value": 17 }
```
`min`/`max`는 실제로 비교한 값(제한이 없는 쪽은 `null`), `value`는 `raw`를 바꾼 표시 값입니다.

### POST /api/hmi/eval
권한: `Any`

식을 계산해 결과만 돌려줍니다. 장비에 쓰지 않고, 저장하지 않습니다. 편집기 미리보기와 저장 전 검증에 씁니다.

**요청 바디:**
```json
{
  "valueType": "bool",
  "expr": { "op": "and", "args": [ { "tag": "RUNNING" }, { "op": "eq", "args": [ { "tag": "ALSTS" }, { "value": 0 } ] } ] },
  "inputs": { "NOW_STS": { "raw": 6 }, "RUNNING": { "value": true, "q": "normal" } }
}
```

- `valueType`, `expr` 필수. `expr`은 저장할 때와 같은 검증을 합니다(없는 태그 참조는 422가 아니라 결과 `bad` + `missingRefs`)
- `decimals`(선택, 정수 0–6 또는 `null`): `valueType`이 `number`일 때 결과를 저장된 태그와 같은 방식으로 반올림합니다(저장 전 미리보기용). 다른 `valueType`에서는 무시
- `inputs`(선택): 준 태그는 그 값으로, 주지 않은 태그는 현재 값으로 계산합니다. register 태그는 `raw`(정수 0–65535 또는 `null`), 계산 태그와 설정 태그는 `value`(숫자·글자·true/false·`null`). 설정 태그를 주지 않으면 저장된 현재 값으로 계산합니다(공통 시험 데이터에서는 `initial`). `q`(`good`/`normal`/`bad`/`disabled`)를 함께 주면 그 품질, 없으면 `good`. 이 장치에 없는 태그 id는 무시합니다

**응답** 200:
```json
{
  "value": true,
  "q": "good",
  "inputs": {
    "ALSTS":   { "raw": 0, "value": 0, "q": "good" },
    "NOW_STS": { "raw": 6, "value": 6, "q": "good" },
    "RUNNING": { "value": true, "q": "good" }
  },
  "missingRefs": []
}
```
- `inputs`: 식이 직접 또는 계산 태그를 거쳐 참조한 **모든 태그**의 실제 사용 값. register 태그는 `raw`와 표시 값 `value`, 계산 태그는 `value`. `inputs`로 값을 준 계산 태그는 그 아래를 계산하지 않으므로 그 아래 태그는 나오지 않습니다
- `missingRefs`: 참조했는데 없는 태그 id(`inputs`에도 `{ "value": null, "q": "bad" }`로 나옴)

**에러** 400: JSON 아님 / `valueType` 오류 / `expr` 없음 / `inputs` 형식 오류(register 태그에 `raw` 없음 등)  
**에러** 422: 식 검증 실패(`path` 포함, 태그 저장과 같은 형식) / `number`인데 `decimals`가 정수 0–6·`null`이 아님(`path` 없음)

---

### HMI 프로젝트 / 화면

디바이스당 프로젝트 1개, 그 아래 화면 여러 개. 화면 `content`는 백엔드가 해석하지 않고 저장·반환만 합니다.

**공통 규칙**
- 화면 `id`: `^[A-Za-z0-9_-]{1,64}$`
- `title`: 최대 64자
- `content`: JSON 객체, `content.format == "whmi.screen"` 필수 (그 외 구조는 검사 안 함)
- `content` 크기: 직렬화 기준 최대 256KB (262144 bytes), 초과 시 413
- 화면 개수: 최대 `config.json`의 `hmi.maxScreens` (기본 50)
- `updatedAt`: ISO-8601 로컬 시각, 타임존 없음 (`2026-10-15T11:20:00`)
- `updatedBy`: 요청한 사용자 이름 (서버가 채움)
- `content`는 재직렬화 저장: 배열 순서·숫자 값은 그대로 보존, 객체 키 순서·공백은 바뀔 수 있음

**revision (낙관적 잠금)**
- 화면 revision: 화면 저장(PUT) 시 +1
- 프로젝트 revision: 이름·시작 화면·순서 변경(PUT project), 화면 생성(POST), 화면 삭제(DELETE) 시 +1
- 화면 제목만 바꿔도 프로젝트 revision은 바뀌지 않음 (제목의 원본은 화면 쪽)

**startScreen 규칙**
- 화면이 0개일 때만 `null`, 1개 이상이면 반드시 존재하는 화면
- 첫 화면 생성 시 자동 지정, 마지막 화면 삭제 시 자동으로 `null`

### GET /api/hmi/project
권한: `Any`

**응답** 200
```json
{
  "name": "냉동 설비 통합 모니터링",
  "startScreen": "main",
  "screens": [
    { "id": "main",    "title": "냉동 설비 통합 모니터링", "revision": 3, "updatedAt": "2026-10-15T10:00:00", "updatedBy": "admin" },
    { "id": "chiller", "title": "메인칠러 모니터링",       "revision": 7, "updatedAt": "2026-10-15T11:20:00", "updatedBy": "manager1" }
  ],
  "revision": 2,
  "pollMs": 1000
}
```
`screens` 배열 순서 = 화면 목록 표시 순서.  
화면이 없으면 `{ "name": "", "startScreen": null, "screens": [], "revision": <n>, "pollMs": 1000 }`  
`pollMs`: HMI 실행 화면의 값 갱신 주기(ms). 정수 500–10000, 기본 1000. 서버는 저장만 합니다.

### PUT /api/hmi/project
권한: `ManagerOrAbove`

**요청 바디** (`revision` 필수, 나머지는 바꿀 것만)
```json
{ "name": "냉동 설비 통합 모니터링", "startScreen": "chiller", "order": ["chiller", "main"], "pollMs": 2000, "revision": 2 }
```

**응답** 200: `{ "ok": true, "revision": 3, "pollMs": 2000 }`  
**에러** 400: `revision` 누락 / `startScreen`이 없는 화면 / 화면이 있는데 `startScreen: null` / `order`가 현재 화면 id를 빠짐없이·중복 없이 담지 않음 / `pollMs`가 정수 500–10000이 아님  
**에러** 409: `{ "error": "revision mismatch", "revision": 4 }`

### GET /api/hmi/screens/{id}
권한: `Any`

**응답** 200
```json
{
  "id": "chiller",
  "title": "메인칠러 모니터링",
  "revision": 7,
  "updatedAt": "2026-10-15T11:20:00",
  "updatedBy": "manager1",
  "content": { "format": "whmi.screen", "version": "0.1", "size": { "w": 1280, "h": 720 }, "widgets": [] }
}
```
**에러** 404: 화면 없음

### POST /api/hmi/screens
권한: `ManagerOrAbove`

**요청 바디**
```json
{ "id": "boiler", "title": "보일러", "content": { "format": "whmi.screen", "version": "0.1", "size": { "w": 1280, "h": 720 }, "widgets": [] } }
```
프로젝트 `screens` 맨 뒤에 추가. 첫 화면이면 `startScreen`으로 지정.

**응답** 201
```json
{ "ok": true, "id": "boiler", "revision": 1, "projectRevision": 3, "startScreen": "main" }
```
**에러** 400: id 형식 / title 길이 / content 오류  
**에러** 409: id 중복 `{ "error": "Screen already exists: boiler" }`  
**에러** 409: 개수 초과 `{ "error": "too many screens", "maxScreens": 50 }`  
**에러** 413: content 크기 초과

### PUT /api/hmi/screens/{id}
권한: `ManagerOrAbove`

**요청 바디** (`title` 생략 가능, `content`·`revision` 필수)
```json
{ "title": "메인칠러 모니터링", "content": { "format": "whmi.screen", "widgets": [] }, "revision": 7 }
```

**응답** 200: `{ "ok": true, "revision": 8, "updatedAt": "2026-10-15T11:25:00" }`  
**에러** 409: `{ "error": "revision mismatch", "revision": 9, "updatedAt": "2026-10-15T11:24:00", "updatedBy": "manager1" }`  
**에러** 400: `revision` 누락 / title 길이 / content 오류  
**에러** 404: 화면 없음  
**에러** 413: content 크기 초과

### DELETE /api/hmi/screens/{id}
권한: `ManagerOrAbove`

프로젝트 `screens`에서도 제거.

**응답** 200: `{ "ok": true, "projectRevision": 4, "startScreen": "main" }`  
(마지막 화면 삭제 시 `"startScreen": null`)  
**에러** 409: 다른 화면이 남아 있는데 시작 화면 삭제 시도 `{ "error": "start screen" }`  
**에러** 404: 화면 없음

### HMI 내보내기 / 불러오기

HMI(프로젝트·화면·태그)만 파일로 저장하고 불러옵니다. 시스템 백업·복원과 달리 **재시작하지 않고** 폴링도 멈추지 않습니다. 불러오기는 **항상 전체 교체**입니다. 시스템 백업은 지금처럼 HMI를 포함합니다.

검증과 적용 모두 **파일 전체를 요청 바디로** 보냅니다. 서버는 두 호출 사이에 아무것도 보관하지 않고, 적용할 때 다시 검사합니다.

#### 파일 형식

```json
{
  "format": "swr.hmi",
  "schemaVersion": 1,
  "fileInfo": { "product": "SmartRoute", "createdAt": "2026-11-20T14:00:00", "createdBy": "admin",
                "hostname": "smartroute", "version": "1", "revision": "0" },
  "hmi": {
    "project": { "name": "...", "startScreen": "main", "revision": 7, "pollMs": 1000 },
    "screens": [ { "id": "main", "title": "...", "revision": 3, "updatedAt": "...", "updatedBy": "...", "content": { "format": "whmi.screen" } } ],
    "tags":    [ { "id": "TEMI2KMF_NPV", "name": "...", "kind": "register", "unifiedAddress": 32, "scale": 0.01, "unit": "°C", "minValue": 0, "maxValue": 100, "access": "rw" },
                 { "id": "RUNNING", "name": "운전중", "kind": "expr", "valueType": "bool",
                   "expr": { "op": "bitAny", "args": [ { "tag": "NOW_STS" }, { "value": [0] } ] } } ]
  }
}
```

- `hmi`는 시스템 백업의 `hmi.json`과 같은 내용입니다. register 태그는 `unifiedAddress`로 레지스터를 가리킵니다. 값이 없는(상속하는) `scale`·`unit`·`minValue`·`maxValue`·`access`는 키가 없습니다.
- 계산 태그는 `kind: "expr"`, `valueType`, `expr`, (있으면) `unit`·`decimals`를 가집니다(`decimals`는 숫자 계산 태그에 값이 있을 때만 키가 있음).
- 설정 태그는 `kind: "param"`, `valueType`, `initial`, **현재 값 `value`**, (있으면) `unit`·`minValue`·`maxValue`·`decimals`를 가집니다. 예: `{ "id": "ALARM_TEMP", "name": "...", "kind": "param", "valueType": "number", "initial": 80, "value": 85.5, "unit": "°C", "minValue": 0, "maxValue": 150, "decimals": 1 }`. 넣는 순서는 register → param → expr입니다. 정의가 잘못되면 불러오기는 400, 시스템 복원은 그 태그만 건너뛰고 경고. `value`만 없거나 잘못되면(타입·범위) `initial`로 넣고 경고를 남깁니다 `schemaVersion`은 1 그대로입니다. 계산 태그 이전 펌웨어는 이 태그를 `unifiedAddress`가 없다고 보고 건너뜁니다.
- `kind`가 없는 태그는 register 태그로 읽습니다. 이 장치가 모르는 `kind`는 건너뛰고 경고에 넣습니다.
- 불러오기는 **머리 없는 시스템 백업 `hmi.json`**도 받습니다(`format`이 없고 `project`·`screens`·`tags` 중 하나가 있으면).
- 예전 파일: 태그 `decimals`는 무시하고, `scale`이 없거나 허용 값이 아니면 상속합니다. `pollMs`가 없으면 1000입니다.

### GET /api/hmi/export
권한: `ManagerOrAbove`

위 형식의 JSON 파일을 내려 줍니다.  
`Content-Disposition: attachment; filename="swr_hmi_<hostname>_YYYYMMdd_HHmmss.json"` (호스트 이름의 영문·숫자·`_`·`-` 외 문자는 `_`)  
시스템 로그 INFO `HMI exported by <user>: N screen(s), M tag(s), B bytes`

### POST /api/hmi/import/validate
권한: `ManagerOrAbove`  
요청 바디: 파일 전체 (`Content-Type: application/json`). 아무것도 바꾸지 않습니다.

**응답** 200
```json
{
  "fileInfo": { "product": "SmartRoute", "createdAt": "...", "createdBy": "admin", "hostname": "smartroute", "version": "1", "revision": "0" },
  "project": { "name": "냉동 설비 통합 모니터링", "startScreen": "main", "pollMs": 1000 },
  "screens": 3,
  "tags": { "total": 28, "linked": 22, "missing": [ { "id": "TEMI2KMF_NPV", "unifiedAddress": 32 } ],
            "expr": 5, "param": 1, "brokenExpr": [ { "id": "RUNNING", "missingRefs": ["TEMI2KMF_NPV"] } ] },
  "current": { "screens": 2, "tags": 20 },
  "warnings": []
}
```
- `fileInfo`: 파일에 적힌 그대로. 머리 없는 `hmi.json`이면 `null`
- `tags.total`: 파일의 태그 수(모든 종류). `tags.linked`: 레지스터에 연결되는 **register 태그** 수
- `tags.missing`: 이 장치에 레지스터가 없어 **적용 때 건너뛸** register 태그(`unifiedAddress`가 없으면 `null`)
- `tags.expr`: 파일의 계산 태그 수. `tags.param`: 파일의 설정 태그 수. `tags.brokenExpr`: 적용 뒤 참조가 끊길 계산 태그와 끊길 태그 id(건너뛸 register 태그나 파일에 없는 태그를 참조). 이 태그들도 들어가지만 값은 `bad`입니다
- `current`: 지금 장치의 화면·태그 수(교체될 대상)
- `warnings`: 예) 시작 화면이 파일에 없음 → 첫 화면을 시작 화면으로 씀

**에러**

| 상태 | 경우 |
|---|---|
| 400 | JSON 객체가 아님 / `format`이 `swr.hmi`가 아님 / `schemaVersion` > 1 / HMI 파일이 아님 / `project`·`screens`·`tags` 형식 오류 / 화면·태그 id 규칙(영문·숫자·`_`·`-` 1–64자) 위반 또는 중복 / 화면 `title` 64자 초과 / 화면 `content.format`이 `whmi.screen`이 아님 / 태그 `access`가 `r`·`rw`가 아님 / `pollMs`가 정수 500–10000이 아님 / 계산 태그의 `valueType`·`expr` 오류(`"tag 'X': ... (at 'args[0]')"`) / 숫자 계산 태그의 `decimals`가 정수 0–6이 아님 / 설정 태그의 정의 오류(`valueType`, `initial`, `minValue`·`maxValue`, `decimals`) / 계산 태그 순환 참조·깊이 초과(**파일 전체 거부**) / 태그 1,000개 초과 |
| 413 | 화면 하나의 `content`가 256KB 초과 |
| 409 | 화면 수 > `hmi.maxScreens` (`{ "error": "too many screens: 51 (maxScreens 50)", "maxScreens": 50 }`) |

에러 메시지에 화면·태그 id가 들어갑니다. 예: `{ "error": "screen 'main': 'content.format' must be \"whmi.screen\"" }`

### POST /api/hmi/import/apply
권한: `ManagerOrAbove`  
요청 바디: validate와 **같은 파일 전체**

같은 검사를 다시 한 뒤 HMI 프로젝트·화면·태그를 한 번에 교체합니다(실패하면 아무것도 바뀌지 않음). `missing` 태그는 건너뜁니다. register 태그를 먼저, 계산 태그를 나중에 넣습니다.

- **revision:** 프로젝트와 모든 화면이 지금 장치의 어떤 revision보다 1 큰 값을 받습니다. 불러오기 전에 열어 둔 화면·프로젝트를 저장하면 409입니다. 파일의 revision은 쓰지 않습니다.
- 화면 `updatedAt`·`updatedBy`는 파일 값 그대로입니다.
- 시스템 로그: INFO `HMI imported by <user>: N screen(s), M tag(s) — previous HMI replaced`, 건너뛴 태그가 있으면 WARN `HMI import skipped K tag(s) with no register on this device: id, ...`

**응답** 200
```json
{ "ok": true, "screens": 3, "tags": 25, "skippedTags": ["TEMI2KMF_NPV"], "revision": 8,
  "warnings": ["1 computed HMI tag(s) refer to tags that are not present (their value is bad until fixed): RUNNING (missing: TEMI2KMF_NPV)"] }
```
`tags`: 실제로 들어간 태그 수(모든 종류). `revision`: 새 프로젝트 revision(화면 revision도 같음). `warnings`(2026-11-24 추가): 건너뛴 태그, 모르는 `kind`, 참조가 끊긴 계산 태그. **에러**: validate와 같음

> 장치 실측(2026-11-20, 화면 50개 × 약 250KB = 12.5MB): 검증 약 3초, 적용 약 4.5초, 내보내기 약 4.5초. 업로드 중 진행 표시를 권합니다.

---

## 15. 유지보수

### GET /api/maintenance/backup
권한: `AdminOnly`

Content-Type: `application/zip`  
Content-Disposition: `attachment; filename="swr_backup_YYYYMMdd_HHmmss.zip"`

**Response**: 설정 백업 ZIP 파일 (binary)

> 포함 내용: 장비, 레지스터, 사용자, 시스템 설정 (config.json), HMI 프로젝트·화면·태그 (hmi.json)  
> 이더넷 포트 주소는 OS 이미지가 고정하므로 백업에 넣지 않습니다(2026-11-13부터). 예전 백업의 `config.json`에 있는 `network`는 복원할 때 무시합니다.
>
> `hmi.json`의 태그는 `registerId` 대신 `unifiedAddress`로 레지스터를 가리킵니다. 레지스터 id는 복원 시 새로 부여되므로, 복원 시 `unifiedAddress`로 현재 레지스터를 다시 찾아 연결합니다.
> 태그의 배율은 `scale`로 저장됩니다(상속이면 생략). 2026-11-13 이전 백업의 `decimals`는 복원 때 무시되고 `scale`은 상속(`null`)이 됩니다.

---

### POST /api/maintenance/restore/validate
권한: `AdminOnly`

**Request Body**: ZIP 파일 binary (`Content-Type: application/octet-stream`)

**Response 200**
```json
{
  "restoreId": "uuid-string",
  "backupInfo": {
    "product": "SmartRoute",
    "createdAt": "2026-10-13T12:00:00",
    "hostname": "smartroute",
    "version": "1",
    "revision": "0",
    "zcode": "0",
    "schemaVersion": 1
  },
  "config":    { "available": true, "count": 1,  "warning": "" },
  "devices":   { "available": true, "count": 3,  "warning": "" },
  "registers": { "available": true, "count": 24, "warning": "" },
  "users":     { "available": true, "count": 2,  "warning": "" },
  "hmi":       { "available": true, "count": 2,  "warning": "Existing HMI screens and tags will be replaced (2 screen(s), 28 tag(s))" },
  "warnings":  [
    "Restoring HMI without registers will drop HMI tags whose unifiedAddress does not exist on this device"
  ]
}
```

> `hmi.count`는 화면 개수. HMI 태그가 있는 백업이면 `warnings`에 레지스터 의존 경고가 포함됩니다 (`options.hmi: true` + `options.registers: false` 조합 시 프론트가 표시).

**에러** 422: 파일 무결성 검증 실패

---

### POST /api/maintenance/restore/apply
권한: `AdminOnly` | 폴링 중 409

**Request Body**
```json
{
  "restoreId": "validate에서 받은 uuid",
  "options": {
    "config":    true,
    "devices":   true,
    "registers": true,
    "users":     true,
    "hmi":       true
  }
}
```

> `network` 옵션은 폐지되었습니다(2026-11-13). 보내도 무시합니다. 포트 주소는 OS 이미지가 고정합니다.  
> `hmi` 기본값 `true`. HMI 복원은 병합이 아닌 **전체 교체** (기존 프로젝트·화면·태그 삭제 후 백업 내용으로 대체). 현재 장치에 해당 `unifiedAddress` 레지스터가 없는 태그는 건너뜁니다.  
> `devices: true` + `hmi: false`이면 HMI 프로젝트·화면은 그대로 두고, **기존 HMI 태그는 `unifiedAddress`로 새로 만들어진 레지스터에 다시 연결**합니다. 백업에 없는 레지스터를 가리키던 태그는 삭제되며, 삭제된 태그 id는 시스템 로그(warning)에 기록됩니다.

**Response 200**
```json
{ "ok": true, "restartRequired": true }
```

---

### POST /api/maintenance/factory-reset
권한: `AdminOnly` | 폴링 중 409

DB(장비/레지스터/사용자/HMI 프로젝트·화면·태그) 전체 삭제, 설정 파일 초기화, 로그 전체 삭제, admin 비밀번호 초기화를 수행합니다.

**Response 200**
```json
{ "ok": true, "restartRequired": true }
```
