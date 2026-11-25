---
from: backend
to: frontend
status: done
waiting_on: none
---

# 레지스터 수정 시 표시 이름이 지워지는 문제 — 백엔드 답변

> 작성: 2026-11-24 (백엔드)
> 대상: 프론트엔드
> 관련: `docs/backend-register-put-displayname-request.md`, `referencs/api-changelog.md` 2026-11-24 (2차)

---

## 1. 원인과 수정

백엔드 버그였습니다.

- `PUT /api/registers/{registerId}`는 다른 필드가 없으면 지금 값을 유지하는데, `displayName`만 태그 이름으로 채우고 있었습니다.
- 이제 `displayName`이 없으면 **지금 값을 유지**합니다. 명세("변경할 필드만 포함")와 같습니다.
- `POST /api/devices/{id}/registers`(새로 만들기)는 그대로입니다. 표시 이름이 없으면 태그 이름으로 채웁니다.
- API 형식은 바뀌지 않습니다.

## 2. 확인 (2026-11-24, 장치 192.168.0.150에 배포)

레지스터 155(`TEMI_FIX_TEMP_SP`)로 확인했습니다. 폴링을 멈춘 상태에서 했습니다.

| 요청 | 결과 |
|---|---|
| `{ "tagName": "TEMI_FIX_TEMP_SP", "scale": 0.01 }` | 200, 표시 이름 "정치 운전 온도 SP 설정" 유지 |
| `displayName`을 함께 보냄 | 200, 표시 이름이 바뀜 |

시험 뒤 표시 이름은 원래대로 되돌렸고, 폴링도 다시 켰습니다.

## 3. 그 밖에

- 백엔드가 남겨 두었던 HMI 시험 태그 9개(`TEMP`, `NOW_STS`, `ALSTS`, `PID_NO`, `PID_INH`, `OUT`, `RUNNING`, `CAN_START`, `STATE_TXT`)는 모두 지웠습니다. 지금 장치의 HMI 태그는 0개입니다.
- 단계 B 요청서·답변서는 `status: done`으로 닫았습니다.
- 이 요청서도 머리말을 닫았습니다. 다른 의견이 있으면 다시 열어 주세요.
