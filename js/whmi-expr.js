// HMI 로직 태그의 조건 빌더 — 태그 관리 폼(whmi-tags.js)이 쓴다. 디자인 모드에서만 로드된다.
// 설계: docs/architecture/hmi.md §5.3(식 AST), §7.3. 계산은 백엔드가 한다(미리보기도 POST /api/hmi/eval).
//
// 편집 모형(화면용) ↔ AST(저장용)
//   조건     { tag, test, value | rtag | min,max | bits }   test: true·false(참/거짓일 때) + 비교 + 범위 + 비트
//            rtag: 값 대신 다른 태그와 비교(같음·다름·크기 비교 6종에만)
//   묶음     { mode: 'and'|'or', not, items: [조건 | 묶음] }   묶음 안의 묶음까지(2단)
//   참/거짓  = 묶음 하나
//   숫자(계산) = { calc: 연산, args: [{ tag } | { value: 숫자 }] }   연산 하나 + 값 목록(산술·집계, 단계 C-2)
//   숫자·글자 = { rows: [{ g, value }], def }          위에서부터 처음 맞는 줄의 값(select). g = 줄의 조건 묶음(1단, 조건만)
// 빌더로 나타낼 수 없는 식(연산 안의 연산, 3단 이상 묶음 등)은 parse가 null — 폼은 글자로만 보여 주고 그대로 둔다.
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
  // 산술·집계 연산: [이름, 표시, 값 최소 개수, 최대 개수]
  const ARITH = [['add', '더하기 ( + )', 2, 16], ['sub', '빼기 ( − )', 2, 2], ['mul', '곱하기 ( × )', 2, 16], ['div', '나누기 ( ÷ )', 2, 2],
    ['min', '최소', 2, 16], ['max', '최대', 2, 16], ['avg', '평균', 2, 16], ['abs', '절댓값', 1, 1]];
  const arith = (op) => ARITH.find((x) => x[0] === op);
  const CALC = 'calc', PARAM = 'param', NONE = 'none';

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
    return { op: c.test, args: [t, c.rtag !== undefined ? { tag: c.rtag } : V(c.value)] };
  }
  function groupAst(g) {
    const args = g.items.map((i) => (i.items ? groupAst(i) : condAst(i)));
    const body = args.length === 1 ? args[0] : { op: g.mode, args };
    return g.not ? { op: 'not', args: [body] } : body;
  }
  const calcAst = (m) => ({ op: m.calc, args: m.args.map((a) => (a.tag !== undefined ? { tag: a.tag } : V(a.value))) });
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
    if (CMP.includes(n.op) && n.args.length === 2 && isTag(b)) return { tag: String(a.tag), test: n.op, rtag: String(b.tag) };
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
  // 계산 — 연산 하나에 태그·숫자만(연산 안의 연산은 빌더로 못 만든다 → null)
  function parseCalc(n) {
    const def = n && arith(n.op);
    if (!def || !Array.isArray(n.args) || n.args.length < def[2] || n.args.length > def[3]) return null;
    const args = n.args.map((x) => (isTag(x) ? { tag: String(x.tag) } : isVal(x) && typeof x.value === 'number' ? { value: x.value } : null));
    return args.every(Boolean) ? { calc: n.op, args } : null;
  }
  const parse = (expr, valueType) => (valueType === 'bool' ? parseGroup(expr, 1) : parseSelect(expr) || (valueType === 'number' ? parseCalc(expr) : null));

  // ---- 빌더 -----------------------------------------------------------------
  // opts: { tags(전체 태그), selfId(편집 중인 태그 — 자기 자신은 고를 수 없음), valueType, expr(없으면 새 식), onChange() }
  function mount(root, opts) {
    const tags = opts.tags.filter((t) => t.id !== opts.selfId);
    const byId = new Map(tags.map((t) => [t.id, t]));
    const devKey = (t) => (t.kind === 'param' ? PARAM : RAW.isCalc(t) ? CALC : t.source && t.source.deviceId != null ? String(t.source.deviceId) : NONE);
    const groups = (() => {
      const m = new Map();
      for (const t of tags) {
        const k = devKey(t);
        if (!m.has(k)) m.set(k, { key: k, name: k === CALC ? '로직' : k === PARAM ? '설정값' : (t.source && (t.source.deviceDisplayName || t.source.deviceCode)) || '(장비 없음)', tags: [] });
        m.get(k).tags.push(t);
      }
      const rank = (g) => (g.key === NONE ? 3 : g.key === CALC ? 2 : g.key === PARAM ? 1 : 0);
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
    const freshCalc = () => ({ calc: 'sub', args: [{ tag: firstTag() }, { tag: firstTag() }] });
    let stash = null;   // 규칙 종류(조건 → 값 / 계산)를 오갈 때 반대쪽 내용을 잠시 보관

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
    // 다른 태그와 비교할 때 조건 줄 아래에 붙는 "비교 태그" 줄(장비 · 태그)
    const rtagHtml = (c, on) => {
      if (!on) return '';
      const t = byId.get(c.rtag);
      const dk = t ? devKey(t) : (groups[0] ? groups[0].key : '');
      const g = groups.find((x) => x.key === dk) || { tags: [] };
      const missing = c.rtag && !t ? opt(c.rtag, `${c.rtag} (없는 태그)`, c.rtag) : '';
      return `<span class="cb-bitlabel">비교 태그</span><div class="cb-rtag${t || !c.rtag ? '' : ' bad'}">
        <select data-rdev title="장비">${groups.map((x) => opt(x.key, x.name, dk)).join('')}</select>
        <select data-rt title="비교할 태그">${missing}${g.tags.map((x) => opt(x.id, x.name ? `${x.id} — ${x.name}` : x.id, c.rtag)).join('')}</select></div>`;
    };
    const condHtml = (c, path, rm, tail = '', attrs = '') => {
      const t = byId.get(c.tag);
      const dk = t ? devKey(t) : (groups[0] ? groups[0].key : '');
      const g = groups.find((x) => x.key === dk) || { tags: [] };
      const missing = c.tag && !t ? opt(c.tag, `${c.tag} (없는 태그)`, c.tag) : '';
      const withTag = CMP.includes(c.test) && c.rtag !== undefined;
      // 비교 6종의 값 칸: 직접 입력한 값, 또는 [태그] 단추로 바꾸면 아래 줄에서 고르는 다른 태그
      const val = withTag ? '<span class="cb-vcell"><button type="button" class="cb-vk on" data-vkind title="직접 입력한 값과 비교로 되돌리기">태그와 비교 ×</button></span>'
        : CMP.includes(c.test) ? `<span class="cb-vcell"><input data-cv value="${esc(fmtValue(c.value))}" placeholder="값" spellcheck="false"><button type="button" class="cb-vk" data-vkind title="값 대신 다른 태그와 비교">태그</button></span>`
        : c.test === 'range' ? `<span class="cb-range"><input data-cmin value="${esc(fmtValue(c.min))}" placeholder="최소" inputmode="decimal"><i>~</i><input data-cmax value="${esc(fmtValue(c.max))}" placeholder="최대" inputmode="decimal"></span>`
        : '<span class="cb-nov"></span>';
      const on = R.bitList(c.bits);
      const bits = isBit(c.test)
        ? `<span class="cb-bitlabel">비트</span><div class="cb-bits">${Array.from({ length: 16 }, (_, i) => `<button type="button" data-cbit="${i}" class="${on.includes(i) ? 'on' : ''}">${i}</button>`).join('')}</div>` : '';
      return `<div class="cb-row${tail ? ' cb-srow' : ''}${t || !c.tag ? '' : ' bad'}" data-path="${esc(path)}"${attrs}>
        <select data-cdev title="장비">${groups.map((x) => opt(x.key, x.name, dk)).join('')}</select>
        <select data-ct title="태그">${missing}${g.tags.map((x) => opt(x.id, x.name ? `${x.id} — ${x.name}` : x.id, c.tag)).join('')}</select>
        <select data-ctest title="비교">${TESTS.map(([v, l]) => opt(v, l, c.test)).join('')}</select>
        ${val}${tail}${rm || '<span></span>'}${bits}${rtagHtml(c, withTag)}
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

    // 계산 — 연산 하나 + 값 목록(태그 또는 숫자)
    const calcHtml = (m) => {
      const def = arith(m.calc);
      const row = (a, i) => {
        const isTagArg = a.tag !== undefined, t = byId.get(a.tag);
        const dk = t ? devKey(t) : (groups[0] ? groups[0].key : '');
        const g = groups.find((x) => x.key === dk) || { tags: [] };
        const missing = isTagArg && a.tag && !t ? opt(a.tag, `${a.tag} (없는 태그)`, a.tag) : '';
        return `<div class="cb-row cb-arow${isTagArg && a.tag && !t ? ' bad' : ''}" data-arg="${i}">
          <select data-akind title="종류">${opt('tag', '태그', isTagArg ? 'tag' : 'num')}${opt('num', '숫자', isTagArg ? 'tag' : 'num')}</select>
          ${isTagArg ? `<select data-adev title="장비">${groups.map((x) => opt(x.key, x.name, dk)).join('')}</select>
            <select data-atag title="태그">${missing}${g.tags.map((x) => opt(x.id, x.name ? `${x.id} — ${x.name}` : x.id, a.tag)).join('')}</select>`
            : `<input data-anum value="${esc(fmtValue(a.value))}" placeholder="숫자" inputmode="decimal" spellcheck="false">`}
          ${m.args.length > def[2] ? X('data-arm', '값 지우기') : '<span></span>'}
        </div>`;
      };
      return `<div class="cb-group">
        <div class="cb-calc-op"><span>연산</span><select data-kop>${ARITH.map(([v, l]) => opt(v, l, m.calc)).join('')}</select>
          <small>${def[3] === 1 ? '값 1개' : def[3] === 2 ? '값 2개 — 위에서 아래 순서로 계산' : '값 2개 이상'}</small></div>
        <div class="cb-row cb-arow cb-colhead"><span>종류</span><span>장비</span><span>태그 / 숫자</span><span></span></div>
        ${m.args.map(row).join('')}
        ${m.args.length < def[3] ? '<div class="cb-add"><button type="button" data-aadd>+ 값</button></div>' : ''}
      </div>`;
    };
    const kindHtml = () => (valueType !== 'number' ? '' : `<div class="cb-kind cb-modes">${[['select', '조건 → 값'], ['calc', '계산 (더하기·평균 등)']].map(([v, l]) =>
      `<label><input type="radio" name="cb-kind" data-kind value="${v}"${(model.calc ? 'calc' : 'select') === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>`);

    const render = () => {
      root.innerHTML = readonly
        ? `<div class="cb-ro">이 식은 조건 빌더로 편집할 수 없는 모양입니다. 내용은 그대로 유지됩니다.<code>${esc(R.exprText(opts.expr))}</code></div>`
        : `<div class="cb-sec">규칙 <small>${valueType === 'bool' ? '참이 되는 조건' : model.calc ? '값들을 계산한 결과' : '위에서부터 처음 맞는 줄의 결과 값'}</small></div>`
          + kindHtml() + (valueType === 'bool' ? groupHtml(model, '', 1) : model.calc ? calcHtml(model) : selectHtml(model));
    };
    const changed = (redraw) => { if (redraw) render(); if (opts.onChange) opts.onChange(); };
    const val = (s) => (valueType === 'number' ? (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : s) : valueType === 'string' ? s : parseValue(s));

    root.addEventListener('change', (e) => {
      if (readonly) return;
      const t = e.target, row = t.closest('[data-path]');
      if (t.dataset.kind !== undefined) {           // 규칙 종류: 조건 → 값 / 계산
        const next = stash || (t.value === 'calc' ? freshCalc() : fresh());
        stash = model; model = next;
        return changed(true);
      }
      if (t.dataset.kop !== undefined) {            // 연산을 바꾸면 값 개수를 그 연산에 맞춘다
        const def = arith(t.value);
        model.calc = t.value;
        model.args = model.args.slice(0, def[3]);
        while (model.args.length < def[2]) model.args.push({ tag: firstTag() });
        return changed(true);
      }
      const arow = t.closest('[data-arg]');
      if (arow && model.calc) {
        const i = Number(arow.dataset.arg);
        if (t.dataset.akind !== undefined) model.args[i] = t.value === 'num' ? { value: 0 } : { tag: firstTag() };
        else if (t.dataset.adev !== undefined) { const g = groups.find((x) => x.key === t.value); model.args[i] = { tag: g && g.tags[0] ? g.tags[0].id : '' }; }
        else if (t.dataset.atag !== undefined) model.args[i] = { tag: t.value };
        else return;
        return changed(true);
      }
      if (t.dataset.gmr !== undefined) { at(t.closest('[data-gpath]').dataset.gpath).mode = t.value; return changed(false); }
      if (t.dataset.gnot !== undefined) { at(t.closest('[data-gpath]').dataset.gpath).not = t.checked; return changed(false); }
      if (!row) return;
      const c = at(row.dataset.path);
      if (t.dataset.cdev !== undefined) {           // 장비를 바꾸면 그 장비의 첫 태그로
        const g = groups.find((x) => x.key === t.value);
        Object.assign(c, newCond(g && g.tags[0] ? g.tags[0].id : ''), { tag: g && g.tags[0] ? g.tags[0].id : '' });
        for (const k of ['min', 'max', 'bits', 'rtag']) delete c[k];
        return changed(true);
      }
      if (t.dataset.ct !== undefined) { c.tag = t.value; return changed(true); }
      if (t.dataset.rdev !== undefined) { const g = groups.find((x) => x.key === t.value); c.rtag = g && g.tags[0] ? g.tags[0].id : ''; return changed(true); }
      if (t.dataset.rt !== undefined) { c.rtag = t.value; return changed(true); }
      if (t.dataset.ctest !== undefined) {
        const prev = c.test, pv = c.value, pr = c.rtag; c.test = t.value;
        for (const k of ['value', 'min', 'max', 'bits', 'rtag']) delete c[k];
        if (CMP.includes(c.test)) {                 // 비교끼리 바꾸면 값(또는 비교 태그) 유지
          if (CMP.includes(prev) && pr !== undefined) c.rtag = pr;
          else c.value = CMP.includes(prev) && pv !== undefined ? pv : 1;
        }
        if (isBit(c.test)) c.bits = [];
        return changed(true);
      }
    });
    root.addEventListener('input', (e) => {
      if (readonly) return;
      const t = e.target, row = t.closest('[data-path]');
      if (t.dataset.anum !== undefined && model.calc) {
        const s = t.value.trim();
        model.args[Number(t.closest('[data-arg]').dataset.arg)].value = s !== '' && Number.isFinite(Number(s)) ? Number(s) : s;
        return changed(false);
      }
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
      if (b.dataset.aadd !== undefined && model.calc) { model.args.push({ tag: firstTag() }); return changed(true); }
      if (b.dataset.arm !== undefined && model.calc) { model.args.splice(Number(b.closest('[data-arg]').dataset.arg), 1); return changed(true); }
      if (b.dataset.cadd !== undefined) { at(b.closest('[data-row]').dataset.row).items.push(newCond()); return changed(true); }
      if (b.dataset.vkind !== undefined && row) {   // 값 ↔ 다른 태그
        const c = at(row.dataset.path);
        if (c.rtag !== undefined) { delete c.rtag; c.value = 1; }
        else { delete c.value; c.rtag = (tags.find((x) => x.id !== c.tag && devKey(x) === (byId.get(c.tag) ? devKey(byId.get(c.tag)) : '')) || tags.find((x) => x.id !== c.tag) || { id: '' }).id; }
        return changed(true);
      }
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
      : CMP.includes(c.test) && c.rtag !== undefined ? (!c.rtag ? `${c.tag}: 비교할 태그를 고르세요.` : !byId.has(c.rtag) ? `없는 태그 "${c.rtag}"와 비교하는 조건이 있습니다.` : null)
      : CMP.includes(c.test) && (c.value === '' || c.value === undefined) ? `${c.tag}: 비교할 값을 입력하세요.`
      : c.test === 'range' && c.min === undefined && c.max === undefined ? `${c.tag}: 범위의 최소·최대 중 하나는 입력하세요.` : null);
    const groupError = (g) => { for (const i of g.items) { const e = i.items ? groupError(i) : condError(i); if (e) return e; } return g.items.length ? null : '조건이 없는 묶음이 있습니다.'; };

    return {
      readonly,
      getExpr: () => (readonly ? opts.expr : valueType === 'bool' ? groupAst(model) : model.calc ? calcAst(model) : selectAst(model)),
      validate() {
        if (readonly) return null;
        if (valueType === 'bool') return groupError(model);
        if (model.calc) {
          for (const a of model.args) {
            if (a.tag !== undefined) { if (!a.tag) return '태그를 고르지 않은 값이 있습니다.'; if (!byId.has(a.tag)) return `없는 태그 "${a.tag}"를 쓰는 값이 있습니다.`; }
            else if (typeof a.value !== 'number') return '계산에 쓰는 값은 숫자로 입력하세요.';
          }
          return null;
        }
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
        const keep = valueType !== 'bool' && vt !== 'bool' && !model.calc;   // 계산은 숫자 형식에만 있다
        valueType = vt;
        stash = null;
        if (!keep) model = fresh();
        else { for (const r of model.rows) r.value = val(fmtValue(r.value)); model.def = val(fmtValue(model.def)); }
        render();
      },
    };
  }

  window.WHMI.ExprBuilder = { mount, parse };
})();
