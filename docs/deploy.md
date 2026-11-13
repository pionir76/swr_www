# 배포 규약

## 배포 대상

| 항목 | 값 |
|---|---|
| 기기 유형 | SmartRoute 임베디드 시스템 |
| IP 주소 | 192.168.0.150 — 필드 포트(위쪽 RJ45, 리눅스 `eth1`). 서비스 포트(아래쪽, `eth0`)는 192.168.1.150 — 유지보수 노트북은 192.168.1.x로 직결 |
| 웹서버 | lighttpd (내부 웹서버) |
| 배포 경로 | `/var/www/html/` |
| 접속 계정 | `root` |
| 접속 비밀번호 | 저장소에 적지 않음 — 환경변수 `SWR_ROOT_PASS` 또는 실행 시 입력 (2026-11-13 이미지부터 레거시 제품과 같은 값) |
| 전송 방식 | SFTP (Python paramiko) |

## 배포 명령

프로젝트 루트(`/home/dev3/project/swr_web`)에서 아래 명령을 실행한다.

```bash
python3 deploy.py
```

## 배포 흐름

```
[1/3] 파일 SFTP 업로드 → /var/www/html/
       config.js: API_BASE="" 패치 적용
[2/3] lighttpd.conf CORS Origin 수정
       개발: http://127.0.0.1:5500 → 프로덕션: http://192.168.0.150
[3/3] 디바이스 재부팅 (reboot)
       약 30~60초 후 http://192.168.0.150 으로 접속
```

## 배포 제외 항목

| 대상 | 이유 |
|---|---|
| `docs/` | 문서 및 디자인 컨셉 이미지 — 서비스 불필요 |
| `referencs/` | 백엔드 참조 소스 — 서비스 불필요 |
| `*.md` | 문서 파일 |
| `deploy.py` | 배포 스크립트 자체 |
| `dev-server.py` | 개발용 서버 스크립트 |
| `.claude/` | 개발 도구 설정 |

## 배포 대상 파일 구조

```text
/var/www/html/
├── index.html
├── main.js
├── config.js        ← API_BASE="" 패치 적용
├── style.css
├── css/
│   └── ... (페이지별 CSS)
├── js/
│   └── ... (페이지별 JS)
└── pages/
    └── ... (페이지별 HTML)
```

## 장치 이미지에 들어가는 웹 파일

장치 OS 이미지는 `swr_web` **작업 폴더를 그대로** 넣는다(제외: `.git`, `docs`, `referencs`, `webtest*`, `*.md`, `deploy.py`).

- 커밋하지 않은 수정도 이미지에 들어간다 — 이미지 빌드 요청 전에 커밋한다.
- 시안·임시 파일은 저장소 밖에 둔다(2026-11-10~11 이미지에 `design-mockup/`이 들어간 적 있음).
- 비밀번호 등 비밀 정보가 담긴 파일을 저장소 폴더에 두지 않는다(웹 루트로 그대로 서비스됨).

## 주의 사항

- `sshpass`가 설치되지 않은 환경이므로 반드시 **paramiko** 방식을 사용한다.
- lighttpd document root는 `/var/www/html/` 이다. `/var/www/`에 배포하면 반영되지 않는다.
- 배포 완료 후 디바이스가 자동 재부팅되며, 재부팅 완료 후 `http://192.168.0.150` 으로 접속한다.
- API 요청(`/api/*`)은 lighttpd가 Qt App(QHttpServer, 포트 8080)으로 프록시한다.
