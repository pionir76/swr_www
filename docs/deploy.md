# 배포 규약

## 배포 대상

| 항목 | 값 |
|---|---|
| 기기 유형 | SmartRoute 임베디드 시스템 |
| IP 주소 | 192.168.0.150 |
| 웹서버 | lighttpd (내부 웹서버) |
| 배포 경로 | `/var/www/html/` |
| 접속 계정 | `root` |
| 접속 비밀번호 | `root` |
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

## 주의 사항

- `sshpass`가 설치되지 않은 환경이므로 반드시 **paramiko** 방식을 사용한다.
- lighttpd document root는 `/var/www/html/` 이다. `/var/www/`에 배포하면 반영되지 않는다.
- 배포 완료 후 디바이스가 자동 재부팅되며, 재부팅 완료 후 `http://192.168.0.150` 으로 접속한다.
- API 요청(`/api/*`)은 lighttpd가 Qt App(QHttpServer, 포트 8080)으로 프록시한다.
