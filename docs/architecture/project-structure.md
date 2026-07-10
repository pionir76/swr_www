# SmartRoute Web UI

밝은 다크 테마 기반의 SmartRoute 정적 웹 UI입니다.

## 구조

```text
index.html
login.html
main.js
config.js
style.css
css/
  login.css
  dashboard.css
  devices.css
  registers.css
  realtime.css
  settings.css
  users.css
  logs.css
  trends.css
  hmi.css
js/
  login.js
  dashboard.js
  devices.js
  registers.js
  realtime.js
  settings.js
  users.js
  logs.js
  trends.js
  hmi.js
pages/
  dashboard.html
  devices.html
  registers.html
  realtime.html
  settings.html
  users.html
  logs.html
  trends.html
  hmi.html
docs/
  spec.md
  deploy.md
  design-concepts/
  architecture/
  policy/
  reference/
```

## 라우팅 방식

`main.js`가 hash 기반 SPA 라우터 역할을 한다.

- URL 해시(`#dashboard`, `#devices` 등) 변경 시 해당 페이지 HTML을 `fetch()`로 동적 로드
- 페이지 전환 시 해당 페이지의 CSS(`./css/{page}.css`)와 JS(`./js/{page}.js`)를 동적으로 주입
- 이전 페이지의 CSS/JS 태그는 전환 시 자동 제거

## 파일 역할

| 파일 | 역할 |
|---|---|
| `index.html` | 앱 셸 (사이드바, 상단바, 페이지 컨테이너) |
| `login.html` | 로그인 전용 독립 페이지 |
| `main.js` | SPA 라우터, 페이지별 CSS/JS 동적 로드 |
| `config.js` | API_BASE 설정, apiFetch/$/$$/$$ 헬퍼, PollingState, PageLoader, RegFmt |
| `style.css` | 공통 디자인 시스템 (CSS 변수, 레이아웃, 공통 컴포넌트) |
| `css/{page}.css` | 페이지별 전용 스타일 |
| `js/{page}.js` | 페이지별 전용 스크립트 (API 연동 등) |
| `pages/{page}.html` | 페이지별 HTML 마크업 |

## 실행

정적 파일이므로 lighttpd의 document root에 그대로 복사해서 사용할 수 있습니다.

로컬 확인 시에는 브라우저에서 `index.html`을 열거나 간단한 정적 서버로 실행하세요.

```bash
python3 -m http.server 8088
```

그 후 브라우저에서:

```text
http://localhost:8088
```

## 구현 현황

| 페이지 | HTML | CSS | JS | 상태 |
|---|---|---|---|---|
| 로그인 | login.html | login.css | login.js | 구현 완료 |
| 대시보드 | dashboard.html | dashboard.css | dashboard.js | 구현 완료 |
| 장비 관리 | devices.html | devices.css | devices.js | 구현 완료 |
| 레지스터 관리 | registers.html | registers.css | registers.js | 구현 완료 |
| 실시간 모니터링 | realtime.html | realtime.css | realtime.js | 구현 완료 |
| 시스템 설정 | settings.html | settings.css | settings.js | 구현 완료 |
| 사용자 관리 | users.html | users.css | users.js | 구현 완료 |
| 로그 | logs.html | logs.css | logs.js | 구현 완료 |
| 트렌드 | trends.html | trends.css | trends.js | 구현 예정 (2차) |
| HMI 빌더 | hmi.html | hmi.css | hmi.js | 구현 예정 (2차) |
