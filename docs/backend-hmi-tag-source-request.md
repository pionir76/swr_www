# HMI 태그 소스 정보 확장 — 백엔드 API 요청서

> 작성: 2026-10-19 (프론트엔드)
> 대상: SmartRoute 백엔드(swr)
> 관련 명세: `referencs/api-spec.md` §4 장비, §5 레지스터, §14 HMI

---

## 1. 배경과 목적

HMI 태그 응답에는 소스 레지스터 번호(`source.registerId`)만 있어서, 프론트엔드는 태그가 **어느 장비의 어느 레지스터인지** 알 수 없습니다. 이 정보가 필요한 기능이 두 가지입니다.

| 기능 | 내용 | 시점 |
|---|---|---|
| 태그 선택 개선 | HMI 편집기에서 태그를 **장비 선택 → 태그 선택** 2단계로 고릅니다. 지금은 태그 전체가 한 목록이라 태그가 많아지면 찾기 어렵습니다 | 바로 |
| "태그 보기" | HMI 화면에서 "태그 보기"를 켜면 각 위젯 왼쪽 위에 **장비명 · 태그명 · 통합주소**를 표시합니다. 현장 점검과 배선 확인용입니다 | 다음 |

지금은 장비 정보를 얻으려면 장비 목록과 **장비별 레지스터 목록을 모두** 받아 프론트에서 연결해야 합니다. 이렇게 하면 요청이 장비 수만큼 늘고, 같은 연결 코드를 여러 화면이 각자 갖게 됩니다. 서버가 태그 응답에 소스 정보를 함께 내려 주면, 편집기와 HMI 화면은 태그 목록 한 번만 받으면 됩니다.

---

## 2. 요청 사항

### 2.1 HmiTag 응답의 `source`에 읽기 전용 필드 추가

대상 응답은 HmiTag 객체를 돌려주는 모든 곳입니다.
- `GET /api/hmi/tags`
- `GET /api/hmi/tags/{id}`
- `POST /api/hmi/tags`
- `PUT /api/hmi/tags/{id}`

```json
{
  "id": "MAIN_TEMP",
  "name": "현재 메인룸 온도",
  "source": {
    "registerId": 70,

    "deviceId": 3,
    "deviceCode": "DEV03",
    "deviceName": "메인챔버 온습도조절기",
    "registerTagName": "NPV",
    "registerDisplayName": "현재 메인룸 온도",
    "localAddress": 100,
    "unifiedAddress": 1012
  },
  "unit": null, "min": 0, "max": 100, "decimals": null, "access": null,
  "createdAt": "…", "updatedAt": "…"
}
```

| 필드 | 출처 | 쓰는 곳 |
|---|---|---|
| `deviceId` | 레지스터가 속한 장비 id | 장비별 태그 묶기(2단계 선택) |
| `deviceCode` | 장비 `deviceCode` | 태그 관리의 TAG ID 제안("장비 코드_레지스터 이름") |
| `deviceName` | 장비 `name` | 2단계 선택의 장비 목록, "태그 보기"의 장비명 |
| `registerTagName` | 레지스터 `tagName` | "태그 보기"의 태그명, 태그 관리 목록의 소스 표시 |
| `registerDisplayName` | 레지스터 `displayName` | 태그 관리 목록·폼의 소스 표시 |
| `localAddress` | 레지스터 `localAddress`(장비 안 주소) | "태그 보기"에서 장비 쪽 주소 확인(배선·통신 점검) |
| `unifiedAddress` | 레지스터 `unifiedAddress` | "태그 보기"의 통합주소 |

### 2.2 규칙

| 항목 | 요청 |
|---|---|
| 저장 방식 | 태그에 **저장하지 않고**, 응답할 때 레지스터·장비에서 가져와 채워 주세요. 장비나 레지스터 이름을 바꾸면 다음 응답에 바로 반영되어야 합니다 |
| 읽기 전용 | POST/PUT 요청 바디는 **지금과 같습니다**(`source.registerId`만 받음). 바디에 위 필드가 들어 와도 무시해 주세요. 프론트가 받은 객체를 그대로 고쳐 보내는 경우를 위해서입니다 |
| 소스 레지스터가 없을 때 | 레지스터가 삭제되어 찾을 수 없으면 `registerId`는 그대로 두고, 추가 필드는 모두 `null`로 주세요(필드 자체는 빠뜨리지 말아 주세요) |
| 장비 비활성 | 비활성 장비의 태그도 똑같이 채워 주세요. 비활성 여부는 값 응답의 `q: "disabled"`와 `/api/devices`의 `enabled`로 이미 알 수 있습니다 |
| 백업·복원 | 백업 `hmi.json` 형식은 바꾸지 않아도 됩니다(태그는 이미 `unifiedAddress`로 레지스터를 가리킴) |

### 2.3 바꾸지 않아도 되는 것

- `GET /api/hmi/values` — 변경 없음
- 태그 목록 필터(`?deviceId=` 등) — 필요 없습니다. 프론트에서 묶습니다(태그 수백 개 수준).

---

## 3. 확인 부탁드릴 점

1. 소스 레지스터가 삭제되면 현재 HMI 태그는 어떻게 되나요? (함께 삭제 / 태그는 남고 소스만 끊김) 남는 경우 2.2의 `null` 규칙으로 응답해 주시면 됩니다.
2. 필드 이름(`registerTagName`, `registerDisplayName` 등)에 다른 의견이 있으면 알려 주세요. 반영 후 `api-spec.md` §14의 HmiTag 정의에 추가해 주세요.

---

## 4. 반영 후 프론트엔드 작업 (참고)

- 편집기 속성 창과 쓰기 허용 조건의 태그 선택을 **장비 → 태그** 2단계로 변경
- 태그 관리 대화상자의 소스 표시는 태그 응답의 `source` 사용(점검 규칙·새 태그 폼·여러 개 만들기는 지금처럼 레지스터 목록 조회)
- 이후 "태그 보기" 표시 기능에 `deviceName` · `registerTagName` · `unifiedAddress` 사용
