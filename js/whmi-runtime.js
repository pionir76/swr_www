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
  });

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
        document.body.appendChild(this.root);
      }
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

  // ---- 화면 런타임 ---------------------------------------------------------
  class ScreenRuntime {
    constructor(container, screen, tags, source, status, nav) {
      this.screen = screen;
      this.tags = tags;
      this.source = source;
      this.status = status;
      this.nav = nav || {}; // { goto(screenId) } — screenlink 위젯이 쓰는 화면 전환 진입점
      this.bindings = new Map(); // tagId -> [{ w, p, inst, g }]
      this.values = {};          // tagId -> { v, q, min?, max? }
      this.extraPollTags = new Set(); // enableWhen이 참조하지만 자체 위젯이 없는 태그
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
        const impl = registry[w.type];
        const g = svg('g', { transform: `translate(${w.x},${w.y})`, class: `w w-${w.type}`, 'data-id': w.id }, root);
        if (!impl) {
          console.warn(`[whmi] 알 수 없는 위젯 타입: ${w.type} (${w.id})`);
          svg('rect', { width: w.w, height: w.h, class: 'unknown' }, g);
          svg('text', { x: 4, y: 16, class: 'unknown-text' }, g).textContent = `? ${w.type}`;
          continue;
        }
        if (w.tag && !this.tags[w.tag]) console.warn(`[whmi] 정의되지 않은 태그: ${w.tag} (${w.id})`);
        // enableWhen: { tag, equals } — 다른 태그 값이 조건과 같을 때만 쓰기 가능하게 한다
        // (예: 수동출력 입력은 제어모드가 수동일 때만). 조건 태그에 바인딩된 위젯이
        // 따로 없어도 값을 받아야 하므로 폴링 대상에 추가해둔다.
        if (w.enableWhen && w.enableWhen.tag) this.extraPollTags.add(w.enableWhen.tag);
        const p = Object.assign({}, impl.defaults, w.props);
        const inst = impl.create(g, w, p, ctx) || {};
        if (w.tag && inst.update) {
          if (!this.bindings.has(w.tag)) this.bindings.set(w.tag, []);
          this.bindings.get(w.tag).push({ w, p, inst, g });
          inst.update(this.info(w, p, undefined));
        }
      }
    }

    // 위젯이 보는 값 정보.
    // min/max는 실시간 값 응답에 없으므로(태그 정의에만 존재): 위젯 props > 태그 정의 > 기본값
    // unit/decimals/access는 실시간 값 응답이 상속·오버라이드 적용 완료 상태로 내려주므로:
    //   위젯 props(명시한 경우만) > 실시간 값 응답 > 태그 정의
    // (docs/reference/hmi-widgets.md §2.1)
    // enableWhen 조건을 만족하는지 — 조건 태그 자체가 아직 안 왔거나(q 불량 등) 값이
    // 다르면 비활성. 조건이 없는 위젯은 항상 true(기존 동작 그대로).
    checkEnableWhen(w) {
      if (!w.enableWhen || !w.enableWhen.tag) return true;
      const cond = this.values[w.enableWhen.tag];
      return !!cond && cond.v === w.enableWhen.equals;
    }

    info(w, p, raw) {
      const t = this.tags[w.tag] || {};
      const pick = (...xs) => xs.find((x) => x != null);
      // quality는 3단계(good/normal/bad) — 값이 아예 없으면(통신 실패 등) bad로 간주.
      const quality = raw ? (raw.q || 'good') : 'bad';
      let writable = pick(raw && raw.access, t.access) === 'rw';
      if (writable && !this.checkEnableWhen(w)) writable = false;
      return {
        value: raw ? raw.v : undefined,
        ok: quality !== 'bad',
        quality,
        min: pick(p.min, t.min, 0),
        max: pick(p.max, t.max, 100),
        unit: pick(p.unit, raw && raw.unit, t.unit, ''),
        decimals: pick(p.decimals, raw && raw.decimals, t.decimals, 0),
        writable,
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

      // 2단계: 값이 다 반영된 상태에서 위젯 갱신
      for (const [id, list] of this.bindings) {
        const raw = this.values[id];
        for (const b of list) {
          const info = this.info(b.w, b.p, raw);
          // bad: 흐리게+값 자리 대체(기존). normal: 값은 그대로 두고 연한 경고 표시만(§2.2).
          b.g.classList.toggle('q-bad', info.quality === 'bad');
          b.g.classList.toggle('q-normal', info.quality === 'normal');
          b.inst.update(info);
        }
      }
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
      const t = this.tags[w.tag];
      // access는 실시간 값 응답으로 갱신될 수 있으므로(§2.1) 최신 폴링 결과를 우선 확인 —
      // 최종 판단은 어차피 서버가 하지만(405), 클라이언트에서도 최신 상태로 먼저 막아준다.
      const access = this.values[w.tag]?.access ?? t?.access;
      if (!t || access !== 'rw' || !this.checkEnableWhen(w)) {
        this.status('err', `쓰기 불가 태그: ${w.tag}`);
        return;
      }
      if (confirmMsg && !(await confirmDialog(confirmMsg))) return;
      try {
        await this.source.write(w.tag, v);
        this.poll(); // 쓰기 결과를 바로 반영
      } catch (e) {
        this.status('err', `쓰기 실패 (${w.tag}): ${e.message}`);
      }
    }
  }

  // ---- 부트스트랩 ----------------------------------------------------------
  WHMI.boot = async function (container, statusFn) {
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

    // 화면 JSON은 한 번 불러오면 캐시 — 같은 화면으로 돌아올 때 재요청하지 않는다.
    const screenCache = {};
    async function loadScreen(screenId) {
      if (!screenCache[screenId]) {
        const ref = project.screens.find((s) => s.id === screenId) || project.screens[0];
        if (!ref) throw new Error(`알 수 없는 화면: ${screenId}`);
        screenCache[screenId] = await loadJson(base + ref.file);
      }
      return screenCache[screenId];
    }

    // rt는 "현재 활성 화면"의 ScreenRuntime — goto()가 호출될 때마다 이전 걸 destroy()
    // 하고 새로 만든다. nav 객체를 통해 screenlink 위젯이 이 함수에 접근한다.
    let rt = null;
    const nav = {
      goto: async (screenId) => {
        const screen = await loadScreen(screenId);
        if (rt) rt.destroy();
        document.title = screen.title || project.name;
        rt = new ScreenRuntime(container, screen, tags, source, statusFn, nav);
        rt.poll();
        return rt;
      },
    };

    const screenId = params.get('screen') || project.startScreen;
    await nav.goto(screenId);

    return {
      project,
      get screen() { return rt.screen; },
      get runtime() { return rt; },
      goto: nav.goto,
    };
  };
})();
