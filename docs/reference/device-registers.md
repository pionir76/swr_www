# 시험 장비 레지스터 정리 (ST570, TEMI2000MF)

> 작성 2026-11-24. HMI 시험용으로 장치에 넣은 레지스터의 뜻과 비트 정의.
> 출처: `NOVA500E-ST instruction manual(Kor)` Ⅱ 통신설명서 6장, `TEMI2000MF comm(Kor)` PART 04. 매뉴얼 PDF는 `~/project/etc/`.
> 값 확인: 2026-11-24 장치 실제 값(아래 "실제 값으로 확인한 것").

## 공통 규칙

- **Modbus 주소 = 매뉴얼 D-Register 번호 − 1.** 예: D0010 → 주소 9. 기능 코드 03(홀딩 레지스터).
- 값은 소수점 없는 정수로 오고, 소수점 위치는 장비 설정을 따른다. 배율은 그에 맞춰 레지스터에 넣었다.
- 비트 번호는 0부터.
- 장치에 넣은 **표시 이름은 짧게** 둔다(예: "경보 상태 비트"). 비트별 뜻은 화면이 아니라 이 문서의 비트 정의 표에서 본다(2026-11-24에 긴 표시 이름 44개를 줄임).

---

## 1. ST570 (장비 2, RS-485 Modbus RTU, 태그 접두어 `NOVA_`)

입력 소수점 위치(`NOVA_IN_DP`, D0605)가 0이라 온도는 배율 1이다. 쓰기는 기능 코드 06으로 된다.

| 태그 | D-Reg | 주소 | 뜻 | 단위·배율 | 쓰기 |
|---|---|---|---|---|---|
| `NOVA_NPV` (기존) | D0001 | 0 | 현재 측정값 | °C · 1 (2026-11-24 0.01에서 고침) | |
| `NOVA_SP` (기존) | D0002 | 1 | 현재 설정값(NSP) | °C · 1 | 기존은 쓰기 허용이나 PROCESS 그룹은 쓰기 불가 |
| `NOVA_TSP` | D0003 | 2 | 목표 설정값 | °C · 1 | |
| `NOVA_SP_NO` | D0005 | 4 | 운전 중인 SP 번호(1~4) | | |
| `NOVA_MV` (기존) | D0006 | 5 | 제어 출력량 | % · 0.1 | |
| `NOVA_H_OUT` | D0007 | 6 | 가열측 출력량 | % · 0.1 | |
| `NOVA_PID_NO` | D0009 | 8 | 적용 중인 PID 번호 | | |
| `NOVA_NOW_STS` | D0010 | 9 | 운전 상태 **비트** | | |
| `NOVA_ALM_STS` | D0014 | 13 | 경보 상태 **비트** | | |
| `NOVA_DI_STS` | D0015 | 14 | DI 상태 **비트** | | |
| `NOVA_SIG_STS` | D0017 | 16 | 이너시그널 상태 **비트** | | |
| `NOVA_ERROR` | D0019 | 18 | 에러 상태 **비트** | | |
| `NOVA_PROC_TIME` | D0020 | 19 | 운전 시간 | | |
| `NOVA_RS` (기존) | D0101 | 100 | 운전 설정(0 RUN, 1 STOP) | | ○ |
| `NOVA_AUTO_MAN` | D0105 | 104 | 제어 동작(0 자동, 1 수동) | | ○ |
| `NOVA_MAN_MV` | D0106 | 105 | 수동 제어 출력량 | % · 0.1 | ○ |
| `NOVA_AT` | D0121 | 120 | 오토 튜닝(0 OFF, 1 ON) | | 읽기만(실수 방지) |
| `NOVA_LOCK` | D0137 | 136 | 키 잠금 | | 읽기만 |
| `NOVA_SP_SEL` | D0200 | 199 | 사용할 SP 번호(1~4) | | ○ |
| `NOVA_SP1`~`SP4` | D0201~D0204 | 200~203 | 설정치 1~4 | °C · 1 | ○ |
| `NOVA_AL1`, `AL2` | D0406, D0407 | 405, 406 | 경보 1·2 설정값 | °C · 1 | ○ |
| `NOVA_PID1_P` | D0511 | 510 | PID1 비례정수 | % · 0.1(추정) | ○ |
| `NOVA_PID1_I`, `_D` | D0512, D0513 | 511, 512 | PID1 적분·미분 시간 | s | ○ |
| `NOVA_IN_DP` | D0605 | 604 | 입력 소수점 위치 | | |

### 비트 정의

| 비트 | `NOVA_NOW_STS` | `NOVA_ALM_STS` | `NOVA_DI_STS` | `NOVA_SIG_STS` | `NOVA_ERROR` |
|---|---|---|---|---|---|
| 0 | RUN/STOP (**1 = 정지**, 실측) | ALM1 | DI1 | IS1 | |
| 1 | | ALM2 | DI2 | IS2 | |
| 2 | | ALM3 | | | |
| 3 | | ALM4 | | | |
| 4 | | EVENT1 | | (매뉴얼에 없음, 실측 1) | |
| 5 | | EVENT2 | | | |
| 6 | | EVENT3(옵션) | | | |
| 7 | | EVENT4(옵션) | | | |
| 8 | | HBA(히터 단선) | | | +OVER |
| 9 | | LBA(루프 단선) | | | −OVER |
| 10 | | TIMER1 | | | S.OPN(센서 단선) |
| 11 | | TIMER2 | | | |
| 12 | AT(오토 튜닝 중) | | | | |
| 13 | AUTO/MAN | | | | |

---

## 2. TEMI2000MF (장비 3 "TP2KMF", Modbus TCP, 새 태그 접두어 `TEMI_`)

- **Modbus 쓰기가 된다.** 매뉴얼 3-2에는 "Modbus 프로토콜에서는 쓰기 기능을 사용할 수 없습니다"(기능 코드 03, 08만)라고 나오지만 **매뉴얼이 틀린 부분**이다(사용자 확인, 2026-11-24). 장치에서 정치 온도 SP에 같은 값을 써 보았을 때 에러 없이 처리됐다. 설정 레지스터 5개(`TEMI_SET_PTNO`, `TEMI_COM_OPMODE`, `TEMI_FIX_TEMP_SP`, `TEMI_FIX_HUMI_SP`, `TEMI_OP_MODE`)는 쓰기 허용, 나머지(PROCESS 그룹 D0001~D0099)는 읽기 전용이다.
- 운전 명령은 정지 상태에서만 받는다(매뉴얼 4-2): 정치 → 프로그램으로 바꾸려면 먼저 정지(`TEMI_COM_OPMODE` = 4)한 뒤 `TEMI_OP_MODE`를 바꾸고 운전(= 1)한다.
- 온도 소수점 위치(`TEMI_TEMP_DP`, D0060)가 2라 **온도 배율은 0.01**이다. 습도는 0.1.
- 2026-11-24에 기존 레지스터 6개의 이름·배율을 매뉴얼 표에 맞게 고쳤다(옛 이름은 표에 괄호로). 옛 이름은 매뉴얼 예제 문장의 옛 기종 주소를 따른 것이었다.

| 태그 | D-Reg | 주소 | 뜻 | 단위·배율 |
|---|---|---|---|---|
| `TEMI_TEMP_NPV` (옛 `NPV`) | D0001 | 0 | 현재 온도 PV | °C · 0.01 |
| `TEMI_TEMP_NSP` | D0002 | 1 | 현재 온도 SP | °C · 0.01 |
| `TEMI_WET_NPV` (옛 `NSP`) | D0003 | 2 | 현재 습구온도 PV | °C · 0.01 |
| `TEMI_WET_NSP` | D0004 | 3 | 현재 습구온도 SP | °C · 0.01 |
| `TEMI_HUMI_NPV` (옛 `NMV`) | D0005 | 4 | 현재 습도 PV | % · 0.1 |
| `TEMI_HUMI_NSP` | D0006 | 5 | 현재 습도 SP | % · 0.1 |
| `TEMI_TEMP_MV` (옛 `C.PID`) | D0007 | 6 | 온도측 제어 출력 | % · 0.1 |
| `TEMI_HUMI_MV` | D0008 | 7 | 습도측 제어 출력 | % · 0.1 |
| `TEMI_C_PID` | D0009 | 8 | 적용 중인 PID 번호 | |
| `NOWSTS` (기존) | D0010 | 9 | 운전 상태 **비트** | |
| `TEMI_IS_STS` | D0011 | 10 | 이너시그널 **비트** | |
| `TEMI_TS_STS` (옛 `ISSTS`) | D0012 | 11 | 타임시그널 **비트**(b0~3 TS1~4) | |
| `TEMI_ALM_STS` | D0013 | 12 | 경보시그널 **비트** | |
| `TEMI_ONOFF_STS` | D0014 | 13 | ON/OFF 시그널 **비트** | |
| `TEMI_DOCTR_STS` | D0015 | 14 | 운전 출력 **비트** | |
| `TEMI_CTR_STS` (옛 `ALSTS`) | D0016 | 15 | 운전 화면 표시 **비트**(`TEMI_DOCTR_STS`와 같은 배치) | |
| `TEMI_DO_STS1` | D0017 | 16 | DO 출력 **비트**(DO1~16) | |
| `TEMI_DI_DATA1` | D0021 | 20 | DI 에러 **비트**(DI1~16) | |
| `TEMI_ADERR_STS` | D0025 | 24 | 입력 에러 **비트** | |
| `TEMI_RUN_TIME_H/M/S` | D0033~D0035 | 32~34 | 운전 시간(시·분·초) | |
| `TEMI_RUN_PTNO` | D0036 | 35 | 운전 중인 패턴 번호 | |
| `TEMI_RUN_SEGNO` | D0037 | 36 | 운전 중인 세그먼트 번호 | |
| `TEMI_NOW_TEMP_TSP` | D0047 | 46 | 현재 세그먼트 온도 목표값 | °C · 0.01 |
| `TEMI_NOW_HUMI_TSP` | D0049 | 48 | 현재 세그먼트 습도 목표값 | % · 0.1 |
| `TEMI_TEMP_DP` | D0060 | 59 | 온도 소수점 위치 | |
| `TEMI_COMM_ERR` | D0064 | 63 | 내부 통신 에러 **비트** | |
| `TEMI_SET_PTNO` | D0100 | 99 | 운전할 패턴 번호. **쓰기** | |
| `TEMI_COM_OPMODE` | D0101 | 100 | 운전 명령(1 RUN, 2 HOLD, 3 STEP, 4 STOP). 읽으면 0. **쓰기** | |
| `TEMI_FIX_TEMP_SP` | D0102 | 101 | 정치 운전 온도 SP. **쓰기** | °C · 0.01 |
| `TEMI_FIX_HUMI_SP` | D0103 | 102 | 정치 운전 습도 SP. **쓰기** | % · 0.1 |
| `TEMI_OP_MODE` | D0104 | 103 | 운전 방식(0 프로그램, 1 정치). **쓰기** | |

매뉴얼 D0036~D0049 표는 "내용" 칸이 앞 표를 잘못 복사한 것이라, 뜻은 기호 이름으로 읽었다(RUN.PTNO, RUN.SEGNO, NOW.TEMP.TSP, NOW.HUMI.TSP).

### 비트 정의

| 비트 | `NOWSTS` D0010 | `TEMI_IS_STS` D0011 | `TEMI_ALM_STS` D0013 | `TEMI_ONOFF_STS` D0014 | `TEMI_DOCTR_STS` D0015 (`TEMI_CTR_STS` D0016도 같음) | `TEMI_ADERR_STS` D0025 | `TEMI_COMM_ERR` D0064 |
|---|---|---|---|---|---|---|---|
| 0 | RESET(정지) | IS1 | ALM1 | T1 | T.RUN(온도 운전) | 온도 +OVER | 제어부 통신 에러 |
| 1 | FIX(정치 운전) | IS2 | ALM2 | T2 | H.RUN(습도 운전) | 온도 −OVER | I/O 보드 통신 에러 |
| 2 | PROG(프로그램 운전) | IS3 | ALM3 | T3 | T.WAIT | 온도 센서 단선 | SD 카드 삽입 |
| 3 | HOLD | IS4 | ALM4 | T4 | H.WAIT | | DIO1 통신 에러 |
| 4 | WAIT | IS5 | ALM5 | T5 | T.UP(온도 상승) | | DIO2 통신 에러 |
| 5 | TEMP.AT | IS6 | ALM6 | T6 | T.SOAK(온도 유지) | | DIO3 통신 에러 |
| 6 | HUMI.AT | IS7 | ALM7 | T7 | T.DOWN(온도 하강) | | DOO1 통신 에러 |
| 7 | | IS8 | ALM8 | T8 | H.UP | | DOO2 통신 에러 |
| 8 | | IS9 | | T9 | H.SOAK | 습도 +OVER | DOO3 통신 에러 |
| 9 | | IS10 | | T10 | H.DOWN | 습도 −OVER | 로그인 안 됨 |
| 10 | | IS11 | | | FEND(정치 종료) | 습도 센서 단선 | 보조채널 통신 에러 |
| 11 | | IS12 | | H1 | PTEND(패턴 종료) | | |
| 12 | | IS13 | | H2 | DRAIN | | S.CU 통신 에러 |
| 13 | | IS14 | | H3 | 1.REF(냉동기 1) | | |
| 14 | | IS15 | | H4 | 2.REF(냉동기 2) | | |
| 15 | | IS16 | | H5 | | 건구 PV OVER | |

`TEMI_DO_STS1`은 비트 0~15가 DO1~16, `TEMI_DI_DATA1`은 비트 0~15가 DI1~16이다.

---

## 3. 실제 값으로 확인한 것 (2026-11-24)

| 확인 | 근거 |
|---|---|
| TEMI 주소는 매뉴얼 **레지스터 표**가 맞다(예제 문장의 "NSP(D0003)", "MVOUT(D0005)"는 옛 기종 내용) | 주소 101(정치 온도 SP) = 2234 → 22.34°C, 주소 102(정치 습도 SP) = 125 → 12.5%로 표와 맞음 |
| TEMI 온도 배율 0.01 | `TEMI_TEMP_DP` = 2, 현재 온도 원본 2472 → 24.72°C |
| ST570 온도 배율 1 | `NOVA_IN_DP` = 0, 현재 온도 원본 25 |
| ST570 `NOW_STS` 비트 0 = 1이 정지 | 운전 설정 D0101 = 1(STOP)일 때 비트 0 = 1 |
| ST570 경보 비트 동작 | `NOVA_ALM_STS` = 17(비트 0·4): 경보 1 설정값 0, 현재 25°C → ALM1과 EVENT1 켜짐 |
| TEMI 내부 통신 비트 | `TEMI_COMM_ERR` = 1540(비트 2·9·10): SD 삽입, 로그인 안 됨, 보조채널 통신 에러 |
| TEMI 정지 상태 | `NOWSTS` = 1(RESET), `TEMI_DOCTR_STS` = 4096(비트 12 DRAIN) |

## 4. HMI 시험에 쓰기 좋은 조합

| 시험 | 레지스터 |
|---|---|
| 숫자·게이지 | `NOVA_NPV`, `NOVA_MV`, `TEMI_TEMP_NPV`, `TEMI_HUMI_NPV`, `TEMI_TEMP_NSP`, `TEMI_FIX_TEMP_SP`, `TEMI_HUMI_NSP` |
| 비트 램프·상태 표시 | `NOWSTS`(비트 0~4), `NOVA_NOW_STS`(비트 0·12·13), `NOVA_ALM_STS`, `TEMI_COMM_ERR`, `TEMI_DOCTR_STS` |
| 쓰기(버튼·스위치·입력) | TEMI: `TEMI_COM_OPMODE`(1 운전 / 4 정지), `TEMI_FIX_TEMP_SP`, `TEMI_FIX_HUMI_SP`, `TEMI_OP_MODE`. ST570: `NOVA_RS`(0 RUN / 1 STOP), `NOVA_AUTO_MAN`, `NOVA_MAN_MV`, `NOVA_SP_SEL`, `NOVA_SP1`~`SP4`, `NOVA_AL1` |
| 명령과 상태가 다른 레지스터 | 명령 `TEMI_COM_OPMODE` ↔ 상태 `NOWSTS` 비트 0~2, 명령 `NOVA_RS` ↔ 상태 `NOVA_NOW_STS` 비트 0 |
| 조합 조건(계산 태그) | "운전 중 그리고 경보 없음": `NOVA_NOW_STS` 비트 0 = 0 그리고 `NOVA_ALM_STS` = 0 |
| 경보 만들기 | `NOVA_AL1`을 현재 온도 위·아래로 바꾸면 `NOVA_ALM_STS` 비트 0이 바뀜 |

## 5. 알아 둘 점

- `PUT /api/registers/{id}`에 `displayName`을 빼고 보내면 표시 이름이 태그 이름으로 바뀌던 문제는 2026-11-24에 백엔드가 고쳤다(없으면 지금 값 유지, `docs/backend-register-put-displayname-response.md`).
- `NOVA_SP`(D0002, 현재 설정값)는 쓰기 허용으로 들어 있지만 매뉴얼상 PROCESS 그룹은 쓰기가 안 된다. 설정값을 바꾸려면 `NOVA_SP1`~`SP4`를 쓴다.
