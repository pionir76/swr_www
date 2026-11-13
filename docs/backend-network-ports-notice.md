---
from: backend
to: frontend
status: done
waiting_on: none
---

# 이더넷 포트 — 앱 설정 폐지와 상태 조회 API (백엔드 안내)

> 작성: 2026-11-13 (백엔드)
> 대상: 프론트엔드
> 관련: `referencs/api-spec.md` §8 `GET /api/config`·`PUT /api/config/network`, §9 `GET /api/system/network`, `referencs/api-changelog.md` 2026-11-13, 빌드팀 `meta-swr/docs/hardware.md` "이더넷 포트"

---

## 1. 요약

정식 PCB에서 이더넷 포트 주소는 **OS 이미지가 고정**합니다. 앱의 네트워크 설정 화면은 지금까지 설정 파일에 저장만 하고 실제로는 적용되지 않았습니다. 그래서 다음과 같이 정리했습니다.

- 네트워크 설정 **변경 기능은 폐지**했습니다. `PUT /api/config/network`는 항상 410을 돌려줍니다.
- 포트의 **실제 상태를 읽는 API**를 추가했습니다(`GET /api/system/network`).
- 기존 화면이 바로 바르게 보이도록, `GET /api/config`의 `network`도 실제 상태로 바꿨습니다. 모양은 그대로입니다.

## 2. 용어 (확정)

| 화면 용어 | 위치 | API `role` | 리눅스 이름 | 주소 |
|---|---|---|---|---|
| **필드 포트** | 위쪽 RJ45 | `field` | `eth1` | 192.168.0.150/24, GW 192.168.0.1 |
| **서비스 포트** | 아래쪽 RJ45 | `service` | `eth0` | 192.168.1.150/24, GW 없음 |

- 리눅스 이름은 커널이 붙이는 순서라 **위아래와 반대**입니다. 화면에는 `eth0`/`eth1`을 쓰지 말고 필드 포트·서비스 포트로 표시해 주세요. 지금 `config.js`의 `PORT_ROLE`이 이미 그렇게 되어 있습니다.
- 두 포트는 서로 다른 망입니다. 유지보수 노트북은 서비스 포트에 192.168.1.x로 연결합니다.

## 3. API 변경

| API | 변경 |
|---|---|
| `GET /api/system/network` | **신규.** `ports[0]` = 필드 포트, `ports[1]` = 서비스 포트. 주소, 링크(케이블), 속도, MAC, 게이트웨이, DNS, 누적 트래픽 |
| `GET /api/config` → `network.interfaces` | 설정 파일 값 대신 **실제 포트 상태**. 순서는 필드 → 서비스, `name`은 실제 리눅스 이름. 지금까지는 `eth0 = field`로 반대로 나왔습니다 |
| `PUT /api/config/network` | **폐지.** 항상 410 |
| `POST /api/config/reset` | 응답에서 `network`가 빠졌습니다 |
| 백업 | 네트워크 설정을 넣지 않습니다 |
| 복원 | `options.network` 폐지(보내도 무시). validate의 `config.warning`("Network settings will NOT be restored ...")도 없어졌습니다 |
| `GET /api/system/resources` → `network` | 그대로 리눅스 이름 키입니다(`eth1` = 필드, `eth0` = 서비스) |

## 4. 지금 화면에 생기는 일 (프론트 수정 전)

| 화면 | 동작 |
|---|---|
| 대시보드 네트워크 카드 | 바르게 보입니다. `interfaces[0]`이 이제 실제 필드 포트입니다 |
| 설정 › 네트워크 카드 | 내용은 맞게 채워집니다(이름으로 찾기 때문). 다만 카드가 `data-iface="eth0"`(위), `eth1`(아래)이라서 **서비스 포트가 위, 필드 포트가 아래**에 나옵니다 |
| 설정 › 네트워크 저장 | **410 오류**가 납니다 |
| 설정 › 리소스 트래픽 | 이름으로 역할을 찾으므로 바르게 표시됩니다 |
| 복원 화면 | 변화 없음. "네트워크 설정" 옵션 행은 validate 응답에 `network` 항목이 없어서 원래도 표시되지 않았습니다 |

## 5. 프론트에서 할 일

1. **설정 › 네트워크를 "보기 전용"으로 바꿔 주세요.**
   - 입력 칸, 사용 여부 체크, DHCP 선택, 저장 버튼을 없애 주세요.
   - `GET /api/system/network`로 표시해 주세요. 권장 항목: 포트 이름, 케이블 연결(`linkUp`), 속도(`speedMbps`·`duplex`), IP/마스크, 게이트웨이, MAC, 누적 송수신.
   - 안내 문구 예: "포트 주소는 장치에 고정되어 있습니다."
2. **카드 순서:** 필드 포트(위쪽) → 서비스 포트(아래쪽). `data-iface` 대신 `ports[]` 순서나 `role`로 그려 주세요.
3. **복원 화면(정리만):** `js/settings.js`의 복원 옵션 목록(`ITEMS`)에 있는 `network` 항목과, 복원 요청의 `options.network`는 지워도 됩니다. 원래도 표시되지 않았고, 보내도 무시합니다.
4. **MAC 표시:** 지금 시제품 보드는 MAC이 기록되어 있지 않아 **부팅할 때마다 바뀝니다**(양산 때 기록 예정). 표시는 하되 장치 식별용으로는 쓰지 마세요.
5. **문서:** 프론트 문서(`docs/architecture/data-collection.md`, `docs/reference/system-monitoring.md`, `docs/architecture/backup-restore.md`, `docs/architecture/ui-layout.md`, `docs/deploy.md`)의 `eth0`/`eth1` 설명과 네트워크 설정 기능 설명을 위 용어로 맞춰 주세요. 프론트 담당 문서라 백엔드는 손대지 않았습니다.

## 6. 참고

- 백엔드는 포트를 리눅스 이름이 아니라 보드 위치로 찾습니다. 플랫폼 장치 `2188000.ethernet`이 필드 포트, `20b4000.ethernet`이 서비스 포트입니다. 이미지의 네트워크 설정(`meta-swr` `swr-network-config`)과 같은 기준이라, 이름 순서가 바뀌어도 역할은 틀리지 않습니다.
- `config.json`에 남아 있는 옛 `network` 항목은 무시되고, 다음에 설정을 저장할 때 지워집니다.
