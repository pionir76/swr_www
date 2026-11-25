// HMI 로직 태그의 조건 빌더 — 태그 관리 폼(whmi-tags.js)이 쓴다. 디자인 모드에서만 로드된다.
// 설계: docs/architecture/hmi.md §5.3(식 AST), §7.3. 계산은 백엔드가 한다(미리보기도 POST /api/hmi/eval).
//
// 편집 모형(화면용) ↔ AST(저장용)
//   조건     { tag, test, value | min,max | bits }     test: true·false(참/거짓일 때) + 비교 + 범위 + 비트
//   묶음     { mode: 'and'|'or', not, items: [조건 | 묶음] }   묶음 안의 묶음까지(2단)
//   참/거짓  = 묶음 하나
//   숫자·글자 = { rows: [{ g, value }], def }          위에서부터 처음 맞는 줄의 값(select). g = 줄의 조건 묶음(1단, 조건만)
// 빌더로 나타낼 수 없는 식(다른 태그와 비교, 3단 이상 묶음 등)은 parse가 null — 폼은 글자로만 보여 주고 그대로 둔다.
(function () {
  'use strict';
  if (!window.WHMI) return;
  const { esc, raw: RAW } = window.WHMI;
  const R = window.WHMI.rules;

  const TESTS = [
    ['true', '참일 때'], ['false', '거짓일 때'],
    ['eq', '같음'], ['ne', '다름'], ['gt', '보다 큼'], ['ge', '크거나 같음'], ['lt', '보다 작음'], ['le', '작거나 같음'],
    ['range', '범위 안'], ['bitAny', '비트 중 하나라도 1'], ['bitNone', '비트 모두 0'],
  ];
  const CMP = ['eq', 'ne', 'gt', 'ge', 'lt', 'le'];
  const isBit = (t) => t === 'bitAny' || t === 'bitNone';
  const MAX_DEPTH = 2;
  const CALC = 'calc', NONE = 'none';

  const parseValue = (s) => (s === 'true' || s === 'false' ? s === 'true' : s !== '' && Number.isFinite(Number(s)) ? Number(s) : s);
  const fmtValue = (v) => (v == null ? '' : String(v));
  const V = (v) => ({ value: v });

  // ---- 모형 → AST ----------------------------------------------------------
  function condAst(c) {
    const t = { tag: c.tag };
    if (c.test === 'true') return t;
    if (c.test === 'false') return { op: 'not', args: [t] };
    if (c.test === 'range') return { op: 'range', args: [t, V(c.min ?? null), V(c.max ?? null)] };
    if (isBit(c.test)) return { op: c.test, args: [t, V(R.bitList(c.bits))] };
    return { op: c.test, args: [t, V(c.value)] };
  }
  function groupAst(g) {
    const args = g.items.map((i) => (i.items ? groupAst(i) : condAst(i)));
    const body = args.length === 1 ? args[0] : { op: g.mode, args };
    return g.not ? { op: 'not', args: [body] } : body;
  }
  const selectAst = (m) => ({ op: 'select', args: [...m.rows.flatMap((r) => [groupAst(r.g), V(r.value)]), V(m.def)] });

  // ---- AST → 모형(안 되면 null) ---------------------------------------------
  const isTag = (n) => n && typeof n === 'object' && 'tag' in n;
  const isVal = (n) => n && typeof n === 'object' && 'value' in n;
  function parseCond(n) {
    if (isTag(n)) return { tag: String(n.tag), test: 'true' };
    if (!n || !n.op || !Array.isArray(n.args)) return null;
    const [a, b, c] = n.args;
    if (n.op === 'not' && n.args.length === 1 && isTag(a)) return { tag: String(a.tag), test: 'false' };
    if (!isTag(a)) return null;
    if (CMP.includes(n.op) && isVal(b) && !Array.isArray(b.value)) return { tag: String(a.tag), test: n.op, value: b.value };
    if (n.op === 'range' && isVal(b) && isVal(c)) return { tag: String(a.tag), test: 'range', min: b.value ?? undefined, max: c.value ?? undefined };
    if (isBit(n.op) && isVal(b)) return { tag: String(a.tag), test: n.op, bits: R.bitList(b.value) };
    return null;
  }
  function parseGroup(n, depth) {
    let not = false;
    // not(and/or …)는 "반대로" 묶음. not(태그)는 조건(거짓일 때)이라 여기서 풀지 않는다
    if (n && n.op === 'not' && n.args && n.args.length === 1 && n.args[0] && (n.args[0].op === 'and' || n.args[0].op === 'or')) { not = true; n = n.args[0]; }
    if (n && (n.op === 'and' || n.op === 'or') && Array.isArray(n.args)) {
      const items = [];
      for (const x of n.args) {
        const c = parseCond(x);
        if (c) { items.push(c); continue; }
        if (depth >= MAX_DEPTH) return null;
        const g = parseGroup(x, depth + 1);
        if (!g) return null;
        items.push(g);
      }
      return { mode: n.op, not, items };
    }
    const c = parseCond(n);
    return c ? { mode: 'and', not: false, items: [c] } : null;
  }
  // 선택형 한 줄의 조건 — 조건 하나, 또는 조건들만의 and/or(1단). 그 밖은 null
  function parseRowGroup(n) {
    const c = parseCond(n);
    if (c) return { mode: 'and', not: false, items: [c] };
    if (!n || (n.op !== 'and' && n.op !== 'or') || !Array.isArray(n.args) || n.args.length < 2) return null;
    const items = n.args.map(parseCond);
    return items.every(Boolean) ? { mode: n.op, not: false, items } : null;
  }
  function parseSelect(n) {
    if (!n || n.op !== 'select' || !Array.isArray(n.args) || n.args.length < 3 || n.args.length % 2 === 0) return null;
    const rows = [];
    for (let i = 0; i + 1 < n.args.length; i += 2) {
      const g = parseRowGroup(n.args[i]);
      if (!g || !isVal(n.args[i + 1])) return null;
      rows.push({ g, value: n.args[i + 1].value });
    }
    const d = n.args[n.args.length - 1];
    return isVal(d) ? { rows, def: d.value } : null;
  }
  const parse = (expr, valueType) => (valueType === 'bool' ? parseGroup(expr, 1) : parseSelect(expr));

  // ---- 빌더 -----------------------------------------------------------------
  // opts: { tags(전체 태그), selfId(편집 중인 태그 — 자기 자신은 고를 수 없음), valueType, expr(없으면 새 식), onChange() }
  function mount(root, opts) {
    const tags = opts.tags.filter((t) => t.id !== opts.selfId);
    const byId = new Map(tags.map((t) => [t.id, t]));
    const devKey = (t) => (RAW.isCalc(t) ? CALC : t.source && t.source.deviceId != null ? String(t.source.deviceId) : NONE);
    const groups = (() => {
      const m = new Map();
      for (const t of tags) {
        const k = devKey(t);
        if (!m.has(k)) m.set(k, { key: k, name: k === CALC ? '로직' : (t.source && (t.source.deviceDisplayName || t.source.deviceCode)) || '(장비 없음)', tags: [] });
        m.get(k).tags.push(t);
      }
      const rank = (g) => (g.key === NONE ? 2 : g.key === CALC ? 1 : 0);
      return [...m.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ko'));
    })();
    const firstTag = () => (groups[0] && groups[0].tags[0] ? groups[0].tags[0].id : '');
    // 새 조건의 기본 비교 — 로직 태그(참/거짓)는 "참일 때", 나머지는 "같음 1"
    const newCond = (tagId = firstTag()) => {
      const t = byId.get(tagId);
      return t && RAW.isCalc(t) && t.source && t.source.valueType === 'bool' ? { tag: tagId, test: 'true' } : { tag: tagId, test: 'eq', value: 1 };
    };

    const one = (c) => ({ mode: 'and', not: false, items: [c] });
    let valueType = opts.valueType || 'bool';
    let model = opts.expr ? parse(opts.expr, valueType) : null;
    const readonly = !!opts.expr && !model;   // 빌더로 나타낼 수 없는 식
    const fresh = () => (valueType === 'bool'
      ? { mode: 'and', not: false, items: [newCond()] }
      : { rows: [{ g: one(newCond()), value: valueType === 'number' ? 1 : '' }], def: valueType === 'number' ? 0 : '' });
    if (!model && !readonly) model = fresh();

    // 경로("1.0")로 조건·묶음 찾기 — 묶음: items의 번호. 선택형은 첫 번호가 줄(rows), 그다음이 줄 안의 조건
    const at = (path) => {
      const p = String(path).split('.').filter((x) => x !== '');
      let n = valueType === 'bool' ? model : model.rows[Number(p.shift())].g;
      for (const i of p) n = n.items[Number(i)];
      return n;
    };
    const parentOf = (path) => { const p = String(path).split('.'); const i = Number(p.pop()); return { g: at(p.join('.')), i }; };

    const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
    const X = (attr, title) => `<button type="button" class="cb-x" ${attr} title="${title}">×</button>`;
    // 조건 한 줄 — 칸 폭은 모든 줄이 같다(장비 · 태그 · 비교 · 값 · [tail] · 지우기). 값이 없는 비교도 빈 칸을 둔다.
    //  tail: 숫자·글자 형식에서 "→ 결과 값" 칸. 비트 비교면 아래에 0~15 칸(같은 폭 16칸)이 한 줄 더 붙는다
    const condHtml = (c, path, rm, tail = '', attrs = '') => {
      const t = byId.get(c.tag);
      const dk = t ? devKey(t) : (groups[0] ? groups[0].key : '');
      const g = groups.find((x) => x.key === dk) || { tags: [] };
      const missing = c.tag && !t ? opt(c.tag, `${c.tag} (없는 태그)`, c.tag) : '';
      const val = CMP.includes(c.test) ? `<input data-cv value="${esc(fmtValue(c.value))}" placeholder="값" spellcheck="false">`
        : c.test === 'range' ? `<span class="cb-range"><input data-cmin value="${esc(fmtValue(c.min))}" placeholder="최소" inputmode="decimal"><i>~</i><input data-cmax value="${esc(fmtValue(c.max))}" placeholder="최대" inputmode="decimal"></span>`
        : '<span class="cb-nov"></span>';
      const on = R.bitList(c.bits);
      const bits = isBit(c.test)
        ? `<span class="cb-bitlabel">비트</span><div class="cb-bits">${Array.from({ length: 16 }, (_, i) => `<button type="button" data-cbit="${i}" class="${on.includes(i) ? 'on' : ''}">${i}</button>`).join('')}</div>` : '';
      return `<div class="cb-row${tail ? ' cb-srow' : ''}${t || !c.tag ? '' : ' bad'}" data-path="${esc(path)}"${attrs}>
        <select data-cdev title="장비">${groups.map((x) => opt(x.key, x.name, dk)).join('')}</select>
        <select data-ct title="태그">${missing}${g.tags.map((x) => opt(x.id, x.name ? `${x.id} — ${x.name}` : x.id, c.tag)).join('')}</select>
        <select data-ctest title="비교">${TESTS.map(([v, l]) => opt(v, l, c.test)).join('')}</select>
        ${val}${tail}${rm || '<span></span>'}${bits}
      </div>`;
    };
    const colHead = (sel) => `<div class="cb-row cb-colhead${sel ? ' cb-srow' : ''}"><span>장비</span><span>태그</span><span>비교</span><span>값</span>${sel ? '<span></span><span>결과 값</span>' : ''}<span></span></div>`;
    // 묶음 방식(그리고 / 또는) — 라디오. 묶음마다 이름이 달라야 서로 영향을 주지 않는다
    const seg = (g, path) => `<span class="cb-modes">${[['and', '모두 만족 (그리고)'], ['or', '하나라도 만족 (또는)']].map(([v, l]) =>
      `<label><input type="radio" name="cbm-${esc(path || 'root')}" data-gmr value="${v}"${g.mode === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</span>`;
    const groupHtml = (g, path, depth) => `<div class="cb-group${depth > 1 ? ' cb-inner' : ''}" data-gpath="${esc(path)}">
      <div class="cb-ghead">${seg(g, path)}
        ${depth > 1 ? `<label class="cb-not"><input type="checkbox" data-gnot${g.not ? ' checked' : ''}> 반대로(아님)</label>${X('data-grm', '묶음 지우기')}` : ''}</div>
      ${depth === 1 ? colHead(false) : ''}
      ${g.items.map((it, i) => { const p = path === '' ? String(i) : `${path}.${i}`; return it.items ? groupHtml(it, p, depth + 1) : condHtml(it, p, g.items.length > 1 || depth > 1 ? X('data-crm', '조건 지우기') : ''); }).join('')}
      <div class="cb-add"><button type="button" data-gadd="cond">+ 조건</button>${depth < MAX_DEPTH ? '<button type="button" data-gadd="group">+ 묶음</button>' : ''}</div>
    </div>`;
    // 선택형 한 줄 — 조건이 하나면 한 줄 그대로, 여럿이면 묶음 방식(그리고/또는)이 위에 붙는다. 결과 값은 첫 조건 줄에
    const ruleHtml = (r, i, rowRm) => {
      const multi = r.g.items.length > 1;
      const plus = '<button type="button" class="cb-x cb-plus" data-cadd title="이 줄에 조건 추가">+</button>';
      const result = `<span class="cb-arrow">→</span><input data-rv value="${esc(fmtValue(r.value))}" placeholder="결과 값" spellcheck="false">`;
      return `<div class="cb-rule${multi ? ' multi' : ''}" data-row="${i}" data-gpath="${i}">
        ${multi ? `<div class="cb-rhead">${seg(r.g, String(i))}${rowRm}</div>` : ''}
        ${r.g.items.map((c, j) => condHtml(c, `${i}.${j}`,
          `<span class="cb-acts">${j === 0 ? plus : ''}${multi ? X('data-crm', '조건 지우기') : rowRm}</span>`,
          j === 0 ? result : '<span></span><span></span>')).join('')}
      </div>`;
    };
    const selectHtml = (m) => `<div class="cb-group">
      ${colHead(true)}
      ${m.rows.map((r, i) => ruleHtml(r, i, m.rows.length > 1 ? X('data-rrm', '줄 지우기') : '')).join('')}
      <div class="cb-row cb-srow cb-defrow"><span class="cb-deflabel">위 조건에 모두 맞지 않으면</span><span class="cb-arrow">→</span><input data-rdef value="${esc(fmtValue(m.def))}" placeholder="결과 값" spellcheck="false"><span></span></div>
      <div class="cb-add"><button type="button" data-radd>+ 줄</button></div>
    </div>`;

    const render = () => {
      root.innerHTML = readonly
        ? `<div class="cb-ro">이 식은 조건 빌더로 편집할 수 없는 모양입니다. 내용은 그대로 유지됩니다.<code>${esc(R.exprText(opts.expr))}</code></div>`
        : `<div class="cb-sec">규칙 <small>${valueType === 'bool' ? '참이 되는 조건' : '위에서부터 처음 맞는 줄의 결과 값'}</small></div>`
          + (valueType === 'bool' ? groupHtml(model, '', 1) : selectHtml(model));
    };
    const changed = (redraw) => { if (redraw) render(); if (opts.onChange) opts.onChange(); };
    const val = (s) => (valueType === 'number' ? (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : s) : valueType === 'string' ? s : parseValue(s));

    root.addEventListener('change', (e) => {
      if (readonly) return;
      const t = e.target, row = t.closest('[data-path]');
      if (t.dataset.gmr !== undefined) { at(t.closest('[data-gpath]').dataset.gpath).mode = t.value; return changed(false); }
      if (t.dataset.gnot !== undefined) { at(t.closest('[data-gpath]').dataset.gpath).not = t.checked; return changed(false); }
      if (!row) return;
      const c = at(row.dataset.path);
      if (t.dataset.cdev !== undefined) {           // 장비를 바꾸면 그 장비의 첫 태그로
        const g = groups.find((x) => x.key === t.value);
        Object.assign(c, newCond(g && g.tags[0] ? g.tags[0].id : ''), { tag: g && g.tags[0] ? g.tags[0].id : '' });
        for (const k of ['min', 'max', 'bits']) delete c[k];
        return changed(true);
      }
      if (t.dataset.ct !== undefined) { c.tag = t.value; return changed(true); }
      if (t.dataset.ctest !== undefined) {
        const prev = c.test, pv = c.value; c.test = t.value;
        for (const k of ['value', 'min', 'max', 'bits']) delete c[k];
        if (CMP.includes(c.test)) c.value = CMP.includes(prev) && pv !== undefined ? pv : 1;   // 비교끼리 바꾸면 값 유지
        if (isBit(c.test)) c.bits = [];
        return changed(true);
      }
    });
    root.addEventListener('input', (e) => {
      if (readonly) return;
      const t = e.target, row = t.closest('[data-path]');
      if (t.dataset.rv !== undefined) { model.rows[Number(t.closest('[data-row]').dataset.row)].value = val(t.value); return changed(false); }
      if (t.dataset.rdef !== undefined) { model.def = val(t.value); return changed(false); }
      if (!row) return;
      const c = at(row.dataset.path);
      const numOr = (s) => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined);
      if (t.dataset.cv !== undefined) c.value = parseValue(t.value.trim());
      else if (t.dataset.cmin !== undefined) c.min = numOr(t.value);
      else if (t.dataset.cmax !== undefined) c.max = numOr(t.value);
      else return;
      changed(false);
    });
    root.addEventListener('click', (e) => {
      if (readonly) return;
      const b = e.target.closest('button');
      if (!b) return;
      const row = b.closest('[data-path]');
      if (b.dataset.cadd !== undefined) { at(b.closest('[data-row]').dataset.row).items.push(newCond()); return changed(true); }
      if (b.dataset.cbit !== undefined && row) {
        const c = at(row.dataset.path), n = Number(b.dataset.cbit), bits = R.bitList(c.bits);
        c.bits = (bits.includes(n) ? bits.filter((x) => x !== n) : bits.concat(n)).sort((x, y) => x - y);
        return changed(true);
      }
      if (b.dataset.crm !== undefined && row) {
        const { g, i } = parentOf(row.dataset.path);
        g.items.splice(i, 1);
        return changed(true);
      }
      if (b.dataset.grm !== undefined) { const { g, i } = parentOf(b.closest('[data-gpath]').dataset.gpath); g.items.splice(i, 1); if (!g.items.length) g.items.push(newCond()); return changed(true); }
      if (b.dataset.gadd) {
        const g = at(b.closest('[data-gpath]').dataset.gpath);
        g.items.push(b.dataset.gadd === 'group' ? { mode: g.mode === 'and' ? 'or' : 'and', not: false, items: [newCond()] } : newCond());
        return changed(true);
      }
      if (b.dataset.radd !== undefined) { model.rows.push({ g: one(newCond()), value: valueType === 'number' ? model.rows.length + 1 : '' }); return changed(true); }
      if (b.dataset.rrm !== undefined) { model.rows.splice(Number(b.closest('[data-row]').dataset.row), 1); return changed(true); }
    });
    render();

    // 저장 전 검사 — 문제 문구 또는 null. 서버도 검증하지만(422) 흔한 실수는 여기서 먼저
    const condError = (c) => (!c.tag ? '태그를 고르지 않은 조건이 있습니다.'
      : !byId.has(c.tag) ? `없는 태그 "${c.tag}"를 쓰는 조건이 있습니다.`
      : isBit(c.test) && !R.bitList(c.bits).length ? `${c.tag}: 비트를 하나 이상 고르세요.`
      : CMP.includes(c.test) && (c.value === '' || c.value === undefined) ? `${c.tag}: 비교할 값을 입력하세요.`
      : c.test === 'range' && c.min === undefined && c.max === undefined ? `${c.tag}: 범위의 최소·최대 중 하나는 입력하세요.` : null);
    const groupError = (g) => { for (const i of g.items) { const e = i.items ? groupError(i) : condError(i); if (e) return e; } return g.items.length ? null : '조건이 없는 묶음이 있습니다.'; };

    return {
      readonly,
      getExpr: () => (readonly ? opts.expr : valueType === 'bool' ? groupAst(model) : selectAst(model)),
      validate() {
        if (readonly) return null;
        if (valueType === 'bool') return groupError(model);
        for (const r of model.rows) {
          const e = groupError(r.g);
          if (e) return e;
          if (valueType === 'number' && typeof r.value !== 'number') return '숫자 형식의 줄 값은 숫자로 입력하세요.';
        }
        return valueType === 'number' && typeof model.def !== 'number' ? '"그 외에는" 값을 숫자로 입력하세요.' : null;
      },
      // 값 형식을 바꾸면 규칙을 새로 시작(참/거짓 ↔ 숫자·글자는 모양이 다름). 숫자 ↔ 글자는 줄을 유지
      setValueType(vt) {
        if (readonly || vt === valueType) return;
        const keep = valueType !== 'bool' && vt !== 'bool';
        valueType = vt;
        if (!keep) model = fresh();
        else { for (const r of model.rows) r.value = val(fmtValue(r.value)); model.def = val(fmtValue(model.def)); }
        render();
      },
    };
  }

  window.WHMI.ExprBuilder = { mount, parse };
})();
