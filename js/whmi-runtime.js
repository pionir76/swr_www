// WHMI 런타임: project → tags/screen JSON 로드 → SVG 렌더 → 값 폴링 → 위젯 갱신
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svg(name, attrs, parent) {
    const el = document.createElementNS(SVG_NS, name);
    for (const k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }

  // 위젯 레지스트리. 위젯 구현: { defaults, create(g, w, p, ctx) -> { update(info)? } }
  const registry = {};
  const WHMI = (window.WHMI = {
    svg,
    register(type, impl) { registry[type] = impl; },
    // 편집기(whmi-editor.js)용 — 등록된 위젯 타입 목록과 구현 조회
    types() { return Object.keys(registry); },
    impl(type) { return registry[type]; },
  });

  // 위젯 하나를 parent 아래에 그린다 — 실행 런타임과 편집기 미리보기가 같은 코드로 그린다.
  // 반환: { g, p, inst }. 알 수 없는 타입이면 점선 상자로 대체(inst는 빈 객체).
  function drawWidget(parent, w, ctx, before) {
    const impl = registry[w.type];
    const g = svg('g', { transform: `translate(${w.x},${w.y})`, class: `w w-${w.type}`, 'data-id': w.id });
    parent.insertBefore(g, before || null);
    if (!impl) {
      console.warn(`[whmi] 알 수 없는 위젯 타입: ${w.type} (${w.id})`);
      svg('rect', { width: w.w, height: w.h, class: 'unknown' }, g);
      svg('text', { x: 4, y: 16, class: 'unknown-text' }, g).textContent = `? ${w.type}`;
      return { g, p: {}, inst: {} };
    }
    const p = Object.assign({}, impl.defaults, w.props);
    const inst = impl.create(g, w, p, ctx) || {};
    return { g, p, inst };
  }
  WHMI.drawWidget = drawWidget;

  // 위젯이 실제로 보이게 그린 범위(위젯 좌표, {x, y, w, h}) — 편집기가 바운딩 박스를 내용에
  // 맞춰 넓힐 때 쓴다. getBBox()는 clip-path로 잘린 부분까지 세므로, 잘림 영역과 교집합을 낸다.
  // 회전·이동(transform)도 반영. 선 두께와 필터(발광·그림자) 번짐은 세지 않는다.
  function contentBox(g) {
    const inv = g.getCTM().inverse();
    const toLocal = (el, bb) => {
      const m = inv.multiply(el.getCTM());
      const xs = [], ys = [];
      for (const [x, y] of [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]]) {
        xs.push(m.a * x + m.c * y + m.e);
        ys.push(m.b * x + m.d * y + m.f);
      }
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    };
    const cut = (a, b) => (b ? { x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), x2: Math.min(a.x2, b.x2), y2: Math.min(a.y2, b.y2) } : a);
    let box = null;
    const walk = (el, clip) => {
      if (el.nodeType !== 1 || /^(defs|clipPath|mask|title|style)$/.test(el.tagName)) return;
      if (getComputedStyle(el).display === 'none') return;
      const ref = /url\(#([^)]+)\)/.exec(el.getAttribute('clip-path') || '');
      const cp = ref && document.getElementById(ref[1]);
      if (cp && cp.firstElementChild) clip = cut(toLocal(el, cp.firstElementChild.getBBox()), clip);
      if (el.tagName === 'g' || el.tagName === 'svg' || el.tagName === 'a') {
        for (const c of el.children) walk(c, clip);
        return;
      }
      const bb = el.getBBox();
      if (!bb.width && !bb.height) return;
      const r = cut(toLocal(el, bb), clip);
      if (r.x2 <= r.x1 || r.y2 <= r.y1) return;   // 완전히 잘려 안 보임
      box = box ? { x1: Math.min(box.x1, r.x1), y1: Math.min(box.y1, r.y1), x2: Math.max(box.x2, r.x2), y2: Math.max(box.y2, r.y2) } : r;
    };
    for (const c of g.children) walk(c, null);
    return box && { x: box.x1, y: box.y1, w: box.x2 - box.x1, h: box.y2 - box.y1 };
  }
  WHMI.contentBox = contentBox;

  async function loadJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  // ---- 데이터 소스 -------------------------------------------------------
  // 읽기:  GET  {readUrl}?tags=A,B  → { "ts": 1700000000000, "values": { "A": { "v": 1.2, "q": "good" } } }
  // 쓰기:  POST {writeUrl} { "tag": "A", "v": 1 } → 2xx
  class HttpSource {
    constructor(cfg) {
      this.readUrl = cfg.readUrl || '/api/values';
      this.writeUrl = cfg.writeUrl || '/api/write';
      this.pollMs = cfg.pollMs || 1000;
    }
    async read(ids) {
      // 각 id만 개별 인코딩하고 콤마는 그대로 둔다 — 전체를 encodeURIComponent로 감싸면
      // 콤마가 %2C로 인코딩돼 "하나의 태그명"처럼 보여, 디코딩 없이 그대로 split하는
      // 서버에서는 아무 태그도 못 찾는다(실제 HMI 태그 API에서 이 버그로 값이 전부
      // 비어 보이는 문제가 있었음 — SwrHmiSource도 동일하게 수정).
      const res = await fetch(`${this.readUrl}?tags=${ids.map(encodeURIComponent).join(',')}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).values || {};
    }
    async write(id, v) {
      const res = await fetch(this.writeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: id, v }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    }
  }

  // swr_web 백엔드의 HMI 태그 API(referencs/api-spec.md §14) 전용 데이터소스.
  // HttpSource와 달리 인증이 필요해 apiFetch(config.js, 토큰 자동 첨부)를 쓰고,
  // 엔드포인트 경로도 고정(/api/hmi/*)이라 cfg.readUrl/writeUrl은 쓰지 않는다.
  class SwrHmiSource {
    constructor(cfg) {
      this.pollMs = cfg.pollMs || 1000;
    }
    async read(ids) {
      const res = await apiFetch(`/api/hmi/values?tags=${ids.map(encodeURIComponent).join(',')}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).values || {};
    }
    async write(id, v) {
      const res = await apiFetch('/api/hmi/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: id, v }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    }
  }

  // ---- 대화상자 (확인 / 값 입력) -------------------------------------------
  const dlg = {
    root: null,
    open(html) {
      if (!this.root) {
        this.root = document.createElement('div');
        this.root.className = 'dlg-backdrop';
      }
      // 전체 화면 중엔 전체 화면 요소 밖(body)에 붙이면 보이지 않으므로 그 안에 띄운다
      const host = document.fullscreenElement || document.webkitFullscreenElement || document.body;
      if (this.root.parentNode !== host) host.appendChild(this.root);
      this.root.innerHTML = `<div class="dlg">${html}</div>`;
      this.root.hidden = false;
      return this.root.querySelector('.dlg');
    },
    close() { this.root.hidden = true; this.root.innerHTML = ''; },
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function confirmDialog(message) {
    return new Promise((resolve) => {
      const d = dlg.open(`<p>${esc(message)}</p>
        <div class="dlg-btns"><button data-r="0">취소</button><button data-r="1" class="primary">확인</button></div>`);
      d.addEventListener('click', (e) => {
        const r = e.target.dataset && e.target.dataset.r;
        if (r == null) return;
        dlg.close();
        resolve(r === '1');
      });
    });
  }

  function inputDialog({ title, value, min, max, decimals, unit }) {
    return new Promise((resolve) => {
      // 부동소수점 오차(예: 121 * 0.1 = 12.100000000000001) 그대로 넣지 않도록 decimals로 반올림.
      // numeric/gauge 등 표시 위젯은 fmt()에서 이미 이렇게 하고 있는데, 입력창 초기값만 빠져 있었다.
      const initial = value == null ? '' : Number(value).toFixed(decimals);
      const d = dlg.open(`<p>${esc(title)}</p>
        <input type="number" step="any" value="${initial}">
        <div class="dlg-hint">범위 ${min} ~ ${max} ${esc(unit || '')}</div>
        <div class="dlg-err"></div>
        <div class="dlg-btns"><button data-r="0">취소</button><button data-r="1" class="primary">확인</button></div>`);
      const input = d.querySelector('input');
      const err = d.querySelector('.dlg-err');
      input.focus();
      input.select();
      const submit = () => {
        const v = Number(input.value);
        if (input.value.trim() === '' || !Number.isFinite(v)) { err.textContent = '숫자를 입력하세요.'; return; }
        if (v < min || v > max) { err.textContent = `${min} ~ ${max} 범위를 벗어났습니다.`; return; }
        dlg.close();
        resolve(Number(v.toFixed(decimals)));
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') { dlg.close(); resolve(null); }
      });
      d.addEventListener('click', (e) => {
        const r = e.target.dataset && e.target.dataset.r;
        if (r === '1') submit();
        if (r === '0') { dlg.close(); resolve(null); }
      });
    });
  }

  WHMI.dialog = { open: (html) => dlg.open(html), close: () => dlg.close(), confirm: confirmDialog };
  WHMI.esc = esc;

  // ---- 화면 런타임 ---------------------------------------------------------
  class ScreenRuntime {
    constructor(container, screen, tags, source, status, nav) {
      this.screen = screen;
      this.tags = tags;
      this.source = source;
      this.status = status;
      this.nav = nav || {}; // { goto(screenId) } — screenlink 위젯이 쓰는 화면 전환 진입점
      this.bindings = new Map(); // tagId -> [{ w, p, inst, g }]
      this.items = [];           // 모든 위젯(태그 없는 위젯 포함) — 상태 칸(보이기 등)은 위젯마다 판정
      this.values = {};          // tagId -> { v, q, min?, max? }
      this.extraPollTags = new Set(); // 상태 칸 조건(visibleWhen/enableWhen/activeWhen)이 보는 태그
      this.timer = null;
      this.render(container);
    }

    // 화면 전환/페이지 이탈 시 호출 — 폴링 타이머를 반드시 정리해야 숨겨진 화면이
    // 백그라운드에서 계속 돌지 않는다.
    destroy() {
      clearTimeout(this.timer);
      this.timer = null;
    }

    render(container) {
      const { w: W, h: H } = this.screen.size;
      container.innerHTML = '';
      const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', class: 'whmi-screen' }, container);
      const defs = svg('defs', {}, root);
      svg('rect', { width: W, height: H, fill: this.screen.background || '#14181f' }, root);

      const ctx = {
        defs,
        tag: (id) => this.tags[id],
        write: (w, v, confirmMsg) => this.write(w, v, confirmMsg),
        inputDialog,
        goto: (screenId) => this.nav.goto && this.nav.goto(screenId),
      };

      // 배열 순서 = 그리기 순서(z-order)
      for (const w of this.screen.widgets) {
        if (!registry[w.type]) { drawWidget(root, w, ctx); continue; }
        if (w.tag && !this.tags[w.tag]) console.warn(`[whmi] 정의되지 않은 태그: ${w.tag} (${w.id})`);
        // 상태 칸 조건이 보는 태그는 그 태그에 연결된 위젯이 없어도 값을 받아야 하므로 폴링 대상에 넣는다
        for (const t of WHMI.rules.tagsOf(w.visibleWhen, w.enableWhen, w.activeWhen)) this.extraPollTags.add(t);
        // 쓰기 태그(표시와 다른 곳에 쓰는 위젯, 예: NSP 표시 / TSP 쓰기) — 쓰기 권한·통신 상태를 알아야 하므로 폴링
        if (w.writeTag) this.extraPollTags.add(w.writeTag);
        const { g, p, inst } = drawWidget(root, w, ctx);
        const item = { w, p, inst, g };
        this.items.push(item);
        if (w.tag && inst.update) {
          if (!this.bindings.has(w.tag)) this.bindings.set(w.tag, []);
          this.bindings.get(w.tag).push(item);
        }
        this.refresh(item, true);   // 값이 오기 전 첫 모습(판정 불가 상태)
      }
    }

    // 상태 칸 3개 판정 — 판정 엔진(WHMI.rules) 결과를 칸별 규칙으로(docs/architecture/hmi-conditions.md §3.2)
    //  visible  조건 거짓이면 숨김, 판정 불가(통신 불량 등)면 보임 — 정보를 감추지 않는 쪽
    //  enabled  조건이 참일 때만 조작 허용(거짓·판정 불가면 막음)
    //  active   조건 참이면 켜짐, 거짓·판정 불가면 꺼짐. 조건이 없으면 undefined(위젯이 자기 값으로 판단)
    states(w) {
      const R = WHMI.rules;
      const at = (c) => { const n = R.normalize(c); return n ? R.test(n, this.values[n.tag]) : undefined; };
      const vis = at(w.visibleWhen), en = at(w.enableWhen), act = at(w.activeWhen);
      return {
        visible: vis !== false,
        enabled: en === undefined ? true : en === true,
        active: act === undefined ? undefined : act === true,
      };
    }

    // 위젯 하나를 지금 값으로 다시 반영. initial: 첫 폴링 전(품질 표시는 값이 온 뒤부터)
    refresh(item, initial) {
      const { w, p, inst, g } = item;
      const st = this.states(w);
      g.classList.toggle('w-hidden', !st.visible);
      // 자기 태그가 없어도 켜짐 상태 조건이 있으면(예: 태그 없는 램프가 다른 태그로 켜짐) 갱신 —
      // 이때 값·품질은 조건 태그의 것을 쓴다(조건 태그가 통신 불량이면 흐리게)
      const src = w.tag || (st.active !== undefined && WHMI.rules.normalize(w.activeWhen).tag);
      if (!inst.update || !src) return;
      const info = this.info(w, p, this.values[src], st);
      if (!initial) {
        // bad: 흐리게+값 자리 대체(기존). normal: 값은 그대로 두고 연한 경고 표시만(§2.2).
        g.classList.toggle('q-bad', info.quality === 'bad');
        g.classList.toggle('q-normal', info.quality === 'normal');
      }
      inst.update(info);
    }

    // 위젯이 보는 값 정보.
    // min/max는 실시간 값 응답에 없으므로(태그 정의에만 존재): 위젯 props > 태그 정의 > 기본값
    // unit/decimals/access는 실시간 값 응답이 상속·오버라이드 적용 완료 상태로 내려주므로:
    //   위젯 props(명시한 경우만) > 실시간 값 응답 > 태그 정의
    // (docs/reference/hmi-widgets.md §2.1)
    // st: 상태 칸 판정 결과(states) — 조작 허용이 거짓이면 쓰기 불가, 켜짐 상태는 info.active로 위젯에
    info(w, p, raw, st = this.states(w)) {
      const t = this.tags[w.tag] || {};
      const pick = (...xs) => xs.find((x) => x != null);
      // quality는 3단계(good/normal/bad) — 값이 아예 없으면(통신 실패 등) bad로 간주.
      // 'disabled'(소스 장비가 통신 비활성, v는 null)도 bad와 똑같이 그리고 쓰기를 막는다.
      const disabled = !!raw && raw.q === 'disabled';
      const quality = disabled ? 'bad' : raw ? (raw.q || 'good') : 'bad';
      // 쓰기 가능 여부는 실제로 쓰는 태그(쓰기 태그가 있으면 그것) 기준
      const wraw = w.writeTag ? this.values[w.writeTag] : raw;
      const wt = w.writeTag ? this.tags[w.writeTag] || {} : t;
      const writable = !(wraw && wraw.q === 'disabled') && pick(wraw && wraw.access, wt.access) === 'rw' && st.enabled;
      return {
        value: raw ? raw.v : undefined,
        ok: quality !== 'bad',
        quality,
        min: pick(p.min, t.min, 0),
        max: pick(p.max, t.max, 100),
        unit: pick(p.unit, raw && raw.unit, t.unit, ''),
        decimals: pick(p.decimals, raw && raw.decimals, t.decimals, 0),
        writable,
        active: st.active,
        tag: t,
      };
    }

    apply(values) {
      // 1단계: this.values부터 전부 최신화 — enableWhen이 다른 위젯의 태그를 참조할 때
      // Map 순회 순서에 따라 한 틱 묵은 값을 보는 일이 없도록, update() 호출 전에
      // 모든 태그 값을 먼저 반영해둔다. 통신 실패 시(values={})엔 undefined가 되어
      // 마지막 값을 유지하지 않는다.
      for (const id of this.bindings.keys()) this.values[id] = values[id];
      for (const id of this.extraPollTags) this.values[id] = values[id];

      // 2단계: 값이 다 반영된 상태에서 모든 위젯 갱신(태그 없는 위젯도 상태 칸 판정)
      for (const item of this.items) this.refresh(item);
    }

    async poll() {
      clearTimeout(this.timer);
      const ids = [...new Set([...this.bindings.keys(), ...this.extraPollTags])];
      try {
        const values = ids.length ? await this.source.read(ids) : {};
        this.apply(values);
        this.status('ok', `갱신 ${new Date().toLocaleTimeString()}`);
      } catch (e) {
        this.apply({}); // 통신 실패 → 전체 품질 불량 표시 (마지막 값 유지하지 않음)
        this.status('err', `통신 오류: ${e.message}`);
      }
      this.timer = setTimeout(() => this.poll(), this.source.pollMs);
    }

    async write(w, v, confirmMsg) {
      if (v == null) { this.status('err', `쓸 값이 지정되지 않은 위젯: ${w.id}`); return; }
      const target = w.writeTag || w.tag;   // 쓰기 태그가 있으면 그곳에(표시는 tag)
      const t = this.tags[target];
      // access는 실시간 값 응답으로 갱신될 수 있으므로(§2.1) 최신 폴링 결과를 우선 확인 —
      // 최종 판단은 어차피 서버가 하지만(405), 클라이언트에서도 최신 상태로 먼저 막아준다.
      const access = this.values[target]?.access ?? t?.access;
      if (!t || access !== 'rw' || !this.states(w).enabled) {
        this.status('err', `쓰기 불가 태그: ${target}`);
        return;
      }
      if (confirmMsg && !(await confirmDialog(confirmMsg))) return;
      try {
        await this.source.write(target, v);
        this.poll(); // 쓰기 결과를 바로 반영
      } catch (e) {
        this.status('err', `쓰기 실패 (${target}): ${e.message}`);
      }
    }
  }

  // ---- 부트스트랩 ----------------------------------------------------------
  // opts.screen: 처음 띄울 화면 id(디자인 모드에서 돌아올 때 편집하던 화면으로)
  WHMI.boot = async function (container, statusFn, opts = {}) {
    const params = new URLSearchParams(location.search);
    // swr_web SPA는 해시 라우팅이라 ?project= 쿼리스트링을 쓰기 어려우므로, 호스트 페이지가
    // window.WHMI_DEFAULT_PROJECT로 기본 경로를 지정할 수 있게 한다(없으면 원래 기본값 유지).
    const projectUrl = params.get('project') || window.WHMI_DEFAULT_PROJECT || 'project/project.json';
    const base = projectUrl.replace(/[^/]*$/, '');

    const project = await loadJson(projectUrl);
    const isSwrHmi = project.dataSource && project.dataSource.type === 'swr-hmi';

    // swr-hmi 모드는 태그 정의도 로컬 tags.json이 아니라 백엔드 HMI 태그 API에서 가져온다
    // (레지스터와 별도인 HMI 태그 네임스페이스 — referencs/api-spec.md §14).
    const tags = {};
    if (isSwrHmi) {
      const res = await apiFetch('/api/hmi/tags');
      if (!res.ok) throw new Error(`/api/hmi/tags: HTTP ${res.status}`);
      const tagDoc = await res.json();
      for (const t of tagDoc.tags) tags[t.id] = t;
    } else {
      const tagDoc = await loadJson(base + project.tags);
      for (const t of tagDoc.tags) tags[t.id] = t;
    }

    const source = isSwrHmi ? new SwrHmiSource(project.dataSource) : new HttpSource(project.dataSource || {});

    // screensSource: "api"면 화면 목록/시작 화면/화면 내용을 디바이스에 저장된 것에서 읽는다
    // (GET /api/hmi/project, /api/hmi/screens/{id}). 생략 시 project.json의 screens[].file
    // 정적 파일(WHMI 원본 데모 방식).
    const fromApi = project.screensSource === 'api';
    if (fromApi) {
      const res = await apiFetch('/api/hmi/project');
      if (!res.ok) throw new Error(`/api/hmi/project: HTTP ${res.status}`);
      const p = await res.json();
      project.name = p.name;
      project.startScreen = p.startScreen;
      project.screens = p.screens;
      project.revision = p.revision;
    }

    // 화면 JSON은 한 번 불러오면 캐시 — 같은 화면으로 돌아올 때 재요청하지 않는다.
    const screenCache = {};
    async function loadScreen(screenId) {
      if (!screenCache[screenId]) {
        if (fromApi) {
          const res = await apiFetch(`/api/hmi/screens/${encodeURIComponent(screenId)}`);
          if (!res.ok) throw new Error(`화면 "${screenId}"을(를) 불러올 수 없습니다 (HTTP ${res.status})`);
          screenCache[screenId] = (await res.json()).content;
        } else {
          const ref = project.screens.find((s) => s.id === screenId) || project.screens[0];
          if (!ref) throw new Error(`알 수 없는 화면: ${screenId}`);
          screenCache[screenId] = await loadJson(base + ref.file);
        }
      }
      return screenCache[screenId];
    }

    // rt는 "현재 활성 화면"의 ScreenRuntime — goto()가 호출될 때마다 이전 걸 destroy()
    // 하고 새로 만든다. nav 객체를 통해 screenlink 위젯이 이 함수에 접근한다.
    let rt = null;
    const nav = {
      goto: async (screenId) => {
        let screen;
        try {
          screen = await loadScreen(screenId);
        } catch (e) {
          if (!rt) throw e;               // 첫 화면이면 페이지 오류로 처리
          statusFn('err', e.message);     // 화면 전환 중이면 현재 화면은 그대로 두고 알림만
          return rt;
        }
        if (rt) rt.destroy();
        document.title = screen.title || project.name;
        rt = new ScreenRuntime(container, screen, tags, source, statusFn, nav);
        rt.poll();
        return rt;
      },
    };

    const empty = !project.screens || project.screens.length === 0;
    if (empty) {
      // 등록된 화면이 없음 — 편집기에서 화면을 만들기 전 상태
      container.innerHTML = '<div class="whmi-empty">등록된 화면이 없습니다.</div>';
      statusFn('ok', '화면 없음');
    } else {
      const wanted = opts.screen && project.screens.some((s) => s.id === opts.screen) ? opts.screen : null;
      const screenId = wanted || params.get('screen') || project.startScreen || project.screens[0].id;
      await nav.goto(screenId);
    }

    return {
      project,
      tags,
      empty,
      get screen() { return rt && rt.screen; },
      get runtime() { return rt; },
      goto: nav.goto,
    };
  };
})();
