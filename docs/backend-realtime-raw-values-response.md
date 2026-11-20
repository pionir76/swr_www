---
from: backend
to: frontend
status: done
waiting_on: none
---

# 실시간 레지스터 값을 원본(raw)으로 전환 — 백엔드 답변

> 작성: 2026-11-20 (백엔드)
> 대상: 프론트엔드
> 요청서: `docs/backend-realtime-raw-values-request.md`
> 관련: `referencs/api-spec.md` §2 대시보드·§5 `GET /api/registers/realtime`, `referencs/api-changelog.md` 2026-11-20

---

## 1. 요약

요청서 §2.1을 반영했습니다. 전환 순서 §3의 **1단계(백엔드)** 입니다. `scaledValue`·`outOfRange`는 남겨 두었으므로 지금 화면은 그대로 동작합니다. 프론트 전환을 마치고 알려 주시면 3단계(응답에서 `scaledValue`·`outOfRange` 제거)를 진행하겠습니다.

배포 상태는 4절을 보세요.

## 2. 반영 내용

대상: `GET /api/registers/realtime`의 `registers[]`, `GET /api/dashboard`의 `realtimeRegisters[]`

| 필드 | 내용 |
|---|---|
| `rawWords` | 원본 워드 배열(uint16), 길이 = `length`. **상위 워드가 먼저**입니다(아래 §3-1). coil·discrete_input은 비트마다 `0`/`1`(1비트면 `[0]`/`[1]`). 아직 값을 받지 못했으면 `null` |
| `isSigned` | 레지스터 `isSigned` |
| `length` | 레지스터 `length`(워드 수) |
| `minValue`, `maxValue` | **대시보드 항목에만 추가.** 실시간 항목에는 원래 있었습니다. 프론트가 대시보드에서도 범위 초과를 판정할 수 있게 넣었습니다. 설정하지 않은 레지스터는 `±1.7976931348623157e308`(제한 없음) |

- `rawWord`는 그대로 둡니다(`rawWords[0]`과 같음).
- **주의:** coil·discrete_input의 `rawWord`는 지금도, 앞으로도 `0`입니다. 비트 값이 워드 저장소와 따로 있기 때문입니다. coil을 원본으로 계산할 때는 **`rawWords`를 쓰세요.**
- **값 유지:** 읽기에 실패해도 `rawWords`는 마지막으로 받은 값을 유지합니다. 오래된 값인지는 `quality`로 판단하세요. `bad`이면 표시하지 않는 것을 권합니다.

## 3. 질문에 대한 답

### 3-1. 2워드 이상 조립 규칙 (요청서 §2.2)

1. **`byteOrder`는 워드 순서입니다.**
   - `little`이면 워드 배열을 뒤집고, 워드 안의 바이트는 건드리지 않습니다.
   - `default`는 장비 설정의 `byteOrder`를 따릅니다.
   - 이 정렬은 **값을 수집할 때 이미 적용**되어 저장됩니다. 그래서 `rawWords`는 항상 상위 워드가 먼저입니다.
   - 프론트는 `byteOrder`를 몰라도 되고, 장비 설정 값을 응답에 넣을 필요도 없습니다.
   - 조립 방법: `value = rawWords[0]`, 이후 워드마다 `value = value × 65536 + rawWords[i]`.
2. **부호는 전체 정수의 최상위 비트 기준입니다.**
   - `length`×16비트 정수의 최상위 비트가 1이면 2의 보수로 음수입니다(32·48·64비트 모두).
   - 64비트는 JS `Number`의 정밀도(2^53)를 넘으므로 `BigInt` 사용을 권합니다.
3. **실수(float) 해석은 없습니다.** 정수 × `scale`만 합니다.

참고: coil·discrete_input이 2비트 이상이면, 지금 `scaledValue`는 "켜진 비트 수 × `scale`"입니다. 화면에서 이 값을 쓸 일은 없을 것으로 보지만 알려 드립니다.

### 3-2. `scaledValue` / `outOfRange` (요청서 §2.3)

1. **`scaledValue`는 `minValue`/`maxValue`로 잘린 값입니다.** 프론트가 잘리지 않은 값을 보여 주고 "범위 초과"로 표시하는 계획에 동의합니다.
2. **`outOfRange`는 서버 내부(경보·로그)에서 쓰지 않습니다.** API 응답 두 곳에만 나갑니다. 3단계에서 응답에서 빼도 서버 쪽 영향은 없습니다.
3. **결함 안내:** 지금 `outOfRange`는 이번 값을 계산하기 전에 **직전의 잘린 값**으로 판정합니다. 그래서 사실상 항상 `false`입니다. 전환 기간에도 이 필드는 쓰지 마세요. 어차피 없앨 필드라 따로 고치지 않습니다.

## 4. 배포 상태

**2026-11-20 11:12 장치 배포 완료** (swr `c9c822d`). 장치에서 확인한 것:
- 36개 레지스터 모두 `rawWords` 길이가 `length`와 같습니다. coil도 `[0]`/`[1]`로 나옵니다.
- `rawWords[0]`을 부호·`scale`로 계산하고 범위로 자른 값이 `scaledValue`와 모두 같습니다.
- 대시보드 항목에 `minValue`/`maxValue`가 있습니다.

같이 바뀐 것 (변경 이력 2026-11-20, swr `1c8e13e`):
- **통신 경보:** `[경보] … 통신 불능 (연속 N회)`는 연속 3주기 실패할 때만 남습니다. 장비 `state`·`consecutiveErrors`는 그대로입니다.
- **HMI `values`:** 한 번 읽기에 실패해도 `raw`가 비지 않습니다(명세 §14대로).

## 5. 3단계 완료 (2026-11-20)

프론트 전환 완료 알림을 받고 `GET /api/registers/realtime`과 대시보드 `realtimeRegisters`에서 `scaledValue`·`outOfRange`를 뺐습니다(swr `19cb4d9`). 서버 안의 배율·범위 계산(결함이 있던 `outOfRange` 판정 포함)도 쓰는 곳이 없어 함께 없앴습니다.

장치에서 확인:
- 실시간 36개와 대시보드 20개 항목에 두 필드가 없습니다.
- `rawWords`는 모두 값이 있습니다.
- 장비 4대와 HMI 값은 정상입니다.

요청서·답변서는 `status: done`으로 닫았습니다.

