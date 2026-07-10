# SmartRoute Web UI

SmartRoute 임베디드 통신 변환 디바이스의 관리·모니터링용 정적 웹 프론트엔드입니다.

---

## 시스템 개요

SmartRoute는 NXP i.MX6ULL 기반 임베디드 리눅스 디바이스로, 다수의 범용 장비(PLC, 계측기 등)로부터 Modbus RTU/TCP/ASCII 프로토콜을 통해 데이터를 수집하고 이를 웹 UI 및 외부 Modbus TCP 클라이언트에 제공합니다.

```
외부 장비 (Modbus RTU/TCP)
       │
       ▼
  PollingManager (Qt)
       │  수집·갱신
       ▼
  RegisterTable (메모리)
       │
  ┌────┴──────────────────┐
  │                       │
  ▼                       ▼
QHttpServer           Modbus TCP Server
(REST API, :8080)     (외부 클라이언트)
  │
lighttpd proxy (/api/*)
  │
  ▼
Web UI (정적 HTML/CSS/JS)
```

---

## 기술 스택

| 구분 | 내용 |
|---|---|
| 하드웨어 | NXP i.MX6ULL, RS485 × 1, Ethernet × 2 (switching hub) |
| 백엔드 | Qt (QCoreApplication headless), QHttpServer, SQLite |
| 웹서버 | lighttpd (정적 파일 서빙, `/api/*` → Qt App 프록시) |
| 프론트엔드 | Vanilla HTML / CSS / JavaScript (프레임워크 없음) |
| 통신 프로토콜 | Modbus RTU, Modbus TCP, Modbus ASCII, PCLink ASCII |

---

## 프로젝트 구조

```
swr_web/
├── index.html          # 앱 셸 (사이드바, 상단바, 페이지 컨테이너)
├── login.html          # 로그인 전용 독립 페이지
├── main.js             # SPA 라우터, CSS/JS 동적 로드, 전역 상태
├── config.js           # API_BASE, apiFetch, $/$$ DOM 헬퍼, PollingState, RegFmt
├── style.css           # 공통 디자인 시스템 (CSS 변수, 레이아웃, 컴포넌트)
├── css/                # 페이지별 전용 스타일
├── js/                 # 페이지별 전용 스크립트
├── pages/              # 페이지별 HTML 마크업
├── assets/
│   └── icons/          # SVG 아이콘 (CSS mask-image 방식으로 적용)
├── docs/               # 설계 문서, 아키텍처, 배포 규약
├── referencs/          # 백엔드 참조 소스 (ApiServer.cpp/h)
├── deploy.py           # 디바이스 배포 스크립트 (Python paramiko SFTP)
└── dev_restore.py      # 개발 환경 복구 스크립트
```

---

## 주요 기능

| 페이지 | 기능 | 상태 |
|---|---|---|
| 대시보드 | 시스템 요약 현황 (장비 상태, 레지스터 수, 알람) | 완료 |
| 장비 관리 | Modbus RTU/TCP 장비 등록·수정·삭제, 통신 파라미터 설정 | 완료 |
| 레지스터 관리 | 장비별 레지스터 등록·수정·삭제, 비트 라벨·스케일·단위 설정 | 완료 |
| 실시간 모니터링 | 통합 레지스터 테이블 실시간 조회, 쓰기 지원, 비트 상태 표시 | 완료 |
| 시스템 설정 | 네트워크(eth0/eth1), RS485, Modbus TCP 서버, NTP 설정 | 완료 |
| 사용자 관리 | 계정 등록·수정·삭제, 역할 기반 권한, 보안 정책 | 완료 |
| 로그 | 시스템 로그 조회 (레벨 필터, 날짜 범위 조회) | 완료 |
| 트렌드 | 선택 레지스터 시계열 데이터 기록 및 그래프 조회 | 2차 예정 |
| HMI 빌더 | 사용자 정의 화면 구성 (레지스터 → 위젯 매핑) | 2차 예정 |

---

## 특이사항

### Hash 기반 SPA 라우터
프레임워크 없이 구현된 단일 페이지 애플리케이션입니다. URL 해시(`#dashboard`, `#realtime` 등)가 바뀔 때 `main.js`가 해당 페이지 HTML을 `fetch()`로 동적 로드하고, 페이지별 CSS와 JS 태그를 `<head>`에 주입합니다. 페이지 전환 시 이전 페이지의 CSS/JS 태그는 자동 제거됩니다.

### 통합 레지스터 주소 체계
다수 장비의 레지스터를 단일 테이블로 통합합니다. 내부 `unifiedAddress`(1~5999)에 40000을 더한 값을 화면에 표시합니다(예: `unifiedAddress=1` → 표시 `40001`). 1~4999는 자동 할당, 5000~5999는 수동 지정 범위입니다. 이 체계는 외부 Modbus TCP 클라이언트가 표준 4xxxx 주소 표기법으로 내부 데이터를 읽을 수 있도록 설계된 것입니다.

### 비트 라벨 (Bit Labels)
Word 타입 레지스터에 `{"0":"운전중","1":"경보","7":"준비완료"}` 형태의 JSON을 설정하면, 실시간 모니터링 상세 패널에서 각 비트의 ON/OFF 상태를 라벨과 함께 표시합니다.

### SVG 아이콘 적용 방식
아이콘은 `<i class="nav-icon nav-icon--{name}">` + CSS `mask-image: url(...)` + `background: currentColor` 조합으로 적용합니다. 이 방식은 CSS `color` 속성을 그대로 상속하므로 active/hover/collapsed 등 모든 상태에서 색상이 자동으로 바뀝니다.

### 폴링 상태 표시
백엔드 폴링이 활성화(LIVE)되면 `body.polling-live` 클래스가 추가되고, 상단 바 하단에 초록색 스캔 라인 애니메이션이 표시됩니다. 폴링이 정지(IDLE)되면 사라집니다.

### config.js API_BASE 패치
개발 환경에서는 `config.js`의 `API_BASE`가 `http://127.0.0.1:5500`(Live Server)로 설정되어 있습니다. 배포 스크립트(`deploy.py`)가 업로드 시 해당 값을 빈 문자열(`""`)로 자동 패치하여 프로덕션에서 상대 경로로 동작하도록 합니다.

### 전역 DOM 헬퍼
`config.js`에 정의된 `$('#id')` (= `document.querySelector`)와 `$$('.cls')` (= `document.querySelectorAll`)를 전 페이지에서 일관되게 사용합니다.

---

## 배포

디바이스(192.168.0.150)에 Python paramiko SFTP로 배포합니다. `sshpass`를 사용하지 않습니다.

```bash
python3 deploy.py
```

배포 흐름:
1. 소스 파일 SFTP 업로드 → `/var/www/html/` (`config.js` API_BASE 패치 포함)
2. lighttpd CORS Origin 수정 (개발 → 프로덕션)
3. 디바이스 재부팅 (약 30~60초 후 `http://192.168.0.150` 접속)

개발 환경 복구:

```bash
python3 dev_restore.py
```

---

## 로컬 개발 환경

```bash
# 간단한 정적 서버로 실행
python3 -m http.server 5500
```

또는 VS Code Live Server 플러그인으로 실행합니다. API 요청은 `config.js`의 `API_BASE`를 통해 디바이스(`http://192.168.0.150:8080`)로 프록시됩니다.

---

## 라이선스

Copyright © 2026 Samwontechnology Inc. All rights reserved.
