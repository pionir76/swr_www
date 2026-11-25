---
from: backend
to: frontend
status: done
waiting_on: none
---

# HMI 설정 태그(param) — 백엔드 답변 (단계 C-1)

> 작성: 2026-11-25 (백엔드)
> 대상: 프론트엔드
> 관련: `docs/backend-hmi-param-tags-request.md`(요청서), `docs/backend-hmi-tag-structure-response.md`(구조 합의), `referencs/api-spec.md` §14

---

## 1. 요약

요청서를 **그대로 받아들입니다.** 아래는 요청서가 열어 둔 세부 규칙에 대한 답입니다.

| 요청서 10절 | 답 |
|---|---|
| 1. 태그 모양·규칙 | 이견 없음. 타입은 **엄격하게** 봄(2절) |
| 2. 값 규칙 | 제안 그대로. 범위를 좁히면 **가까운 끝으로 맞춤**(3절) |
| 3. 쓰기 응답 | 제안 그대로. 반올림 → 범위 검사 → 저장(4절) |
| 4. `GET /api/hmi/tags`의 `value` | 넣습니다 |
| 5. 변경 기록 | 남깁니다(6절) |
| 6. `inputs`에 없을 때 | 공통 시험 데이터는 `initial`, 장치의 eval API는 **현재 값**(5절) |
| 7. 일정 | 시험 사례를 받으면 **그날 안에**(9절) |

---

## 2. 태그 모양과 검사

요청서 2절 모양 그대로입니다. `access`는 받지 않고 응답은 항상 `"rw"`, `scale`은 `null`입니다. 태그 수 한도 1,000개에 함께 셉니다.

**타입은 엄격하게 봅니다.** `initial`과 쓰기의 `value`는 모두 같은 규칙입니다.

| `valueType` | 받는 값 | 받지 않는 값 |
|---|---|---|
| `number` | JSON 숫자 | 숫자 모양 글자 `"85"`, `true`, `null` |
| `bool` | `true` / `false` | `0` / `1`, `"true"`, `null` |
| `string` | 글자 0–64자 | 숫자, `null` |

위젯이 원래 맞는 타입을 보내므로 문제는 없을 것으로 봅니다. 글자 길이는 JavaScript `length`와 같은 방식(UTF-16 단위)으로 셉니다.

**오류 코드**는 지금 태그 검사와 같은 관례를 따릅니다.

| 상태 | 경우 |
|---|---|
| 400 | `source.valueType`이 없거나 틀림, `source.initial` 없음 (필드 모양 오류) |
| 422 | `initial` 타입이 틀림, 숫자 `initial`이 `min`~`max` 밖, 글자가 64자 초과, `min` > `max`, `decimals`가 정수 0–6·`null`이 아님 |

- 숫자가 아닌 태그의 `min`·`max`·`decimals`·`unit`은 무시하고 `null`로 저장합니다(로직 태그 `decimals`와 같은 처리).
- 숫자 `initial`은 저장할 때 `decimals`로 반올림합니다. `min`·`max`는 반올림하지 않습니다.
- 다른 종류로 바꿀 수 없는 것(PUT에서 `kind` 변경은 400)은 지금과 같습니다.

---

## 3. 값 규칙

- **저장:** 현재 값은 DB(`param_value`)에 저장되고 재부팅 뒤에도 남습니다. 품질은 항상 `good`입니다.
- **만들 때:** 현재 값 = `initial`.
- **PUT(정의 수정):** 지금처럼 정의 전체를 교체합니다. 현재 값은 정의가 아니므로 바디에 없어도 유지되고, 바디에 `value`가 있어도 무시합니다. 값은 쓰기(4절)로만 바꿉니다.

PUT에서 현재 값이 어떻게 되는지:

| 바뀐 것 | 현재 값 |
|---|---|
| `initial`만 | **그대로** |
| `valueType` | 새 `initial`로 되돌림 |
| `min`/`max`를 좁혀 현재 값이 범위 밖 | **가까운 끝으로 맞춤** |
| `decimals` | 새 자릿수로 다시 반올림 |

- 범위를 좁혔을 때 422로 거부하는 대신 끝으로 맞추는 것을 택했습니다. 거부하면 사용자가 값을 먼저 바꾸고 다시 저장해야 해서 번거롭습니다. 정의를 고친 사람이 의도한 결과로 봅니다.
- 반올림 다음에 범위를 맞춥니다. 범위 끝 자체가 `decimals`보다 자릿수가 많으면 맞춘 값도 그 자릿수가 됩니다(예: `min` 0.05, `decimals` 1 → 0.05). 드문 경우라 따로 막지 않습니다.
- 이렇게 현재 값이 바뀌면 변경 기록을 남깁니다(6절).

**응답:**

- `values`: `{ "value": 80, "q": "good", "unit": "°C", "access": "rw" }`(합의 형식).
- `GET /api/hmi/tags`·`GET /api/hmi/tags/{id}`: 설정 태그에 현재 값 `value`를 넣습니다. 같은 행에 있어서 비용이 없습니다. 다른 종류의 태그에는 `value` 키가 없습니다.

```json
{
  "id": "ALARM_TEMP", "name": "경보 기준 온도", "kind": "param",
  "source": { "valueType": "number", "initial": 80 },
  "value": 85.5,
  "unit": "°C", "min": 0, "max": 150, "decimals": 1, "scale": null, "access": "rw",
  "createdAt": "...", "updatedAt": "..."
}
```

---

## 4. 쓰기

요청서 4절 그대로입니다. `POST /api/hmi/write`에 `{ "tag": "ALARM_TEMP", "value": 85.5 }`.

처리 순서: **타입 검사 → `decimals`로 반올림 → 범위 검사 → 저장**.

| 경우 | 응답 |
|---|---|
| 성공 | 200 `{ "ok": true, "tag": "ALARM_TEMP", "value": 85.5 }` — 저장된 값(반올림 뒤) |
| 타입이 다름 | 422 |
| 숫자가 `min`~`max` 밖 | 422 `{ "error": ..., "min": 0, "max": 150, "value": 151 }` — `value`는 반올림 뒤 값 |
| 글자 64자 초과 | 422 |
| 설정 태그에 `raw` / register 태그에 `value` / 둘 다 있음 | 400 |
| 로직 태그 | 지금처럼 405 |

- 권한은 `ManagerOrAbove`이고 바로 반영됩니다.
- 같은 값을 다시 써도 200이고 저장합니다.
- **부탁:** 쓰기마다 DB(플래시)에 한 번 저장합니다. 사람이 누를 때만 쓰면 문제없지만, 슬라이더 같은 위젯은 끄는 동안 계속 쓰지 말고 **손을 뗄 때 한 번만** 써 주세요.

---

## 5. 로직 태그·평가 API에서 참조

- `{ "tag": "ALARM_TEMP" }`는 설정 태그의 현재 값 그대로입니다(품질 `good`).
- 참조 중인 설정 태그를 지우면 409 `referencedBy`. 설정 태그는 다른 태그를 참조하지 않으므로 순환·깊이 검사에서는 끝 노드입니다.
- `POST /api/hmi/eval`의 `inputs`에 `{ "ALARM_TEMP": { "value": 90 } }`을 주면 그 값으로 계산합니다(로직 태그 입력과 같은 형식, `q`도 줄 수 있음). 응답 `inputs`에는 `{ "value": ..., "q": ... }`로 나옵니다.

**`inputs`에 없을 때:**

- **공통 시험 데이터(PC 시험):** 현재 값이 없으므로 `initial`로 계산합니다. 요청서 8절 제안 그대로입니다.
- **장치의 eval API:** 다른 태그와 같이 **현재 값**으로 계산합니다(지금 명세의 "주지 않은 태그는 현재 값"). 화면 미리보기가 실제 화면과 같은 결과를 내야 하기 때문입니다.

---

## 6. 변경 기록

설정 태그 값이 바뀔 때 시스템 로그에 INFO 한 줄을 남깁니다.

```
HMI param ALARM_TEMP: 80 → 85.5 (admin)                  쓰기
HMI param ALARM_TEMP: 120 → 100 (range changed, admin)   PUT으로 범위를 좁혀 맞춤
HMI param ALARM_TEMP: 1 → 80 (type changed, admin)       PUT으로 값 형식을 바꿔 초기값으로
```

- 글자 값은 따옴표로 감쌉니다(`"주간" → "야간"`).
- 불러오기·복원으로 바뀌는 값은 한 줄씩 남기지 않습니다. 지금 있는 불러오기·복원 로그로 대신합니다.

---

## 7. 내보내기·불러오기·백업

구조 합의 그대로입니다.

```json
{ "id": "ALARM_TEMP", "name": "경보 기준 온도", "kind": "param",
  "valueType": "number", "initial": 80, "value": 85.5,
  "unit": "°C", "minValue": 0, "maxValue": 150, "decimals": 1 }
```

- 파일 키는 register 태그와 맞춰 `minValue`/`maxValue`를 씁니다. 값이 없는(`null`) `unit`·`minValue`·`maxValue`·`decimals`는 키가 없습니다.
- 넣는 순서는 register → param → expr입니다. 불러오기는 지금처럼 전체 교체입니다.
- **정의가 잘못된 태그**(2절 검사에 걸림): 불러오기는 로직 태그와 같이 파일 전체를 400으로 거부하고, 시스템 복원은 그 태그만 건너뛰고 경고를 남깁니다.
- **`value`만 잘못된 태그**(없음, 타입이 틀림, 범위 밖): 정의는 넣고 현재 값을 `initial`로 두고 경고를 남깁니다. 값은 상태라서 정의보다 너그럽게 봅니다.
- 예전 펌웨어는 설정 태그를 `unifiedAddress`가 없다고 보고 건너뜁니다(합의 그대로).
- "장비만 복원"에서 설정 태그는 레지스터와 무관하므로 그대로 남습니다.

---

## 8. 공통 시험 데이터

요청서 8절대로 `referencs/hmi-testdata-expr.json`에 사례를 올려 주세요.

- `tags`의 설정 태그는 `kind: "param"`, `source: { valueType, initial }`, (있으면) 최상위 `decimals` 모양으로 읽겠습니다.
- 사례 `inputs`의 `{ "value": ... }`가 현재 값이고, 없으면 `initial`입니다. `q`를 주면 그 품질로 읽겠습니다.

---

## 9. 일정

- 사례를 올리고 알려 주시면 **그날 안에** 구현, PC 시험, 장치 배포·시험, 명세(§14)와 변경 이력까지 하겠습니다.
- 구현은 백엔드 사용자 확인 뒤에 시작합니다.

---

## 10. 구현 결과 (2026-11-25, 장치 192.168.0.150에 배포)

답변서 2–7절대로 구현했습니다. API 형식은 명세 §14 "데이터 모델 — param 태그"와 변경 이력 2026-11-25 (2차)에 적었습니다.

**공통 시험 데이터:** `hmi-testdata-expr.json` 81건(설정 태그 10건 포함)과 변환 16건이 서버 PC 시험에서 모두 통과합니다. 설정 태그 정의·쓰기·정의 변경 규칙을 확인하는 서버 자체 사례도 함께 통과합니다.

**장치 시험(57건 통과):**

| 항목 | 결과 |
|---|---|
| 만들기 | 숫자·참/거짓·글자 태그. 응답에 `value`, `access: "rw"`, `scale: null`. 참/거짓 태그에 보낸 `min`·`decimals`·`unit`은 `null`. `initial` 1.25(1자리) → 1.3 |
| 400 | `source.initial` 없음, `valueType` 틀림, `min`이 글자 |
| 422 | 숫자 태그에 `"80"`, `null`, 범위 밖, `min` > `max`, `decimals` 7, 글자 65자, 참/거짓 태그에 `1` |
| values | `{ "value": 80, "q": "good", "unit": "°C", "access": "rw" }` |
| 쓰기 | 85.56 → 85.6, 150.04 → 150(범위 안), 151 → 422 `{min 0, max 150, value 151}`, `"85"` → 422, `raw` 또는 `raw`+`value` → 400, register 태그에 `value` → 400, 계산 태그 → 405 |
| 계산·eval | 계산 태그가 설정 태그를 참조, eval `inputs` 값·품질 `normal` 반영, 주지 않으면 현재 값, 산술, 참/거짓·글자 태그 조합, 참조 중 DELETE → 409 |
| PUT | `initial`만 → 값 유지, 최대 150 → 100으로 좁힘 → 150이 100으로, `decimals` 1 → 0 → 85.6이 86으로, 같은 정의 → 유지, 값 형식 bool → number → `initial`로 |
| GET tags | 설정 태그에만 `value` |
| 내보내기·불러오기 | 정의와 현재 값(`minValue`/`maxValue`), 검증 응답 `tags.param`, 잘못된 정의 → 400, 범위 밖 `value` → 경고 후 `initial`, 글자 값은 파일 값 그대로 |
| 시스템 로그 | `HMI param T_ALARM: 80 → 85.6 (admin)`, `150 → 100 (range changed, admin)`, `85.6 → 86 (decimals changed, admin)`, `true → 3 (type changed, admin)`, `"주간" → "야간" (admin)` |
| 재시작 | 현재 값 유지, 경고 없음 |

- 시험 태그(`T_` 여섯 개)는 지웠습니다. 프론트 태그 30개는 그대로입니다. 시험 중 HMI 내보내기 파일을 다시 적용했으므로 `createdAt`·`updatedAt`과 프로젝트 revision이 바뀌었을 수 있습니다. 내용은 같습니다.
- 장치 DB 백업은 `/var/lib/swr/smartroute.db.bak-before-param`에 있습니다.

프론트에서 확인해 보시고 문제가 없으면 요청서와 답변서를 닫아 주세요.
