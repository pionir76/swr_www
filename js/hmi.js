(() => {
  const stage       = $('#hmiStage');
  const pageContent = $('#pageContent');
  const editorRoot  = $('#hmiEditor');
  const page        = $('.hmi-page');
  const dot         = $('#hmiDot');
  const msg         = $('#hmiMsg');

  // 오류 문구(화면 전환·쓰기 실패 등)는 다음 폴링의 "갱신 …"에 바로 덮이지 않게 잠시 유지한다.
  // 점은 항상 현재 상태를 따른다.
  const ERR_HOLD_MS = 5000;
  let errUntil = 0;
  function status(state, text) {
    if (dot) dot.className = `hmi-status-dot ${state}`;
    if (state === 'err') errUntil = Date.now() + ERR_HOLD_MS;
    else if (Date.now() < errUntil) return;
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
  let editor = null;

  async function boot(screen) {
    PageLoader.show();
    try {
      // 디자인 모드에서 돌아올 때 다시 boot()하므로 라이브러리는 한 번만 로드(레지스트리 유지)
      if (!window.WHMI) {
        await loadScript('./js/whmi-runtime.js');
        await loadScript('./js/whmi-rules.js');     // 판정 엔진(조건·대응표)
        await loadScript('./js/whmi-widgets.js');
      }
      window.WHMI_DEFAULT_PROJECT = 'hmi-project/project.json';

      result = await window.WHMI.boot(stage, status, { screen });
      PageLoader.hide(pageContent);
    } catch (err) {
      console.error('[HMI]', err);
      PageLoader.showError(err.message, () => { PageLoader.show(); boot(screen); });
    }
  }

  boot();

  // ── 전체 화면 공통 ───────────────────────────────────────────────
  // 브라우저 정책상 사용자 클릭으로만 진입 가능(접속 즉시 자동 전체 화면은 키오스크 브라우저 몫).
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const exitFs = () => {
    if (!fsElement()) return;
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    Promise.resolve(fn && fn.call(document)).catch(() => {});
  };
  // quiet: 거부돼도 오류로 알리지 않음(디자인 모드는 전체 화면이 안 되면 일반 창으로 계속)
  const enterFs = (el, quiet) => {
    const fn = el && (el.requestFullscreen || el.webkitRequestFullscreen);
    if (!fn) { if (!quiet) status('err', '이 브라우저는 전체 화면을 지원하지 않습니다.'); return; }
    Promise.resolve(fn.call(el)).catch((e) => { if (!quiet) status('err', `전체 화면 실패: ${e.message}`); });
  };

  // ── 전체 화면 ─────────────────────────────────────────────────────
  // 전체 화면 대상은 페이지 묶음(.hmi-page) 하나 — 실행·디자인 모드를 오가도 전체 화면이 그대로 유지된다
  // (모드마다 다른 요소를 전체 화면으로 하면, 바꿀 때 끝내야 하고 다시 켜려면 사용자 클릭이 필요).
  // 전체 화면일 때 제목 줄은 CSS로 숨기고 실행 화면 / 편집기만 화면 가득(.hmi-page:fullscreen).
  $('#hmiFullscreenBtn')?.addEventListener('click', () => (fsElement() ? exitFs() : enterFs(page)));
  $('#hmiFsExit')?.addEventListener('click', exitFs);

  // ── 디자인 모드 ───────────────────────────────────────────────────
  // 화면 저장 API 권한이 ManagerOrAbove라 그 이상만 버튼을 보여준다(최종 판단은 서버).
  const designBtn = $('#hmiDesignBtn');
  (async () => {
    try {
      const res = await apiFetch('/api/users');
      if (!res.ok) return;
      const me = ((await res.json()).users ?? []).find((u) => u.username === getUsername());
      const role = (me?.role ?? '').toLowerCase();
      if (designBtn) designBtn.hidden = !(role === 'admin' || role === 'manager');
    } catch (_) {}
  })();

  designBtn?.addEventListener('click', async () => {
    if (editor || !result) return;
    // 전체 화면이면 그대로 유지(페이지 묶음이 전체 화면 대상). 켜고 끄는 것은 사용자가 직접.
    page.classList.add('designing');
    pageContent.hidden = true;
    editorRoot.hidden = false;

    const screenId = result.screen && result.screen.id;
    result.runtime?.destroy();   // 편집 중엔 폴링 중단
    // 실행 화면 SVG도 비운다 — 위젯 clip/gradient id가 위젯 id 기준이라, 숨겨진 실행 화면이
    // 남아 있으면 편집기 쪽 url(#clip-…)이 문서에서 먼저 나오는 실행 화면 것을 가리킨다.
    stage.innerHTML = '';
    try {
      if (!window.WHMI.Editor) {
        await loadScript('./js/whmi-schema.js');   // 위젯 속성 정의(속성 창 폼)
        await loadScript('./js/whmi-tags.js');     // HMI 태그 관리 대화상자
        await loadScript('./js/whmi-editor.js');
      }
      editor = window.WHMI.Editor.open(editorRoot, {
        project: result.project,
        tags: result.tags,
        screenId,
        onExit: leaveDesign,
      });
      editor.onFullscreen = () => (fsElement() ? exitFs() : enterFs(page));
      // 저장 안 한 편집이 있으면 메뉴 이동 전에 확인, 탭 닫기/새로고침은 브라우저 경고 + 임시 저장
      window.setLeaveGuard?.(() => editor.confirmLeave());
      window.addEventListener('beforeunload', onBeforeUnload);
    } catch (err) {
      console.error('[HMI]', err);
      status('err', err.message);
      leaveDesign();
    }
  });

  function onBeforeUnload(e) {
    if (!editor?.dirty) return;
    editor.flushDraft();
    e.preventDefault();
    e.returnValue = '';
  }

  // 실행 모드로 복귀 — 저장된 내용이 반영되도록 프로젝트/화면을 서버에서 다시 불러온다
  // (저장 여부 확인은 편집기가 끝낸 뒤 호출한다)
  function leaveDesign() {
    window.setLeaveGuard?.(null);
    window.removeEventListener('beforeunload', onBeforeUnload);
    // 전체 화면은 유지 — 편집기에서 전체 화면이었으면 실행 화면도 전체 화면으로 이어진다
    const screen = editor?.screenId;
    editor?.destroy();
    editor = null;
    editorRoot.hidden = true;
    page.classList.remove('designing');
    boot(screen);
  }

  window.addEventListener('spa:beforeload', () => {
    exitFs();
    window.removeEventListener('beforeunload', onBeforeUnload);
    editor?.destroy();
    result?.runtime?.destroy();
    $$('script[data-hmi-lib]').forEach((el) => el.remove());
    delete window.WHMI;
    delete window.WHMI_DEFAULT_PROJECT;
  }, { once: true });
})();
