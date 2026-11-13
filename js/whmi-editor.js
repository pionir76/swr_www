// WHMI 편집기(디자인 모드) — HMI 페이지에서 [디자인]을 누를 때만 로드된다.
// 실행 모드와 같은 위젯 코드(WHMI.drawWidget)로 미리보기를 그리고, 폴링/쓰기는 하지 않는다.
(function () {
  'use strict';

  if (!window.WHMI) return;   // HMI 페이지를 떠나며 정리된 뒤 늦게 도착한 스크립트(이전 페이지 것)
  const { svg, esc } = window.WHMI;

  // 위젯 목록에 보일 이름 — 등록됐지만 여기 없는 타입은 타입 이름 그대로 보인다
  const TYPE_LABEL = {
    label: '텍스트', rect: '사각형', numeric: '숫자 표시', input: '숫자 입력',
    lamp: '램프', bar: '바 게이지', gauge: '원형 게이지', tank: '탱크',
    button: '버튼', switch: '스위치', selector: '셀렉터', screenlink: '화면 이동', image: '이미지', status: '상태 표시',
  };
  // 위젯 목록 묶음(순서 그대로 표시). 여기 없는 타입은 "기타"로
  const PALETTE_GROUPS = [
    ['꾸미기', ['label', 'rect', 'image']],
    ['표시', ['numeric', 'lamp', 'status', 'bar', 'gauge', 'tank']],
    ['조작', ['input', 'button', 'switch', 'selector']],
    ['이동', ['screenlink']],
  ];
  // 위젯 목록 아이콘(24×24 선 아이콘, currentColor) — 글꼴에 의존하지 않게 SVG로
  const WIDGET_ICONS = {
    label: '<path d="M6 6h12M12 6v12M9.5 18h5"/>',
    rect: '<rect x="4" y="5" width="16" height="14" rx="3"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-5 4 4 2.5-2.5L20 17"/>',
    numeric: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7.8 10l1.6-1.2v6.4M12.6 10c.4-1.3 3.6-1.4 3.6.6 0 1.6-3.6 2.8-3.6 4.6h3.8"/>',
    input: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6.5 12h5M15.5 9v6M14 9h3M14 15h3"/>',
    lamp: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18"/>',
    status: '<rect x="3" y="6.5" width="18" height="11" rx="3"/><circle cx="7.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M11 12h6.5"/>',
    bar: '<rect x="3" y="9" width="18" height="6" rx="2"/><rect x="4.6" y="10.6" width="8.5" height="2.8" rx="1" fill="currentColor" stroke="none"/>',
    gauge: '<path d="M5.2 18.5a8.5 8.5 0 1 1 13.6 0"/><path d="M12 14.5l3.8-4.3"/><circle cx="12" cy="14.5" r="1.5" fill="currentColor" stroke="none"/>',
    tank: '<rect x="7" y="3.5" width="10" height="17" rx="3"/><path d="M7.9 13.2h8.2v3.8a2.4 2.4 0 0 1-2.4 2.4h-3.4a2.4 2.4 0 0 1-2.4-2.4z" fill="currentColor" stroke="none" opacity=".6"/>',
    button: '<rect x="3.5" y="7" width="17" height="10" rx="3"/><path d="M9 12h6"/>',
    switch: '<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="16.5" cy="12" r="2.4" fill="currentColor" stroke="none"/>',
    selector: '<circle cx="12" cy="14" r="6"/><path d="M12 14l-3.3-3.3"/><circle cx="4.6" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="19.4" cy="9" r="1" fill="currentColor" stroke="none"/>',
    screenlink: '<rect x="3.5" y="5" width="10.5" height="14" rx="2"/><path d="M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5"/>',
  };
  const widgetIcon = (t) => `<svg class="ed-wicon" viewBox="0 0 24 24" aria-hidden="true">${WIDGET_ICONS[t] || '<rect x="5" y="5" width="14" height="14" rx="2" stroke-dasharray="3 2"/>'}</svg>`;

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
    image:      { w: 160, h: 90 },
    status:     { w: 160, h: 36 },
  };
  const NEW_WIDGET_FALLBACK = { w: 120, h: 60 };
  const HISTORY_MAX = 50;
  // 위젯 기본 필드(속성 창 위쪽 입력란) — 나머지(props, enableWhen)는 속성 폼으로 편집
  const BASE_KEYS = ['id', 'type', 'x', 'y', 'w', 'h', 'tag'];
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;   // HMI 태그·화면 id와 같은 규칙
  const MAX_SCREEN_BYTES = 256 * 1024;      // 서버 화면 content 상한(413)
  const ANIM_DEFAULT_MS = 400;
  const MIXED = '__mixed__';                // 여러 개 선택에서 값이 서로 다른 선택 상자의 표시 항목
  const MULTI_SKIP = ['list', 'cond', 'image', 'bits'];   // 여러 개 동시 편집에서 빼는 필드(하나씩 편집)
  const IMAGE_MAX_BYTES = 150 * 1024;       // 이미지 위젯: 화면 데이터에 넣는 그림 상한(data URL 길이) — 넘으면 자동으로 더 줄임
  const IMAGE_MAX_SIDE = 1024;              // 이미지 위젯: 긴 변 최대 픽셀
  const TAG_LABEL_PX = 10;                  // 태그 보기 글자 크기(실제 픽셀, 10pt 이하)
  // 동작 조건 비교 방식(판정 엔진 whmi-rules.js의 test) — [값, 선택 상자 글자, 요약 문구 만들기]
  const COND_TESTS = [
    ['eq', '같음', (c) => `= ${c.value}`],
    ['ne', '다름', (c) => `≠ ${c.value}`],
    ['gt', '보다 큼', (c) => `> ${c.value}`],
    ['lt', '보다 작음', (c) => `< ${c.value}`],
    ['range', '범위 안', (c) => `${c.min ?? '…'} ~ ${c.max ?? '…'}`],
    ['bitAny', '비트 중 하나라도 1', (c) => `비트 ${[].concat(c.bits || []).join(', ') || '(없음)'} 중 하나라도 1`],
    ['bitNone', '비트 모두 0', (c) => `비트 ${[].concat(c.bits || []).join(', ') || '(없음)'} 모두 0`],
  ];
  const NO_DEV = 'none';
  const NO_TAG_TYPES = ['rect', 'label', 'screenlink', 'image'];     // 고정 위젯 — 값을 받지 않으므로 tag 칸 없음(동작 조건은 사용 가능)
  const WRITE_TYPES = ['input', 'button', 'switch', 'selector'];   // 쓰기 위젯 — 쓰기 태그(writeTag) 칸                    // 태그 고르기: 소스 장비를 모르는 태그 묶음
  const KEEP = '__keep__';                  // 태그 고르기: 다른 장비 태그가 연결된 상태(선택 전)              // 기본 애니메이션이 없는 위젯에서 "사용"을 켤 때 시간
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

  // 화면 설정(아무것도 선택 안 함)에 보이는 조작 안내: [동작, [키…]]
  const KEY_HELP = [
    ['추가 선택', ['Shift/Ctrl+클릭']],
    ['영역 선택', ['빈 곳 드래그', 'Alt+드래그']],
    ['이동', ['방향키', 'Shift+방향키']],
    ['전체 선택 / 해제', ['Ctrl+A', 'Esc']],
    ['복제 / 삭제', ['Ctrl+D', 'Del']],
    ['복사 / 잘라내기 / 붙여넣기', ['Ctrl+C', 'X', 'V']],
    ['실행 취소 / 다시 실행', ['Ctrl+Z', 'Ctrl+Y']],
    ['앞으로 / 뒤로', ['Ctrl+]', 'Ctrl+[']],
    ['맨 앞 / 맨 뒤', ['Ctrl+Shift+]', 'Ctrl+Shift+[']],
    ['저장', ['Ctrl+S']],
  ];

  // 도구줄 아이콘 — ⛶ ↶ ↷ 같은 기호도 글꼴이 없으면 □로 보이므로 SVG로
  const stroke = (d) => `<path d="${d}" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const TB_ICONS = {
    undo: icon(stroke('M5 3.5L2 6.5l3 3M2 6.5h8a3.5 3.5 0 0 1 0 7H7')),
    redo: icon(stroke('M11 3.5l3 3-3 3M14 6.5H6a3.5 3.5 0 0 0 0 7h3')),
    fullscreen: icon(stroke('M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4')),
  };
  const CARET = '<svg class="ed-caret" viewBox="0 0 8 8" width="8" height="8" aria-hidden="true"><path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';

  // 도구줄 드롭다운 — 버튼으로 펼치고, 항목을 고르거나 바깥을 누르거나 Esc면 닫힌다.
  // 항목은 data-act라 도구줄 버튼과 같은 action()으로 처리된다.
  const menu = (label, title, body, needSel) => `
    <div class="ed-menu">
      <button class="ed-btn" type="button" data-menu title="${title}"${needSel ? ' data-need-sel' : ''} aria-haspopup="true" aria-expanded="false">${label} ${CARET}</button>
      <div class="ed-menu-pop" hidden>${body}</div>
    </div>`;
  const menuItem = (act, label, hint) =>
    `<button class="ed-menu-item" type="button" data-act="${act}"><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</button>`;

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
    const lim = window.WHMI.raw.limits(t);   // 런타임 info()와 같은 규칙
    const min = pick(p.min, lim.min, 0);
    const max = pick(p.max, lim.max, 100);
    const decimals = pick(raw && raw.decimals, lim.decimals, 0);
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
  const fid = (f) => f.id || f.key;
  const hasCond = (w) => !!(w.visibleWhen || w.enableWhen || w.activeWhen);   // 동작 조건 그룹을 처음부터 펼칠지   // 속성 칸 이름 — 같은 속성(key)을 조건(when)에 따라 다른 칸으로 보여 줄 때 id로 구분
  const bitList = (v) => (v == null ? [] : [].concat(v).map(Number).filter((n) => Number.isInteger(n) && n >= 0));
  // 색 + 투명도: 투명도 100%면 #rrggbb(기존 데이터 그대로), 미만이면 #rrggbbaa
  const splitColor = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)
    ? { rgb: v.slice(0, 7).toLowerCase(), a: v.length === 9 ? Math.round(parseInt(v.slice(7), 16) / 2.55) : 100 } : null);
  const joinColor = (rgb, a) => (a >= 100 ? rgb : rgb + Math.round(Math.max(0, a) * 2.55).toString(16).padStart(2, '0'));
  const VIEW_KEY = 'whmi.editorView';   // 보기 메뉴 설정(브라우저별)
  const loadView = () => {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') || {}; } catch (_) { return {}; }
  };

  // 그림 파일 → 화면 데이터에 넣을 data URL. 사용자가 크기를 신경 쓰지 않도록 긴 변 IMAGE_MAX_SIDE 이하로 줄이고,
  // IMAGE_MAX_BYTES를 넘으면 품질 → 크기 순으로 더 줄인다(WebP, 못 쓰는 브라우저는 PNG). 작은 SVG는 그대로.
  // 반환 { src, ratio(원래 너비/높이) }
  async function shrinkImage(file) {
    if (!/^image\//.test(file.type)) throw new Error('그림 파일이 아닙니다.');
    const url = await new Promise((ok, fail) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result);
      fr.onerror = () => fail(new Error('파일을 읽지 못했습니다.'));
      fr.readAsDataURL(file);
    });
    const img = await new Promise((ok, fail) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => fail(new Error('그림을 열지 못했습니다.'));
      im.src = url;
    });
    const nw = img.naturalWidth || 300, nh = img.naturalHeight || 150;
    const ratio = nw / nh;
    if (file.type === 'image/svg+xml' && url.length <= IMAGE_MAX_BYTES) return { src: url, ratio };
    const cv = document.createElement('canvas');
    let scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(nw, nh));
    for (let i = 0; i < 12; i++) {
      cv.width = Math.max(1, Math.round(nw * scale));
      cv.height = Math.max(1, Math.round(nh * scale));
      const c = cv.getContext('2d');
      c.clearRect(0, 0, cv.width, cv.height);
      c.drawImage(img, 0, 0, cv.width, cv.height);
      for (const q of [0.9, 0.8, 0.65]) {
        const out = cv.toDataURL('image/webp', q);
        const src = out.startsWith('data:image/webp') ? out : cv.toDataURL('image/png');
        if (src.length <= IMAGE_MAX_BYTES) return { src, ratio };
        if (src !== out) break;   // PNG는 품질 조절이 없으니 크기를 줄인다
      }
      scale *= 0.75;
    }
    throw new Error('그림을 충분히 줄이지 못했습니다.');
  }
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
      this.groupOpen = {};   // 속성 창 그룹 접힘 상태(기본: 펼침)
      // 보기 메뉴 설정(격자 보기·맞춤·간격, 태그 보기) — 실행 모드에 다녀와도 유지되게 브라우저에 기억
      const view = loadView();
      this.grid = Object.assign({ show: true, snap: true, size: 10 }, view.grid);   // 보기와 맞춤은 따로 켜고 끈다
      this.showTags = !!view.showTags;
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
      const types = window.WHMI.types();
      const grouped = new Set(PALETTE_GROUPS.flatMap(([, ts]) => ts));
      const groups = PALETTE_GROUPS.map(([g, ts]) => [g, ts.filter((t) => types.includes(t))])
        .concat([['기타', types.filter((t) => !grouped.has(t))]]).filter(([, ts]) => ts.length);
      this.root.innerHTML = `
        <div class="ed-toolbar">
          <span class="ed-title">✎ 디자인</span>
          <select class="ed-screen-sel" title="편집할 화면">
            ${screens.map((s) => `<option value="${esc(s.id)}">${esc(s.title || s.id)} (${esc(s.id)})</option>`).join('')}
          </select>
          ${menu('화면', '화면 만들기·관리', `
            ${menuItem('newScreen', '+ 새 화면')}
            ${menuItem('manage', '화면 관리', '순서·시작 화면·삭제')}`)}
          <button class="ed-btn" type="button" data-act="tags" title="HMI 태그 목록·만들기·수정">태그 관리</button>
          <span class="ed-sep"></span>
          ${menu('보기', '격자·태그 표시', `
            <label class="ed-check" title="격자선 표시"><input type="checkbox" data-opt="gridShow"${this.grid.show ? ' checked' : ''}> 격자 보기</label>
            <label class="ed-check" title="이동·크기 조절 시 격자에 맞춤"><input type="checkbox" data-opt="gridSnap"${this.grid.snap ? ' checked' : ''}> 격자 맞춤</label>
            <label class="ed-check">간격
              <select class="ed-grid-size" title="격자 간격">
                ${[5, 10, 20, 40].map((n) => `<option value="${n}"${n === this.grid.size ? ' selected' : ''}>${n}px</option>`).join('')}
              </select>
            </label>
            <div class="ed-menu-sep"></div>
            <label class="ed-check" title="위젯마다 장비명 - 레지스터 - 통합주소 표시"><input type="checkbox" data-opt="tagShow"${this.showTags ? ' checked' : ''}> 태그 보기</label>`)}
          <span class="ed-sep"></span>
          <button class="ed-btn ed-icon-btn" type="button" data-act="undo" title="실행 취소 (Ctrl+Z)">${TB_ICONS.undo}</button>
          <button class="ed-btn ed-icon-btn" type="button" data-act="redo" title="다시 실행 (Ctrl+Y)">${TB_ICONS.redo}</button>
          <span class="ed-sep"></span>
          <button class="ed-btn" type="button" data-act="dup" data-need-sel title="복제 (Ctrl+D)">복제</button>
          <button class="ed-btn" type="button" data-act="del" data-need-sel title="삭제 (Del)">삭제</button>
          ${menu('순서', '그리는 순서', `
            ${menuItem('front', '맨 앞으로', 'Ctrl+Shift+]')}
            ${menuItem('forward', '앞으로', 'Ctrl+]')}
            ${menuItem('backward', '뒤로', 'Ctrl+[')}
            ${menuItem('back', '맨 뒤로', 'Ctrl+Shift+[')}`, true)}
          <span class="ed-spacer"></span>
          <span class="ed-pos" title="커서 위치(화면 좌표)"></span>
          <span class="ed-dirty" hidden>● 변경됨</span>
          <span class="ed-msg"></span>
          <button class="ed-btn save" type="button" data-act="save" title="저장 (Ctrl+S)" disabled>저장</button>
          <button class="ed-btn ed-icon-btn" type="button" data-act="fs" title="전체 화면">${TB_ICONS.fullscreen}</button>
          <button class="ed-btn primary" type="button" data-act="exit">▶ 실행 모드</button>
        </div>
        <div class="ed-body">
          <aside class="ed-palette">
            <div class="ed-pane-title">위젯</div>
            <ul class="ed-palette-list">
              ${groups.map(([g, ts]) => `<li class="ed-palette-group">${esc(g)}</li>` + ts.map((t) =>
                `<li class="ed-palette-item" data-type="${esc(t)}" title="${esc(t)}">${widgetIcon(t)}<span>${esc(TYPE_LABEL[t] || t)}</span></li>`).join('')).join('')}
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
        this.saveView();
      });
      this.root.querySelector('[data-opt="gridSnap"]').addEventListener('change', (e) => {
        this.grid.snap = e.target.checked;
        this.saveView();
      });
      this.root.querySelector('[data-opt="tagShow"]').addEventListener('change', (e) => {
        this.showTags = e.target.checked;
        this.drawSelection();
        this.saveView();
      });
      this.root.querySelector('.ed-grid-size').addEventListener('change', (e) => {
        this.grid.size = Number(e.target.value);
        this.updateGrid();
        this.saveView();
      });
      this.root.querySelector('.ed-toolbar').addEventListener('click', (e) => {
        const mb = e.target.closest('[data-menu]');
        if (mb) { this.toggleMenu(mb); return; }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act) this.closeMenus();
        if (act === 'exit') this.requestExit();
        else if (act === 'fs') this.onFullscreen && this.onFullscreen();
        else if (act) this.action(act);
      });
      this.root.querySelector('.ed-palette-list').addEventListener('pointerdown', (e) => this.paletteDown(e));
      this.refreshScreenSel();
      this.inspector.addEventListener('change', (e) => {
        if (e.target.dataset.tagdev) { this.onTagDevChange(e.target); return; }
        const condEl = e.target.closest('.ed-cond');
        if (condEl) { this.onCondChange(condEl); return; }
        if (e.target.dataset.imgfile !== undefined) { this.onImageFile(e.target); return; }
        if (e.target.dataset.f) this.onFieldChange(e.target);
        else if (e.target.dataset.s) this.onScreenField(e.target);
        else if (e.target.dataset.p) this.onPropChange(e.target);
        else if (e.target.dataset.lc) this.onListChange(e.target.closest('[data-list]'));
      });
      this.inspector.addEventListener('input', (e) => {
        // 색 선택기·글자 칸은 바꾸는 동안 바로 반영(연속 변경은 실행 취소 한 단계로 묶임)
        if (e.target.dataset.p && (e.target.type === 'color' || this.isLiveText(e.target))) this.onPropChange(e.target, true);
        else if (e.target.dataset.lc && e.target.type === 'color') this.onListChange(e.target.closest('[data-list]'), true);
      });
      // 기본값 상태의 숫자 칸은 비어 있고 기본값은 흐린 안내 글자로만 보인다 — 그대로 두면 화살표(▲▼·방향키)가
      // 최소값부터 시작하므로, 화살표를 누르는 순간에만 기본값을 채워 그 값부터 움직이게 한다(직접 입력은 그대로).
      // 안 바꾸고 나가면 다시 비운다.
      const fillDefault = (el) => {
        if (el.type !== 'number' || !el.dataset.p || el.value !== '' || el.placeholder === '' || !Number.isFinite(Number(el.placeholder))) return;
        el.value = el.placeholder;
        el.dataset.filled = el.placeholder;
      };
      this.inspector.addEventListener('keydown', (e) => {
        if (/^(ArrowUp|ArrowDown|PageUp|PageDown)$/.test(e.key)) fillDefault(e.target);
      });
      this.inspector.addEventListener('mousedown', (e) => {
        const el = e.target;
        if (el.type === 'number' && e.offsetX > el.clientWidth - 20) fillDefault(el);   // 오른쪽 ▲▼ 버튼
      });
      this.inspector.addEventListener('focusout', (e) => {
        const el = e.target;
        if (el.dataset.filled === undefined) return;
        if (el.value === el.dataset.filled) el.value = '';
        delete el.dataset.filled;
      });
      // 속성 그룹 접힘 상태는 위젯을 바꿔도 유지 — 사용자가 제목을 눌러 바꾼 것만 기억한다
      // (그릴 때 open 속성으로 생기는 toggle 이벤트까지 기억하면, 조건 있는 위젯에서 자동으로 펼친
      // "동작 조건" 그룹이 다른 위젯에서도 계속 펼쳐진다)
      this.inspector.addEventListener('click', (e) => {
        const sm = e.target.closest('details[data-g] > summary');
        if (!sm) return;
        const d = sm.parentElement;
        setTimeout(() => { this.groupOpen[d.dataset.g] = d.open; });
      });
      this.inspector.addEventListener('click', (e) => {
        const rs = e.target.closest('[data-reset]');
        if (rs) { this.resetProp(rs.dataset.reset); return; }
        const cb = e.target.closest('[data-cbit]');
        if (cb) { this.toggleCondBit(cb.closest('.ed-cond'), Number(cb.dataset.cbit)); return; }
        const bb = e.target.closest('[data-bit]');
        if (bb) {
          const w = this.selected()[0];
          const key = bb.parentElement.dataset.bits;
          if (!w || !key) return;
          const props = w.props || {};
          const cur = bitList(Object.prototype.hasOwnProperty.call(props, key) ? props[key] : this.propDefaults(w)[key]);
          const n = Number(bb.dataset.bit);
          const next = (cur.includes(n) ? cur.filter((x) => x !== n) : cur.concat(n)).sort((a, b) => a - b);
          this.setProp(w, key, next.length === 0 ? null : next.length === 1 ? next[0] : next);   // 하나면 숫자(기존 형식)
          return;
        }
        const ib = e.target.closest('[data-img]');
        if (ib) {
          if (ib.dataset.img === 'pick') ib.parentElement.querySelector('[data-imgfile]').click();
          else { const w = this.selected()[0]; if (w) this.setImage(w, null); }
          return;
        }
        const la = e.target.closest('[data-list-add]');
        if (la) { this.addListRow(la.dataset.listAdd); return; }
        const ld = e.target.closest('[data-list-del]');
        if (ld) { this.delListRow(ld.closest('[data-list]').dataset.list, Number(ld.dataset.listDel)); return; }
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
      if (act === 'tags') { window.WHMI.TagManager.open(this); return; }
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

    saveView() {
      try { localStorage.setItem(VIEW_KEY, JSON.stringify({ grid: this.grid, showTags: this.showTags })); } catch (_) {}
    }

    toggleMenu(btn) {
      const pop = btn.nextElementSibling;
      const open = pop.hidden;
      this.closeMenus();
      if (!open) return;
      pop.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      // 바깥을 누르면 닫는다(열린 메뉴 안에서의 조작은 유지)
      this.onMenuOutside = (e) => { if (!btn.parentElement.contains(e.target)) this.closeMenus(); };
      document.addEventListener('pointerdown', this.onMenuOutside, true);
    }

    closeMenus() {
      if (!this.root) return false;
      let closed = false;
      this.root.querySelectorAll('.ed-menu-pop:not([hidden])').forEach((pop) => {
        pop.hidden = true;
        pop.previousElementSibling.setAttribute('aria-expanded', 'false');
        closed = true;
      });
      if (this.onMenuOutside) document.removeEventListener('pointerdown', this.onMenuOutside, true);
      this.onMenuOutside = null;
      return closed;
    }

    updateToolbar() {
      const q = (sel) => this.root.querySelector(sel);
      q('[data-act="save"]').disabled = !this.dirty || !!this.saving;
      q('[data-act="undo"]').disabled = !this.past.length;
      q('[data-act="redo"]').disabled = !this.future.length;
      this.root.querySelectorAll('[data-need-sel]').forEach((b) => { b.disabled = !this.sel.size; });
      // 선택이 풀려 메뉴 버튼이 꺼지면 열려 있던 그 메뉴도 닫는다
      if (!this.sel.size && this.root.querySelector('[data-menu][data-need-sel] + .ed-menu-pop:not([hidden])')) this.closeMenus();
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
      // 시작 화면(★) 크기 — 화면끼리 크기가 같아야 넘길 때 글자·위젯 크기가 같아 보인다(기본 선택)
      const startId = this.project.startScreen;
      let startSize = null;
      if (startId && startId === this.screenId && this.doc) startSize = [this.doc.size.w, this.doc.size.h];
      else if (startId) {
        try {
          const res = await apiFetch(`/api/hmi/screens/${encodeURIComponent(startId)}`);
          const sz = res.ok && (await res.json()).content.size;
          if (sz) startSize = [sz.w, sz.h];
        } catch (_) {}
      }
      const startTitle = startId && ((screens.find((x) => x.id === startId) || {}).title || startId);
      const d = window.WHMI.dialog.open(`<div class="ed-dlg">
        <p>새 화면</p>
        <label class="ed-dlg-field"><span>id <small>영문·숫자·_·- (주소·화면 이동에 쓰임)</small></span><input type="text" data-n="id" value="screen_${n}" spellcheck="false" autocomplete="off"></label>
        <label class="ed-dlg-field"><span>제목</span><input type="text" data-n="title" value="새 화면" maxlength="${TITLE_MAX}"></label>
        <label class="ed-dlg-field"><span>화면 크기 <small>기준 해상도 — 현장 패널 해상도에 맞추세요</small></span>
          <select data-n="preset">
            ${startSize ? `<option value="start">시작 화면과 같음 — ${esc(startTitle)} (${startSize[0]} × ${startSize[1]})</option>` : ''}
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
        if (startSize && v === `${startSize[0]}x${startSize[1]}`) { q('preset').value = 'start'; return; }
        q('preset').value = [...q('preset').options].some((o) => o.value === v) ? v : 'custom';
      };
      if (startSize) setSize(startSize[0], startSize[1]); else setSize(mon[0], mon[1]);
      syncPreset();
      q('preset').addEventListener('change', () => {
        const v = q('preset').value;
        if (v === 'start') setSize(startSize[0], startSize[1]);
        else if (v !== 'custom') setSize(...v.split('x'));
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
        <div class="dlg-hint">★ 시작 화면(지울 수 없음 — 다른 화면에 ★를 옮긴 뒤 지우기) · 순서·시작 화면·삭제는 바로 적용됩니다.</div>
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
            ${x.id === this.project.startScreen
              ? '<button type="button" data-a="del" class="ed-scr-del" disabled title="시작 화면(★)은 지울 수 없습니다. 다른 화면에 ★를 지정한 뒤 지우세요.">삭제</button>'
              : '<button type="button" data-a="del" class="ed-scr-del">삭제</button>'}
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
      // 시작 화면은 지우지 않는다(마지막 하나 남은 화면이라도 — 실수로 모든 화면을 지우는 것 방지)
      if (id === this.project.startScreen) return '시작 화면(★)은 지울 수 없습니다. 다른 화면에 ★를 먼저 지정하세요.';
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
      const ids = [...new Set(this.doc.widgets.flatMap((w) => [w.tag, ...window.WHMI.rules.tagsOf(w.visibleWhen, w.enableWhen, w.activeWhen)]).filter((t) => t && this.tags[t]))];
      if (!ids.length) return;
      try {
        const res = await apiFetch(`/api/hmi/values?tags=${ids.map(encodeURIComponent).join(',')}`);
        if (res.ok) this.values = window.WHMI.raw.decode((await res.json()).values || {}, this.tags);
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
      this.tagLayer = svg('g', { 'pointer-events': 'none' }, this.overlay);   // 태그 보기(편집 보조 표시)
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
      // 동작 조건 미리보기(화면을 열 때 읽은 값으로 한 번 판정): 보이기가 거짓이면 흐리게(선택·편집은 가능),
      // 켜짐 상태 조건은 위젯에 넘김. 판정 불가면 런타임과 같은 규칙(보임 / 꺼짐)
      const R = window.WHMI.rules;
      const at = (cond) => { const n = R.normalize(cond); return n ? R.test(n, this.values[n.tag]) : undefined; };
      wrap.classList.toggle('ed-cond-hidden', at(w.visibleWhen) === false);
      if (inst.update) {
        const info = previewInfo(w, p, this.tags, this.values[w.tag]);
        const act = at(w.activeWhen);
        if (act !== undefined) info.active = act === true;
        try { inst.update(info); } catch (e) { console.warn('[whmi-editor] 미리보기 실패', w.id, e); }
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
      this.drawTags(u);
      const list = this.selected();
      // 여러 개 선택이면 기준 위젯(먼저 선택한 것 — 크기 맞추기 기준)은 실선으로
      const primary = list.length > 1 ? this.primaryId() : null;
      for (const w of list) {
        svg('rect', { x: w.x, y: w.y, width: w.w, height: w.h, 'data-id': w.id, class: `ed-sel${w.id === primary ? ' primary' : ''}` }, this.selLayer);
      }
      // 크기 조절 손잡이는 고른 위젯마다(파워포인트처럼 — 아무 손잡이나 끌면 고른 위젯이 같은 비율로 함께)
      const hs = HANDLE_PX * u;
      for (const w of list) {
        for (const [name, fx, fy, cursor] of HANDLES) {
          svg('rect', {
            x: w.x + w.w * fx - hs / 2, y: w.y + w.h * fy - hs / 2, width: hs, height: hs,
            class: 'ed-handle', 'data-h': name, 'data-hid': w.id, style: `cursor:${cursor}`,
          }, this.selLayer);
        }
      }
      if (this.drag && this.drag.kind === 'marquee' && this.drag.rect) {
        const r = this.drag.rect;
        svg('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'ed-marquee' }, this.selLayer);
      }
    }

    // 태그 보기 — 태그가 있는 위젯마다 왼쪽 위 안쪽에 "장비명 - 레지스터 - D통합주소"(태그 응답의 source).
    // 위젯과 별개의 표시 층이라 화면 데이터·바운딩 박스와 무관하고, 글자 크기는 확대/축소와 상관없이 일정.
    drawTags(u) {
      const layer = this.tagLayer;
      if (!layer) return;
      layer.innerHTML = '';
      if (!this.showTags) return;
      const fs = TAG_LABEL_PX * u, padX = 4 * u, padY = 2 * u;
      // 이웃 라벨과 겹치지 않게 위젯 폭에 맞춰 줄인다(…). 선택한 위젯은 전체 글자를 맨 위에
      const order = this.doc.widgets.filter((w) => !this.sel.has(w.id)).concat(this.selected());
      for (const w of order) {
        if (!w.tag) continue;
        const t = this.tags[w.tag];
        const src = (t && t.source) || {};
        const text = !t ? `${w.tag} (정의 없음)`
          : `${src.deviceDisplayName ?? '?'} - ${src.registerTagName ?? '?'} - ${src.unifiedAddress != null ? `D${src.unifiedAddress}` : '?'}`;
        const bg = svg('rect', { class: 'ed-taglbl-bg', rx: 2 * u }, layer);
        const tx = svg('text', { x: w.x + 2 * u + padX, y: w.y + 2 * u + padY, 'font-size': fs, 'dominant-baseline': 'hanging', class: `ed-taglbl${t ? '' : ' bad'}` }, layer);
        tx.textContent = text;
        const room = w.w - 4 * u - padX * 2;
        if (!this.sel.has(w.id) && tx.getComputedTextLength() > room) {
          let lo = 0, hi = text.length;
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            tx.textContent = `${text.slice(0, mid)}…`;
            if (tx.getComputedTextLength() <= room) lo = mid; else hi = mid - 1;
          }
          tx.textContent = lo ? `${text.slice(0, lo)}…` : '…';
        }
        const bb = tx.getBBox();
        for (const [k, v] of Object.entries({ x: bb.x - padX, y: bb.y - padY, width: bb.width + padX * 2, height: bb.height + padY * 2 })) bg.setAttribute(k, v);
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
      const handleOf = handle && e.target.dataset.hid;   // 잡은 손잡이의 위젯(여러 개 크기 조절의 기준)
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
          // 화면(스크린) 안 빈 곳을 누르면 선택 해제. 화면 바깥 여백을 누르면 선택을 유지한다
          // (속성을 고치다 실수로 눌러도 속성 창이 화면 설정으로 바뀌지 않게) — 끌면 영역 선택은 된다.
          const { w: W, h: H } = this.doc.size;
          const inside = pos.x >= 0 && pos.y >= 0 && pos.x <= W && pos.y <= H;
          if (!additive && inside) this.sel.clear();
          kind = 'marquee';
        }
        this.drawSelection();
        this.renderInspector();
      }
      if (!kind) return;
      e.preventDefault();
      this.svgRoot.setPointerCapture(e.pointerId);
      this.drag = {
        kind, handle, handleOf, collapseTo, start: pos, startClient: { x: e.clientX, y: e.clientY }, active: false,
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
      const list = this.selected();
      const w = list.find((x) => x.id === d.handleOf) || list[0];
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
      const ar = this.lockedRatio(w);
      if (ar) {
        // 비율 고정: 모서리는 더 많이(비율로) 바뀐 쪽 기준, 변은 그 방향 기준. 반대쪽 변·모서리를 고정한다
        let nw = x2 - x1, nh = y2 - y1;
        const byH = h === 'n' || h === 's' || (h.length === 2 && Math.abs(nh / r.h - 1) > Math.abs(nw / r.w - 1));
        if (byH) nw = Math.max(MIN_SIZE, Math.round(nh * ar)); else nh = Math.max(MIN_SIZE, Math.round(nw / ar));
        if (h.includes('w')) x1 = x2 - nw; else x2 = x1 + nw;
        if (h.includes('n')) y1 = y2 - nh; else y2 = y1 + nh;
      }
      Object.assign(w, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      // 함께 고른 위젯: 잡은 위젯과 같은 비율로, 각자 반대쪽 변을 고정해 바꾼다
      const sx = w.w / r.w, sy = w.h / r.h;
      const horiz = /[ew]/.test(h), vert = /[ns]/.test(h);
      for (const o of list) {
        if (o === w) continue;
        const ro = d.orig.get(o.id);
        let nw = horiz ? Math.max(MIN_SIZE, Math.round(ro.w * sx)) : ro.w;
        let nh = vert ? Math.max(MIN_SIZE, Math.round(ro.h * sy)) : ro.h;
        const oar = this.lockedRatio(o);
        if (oar) {   // 비율 고정 이미지는 자기 비율 유지
          if (horiz && (!vert || Math.abs(sx - 1) >= Math.abs(sy - 1))) nh = Math.max(MIN_SIZE, Math.round(nw / oar));
          else nw = Math.max(MIN_SIZE, Math.round(nh * oar));
        }
        let nx = h.includes('w') ? ro.x + ro.w - nw : ro.x;
        let ny = h.includes('n') ? ro.y + ro.h - nh : ro.y;
        // 화면 경계: 넘치는 만큼 크기를 줄인다(고정한 변은 그대로)
        if (nx < 0) { nw += nx; nx = 0; }
        if (ny < 0) { nh += ny; ny = 0; }
        nw = Math.max(MIN_SIZE, Math.min(nw, W - nx));
        nh = Math.max(MIN_SIZE, Math.min(nh, H - ny));
        Object.assign(o, { x: nx, y: ny, w: nw, h: nh });
      }
      this.drawSelection();
      this.showGeometry();
      if (!d.raf) {
        d.raf = requestAnimationFrame(() => { d.raf = 0; for (const o of list) this.redrawOne(o); });
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
      // 내용보다 작게 줄였으면 놓는 순간 내용이 들어가는 크기로 되돌린다
      if (d.active && d.kind === 'resize') for (const w of this.selected()) { this.redrawOne(w); this.fitBox(w, d.handle); }
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
      if (document.querySelector('.dlg-backdrop:not([hidden])')) return;
      if (e.key === 'Escape' && this.closeMenus()) { e.preventDefault(); return; }
      if (!this.doc) return;
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
          ghost.style.width = `${d.w * k}px`;
          ghost.style.height = `${d.h * k}px`;
          this.root.appendChild(ghost);
          // 실제 위젯을 반투명으로(실행·편집과 같은 그리기 코드). 실패하면 이름만
          try {
            const gs = svg('svg', { viewBox: `0 0 ${d.w} ${d.h}`, width: '100%', height: '100%', class: 'whmi-screen' }, ghost);
            const w = { id: `__ghost_${type}`, type, x: 0, y: 0, w: d.w, h: d.h, props: clone(d.props || {}) };
            const r = window.WHMI.drawWidget(gs, w, { defs: svg('defs', {}, gs), tag: () => undefined, write: () => {}, inputDialog: async () => null, goto: () => {} });
            if (r.inst.update) r.inst.update(previewInfo(w, r.p, {}, null));
            r.g.setAttribute('transform', '');
          } catch (_) {
            ghost.textContent = TYPE_LABEL[type] || type;
          }
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
    applyGeometry(before, handle) {
      for (const w of this.selected()) {
        const b = before.get(w.id);
        if (b.w !== w.w || b.h !== w.h) { this.redrawOne(w); this.fitBox(w, handle); }
        else if (b.x !== w.x || b.y !== w.y) this.nodes.get(w.id).g.setAttribute('transform', `translate(${w.x},${w.y})`);
      }
      this.drawSelection();
      this.commit();
    }

    // 바운딩 박스는 항상 내용을 감싼다 — 그린 내용(WHMI.contentBox)이 상자 밖으로 나가면 상자를
    // 넓힌다(자동으로 줄이지는 않음). 내용은 제자리, 상자가 넓어지는 쪽은 넘친 쪽. 상자 크기에 따라
    // 그림도 커지는 위젯(막대 두께 등)은 한 번에 안 맞을 수 있어 맞을 때까지 몇 번 반복한다.
    // 격자 맞춤이면 넓힌 변을 격자에 맞추고, 화면 밖으로 나가면 안쪽으로 민다. 넓혔으면 true.
    //  handle  크기 조절 손잡이('se' 등) 또는 'se'(입력란에서 w/h를 바꿈) — 이때는 반대쪽 변을 고정하고
    //          끌던 변만 넓힌다(놓으면 끌던 변이 내용이 들어가는 크기로 되돌아감)
    fitBox(w, handle) {
      const o = { x: w.x, y: w.y, w: w.w, h: w.h };
      const grew = { l: false, t: false, r: false, b: false };
      let prev = Infinity;
      for (let i = 0; i < 12; i++) {
        const node = this.nodes.get(w.id);
        const cb = node && window.WHMI.contentBox(node.g);
        if (!cb) break;
        let L = Math.ceil(-cb.x - 0.5), T = Math.ceil(-cb.y - 0.5);
        let R = Math.ceil(cb.x + cb.w - w.w - 0.5), B = Math.ceil(cb.y + cb.h - w.h - 0.5);
        if (L <= 0 && T <= 0 && R <= 0 && B <= 0) break;
        // 넓혀도 넘침이 줄지 않으면(그림이 상자와 같은 비율로 커짐 — 예: 미리보기 값이 범위 밖인 게이지)
        // 끝없이 커지므로 원래 크기로 되돌리고 멈춘다
        const total = Math.max(0, L) + Math.max(0, T) + Math.max(0, R) + Math.max(0, B);
        if (total >= prev) { Object.assign(w, o); this.redrawOne(w); return false; }
        prev = total;
        if (handle) {
          // 넘친 양을 모두 끌던 쪽 변으로(반대쪽 변은 고정)
          const dx = Math.max(0, L) + Math.max(0, R), dy = Math.max(0, T) + Math.max(0, B);
          const west = handle.includes('w'), north = handle.includes('n');
          L = west ? dx : 0; R = west ? 0 : dx;
          T = north ? dy : 0; B = north ? 0 : dy;
        }
        if (L > 0) { w.x -= L; w.w += L; grew.l = true; }
        if (T > 0) { w.y -= T; w.h += T; grew.t = true; }
        if (R > 0) { w.w += R; grew.r = true; }
        if (B > 0) { w.h += B; grew.b = true; }
        this.redrawOne(w);
      }
      if (w.w === o.w && w.h === o.h) return false;
      if (this.grid.snap) {
        const n = this.grid.size;
        const x2 = w.x + w.w, y2 = w.y + w.h;
        if (grew.l) w.x = Math.floor(w.x / n) * n;
        if (grew.t) w.y = Math.floor(w.y / n) * n;
        w.w = (grew.r ? Math.ceil(x2 / n) * n : x2) - w.x;
        w.h = (grew.b ? Math.ceil(y2 / n) * n : y2) - w.y;
      }
      const { w: W, h: H } = this.doc.size;
      w.x = clamp(w.x, 0, Math.max(0, W - w.w));
      w.y = clamp(w.y, 0, Math.max(0, H - w.h));
      this.redrawOne(w);
      return true;
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

    onFieldChange(el) {
      const w = this.selected()[0];
      if (!w || this.sel.size !== 1) return;
      const f = el.dataset.f;
      this.formError('');
      if (f === 'id') { this.renameWidget(w, el.value.trim(), el); return; }
      if (f === 'writeTag') {
        if (el.value === KEEP) return;
        if (el.value) w.writeTag = el.value; else delete w.writeTag;
        this.canonical(w);
        this.redrawOne(w);
        this.drawSelection();
        this.commit();
        return;
      }
      if (f === 'tag') {
        // "+ 새 태그…": 선택은 되돌리고 태그 관리의 새 태그 폼을 연다(만들면 이 위젯에 연결)
        if (el.value === '__new__') {
          const dev = el.previousElementSibling.value;
          this.fillTagPicker(el, w.tag, true, dev);
          window.WHMI.TagManager.open(this, { createFor: w.id, deviceId: dev === NO_DEV ? null : Number(dev) });
          return;
        }
        if (el.value === KEEP) return;
        this.setTag(w, el.value);
        return;
      }
      const v = Math.round(Number(el.value));
      if (el.value.trim() === '' || !Number.isFinite(v)) { el.value = w[f]; return; }
      const { w: W, h: H } = this.doc.size;
      const before = this.snapshotGeometry();
      // 드래그와 같은 규칙: 화면 안, 최소 크기
      if (f === 'x') w.x = clamp(v, 0, Math.max(0, W - w.w));
      if (f === 'y') w.y = clamp(v, 0, Math.max(0, H - w.h));
      if (f === 'w') w.w = clamp(v, MIN_SIZE, Math.max(MIN_SIZE, W - w.x));
      if (f === 'h') w.h = clamp(v, MIN_SIZE, Math.max(MIN_SIZE, H - w.y));
      const ar = this.lockedRatio(w);   // 비율 고정 이미지: 다른 쪽도 함께
      if (ar && f === 'w') w.h = Math.max(MIN_SIZE, Math.round(w.w / ar));
      if (ar && f === 'h') w.w = Math.max(MIN_SIZE, Math.round(w.h * ar));
      el.value = w[f];
      this.applyGeometry(before, 'se');   // w/h 입력은 왼쪽 위 고정
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
          if (res.ok) Object.assign(this.values, window.WHMI.raw.decode((await res.json()).values || {}, this.tags));
        } catch (_) {}
      }
      this.redrawOne(w);
      this.fitBox(w);   // 태그의 단위·범위로 내용이 커질 수 있다
      this.drawSelection();
      this.commit();
    }

    // ---- 속성 폼(whmi-schema.js) -------------------------------------------
    propFields(w) {
      const sc = window.WHMI.schema;
      return (sc && sc.types[w.type]) || [];
    }

    // 위젯 기본값 — numeric/input은 고른 스타일(프리셋) 값이 기본값처럼 보이게 한다
    propDefaults(w) {
      const impl = window.WHMI.impl(w.type);
      if (!impl) return {};
      const preset = impl.presets && w.props && impl.presets[w.props.preset];
      return Object.assign({}, impl.defaults, preset);
    }

    // multi: 같은 종류 여러 개 — 목록·쓰기 허용 조건은 빼고 보여 준다
    renderPropForm(w, multi) {
      const fields = this.propFields(w).filter((f) => !multi || !MULTI_SKIP.includes(f.type));
      if (!fields.length) return '';
      const groups = window.WHMI.schema.groups.filter(([g]) => fields.some((f) => f.group === g));
      const screens = (this.project.screens || []).map((x) =>
        `<option value="${esc(x.id)}">${esc(x.title || x.id)} (${esc(x.id)})</option>`).join('');
      const input = (f) => {
        const k = esc(fid(f));   // 칸 이름(같은 속성을 상황별로 다른 칸으로 보여 줄 때는 id)
        const lim = `${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''} step="${f.step || 1}"`;
        switch (f.type) {
          case 'num': case 'optnum': return `<input type="number" data-p="${k}"${lim}>`;
          case 'color': case 'optcolor':
            return `<span class="ed-color"><span class="ed-swatch"><input type="color" data-p="${k}"></span>` +
              `<input type="text" data-p="${k}" data-pct spellcheck="false">` +
              `<input type="number" class="ed-alpha" data-p="${k}" data-alpha min="0" max="100" step="5" title="투명도(%) — 100이 불투명"><span class="ed-alpha-unit">%</span></span>`;
          case 'bool': return `<input type="checkbox" data-p="${k}">`;
          case 'select': return `<select data-p="${k}">${f.options.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select>`;
          case 'screen': return `<select data-p="${k}"><option value="">(선택 안 함)</option>${screens}</select>`;
          case 'list':
            return `<div class="ed-list" data-list="${k}"></div><button class="ed-list-add" type="button" data-list-add="${k}">+ 추가</button>`;
          case 'bits':
            return `<div class="ed-bits" data-bits="${k}">${Array.from({ length: 16 }, (_, i) => `<button type="button" data-bit="${i}">${i}</button>`).join('')}</div>` +
              '<div class="ed-bits-sum"></div>';
          case 'image':
            return `<div class="ed-img"><span class="ed-img-thumb"></span>` +
              `<button class="ed-btn" type="button" data-img="pick">파일 선택…</button>` +
              `<button class="ed-btn" type="button" data-img="clear">지우기</button>` +
              `<input type="file" accept="image/*" data-imgfile hidden></div>`;
          case 'cond':
            return `<div class="ed-cond" data-cond="${k}">` +
              `<select data-cm><option value="">${esc(f.none)}</option><option value="on">조건 지정</option></select>` +
              '<div class="ed-cond-body">' +
              '<div class="ed-tagpick"><select data-tagdev="c" title="장비"></select><select data-ct title="태그"></select></div>' +
              `<select data-ctest title="비교">${COND_TESTS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>` +
              '<input type="text" data-cv spellcheck="false" placeholder="값 (예: 1)">' +
              '<div class="ed-cond-range"><input type="number" step="any" data-cmin placeholder="이상 (비우면 끝없음)"><input type="number" step="any" data-cmax placeholder="이하 (비우면 끝없음)"></div>' +
              `<div class="ed-bits" data-cbits>${Array.from({ length: 16 }, (_, i) => `<button type="button" data-cbit="${i}">${i}</button>`).join('')}</div>` +
              '</div><div class="ed-cond-sum"></div></div>';
          case 'anim':
            return `<div class="ed-anim"><label><input type="checkbox" data-p="${k}" data-anim> 사용</label>` +
              `<span class="ed-anim-ms"><input type="number" data-p="${k}"${lim}> ms</span></div>`;
          default: return `<input type="text" data-p="${k}" spellcheck="false">`;
        }
      };
      const field = (f) => f.type === 'bool'
        ? `<div class="ed-pf ed-pf-bool" data-pk="${esc(fid(f))}"><label>${input(f)} ${esc(f.label)}</label>${this.resetBtn(f)}</div>`
        : `<div class="ed-pf" data-pk="${esc(fid(f))}"><div class="ed-pf-head"><span>${esc(f.label)}</span>${this.resetBtn(f)}</div>${input(f)}</div>`;
      return groups.map(([g, title]) => `
        <details class="ed-group" data-g="${g}"${(this.groupOpen[g] ?? (g !== 'cond' || hasCond(w))) ? ' open' : ''}>
          <summary>${esc(title)}</summary>
          <div class="ed-group-body">${fields.filter((f) => f.group === g).map(field).join('')}</div>
        </details>`).join('');
    }

    resetBtn(f) {
      return `<button class="ed-reset" type="button" data-reset="${esc(fid(f))}" title="기본값으로" hidden>↺</button>`;
    }

    // 표시용 값 — value 필드의 true/false/숫자/글자
    fmtVal(v) {
      return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    }

    // 위젯 속성 → 폼(입력 중인 칸은 건드리지 않음). ws: 하나 또는 같은 종류 여러 개 —
    // 값이 서로 다르면 "여러 값"으로 표시하고, 바꾸면 전부에 같은 값이 들어간다.
    syncPropForm(ws) {
      const fields = this.propFields(ws[0]);
      if (!fields.length) return;
      const items = ws.map((w) => {
        const props = w.props || {};
        const defs = this.propDefaults(w);
        return { w, props, defs, eff: Object.assign({}, defs, props) };
      });
      const active = document.activeElement;
      for (const f of fields) {
        const box = this.inspector.querySelector(`.ed-pf[data-pk="${fid(f)}"]`);
        if (!box) continue;
        const has = (it) => Object.prototype.hasOwnProperty.call(it.props, f.key);
        const set = items.some(has);
        // 표시 기준: 값을 바꾼 위젯이 있으면 그 값, 없으면 기본값
        const ref = items.find(has) || items[0];
        const cur = has(ref) ? ref.props[f.key] : undefined;
        const def = ref.defs[f.key];
        const mixed = items.some((it) => JSON.stringify(it.eff[f.key]) !== JSON.stringify(ref.eff[f.key]));
        box.hidden = !!(f.when && !items.every((it) => f.when(it.eff)));
        box.querySelector('.ed-reset').hidden = !set;
        box.classList.toggle('is-set', set);
        box.classList.toggle('is-mixed', mixed);
        if (f.type === 'cond') {
          this.syncCond(box, f, ws[0]);
          continue;
        }
        if (f.type === 'bits') {
          const bits = bitList(set ? cur : def);
          box.querySelectorAll('[data-bit]').forEach((b) => b.classList.toggle('on', bits.includes(Number(b.dataset.bit))));
          const low = items[0].eff.onValue != null && Number(items[0].eff.onValue) === 0;   // 켜짐 조건 "비트 = 0일 때"
          box.querySelector('.ed-bits-sum').textContent = !bits.length ? '사용 안 함 — 값 전체로 판정'
            : bits.length === 1 ? `비트 ${bits[0]} = ${low ? 0 : 1}이면 켜짐`
            : low ? `비트 ${bits.join(', ')}가 모두 0이면 켜짐` : `비트 ${bits.join(', ')} 중 하나라도 1이면 켜짐`;
          continue;
        }
        if (f.type === 'image') {
          const src = ws[0].props && ws[0].props.src;
          box.querySelector('.ed-img-thumb').style.backgroundImage = src ? `url("${src}")` : '';
          box.querySelector('[data-img="clear"]').disabled = !src;
          box.querySelector('.ed-reset').hidden = true;   // 지우기 버튼이 대신한다
          continue;
        }
        if (f.type === 'anim') {
          // 켜짐 = 시간 > 0. 꺼져 있으면 시간 칸은 비활성(흐리게). 켜짐 여부가 섞이면 체크는 —
          const ons = items.map((it) => it.eff[f.key] > 0);
          const on = ons.every(Boolean);
          const cb = box.querySelector('[data-anim]');
          const num = box.querySelector('input[type="number"]');
          cb.checked = on;
          cb.indeterminate = !on && ons.some(Boolean);
          num.disabled = !on;
          box.querySelector('.ed-anim-ms').classList.toggle('is-off', !on);
          if (num !== active) {
            num.value = on && !mixed && set ? cur : '';
            num.placeholder = on && mixed ? '여러 값' : def > 0 ? def : ANIM_DEFAULT_MS;
          }
          continue;
        }
        if (f.type === 'list') {
          // 입력 중인 목록은 다시 그리지 않음(포커스·커서 유지)
          const listEl = box.querySelector('[data-list]');
          if (!(listEl.contains(active) && active.tagName === 'INPUT')) listEl.innerHTML = this.listRowsHtml(f, (set ? cur : def) || [], items[0].eff);
          continue;
        }
        for (const el of box.querySelectorAll('[data-p]')) {
          if (el === active && isTyping(el)) continue;   // 체크 상자는 포커스가 있어도 갱신(실행 취소 반영)
          if (f.type === 'bool') { el.checked = !mixed && !!(set ? cur : def); el.indeterminate = mixed; }
          else if (el.type === 'color') {
            const c = splitColor(set ? cur : def);
            el.value = c ? c.rgb : '#000000';
            el.style.opacity = c ? c.a / 100 : 1;   // 체크무늬 위에 투명도만큼 비쳐 보이게
          } else if (el.dataset.alpha !== undefined) {
            const as = items.map((it) => (splitColor(it.eff[f.key]) || { a: 100 }).a);
            const c = splitColor(set ? cur : def);
            el.value = as.some((a) => a !== as[0]) ? '' : set && c && c.a < 100 ? c.a : '';
            el.placeholder = as.some((a) => a !== as[0]) ? '여러 값' : String(c ? c.a : 100);
          }
          else if (f.type === 'select' || f.type === 'screen') {
            // 값이 섞이면 고를 수 없는 "(여러 값)" 항목을 잠시 넣어 보여 준다
            let mx = el.querySelector(`option[value="${MIXED}"]`);
            if (mixed && !mx) { mx = new Option('(여러 값)', MIXED); mx.disabled = true; el.add(mx, 0); }
            if (!mixed && mx) mx.remove();
            const v = f.type === 'screen' ? (set ? cur : '') : (set ? cur : def) ?? f.nullAs;   // nullAs: 값이 없을 때 보일 항목
            el.value = mixed ? MIXED : v == null ? '' : String(v);
          } else if (mixed) {
            el.value = '';
            el.placeholder = '여러 값';
          } else {
            el.value = set ? this.fmtVal(cur) : '';
            // 기본값(스타일 값 포함)이 있으면 그 값을, 없으면 안내 문구를 흐리게
            el.placeholder = def != null && def !== '' ? this.fmtVal(def) : f.placeholder || (f.type === 'optnum' ? '자동' : '');
          }
        }
      }
      // 그룹 안 필드가 모두 숨으면 그룹도 숨김
      this.inspector.querySelectorAll('.ed-group[data-g]').forEach((g) => {
        g.hidden = ![...g.querySelectorAll('.ed-pf')].some((b) => !b.hidden);
      });
    }

    // ---- 이미지 위젯 ---------------------------------------------------------
    async onImageFile(input) {
      const file = input.files && input.files[0];
      input.value = '';   // 같은 파일을 다시 골라도 change가 나도록
      const w = this.selected()[0];
      if (!file || !w) return;
      this.msg('그림을 줄이는 중…');
      try {
        const { src, ratio } = await shrinkImage(file);
        if (!this.doc.widgets.includes(w)) return;   // 그 사이 위젯이 사라짐
        this.setImage(w, src, ratio);
        this.flash(`그림을 넣었습니다 (${Math.ceil(src.length / 1024)}KB)`);
      } catch (e) {
        this.msg(e.message, 'err');
      }
    }

    // 그림 넣기/지우기(실행 취소 한 단계). 비율 고정이면 너비는 두고 높이를 그림 비율에 맞춘다.
    setImage(w, src, ratio) {
      const props = Object.assign({}, w.props);
      if (src) Object.assign(props, { src, ratio: Math.round(ratio * 10000) / 10000 });
      else { delete props.src; delete props.ratio; }
      if (Object.keys(props).length) w.props = props; else delete w.props;
      this.applyRatio(w);
      this.canonical(w);
      this.redrawOne(w);
      this.drawSelection();
      this.commit();
    }

    // 비율 고정 이미지면 그림 비율(너비/높이), 아니면 null
    lockedRatio(w) {
      const p = w.props || {};
      return w.type === 'image' && p.src && p.ratio > 0 && (p.fit || 'ratio') === 'ratio' ? p.ratio : null;
    }

    // 상자를 그림 비율로 — 너비 기준, 화면을 넘으면 높이 기준으로 다시
    applyRatio(w) {
      const ar = this.lockedRatio(w);
      if (!ar) return;
      const { w: W, h: H } = this.doc.size;
      w.h = Math.max(MIN_SIZE, Math.round(w.w / ar));
      if (w.y + w.h > H) { w.h = Math.max(MIN_SIZE, H - w.y); w.w = Math.max(MIN_SIZE, Math.round(w.h * ar)); }
    }

    // ---- 태그 고르기: 장비 → 태그 2단계 ----------------------------------------
    // 태그 응답의 source.deviceId/deviceDisplayName(서버가 채움)으로 장비별로 묶는다.
    // 소스를 모르는 태그·정의되지 않은 태그는 "(장비 없음)"으로.
    tagGroups() {
      const groups = new Map();
      for (const t of Object.values(this.tags)) {
        const src = t.source || {};
        const key = src.deviceId != null ? String(src.deviceId) : NO_DEV;
        if (!groups.has(key)) groups.set(key, { key, name: src.deviceDisplayName || src.deviceCode || '(장비 없음)', tags: [] });
        groups.get(key).tags.push(t);
      }
      for (const g of groups.values()) g.tags.sort((a, b) => a.id.localeCompare(b.id));
      return [...groups.values()].sort((a, b) => (a.key === NO_DEV) - (b.key === NO_DEV) || a.name.localeCompare(b.name, 'ko'));
    }

    // tagSel 바로 앞의 장비 선택 상자와 함께 채운다.
    //  tagId    현재 연결된 태그(없으면 null)    isWidget  true: 위젯 tag(없음 + 새 태그…) / 'cond': 동작 조건(태그 필수)
    //                                             / 'write': 쓰기 태그(첫 항목 "표시 태그와 같음")
    //  devKey   보여 줄 장비(생략 시 태그의 장비 → 마지막으로 고른 장비 → 첫 장비)
    fillTagPicker(tagSel, tagId, isWidget, devKey) {
      const devSel = tagSel.previousElementSibling;
      const groups = this.tagGroups();
      const defined = tagId && this.tags[tagId];
      const own = defined ? (defined.source && defined.source.deviceId != null ? String(defined.source.deviceId) : NO_DEV) : tagId ? NO_DEV : null;
      if (tagId && !defined && !groups.some((g) => g.key === NO_DEV)) groups.push({ key: NO_DEV, name: '(장비 없음)', tags: [] });
      const key = [devKey, own, this.tagDev].find((k) => k && groups.some((g) => g.key === k)) || (groups[0] && groups[0].key) || '';
      devSel.innerHTML = groups.map((g) => `<option value="${esc(g.key)}">${esc(g.name)} (${g.tags.length})</option>`).join('');
      devSel.value = key;
      devSel.disabled = !groups.length;
      const g = groups.find((x) => x.key === key);
      const none = isWidget === 'cond' ? '' : isWidget === 'write' ? '<option value="">(표시 태그와 같음)</option>' : '<option value="">(없음)</option>';
      // 연결된 태그가 다른 장비 것이면, 이 장비 목록에서 고르기 전까지는 연결을 바꾸지 않는다
      const head = tagId && own !== key ? `<option value="${KEEP}" disabled>— 태그 선택 —</option>` : '';
      const opts = (g ? g.tags : []).map((t) => `<option value="${esc(t.id)}">${esc(t.id)}${t.name ? ` — ${esc(t.name)}` : ''}</option>`).join('');
      const undef = tagId && !defined && key === NO_DEV ? `<option value="${esc(tagId)}">${esc(tagId)} (정의되지 않은 태그)</option>` : '';
      tagSel.innerHTML = `${head}${none}${undef}${opts}${isWidget === true ? '<option value="__new__">+ 새 태그…</option>' : ''}`;
      tagSel.value = head ? KEEP : tagId || '';
    }

    // 장비를 바꾸면 태그 목록만 바꾼다(연결은 태그를 고를 때 바뀜). 고른 장비는 다음 위젯에서도 먼저 보여 준다.
    onTagDevChange(devSel) {
      const tagSel = devSel.nextElementSibling;
      this.tagDev = devSel.value;
      const w = this.selected()[0];
      if (!w) return;
      if (devSel.dataset.tagdev === 'f') this.fillTagPicker(tagSel, w.tag, true, devSel.value);
      else if (devSel.dataset.tagdev === 'w') this.fillTagPicker(tagSel, w.writeTag || null, 'write', devSel.value);
      else {
        const c = window.WHMI.rules.normalize(w[devSel.closest('.ed-cond').dataset.cond]);
        this.fillTagPicker(tagSel, c ? c.tag : null, 'cond', devSel.value);
      }
    }

    // ---- 동작 조건(위젯 필드 visibleWhen / enableWhen / activeWhen) ----------------------
    // 조건 하나 = 태그 + 비교. 판정은 런타임·미리보기 모두 판정 엔진(WHMI.rules)이 한다.
    syncCond(box, f, w) {
      const R = window.WHMI.rules;
      const c = R.normalize(w[f.key]);
      const el = box.querySelector('.ed-cond');
      const q = (sel) => el.querySelector(sel);
      const active = document.activeElement;
      box.querySelector('.ed-reset').hidden = !c;
      box.classList.toggle('is-set', !!c);
      q('[data-cm]').value = c ? 'on' : '';
      q('.ed-cond-body').hidden = !c;
      const sum = q('.ed-cond-sum');
      if (!c) { sum.textContent = ''; return; }
      if (q('[data-ct]') !== active) this.fillTagPicker(q('[data-ct]'), c.tag || null, 'cond');
      q('[data-ctest]').value = c.test;
      const isVal = ['eq', 'ne', 'gt', 'lt'].includes(c.test), isRange = c.test === 'range', isBits = c.test.startsWith('bit');
      q('[data-cv]').hidden = !isVal;
      q('.ed-cond-range').hidden = !isRange;
      q('[data-cbits]').hidden = !isBits;
      if (isVal && q('[data-cv]') !== active) q('[data-cv]').value = this.fmtVal(c.value);
      if (isRange) {
        if (q('[data-cmin]') !== active) q('[data-cmin]').value = c.min ?? '';
        if (q('[data-cmax]') !== active) q('[data-cmax]').value = c.max ?? '';
      }
      const bits = R.bitList(c.bits);
      el.querySelectorAll('[data-cbit]').forEach((b) => b.classList.toggle('on', bits.includes(Number(b.dataset.cbit))));
      const t = COND_TESTS.find(([v]) => v === c.test);
      sum.textContent = `${c.tag || '(태그 없음)'} ${t ? t[2](c) : ''}일 때 ${f.effect}`;
    }

    onCondChange(el) {
      const w = this.selected()[0];
      if (!w || !el) return;
      const R = window.WHMI.rules;
      const key = el.dataset.cond;
      const q = (sel) => el.querySelector(sel);
      if (!q('[data-cm]').value) { this.setCond(w, key, undefined); return; }
      const prev = R.normalize(w[key]);
      // 태그: 고른 것 → 이전 조건 → 위젯 자기 태그 → 지금 장비의 첫 태그(조건은 태그가 있어야 판정되므로 바로 채움)
      let tag = q('[data-ct]').value;
      if (!tag || tag === KEEP) {
        const groups = this.tagGroups();
        const g = groups.find((x) => x.key === this.tagDev) || groups[0];
        tag = (prev && prev.tag) || w.tag || (g && g.tags[0] ? g.tags[0].id : '');
      }
      const test = (prev ? q('[data-ctest]').value : null) || 'eq';
      const c = { tag, test };
      if (['eq', 'ne', 'gt', 'lt'].includes(test)) {
        const raw = q('[data-cv]').value.trim();
        c.value = raw === '' ? (prev && prev.value !== undefined ? prev.value : 1) : this.parseValue(raw);
      } else if (test === 'range') {
        const mn = q('[data-cmin]').value.trim(), mx = q('[data-cmax]').value.trim();
        if (mn !== '' && Number.isFinite(Number(mn))) c.min = Number(mn);
        if (mx !== '' && Number.isFinite(Number(mx))) c.max = Number(mx);
      } else {
        c.bits = prev && prev.test.startsWith('bit') ? R.bitList(prev.bits) : [];
      }
      this.setCond(w, key, c);
    }

    toggleCondBit(el, n) {
      const w = this.selected()[0];
      if (!w || !el) return;
      const R = window.WHMI.rules;
      const key = el.dataset.cond;
      const c = R.normalize(w[key]);
      if (!c || !c.test.startsWith('bit')) return;
      const bits = R.bitList(c.bits);
      const next = (bits.includes(n) ? bits.filter((x) => x !== n) : bits.concat(n)).sort((a, b) => a - b);
      this.setCond(w, key, { ...c, bits: next });
    }

    setCond(w, key, c) {
      if (c) w[key] = c; else delete w[key];
      this.canonical(w);
      this.redrawOne(w);
      this.drawSelection();
      this.commit();
    }

    // ---- 목록 속성(구간 색 / 기준선 / 그라데이션 / 셀렉터 위치) ----------------------
    // 목록의 보이는 칸 — 칸에 when(p)가 있으면 지금 속성(p, 기본값 포함)에 따라(예: 판정 방식별 조건 칸)
    listCols(f, eff) {
      return f.columns.filter((c) => !c.when || c.when(eff));
    }

    // 위젯의 지금 속성(기본값·스타일 포함)
    effProps(w) {
      return Object.assign({}, this.propDefaults(w), w.props);
    }

    listRowsHtml(f, rows, eff) {
      const cols = this.listCols(f, eff);
      const tpl = `grid-template-columns:${cols.map((c) => c.width || (c.type === 'color' ? '34px' : c.type === 'bool' ? '30px' : '1fr')).join(' ')} 22px`;
      const cell = (c, row) => {
        const v = row[c.key];
        const k = esc(c.key);
        if (c.type === 'select') {
          return `<select data-lc="${k}"><option value=""${v == null ? ' selected' : ''}>–</option>${c.options.map(([ov, ot]) =>
            `<option value="${esc(ov)}"${String(v) === String(ov) ? ' selected' : ''}>${esc(ot)}</option>`).join('')}</select>`;
        }
        if (c.type === 'color') return `<input type="color" data-lc="${k}" value="${esc(v || '#000000')}">`;
        if (c.type === 'bool') return `<input type="checkbox" data-lc="${k}"${v ? ' checked' : ''}>`;
        if (c.type === 'num') return `<input type="number" step="any" data-lc="${k}" value="${v == null ? '' : v}"${c.required ? '' : ' placeholder="끝없음"'}>`;
        return `<input type="text" data-lc="${k}" data-lt="${c.type}" spellcheck="false" value="${esc(this.fmtVal(v))}">`;
      };
      const head = rows.length
        ? `<div class="ed-lrow ed-lhead" style="${tpl}">${cols.map((c) => `<span>${esc(c.label)}</span>`).join('')}<span></span></div>` : '';
      const warn = f.warn ? f.warn(rows) : '';
      return head + rows.map((row, i) => `<div class="ed-lrow" style="${tpl}">${cols.map((c) => cell(c, row)).join('')}` +
        `<button class="ed-list-del" type="button" data-list-del="${i}" title="행 삭제">×</button></div>`).join('') +
        (warn ? `<div class="ed-list-warn">${esc(warn)}</div>` : '');
    }

    parseValue(raw) {
      if (raw === 'true' || raw === 'false') return raw === 'true';
      if (raw !== '' && Number.isFinite(Number(raw))) return Number(raw);
      return raw;
    }

    // 화면의 행들을 다시 읽어 목록 전체를 저장
    onListChange(listEl, live) {
      const w = this.selected()[0];
      if (!w || !listEl) return;
      const f = this.propFields(w).find((x) => x.key === listEl.dataset.list);
      if (!f) return;
      const cols = this.listCols(f, this.effProps(w));
      const prev = this.currentList(w, f.key);
      const rows = [...listEl.querySelectorAll('.ed-lrow:not(.ed-lhead)')].map((r, i) => {
        // 지금 안 보이는 칸(예: 판정 방식을 바꿔 숨은 조건)은 원래 값을 그대로 둔다
        const o = {};
        for (const c of f.columns) if (!cols.includes(c) && prev[i] && prev[i][c.key] !== undefined) o[c.key] = prev[i][c.key];
        for (const c of cols) {
          const el = r.querySelector(`[data-lc="${c.key}"]`);
          const raw = el.value.trim();
          if (c.type === 'select') { if (raw !== '') o[c.key] = Number.isFinite(Number(raw)) ? Number(raw) : raw; }
          else if (c.type === 'num') { if (raw !== '' && Number.isFinite(Number(raw))) o[c.key] = Number(raw); }
          else if (c.type === 'color') o[c.key] = el.value.toLowerCase();
          else if (c.type === 'bool') { if (el.checked) o[c.key] = true; }
          else if (c.type === 'value') { if (raw !== '') o[c.key] = this.parseValue(raw); }
          else if (raw !== '') o[c.key] = el.value;
        }
        return o;
      });
      const missing = rows.some((o) => cols.some((c) => c.required && o[c.key] === undefined));
      if (missing) { this.formError(`${f.label}: 비어 있으면 안 되는 칸이 있습니다.`); return; }
      this.formError('');
      this.setProp(w, f.key, rows.length ? rows : undefined, live);
    }

    currentList(w, key) {
      const props = w.props || {};
      return clone(Object.prototype.hasOwnProperty.call(props, key) ? props[key] : this.propDefaults(w)[key]) || [];
    }

    addListRow(key) {
      const w = this.selected()[0];
      const f = w && this.propFields(w).find((x) => x.key === key);
      if (!f) return;
      const rows = this.currentList(w, key);
      rows.push(f.newRow ? f.newRow(rows, this.effProps(w)) : {});
      this.setProp(w, key, rows);
    }

    delListRow(key, i) {
      const w = this.selected()[0];
      if (!w) return;
      const rows = this.currentList(w, key);
      rows.splice(i, 1);
      this.setProp(w, key, rows.length ? rows : undefined);
    }

    // 폼 입력 → 속성(여러 개 선택이면 전부에 같은 값).
    // live: 색 선택기를 끄는 중(연속 변경을 실행 취소 한 단계로 묶음)
    onPropChange(el, live) {
      const ws = this.propTargets();
      if (!ws) return;
      const w = ws[0];
      const f = this.propFields(w).find((x) => fid(x) === el.dataset.p);
      if (!f) return;
      const def = this.propDefaults(w)[f.key];
      const raw = typeof el.value === 'string' ? el.value.trim() : '';
      let v;
      this.formError('');
      switch (f.type) {
        case 'anim':
          if (el.dataset.anim !== undefined) {
            // 끄면 0. 켜면 위젯 기본 시간(기본이 0인 위젯은 ANIM_DEFAULT_MS)
            v = el.checked ? (def > 0 ? undefined : ANIM_DEFAULT_MS) : 0;
          } else if (raw === '') {
            v = def > 0 ? undefined : ANIM_DEFAULT_MS;   // 비우면 기본 시간(켜진 상태 유지)
          } else {
            const n = Number(raw);
            if (!Number.isFinite(n)) { this.syncPropForm(ws); return; }
            v = Math.min(f.max, Math.max(f.min, Math.round(n)));
          }
          break;
        case 'bool': v = el.checked; break;
        case 'select':
          if (el.value === MIXED) return;
          v = el.value === '' ? undefined : typeof def === 'number' || f.numeric ? Number(el.value) : el.value;
          break;
        case 'screen': if (el.value === MIXED) return; v = raw || undefined; break;
        case 'num': case 'optnum': {
          if (raw === '') { v = undefined; break; }
          const n = Number(raw);
          if (!Number.isFinite(n)) { this.syncPropForm(ws); return; }
          v = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n));
          el.value = v;
          break;
        }
        case 'color': case 'optcolor': {
          // 위젯마다 지금 색(기본값 포함)을 기준으로 — 여러 개 편집에서도 바꾼 쪽(색 또는 투명도)만 같아진다
          const now = (x) => splitColor(Object.prototype.hasOwnProperty.call(x.props || {}, f.key) ? x.props[f.key] : this.propDefaults(x)[f.key]);
          if (el.dataset.alpha !== undefined) {
            const a = raw === '' ? 100 : Math.round(Number(raw));
            if (!Number.isFinite(a)) { this.syncPropForm(ws); return; }
            const al = clamp(a, 0, 100);
            v = (x) => { const c = now(x); return c ? joinColor(c.rgb, al) : undefined; };
          } else if (el.type === 'color') {
            const rgb = el.value.toLowerCase();
            v = (x) => joinColor(rgb, (now(x) || { a: 100 }).a);
          } else {
            if (raw === '') { v = undefined; break; }
            if (!splitColor(raw)) { this.formError(`${f.label}: #RRGGBB 또는 #RRGGBBAA 형식이어야 합니다.`); this.syncPropForm(ws); return; }
            const c = splitColor(raw);
            v = joinColor(c.rgb, c.a);
          }
          break;
        }
        case 'value': v = raw === '' ? undefined : this.parseValue(raw); break;
        default: v = raw === '' ? undefined : el.value;   // text / opttext
      }
      this.setProp(ws, f.key, v, live);
    }

    resetProp(id) {
      const ws = this.propTargets();
      if (!ws) return;
      const f = this.propFields(ws[0]).find((x) => fid(x) === id);
      const key = f ? f.key : id;
      if (f && f.type === 'cond') { this.setCond(ws[0], key, undefined); return; }
      this.setProp(ws, key, undefined);
    }

    // 속성 하나를 위젯 하나 또는 같은 종류 여러 개에 같은 값으로 — 실행 취소는 한 단계.
    // 기본값과 같으면 지워서 화면 JSON을 가볍게 유지한다(기본값은 위젯마다: 스타일 프리셋).
    setProp(target, key, v, live) {
      const ws = Array.isArray(target) ? target : [target];
      for (const w of ws) {
        const props = Object.assign({}, w.props);
        const val = typeof v === 'function' ? v(w) : v;   // 위젯마다 다른 값(예: 색은 두고 투명도만)
        if (val === undefined || JSON.stringify(val) === JSON.stringify(this.propDefaults(w)[key])) delete props[key];
        else props[key] = val;
        if (key === 'preset') {
          // 스타일이 바뀌면 기본값이 달라지므로, 새 기본값과 같아진 속성은 정리한다
          const impl = window.WHMI.impl(w.type);
          const defs = Object.assign({}, impl && impl.defaults, impl && impl.presets && impl.presets[props.preset]);
          for (const k of Object.keys(props)) if (k !== 'preset' && JSON.stringify(props[k]) === JSON.stringify(defs[k])) delete props[k];
        }
        if (Object.keys(props).length) w.props = props; else delete w.props;
        if (key === 'fit') this.applyRatio(w);   // 이미지: 비율 고정으로 바꾸면 상자를 그림 비율로
        this.canonical(w);
        this.redrawOne(w);
        this.fitBox(w);   // 글자 크기·글자 등이 커져 내용이 넘치면 상자도 넓힌다
      }
      this.drawSelection();
      // 색 선택기를 끄는 동안의 연속 변경만 한 단계로 묶는다(끝나는 change 이벤트도 같은 단계)
      const mk = `prop:${ws.map((w) => w.id).join(',')}:${key}`;
      this.commit(live || (this.lastMerge && this.lastMerge.key === mk) ? mk : undefined);
    }

    // 글자(text/opttext) 칸 — 칠 때마다 위젯에 반영한다
    isLiveText(el) {
      const ws = this.propTargets();
      const f = ws && el.type === 'text' && this.propFields(ws[0]).find((x) => fid(x) === el.dataset.p);
      return !!f && (f.type === 'text' || f.type === 'opttext');
    }

    // 속성 폼이 편집하는 위젯들 — 하나, 또는 같은 종류 여러 개. 아니면 null
    propTargets() {
      const ws = this.selected();
      if (!ws.length || ws.some((w) => w.type !== ws[0].type)) return null;
      return ws;
    }

    // 같은 위젯이 계속 선택돼 있으면 입력란 값만 갱신(입력 중인 칸 유지)
    updateFields(w) {
      for (const f of ['id', 'x', 'y', 'w', 'h']) {
        const el = this.inspector.querySelector(`[data-f="${f}"]`);
        if (el && document.activeElement !== el) el.value = w[f];
      }
      const sel = this.inspector.querySelector('[data-f="tag"]');
      if (sel && document.activeElement !== sel) this.fillTagPicker(sel, w.tag, true);
      const wsel = this.inspector.querySelector('[data-f="writeTag"]');
      if (wsel && document.activeElement !== wsel) this.fillTagPicker(wsel, w.writeTag || null, 'write');
      this.syncPropForm([w]);
    }

    renderInspector() {
      if (!this.doc) return;
      this.inspector.classList.remove('is-screen');
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
        const num = (f) => `<label class="ed-field"><span>${f}</span><input type="number" step="1" data-f="${f}"></label>`;
        this.inspector.innerHTML = `
          ${alignBlock(1)}
          <div class="ed-insp-section">${esc(TYPE_LABEL[w.type] || w.type)} <small class="ed-type">${esc(w.type)}</small></div>
          <div class="ed-form">
            <label class="ed-field wide"><span>id</span><input type="text" data-f="id" spellcheck="false" autocomplete="off"></label>
            ${num('x')}${num('y')}${num('w')}${num('h')}
            ${NO_TAG_TYPES.includes(w.type) ? '' : `<div class="ed-field wide ed-tagpick"><span>tag</span><select data-tagdev="f" title="장비"></select><select data-f="tag" title="태그"></select></div>`}
            ${WRITE_TYPES.includes(w.type) ? `<div class="ed-field wide ed-tagpick" title="표시(tag)와 다른 태그에 써야 할 때 — 예: NSP 표시, TSP 쓰기"><span>쓰기 태그</span><select data-tagdev="w" title="장비"></select><select data-f="writeTag" title="쓰기 태그"></select></div>` : ''}
          </div>
          <div class="ed-form-err"></div>
          ${this.renderPropForm(w)}`;
        this.updateFields(w);
        return;
      }
      if (list.length > 1) {
        // 같은 종류면 속성 폼도 — 값을 바꾸면 전부에 같은 값(syncPropForm/setProp)
        const same = this.propTargets() && this.propFields(list[0]).length ? list[0].type : null;
        const key = `multi:${this.primaryId()}:${list.map((w) => w.id).sort().join(',')}`;
        if (same && this.inspKey === key) { this.syncPropForm(list); return; }
        this.inspKey = same ? key : null;
        this.inspector.innerHTML = `
          <div class="ed-insp-section">${list.length}개 선택</div>
          ${alignBlock(list.length)}
          ${same ? `
          <div class="ed-insp-section">${esc(TYPE_LABEL[same] || same)} <small class="ed-type">${esc(same)}</small></div>
          <div class="ed-form-err is-collapsible"></div>
          ${this.renderPropForm(list[0], true)}` : ''}`;
        if (same) this.syncPropForm(list);
        return;
      }
      this.inspKey = null;
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
        <div class="ed-form-err is-collapsible"></div>
        ${outside ? `<p class="ed-warn">⚠ 화면 밖으로 나간 위젯 ${outside}개 — 화면을 키우거나 위젯을 안쪽으로 옮기세요.</p>` : ''}
        <div class="ed-stats">
          <div><span>위젯</span><b>${d.widgets.length}</b></div>
          <div><span>Revision</span><b>${this.revision ?? '-'}</b></div>
        </div>
        <div class="ed-keys">
          <div class="ed-keys-title">조작</div>
          ${KEY_HELP.map(([what, keys]) => `<div class="ed-key"><span>${what}</span><span>${keys.map((k) => `<kbd>${k}</kbd>`).join(' ')}</span></div>`).join('')}
        </div>`;
      this.inspector.classList.add('is-screen');   // 조작 안내를 속성 창 아래쪽에 붙인다
    }

    destroy() {
      // 저장 안 한 채 사라지면(탭 닫기 등) 임시 저장본을 남겨 둔다
      if (this.dirty) this.flushDraft();
      clearTimeout(this.draftTimer);
      clearTimeout(this.flashTimer);
      document.removeEventListener('keydown', this.onKey);
      this.closeMenus();
      this.resizeObs.disconnect();
      this.root.innerHTML = '';
    }
  }

  window.WHMI.Editor = {
    open: (root, opts) => new Editor(root, opts),
  };
})();
