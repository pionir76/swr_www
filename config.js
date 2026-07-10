// 기기(192.168.0.150)에서 직접 접속: 상대 경로 (lighttpd → Qt 프록시, 같은 오리진)
// 로컬 개발(Live Server 등): 기기 주소로 직접 호출 (lighttpd가 CORS 헤더 반환)
const API_BASE = location.hostname === "192.168.0.150"  ? ""  : "http://192.168.0.150";


// ── 인증 토큰 저장 ──────────────────────────────────────────────────────────────
// 백엔드는 쿠키가 아닌 Bearer 토큰 방식. /api/login, /api/logout 을 제외한
// 모든 API는 Authorization: Bearer <token> 헤더가 없으면 401을 반환한다.

const TOKEN_KEY = "smartroute_token";
const USER_KEY  = "smartroute_username";

function getToken()      { return localStorage.getItem(TOKEN_KEY); }
function setToken(t)     { localStorage.setItem(TOKEN_KEY, t); }
function getUsername()   { return localStorage.getItem(USER_KEY); }
function setUsername(u)  { localStorage.setItem(USER_KEY, u); }
function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// 토큰을 자동으로 Authorization 헤더에 넣어주는 fetch 래퍼.
// 페이지별 js (dashboard.js, devices.js 등)에서 API 호출 시 이 함수를 사용한다.
function apiFetch(path, options = {}) {
  const token   = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ── 전역 폴링 상태 ──────────────────────────────────────────────────────────────
// 장비/레지스터/시스템 설정 등 모든 변경 API는 폴링이 실행 중이면 거부된다.
// 정지/시작 컨트롤은 topbar 한 곳(main.js)에서만 제공하고, 각 페이지(devices.js 등)는
// subscribe()로 상태만 받아 저장/삭제 버튼을 비활성화하는 식으로 사용한다.
const PollingState = (() => {
  const POLL_INTERVAL_MS = 3000;
  let running = null; // null = 아직 확인 전
  let timer = null;
  const listeners = [];

  function notify() {
    listeners.forEach((fn) => fn(running));
  }

  async function refresh() {
    try {
      const res = await apiFetch("/api/polling/status");
      if (!res.ok) return;
      const data = await res.json();
      if (data.running !== running) {
        running = data.running;
        notify();
      }
    } catch {
      // 네트워크 오류 — 다음 주기에 재시도
    }
  }

  async function start() {
    try {
      const res = await apiFetch("/api/polling/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) return false;
      running = true;
      notify();
      return true;
    } catch {
      return false;
    }
  }

  async function stop(skipConfirm = false) {
    if (!skipConfirm && !window.confirm("폴링을 정지하면 모든 장비의 데이터 수집이 중단됩니다.\n계속하시겠습니까?")) {
      return false;
    }
    try {
      const res = await apiFetch("/api/polling/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) return false;
      running = false;
      notify();
      return true;
    } catch {
      return false;
    }
  }

  // 구독 시 이미 알고 있는 상태가 있으면 즉시 1회 전달한다.
  function subscribe(fn) {
    listeners.push(fn);
    if (running !== null) fn(running);
    return () => {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  function startPolling() {
    if (timer) return;
    refresh();
    timer = setInterval(refresh, POLL_INTERVAL_MS);
  }

  return {
    subscribe,
    start,
    stop,
    startPolling,
    get running() { return running; },
  };
})();

// ── PageLoader ────────────────────────────────────────────────────────────────
// 페이지 첫 로딩 중 오버레이 표시, 성공 시 콘텐츠 공개, 실패 시 에러 안내.
// 각 페이지 JS에서 show() → (fetch) → hide(contentEl) 또는 showError(msg, fn) 호출.
const PageLoader = (() => {
  const overlay  = $('#pageOverlay');
  const loadEl   = $('#pageOverlayLoading');
  const errorEl  = $('#pageOverlayError');
  const msgEl    = $('#pageOverlayMsg');
  const retryBtn = $('#pageOverlayRetry');

  let _retryFn           = null;
  let _showTime          = 0;
  let _hideTimer         = null;
  let _pendingTransition = false;
  const MIN_SHOW_MS      = 300;

  retryBtn?.addEventListener('click', () => _retryFn?.());

  function _showOverlay() {
    loadEl.hidden  = false;
    errorEl.hidden = true;
    overlay.hidden = false;
  }

  // loadPage()가 호출 — 전환 구간을 오버레이로 덮음. 소유권은 전환 중.
  function beginTransition() {
    if (!overlay) return;
    clearTimeout(_hideTimer);
    _hideTimer         = null;
    _pendingTransition = true;
    _showTime          = Date.now();
    _showOverlay();
  }

  // 각 페이지 IIFE가 호출 — 소유권을 페이지 JS로 이전.
  function show() {
    if (!overlay) return;
    clearTimeout(_hideTimer);
    _hideTimer         = null;
    _pendingTransition = false;
    _showTime          = Date.now();
    _showOverlay();
  }

  function hide(contentEl) {
    if (!overlay) return;
    clearTimeout(_hideTimer);   // 기존 대기 타이머 취소
    const elapsed = Date.now() - _showTime;
    const delay   = Math.max(0, MIN_SHOW_MS - elapsed);
    _hideTimer = setTimeout(() => {
      _hideTimer     = null;
      overlay.hidden = true;
      if (contentEl) contentEl.hidden = false;
    }, delay);
  }

  // 스크립트 load 이벤트에서 호출 — 페이지 JS가 show()를 부르지 않은 경우에만 닫음.
  function hideIfTransition() {
    if (_pendingTransition) hide(null);
  }

  function showError(msg, retryFn) {
    if (!overlay) return;
    loadEl.hidden     = true;
    msgEl.textContent = msg ?? '서버에 연결할 수 없습니다.';
    _retryFn          = retryFn ?? null;
    retryBtn.hidden   = !retryFn;
    errorEl.hidden    = false;
  }

  return { beginTransition, show, hide, showError, hideIfTransition };
})();

// ── 레지스터 값 공통 포맷터 ───────────────────────────────────────────────────
// 모든 페이지(dashboard, realtime, registers 등)에서 동일한 표현을 보장한다.
const RegFmt = (() => {
  // scale → 소수점 자릿수 (0.1 → 1, 0.01 → 2, 1 → 0 …)
  function decimalsFromScale(scale) {
    if (scale == null || scale <= 0) return 0;
    return Math.max(0, -Math.round(Math.log10(scale)));
  }

  // 스케일 적용 후 fixed-point 문자열 반환. bitLabels 가 있으면 0xHHHH 헥사.
  function value(v, reg) {
    if (v == null) return '—';
    const n = Number(v);
    if (!isFinite(n)) return '—';
    if (reg?.bitLabels) {
      return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(4, '0');
    }
    return n.toFixed(decimalsFromScale(reg?.scale));
  }

  // Modbus 주소 5자리 0-패딩 (0 → "00000", 2 → "00002")
  function address(addr) {
    return addr != null ? String(addr).padStart(5, '0') : '—';
  }

  return { value, address };
})();
