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
    showError("사용자 이름과 비밀번호를 입력하세요.");
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "로그인 중…";

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
        ? "아이디 또는 비밀번호가 올바르지 않습니다."
        : `로그인에 실패했습니다. (HTTP ${res.status})`
    );
    $("#password").value = "";
    $("#password").focus();
  } catch {
    showError("서버에 연결할 수 없습니다. 네트워크를 확인하세요.");
  }

  loginBtn.disabled = false;
  loginBtn.textContent = "로그인";
});

document.addEventListener("DOMContentLoaded", checkExistingSession);
