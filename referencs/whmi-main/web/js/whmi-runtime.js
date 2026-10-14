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
      const res = await fetch(`${this.readUrl}?tags=${encodeURIComponent(ids.join(','))}`, { cache: 'no-store' });
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
      const d = dlg.open(`<p>${esc(title)}</p>
        <input type="number" step="any" value="${value == null ? '' : value}">
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
    constructor(container, screen, tags, source, status) {
      this.screen = screen;
      this.tags = tags;
      this.source = source;
      this.status = status;
      this.bindings = new Map(); // tagId -> [{ w, p, inst, g }]
      this.values = {};          // tagId -> { v, q, min?, max? }
      this.timer = null;
      this.render(container);
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
        const p = Object.assign({}, impl.defaults, w.props);
        const inst = impl.create(g, w, p, ctx) || {};
        if (w.tag && inst.update) {
          if (!this.bindings.has(w.tag)) this.bindings.set(w.tag, []);
          this.bindings.get(w.tag).push({ w, p, inst, g });
          inst.update(this.info(w, p, undefined));
        }
      }
    }

    // 위젯이 보는 값 정보. min/max 우선순위: 위젯 props > 실시간 값(장치 제공) > 태그 정의
    info(w, p, raw) {
      const t = this.tags[w.tag] || {};
      const pick = (...xs) => xs.find((x) => x != null);
      return {
        value: raw ? raw.v : undefined,
        ok: !!raw && raw.q !== 'bad',
        min: pick(p.min, raw && raw.min, t.min, 0),
        max: pick(p.max, raw && raw.max, t.max, 100),
        unit: pick(p.unit, t.unit, ''),
        decimals: pick(p.decimals, t.decimals, 0),
        writable: t.access === 'rw',
        tag: t,
      };
    }

    apply(values) {
      for (const [id, list] of this.bindings) {
        const raw = values[id];
        this.values[id] = raw;
        for (const b of list) {
          const info = this.info(b.w, b.p, raw);
          b.g.classList.toggle('q-bad', !info.ok);
          b.inst.update(info);
        }
      }
    }

    async poll() {
      clearTimeout(this.timer);
      const ids = [...this.bindings.keys()];
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
      if (!t || t.access !== 'rw') { this.status('err', `쓰기 불가 태그: ${w.tag}`); return; }
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
    const projectUrl = params.get('project') || 'project/project.json';
    const base = projectUrl.replace(/[^/]*$/, '');

    const project = await loadJson(projectUrl);
    const tagDoc = await loadJson(base + project.tags);
    const tags = {};
    for (const t of tagDoc.tags) tags[t.id] = t;

    const screenId = params.get('screen') || project.startScreen;
    const ref = project.screens.find((s) => s.id === screenId) || project.screens[0];
    const screen = await loadJson(base + ref.file);
    document.title = screen.title || project.name;

    const source = new HttpSource(project.dataSource || {});
    const rt = new ScreenRuntime(container, screen, tags, source, statusFn);
    rt.poll();
    return { project, screen, runtime: rt };
  };
})();
