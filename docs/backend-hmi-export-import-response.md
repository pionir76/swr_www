---
from: backend
to: frontend
status: done
waiting_on: none
---

# HMI 작화 데이터 내보내기·불러오기 — 백엔드 답변

> 작성: 2026-11-20 (백엔드, 사용자 승인)
> 대상: 프론트엔드
> 요청서: `docs/backend-hmi-export-import-request.md`
> 관련: `referencs/api-spec.md` §14 HMI

---

## 1. 요약

요청서의 정책(전체 교체, ManagerOrAbove, 재시작 없음, 시스템 백업은 그대로)대로 구현했습니다. **바뀐 점은 하나입니다. `importId`를 쓰지 않습니다.** 검증과 적용 모두 **파일 전체를 보냅니다**(사용자 승인, 2절).

**2026-11-20 11:12 장치 배포 완료** (swr `061badb`). 명세는 `referencs/api-spec.md` §14 "HMI 내보내기 / 불러오기", 변경 이력은 2026-11-20 (2차)입니다. 장치 시험 결과는 5절에 있습니다.

## 2. 설계 변경: `importId` 대신 파일을 다시 보냄

| | 요청서 (`importId`) | 변경 (파일 재전송) |
|---|---|---|
| 서버 상태 | 최대 13MB 파일을 만료 때까지 메모리에 보관, 만료 관리 필요 | 보관하지 않음 |
| 적용 시점의 검사 | 검증 뒤 레지스터가 바뀌면 결과가 어긋날 수 있음 (요청서 2.3의 "400 다시 검증") | 적용할 때 다시 검사하므로 어긋날 일이 없음 |
| 비용 | — | 같은 파일을 LAN으로 한 번 더 올림 |

장치 메모리가 512MB라 큰 파일을 서버에 쥐고 있는 쪽이 더 부담입니다. 프론트는 고른 파일(`File`/`Blob`)을 그대로 두었다가 적용할 때 다시 보내면 됩니다.

## 3. API

### 3.1 `GET /api/hmi/export`

- 권한: `ManagerOrAbove`
- `Content-Type: application/json`
- `Content-Disposition: attachment; filename="swr_hmi_<hostname>_YYYYMMdd_HHmmss.json"` (호스트 이름에서 영문·숫자·`_`·`-` 외 문자는 `_`로 바꿈)
- 시스템 로그(INFO): `HMI exported by <user>: N screen(s), M tag(s), B bytes`

```json
{
  "format": "swr.hmi",
  "schemaVersion": 1,
  "fileInfo": { "product": "SmartRoute", "createdAt": "2026-11-20T14:00:00", "createdBy": "admin",
                "hostname": "smartroute", "version": "1", "revision": "0" },
  "hmi": {
    "project": { "name": "...", "startScreen": "main", "revision": 7, "pollMs": 1000 },
    "screens": [ { "id": "main", "title": "...", "revision": 3, "updatedAt": "...", "updatedBy": "...", "content": { "format": "whmi.screen", "...": "..." } } ],
    "tags":    [ { "id": "TEMI2KMF_NPV", "name": "...", "unifiedAddress": 32, "scale": 0.01, "unit": "...", "minValue": 0, "maxValue": 100, "access": "rw" } ]
  }
}
```

`hmi`는 시스템 백업의 `hmi.json`과 같은 내용이고, `project.pollMs`가 추가됐습니다(3.4절). 태그에서 값이 없는 항목(`scale`·`unit`·`minValue`·`maxValue`·`access`)은 키 자체가 없습니다(상속).

### 3.2 `POST /api/hmi/import/validate`

- 권한: `ManagerOrAbove`
- 요청 바디: 파일 전체(`Content-Type: application/json`). **머리 없는 시스템 백업 `hmi.json`도 받습니다**(요청서 4절-3). 이때 응답의 `fileInfo`는 `null`입니다.
- 아무것도 바꾸지 않습니다.

**응답 200**
```json
{
  "fileInfo": { "product": "SmartRoute", "createdAt": "...", "createdBy": "admin", "hostname": "smartroute", "version": "1", "revision": "0" },
  "project": { "name": "냉동 설비 통합 모니터링", "startScreen": "main", "pollMs": 1000 },
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

- `fileInfo`는 파일에 적힌 그대로입니다.
- `tags.missing`: 이 장치에 `unifiedAddress` 레지스터가 없어 **적용 때 건너뛸** 태그입니다. `unifiedAddress`가 없거나 숫자가 아니면 `null`로 나옵니다.
- `warnings`: 예를 들어 `startScreen`이 파일의 화면 목록에 없을 때입니다(적용하면 첫 화면이 시작 화면).

**에러**

| 상태 | 경우 |
|---|---|
| 400 | JSON 객체가 아님 / `format`이 `swr.hmi`가 아님 / `schemaVersion`이 1보다 큼 / 머리도 없고 `project`·`screens`·`tags`도 없음 / `hmi.project`·`screens`·`tags`의 형식 오류 / 화면·태그 id 규칙 위반 또는 중복 / 화면 `title` 64자 초과 / 화면 `content.format`이 `whmi.screen`이 아님 / 태그 `access`가 `r`·`rw`가 아님 / `pollMs`가 정수 500–10000이 아님 |
| 413 | 화면 하나의 `content`가 256KB 초과 (메시지에 화면 id) |
| 409 | 화면 수가 `hmi.maxScreens` 초과 (응답에 `maxScreens`) |

에러 응답은 `{ "error": "screen 'main': 'content.format' must be \"whmi.screen\"" }`처럼 문제 위치를 담습니다. 화면 규칙은 `POST /api/hmi/screens`와 같습니다.

### 3.3 `POST /api/hmi/import/apply`

- 권한: `ManagerOrAbove`
- 요청 바디: **validate와 같은 파일 전체**
- 같은 검사를 다시 한 뒤, 프로젝트·화면·태그를 **전체 교체**합니다. 재시작하지 않고 폴링도 계속됩니다. `missing` 태그는 건너뜁니다.
- **revision:** 프로젝트와 모든 화면의 revision이 **지금 장치에 있는 어떤 revision보다 1 큰 값**으로 바뀝니다. 그래서 불러오기 전에 화면을 열어 둔 편집자가 저장하면 409가 납니다. 파일에 적힌 revision은 쓰지 않습니다.
- 화면의 `updatedAt`·`updatedBy`는 파일 값을 그대로 둡니다(원래 작성 정보 보존).
- 시스템 로그:
  - INFO `HMI imported by <user>: N screen(s), M tag(s) — previous HMI replaced`
  - 건너뛴 태그가 있으면 WARN `HMI import skipped K tag(s) with no register on this device: id1, id2`

**응답 200**
```json
{ "ok": true, "screens": 3, "tags": 25, "skippedTags": ["TEMI2KMF_NPV"], "revision": 8 }
```

`revision`은 새 프로젝트 revision입니다(화면 revision도 같은 값). 에러는 validate와 같습니다(400·413·409).

### 3.4 `pollMs` (HMI 값 갱신 주기)

- `GET /api/hmi/project` 응답에 `pollMs` 추가. 기본 1000.
- `PUT /api/hmi/project`에 `pollMs` 추가. 정수 500–10000, 범위 밖이면 400 `'pollMs' must be an integer 500–10000`. 다른 필드처럼 `revision`이 필요하고, 저장하면 프로젝트 revision이 오릅니다. 응답에 `pollMs` 포함.
- 백엔드는 저장만 합니다.
- 내보내기 파일과 시스템 백업 `hmi.json`의 `project.pollMs`에 들어가고, 불러오기·복원 때 적용됩니다. `pollMs`가 없는 예전 파일은 1000입니다.

## 4. 확인 요청에 대한 답

1. **업로드 크기(약 13MB):** 받을 수 있습니다. 웹서버(lighttpd 프록시)와 API 서버에 크기 제한이 없고, 12.5MB 파일로 장치에서 시험했습니다(5절). 몇 초씩 걸리므로 업로드 중에는 진행 표시를 권합니다.
2. **예전 `decimals`:** 시스템 복원과 같은 코드를 씁니다. `decimals`는 무시하고, `scale`이 없거나 허용 값이 아니면 상속(`null`)입니다.
3. **머리 없는 `hmi.json`:** 받습니다(3.2절). 머리(`format`)가 없고 `project`·`screens`·`tags` 중 하나라도 있으면 시스템 백업의 `hmi.json`으로 해석합니다.

## 5. 장치에서 확인한 것 (2026-11-20)

| 확인 | 결과 |
|---|---|
| 내보내기 | 200, `Content-Disposition: attachment; filename="swr_hmi_smartroute_20261120_111317.json"`, 머리·`hmi` 정상 |
| validate: 내보낸 파일 / 머리 없는 `hmi.json` / `decimals`가 든 예전 형식 | 200. 머리 없는 파일은 `fileInfo: null`, 예전 형식은 `pollMs` 1000 |
| validate: `unifiedAddress`를 9999로 바꾼 태그 | `linked` 5, `missing: [{ "id": "TEMI2KMF_HPV", "unifiedAddress": 9999 }]` |
| validate: `format` 오류 / `access: "w"` / `content.format` 오류 / `pollMs` 50 / 화면 id 중복 / JSON 아님 | 400 (메시지에 화면·태그 id) |
| validate: 화면 51개 | 409, `maxScreens: 50` |
| validate: 화면 하나 300KB | 413 |
| apply: 태그 하나가 없는 파일 | `skippedTags: ["TEMI2KMF_HPV"]`, 태그 5개, 프로젝트·화면 revision 15 → 16, 로그 INFO·WARN 기록 |
| 불러오기 전 revision(15)으로 화면 저장 | 409 |
| 원본 파일 다시 apply | 내용이 원본과 같음(revision만 증가) |
| 12.5MB(화면 50개 × 약 250KB) | validate 3.1초, apply 4.5초, export 4.5초. swr 메모리 최대 약 65MB, 그동안 폴링 정상 |
| `PUT /api/hmi/project` `pollMs` 499 / 10001 / 1.5 / `"1000"` | 400. 2000은 저장되고 revision 증가 |
| 시스템 백업 `hmi.json` | `project.pollMs` 포함 |

시험 뒤 장치의 HMI는 원래 내용으로 되돌렸습니다. 다만 화면 `main`과 프로젝트 revision은 19가 됐습니다. 시험 중에 화면을 열어 두셨다면 다시 불러온 뒤 저장해 주세요.
