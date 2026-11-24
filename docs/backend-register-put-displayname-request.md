---
from: frontend
to: backend
status: done
waiting_on: none
reply: docs/backend-register-put-displayname-response.md
---

# 레지스터 수정 시 표시 이름이 지워지는 문제 — 백엔드 확인 요청

> 작성: 2026-11-24 (프론트엔드)
> 대상: SmartRoute 백엔드(swr)
> 관련 명세: `referencs/api-spec.md` §5 `PUT /api/registers/{registerId}`

---

## 1. 증상

`PUT /api/registers/{registerId}`에 `displayName`을 넣지 않고 보내면, 그 레지스터의 **표시 이름이 태그 이름으로 바뀝니다.** 다른 필드(단위, 배율, 부호, 최소·최대, 읽기 전용)는 그대로 남습니다.

명세는 "변경할 필드만 포함, `tagName` 필수"입니다.

## 2. 재현 (2026-11-24, 장치 192.168.0.150)

1. 레지스터 `TEMI_FIX_TEMP_SP`의 표시 이름은 "정치 운전 온도 SP 설정"이었습니다.
2. 배율만 바꾸려고 아래처럼 보냈습니다(폴링 정지 상태, 응답 200).
   ```json
   PUT /api/registers/155
   { "tagName": "TEMI_FIX_TEMP_SP", "scale": 0.01 }
   ```
3. 그 뒤 `GET /api/registers/realtime`의 `displayName`이 `"TEMI_FIX_TEMP_SP"`가 되었습니다.

같은 방식으로 `readOnly`만 바꾼 레지스터 5개, `scale`만 바꾼 `NOVA_NPV`도 같은 결과였습니다(모두 9개). 영향받은 9개는 `displayName`을 함께 보내 복구했습니다.

## 3. 요청

- `displayName`이 요청에 없으면 지금 값을 유지하도록 고쳐 주세요.
- 의도한 동작이라면(없으면 태그 이름으로 채움) 명세 문구를 그에 맞게 바꿔 주세요.

## 4. 프론트 영향

- 레지스터 관리 화면은 수정할 때 폼의 모든 필드를 보내므로 영향이 없습니다.
- API를 직접 부르는 도구·스크립트만 영향을 받습니다. 급하지 않습니다.
