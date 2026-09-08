// ── 다국어 지원 (i18n) ────────────────────────────────────────────────────────
// 사전 파일: i18n/<lang>.json (키: "네임스페이스.이름" → 번역 문자열, {var} 치환 지원)
// 정적 텍스트는 HTML에 data-i18n(텍스트) / data-i18n-placeholder / data-i18n-title
// 속성을 달아두면 applyI18n()이 자동 치환한다. JS가 직접 만드는 문자열(alert,
// showMsg, 테이블 렌더링 등)은 각 페이지 스크립트에서 I18n.t('key')를 호출해야 한다.

const SUPPORTED_LANGS = ["ko", "en", "ja", "zh"];
const LANG_KEY = "smartroute_lang";

const I18n = (() => {
  let _lang = localStorage.getItem(LANG_KEY);
  if (!SUPPORTED_LANGS.includes(_lang)) _lang = "ko";
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

  // 언어 전환: 사전을 새로 불러오고 셸(사이드바/상단바)을 즉시 재적용한다.
  // 현재 활성 페이지 콘텐츠까지 새 언어로 다시 그리는 건 호출한 쪽(main.js)의
  // 책임이다 — 페이지 재로드가 필요한지는 페이지 로직에 따라 다르기 때문.
  async function setLanguage(lang) {
    if (!SUPPORTED_LANGS.includes(lang) || lang === _lang) return false;
    _lang = lang;
    localStorage.setItem(LANG_KEY, lang);
    await loadDict(lang);
    document.documentElement.lang = lang;
    applyI18n(document);
    return true;
  }

  async function init() {
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
