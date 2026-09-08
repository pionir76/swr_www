const pageRoot     = $("#pageRoot");
const navMenu      = $("#navMenu");
const menuButton   = $("#menuButton");
const userBtn      = $("#userBtn");
const userLabel    = $("#userLabel");
const userDropdown = $("#userDropdown");
const logoutBtn    = $("#logoutBtn");
const topbarTime   = $("#topbarTime");
const pollingPill     = $("#pollingPill");
const pollingDot      = $("#pollingDot");
const pollingPillText = $("#pollingPillText");

// ── Sidebar toggle ────────────────────────────────────────────────────────────

if (localStorage.getItem("sidebarCollapsed") === "1") {
  document.body.classList.add("sidebar-collapsed");
}

menuButton.addEventListener("click", () => {
  document.body.classList.toggle("sidebar-collapsed");
  localStorage.setItem(
    "sidebarCollapsed",
    document.body.classList.contains("sidebar-collapsed") ? "1" : "0"
  );
});

const topbarOkCount  = $("#topbarOkCount");
const topbarErrCount = $("#topbarErrCount");

const pageMap = {
  dashboard: "dashboard.html",
  devices:   "devices.html",
  registers: "registers.html",
  realtime:  "realtime.html",
  settings:  "settings.html",
  users:     "users.html",
  logs:      "logs.html",
  trends:    "trends.html",
  hmi:       "hmi.html",
};

// ── 장비 상태 요약 (topbar) ───────────────────────────────────────────────────

async function refreshDeviceStatusSummary() {
  try {
    const res = await apiFetch("/api/devices/status");
    if (!res.ok) return;
    const data = await res.json();
    const devices = data.devices ?? [];
    let ok = 0, err = 0;
    for (const d of devices) {
      if (d.state === "ok")         ok++;
      else if (d.state === "error") err++;
    }
    if (topbarOkCount)  topbarOkCount.textContent  = ok;
    if (topbarErrCount) topbarErrCount.textContent  = err;
  } catch {
    // 네트워크 오류 시 기존 값 유지
  }
}

// ── Clock ─────────────────────────────────────────────────────────────────────

function tickClock() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  topbarTime.textContent =
    `◷ ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

const Auth = {
  async checkSession() {
    const token = getToken();
    if (!token) return false;

    try {
      const res = await apiFetch("/api/session");
      if (!res.ok) {
        clearAuth();
        return false;
      }
      const data = await res.json();
      if (data.valid) {
        userLabel.textContent = getUsername() ?? "-";
        return true;
      }
    } catch {
      // 네트워크 오류 — 토큰 유지한 채 실패로 처리 (재시도 가능하도록)
      return false;
    }

    clearAuth();
    return false;
  },

  async logout() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(`${API_BASE}/api/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      });
    } catch {
      // 오류 무시 — 어떤 경우에도 로그인 페이지로 이동
    } finally {
      clearTimeout(timer);
    }

    clearAuth();
    window.location.replace("./login.html");
  },
};

// ── 전역 폴링 상태 (topbar) ───────────────────────────────────────────────────

function updatePollingPill(running) {
  if (running === null) {
    pollingPillText.textContent = "CHECKING…";
    pollingDot.className = "dot";
    return;
  }
  if (running) {
    pollingPillText.textContent = "LIVE";
    pollingDot.className = "dot green";
    document.body.classList.add("polling-live");
  } else {
    pollingPillText.textContent = "IDLE";
    pollingDot.className = "dot red";
    document.body.classList.remove("polling-live");
  }
}

PollingState.subscribe(updatePollingPill);

const busyOverlay = $("#busyOverlay");
function showBusy() { if (busyOverlay) busyOverlay.hidden = false; }
function hideBusy() { if (busyOverlay) busyOverlay.hidden = true; }

pollingPill.addEventListener("click", async () => {
  if (PollingState.running) {
    if (!window.confirm("폴링을 정지하면 모든 장비의 데이터 수집이 중단됩니다.\n계속하시겠습니까?")) return;
  }
  pollingPill.disabled = true;
  showBusy();
  const minDelay = new Promise(r => setTimeout(r, 800));
  if (PollingState.running) {
    await Promise.all([PollingState.stop(true), minDelay]);
  } else {
    await Promise.all([PollingState.start(), minDelay]);
  }
  hideBusy();
  pollingPill.disabled = false;
});

// ── User Dropdown ─────────────────────────────────────────────────────────────

userBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  userDropdown.hidden = !userDropdown.hidden;
  if (!userDropdown.hidden) {
    // position:fixed라 .topbar의 overflow:hidden에 안 잘리는 대신, 매번 열 때
    // 버튼 위치 기준으로 좌표를 직접 계산해야 한다.
    const rect = userBtn.getBoundingClientRect();
    userDropdown.style.top   = `${rect.bottom + 8}px`;
    userDropdown.style.right = `${window.innerWidth - rect.right}px`;
    // userDropdown이 DOM상 버튼과 멀리 떨어져 있어(.workspace 직속) Tab 자연
    // 순서로는 안 이어지므로, 열릴 때 포커스를 직접 안으로 옮겨준다.
    logoutBtn.focus();
  }
});

logoutBtn.addEventListener("click", () => Auth.logout());

document.addEventListener("click", (e) => {
  // userDropdown은 이제 #userMenu 밖(.workspace 직속)에 있으므로 둘 다 확인해야 한다.
  if (!$("#userMenu").contains(e.target) && !userDropdown.contains(e.target)) {
    userDropdown.hidden = true;
  }
});

// 포커스가 버튼/드롭다운 바깥으로 빠지면(Tab 이동 등) 자동으로 닫는다.
// focusout은 버블링하므로 버튼 쪽과 드롭다운 쪽 양쪽에 걸어야 한다(서로 다른
// 서브트리라 하나로는 못 잡음). relatedTarget이 없을 때(포커스가 완전히
// 문서 밖으로 나갈 때)도 안전하게 닫는다.
function hideUserDropdownIfFocusLeft(e) {
  const next = e.relatedTarget;
  if (next && ($("#userMenu").contains(next) || userDropdown.contains(next))) return;
  userDropdown.hidden = true;
}
$("#userMenu").addEventListener("focusout", hideUserDropdownIfFocusLeft);
userDropdown.addEventListener("focusout", hideUserDropdownIfFocusLeft);

// ── Router ────────────────────────────────────────────────────────────────────

function getCurrentPage() {
  const hash = window.location.hash.replace("#", "").trim();
  // settings 계열 서브탭은 단일 settings 페이지 내부에서 처리
  if (hash.startsWith("settings")) return "settings";
  return pageMap[hash] ? hash : "dashboard";
}


function loadPageCss(pageName) {
  $$("link[data-page-css]").forEach((el) => el.remove());
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `./css/${pageName}.css`;
  link.dataset.pageCss = pageName;

  document.head.appendChild(link);
}

function loadPageJs(pageName) {
  $$("script[data-page-js]").forEach((el) => el.remove());
  const script = document.createElement("script");
  script.src = `./js/${pageName}.js`;
  script.dataset.pageJs = pageName;
  // 페이지 JS가 PageLoader.show()를 호출하면 _pendingTransition이 false로 바뀌어 hideIfTransition은 무시됨.
  // show()를 호출하지 않는 페이지(빈 파일, 미적용 페이지)는 스크립트 로드 완료 후 자동으로 오버레이를 닫음.
  script.addEventListener('load',  () => PageLoader.hideIfTransition());
  script.addEventListener('error', () => PageLoader.hide(null));
  document.body.appendChild(script);
}

async function loadPage(pageName) {
  // 페이지 스크립트(realtime.js, trends.js 등)가 자신의 타이머/폴링을 정리할 신호.
  // 실제 해시 변경 여부와 무관하게 loadPage()가 다시 불릴 때마다(언어 전환 등으로
  // 같은 페이지를 재로드하는 경우 포함) 항상 발생시켜야 이전 인스턴스가 남지 않는다.
  window.dispatchEvent(new CustomEvent("spa:beforeload"));

  PageLoader.beginTransition();   // 전환 즉시 오버레이 → 이전 페이지 콘텐츠/CSS 불일치 플래시 방지
  const fileName = pageMap[pageName] || pageMap.dashboard;

  try {
    const response = await fetch(`./pages/${fileName}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    loadPageCss(pageName);
    pageRoot.innerHTML = await response.text();
    I18n.applyI18n(pageRoot);
    loadPageJs(pageName);
    updateActiveMenu(pageName);

  } catch (error) {
    pageRoot.innerHTML = `
      <section class="page blank-page">
        <article class="panel blank-panel">
          <div class="blank-icon">!</div>
          <h2>${I18n.t("common.pageLoadFailedTitle")}</h2>
          <p>${I18n.t("common.pageLoadFailedDesc", { file: fileName })}</p>
        </article>
      </section>
    `;
    PageLoader.hide(null);
    console.error(error);
  }
}

function navGroup(pageName) {
  if (pageName.startsWith("settings")) return "settings";
  return pageName;
}

function updateActiveMenu(pageName) {
  const group = navGroup(pageName);
  $$(".nav-item", navMenu).forEach((item) => {
    item.classList.toggle("active", item.dataset.page === group);
  });
}

window.addEventListener("hashchange", (e) => {
  const prev = new URL(e.oldURL).hash.replace("#", "");
  const next = getCurrentPage();

  // settings 내부 탭 간 이동은 settings.js가 show/hide로 처리 — 페이지 재로드 생략
  if (next === "settings" && prev.startsWith("settings")) return;
  loadPage(next);
});

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await I18n.init();
  I18n.applyI18n(document);
  const langSelect = $("#langSelect");
  if (langSelect) langSelect.value = I18n.lang;
  langSelect?.addEventListener("change", async (e) => {
    const changed = await I18n.setLanguage(e.target.value);
    if (changed) loadPage(getCurrentPage());
  });

  setInterval(tickClock, 1000);
  tickClock();

  const loggedIn = await Auth.checkSession();
  if (!loggedIn) {
    window.location.replace("./login.html");
    return;
  }

  PollingState.startPolling();

  refreshDeviceStatusSummary();
  setInterval(refreshDeviceStatusSummary, 3000);

  if (!window.location.hash) {
    window.location.hash = "#dashboard";
    return;
  }

  loadPage(getCurrentPage());
});
