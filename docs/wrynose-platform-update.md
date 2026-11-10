# SWR 플랫폼 업그레이드(Yocto wrynose) — 웹·백엔드 영향 정리

> 작성: 2026-11-10 (빌드/플랫폼)
> 대상: SWR 펌웨어팀(웹 UI `swr_web`, 백엔드 `swr`)
> 관련: `meta-swr` 저장소 `docs/testing-and-setup.md` "빌드 확인 현황", `referencs/api-spec.md` §10 시스템 시간

---

## 1. 무엇이 바뀌었나

SWR 게이트웨이 OS 이미지를 Yocto **walnascar → wrynose**로 올렸습니다. 앱 소스는 그대로이고, 이미지 빌드 때 새 환경에서 다시 컴파일됩니다.

| 항목 | 이전 (walnascar) | 지금 (wrynose) |
|---|---|---|
| 커널 | linux-imx 6.12 | linux-imx 6.18 |
| Qt | 6.8 | 6.11.2 |
| systemd | 257 | 259 |
| 크로스 컴파일 SDK | `/opt/imx6ull-core-sdk` (2026-05-07) | `/opt/imx6ull-core-sdk-wrynose` (SDR100과 공용) |

이전 SDK(`/opt/imx6ull-core-sdk`)는 빌드 PC에서 **삭제**했습니다.

그 밖에 이미지에서 달라진 점:
- 쓰지 않던 QML 관련 패키지(qtdeclarative, qtsvg, 약 32MB)를 뺐습니다. 앱은 QML을 쓰지 않으므로 영향이 없습니다.
- 부팅을 가볍게 하려고 다중 사용자 기능(logind, 로그인 기록 등)을 껐습니다. SSH와 시리얼 로그인은 그대로 됩니다.
- DNS(resolved)와 시간 서비스(timedated)는 앱이 쓰므로 유지합니다. ntpd도 그대로입니다.

## 2. 실기기 확인 결과 (2026-11-10, `swr-image-dev`)

이전 버전 확인 항목(2026-10-13)을 다시 확인했고, 아래 3절의 시간 설정을 빼면 모두 그대로 동작합니다.

- 웹 UI `/` 200, `POST /api/login` 정상(admin 로그인), 인증 없는 API 요청은 401
- swr, lighttpd, ntpd 실행 중, 실패한 서비스 없음
- eth1 192.168.0.150, DNS(`pool.ntp.org`) 정상, 시간대 KST
- RS485(ttymxc1) 송신 시 DMA 에러 없음. 장치를 연결하지 않아 실제 폴링은 확인하지 못했습니다.
- 외부 RTC 정상, 재부팅 정상(약 36초 뒤 다시 접속됨), 두 번째 부팅 21.6초(이전 18.6초)
- Modbus TCP 서버(502)는 앱 기본 설정이 `enabled: false`라 꺼져 있습니다(이전과 같음).

## 3. 시간 설정 — 확인이 필요한 부분

### 3.1 [백엔드 버그] 수동 시간 설정이 항상 409로 실패합니다

`PUT /api/system/time`은 NTP가 켜져 있는지 확인할 때 `timedatectl show` 출력에 `"NTP=yes"`라는 **글자가 들어 있는지**를 봅니다.
그런데 출력에는 항상 `CanNTP=yes` 줄이 있어서, NTP를 꺼도 켜져 있다고 판단합니다.

```text
CanNTP=yes      ← 여기에 "NTP=yes"가 들어 있음
NTP=no
NTPSynchronized=no
```

- 결과: 웹에서 NTP를 끄고 시간을 넣어도 항상 "NTP is active. Disable NTP before setting manual time."(409)이 나옵니다.
- 위치: `swr/api/ApiServer.cpp` `handlePutSystemTime()`의 `checkOut.contains(QLatin1String("NTP=yes"))`
- 고칠 방향: 같은 파일의 `handleGetSystemTime()`처럼 **줄 단위로 `startsWith("NTP=yes")`** 비교

이전 버전에도 같은 코드였으므로 업그레이드 때문에 생긴 문제는 아닐 가능성이 큽니다.

### 3.2 [백엔드] NTP 켜기/끄기가 실제로는 약 9초 걸립니다

`timedatectl set-ntp`는 ntpd를 켜거나 끄면서 systemd 설정을 다시 읽는데, 이 보드에서 **약 9초**가 걸립니다(systemd 259에서 느려짐).
백엔드는 `waitForFinished(5000)`으로 5초만 기다리고 결과를 확인하지 않은 채 200을 돌려줍니다.

- 결과: 웹은 "NTP 동기화가 꺼졌습니다"라고 표시하지만 실제로는 몇 초 뒤에 꺼집니다. 그 사이 시간을 설정하면 409가 납니다.
- 고칠 방향(백엔드): `handlePutSystemNtp()`에서 15~20초까지 기다리고, 끝나지 않았거나 종료 코드가 0이 아니면 오류를 돌려줍니다.
- 웹: 백엔드를 고치면 이 요청이 약 10초 걸립니다. 지금처럼 진행 표시(`showBusy`)를 띄우는 것으로 충분합니다. `apiFetch`와 lighttpd 프록시에는 시간 제한이 없어 끊기지 않습니다.

### 3.3 [새 동작] 2026-03-13 이전 시간은 설정할 수 없습니다

새 systemd는 OS 빌드 기준 시각(2026-03-13)보다 이른 시간으로는 시계를 맞추지 않습니다.

- 백엔드가 받는 오류: `Failed to set time: Requested to set the clock to time before build time, refusing.`
- 백엔드는 지금 이를 500(`timedatectl set-time failed: ...`)으로 돌려줍니다. 사용자 입력 문제이므로 **400과 알기 쉬운 메시지**로 바꾸는 것을 권장합니다.
- 웹: 수동 시간 입력(`#manualDatetimeInput`)에 `min="2026-03-13T00:00:00"`을 주거나 안내 문구를 추가하면 좋습니다. 이 기준일은 OS를 다시 빌드하면 늦어질 수 있습니다.

### 3.4 [새 동작] 새 보드는 "미동기화" 표시가 약 15분 이어집니다

시계 자체는 부팅 직후 NTP로 바로 맞춰집니다. 다만 ntpd가 처음에 약 15분 동안 보드 클럭을 측정한 뒤에야 "동기화됨" 상태가 됩니다.
측정값(drift 파일)이 아직 저장되지 않은 새로 플래싱한 보드에서 생기는 정상 동작입니다.

- 웹 설정 화면의 NTP 상태(`GET /api/system/info`의 `ntp.synced`)가 그동안 "● 미동기화"로 나옵니다.
- 시험할 때 고장으로 오해하지 않도록 알려 둡니다.

## 4. 백엔드(swr) 개발 환경

- **새 SDK로 바꿔야 합니다.** 다음 파일이 아직 삭제된 이전 SDK 경로(`/opt/imx6ull-core-sdk`)를 씁니다.
  - `scripts/deploy.sh`(17줄 `SDK_ENV`), `scripts/redeploy.sh`(18줄 `SDK_ENV` 기본값)
  - `CMakeLists.txt.user`, Qt Creator 킷 설정
- 새 SDK:
  ```sh
  source /opt/imx6ull-core-sdk-wrynose/environment-setup-cortexa7t2hf-neon-poky-linux-gnueabi
  ```
  Qt 6.11.2, Core/Network/HttpServer/SerialPort/SerialBus/Sql과 private 헤더(CorePrivate, 백업 ZIP용)가 들어 있습니다.
- 공용 SDK에는 SDR100용 라이브러리(libpinyin, libmodbus, libgpiod)도 있습니다. 앱이 이것에 링크하면 SWR 이미지에는 없어서 실행되지 않으니 쓰지 마세요.
- 이미지는 `swr` 저장소의 **작업 폴더를 그대로** 빌드합니다. 2026-11-10 이미지에는 그때 커밋하지 않은 수정 5개가 들어갔습니다:
  - `CMakeLists.txt`, `api/ApiServer.cpp`, `data_collection/comm/modbus/ModbusRTUClient.cpp`, `data_collection/database/DeviceDatabase.cpp`, `scripts/redeploy.sh`

## 5. 운영상 달라진 점

- SSH에서 `reboot`하면 아래 두 줄이 출력되지만 **재부팅은 정상**입니다(로그인 세션 관리 기능을 꺼서 생기는 메시지).
  ```text
  Failed to set wall message, ignoring: Unit dbus-org.freedesktop.login1.service failed to load properly ...
  Call to Reboot failed: Unit dbus-org.freedesktop.login1.service failed to load properly ...
  ```
- 같은 이유로 SSH 로그인 로그에 `pam_systemd ... Failed to create session` 경고가 남습니다. 무시해도 됩니다.

## 6. 요청 정리

| 담당 | 항목 | 우선순위 |
|---|---|---|
| 백엔드 | 3.1 수동 시간 설정 NTP 판정 수정(`startsWith`) | 높음 — 지금은 기능이 동작하지 않음 |
| 백엔드 | 3.2 NTP 켜기/끄기 대기 시간 늘리고 결과 확인 | 중간 |
| 백엔드 | 3.3 빌드 기준일 이전 시간 → 400 + 안내 메시지 | 낮음 |
| 백엔드 | 4 배포 스크립트와 Qt Creator를 새 SDK로 전환 | 높음 — 이전 SDK 삭제됨 |
| 웹 | 3.3 수동 시간 입력 최소값 또는 안내 문구 | 낮음 |
| 웹 | 3.4 "미동기화" 표시 안내(필요하면 도움말) | 낮음 |
