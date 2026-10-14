(() => {
  const stage       = $('#hmiStage');
  const pageContent = $('#pageContent');
  const dot         = $('#hmiDot');
  const msg         = $('#hmiMsg');

  function status(state, text) {
    if (dot) dot.className = `hmi-status-dot ${state}`;
    if (msg) msg.textContent = text;
  }

  // whmi-runtime.js/whmi-widgets.js는 이 페이지에서만 쓰므로 다른 js/*.js와 같은 방식으로
  // 페이지 진입 시 로드하고 spa:beforeload에서 정리한다(loadPageJs는 js/hmi.js 자신만 관리).
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.dataset.hmiLib = 'true';
      script.addEventListener('load', resolve);
      script.addEventListener('error', () => reject(new Error(`${src} 로드 실패`)));
      document.body.appendChild(script);
    });
  }

  // boot()가 반환하는 result.runtime은 getter라 goto()로 화면이 바뀐 뒤에도
  // 항상 "현재 활성 화면"의 ScreenRuntime을 가리킨다 — result 자체를 들고 있어야 한다.
  let result = null;

  async function boot() {
    PageLoader.show();
    try {
      await loadScript('./js/whmi-runtime.js');
      await loadScript('./js/whmi-widgets.js');
      window.WHMI_DEFAULT_PROJECT = 'hmi-project/project.json';

      result = await window.WHMI.boot(stage, status);
      PageLoader.hide(pageContent);
    } catch (err) {
      console.error('[HMI]', err);
      PageLoader.showError(err.message, () => { PageLoader.show(); boot(); });
    }
  }

  boot();

  window.addEventListener('spa:beforeload', () => {
    result?.runtime?.destroy();
    $$('script[data-hmi-lib]').forEach((el) => el.remove());
    delete window.WHMI;
    delete window.WHMI_DEFAULT_PROJECT;
  }, { once: true });
})();
