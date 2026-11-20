---
from: frontend
to: backend
status: done
waiting_on: none
reply: docs/backend-hmi-export-import-response.md
---

# HMI 작화 데이터 내보내기·불러오기 (시스템 백업에서 분리) — 백엔드 API 요청서

> 작성: 2026-11-20 (프론트엔드)
> 대상: SmartRoute 백엔드(swr)
> 관련 명세: `referencs/api-spec.md` §14 HMI, §15 유지보수(백업·복원)

---

## 1. 배경과 목적

지금 HMI 작화 데이터(프로젝트·화면·태그)는 **시스템 백업·복원**으로만 저장하고 되돌릴 수 있습니다. 이 방식에는 불편한 점이 있습니다.

- HMI만 저장하려 해도 장비·사용자 설정까지 든 시스템 백업 파일을 받아야 합니다.
- 복원하면 장치가 재시작되어 폴링이 끊깁니다.
- 시스템 백업·복원은 관리자 전용이라, 화면을 만드는 Manager의 작업 흐름과 떨어져 있습니다.

설정 페이지에 **"HMI" 탭**을 새로 만들어 HMI 설정과 HMI 전용 내보내기·불러오기를 한곳에서 관리하려고 합니다. 다음 세 가지 용도입니다.

- 작업본 보관
- 같은 기종 장비로 화면 복사
- 운전 중 화면 교체

**확정된 정책**

| 항목 | 정책 |
|---|---|
| 불러오기 방식 | **무조건 전체 교체.** 화면 단위 선택이나 병합은 하지 않습니다(단순화) |
| 권한 | 내보내기·불러오기 모두 **ManagerOrAbove**(화면 저장 권한과 같음) |
| 재시작 | **하지 않습니다.** 폴링은 계속됩니다 |
| 시스템 백업 | **그대로 HMI를 포함합니다.** 시스템 백업·복원은 바꾸지 않습니다 |

---

## 2. 요청 사항

### 2.1 `GET /api/hmi/export` — HMI 전용 파일 내보내기

- 권한: `ManagerOrAbove`
- `Content-Type: application/json`
- `Content-Disposition: attachment; filename="swr_hmi_<hostname>_YYYYMMdd_HHmmss.json"`
- 내용: 시스템 백업의 `hmi.json`과 **같은 형식**(프로젝트·화면·태그, 태그는 `unifiedAddress`로 레지스터를 가리킴, 배율은 `scale`)에 파일 정보 머리를 붙여 주세요. 복원 코드와 같은 해석을 쓰기 위해서입니다.

```json
{
  "format": "swr.hmi",
  "schemaVersion": 1,
  "fileInfo": { "product": "SmartRoute", "createdAt": "2026-11-20T10:00:00", "createdBy": "admin",
                "hostname": "smartroute", "version": "1", "revision": "0" },
  "hmi": { "...": "시스템 백업 hmi.json과 같은 내용" }
}
```

### 2.2 `POST /api/hmi/import/validate` — 불러오기 전 검증

- 권한: `ManagerOrAbove`
- 요청 바디: 위 JSON 파일 그대로(`Content-Type: application/json`)
- 바꾸지 않고 검사만 합니다. 결과로 `importId`를 주세요(시스템 복원의 `restoreId`와 같은 방식, 일정 시간 뒤 만료).

**응답 200**

```json
{
  "importId": "uuid-string",
  "fileInfo": { "createdAt": "2026-11-20T10:00:00", "createdBy": "admin", "hostname": "smartroute", "version": "1" },
  "project": { "name": "냉동 설비 통합 모니터링", "startScreen": "main" },
  "screens": 3,
  "tags": {
    "total": 28,
    "linked": 25,
    "missing": [ { "id": "TEMI2KMF_NPV", "unifiedAddress": 32 } ]
  },
  "current": { "screens": 2, "tags": 20 },
  "warnings": []
}
```

| 필드 | 뜻 |
|---|---|
| `tags.linked` | 이 장치에서 `unifiedAddress`로 레지스터를 찾은 태그 수 |
| `tags.missing` | 레지스터가 없어 **적용 때 건너뛸** 태그 목록. 다른 장비로 옮길 때 가장 중요한 정보입니다 |
| `current` | 지금 장치의 화면·태그 수. "이것이 교체됩니다" 안내에 씁니다 |

**에러**
- 400: JSON이 아님, `format`이 `swr.hmi`가 아님, 구조 오류(화면 `content.format` 등 화면 저장 규칙 위반 포함)
- 413: 크기 초과
- 409: 화면 수가 `hmi.maxScreens` 초과

### 2.3 `POST /api/hmi/import/apply` — 적용(전체 교체)

- 권한: `ManagerOrAbove`
- 요청 바디: `{ "importId": "uuid-string" }`
- 동작: 시스템 복원의 HMI 전체 교체와 같습니다(기존 프로젝트·화면·태그 삭제 후 파일 내용으로 대체, `missing` 태그는 건너뜀). **재시작 없이** 바로 반영하고, 폴링은 멈추지 않습니다.
- **revision:** 프로젝트·화면 revision이 바뀌어야 합니다. 그래야 다른 사람이 편집 중이면 저장할 때 409로 충돌을 알 수 있습니다.
- **로그:** 누가 불러왔는지 시스템 로그(INFO)에 남기고, 건너뛴 태그 id는 warning으로 남겨 주세요.

**응답 200**
```json
{ "ok": true, "screens": 3, "tags": 25, "skippedTags": ["TEMI2KMF_NPV"] }
```

**에러**
- 404: `importId` 없음 또는 만료
- 400: 그 사이 레지스터가 바뀌어 검증 결과와 달라졌다면, 다시 검증하라는 뜻으로 알려 주세요(선택)

### 2.4 HMI 값 갱신 주기 설정

HMI 실행 화면의 값 갱신 주기는 지금 정적 파일(`hmi-project/project.json`의 `pollMs: 1000`)에 고정되어 있습니다. 장비 부하나 반응 속도에 맞게 바꿀 수 있도록 HMI 프로젝트 설정으로 옮겨 주세요.

- `GET /api/hmi/project` 응답과 `PUT /api/hmi/project` 요청에 `pollMs` 추가
  - 정수, 범위 500–10000, 기본 1000, 범위 밖이면 400
  - 백엔드는 **저장만** 합니다
- 내보내기 파일과 시스템 백업의 HMI 내용에도 포함해 주세요(불러오기·복원 때 함께 적용).

---

## 3. 바꾸지 않는 것

- 시스템 백업·복원(`/api/maintenance/*`): 그대로입니다. HMI 포함, 관리자 전용, 재시작.
- 화면·태그 API(§14): 그대로입니다.

## 4. 확인 부탁드릴 점

1. 화면 내용에 그림(data URL)이 들어가면 파일이 커질 수 있습니다. 화면당 256KB × 최대 50개 = 약 13MB입니다. 업로드 크기 제한이 이 범위를 받을 수 있나요?
2. 2026-11-13 이전 형식의 태그(`decimals`)가 든 파일을 불러올 때도 시스템 복원과 같이 `decimals`를 무시하고 `scale`은 상속으로 처리해 주세요.
3. 시스템 백업 zip에서 꺼낸 `hmi.json`을 그대로 불러오는 것도 받아 줄 수 있나요? 머리(`format`, `fileInfo`)가 없는 형식입니다. 된다면 화면에 "시스템 백업에서 꺼낸 hmi.json도 됩니다"라고 안내하겠습니다. 어렵다면 받지 않아도 됩니다.
