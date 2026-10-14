// ── 다국어 지원 (i18n) ────────────────────────────────────────────────────────
// 사전 파일: i18n/<lang>.json (키: "네임스페이스.이름" → 번역 문자열, {var} 치환 지원)
// 정적 텍스트는 HTML에 data-i18n(텍스트) / data-i18n-placeholder / data-i18n-title
// 속성을 달아두면 applyI18n()이 자동 치환한다. JS가 직접 만드는 문자열(alert,
// showMsg, 테이블 렌더링 등)은 각 페이지 스크립트에서 I18n.t('key')를 호출해야 한다.
//
// 언어는 브라우저가 아니라 디바이스(백엔드 config.json)에 저장된다 — 이 디바이스에
// 접속하는 모든 사람이 같은 언어를 본다(GET은 인증 불필요라 로그인 화면도 반영됨,
// PUT은 ManagerOrAbove 권한 필요).

const SUPPORTED_LANGS = ["ko", "en", "ja", "zh"];

const I18n = (() => {
  let _lang = "ko";
  let _dict = {};

  async function loadDict(lang) {
    try {
      const res = await fetch(`./i18n/${lang}.json`, { cache: "no-store" });
      _dict = res.ok ? await res.json() : {};
    } catch {
      _dict = {};
    }
  }

  // 사전에 없는 키는 키 자체를 그대로 반환한다 — 번역이 아직 안 된 부분이
  // 화면에서 비어 보이지 않고 무엇이 빠졌는지 바로 드러나게 하기 위함.
  function t(key, vars) {
    let s = _dict[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    }
    return s;
  }

  function applyI18n(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
  }

  // 디바이스에 저장할 언어를 바꾼다(PUT) — 성공하면 이 세션의 사전도 즉시
  // 갱신하고 셸을 재적용한다. 실패 시(권한 부족 400/403 등) false와 함께
  // 서버가 준 에러 메시지를 반환하므로 호출부(설정 화면)에서 안내할 수 있다.
  async function setLanguage(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) return { ok: false, error: "unsupported language" };
    try {
      const res = await apiFetch("/api/system/language", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: lang }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, status: res.status, error: data.error };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }

    _lang = lang;
    await loadDict(lang);
    document.documentElement.lang = lang;
    applyI18n(document);
    return { ok: true };
  }

  // 디바이스에 저장된 현재 언어를 읽어온다 — 인증 불필요라 로그인 전에도 호출 가능.
  // (apiFetch는 토큰이 있으면 Authorization 헤더를 붙이지만, 이 엔드포인트는
  // 토큰 유무와 무관하게 응답하므로 그대로 재사용한다.) 실패 시(네트워크 오류
  // 등) 기본값 "ko"로 안전하게 폴백한다.
  async function init() {
    try {
      const res = await apiFetch("/api/system/language");
      if (res.ok) {
        const data = await res.json();
        if (SUPPORTED_LANGS.includes(data.language)) _lang = data.language;
      }
    } catch {
      // 네트워크 오류 — 기본값(ko) 유지
    }
    await loadDict(_lang);
    document.documentElement.lang = _lang;
  }

  return {
    t,
    applyI18n,
    setLanguage,
    init,
    get lang() { return _lang; },
  };
})();
