# SmartRoute REST API 명세

> 최종 수정: 2026-11-13 (HMI 값·쓰기를 원본(raw)으로, 태그 `decimals` → `scale`)  
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
  "realtimeRegisters": [ /* 최대 20개, GET /api/registers/realtime 항목과 동일 */ ],
  "alerts": [
    { "id": 10, "timestamp": "2026-10-13T12:00:00", "level": "WARN", "message": "..." }
  ],
  "logs": [
    { "id": 9, "timestamp": "2026-10-13T12:00:00", "level": "INFO", "message": "..." }
  ]
}
```

> `state`: `"ok"` | `"error"` | `"unknown"`

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
      "scaledValue": 25.3,
      "minValue": -50.0,
      "maxValue": 150.0,
      "scale": 0.1,
      "rawWord": 253,
      "bitLabels": "",
      "readOnly": false,
      "isValid": true,
      "outOfRange": false,
      "quality": "good",
      "lastUpdated": "2026-10-13T12:00:00Z",
      "errorMessage": ""
    }
  ]
}
```

> `quality`: `"good"` | `"normal"` | `"bad"`

---

## 6. 로그

### GET /api/logs
권한: `Any`

**Query Parameters** (모두 선택)

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `limit` | int | 설정값 | 최대 조회 건수 |
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

### 데이터 모델

```json
{
  "id": "TK1_LEVEL",
  "name": "1번 탱크 수위",
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
- 소스 레지스터를 삭제하면 그 HMI 태그도 **함께 삭제**됨 (장비 삭제 시 그 장비의 태그도 모두 삭제)
- **원본 데이터 원칙:** 서버는 태그의 `scale`·`min`·`max`를 **저장하고 돌려주기만** 하고, 계산에 쓰지 않습니다. 배율 적용(값 = 원본 × 배율)과 역변환은 프론트가 합니다.
- `scale`: `null`이면 레지스터 `scale` 상속. 허용 값은 `100`, `10`, `1`, `0.1`, `0.01`, `0.001`, 그 밖의 값은 400. 레지스터 설정과 무관하게 **원본값 기준**입니다(원본 1234, 태그 `scale` 0.01 → 12.34)
- `min` / `max`: 태그 배율을 적용한 값 기준. `null`일 때 레지스터 값을 환산해 물려받는 것은 프론트가 합니다
- `unit` / `access`: 생략(null) 시 소스 레지스터 값 상속(`values` 응답에는 상속을 적용한 값이 나감)
- `decimals`는 2026-11-13에 폐지. 요청에 들어와도 무시하고 응답에 없음
- `access`: `"r"` | `"rw"` — 레지스터 `readOnly` 상속 또는 오버라이드
- `id` 허용 문자: 영숫자 + `_` + `-`, 최대 64자

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
`id / name / source.registerId` 필수, 나머지 선택. `source`의 응답 전용 필드가 들어와도 무시

**응답** 201: 생성된 HmiTag 객체  
**에러** 400: 유효하지 않은 id 형식 / registerId 없음 / access 값 오류 / scale 값 오류  
**에러** 409: id 중복

### GET /api/hmi/tags/{id}
권한: `Any`

**응답** 200: HmiTag 객체  
**에러** 404

### PUT /api/hmi/tags/{id}
권한: `ManagerOrAbove`

요청 바디: POST와 동일 (`id`는 URL에서 받음)

**응답** 200: 수정된 HmiTag 객체  
**에러** 404

### DELETE /api/hmi/tags/{id}
권한: `ManagerOrAbove`

**응답** 200: `{ "ok": true }`  
**에러** 404

### GET /api/hmi/values?tags=A,B
권한: `Any`

`tags` 쿼리 파라미터 생략 시 전체 태그 반환

**응답** 200:
```json
{
  "ts": "2026-10-14T02:26:05Z",
  "values": {
    "TK1_LEVEL": {
      "raw": 569,
      "q": "good",
      "unit": "%",
      "access": "r",
      "v": 56.9,
      "decimals": 1
    }
  }
}
```

| `q` 값 | 의미 |
|--------|------|
| `"good"` | 마지막 폴링 경과 < 1.5× interval |
| `"normal"` | 1.5× ~ 3× interval (응답 지연) |
| `"bad"` | 3× 초과 또는 응답 없음 |
| `"disabled"` | 소스 레지스터의 장비가 비활성 (`v`는 `null`) |

| 필드 | 설명 |
|---|---|
| `raw` | 장비에서 읽은 **원본 워드 그대로**(uint16, 0–65535). 부호 해석·배율 적용 없음. `registers/realtime`의 `rawWord`와 같은 값. coil·discrete_input은 `0`/`1`. `q`가 `bad`·`disabled`이거나 아직 값이 없거나 2워드 이상 레지스터면 `null` |
| `unit` / `access` | 태그 값, 없으면 레지스터에서 상속한 값 |
| `v` / `decimals` | **전환 기간 전용, 곧 폐지.** `v`는 레지스터 배율을 적용하고 레지스터 `minValue`/`maxValue`로 자른 값(태그 `scale`과 무관). `decimals`는 태그 `scale`(없으면 레지스터 `scale`)의 소수 자릿수 |

### POST /api/hmi/write
권한: `ManagerOrAbove`

**요청 바디:**
```json
{ "tag": "LEVEL_SP", "raw": 7500 }
```

- `raw`: 장비에 쓸 **원본 워드**(정수 0–65535). 서버는 배율 계산 없이 그대로 씁니다. 음수는 프론트가 2의 보수로 바꿔 보냅니다(`-5` → `65531`). `POST /api/registers/{id}/write`의 `rawValues`와 같은 규칙
- coil: `raw`는 `0` 또는 `1`
- 서버는 태그 `min`/`max`로 범위를 검사하지 않습니다(프론트 입력 창에서 검사)
- **전환 기간 전용, 곧 폐지:** `raw` 대신 `{ "tag": ..., "v": 75.0 }`도 받습니다. 서버가 `round(v / 레지스터 scale)`로 변환합니다. `raw`와 `v`가 함께 오면 `raw`를 씁니다

**응답** 202: `{ "ok": true, "tag": "LEVEL_SP" }`  
**에러** 400: `tag`·`raw` 없음 / `raw`가 정수가 아니거나 범위 밖(coil은 0/1 밖)  
**에러** 404: 태그 없음  
**에러** 405: `access: "r"` 태그 쓰기 시도  
**에러** 409: 소스 레지스터의 장비가 비활성 `{ "error": "device disabled", "deviceId": 1 }`  
**에러** 422: 소스 레지스터 없음 / 2워드 이상 레지스터

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
  "revision": 2
}
```
`screens` 배열 순서 = 화면 목록 표시 순서.  
화면이 없으면 `{ "name": "", "startScreen": null, "screens": [], "revision": <n> }`

### PUT /api/hmi/project
권한: `ManagerOrAbove`

**요청 바디** (`revision` 필수, 나머지는 바꿀 것만)
```json
{ "name": "냉동 설비 통합 모니터링", "startScreen": "chiller", "order": ["chiller", "main"], "revision": 2 }
```

**응답** 200: `{ "ok": true, "revision": 3 }`  
**에러** 400: `revision` 누락 / `startScreen`이 없는 화면 / 화면이 있는데 `startScreen: null` / `order`가 현재 화면 id를 빠짐없이·중복 없이 담지 않음  
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
