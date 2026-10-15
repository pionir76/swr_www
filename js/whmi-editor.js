// WHMI 편집기(디자인 모드) — HMI 페이지에서 [디자인]을 누를 때만 로드된다.
// 실행 모드와 같은 위젯 코드(WHMI.drawWidget)로 미리보기를 그리고, 폴링/쓰기는 하지 않는다.
(function () {
  'use strict';

  const { svg, esc } = window.WHMI;

  // 위젯 목록에 보일 이름 — 등록됐지만 여기 없는 타입은 타입 이름 그대로 보인다
  const TYPE_LABEL = {
    label: '텍스트', rect: '사각형', numeric: '숫자 표시', input: '숫자 입력',
    lamp: '램프', bar: '바 게이지', gauge: '원형 게이지', tank: '탱크',
    button: '버튼', switch: '스위치', selector: '셀렉터', screenlink: '화면 이동',
  };
  const TYPE_ORDER = Object.keys(TYPE_LABEL);

  // 새로 넣는 위젯의 기본 크기/속성 — 샘플 화면에서 많이 쓰는 크기 기준
  const NEW_WIDGET = {
    label:      { w: 160, h: 28, props: { text: '텍스트' } },
    rect:       { w: 240, h: 160 },
    numeric:    { w: 160, h: 50 },
    input:      { w: 160, h: 44 },
    lamp:       { w: 140, h: 36, props: { text: '램프' } },
    bar:        { w: 250, h: 36, props: { orientation: 'h' } },
    gauge:      { w: 160, h: 160 },
    tank:       { w: 120, h: 200 },
    button:     { w: 100, h: 44 },
    switch:     { w: 110, h: 40 },
    selector:   { w: 190, h: 130 },
    screenlink: { w: 180, h: 36 },
  };
  const NEW_WIDGET_FALLBACK = { w: 120, h: 60 };
  const HISTORY_MAX = 50;
  // 속성 창 입력란으로 편집하는 위젯 필드 — 나머지(props, enableWhen 등)는 JSON으로 편집
  const BASE_KEYS = ['id', 'type', 'x', 'y', 'w', 'h', 'tag'];
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;   // HMI 태그·화면 id와 같은 규칙
  const MAX_SCREEN_BYTES = 256 * 1024;      // 서버 화면 content 상한(413)
  const DRAFT_DELAY_MS = 400;               // 임시 저장(localStorage) 지연
  const TITLE_MAX = 64;                     // 화면 제목 최대 길이(서버 규칙)
  const SCREEN_MIN = 100, SCREEN_MAX = 7680; // 화면 크기(기준 해상도) 범위
  // 화면 크기 목록 — 맨 앞에 "현재 모니터"가 붙는다
  const SIZE_PRESETS = [[800, 480], [1024, 600], [1024, 768], [1280, 720], [1280, 800], [1366, 768], [1920, 1080]];
  const DEFAULT_BG = '#14181f';

  // 정렬 도구 아이콘(16×16) — 기호 글꼴이 없는 패널 브라우저에서도 보이도록 SVG로
  const icon = (body) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${body}</svg>`;
  const bar = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="currentColor" opacity=".85"/>`;
  const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1.4"/>`;
  const ALIGN_TOOLS = [
    ['left',    '왼쪽 맞춤',     icon(line(2, 1, 2, 15) + bar(4, 3, 10, 4) + bar(4, 9, 6, 4))],
    ['hcenter', '가로 가운데',   icon(line(8, 1, 8, 15) + bar(2, 3, 12, 4) + bar(4, 9, 8, 4))],
    ['right',   '오른쪽 맞춤',   icon(line(14, 1, 14, 15) + bar(2, 3, 10, 4) + bar(6, 9, 6, 4))],
    ['top',     '위쪽 맞춤',     icon(line(1, 2, 15, 2) + bar(3, 4, 4, 10) + bar(9, 4, 4, 6))],
    ['vmiddle', '세로 가운데',   icon(line(1, 8, 15, 8) + bar(3, 2, 4, 12) + bar(9, 4, 4, 8))],
    ['bottom',  '아래쪽 맞춤',   icon(line(1, 14, 15, 14) + bar(3, 2, 4, 10) + bar(9, 6, 4, 6))],
  ];
  const DIST_TOOLS = [
    ['h', '가로 간격 같게', icon(line(1, 2, 1, 14) + line(15, 2, 15, 14) + bar(3, 4, 3, 8) + bar(10, 4, 3, 8))],
    ['v', '세로 간격 같게', icon(line(2, 1, 14, 1) + line(2, 15, 14, 15) + bar(4, 3, 8, 3) + bar(4, 10, 8, 3))],
  ];
  const SIZE_TOOLS = [
    ['w',  '너비 같게',     icon(line(1, 3, 1, 13) + line(15, 3, 15, 13) + line(3, 8, 13, 8) + '<path d="M3 8l2.5-2.5M3 8l2.5 2.5M13 8l-2.5-2.5M13 8l-2.5 2.5" stroke="currentColor" stroke-width="1.4" fill="none"/>')],
    ['h',  '높이 같게',     icon(line(3, 1, 13, 1) + line(3, 15, 13, 15) + line(8, 3, 8, 13) + '<path d="M8 3l-2.5 2.5M8 3l2.5 2.5M8 13l-2.5-2.5M8 13l2.5-2.5" stroke="currentColor" stroke-width="1.4" fill="none"/>')],
    ['wh', '크기 같게',     icon('<rect x="2" y="2" width="12" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 1.5"/>' + bar(5, 5, 6, 6))],
  ];     // 실행 취소 단계 수(화면 JSON 통째 저장 — 화면 하나 약 20KB)

  const MIN_SIZE = 8;        // 크기 조절 최소 w/h(화면 좌표)
  const HANDLE_PX = 9;       // 손잡이 크기(실제 픽셀 — 확대/축소와 무관하게 일정)
  const DRAG_START_PX = 3;   // 이만큼 움직여야 드래그로 인정(클릭과 구분)
  // 손잡이: [이름, x 비율, y 비율, 커서]. 아주 작은 위젯에선 손잡이가 겹치므로
  // 모서리를 나중에(위에) 그려 모서리가 우선 잡히게 한다.
  const HANDLES = [
    ['n', 0.5, 0, 'ns-resize'], ['e', 1, 0.5, 'ew-resize'], ['s', 0.5, 1, 'ns-resize'], ['w', 0, 0.5, 'ew-resize'],
    ['nw', 0, 0, 'nwse-resize'], ['ne', 1, 0, 'nesw-resize'], ['se', 1, 1, 'nwse-resize'], ['sw', 0, 1, 'nesw-resize'],
  ];

  // 미리보기 값 — 화면을 열 때 한 번 읽어 둔 현재 값(raw)을 쓰고, 없으면(태그 미지정/통신 실패)
  // 범위의 60% 지점을 넣는다. 품질은 항상 정상으로 그려 흐리게 보이지 않게 한다.
  function previewInfo(w, p, tags, raw) {
    const t = tags[w.tag] || {};
    const pick = (...xs) => xs.find((x) => x != null);
    const min = pick(p.min, t.min, 0);
    const max = pick(p.max, t.max, 100);
    const decimals = pick(p.decimals, raw && raw.decimals, t.decimals, 0);
    return {
      value: raw && raw.v != null ? raw.v : Number((min + (max - min) * 0.6).toFixed(decimals)),
      ok: true,
      quality: 'good',
      min, max,
      unit: pick(p.unit, raw && raw.unit, t.unit, ''),
      decimals,
      writable: false,
      tag: t,
    };
  }

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const inside = (px, py, w) => px >= w.x && px <= w.x + w.w && py >= w.y && py <= w.y + w.h;
  const contains = (r, w) => w.x >= r.x && w.y >= r.y && w.x + w.w <= r.x + r.w && w.y + w.h <= r.y + r.h;
  // 글자 입력 중인 요소면 편집기 단축키를 쓰지 않는다(체크박스/버튼은 해당 없음)
  const isTyping = (el) => el && (el.isContentEditable || /^(SELECT|TEXTAREA)$/.test(el.tagName) ||
    (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range|color)$/.test(el.type)));

  class Editor {
    constructor(root, opts) {
      this.root = root;
      this.project = opts.project;
      this.tags = opts.tags || {};
      this.onExit = opts.onExit;
      this.screenId = null;
      this.doc = null;        // 편집 중인 화면 JSON(content)
      this.revision = null;   // 서버에 저장된 화면 revision
      this.sel = new Set();   // 선택된 위젯 id
      this.drag = null;       // 진행 중인 포인터 동작(move/resize/marquee)
      this.dirty = false;
      this.past = [];         // 실행 취소용 이전 상태(JSON 문자열)
      this.future = [];       // 다시 실행용
      this.clipboard = null;  // 복사한 위젯들(JSON 문자열) — 화면을 바꿔도 유지
      this.grid = { show: true, snap: true, size: 10 };  // 보기와 맞춤은 따로 켜고 끈다
      this.buildDom();
      this.onKey = (e) => this.handleKey(e);
      document.addEventListener('keydown', this.onKey);
      // 편집기 크기가 바뀌면(전체 화면 전환 등) 손잡이 크기를 다시 맞춘다
      this.resizeObs = new ResizeObserver(() => this.drawSelection());
      this.resizeObs.observe(this.canvas);
      const first = opts.screenId || this.project.startScreen || (this.project.screens[0] && this.project.screens[0].id);
      if (first) this.openScreen(first);
      else this.showEmpty();
    }

    buildDom() {
      const screens = this.project.screens || [];
      const types = window.WHMI.types().slice().sort((a, b) => {
        const ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      this.root.innerHTML = `
        <div class="ed-toolbar">
          <span class="ed-title">✎ 디자인</span>
          <select class="ed-screen-sel" title="편집할 화면">
            ${screens.map((s) => `<option value="${esc(s.id)}">${esc(s.title || s.id)} (${esc(s.id)})</option>`).join('')}
          </select>
          <button class="ed-btn" type="button" data-act="newScreen" title="새 화면 만들기">+ 새 화면</button>
          <button class="ed-btn" type="button" data-act="manage" title="화면 순서·시작 화면·삭제">화면 관리</button>
          <span class="ed-sep"></span>
          <label class="ed-check" title="격자선 표시"><input type="checkbox" data-opt="gridShow" checked> 격자 보기</label>
          <label class="ed-check" title="이동·크기 조절 시 격자에 맞춤"><input type="checkbox" data-opt="gridSnap" checked> 격자 맞춤</label>
          <select class="ed-grid-size" title="격자 간격">
            ${[5, 10, 20, 40].map((n) => `<option value="${n}"${n === this.grid.size ? ' selected' : ''}>${n}px</option>`).join('')}
          </select>
          <span class="ed-sep"></span>
          <button class="ed-btn" type="button" data-act="undo" title="실행 취소 (Ctrl+Z)">↶</button>
          <button class="ed-btn" type="button" data-act="redo" title="다시 실행 (Ctrl+Y)">↷</button>
          <span class="ed-sep"></span>
          <button class="ed-btn" type="button" data-act="dup" data-need-sel title="복제 (Ctrl+D)">복제</button>
          <button class="ed-btn" type="button" data-act="del" data-need-sel title="삭제 (Del)">삭제</button>
          <span class="ed-sep"></span>
          <button class="ed-btn" type="button" data-act="front" data-need-sel title="맨 앞으로 (Ctrl+Shift+])">맨 앞</button>
          <button class="ed-btn" type="button" data-act="forward" data-need-sel title="앞으로 (Ctrl+])">앞으로</button>
          <button class="ed-btn" type="button" data-act="backward" data-need-sel title="뒤로 (Ctrl+[)">뒤로</button>
          <button class="ed-btn" type="button" data-act="back" data-need-sel title="맨 뒤로 (Ctrl+Shift+[)">맨 뒤</button>
          <span class="ed-spacer"></span>
          <span class="ed-pos" title="커서 위치(화면 좌표)"></span>
          <span class="ed-dirty" hidden>● 변경됨</span>
          <span class="ed-msg"></span>
          <button class="ed-btn save" type="button" data-act="save" title="저장 (Ctrl+S)" disabled>저장</button>
          <button class="ed-btn" type="button" data-act="fs" title="전체 화면">⛶</button>
          <button class="ed-btn primary" type="button" data-act="exit">▶ 실행 모드</button>
        </div>
        <div class="ed-body">
          <aside class="ed-palette">
            <div class="ed-pane-title">위젯</div>
            <ul class="ed-palette-list">
              ${types.map((t) => `<li class="ed-palette-item" data-type="${esc(t)}">${esc(TYPE_LABEL[t] || t)}<small>${esc(t)}</small></li>`).join('')}
            </ul>
          </aside>
          <div class="ed-canvas"></div>
          <aside class="ed-inspector">
            <div class="ed-pane-title">속성</div>
            <div class="ed-insp-body"></div>
          </aside>
        </div>`;
      this.canvas = this.root.querySelector('.ed-canvas');
      this.inspector = this.root.querySelector('.ed-insp-body');
      this.msgEl = this.root.querySelector('.ed-msg');
      this.posEl = this.root.querySelector('.ed-pos');
      this.screenSel = this.root.querySelector('.ed-screen-sel');

      // 다른 화면으로 — 저장 안 한 변경이 있으면 먼저 물어본다(취소하면 선택을 되돌림)
      this.screenSel.addEventListener('change', async () => {
        const next = this.screenSel.value;
        this.screenSel.value = this.screenId;
        if (await this.confirmLeave()) this.openScreen(next);
      });
      this.root.querySelector('[data-opt="gridShow"]').addEventListener('change', (e) => {
        this.grid.show = e.target.checked;
        this.updateGrid();
      });
      this.root.querySelector('[data-opt="gridSnap"]').addEventListener('change', (e) => {
        this.grid.snap = e.target.checked;
      });
      this.root.querySelector('.ed-grid-size').addEventListener('change', (e) => {
        this.grid.size = Number(e.target.value);
        this.updateGrid();
      });
      this.root.querySelector('.ed-toolbar').addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'exit') this.requestExit();
        else if (act === 'fs') this.onFullscreen && this.onFullscreen();
        else if (act) this.action(act);
      });
      this.root.querySelector('.ed-palette-list').addEventListener('pointerdown', (e) => this.paletteDown(e));
      this.refreshScreenSel();
      this.inspector.addEventListener('change', (e) => {
        if (e.target.dataset.f) this.onFieldChange(e.target);
        else if (e.target.dataset.s) this.onScreenField(e.target);
      });
      this.inspector.addEventListener('input', (e) => {
        if (e.target.classList.contains('ed-json')) this.jsonDirty = true;
      });
      this.inspector.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('ed-json') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.applyJson();
        }
      });
      this.inspector.addEventListener('click', (e) => {
        const j = e.target.closest('[data-json]');
        if (j) { j.dataset.json === 'apply' ? this.applyJson() : this.resetJson(); return; }
        const b = e.target.closest('.ed-tool');
        if (!b || b.disabled) return;
        if (b.dataset.align) this.align(b.dataset.align);
        else if (b.dataset.dist) this.distribute(b.dataset.dist);
        else if (b.dataset.size) this.matchSize(b.dataset.size);
      });
    }

    action(act) {
      // 화면이 하나도 없어도 쓸 수 있는 동작
      if (act === 'newScreen') { this.newScreen(); return; }
      if (act === 'manage') { this.manageScreens(); return; }
      if (!this.doc) return;
      switch (act) {
        case 'save': this.save(); break;
        case 'undo': this.undo(); break;
        case 'redo': this.redo(); break;
        case 'dup': this.duplicate(); break;
        case 'del': this.deleteSel(); break;
        case 'copy': this.copySel(); break;
        case 'cut': if (this.copySel()) this.deleteSel(); break;
        case 'paste': this.paste(); break;
        case 'front': case 'forward': case 'backward': case 'back': this.reorder(act); break;
      }
    }

    updateToolbar() {
      const q = (sel) => this.root.querySelector(sel);
      q('[data-act="save"]').disabled = !this.dirty || !!this.saving;
      q('[data-act="undo"]').disabled = !this.past.length;
      q('[data-act="redo"]').disabled = !this.future.length;
      this.root.querySelectorAll('[data-need-sel]').forEach((b) => { b.disabled = !this.sel.size; });
    }

    msg(text, state) {
      this.msgEl.textContent = text || '';
      this.msgEl.title = text || '';   // 길면 말줄임 — 전체 문구는 툴팁으로
      this.msgEl.className = `ed-msg${state ? ` is-${state}` : ''}`;  // 전역 .ok/.err 클래스와 겹치지 않게 is- 접두어
    }

    showEmpty() {
      this.screenId = null;
      this.doc = null;
      this.svgRoot = null;
      this.selLayer = null;
      this.current = null;
      this.sel.clear();
      this.dirty = false;
      this.past = [];
      this.future = [];
      this.canvas.innerHTML = '<div class="whmi-empty">등록된 화면이 없습니다. [+ 새 화면]으로 만드세요.</div>';
      this.inspector.innerHTML = '';
      this.refreshScreenSel();
      this.setDirty(false);
    }

    refreshScreenSel() {
      const screens = this.project.screens || [];
      this.screenSel.innerHTML = screens.map((x) =>
        `<option value="${esc(x.id)}">${x.id === this.project.startScreen ? '★ ' : ''}${esc(x.title || x.id)} (${esc(x.id)})</option>`).join('');
      this.screenSel.disabled = !screens.length;
      if (this.screenId) this.screenSel.value = this.screenId;
    }

    // ---- 화면 관리(프로젝트) ---------------------------------------------------
    // 화면 추가/삭제/순서/시작 화면은 화면 내용과 별개로 서버에 바로 반영된다(프로젝트 revision).
    async reloadProject() {
      try {
        const res = await apiFetch('/api/hmi/project');
        if (!res.ok) return;
        const p = await res.json();
        Object.assign(this.project, { name: p.name, startScreen: p.startScreen, screens: p.screens, revision: p.revision });
        this.refreshScreenSel();
      } catch (_) {}
    }

    // 성공하면 null, 실패하면 오류 문구
    async putProject(patch) {
      try {
        const res = await apiFetch('/api/hmi/project', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...patch, revision: this.project.revision }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          this.project.revision = data.revision;
          return null;
        }
        if (res.status === 409) {
          await this.reloadProject();
          return '다른 곳에서 화면 목록이 바뀌어 다시 불러왔습니다. 다시 시도하세요.';
        }
        return data.error || `HTTP ${res.status}`;
      } catch (e) {
        return e.message;
      }
    }

    async setStartScreen(id) {
      const err = await this.putProject({ startScreen: id });
      if (!err) this.project.startScreen = id;
      this.refreshScreenSel();
      return err;
    }

    // 새 화면 — id/제목/크기(기준 해상도)/내용(빈 화면 또는 현재 화면 복사)
    async newScreen() {
      if (this.saving || !(await this.confirmLeave())) return;
      const screens = this.project.screens || [];
      const ids = new Set(screens.map((x) => x.id));
      let n = screens.length + 1;
      while (ids.has(`screen_${n}`)) n++;
      const mon = [window.screen.width, window.screen.height];
      const presets = [mon, ...SIZE_PRESETS];
      const base = this.doc ? [this.doc.size.w, this.doc.size.h] : mon;
      const d = window.WHMI.dialog.open(`<div class="ed-dlg">
        <p>새 화면</p>
        <label class="ed-dlg-field"><span>id <small>영문·숫자·_·- (주소·화면 이동에 쓰임)</small></span><input type="text" data-n="id" value="screen_${n}" spellcheck="false" autocomplete="off"></label>
        <label class="ed-dlg-field"><span>제목</span><input type="text" data-n="title" value="새 화면" maxlength="${TITLE_MAX}"></label>
        <label class="ed-dlg-field"><span>화면 크기 <small>기준 해상도 — 현장 패널 해상도에 맞추세요</small></span>
          <select data-n="preset">
            ${presets.map(([w, h], i) => `<option value="${w}x${h}">${i === 0 ? `현재 모니터 (${w} × ${h})` : `${w} × ${h}`}</option>`).join('')}
            <option value="custom">직접 입력</option>
          </select></label>
        <div class="ed-dlg-size"><input type="number" data-n="w" min="${SCREEN_MIN}" max="${SCREEN_MAX}"> × <input type="number" data-n="h" min="${SCREEN_MIN}" max="${SCREEN_MAX}"></div>
        ${this.doc ? `<label class="ed-dlg-field"><span>내용</span><select data-n="from">
          <option value="blank">빈 화면</option><option value="copy">현재 화면 복사 (${esc(this.screenId)})</option></select></label>` : ''}
        <div class="dlg-err"></div>
        <div class="dlg-btns"><button type="button" data-k="cancel">취소</button><button type="button" data-k="ok" class="primary">만들기</button></div>
      </div>`);
      const q = (k) => d.querySelector(`[data-n="${k}"]`);
      const err = d.querySelector('.dlg-err');
      const setSize = (w, h) => { q('w').value = w; q('h').value = h; };
      const syncPreset = () => {
        const v = `${q('w').value}x${q('h').value}`;
        q('preset').value = [...q('preset').options].some((o) => o.value === v) ? v : 'custom';
      };
      setSize(mon[0], mon[1]);
      syncPreset();
      q('preset').addEventListener('change', () => {
        if (q('preset').value !== 'custom') setSize(...q('preset').value.split('x'));
      });
      q('w').addEventListener('input', syncPreset);
      q('h').addEventListener('input', syncPreset);
      q('from')?.addEventListener('change', () => {
        // 복사면 원본 크기를 기본으로(좌표가 그대로 맞도록)
        if (q('from').value === 'copy') { setSize(base[0], base[1]); syncPreset(); }
      });
      q('id').focus();
      q('id').select();

      const close = () => { document.removeEventListener('keydown', onKey, true); window.WHMI.dialog.close(); };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); }
      };
      document.addEventListener('keydown', onKey, true);
      const submit = async () => {
        const id = q('id').value.trim();
        const title = q('title').value.trim();
        const w = Math.round(Number(q('w').value)), h = Math.round(Number(q('h').value));
        if (!ID_RE.test(id)) { err.textContent = 'id는 영문·숫자·_·- 1~64자입니다.'; return; }
        if (ids.has(id)) { err.textContent = `"${id}"은(는) 이미 있는 화면입니다.`; return; }
        if (!title) { err.textContent = '제목을 입력하세요.'; return; }
        if (!(w >= SCREEN_MIN && w <= SCREEN_MAX && h >= SCREEN_MIN && h <= SCREEN_MAX)) { err.textContent = `크기는 ${SCREEN_MIN} ~ ${SCREEN_MAX} 사이여야 합니다.`; return; }
        const copy = q('from') && q('from').value === 'copy';
        const content = copy
          ? Object.assign(clone(this.doc), { id, title, size: { w, h } })
          : { format: 'whmi.screen', version: '0.1', id, title, size: { w, h }, background: DEFAULT_BG, widgets: [] };
        err.textContent = '';
        d.querySelector('[data-k="ok"]').disabled = true;
        try {
          const res = await apiFetch('/api/hmi/screens', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, title, content }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            err.textContent =
              data.maxScreens ? `화면은 최대 ${data.maxScreens}개까지 만들 수 있습니다.` :
              res.status === 413 ? '화면 데이터가 256KB를 넘습니다.' :
              res.status === 401 || res.status === 403 ? '권한이 없습니다(Manager 이상).' :
              (data.error || `HTTP ${res.status}`);
            d.querySelector('[data-k="ok"]').disabled = false;
            return;
          }
          close();
          (this.project.screens = screens).push({ id, title, revision: data.revision });
          this.project.revision = data.projectRevision;
          this.project.startScreen = data.startScreen;
          this.refreshScreenSel();
          await this.openScreen(id, { skipDraft: true });
          this.flash(`화면 "${title}"을(를) 만들었습니다`);
        } catch (e) {
          err.textContent = e.message;
          d.querySelector('[data-k="ok"]').disabled = false;
        }
      };
      d.addEventListener('click', (e) => {
        const k = e.target.closest('[data-k]')?.dataset.k;
        if (k === 'cancel') close();
        if (k === 'ok') submit();
      });
    }

    // 화면 관리 — 순서(▲▼), 시작 화면(★), 삭제. 모두 바로 서버에 반영.
    manageScreens() {
      const d = window.WHMI.dialog.open(`<div class="ed-dlg ed-manage">
        <p>화면 관리</p>
        <div class="ed-scr-list"></div>
        <div class="dlg-hint">★ 시작 화면 · 순서·시작 화면·삭제는 바로 적용됩니다.</div>
        <div class="dlg-err"></div>
        <div class="dlg-btns"><button type="button" data-k="close" class="primary">닫기</button></div>
      </div>`);
      const list = d.querySelector('.ed-scr-list');
      const err = d.querySelector('.dlg-err');
      let busy = false;
      const draw = () => {
        const screens = this.project.screens || [];
        list.innerHTML = screens.length ? screens.map((x, i) => `
          <div class="ed-scr-row" data-id="${esc(x.id)}">
            <button type="button" class="ed-scr-star${x.id === this.project.startScreen ? ' on' : ''}" data-a="start" title="시작 화면으로">★</button>
            <span class="ed-scr-name">${esc(x.title || x.id)} <small>${esc(x.id)}</small>${x.id === this.screenId ? ' <em>편집 중</em>' : ''}</span>
            <button type="button" data-a="up" title="위로"${i === 0 ? ' disabled' : ''}>▲</button>
            <button type="button" data-a="down" title="아래로"${i === screens.length - 1 ? ' disabled' : ''}>▼</button>
            <button type="button" data-a="del" class="ed-scr-del">삭제</button>
          </div>`).join('') : '<div class="dlg-hint">화면이 없습니다.</div>';
      };
      draw();
      const close = () => { document.removeEventListener('keydown', onKey, true); window.WHMI.dialog.close(); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
      document.addEventListener('keydown', onKey, true);

      d.addEventListener('click', async (e) => {
        if (e.target.closest('[data-k="close"]')) { close(); return; }
        const btn = e.target.closest('[data-a]');
        if (!btn || btn.disabled || busy) return;
        const id = btn.closest('.ed-scr-row').dataset.id;
        const screens = this.project.screens;
        const i = screens.findIndex((x) => x.id === id);
        err.textContent = '';
        const a = btn.dataset.a;
        // 삭제는 두 번 눌러 확인(대화상자가 하나뿐이라 버튼에서 확인)
        if (a === 'del' && !btn.classList.contains('confirm')) {
          list.querySelectorAll('.ed-scr-del.confirm').forEach((b) => { b.classList.remove('confirm'); b.textContent = '삭제'; });
          btn.classList.add('confirm');
          btn.textContent = '정말 삭제';
          return;
        }
        busy = true;
        let msg = null;
        if (a === 'start') {
          if (id !== this.project.startScreen) msg = await this.setStartScreen(id);
        } else if (a === 'up' || a === 'down') {
          const order = screens.map((x) => x.id);
          const j = a === 'up' ? i - 1 : i + 1;
          [order[i], order[j]] = [order[j], order[i]];
          msg = await this.putProject({ order });
          if (!msg) {
            [screens[i], screens[j]] = [screens[j], screens[i]];
            this.refreshScreenSel();
          }
        } else if (a === 'del') {
          msg = await this.deleteScreen(id);
        }
        busy = false;
        if (msg) err.textContent = msg;
        draw();
      });
    }

    async deleteScreen(id) {
      try {
        const res = await apiFetch(`/api/hmi/screens/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 409) return '시작 화면은 삭제할 수 없습니다. 다른 화면에 ★를 먼저 지정하세요.';
          if (res.status === 404) { await this.reloadProject(); return '이미 삭제된 화면입니다.'; }
          return data.error || `HTTP ${res.status}`;
        }
        this.project.screens = this.project.screens.filter((x) => x.id !== id);
        this.project.revision = data.projectRevision;
        this.project.startScreen = data.startScreen;
        try { localStorage.removeItem(this.draftKey(id)); } catch (_) {}
        if (id === this.screenId) {
          // 편집 중이던 화면을 지움 — 저장 안 한 변경도 함께 버리고 다른 화면으로
          this.dirty = false;
          clearTimeout(this.draftTimer);
          const next = this.project.startScreen || (this.project.screens[0] && this.project.screens[0].id);
          if (next) await this.openScreen(next);
          else this.showEmpty();
        }
        this.refreshScreenSel();
        return null;
      } catch (e) {
        return e.message;
      }
    }

    // 화면 설정(아무것도 선택하지 않았을 때 속성 창) — 제목/크기/배경은 화면 내용이라 [저장]으로 반영
    onScreenField(el) {
      const d = this.doc;
      const k = el.dataset.s;
      this.formError('');
      if (k === 'start') {
        this.setStartScreen(this.screenId).then((e) => { if (e) this.msg(e, 'err'); this.renderInspector(); });
        return;
      }
      if (k === 'title') {
        const t = el.value.trim();
        if (!t || t.length > TITLE_MAX) { this.formError(`제목은 1~${TITLE_MAX}자입니다.`); el.value = d.title || ''; return; }
        d.title = t;
      } else if (k === 'w' || k === 'h' || k === 'preset') {
        let w = d.size.w, h = d.size.h;
        if (k === 'preset') {
          if (el.value === 'custom') return;
          [w, h] = el.value.split('x').map(Number);
        } else {
          const v = Math.round(Number(el.value));
          if (!(v >= SCREEN_MIN && v <= SCREEN_MAX)) { this.formError(`크기는 ${SCREEN_MIN} ~ ${SCREEN_MAX} 사이입니다.`); el.value = d.size[k]; return; }
          if (k === 'w') w = v; else h = v;
        }
        if (w === d.size.w && h === d.size.h) return;
        // 위젯 좌표는 그대로 — 줄이면 밖으로 나간 위젯은 경고로 알려준다
        d.size = { w, h };
        this.render();
      } else if (k === 'bg' || k === 'bgText') {
        const v = el.value.trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
          // 입력란만 원래 값으로(속성 창을 다시 그리면 오류 문구가 지워진다)
          this.formError('배경색은 #RRGGBB 형식입니다.');
          el.value = d.background || DEFAULT_BG;
          return;
        }
        d.background = v;
        this.render();
      }
      this.commit();
    }

    // 편집은 항상 서버의 최신 내용에서 시작한다(실행 모드 캐시를 쓰지 않음 — revision이 필요)
    // skipDraft: 충돌 후 "서버 내용 불러오기"처럼 임시 저장본을 묻지 않고 서버 것으로 시작할 때
    async openScreen(id, { skipDraft } = {}) {
      this.msg('불러오는 중…');
      try {
        const res = await apiFetch(`/api/hmi/screens/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        this.screenId = id;
        this.doc = data.content;
        this.revision = data.revision;
        this.sel.clear();
        this.resetHistory();
        await this.readValues();
        this.screenSel.value = id;
        this.render();
        this.renderInspector();
        this.msg('');
        if (skipDraft) this.clearDraft();
        else await this.offerDraft();
      } catch (e) {
        this.msg(`화면 "${id}"을(를) 불러올 수 없습니다: ${e.message}`, 'err');
        if (this.screenId) this.screenSel.value = this.screenId;
      }
    }

    // 미리보기용 현재 값 1회 조회(편집 중엔 폴링하지 않음). 실패해도 편집은 계속한다.
    async readValues() {
      this.values = {};
      const ids = [...new Set(this.doc.widgets.flatMap((w) => [w.tag, w.enableWhen && w.enableWhen.tag]).filter((t) => t && this.tags[t]))];
      if (!ids.length) return;
      try {
        const res = await apiFetch(`/api/hmi/values?tags=${ids.map(encodeURIComponent).join(',')}`);
        if (res.ok) this.values = (await res.json()).values || {};
      } catch (_) {}
    }

    // ---- 그리기 -----------------------------------------------------------
    render() {
      const { w: W, h: H } = this.doc.size;
      this.canvas.innerHTML = '';
      const root = (this.svgRoot = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', class: 'whmi-screen ed-svg' }, this.canvas));
      const defs = svg('defs', {}, root);
      this.gridPattern = svg('pattern', { id: 'ed-grid', patternUnits: 'userSpaceOnUse' }, defs);
      svg('path', { class: 'ed-grid-line' }, this.gridPattern);
      svg('path', { class: 'ed-grid-line major' }, this.gridPattern);
      svg('rect', { width: W, height: H, fill: this.doc.background || '#14181f' }, root);
      this.widgetLayer = svg('g', { class: 'ed-widgets' }, root);
      this.overlay = svg('g', { class: 'ed-overlay' }, root);
      // 격자는 편집 보조선이라 위젯 위에 옅게 겹친다(큰 패널 배경 위에서도 보이도록) — 선택 표시보다는 아래
      this.gridRect = svg('rect', { width: W, height: H, fill: 'url(#ed-grid)', 'pointer-events': 'none' }, this.overlay);
      // 화면 경계 — 확대/축소와 상관없이 1px로 보이게
      svg('rect', { width: W, height: H, class: 'ed-bounds' }, this.overlay);
      this.selLayer = svg('g', {}, this.overlay);

      this.nodes = new Map(); // widget id → { wrap, g }
      for (const w of this.doc.widgets) this.drawOne(w);
      this.updateGrid();
      this.drawSelection();

      root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      root.addEventListener('pointermove', (e) => this.onPointerMove(e));
      root.addEventListener('pointerup', (e) => this.onPointerUp(e));
      root.addEventListener('pointercancel', (e) => this.onPointerUp(e));
      root.addEventListener('pointerleave', () => { if (!this.drag) this.posEl.textContent = ''; });
    }

    // 위젯마다 자기 <defs>를 가진 묶음(wrap)으로 그린다 — 위젯이 만드는 clip/gradient id가
    // 위젯 id 기준이라, 크기를 바꿔 다시 그릴 때 묶음째 지우면 예전 defs가 남지 않는다.
    drawOne(w, before) {
      const wrap = svg('g', { class: 'ed-item', 'data-id': w.id });
      this.widgetLayer.insertBefore(wrap, before || null);
      const ctx = {
        defs: svg('defs', {}, wrap),
        tag: (id) => this.tags[id],
        write: () => {},
        inputDialog: async () => null,
        goto: () => {},
      };
      let r;
      try {
        r = window.WHMI.drawWidget(wrap, w, ctx);
      } catch (e) {
        wrap.remove();   // 잘못된 props 등으로 그리기 실패 — 반쯤 그린 묶음을 남기지 않는다
        throw e;
      }
      const { g, p, inst } = r;
      if (inst.update) {
        try { inst.update(previewInfo(w, p, this.tags, this.values[w.tag])); } catch (e) { console.warn('[whmi-editor] 미리보기 실패', w.id, e); }
      }
      this.nodes.set(w.id, { wrap, g });
    }

    redrawOne(w) {
      const old = this.nodes.get(w.id);
      const before = old ? old.wrap.nextSibling : null;
      if (old) old.wrap.remove();
      this.drawOne(w, before);
    }

    updateGrid() {
      if (!this.gridRect) return;
      // 패턴 한 장 = 5칸. 안쪽 4줄은 옅은 선, 테두리(5칸마다)는 조금 진한 선
      const n = this.grid.size, M = n * 5;
      this.gridPattern.setAttribute('width', M);
      this.gridPattern.setAttribute('height', M);
      let minor = '';
      for (let i = 1; i < 5; i++) minor += `M ${i * n} 0 V ${M} M 0 ${i * n} H ${M} `;
      const [minorPath, majorPath] = this.gridPattern.children;
      minorPath.setAttribute('d', minor);
      majorPath.setAttribute('d', `M ${M} 0 L 0 0 0 ${M}`);
      this.gridRect.style.display = this.grid.show ? '' : 'none';
    }

    // 실제 픽셀 1px이 화면 좌표로 몇인지(손잡이를 일정한 크기로 그리기 위해)
    unitPx() {
      const m = this.svgRoot && this.svgRoot.getScreenCTM();
      return m && m.a ? 1 / m.a : 1;
    }

    drawSelection() {
      if (!this.selLayer) return;
      this.selLayer.innerHTML = '';
      const u = this.unitPx();
      this.updateToolbar();
      const list = this.selected();
      // 여러 개 선택이면 기준 위젯(먼저 선택한 것 — 크기 맞추기 기준)은 실선으로
      const primary = list.length > 1 ? this.primaryId() : null;
      for (const w of list) {
        svg('rect', { x: w.x, y: w.y, width: w.w, height: w.h, 'data-id': w.id, class: `ed-sel${w.id === primary ? ' primary' : ''}` }, this.selLayer);
      }
      // 크기 조절 손잡이는 하나만 선택했을 때만
      if (list.length === 1) {
        const w = list[0];
        const hs = HANDLE_PX * u;
        for (const [name, fx, fy, cursor] of HANDLES) {
          svg('rect', {
            x: w.x + w.w * fx - hs / 2, y: w.y + w.h * fy - hs / 2, width: hs, height: hs,
            class: 'ed-handle', 'data-h': name, style: `cursor:${cursor}`,
          }, this.selLayer);
        }
      }
      if (this.drag && this.drag.kind === 'marquee' && this.drag.rect) {
        const r = this.drag.rect;
        svg('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'ed-marquee' }, this.selLayer);
      }
    }

    // 선택 순서상 첫 번째(Set은 넣은 순서를 유지)
    primaryId() {
      for (const id of this.sel) if (this.nodes.has(id)) return id;
      return null;
    }

    selected() {
      return this.doc ? this.doc.widgets.filter((w) => this.sel.has(w.id)) : [];
    }

    // ---- 실행 취소 / 변경 확정 ---------------------------------------------
    // 화면 JSON을 통째로 문자열로 저장하는 방식 — 명령별 되돌리기 코드가 필요 없어 단순하고,
    // 화면이 작아(약 20KB) 50단계를 들고 있어도 부담이 적다.
    resetHistory() {
      this.past = [];
      this.future = [];
      this.current = JSON.stringify(this.doc);
      this.saved = this.current;   // 서버에 저장된 상태 — 같으면 "변경됨" 표시를 끈다
      this.lastMerge = null;
      this.setDirty(false);
      this.updateToolbar();
    }

    // 편집 결과가 확정될 때마다 호출. mergeKey가 같은 변경이 1초 안에 이어지면(방향키 연타)
    // 한 단계로 묶는다.
    commit(mergeKey) {
      const next = JSON.stringify(this.doc);
      if (next === this.current) { this.renderInspector(); return; }
      const now = Date.now();
      const merge = mergeKey && this.lastMerge && this.lastMerge.key === mergeKey && now - this.lastMerge.t < 1000;
      if (!merge) {
        this.past.push(this.current);
        if (this.past.length > HISTORY_MAX) this.past.shift();
      }
      this.lastMerge = mergeKey ? { key: mergeKey, t: now } : null;
      this.current = next;
      this.future = [];
      this.afterChange();
    }

    afterChange() {
      this.setDirty(this.current !== this.saved);
      this.scheduleDraft();
      this.renderInspector();
      this.updateToolbar();
    }

    undo() {
      if (!this.past.length) return;
      this.future.push(this.current);
      this.current = this.past.pop();
      this.restore();
    }

    redo() {
      if (!this.future.length) return;
      this.past.push(this.current);
      this.current = this.future.pop();
      this.restore();
    }

    // 되돌린 상태로 전체를 다시 그린다(한 번뿐이라 위젯 수십 개여도 충분히 빠름)
    restore() {
      this.doc = JSON.parse(this.current);
      this.lastMerge = null;
      const ids = new Set(this.doc.widgets.map((w) => w.id));
      this.sel = new Set([...this.sel].filter((id) => ids.has(id)));
      this.render();
      this.afterChange();
    }

    setDirty(v) {
      this.dirty = v;
      const el = this.root.querySelector('.ed-dirty');
      if (el) el.hidden = !v;
      this.updateToolbar();
    }

    // ---- 저장 -------------------------------------------------------------
    // 서버는 명시적으로 [저장]할 때만 기록한다(플래시 쓰기 최소화). revision으로 동시 편집 충돌을 막는다.
    async save() {
      if (!this.doc || this.saving || !this.dirty) return !this.dirty;
      const sent = this.current;   // 저장 중에도 편집할 수 있으니 보낸 시점 상태를 기억
      const bytes = new Blob([sent]).size;
      if (bytes > MAX_SCREEN_BYTES) {
        this.msg(`화면 데이터가 ${Math.round(bytes / 1024)}KB로 저장 한도(256KB)를 넘습니다.`, 'err');
        return false;
      }
      this.saving = true;
      this.updateToolbar();
      this.msg('저장 중…');
      try {
        const res = await apiFetch(`/api/hmi/screens/${encodeURIComponent(this.screenId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: this.doc.title, content: JSON.parse(sent), revision: this.revision }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          this.revision = data.revision;
          this.saved = sent;
          this.setDirty(this.current !== this.saved);
          this.flushDraft();
          const ref = (this.project.screens || []).find((x) => x.id === this.screenId);
          if (ref) { ref.revision = data.revision; ref.title = this.doc.title; }
          this.refreshScreenSel();
          this.renderInspector();
          this.flash(`저장됨 · revision ${data.revision}`);
          return true;
        }
        if (res.status === 409) return await this.resolveConflict(data);
        const reason =
          res.status === 413 ? '화면 데이터가 저장 한도(256KB)를 넘습니다.' :
          res.status === 401 || res.status === 403 ? '저장 권한이 없습니다(Manager 이상).' :
          `${data.error || `HTTP ${res.status}`}`;
        this.msg(`저장 실패: ${reason}`, 'err');
        return false;
      } catch (e) {
        this.msg(`저장 실패: ${e.message}`, 'err');
        return false;
      } finally {
        this.saving = false;
        this.updateToolbar();
      }
    }

    // 다른 사람이 먼저 저장함(409) — 서버 것을 불러오거나, 내 것으로 덮어쓴다
    async resolveConflict(info) {
      this.msg('');
      const k = await this.choose('다른 곳에서 이 화면이 먼저 저장되었습니다.',
        `저장: ${info.updatedBy || '알 수 없음'} · ${(info.updatedAt || '').replace('T', ' ')} · revision ${info.revision}\n` +
        `내 편집의 기준 revision: ${this.revision}\n\n` +
        '덮어쓰면 상대방의 변경 내용이 사라집니다.',
        [{ key: 'cancel', label: '취소' }, { key: 'reload', label: '서버 내용 불러오기' }, { key: 'overwrite', label: '내 것으로 덮어쓰기', primary: true }],
        'cancel');
      if (k === 'overwrite') {
        this.revision = info.revision;
        this.saving = false;
        return this.save();
      }
      if (k === 'reload') {
        this.dirty = false;
        await this.openScreen(this.screenId, { skipDraft: true });
      }
      return false;
    }

    // 떠나도 되는지(화면 전환 / 실행 모드 / 메뉴 이동). true면 진행.
    async confirmLeave() {
      if (!this.dirty) return true;
      const k = await this.choose('저장하지 않은 변경이 있습니다.', `화면: ${this.screenId}`,
        [{ key: 'cancel', label: '취소' }, { key: 'discard', label: '저장 안 함' }, { key: 'save', label: '저장', primary: true }],
        'cancel');
      if (k === 'save') return this.save();
      if (k === 'discard') {
        this.clearDraft();
        this.dirty = false;
        return true;
      }
      return false;
    }

    async requestExit() {
      if (await this.confirmLeave()) this.onExit && this.onExit();
    }

    // 편집기 안 선택 대화상자(전체 화면에서도 보이도록 브라우저 confirm 대신)
    // buttons: [{ key, label, primary }], escKey: Esc로 고를 키(없으면 Esc 무시)
    choose(message, detail, buttons, escKey) {
      return new Promise((resolve) => {
        const d = window.WHMI.dialog.open(`<p>${esc(message)}</p>
          ${detail ? `<div class="dlg-hint dlg-detail">${esc(detail)}</div>` : ''}
          <div class="dlg-btns">${buttons.map((b) => `<button type="button" data-k="${b.key}"${b.primary ? ' class="primary"' : ''}>${esc(b.label)}</button>`).join('')}</div>`);
        const done = (k) => {
          document.removeEventListener('keydown', onKey, true);
          window.WHMI.dialog.close();
          resolve(k);
        };
        const onKey = (e) => {
          if (e.key === 'Escape' && escKey) { e.preventDefault(); done(escKey); }
        };
        document.addEventListener('keydown', onKey, true);
        d.addEventListener('click', (e) => {
          const k = e.target.closest('[data-k]')?.dataset.k;
          if (k) done(k);
        });
        // 기본 포커스: 취소가 있으면 취소(Enter로 덮어쓰기 같은 되돌릴 수 없는 동작이 실행되지 않게)
        (escKey ? d.querySelector(`[data-k="${escKey}"]`) : d.querySelector('.primary'))?.focus();
      });
    }

    // ---- 임시 저장(localStorage) --------------------------------------------
    // 저장 안 한 편집을 브라우저에 보관 — 탭이 닫히거나 전원이 꺼져도 다음에 복원할 수 있게.
    // 사용자·화면별 키. 저장소가 막혀 있어도(사생활 모드 등) 편집은 계속된다.
    draftKey(id = this.screenId) {
      return `whmi.draft.${getUsername() || '-'}.${id}`;
    }

    scheduleDraft() {
      clearTimeout(this.draftTimer);
      this.draftTimer = setTimeout(() => this.flushDraft(), DRAFT_DELAY_MS);
    }

    flushDraft() {
      clearTimeout(this.draftTimer);
      if (!this.screenId || this.current == null) return;
      try {
        if (this.current === this.saved) localStorage.removeItem(this.draftKey());
        else localStorage.setItem(this.draftKey(), JSON.stringify({ baseRevision: this.revision, savedAt: Date.now(), doc: this.current }));
      } catch (e) {
        if (!this.draftWarned) { this.draftWarned = true; this.msg('브라우저 임시 저장을 쓸 수 없습니다 — 자주 저장하세요.', 'err'); }
      }
    }

    clearDraft() {
      clearTimeout(this.draftTimer);
      try { localStorage.removeItem(this.draftKey()); } catch (_) {}
    }

    // 화면을 열 때 이전에 저장 안 한 편집이 남아 있으면 복원할지 묻는다
    async offerDraft() {
      let dr = null;
      try { dr = JSON.parse(localStorage.getItem(this.draftKey()) || 'null'); } catch (_) {}
      if (!dr || typeof dr.doc !== 'string') return;
      if (dr.doc === this.current) { this.clearDraft(); return; }
      const changed = dr.baseRevision !== this.revision;
      const k = await this.choose('저장하지 않은 편집 내용이 있습니다. 복원할까요?',
        `임시 저장: ${new Date(dr.savedAt).toLocaleString()}` +
        (changed ? `\n\n⚠ 그 사이 서버의 화면이 바뀌었습니다(revision ${dr.baseRevision} → ${this.revision}).\n복원한 뒤 저장하면 충돌 확인 창이 뜹니다.` : ''),
        [{ key: 'discard', label: '버리기' }, { key: 'restore', label: '복원', primary: true }]);
      if (k !== 'restore') { this.clearDraft(); return; }
      // 서버 상태를 실행 취소 한 단계로 남겨 두고 임시 저장본으로 바꾼다.
      // revision은 임시 저장 당시 기준 — 그 사이 서버가 바뀌었으면 저장 시 409로 확인하게 된다.
      this.past = [this.current];
      this.future = [];
      this.current = dr.doc;
      this.doc = JSON.parse(dr.doc);
      this.revision = dr.baseRevision;
      this.sel.clear();
      this.render();
      this.afterChange();
      this.flash('임시 저장 내용을 복원했습니다');
    }

    // ---- 포인터(선택/이동/크기 조절/영역 선택) ---------------------------------
    toScreen(e) {
      const pt = this.svgRoot.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(this.svgRoot.getScreenCTM().inverse());
      return { x: p.x, y: p.y };
    }

    // 위에 그려진(배열 뒤쪽) 위젯부터 찾는다
    hitTest(x, y) {
      const ws = this.doc.widgets;
      for (let i = ws.length - 1; i >= 0; i--) if (inside(x, y, ws[i])) return ws[i];
      return null;
    }

    snap(v) {
      return this.grid.snap ? Math.round(v / this.grid.size) * this.grid.size : Math.round(v);
    }

    onPointerDown(e) {
      if (e.button !== 0 || !this.doc) return;
      // 도구줄/속성 창의 입력란에 남은 포커스를 풀어야 방향키·단축키가 편집기로 온다
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      const pos = this.toScreen(e);
      const handle = e.target.dataset && e.target.dataset.h;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      let kind, collapseTo = null;

      if (handle) {
        kind = 'resize';
      } else {
        // Alt+드래그는 위젯 위에서 시작해도 영역 선택(큰 패널 배경 위에서 쓰기 위해)
        const hit = e.altKey ? null : this.hitTest(pos.x, pos.y);
        if (hit) {
          if (additive) {
            if (this.sel.has(hit.id)) this.sel.delete(hit.id); else this.sel.add(hit.id);
          } else if (!this.sel.has(hit.id)) {
            this.sel.clear();
            this.sel.add(hit.id);
          } else if (this.sel.size > 1) {
            // 여러 개 선택 중 그중 하나를 누름 — 끌면 묶음 이동, 그냥 떼면 그것만 선택
            collapseTo = hit.id;
          }
          kind = this.sel.has(hit.id) ? 'move' : null;
        } else {
          if (!additive) this.sel.clear();
          kind = 'marquee';
        }
        this.drawSelection();
        this.renderInspector();
      }
      if (!kind) return;
      e.preventDefault();
      this.svgRoot.setPointerCapture(e.pointerId);
      this.drag = {
        kind, handle, collapseTo, start: pos, startClient: { x: e.clientX, y: e.clientY }, active: false,
        additive, base: new Set(this.sel),
        // 원래 위치/크기 — 드래그 중엔 이 값 기준으로 계산하고 놓을 때 doc에 반영
        orig: new Map(this.selected().map((w) => [w.id, { x: w.x, y: w.y, w: w.w, h: w.h }])),
      };
    }

    onPointerMove(e) {
      if (!this.doc || !this.svgRoot) return;
      const pos = this.toScreen(e);
      this.posEl.textContent = `${Math.round(pos.x)}, ${Math.round(pos.y)}`;
      const d = this.drag;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) < DRAG_START_PX) return;
        d.active = true;
      }
      if (d.kind === 'move') this.dragMove(pos);
      else if (d.kind === 'resize') this.dragResize(pos);
      else if (d.kind === 'marquee') this.dragMarquee(pos);
    }

    // 묶음 전체를 같은 거리만큼 이동. 격자는 묶음의 왼쪽 위 기준으로 맞추고,
    // 묶음이 화면 밖으로 나가지 않게 막는다.
    dragMove(pos) {
      const d = this.drag;
      const o = [...d.orig.values()];
      const bx = Math.min(...o.map((r) => r.x)), by = Math.min(...o.map((r) => r.y));
      const bw = Math.max(...o.map((r) => r.x + r.w)) - bx, bh = Math.max(...o.map((r) => r.y + r.h)) - by;
      const { w: W, h: H } = this.doc.size;
      const nx = Math.min(Math.max(this.snap(bx + pos.x - d.start.x), 0), Math.max(0, W - bw));
      const ny = Math.min(Math.max(this.snap(by + pos.y - d.start.y), 0), Math.max(0, H - bh));
      d.dx = nx - bx; d.dy = ny - by;
      for (const w of this.selected()) {
        const r = d.orig.get(w.id);
        w.x = r.x + d.dx; w.y = r.y + d.dy;
        this.nodes.get(w.id).g.setAttribute('transform', `translate(${w.x},${w.y})`);
      }
      this.drawSelection();
      this.showGeometry();
    }

    // 손잡이 방향의 변만 움직인다. 다시 그리기는 프레임당 한 번(저사양 기기 고려).
    dragResize(pos) {
      const d = this.drag;
      const w = this.selected()[0];
      if (!w) return;
      const r = d.orig.get(w.id);
      const h = d.handle;
      const { w: W, h: H } = this.doc.size;
      let x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
      // 움직이는 변은 화면 경계 안, 반대쪽 변과는 최소 크기만큼 떨어지게
      if (h.includes('w')) x1 = clamp(this.snap(r.x + pos.x - d.start.x), 0, x2 - MIN_SIZE);
      if (h.includes('e')) x2 = clamp(this.snap(r.x + r.w + pos.x - d.start.x), x1 + MIN_SIZE, W);
      if (h.includes('n')) y1 = clamp(this.snap(r.y + pos.y - d.start.y), 0, y2 - MIN_SIZE);
      if (h.includes('s')) y2 = clamp(this.snap(r.y + r.h + pos.y - d.start.y), y1 + MIN_SIZE, H);
      Object.assign(w, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      this.drawSelection();
      this.showGeometry();
      if (!d.raf) {
        d.raf = requestAnimationFrame(() => { d.raf = 0; this.redrawOne(w); });
      }
    }

    dragMarquee(pos) {
      const d = this.drag;
      const r = {
        x: Math.min(d.start.x, pos.x), y: Math.min(d.start.y, pos.y),
        w: Math.abs(pos.x - d.start.x), h: Math.abs(pos.y - d.start.y),
      };
      d.rect = r;
      // 영역 안에 완전히 들어간 위젯만 선택(큰 패널 배경이 딸려오지 않게)
      this.sel = new Set(d.additive ? d.base : []);
      for (const w of this.doc.widgets) if (contains(r, w)) this.sel.add(w.id);
      this.drawSelection();
    }

    onPointerUp(e) {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      if (this.svgRoot.hasPointerCapture(e.pointerId)) this.svgRoot.releasePointerCapture(e.pointerId);
      if (d.raf) cancelAnimationFrame(d.raf);
      if (d.active && d.kind === 'resize') this.redrawOne(this.selected()[0]);
      if (!d.active && d.collapseTo) this.sel = new Set([d.collapseTo]);
      this.drawSelection();
      if (d.active && (d.kind === 'move' || d.kind === 'resize')) {
        const moved = this.selected().some((w) => {
          const r = d.orig.get(w.id);
          return r && (r.x !== w.x || r.y !== w.y || r.w !== w.w || r.h !== w.h);
        });
        if (moved) this.commit();
        else this.renderInspector();
      } else {
        this.renderInspector();
      }
    }

    // ---- 키보드 -----------------------------------------------------------
    handleKey(e) {
      if (!this.doc || document.querySelector('.dlg-backdrop:not([hidden])')) return;
      // Ctrl+S는 입력란 안에서도 — 입력 중인 값을 먼저 반영(blur → change)하고 저장
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        this.save();
        return;
      }
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const shortcut =
        mod && key === 'z' && !e.shiftKey ? 'undo' :
        mod && (key === 'y' || (key === 'z' && e.shiftKey)) ? 'redo' :
        mod && key === 'd' ? 'dup' :
        mod && key === 'c' ? 'copy' :
        mod && key === 'x' ? 'cut' :
        mod && key === 'v' ? 'paste' :
        mod && e.code === 'BracketRight' ? (e.shiftKey ? 'front' : 'forward') :
        mod && e.code === 'BracketLeft' ? (e.shiftKey ? 'back' : 'backward') :
        !mod && (e.key === 'Delete' || e.key === 'Backspace') ? 'del' : null;
      if (shortcut) {
        e.preventDefault();
        this.action(shortcut);
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        this.sel = new Set(this.doc.widgets.map((w) => w.id));
        this.drawSelection();
        this.renderInspector();
        return;
      }
      if (e.key === 'Escape') {
        this.sel.clear();
        this.drawSelection();
        this.renderInspector();
        return;
      }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (dir && this.sel.size) {
        e.preventDefault();
        // 1px, Shift는 격자 간격(격자 맞춤 꺼짐이면 10px)
        const step = e.shiftKey ? (this.grid.snap ? this.grid.size : 10) : 1;
        this.moveBy(dir[0] * step, dir[1] * step);
      }
    }

    moveBy(dx, dy) {
      const list = this.selected();
      const { w: W, h: H } = this.doc.size;
      const bx = Math.min(...list.map((w) => w.x)), by = Math.min(...list.map((w) => w.y));
      const bw = Math.max(...list.map((w) => w.x + w.w)) - bx, bh = Math.max(...list.map((w) => w.y + w.h)) - by;
      dx = Math.min(Math.max(bx + dx, 0), Math.max(0, W - bw)) - bx;
      dy = Math.min(Math.max(by + dy, 0), Math.max(0, H - bh)) - by;
      if (!dx && !dy) return;
      for (const w of list) {
        w.x += dx; w.y += dy;
        this.nodes.get(w.id).g.setAttribute('transform', `translate(${w.x},${w.y})`);
      }
      this.drawSelection();
      this.commit(`move:${[...this.sel].sort().join(',')}`);
    }

    // ---- 추가 / 삭제 / 복제 / 복사 / 그리는 순서 --------------------------------
    // 같은 접두어에서 비어 있는 가장 작은 번호: numeric_1, numeric_2 …
    nextId(base) {
      const ids = new Set(this.doc.widgets.map((w) => w.id));
      let n = 1;
      while (ids.has(`${base}_${n}`)) n++;
      return `${base}_${n}`;
    }

    // (cx, cy)를 중심으로 새 위젯 추가 — 격자 맞춤, 화면 안으로
    addWidget(type, cx, cy) {
      const d = NEW_WIDGET[type] || NEW_WIDGET_FALLBACK;
      const { w: W, h: H } = this.doc.size;
      const w = Math.min(d.w, W), h = Math.min(d.h, H);
      const wd = {
        id: this.nextId(type), type,
        x: clamp(this.snap(cx - w / 2), 0, W - w),
        y: clamp(this.snap(cy - h / 2), 0, H - h),
        w, h,
      };
      if (d.props) wd.props = clone(d.props);
      this.doc.widgets.push(wd);
      this.drawOne(wd);
      this.sel = new Set([wd.id]);
      this.drawSelection();
      this.commit();
    }

    // 목록에서 클릭만 했을 때 — 화면 가운데, 같은 자리에 이미 있으면 계단식으로 비켜 놓는다
    addWidgetAtCenter(type) {
      const d = NEW_WIDGET[type] || NEW_WIDGET_FALLBACK;
      const step = Math.max(this.grid.size, 10);
      let cx = this.doc.size.w / 2, cy = this.doc.size.h / 2;
      for (let i = 0; i < 20; i++) {
        const x = this.snap(cx - d.w / 2), y = this.snap(cy - d.h / 2);
        if (!this.doc.widgets.some((w) => w.x === x && w.y === y)) break;
        cx += step; cy += step;
      }
      this.addWidget(type, cx, cy);
    }

    // 위젯 목록에서 끌어다 놓기 — 놓은 곳이 위젯 중심이 된다. 끌지 않고 떼면 가운데에 추가.
    paletteDown(e) {
      const item = e.target.closest('.ed-palette-item');
      if (!item || !this.doc || e.button !== 0) return;
      e.preventDefault();
      const type = item.dataset.type;
      const d = NEW_WIDGET[type] || NEW_WIDGET_FALLBACK;
      const sx = e.clientX, sy = e.clientY;
      let ghost = null;
      const move = (ev) => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_START_PX) return;
          // 끄는 동안 보이는 상자 — 실제로 놓일 크기(현재 확대 비율 반영)
          const k = 1 / this.unitPx();
          ghost = document.createElement('div');
          ghost.className = 'ed-ghost';
          ghost.textContent = TYPE_LABEL[type] || type;
          ghost.style.width = `${d.w * k}px`;
          ghost.style.height = `${d.h * k}px`;
          this.root.appendChild(ghost);
        }
        ghost.style.transform = `translate(${ev.clientX - ghost.offsetWidth / 2}px, ${ev.clientY - ghost.offsetHeight / 2}px)`;
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        if (!ghost) { this.addWidgetAtCenter(type); return; }
        ghost.remove();
        const p = this.toScreen(ev);
        if (p.x >= 0 && p.y >= 0 && p.x <= this.doc.size.w && p.y <= this.doc.size.h) this.addWidget(type, p.x, p.y);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    }

    deleteSel() {
      if (!this.sel.size) return;
      this.doc.widgets = this.doc.widgets.filter((w) => !this.sel.has(w.id));
      for (const id of this.sel) {
        this.nodes.get(id)?.wrap.remove();
        this.nodes.delete(id);
      }
      this.sel.clear();
      this.drawSelection();
      this.commit();
    }

    copySel() {
      const list = this.selected();
      if (!list.length) return false;
      this.clipboard = JSON.stringify(list);
      this.pasteCount = 0;
      this.flash(`${list.length}개 복사됨`);
      return true;
    }

    paste() {
      if (!this.clipboard) return;
      this.pasteCount = (this.pasteCount || 0) + 1;
      this.insertCopies(JSON.parse(this.clipboard), this.copyOffset() * this.pasteCount);
    }

    duplicate() {
      const list = this.selected();
      if (list.length) this.insertCopies(clone(list), this.copyOffset());
    }

    copyOffset() { return this.grid.snap ? this.grid.size : 10; }

    // 사본을 맨 위에 추가하고 사본을 선택. 묶음째 off만큼 비켜 놓되 화면 밖으로는 안 나가게.
    // id는 원본 이름 + 빈 번호(num_temp → num_temp_1), 원래 그리는 순서는 유지.
    insertCopies(list, off) {
      const { w: W, h: H } = this.doc.size;
      const bx = Math.min(...list.map((w) => w.x)), by = Math.min(...list.map((w) => w.y));
      const bw = Math.max(...list.map((w) => w.x + w.w)) - bx, bh = Math.max(...list.map((w) => w.y + w.h)) - by;
      const dx = clamp(bx + off, 0, Math.max(0, W - bw)) - bx;
      const dy = clamp(by + off, 0, Math.max(0, H - bh)) - by;
      const order = new Map(this.doc.widgets.map((w, i) => [w.id, i]));
      list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      this.sel = new Set();
      for (const src of list) {
        const c = clone(src);
        c.id = this.nextId(String(src.id).replace(/_\d+$/, ''));
        c.x += dx; c.y += dy;
        this.doc.widgets.push(c);
        this.drawOne(c);
        this.sel.add(c.id);
      }
      this.drawSelection();
      this.commit();
    }

    // 그리는 순서(배열 순서) 변경. 여러 개 선택이면 선택한 것끼리의 순서는 유지.
    reorder(mode) {
      const ws = this.doc.widgets.slice();
      const isSel = (w) => this.sel.has(w.id);
      if (mode === 'front') this.doc.widgets = ws.filter((w) => !isSel(w)).concat(ws.filter(isSel));
      else if (mode === 'back') this.doc.widgets = ws.filter(isSel).concat(ws.filter((w) => !isSel(w)));
      else if (mode === 'forward') {
        for (let i = ws.length - 2; i >= 0; i--) if (isSel(ws[i]) && !isSel(ws[i + 1])) [ws[i], ws[i + 1]] = [ws[i + 1], ws[i]];
        this.doc.widgets = ws;
      } else if (mode === 'backward') {
        for (let i = 1; i < ws.length; i++) if (isSel(ws[i]) && !isSel(ws[i - 1])) [ws[i], ws[i - 1]] = [ws[i - 1], ws[i]];
        this.doc.widgets = ws;
      }
      // 다시 그리지 않고 DOM 순서만 맞춘다
      for (const w of this.doc.widgets) this.widgetLayer.appendChild(this.nodes.get(w.id).wrap);
      this.commit();
    }

    // ---- 정렬 / 간격 / 크기 맞추기 -------------------------------------------
    bbox(list) {
      const x = Math.min(...list.map((w) => w.x)), y = Math.min(...list.map((w) => w.y));
      return { x, y, w: Math.max(...list.map((w) => w.x + w.w)) - x, h: Math.max(...list.map((w) => w.y + w.h)) - y };
    }

    // 위치만 바뀐 위젯은 transform만, 크기가 바뀐 위젯은 다시 그린다
    applyGeometry(before) {
      for (const w of this.selected()) {
        const b = before.get(w.id);
        if (b.w !== w.w || b.h !== w.h) this.redrawOne(w);
        else if (b.x !== w.x || b.y !== w.y) this.nodes.get(w.id).g.setAttribute('transform', `translate(${w.x},${w.y})`);
      }
      this.drawSelection();
      this.commit();
    }

    snapshotGeometry() {
      return new Map(this.selected().map((w) => [w.id, { x: w.x, y: w.y, w: w.w, h: w.h }]));
    }

    // 여러 개면 선택 범위 기준, 하나면 화면 기준
    align(mode) {
      const list = this.selected();
      if (!list.length) return;
      const before = this.snapshotGeometry();
      const r = list.length === 1 ? { x: 0, y: 0, w: this.doc.size.w, h: this.doc.size.h } : this.bbox(list);
      for (const w of list) {
        if (mode === 'left') w.x = r.x;
        else if (mode === 'hcenter') w.x = Math.round(r.x + (r.w - w.w) / 2);
        else if (mode === 'right') w.x = r.x + r.w - w.w;
        else if (mode === 'top') w.y = r.y;
        else if (mode === 'vmiddle') w.y = Math.round(r.y + (r.h - w.h) / 2);
        else if (mode === 'bottom') w.y = r.y + r.h - w.h;
      }
      this.applyGeometry(before);
    }

    // 양 끝 위젯은 두고 사이 간격(가장자리 사이)을 같게 — 3개 이상
    distribute(axis) {
      const list = this.selected();
      if (list.length < 3) return;
      const before = this.snapshotGeometry();
      const [pos, size] = axis === 'h' ? ['x', 'w'] : ['y', 'h'];
      list.sort((a, b) => a[pos] - b[pos] || a[size] - b[size]);
      const first = list[0], last = list[list.length - 1];
      const span = last[pos] + last[size] - first[pos];
      const gap = (span - list.reduce((t, w) => t + w[size], 0)) / (list.length - 1);
      let cur = first[pos];
      for (const w of list) {
        w[pos] = Math.round(cur);
        cur += w[size] + gap;
      }
      this.applyGeometry(before);
    }

    // 기준 위젯(먼저 선택한 것)의 너비/높이에 맞춤. 커져서 화면을 넘으면 안쪽으로 밀어 넣는다.
    matchSize(dim) {
      const list = this.selected();
      const ref = list.find((w) => w.id === this.primaryId());
      if (list.length < 2 || !ref) return;
      const before = this.snapshotGeometry();
      const { w: W, h: H } = this.doc.size;
      for (const w of list) {
        if (dim.includes('w')) { w.w = ref.w; w.x = clamp(w.x, 0, Math.max(0, W - w.w)); }
        if (dim.includes('h')) { w.h = ref.h; w.y = clamp(w.y, 0, Math.max(0, H - w.h)); }
      }
      this.applyGeometry(before);
    }

    flash(text) {
      this.msg(text, 'ok');
      clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => this.msg(''), 1800);
    }

    // ---- 속성 창 ----------------------------------------------------------
    // 드래그 중엔 숫자만 갱신(속성 창 전체를 다시 그리지 않음)
    showGeometry() {
      const w = this.selected()[0];
      if (!w || this.sel.size !== 1) return;
      for (const k of ['x', 'y', 'w', 'h']) {
        const el = this.inspector.querySelector(`[data-f="${k}"]`);
        if (el && document.activeElement !== el) el.value = w[k];
      }
    }

    // 입력란 외 필드(props, enableWhen 등) — props를 맨 앞에, 없으면 빈 객체로 보여준다
    extraOf(w) {
      const o = { props: w.props || {} };
      for (const k of Object.keys(w)) if (!BASE_KEYS.includes(k) && k !== 'props') o[k] = w[k];
      return o;
    }

    // 위젯 객체 키 순서를 id,type,x,y,w,h,tag,… 로 고정(같은 내용이면 같은 JSON이 되도록)
    canonical(w) {
      const entries = Object.entries(w);
      for (const k of Object.keys(w)) delete w[k];
      for (const k of BASE_KEYS) { const e = entries.find(([key]) => key === k); if (e && e[1] != null && e[1] !== '') w[k] = e[1]; }
      for (const [k, v] of entries) if (!BASE_KEYS.includes(k) && v != null) w[k] = v;
    }

    formError(text) {
      const el = this.inspector.querySelector('.ed-form-err');
      if (el) el.textContent = text || '';
    }

    jsonError(text) {
      const el = this.inspector.querySelector('.ed-json-err');
      if (el) el.textContent = text || '';
    }

    onFieldChange(el) {
      const w = this.selected()[0];
      if (!w || this.sel.size !== 1) return;
      const f = el.dataset.f;
      this.formError('');
      if (f === 'id') { this.renameWidget(w, el.value.trim(), el); return; }
      if (f === 'tag') { this.setTag(w, el.value); return; }
      const v = Math.round(Number(el.value));
      if (el.value.trim() === '' || !Number.isFinite(v)) { el.value = w[f]; return; }
      const { w: W, h: H } = this.doc.size;
      const before = this.snapshotGeometry();
      // 드래그와 같은 규칙: 화면 안, 최소 크기
      if (f === 'x') w.x = clamp(v, 0, Math.max(0, W - w.w));
      if (f === 'y') w.y = clamp(v, 0, Math.max(0, H - w.h));
      if (f === 'w') w.w = clamp(v, MIN_SIZE, Math.max(MIN_SIZE, W - w.x));
      if (f === 'h') w.h = clamp(v, MIN_SIZE, Math.max(MIN_SIZE, H - w.y));
      el.value = w[f];
      this.applyGeometry(before);
    }

    renameWidget(w, id, el) {
      if (id === w.id) return;
      if (!ID_RE.test(id)) { this.formError('id는 영문·숫자·_·- 1~64자입니다.'); el.value = w.id; return; }
      if (this.doc.widgets.some((o) => o.id === id)) { this.formError(`"${id}"은(는) 이미 있는 id입니다.`); el.value = w.id; return; }
      const old = w.id;
      this.nodes.set(id, this.nodes.get(old));
      this.nodes.delete(old);
      this.sel = new Set([...this.sel].map((s) => (s === old ? id : s)));
      w.id = id;
      this.redrawOne(w);          // clip/gradient id가 위젯 id 기준이라 다시 그린다
      this.inspKey = `one:${id}`;
      this.drawSelection();
      this.commit();
    }

    async setTag(w, tag) {
      w.tag = tag || null;
      this.canonical(w);
      // 처음 쓰는 태그면 미리보기 값을 한 번 읽어 온다
      if (tag && !(tag in this.values)) {
        try {
          const res = await apiFetch(`/api/hmi/values?tags=${encodeURIComponent(tag)}`);
          if (res.ok) Object.assign(this.values, (await res.json()).values || {});
        } catch (_) {}
      }
      this.redrawOne(w);
      this.drawSelection();
      this.commit();
    }

    resetJson() {
      const w = this.selected()[0];
      const ta = this.inspector.querySelector('.ed-json');
      if (!w || !ta) return;
      ta.value = JSON.stringify(this.extraOf(w), null, 2);
      this.jsonDirty = false;
      this.jsonError('');
    }

    applyJson() {
      const w = this.selected()[0];
      const ta = this.inspector.querySelector('.ed-json');
      if (!w || !ta) return;
      let obj;
      try {
        obj = JSON.parse(ta.value);
      } catch (e) {
        // 오류 위치(문자 번호)를 줄 번호로 바꿔 보여준다
        const m = /position (\d+)/.exec(e.message);
        const line = m ? ta.value.slice(0, Number(m[1])).split('\n').length : null;
        this.jsonError(`JSON 오류${line ? ` (${line}번째 줄)` : ''}: ${e.message}`);
        return;
      }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { this.jsonError('{ … } 형태의 객체여야 합니다.'); return; }
      const fixed = BASE_KEYS.filter((k) => k in obj);
      if (fixed.length) { this.jsonError(`${fixed.join(', ')}은(는) 위 입력란에서 바꾸세요.`); return; }
      if ('props' in obj && (!obj.props || typeof obj.props !== 'object' || Array.isArray(obj.props))) { this.jsonError('props는 { … } 객체여야 합니다.'); return; }
      if (obj.enableWhen != null && (typeof obj.enableWhen !== 'object' || !obj.enableWhen.tag)) {
        this.jsonError('enableWhen은 { "tag": "태그id", "equals": 값 } 형태여야 합니다.');
        return;
      }

      const backup = clone(w);
      const replace = (src) => {
        for (const k of Object.keys(w)) delete w[k];
        Object.assign(w, src);
      };
      const next = {};
      for (const k of BASE_KEYS) if (k in w) next[k] = w[k];
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'props' && !Object.keys(v).length) continue;   // 빈 props는 저장하지 않음
        if (v != null) next[k] = v;
      }
      replace(next);
      this.canonical(w);
      try {
        this.redrawOne(w);
      } catch (e) {
        replace(backup);
        this.render();    // 실패한 묶음 자리까지 깨끗하게 다시 그린다
        this.jsonError(`위젯을 그리지 못했습니다: ${e.message}`);
        return;
      }
      this.jsonDirty = false;
      this.jsonError('');
      this.drawSelection();
      this.commit();
      this.flash('속성 적용됨');
    }

    // 같은 위젯이 계속 선택돼 있으면 입력란 값만 갱신 — 작성 중인 JSON이 날아가지 않게
    updateFields(w) {
      for (const f of ['id', 'x', 'y', 'w', 'h']) {
        const el = this.inspector.querySelector(`[data-f="${f}"]`);
        if (el && document.activeElement !== el) el.value = w[f];
      }
      const sel = this.inspector.querySelector('[data-f="tag"]');
      if (sel) {
        if (w.tag && ![...sel.options].some((o) => o.value === w.tag)) {
          sel.add(new Option(`${w.tag} (정의되지 않은 태그)`, w.tag));
        }
        sel.value = w.tag || '';
      }
      if (!this.jsonDirty) this.resetJson();
    }

    renderInspector() {
      if (!this.doc) return;
      const list = this.selected();
      const tools = (items, kind, disabled) => `<div class="ed-tools">${items.map(([k, title, svgIcon]) =>
        `<button class="ed-tool" type="button" data-${kind}="${k}" title="${title}"${disabled ? ' disabled' : ''}>${svgIcon}</button>`).join('')}</div>`;
      const alignBlock = (n) => `
          <div class="ed-insp-sub">정렬 <small>${n === 1 ? '화면 기준' : '선택 범위 기준'}</small></div>
          ${tools(ALIGN_TOOLS, 'align')}
          ${n > 1 ? `
          <div class="ed-insp-sub">간격 <small>3개 이상</small></div>
          ${tools(DIST_TOOLS, 'dist', n < 3)}
          <div class="ed-insp-sub">크기 맞추기 <small>기준: ${esc(this.primaryId())} (실선)</small></div>
          ${tools(SIZE_TOOLS, 'size')}` : ''}`;
      if (list.length === 1) {
        const w = list[0];
        const key = `one:${w.id}`;
        if (this.inspKey === key) { this.updateFields(w); return; }
        this.inspKey = key;
        this.jsonDirty = false;
        const tagOpts = Object.values(this.tags).sort((a, b) => a.id.localeCompare(b.id))
          .map((t) => `<option value="${esc(t.id)}">${esc(t.id)}${t.name ? ` — ${esc(t.name)}` : ''}</option>`).join('');
        const num = (f) => `<label class="ed-field"><span>${f}</span><input type="number" step="1" data-f="${f}"></label>`;
        this.inspector.innerHTML = `
          ${alignBlock(1)}
          <div class="ed-insp-section">${esc(TYPE_LABEL[w.type] || w.type)} <small class="ed-type">${esc(w.type)}</small></div>
          <div class="ed-form">
            <label class="ed-field wide"><span>id</span><input type="text" data-f="id" spellcheck="false" autocomplete="off"></label>
            ${num('x')}${num('y')}${num('w')}${num('h')}
            <label class="ed-field wide"><span>tag</span><select data-f="tag"><option value="">(없음)</option>${tagOpts}</select></label>
          </div>
          <div class="ed-form-err"></div>
          <div class="ed-insp-sub">추가 속성 <small>JSON · Ctrl+Enter 적용</small></div>
          <textarea class="ed-json" spellcheck="false" rows="14"></textarea>
          <div class="ed-json-err"></div>
          <div class="ed-json-btns">
            <button class="ed-btn" type="button" data-json="reset">되돌리기</button>
            <button class="ed-btn primary" type="button" data-json="apply">적용</button>
          </div>`;
        this.updateFields(w);
        return;
      }
      this.inspKey = null;
      if (list.length > 1) {
        this.inspector.innerHTML = `
          <div class="ed-insp-section">${list.length}개 선택</div>
          ${alignBlock(list.length)}
          <p class="ed-hint">${list.map((w) => esc(w.id)).join(', ')}</p>`;
        return;
      }
      const d = this.doc;
      const { w: W, h: H } = d.size;
      const outside = d.widgets.filter((w) => w.x + w.w > W || w.y + w.h > H || w.x < 0 || w.y < 0).length;
      const mon = `${window.screen.width}x${window.screen.height}`;
      const cur = `${W}x${H}`;
      const sizes = [...new Set([mon, ...SIZE_PRESETS.map(([a, b]) => `${a}x${b}`)])];
      const isStart = this.project.startScreen === this.screenId;
      this.inspector.innerHTML = `
        <div class="ed-insp-section">화면 설정</div>
        <div class="ed-form">
          <div class="ed-field wide"><span>id</span><b>${esc(this.screenId)}</b></div>
          <label class="ed-field wide"><span>제목</span><input type="text" data-s="title" maxlength="${TITLE_MAX}" value="${esc(d.title || '')}"></label>
          <label class="ed-field wide"><span>화면 크기 (기준 해상도)</span><select data-s="preset">
            ${sizes.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v.replace('x', ' × ')}${v === mon ? ' (현재 모니터)' : ''}</option>`).join('')}
            <option value="custom"${sizes.includes(cur) ? '' : ' selected'}>직접 입력</option>
          </select></label>
          <label class="ed-field"><span>너비</span><input type="number" data-s="w" value="${W}"></label>
          <label class="ed-field"><span>높이</span><input type="number" data-s="h" value="${H}"></label>
          <label class="ed-field wide"><span>배경색</span><span class="ed-color">
            <input type="color" data-s="bg" value="${esc(d.background || DEFAULT_BG)}">
            <input type="text" data-s="bgText" value="${esc(d.background || DEFAULT_BG)}" spellcheck="false"></span></label>
          <label class="ed-check wide"><input type="checkbox" data-s="start"${isStart ? ' checked disabled' : ''}> 시작 화면${isStart ? ' (현재 시작 화면)' : '으로 지정'}</label>
        </div>
        <div class="ed-form-err"></div>
        ${outside ? `<p class="ed-warn">⚠ 화면 밖으로 나간 위젯 ${outside}개 — 화면을 키우거나 위젯을 안쪽으로 옮기세요.</p>` : ''}
        <p class="ed-hint">크기를 바꿔도 위젯 위치·크기는 그대로입니다. 제목·크기·배경은 [저장]해야 반영되고, 시작 화면은 바로 반영됩니다.</p>
        <dl class="ed-kv">
          <dt>위젯</dt><dd>${d.widgets.length}개</dd>
          <dt>revision</dt><dd>${this.revision}</dd>
        </dl>
        <p class="ed-hint">
          클릭: 선택 · Shift/Ctrl+클릭: 추가 선택<br>
          빈 곳 드래그 / Alt+드래그: 영역 선택<br>
          방향키: 1px 이동 · Shift+방향키: 격자 간격<br>
          Ctrl+A: 전체 선택 · Esc: 선택 해제<br>
          위젯 목록: 클릭하면 가운데 추가, 끌어다 놓기<br>
          Del: 삭제 · Ctrl+D: 복제 · Ctrl+C/X/V: 복사/잘라내기/붙여넣기<br>
          Ctrl+Z / Ctrl+Y: 실행 취소 / 다시 실행<br>
          Ctrl+] / Ctrl+[: 앞으로 / 뒤로 (Shift: 맨 앞 / 맨 뒤)
        </p>`;
    }

    destroy() {
      // 저장 안 한 채 사라지면(탭 닫기 등) 임시 저장본을 남겨 둔다
      if (this.dirty) this.flushDraft();
      clearTimeout(this.draftTimer);
      clearTimeout(this.flashTimer);
      document.removeEventListener('keydown', this.onKey);
      this.resizeObs.disconnect();
      this.root.innerHTML = '';
    }
  }

  window.WHMI.Editor = {
    open: (root, opts) => new Editor(root, opts),
  };
})();
