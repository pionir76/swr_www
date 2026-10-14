const loginForm = $("#loginForm");
const errorMsg  = $("#errorMsg");
const loginBtn  = $("#loginBtn");

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.hidden = false;
}

function hideError() {
  errorMsg.hidden = true;
  errorMsg.textContent = "";
}

// index.html의 main.js와 달리 이 페이지는 독립 HTML이라 자체적으로
// I18n.init()을 호출해야 디바이스에 설정된 언어가 반영된다. 언어를 바꾸는
// UI는 여기 없음(시스템 설정으로 이동) — 디바이스 설정값을 읽기만 한다.
async function initLanguage() {
  await I18n.init();
  I18n.applyI18n(document);
}

// 이미 유효한 토큰이 있으면 바로 메인으로 이동
async function checkExistingSession() {
  const token = getToken();
  if (!token) return;

  try {
    const res = await apiFetch("/api/session");
    if (res.ok) {
      const data = await res.json();
      if (data.valid) {
        window.location.replace("./index.html");
        return;
      }
    }
  } catch {
    // 네트워크 오류 — 로그인 폼 그대로 표시
  }

  // 토큰이 유효하지 않으면 정리
  clearAuth();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();

  const username = $("#username").value.trim();
  const password = $("#password").value;

  if (!username || !password) {
    showError(I18n.t("login.errMissingFields"));
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = I18n.t("login.submitBtnLoading");

  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        setToken(data.token);
        setUsername(username);
        window.location.replace("./index.html");
        return;
      }
    }

    showError(
      res.status === 401
        ? I18n.t("login.errInvalidCredentials")
        : I18n.t("login.errFailedHttp", { status: res.status })
    );
    $("#password").value = "";
    $("#password").focus();
  } catch {
    showError(I18n.t("login.errNetworkFailed"));
  }

  loginBtn.disabled = false;
  loginBtn.textContent = I18n.t("login.submitBtn");
});

document.addEventListener("DOMContentLoaded", () => {
  initLanguage();
  checkExistingSession();
});
