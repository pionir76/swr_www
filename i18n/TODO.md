# 다국어 지원(i18n) 작업 목록

> 최종 지원 목표: 한국어(ko, 기본) / 영어(en) / 일본어(ja) / 중국어(zh)
> 작성일: 2026-09-08

---

## 아키텍처 요약 (다시 시작할 때 참고)

- 번들러/프레임워크 없는 순수 정적 HTML/CSS/JS 구조. 사전 파일은 `i18n/<lang>.json` (flat key-value, 점(`.`)으로 네임스페이스 구분: `nav.dashboard`, `common.logout` 등).
- `i18n.js` (루트, `config.js`/`main.js`와 같은 레벨)가 전역 `I18n` 객체 제공:
  - `I18n.t(key, vars)` — 사전 조회, `{var}` 치환, 키 없으면 키 자체를 그대로 반환(누락 표시).
  - `I18n.applyI18n(root)` — `root` 안의 `[data-i18n]`(textContent), `[data-i18n-placeholder]`, `[data-i18n-title]` 요소를 치환.
  - `I18n.setLanguage(lang)` — localStorage(`smartroute_lang`) 저장 + 사전 재로드 + `<html lang>` 갱신 + `applyI18n(document)`.
  - `I18n.init()` — 최초 로드 시 저장된 언어의 사전을 불러옴.
- `index.html` 상단바 `.topbar-info` 우측 끝에 `#langSelect` (한국어/English/日本語/中文).
- `main.js`:
  - `DOMContentLoaded`에서 `I18n.init()` → `applyI18n(document)` → `#langSelect` 초기값/change 리스너(`I18n.setLanguage()` 성공 시 `loadPage(getCurrentPage())`로 현재 페이지 재로드).
  - `loadPage()`가 매번 호출될 때마다(실제 메뉴 이동이든, 언어 전환으로 같은 페이지를 재로드하는 경우든) **`window.dispatchEvent(new CustomEvent('spa:beforeload'))`** 를 가장 먼저 쏨. 그리고 `pageRoot.innerHTML` 교체 직후 `I18n.applyI18n(pageRoot)` 호출.
- 각 페이지 스크립트(`js/*.js`)에서 `setInterval`/`PollingState.subscribe` 등 지속 리소스를 쓰면 **반드시** `window.addEventListener('spa:beforeload', cleanupFn, { once: true })`로 정리해야 함 — 기존에 `hashchange` 기반으로 하던 정리 방식은 언어 전환처럼 "같은 페이지를 재로드"하는 경우 해시가 안 바뀌어서 놓친다. (`trends.js`/`realtime.js`/`devices.js`/`dashboard.js`/`settings.js`는 이미 이 패턴으로 전환 완료 — 새 페이지에 타이머 추가할 때 반드시 이 패턴 참고.)

---

## Phase 1 — 인프라 구축 ✅ 완료 (2026-09-08)

- [x] `i18n/ko.json`, `en.json`, `ja.json`, `zh.json` (셸 텍스트만 채움: `nav.*`, `common.*`, `topbar.*`)
- [x] `i18n.js` 전역 모듈
- [x] `index.html`: 언어 select, 셸 요소 `data-i18n` 부여
- [x] `main.js`: `applyI18n` 훅, 언어 변경 시 페이지 재로드, `spa:beforeload` 이벤트 도입
- [x] (부수 발견 및 수정) 언어 전환 재로드 시 `trends.js`/`realtime.js` 폴링 타이머 중복 실행되던 회귀 버그 → `spa:beforeload`로 통일해 해결
- [x] (부수 발견 및 수정) 원래부터 있던 리소스 누수 3건도 같이 정리:
  - `dashboard.js`: `setInterval(fetchSysInfo, 30000)` 전혀 정리 안 되던 것 수정
  - `settings.js`: `setInterval(loadSystemResources/loadRecordingGuardState, 8000)` 2건 + `PollingState.subscribe` 2건 전혀 정리 안 되던 것 수정
  - `devices.js`: 기존 `hashchange` teardown을 `spa:beforeload`로 전환
- [x] Playwright로 4개 언어 전환/새로고침 지속성/타이머 중복 없음 검증

---

## Phase 2 — 페이지별 전환 (미착수)

각 페이지마다 순서: (a) `pages/*.html` 정적 텍스트에 `data-i18n` 부여 → (b) 사전 4개 파일(ko/en/ja/zh)에 키 추가 → (c) `js/*.js` 안에 하드코딩된 `showMsg()`/`alert()`/`confirm()`/템플릿 문자열을 `I18n.t()` 호출로 교체 → (d) 동작 확인(4개 언어 다 클릭해보기).

우선순위(예상 작업량 = 파일 내 한글 텍스트 줄 수, JS+HTML 합산):
- [ ] `login` (최초 진입점 — 아직 미조사, `index.html`이 아닌 별도 `login.html`이라 언어 select가 없음. 이 페이지는 자체적으로 `localStorage`의 저장된 언어를 읽어 반영하는 처리가 별도로 필요)
- [ ] `dashboard` (js 34줄 + html 64줄)
- [ ] `realtime` (js 22줄 + html 91줄)
- [ ] `devices` (js 79줄 + html 45줄)
- [ ] `registers` (js 71줄 + html 87줄)
- [ ] `users` (js 32줄 + html 75줄)
- [ ] `logs` (js 11줄 + html 16줄)
- [ ] `hmi` (js 0줄 + html 5줄 — 거의 없음, 마지막에 가볍게)
- [ ] `settings` (js 149줄 + html 145줄 — 가장 큼, 여러 탭으로 쪼개서 진행 권장: 네트워크/유지보수/트렌드 탭 각각 별도 단계로)
- [ ] `trends` (js 202줄 + html 21줄 — 가장 큼, 특히 JS 안에서 동적으로 그리는 텍스트가 많음: 채널 카드, 파일 목록 메타정보, 상태 패널 등)

각 페이지 작업 완료 후 이 목록에 체크 표시.

---

## Phase 3 — 일본어/중국어 번역 채우기 (미착수)

- [ ] Phase 2에서 각 페이지마다 늘어난 키들에 대해 ja/zh 번역 추가 (Phase 2 진행과 동시에 채워도 되고, 한/영만 먼저 끝내고 몰아서 해도 됨 — 페이지 수가 많으니 몰아서 하는 걸 권장)
- [ ] 중국어/일본어 특유의 텍스트 길이 차이로 버튼/라벨/테이블 헤더 레이아웃 깨지는 곳 확인 (특히 `settings.js`의 좁은 컬럼들, `trends.js`의 툴바 버튼)
- [ ] 날짜/숫자 포맷 로케일 처리 확인 (`toLocaleString()`, 수동 `formatDate` 계열 함수들 — 현재 전부 한국식 표기를 하드코딩하고 있음)

---

## Phase 4 — 마무리 / QA (미착수)

- [ ] 4개 언어 × 전체 페이지 순회 검증 (스크린샷 비교 또는 수동 체크리스트)
- [ ] 백엔드 에러 메시지(`d.error`, `err.message`) 다국어 처리 방침 결정 — 지금은 백엔드가 사람이 읽는 영어 문자열을 그대로 주기 때문에 다국어가 안 됨. 완전히 하려면 에러 코드 기반으로 백엔드 API를 바꿔야 하므로 별도 협의 필요. (당장은 범위 제외하고 있음.)
- [ ] 사전 파일 유지보수 가이드 정리 — 새 페이지/문구 추가할 때 어떤 절차를 따라야 하는지.

---

## 재개 시 체크리스트

1. 이 파일의 Phase 진행 상황부터 확인.
2. `git log`/`git status`로 마지막 작업 이후 변경된 게 있는지 확인 (특히 `i18n.js`, `main.js`의 `spa:beforeload` 관련 로직이 이후 다른 작업으로 바뀌었는지).
3. Phase 2 페이지 우선순위는 고정이 아니라 제안이므로, 재개 시점에 사용 빈도/중요도가 바뀌었으면 순서 조정 가능.
