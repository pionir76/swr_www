// HMI 태그 관리(디자인 모드 [태그 관리] 대화상자) — 편집기와 함께 지연 로드된다.
// HMI 태그 = 레지스터 하나를 소스로 연결한 HMI 전용 이름(referencs/api-spec.md §14).
// 단위·최소/최대·소수점·읽기쓰기는 태그에서 덮어쓸 수 있고, 비우면(null) 레지스터 값을 물려받는다.
//
// 구성: loadAll(데이터 읽기) → open(대화상자: 태그 목록). [점검]을 누르면 데이터를 새로 읽고
//       checkTags/checkScreens(점검 규칙)를 단계별로 실행해 결과(● 표시, 화면 점검 탭)를 보여준다.
//       행을 누르거나 [+ 새 태그]를 누르면 같은 자리에 편집 폼(formHtml)이 열린다.
//       태그 변경은 바로 서버에 반영되고(실행 취소 없음, 삭제만 확인), 저장·삭제 후 자동으로 점검한다.
(function () {
  'use strict';

  if (!window.WHMI) return;   // HMI 페이지를 떠나며 정리된 뒤 늦게 도착한 스크립트(이전 페이지 것)
  const { esc } = window.WHMI;

  // 레지스터 min/max는 "제한 없음"을 아주 큰 수로 내려주는 경우가 있다
  const hasLimit = (v) => v != null && Number.isFinite(v) && Math.abs(v) < 1e15;
  const decimalsFromScale = (scale) => (scale > 0 ? Math.max(0, -Math.round(Math.log10(scale))) : 0);

  const LEVELS = [['error', '오류'], ['warn', '경고'], ['info', '정보']];
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const CHECK_STEP_MS = 350;
  // 레지스터 설정 화면과 같은 선택 목록(pages/registers.html rfUnit). 태그는 빈 값이 "레지스터 상속"이라
  // (서버가 ""를 null로 저장) "없음"은 고를 수 없다.
  const UNIT_OPTIONS = [['°F', '°F (화씨)'], ['°C', '°C (섭씨)'], ['%', '%'], ['Pa', 'Pa'], ['kPa', 'kPa'], ['%RH', '%RH'],
    ['mV', 'mV'], ['V', 'V'], ['Ω', 'Ω'], ['mmHg', 'mmHg'], ['kgf', 'kgf']];
  const DECIMAL_OPTIONS = [[0, '0 (정수)'], [1, '1 (0.0)'], [2, '2 (0.00)'], [3, '3 (0.000)']];
  const accessLabel = (a) => (a === 'rw' ? 'WRITE' : 'READ');
  // 사용처의 용도 표시용 위젯 이름(편집기 위젯 목록과 같은 이름)
  const TYPE_NAME = {
    label: '텍스트', rect: '사각형', numeric: '숫자 표시', input: '숫자 입력', lamp: '램프', bar: '바 게이지',
    gauge: '원형 게이지', tank: '탱크', button: '버튼', switch: '스위치', selector: '셀렉터', screenlink: '화면 이동',
  };   // 점검 단계마다 최소 표시 시간(실제 작업은 수 ms — 진행이 보이도록 약간의 연출)
  const WRITE_TYPES = ['button', 'switch', 'input', 'selector'];
  const STATIC_TYPES = ['rect', 'label', 'screenlink'];

  async function getJson(path) {
    const res = await apiFetch(path);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  // ---- 데이터 ---------------------------------------------------------------
  // 태그·장비·레지스터·현재 값·화면 내용을 한 번에 읽는다(대화상자를 열 때마다 새로).
  // 편집 중인 화면은 저장 전 내용(editor.doc)을 쓴다.
  async function loadAll(editor) {
    const [tagData, devData, valData] = await Promise.all([
      getJson('/api/hmi/tags'),
      getJson('/api/devices'),
      getJson('/api/hmi/values').catch(() => ({ values: {} })),
    ]);
    const devices = devData.devices || [];
    const regLists = await Promise.all(devices.map((d) => getJson(`/api/devices/${d.id}/registers`).catch(() => ({ registers: [] }))));
    const regs = new Map();   // registerId → { reg, dev }
    regLists.forEach((rl, i) => (rl.registers || []).forEach((r) => regs.set(r.id, { reg: r, dev: devices[i] })));

    const screenRefs = editor.project.screens || [];
    const contents = await Promise.all(screenRefs.map((s) => (s.id === editor.screenId && editor.doc
      ? Promise.resolve(editor.doc)
      : getJson(`/api/hmi/screens/${encodeURIComponent(s.id)}`).then((d) => d.content).catch(() => null))));
    const screens = screenRefs.map((s, i) => ({ id: s.id, title: s.title || s.id, content: contents[i] })).filter((s) => s.content);

    // 사용처: tagId → { screens: Set(제목), widgets: n }
    const usage = new Map();
    for (const s of screens) {
      for (const w of s.content.widgets || []) {
        for (const id of [w.tag, w.enableWhen && w.enableWhen.tag]) {
          if (!id) continue;
          const u = usage.get(id) || { screens: new Set(), widgets: 0 };
          u.screens.add(s.title);
          u.widgets++;
          usage.set(id, u);
        }
      }
    }
    const tags = (tagData.tags || []).sort((a, b) => a.id.localeCompare(b.id));
    return { tags, regs, values: valData.values || {}, usage, screens, projectScreens: new Set(screenRefs.map((s) => s.id)) };
  }

  // 태그가 실제로 쓰는 값(태그에서 덮어쓴 값, 없으면 레지스터 값)
  function effective(t, reg) {
    return {
      unit: t.unit ?? (reg ? reg.unit || null : null),
      min: t.min ?? (reg && hasLimit(reg.minValue) ? reg.minValue : null),
      max: t.max ?? (reg && hasLimit(reg.maxValue) ? reg.maxValue : null),
      access: t.access ?? (reg ? (reg.readOnly ? 'r' : 'rw') : null),
    };
  }

  // ---- 점검 규칙 -------------------------------------------------------------
  // 규칙 하나 = [등급, 판정 함수]. 판정 함수가 문구를 돌려주면 문제, 아니면 null.
  // 새 점검이 필요하면 아래 목록에 한 줄 추가하면 된다.

  // 태그 규칙: (t 태그, src {reg, dev} | undefined, ctx { e 실제 값, v 현재 값, data })
  const TAG_RULES = [
    ['error', (t, src) => (!src ? `소스 레지스터(#${t.source && t.source.registerId})가 없습니다` : null)],
    ['error', (t, src, { e }) => (e.min != null && e.max != null && e.min >= e.max ? `최소값(${e.min})이 최대값(${e.max})보다 작지 않습니다` : null)],
    ['warn', (t, src) => (src && t.unit && t.unit !== (src.reg.unit || '')
      ? `태그 단위 '${t.unit}'와 레지스터 단위 '${src.reg.unit || '없음'}'가 다릅니다 — 레지스터 연결을 확인하세요` : null)],
    ['warn', (t, src, { e, v }) => (v && typeof v.v === 'number' && ((e.min != null && v.v < e.min) || (e.max != null && v.v > e.max))
      ? `현재 값 ${v.v}이(가) 범위(${e.min ?? '—'} ~ ${e.max ?? '—'}) 밖입니다` : null)],
    ['warn', (t, src, { v }) => (src && v && v.q === 'bad' ? '통신 불량 — 지금 값을 받지 못합니다' : null)],
    ['info', (t, src, { data }) => (!data.usage.has(t.id) ? '어느 화면에서도 쓰지 않습니다' : null)],
    ['info', (t, src, { data }) => {
      const same = data.tags.filter((o) => o !== t && o.source && t.source && o.source.registerId === t.source.registerId);
      return same.length ? `같은 레지스터를 쓰는 태그: ${same.map((o) => o.id).join(', ')}` : null;
    }],
    ['info', (t, src) => (src && src.dev.enabled === false ? `소스 장비(${src.dev.displayName || src.dev.name})가 통신 비활성입니다` : null)],
  ];

  // 위젯 규칙: (w 위젯, ctx { tags Map, data })
  const WIDGET_RULES = [
    ['error', (w, { tags }) => (w.tag && !tags.has(w.tag) ? `정의되지 않은 태그 '${w.tag}'를 씁니다` : null)],
    ['error', (w, { tags }) => (w.enableWhen && w.enableWhen.tag && !tags.has(w.enableWhen.tag)
      ? `쓰기 허용 조건에 정의되지 않은 태그 '${w.enableWhen.tag}'를 씁니다` : null)],
    ['error', (w, { tags, data }) => {
      const t = WRITE_TYPES.includes(w.type) && tags.get(w.tag);
      if (!t) return null;
      const src = data.regs.get(t.source && t.source.registerId);
      return src && effective(t, src.reg).access !== 'rw' ? `쓰기 위젯인데 태그 '${t.id}'가 읽기 전용이라 동작하지 않습니다` : null;
    }],
    ['error', (w, { data }) => {
      if (w.type !== 'screenlink') return null;
      const sid = w.props && w.props.screen;
      return !sid ? '이동할 화면이 지정되지 않았습니다' : !data.projectScreens.has(sid) ? `이동할 화면 '${sid}'가 없습니다` : null;
    }],
    ['warn', (w) => (!STATIC_TYPES.includes(w.type) && !w.tag ? '태그가 지정되지 않아 값이 표시되지 않습니다' : null)],
  ];

  function checkTags(data) {
    data.tagIssues = new Map();   // tagId → [{ level, text }]
    for (const t of data.tags) {
      const src = data.regs.get(t.source && t.source.registerId);
      const ctx = { e: effective(t, src && src.reg), v: data.values[t.id], data };
      const list = [];
      for (const [level, rule] of TAG_RULES) {
        const text = rule(t, src, ctx);
        if (text) list.push({ level, text });
      }
      if (list.length) data.tagIssues.set(t.id, list);
    }
  }

  function checkScreens(data) {
    const tags = new Map(data.tags.map((t) => [t.id, t]));
    data.screenIssues = [];       // [{ level, screen, widget, type, text }]
    for (const s of data.screens) {
      for (const w of s.content.widgets || []) {
        for (const [level, rule] of WIDGET_RULES) {
          const text = rule(w, { tags, data });
          if (text) data.screenIssues.push({ level, screen: s.title, widget: w.id, type: w.type, text });
        }
      }
    }
  }

  // 등급별 개수(태그 + 화면)
  function countIssues(data) {
    data.counts = { error: 0, warn: 0, info: 0 };
    for (const list of data.tagIssues.values()) for (const i of list) data.counts[i.level]++;
    for (const i of data.screenIssues) data.counts[i.level]++;
  }

  // ---- 표 그리기 -------------------------------------------------------------
  // 머리글 표와 목록 표는 같은 열 너비를 쓴다(스크롤바가 목록 영역에만 생기게 둘을 나눔)
  const colgroup = (widths) => `<colgroup>${widths.map((p) => `<col style="width:${p}%">`).join('')}</colgroup>`;
  // 열: [정렬 키, 제목, 오른쪽 정렬]. 머리글을 누르면 그 열로 오름차순 ↔ 내림차순
  const TABLES = {
    tags: {
      cols: colgroup([4, 16, 10, 20, 6, 10, 6, 8, 9, 11]),
      check: true,   // 맨 앞 선택 체크 상자(여러 개 삭제)
      head: [['id', 'TAG ID'], ['name', 'TAG NAME'], ['source', '소스(장비 · 레지스터)'], ['unit', '단위', 1], ['range', '범위', 1],
        ['decimals', '소수점', 1], ['access', '읽기/쓰기', 1], ['value', '현재 값', 1], ['used', '사용처', 1]],
      span: 10,
    },
    screens: {
      cols: colgroup([8, 18, 18, 11, 45]),
      head: [['level', '등급'], ['screen', '화면'], ['widget', '위젯'], ['type', '종류'], ['text', '내용']],
      span: 5,
    },
  };

  // ---- 정렬 ------------------------------------------------------------------
  // 화면에 보이는 값 기준. 값이 없는 행(null)은 방향과 관계없이 맨 뒤.
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });   // CH2 < CH10
  const LEVEL_ORDER = { error: 0, warn: 1, info: 2 };
  const SORT_KEYS = {
    tags: {
      id: (t) => t.id,
      name: (t) => t.name || null,
      source: (t, data) => { const s = data.regs.get(t.source && t.source.registerId); return s ? `${s.dev.displayName || s.dev.name}\u0001${s.reg.tagName}` : null; },
      unit: (t, data) => effective(t, srcReg(t, data)).unit,
      range: (t, data) => effective(t, srcReg(t, data)).min,
      decimals: (t, data) => { const r = srcReg(t, data); return t.decimals ?? (r ? decimalsFromScale(r.scale) : null); },
      access: (t, data) => effective(t, srcReg(t, data)).access,
      value: (t, data) => { const v = data.values[t.id]; return v && v.q !== 'bad' && v.q !== 'disabled' && typeof v.v === 'number' ? v.v : null; },
      used: (t, data) => (data.usage.get(t.id) || { widgets: 0 }).widgets,
    },
    screens: {
      level: (i) => LEVEL_ORDER[i.level],
      screen: (i) => i.screen,
      widget: (i) => i.widget,
      type: (i) => i.type,
      text: (i) => i.text,
    },
  };
  const srcReg = (t, data) => { const s = data.regs.get(t.source && t.source.registerId); return s && s.reg; };

  function sortRows(list, tab, sort, data) {
    const key = SORT_KEYS[tab][sort.key] || SORT_KEYS[tab][TABLES[tab].head[0][0]];
    const tie = tab === 'tags' ? (x) => x.id : (x) => `${x.screen}\u0001${x.widget}`;
    return list.map((x) => ({ x, k: key(x, data) })).sort((a, b) => {
      if (a.k == null || b.k == null) return a.k == null && b.k == null ? 0 : a.k == null ? 1 : -1;
      const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : collator.compare(String(a.k), String(b.k));
      return (c * sort.dir) || collator.compare(tie(a.x), tie(b.x));
    }).map((o) => o.x);
  }

  // 정렬 상태는 브라우저에 기억(편의 기능 — 못 쓰면 기본값)
  const SORT_STORE = 'whmi.tagManagerSort';
  function loadSort() {
    const def = { tags: { key: 'id', dir: 1 }, screens: { key: 'level', dir: 1 } };
    try { return Object.assign(def, JSON.parse(localStorage.getItem(SORT_STORE) || '{}')); } catch (_) { return def; }
  }
  function saveSort(sort) {
    try { localStorage.setItem(SORT_STORE, JSON.stringify(sort)); } catch (_) { /* 무시 */ }
  }

  // 태그 값 또는 물려받은 레지스터 값 — 물려받은 값은 흐리게 표시
  const cell = (own, inherited, fmt = (v) => v) =>
    own != null ? esc(fmt(own)) : inherited != null ? `<span class="tm-inh">${esc(fmt(inherited))}</span>` : '<span class="tm-inh">—</span>';

  const levelName = (lv) => (LEVELS.find(([k]) => k === lv) || [, lv])[1];
  const worst = (list) => LEVELS.map(([k]) => k).find((k) => list.some((i) => i.level === k));

  function tagRowHtml(t, data, picked) {
    const src = data.regs.get(t.source && t.source.registerId);
    const reg = src && src.reg;
    const source = src
      ? `${esc(src.dev.displayName || src.dev.name)}${src.dev.enabled === false ? ' <span class="tm-off">비활성</span>' : ''}<br><small>${esc(reg.tagName)}${reg.displayName ? ` · ${esc(reg.displayName)}` : ''}</small>`
      : `<span class="tm-err">레지스터 없음 (#${esc(t.source && t.source.registerId)})</span>`;
    const rMin = reg && hasLimit(reg.minValue) ? reg.minValue : null;
    const rMax = reg && hasLimit(reg.maxValue) ? reg.maxValue : null;
    const range = t.min == null && t.max == null && rMin == null && rMax == null
      ? '<span class="tm-inh">—</span>' : `${cell(t.min, rMin)} ~ ${cell(t.max, rMax)}`;
    const access = cell(t.access, reg ? (reg.readOnly ? 'r' : 'rw') : null, accessLabel);
    const v = data.values[t.id];
    const value = !v ? '<span class="tm-inh">—</span>'
      : v.q === 'disabled' ? '<span class="tm-inh">비활성</span>'
      : v.v == null || v.q === 'bad' ? '<span class="tm-err">통신 불량</span>'
      : `<span class="tm-val">${esc(typeof v.v === 'number' ? v.v.toFixed(v.decimals ?? 0) : String(v.v))}</span>` + (v.unit ? ` <small>${esc(v.unit)}</small>` : '');
    const u = data.usage.get(t.id);
    const used = u
      ? `<span title="${esc([...u.screens].join(', '))}">화면 ${u.screens.size} · 위젯 ${u.widgets}</span>`
      : '<span class="tm-inh">사용 안 함</span>';
    // 점검 결과: id 앞 점(가장 높은 등급 색), 마우스를 올리면 이유
    const issues = (data.tagIssues && data.tagIssues.get(t.id)) || [];
    const mark = issues.length
      ? `<span class="tm-mark ${worst(issues)}" title="${esc(issues.map((i) => `[${levelName(i.level)}] ${i.text}`).join('\n'))}">●</span>` : '';
    return `<tr data-id="${esc(t.id)}">
      <td class="tm-chk"><input type="checkbox" data-sel="${esc(t.id)}"${picked && picked.has(t.id) ? ' checked' : ''}></td>
      <td class="tm-id" title="${esc(t.id)}">${mark}${esc(t.id)}</td>
      <td>${esc(t.name || '')}</td>
      <td>${source}</td>
      <td class="tm-r">${cell(t.unit, reg ? reg.unit || null : null)}</td>
      <td class="tm-r">${range}</td>
      <td class="tm-r">${cell(t.decimals, reg ? decimalsFromScale(reg.scale) : null)}</td>
      <td class="tm-r">${access}</td>
      <td class="tm-r">${value}</td>
      <td class="tm-r">${used}</td>
    </tr>`;
  }

  const screenRowHtml = (i) => `<tr>
      <td><span class="tm-lv ${i.level}">${levelName(i.level)}</span></td>
      <td>${esc(i.screen)}</td>
      <td class="tm-id">${esc(i.widget)}</td>
      <td>${esc(i.type)}</td>
      <td>${esc(i.text)}</td>
    </tr>`;

  function summaryText(data) {
    const linked = new Set(data.tags.map((t) => t.source && t.source.registerId).filter((id) => data.regs.has(id)));
    return `태그 ${data.tags.length}개 · 레지스터 ${data.regs.size}개 중 ${linked.size}개 연결`;
  }

  // ---- 편집 폼 ---------------------------------------------------------------
  // id 제안: "장비 코드_레지스터 이름"(장비끼리 같은 레지스터 이름이 흔해서 — 예: ST540_NPV, ST570_NPV).
  // 규칙에 맞게 바꾸고, 겹치면 _2, _3 … taken: 이미 쓰인 id 외에 더 피해야 할 id(여러 개 만들기)
  function suggestId(reg, dev, data, taken) {
    const name = reg.tagName || `TAG_${reg.id}`;
    const code = dev && dev.deviceCode ? dev.deviceCode : '';
    // 레지스터 이름이 이미 장비 코드로 시작하면(SPORLAN_FW_REV) 다시 붙이지 않음
    const raw = code && !name.toUpperCase().startsWith(`${code.toUpperCase()}_`) ? `${code}_${name}` : name;
    const base = raw.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 60) || `TAG_${reg.id}`;
    const ids = new Set([...data.tags.map((t) => t.id), ...(taken || [])]);
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}_${n}`;
    return id;
  }

  // 여러 개 만들기 — 태그가 없는 레지스터를 장비별로 체크 목록으로
  function bulkHtml(data) {
    const linked = new Set(data.tags.map((t) => t.source && t.source.registerId));
    const byDev = new Map();
    for (const { reg, dev } of data.regs.values()) {
      if (linked.has(reg.id)) continue;
      if (!byDev.has(dev.id)) byDev.set(dev.id, { dev, regs: [] });
      byDev.get(dev.id).regs.push(reg);
    }
    const taken = [];
    const rows = [...byDev.values()].map(({ dev, regs }) => `
      <tr class="tm-grp"><td><input type="checkbox" data-grp="${dev.id}"></td><td colspan="5">${esc(dev.displayName || dev.name)}${dev.enabled === false ? ' <span class="tm-off">비활성</span>' : ''} <small>(${regs.length})</small></td></tr>` +
      regs.map((r) => {
        const id = suggestId(r, dev, data, taken);
        taken.push(id);
        return `<tr data-reg="${r.id}" data-dev="${dev.id}">
          <td><input type="checkbox" data-pick></td>
          <td>${esc(r.tagName)}${r.displayName ? ` <small>· ${esc(r.displayName)}</small>` : ''}</td>
          <td class="tm-r">${esc(r.unit || '—')}</td>
          <td class="tm-r">${r.readOnly ? 'READ' : 'WRITE'}</td>
          <td><input class="tm-bin" data-bid value="${esc(id)}" spellcheck="false"></td>
          <td><input class="tm-bin" data-bname value="${esc(r.displayName || r.tagName || '')}" spellcheck="false"></td>
        </tr>`;
      }).join('')).join('');
    const n = [...byDev.values()].reduce((a, g) => a + g.regs.length, 0);
    return `<div class="tm-form tm-bulk">
      <div class="tm-form-title">여러 개 만들기 <small>태그가 없는 레지스터 ${n}개</small></div>
      ${n ? `<table class="tm-table tm-bulk-table">${colgroup([5, 27, 9, 9, 25, 25])}
        <thead><tr><th><input type="checkbox" data-all></th><th>레지스터</th><th class="tm-r">단위</th><th class="tm-r">읽기/쓰기</th><th>TAG ID</th><th>TAG NAME</th></tr></thead>
        <tbody>${rows}</tbody></table>` : '<div class="tm-empty">모든 레지스터에 태그가 있습니다.</div>'}
      <div class="tm-form-err"></div>
    </div>`;
  }

  // 이 태그를 쓰는 위젯 목록 — 삭제 확인에 보여줌
  function usageList(id, data) {
    const out = [];
    for (const s of data.screens) {
      for (const w of s.content.widgets || []) {
        if (w.tag === id || (w.enableWhen && w.enableWhen.tag === id)) out.push(`${s.title}: ${w.id}`);
      }
    }
    return out;
  }

  // firstDev: 이 장비의 레지스터를 맨 앞에(속성 창에서 장비를 고른 채 "+ 새 태그…"로 열었을 때)
  function formHtml(t, data, firstDev) {
    // 장비별로 묶은 레지스터 목록. 이미 태그가 있는 레지스터는 그 태그 id를 함께 보여준다.
    const byDev = new Map();
    if (firstDev != null) for (const { dev } of data.regs.values()) if (dev.id === firstDev) { byDev.set(dev.id, { dev, regs: [] }); break; }
    for (const { reg, dev } of data.regs.values()) {
      if (!byDev.has(dev.id)) byDev.set(dev.id, { dev, regs: [] });
      byDev.get(dev.id).regs.push(reg);
    }
    const linked = (regId) => data.tags.filter((o) => o !== t && o.source && o.source.registerId === regId).map((o) => o.id);
    const groups = [...byDev.values()].map(({ dev, regs }) => `<optgroup label="${esc(dev.displayName || dev.name)}${dev.enabled === false ? ' (비활성)' : ''}">` +
      regs.map((r) => {
        const l = linked(r.id);
        return `<option value="${r.id}">${esc(r.tagName)}${r.displayName ? ` · ${esc(r.displayName)}` : ''}${l.length ? ` (태그: ${esc(l.join(', '))})` : ''}</option>`;
      }).join('') + '</optgroup>').join('');
    const missing = t && !data.regs.has(t.source && t.source.registerId)
      ? `<option value="${esc(t.source && t.source.registerId)}">레지스터 없음 (#${esc(t.source && t.source.registerId)})</option>` : '';
    const opts = (list) => list.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    // 레지스터 설정 화면과 같은 폼 구성(form-grid / form-field / input / select)
    return `<div class="tm-form">
      <div class="tm-form-title">${t ? '태그 수정' : '새 태그 정보'}</div>
      <div class="form-grid">
        <div class="form-field full"><label>소스 레지스터</label><select class="select" data-ff="source">${t ? '' : '<option value="">레지스터를 고르세요</option>'}${missing}${groups}</select></div>
        <div class="form-field"><label>TAG ID${t ? ' (변경 불가)' : ''}</label>${t ? `<input class="input" value="${esc(t.id)}" disabled>` : '<input class="input" data-ff="id" spellcheck="false" autocomplete="off">'}</div>
        <div class="form-field"><label>TAG NAME</label><input class="input" data-ff="name" spellcheck="false"></div>
        <div class="form-field"><label>단위</label><select class="select" data-ff="unit"><option value="">레지스터 상속</option>${opts(UNIT_OPTIONS)}</select></div>
        <div class="form-field"><label>소수점 위치</label><select class="select" data-ff="decimals"><option value="">레지스터 상속</option>${opts(DECIMAL_OPTIONS)}</select></div>
        <div class="form-field"><label>최소값</label><input class="input" data-ff="min" inputmode="decimal"></div>
        <div class="form-field"><label>최대값</label><input class="input" data-ff="max" inputmode="decimal"></div>
        <div class="form-field"><label>읽기/쓰기</label><select class="select" data-ff="access"><option value="">레지스터 상속</option><option value="r">READ</option><option value="rw">WRITE</option></select></div>
      </div>
      <div class="tm-form-err"></div>
      <div class="tm-del-confirm" hidden></div>
    </div>`;
  }

  // 편집기가 들고 있는 태그 목록·미리보기를 새로 맞춘다(새 태그가 속성 창 tag 목록에 바로 보이게)
  async function refreshEditor(editor) {
    const td = await getJson('/api/hmi/tags');
    const map = {};
    for (const t of td.tags || []) map[t.id] = t;
    editor.tags = map;
    if (editor.doc) {
      await editor.readValues();
      editor.render();
    }
    editor.inspKey = null;
    editor.renderInspector();
  }

  // ---- 대화상자 ---------------------------------------------------------------
  // opts.createFor: 위젯 id — 속성 창 "+ 새 태그…"에서 열면 바로 새 태그 폼, 만들면 그 위젯에 연결하고 닫음
  // opts.deviceId: 속성 창에서 고른 장비 — 새 태그 폼의 소스 레지스터 목록에서 이 장비를 맨 앞에
  function open(editor, opts = {}) {
    const d = window.WHMI.dialog.open(`<div class="ed-dlg tm">
      <div class="tm-head">
        <p>HMI 태그</p>
        <input type="search" class="tm-search" placeholder="id · 이름 · 레지스터 · 화면 검색" spellcheck="false">
        <button type="button" data-k="reload" title="목록 다시 읽기">새로고침</button>
        <button type="button" data-k="new" title="소스 레지스터를 골라 태그 만들기">+ 새 태그</button>
        <button type="button" data-k="bulk" title="태그가 없는 레지스터를 골라 한꺼번에 만들기">여러 개 만들기</button>
        <button type="button" data-k="check" class="tm-check-btn" title="레지스터 연결과 화면 참조를 점검">점검</button>
      </div>
      <div class="tm-bar">
        <span class="tm-summary">불러오는 중…</span>
        <span class="tm-status"></span>
        <span class="tm-badges"></span>
        <span class="tm-tabs" hidden>
          <button type="button" data-tab="tags" class="on">태그 목록</button>
          <button type="button" data-tab="screens">화면 점검</button>
        </span>
      </div>
      <div class="tm-wrap">
        <div class="tm-head-wrap"><table class="tm-table"></table></div>
        <div class="tm-body-wrap"><table class="tm-table"></table></div>
        <div class="tm-form-wrap" hidden></div>
      </div>
      <div class="dlg-hint tm-list-hint">흐린 값은 레지스터에서 물려받은 값입니다. [점검] 후 ● 표시에 마우스를 올리면 점검 내용이 보입니다.</div>
      <div class="dlg-btns tm-btns"></div>
    </div>`);
    const headTable = d.querySelector('.tm-head-wrap table');
    const bodyTable = d.querySelector('.tm-body-wrap table');
    const summary = d.querySelector('.tm-summary');
    const badges = d.querySelector('.tm-badges');
    const status = d.querySelector('.tm-status');
    const tabs = d.querySelector('.tm-tabs');
    const checkBtn = d.querySelector('[data-k="check"]');
    const search = d.querySelector('.tm-search');
    const formWrap = d.querySelector('.tm-form-wrap');
    const btns = d.querySelector('.tm-btns');
    // 아래 버튼줄 — 목록: [닫기] / 새 태그: [목록으로][만들기] / 수정: [삭제] … [목록으로][저장]
    const drawButtons = () => {
      const back = `<button type="button" data-k="back">${opts.createFor ? '취소' : '목록으로'}</button>`;
      btns.innerHTML = !editing
        ? (selected.size && tab === 'tags' ? `<button type="button" data-k="multi-del" class="tm-danger">선택 삭제 (${selected.size})</button><span class="tm-spacer"></span>` : '') +
          '<button type="button" data-k="close" class="primary">닫기</button>'
        : editing.multiDel ? `<button type="button" data-k="back">취소</button><button type="button" data-k="multi-del-ok" class="tm-danger">삭제</button>`
        : editing.bulk ? `${back}<button type="button" data-k="bulk-create" class="primary" disabled>만들기</button>`
        : (editing.tag ? '<button type="button" data-k="delete" class="tm-danger">삭제</button><span class="tm-spacer"></span>' : '') +
          `${back}<button type="button" data-k="save" class="primary">${editing.tag ? '저장' : '만들기'}</button>`;
    };
    let data = null;
    let editing = null;   // 편집 폼이 열려 있으면 { tag | null(새 태그) }
    let checked = false;  // [점검]을 실행해 결과가 있는지
    let tab = 'tags';
    let level = null;     // 등급 배지를 누르면 그 등급 문제만 보기
    const selected = new Set();   // 목록에서 체크한 태그 id(여러 개 삭제)
    let visibleIds = [];          // 지금 목록에 보이는 태그 — 머리글 체크는 이것만 선택
    const sort = loadSort();   // 탭별 { key, dir }

    const draw = () => {
      const T = TABLES[tab];
      const so = sort[tab];
      // 화살표는 오른쪽 정렬 열이면 제목 앞에 둬서 제목 끝이 값과 같은 선에 오게 한다
      headTable.innerHTML = `${T.cols}<thead><tr>${T.check ? '<th class="tm-chk"><input type="checkbox" data-selall title="보이는 태그 전체 선택"></th>' : ''}${T.head.map(([k, label, right]) => {
        const arrow = `<span class="tm-arrow${right ? ' l' : ''}">${so.key === k ? (so.dir > 0 ? '▲' : '▼') : ''}</span>`;
        return `<th class="tm-sort${right ? ' tm-r' : ''}${so.key === k ? ' on' : ''}" data-sort="${k}" title="눌러서 정렬">` +
          `${right ? arrow : ''}${esc(label)}${right ? '' : arrow}</th>`;
      }).join('')}</tr></thead>`;
      d.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      if (!data) { bodyTable.innerHTML = T.cols; return; }
      tabs.hidden = !checked;
      badges.innerHTML = !checked ? '' : LEVELS.map(([k, name]) => (data.counts[k]
        ? `<button type="button" class="tm-badge ${k}${level === k ? ' on' : ''}" data-level="${k}" title="${name} 항목만 보기">${name} ${data.counts[k]}</button>` : '')).join('') ||
        '<span class="tm-ok">문제 없음</span>';
      const q = search.value.trim().toLowerCase();
      let rows;
      if (tab === 'tags') {
        const list = data.tags.filter((t) => {
          if (level && !(data.tagIssues.get(t.id) || []).some((i) => i.level === level)) return false;
          if (!q) return true;
          const src = data.regs.get(t.source && t.source.registerId);
          return `${t.id} ${t.name || ''} ${src ? `${src.reg.tagName} ${src.reg.displayName || ''} ${src.dev.displayName || src.dev.name}` : ''}`.toLowerCase().includes(q);
        });
        const sorted = sortRows(list, 'tags', sort.tags, data);
        visibleIds = sorted.map((t) => t.id);
        rows = sorted.map((t) => tagRowHtml(t, data, selected));
      } else {
        const list = data.screenIssues.filter((i) => (!level || i.level === level) &&
          (!q || `${i.screen} ${i.widget} ${i.type} ${i.text}`.toLowerCase().includes(q)));
        rows = sortRows(list, 'screens', sort.screens, data).map(screenRowHtml);
      }
      const empty = tab === 'screens' && !data.screenIssues.length ? '화면 점검에서 찾은 문제가 없습니다.'
        : tab === 'tags' && !data.tags.length ? '등록된 태그가 없습니다.' : '조건에 맞는 항목이 없습니다.';
      bodyTable.innerHTML = `${T.cols}<tbody>${rows.length ? rows.join('') : `<tr><td colspan="${T.span}" class="tm-empty">${empty}</td></tr>`}</tbody>`;
      const n = checked ? data.screenIssues.length : 0;
      d.querySelector('[data-tab="screens"]').textContent = n ? `화면 점검 ${n}` : '화면 점검';
      syncSelection();
    };
    // 선택 수에 맞춰 머리글 체크(전체/일부)와 아래 [선택 삭제 (N)] 버튼을 맞춤
    const syncSelection = () => {
      for (const id of [...selected]) if (!data || !data.tags.some((t) => t.id === id)) selected.delete(id);
      const all = headTable.querySelector('[data-selall]');
      if (all) {
        const c = visibleIds.filter((id) => selected.has(id)).length;
        all.checked = c > 0 && c === visibleIds.length;
        all.indeterminate = c > 0 && c < visibleIds.length;
      }
      if (!editing) drawButtons();
    };
    // 목록만 다시 읽음 — 점검 결과는 지운다(데이터가 바뀌었을 수 있으므로)
    const load = async () => {
      summary.textContent = '불러오는 중…';
      checked = false; tab = 'tags'; level = null; status.textContent = ''; selected.clear();
      try {
        data = await loadAll(editor);
        summary.textContent = summaryText(data);
      } catch (e) {
        data = null;
        summary.textContent = `불러오지 못했습니다: ${e.message}`;
      }
      draw();
    };

    // 점검 — 실제로 데이터를 새로 읽고(현재 값·통신 상태는 이 순간 값이 필요) 규칙을 단계별로 적용.
    // 실제 작업은 금방 끝나므로 단계마다 최소 CHECK_STEP_MS씩 보여 진행이 눈에 보이게 한다.
    const runCheck = async () => {
      if (checkBtn.disabled) return;
      checkBtn.disabled = true;
      const steps = [
        ['태그·레지스터·값 읽는 중', async () => { data = await loadAll(editor); summary.textContent = summaryText(data); }],
        ['레지스터 연결 확인', async () => checkTags(data)],
        [`화면 ${(editor.project.screens || []).length}개 참조 확인`, async () => { checkScreens(data); countIssues(data); }],
      ];
      try {
        for (let i = 0; i < steps.length; i++) {
          status.innerHTML = `<span class="tm-busy"></span>${esc(steps[i][0])}… <small>${i + 1}/${steps.length}</small>` +
            `<span class="tm-progress"><i style="width:${(i / steps.length) * 100}%"></i></span>`;
          await Promise.all([steps[i][1](), new Promise((r) => setTimeout(r, CHECK_STEP_MS))]);
        }
        checked = true; level = null;
        const t = new Date();
        const c = data.counts;
        status.innerHTML = `<span class="tm-done">✓</span> 점검 완료 · ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
        status.title = `오류 ${c.error} · 경고 ${c.warn} · 정보 ${c.info}`;
      } catch (e) {
        checked = false;
        status.textContent = `점검하지 못했습니다: ${e.message}`;
      }
      checkBtn.disabled = false;
      draw();
    };

    // ---- 편집 폼 열기 / 목록으로 / 저장 / 삭제
    const ff = (k) => formWrap.querySelector(`[data-ff="${k}"]`);
    const formError = (text) => { formWrap.querySelector('.tm-form-err').textContent = text || ''; };

    // 소스 레지스터가 바뀌면 물려받을 값을 입력란에 흐리게, 새 태그면 id·이름도 제안
    const onSourceChange = () => {
      const src = data.regs.get(Number(ff('source').value));
      const reg = src && src.reg;
      // 첫 항목 "레지스터 상속"에 물려받을 값을 함께 보여준다
      const inherit = (v) => (reg ? `레지스터 상속 (${v})` : '레지스터 상속');
      ff('unit').options[0].textContent = inherit(reg && reg.unit ? reg.unit : '없음');
      ff('decimals').options[0].textContent = inherit(reg ? decimalsFromScale(reg.scale) : '');
      ff('min').placeholder = inherit(reg && hasLimit(reg.minValue) ? reg.minValue : '제한 없음');
      ff('max').placeholder = inherit(reg && hasLimit(reg.maxValue) ? reg.maxValue : '제한 없음');
      const acc = ff('access');
      acc.options[0].textContent = inherit(reg ? accessLabel(reg.readOnly ? 'r' : 'rw') : '');
      // 레지스터가 읽기 전용이면 읽기·쓰기는 고를 수 없음(골라도 쓰기는 실패)
      acc.options[2].disabled = !!(reg && reg.readOnly);
      if (acc.value === 'rw' && reg && reg.readOnly) acc.value = '';
      // 새 태그에서 "레지스터를 고르세요"로 되돌리면 입력한 내용을 모두 비운다(제안값도 다시 받도록)
      if (!editing.tag && !reg) {
        for (const k of ['id', 'name', 'min', 'max']) { ff(k).value = ''; delete ff(k).dataset.touched; }
        for (const k of ['unit', 'decimals', 'access']) ff(k).value = '';
        formError('');
      }
      if (!editing.tag && reg) {
        if (!ff('id').dataset.touched) ff('id').value = suggestId(reg, src.dev, data);
        if (!ff('name').dataset.touched) ff('name').value = reg.displayName || reg.tagName || '';
      }
    };

    const showForm = (tag) => {
      editing = { tag };
      formWrap.innerHTML = formHtml(tag, data, tag ? null : opts.deviceId);
      d.querySelector('.tm').classList.add('editing');
      formWrap.hidden = false;
      drawButtons();
      if (tag) {
        ff('source').value = String(tag.source && tag.source.registerId);
        ff('name').value = tag.name || '';
        // 목록에 없는 값(직접 넣은 단위·자릿수)이면 선택 항목으로 추가해 그대로 보이게
        for (const [k, v] of [['unit', tag.unit], ['decimals', tag.decimals]]) {
          if (v != null && ![...ff(k).options].some((o) => o.value === String(v))) ff(k).add(new Option(String(v), String(v)));
          ff(k).value = v == null ? '' : String(v);
        }
        ff('min').value = tag.min ?? '';
        ff('max').value = tag.max ?? '';
        ff('access').value = tag.access || '';
      }
      onSourceChange();
      ff('source').addEventListener('change', onSourceChange);
      for (const k of ['id', 'name']) ff(k)?.addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
      (tag ? ff('name') : ff('source')).focus();
    };

    const showList = () => {
      editing = null;
      formWrap.hidden = true;
      formWrap.innerHTML = '';
      d.querySelector('.tm').classList.remove('editing');
      drawButtons();
      draw();
    };

    // 저장·삭제 후: 편집기 태그 목록 갱신 → 목록으로 → 자동 점검.
    // 속성 창 "+ 새 태그…"로 열었으면 만든 태그를 그 위젯에 연결하고 닫는다(연결은 실행 취소 가능).
    const afterChange = async (createdId) => {
      try { await refreshEditor(editor); } catch (_) { /* 편집기 갱신 실패는 점검에서 드러남 */ }
      if (opts.createFor && createdId) {
        const w = editor.doc && editor.doc.widgets.find((x) => x.id === opts.createFor);
        close();
        if (w) await editor.setTag(w, createdId);
        return;
      }
      showList();
      await runCheck();
    };

    const num = (k) => (ff(k).value.trim() === '' ? null : Number(ff(k).value));
    const save = async () => {
      const tag = editing.tag;
      const registerId = Number(ff('source').value);
      const id = tag ? tag.id : ff('id').value.trim();
      const name = ff('name').value.trim();
      const body = {
        name,
        source: { registerId },
        unit: ff('unit').value || null,
        min: num('min'),
        max: num('max'),
        decimals: num('decimals'),
        access: ff('access').value || null,
      };
      if (!registerId) return formError('소스 레지스터를 고르세요.');
      if (!tag && !ID_RE.test(id)) return formError('id는 영문·숫자·_·- 1~64자입니다.');
      if (!tag && data.tags.some((t) => t.id === id)) return formError(`"${id}"은(는) 이미 있는 태그입니다.`);
      if (!name) return formError('이름을 입력하세요.');
      if ([body.min, body.max].some((v) => v != null && !Number.isFinite(v))) return formError('최소값·최대값은 숫자로 입력하세요.');
      if (body.min != null && body.max != null && body.min >= body.max) return formError('최소값은 최대값보다 작아야 합니다.');
      if (body.decimals != null && !(body.decimals >= 0 && body.decimals <= 6)) return formError('소수점 자리는 0~6입니다.');
      formError('');
      const btn = btns.querySelector('[data-k="save"]');
      btn.disabled = true;
      try {
        const res = await apiFetch(tag ? `/api/hmi/tags/${encodeURIComponent(id)}` : '/api/hmi/tags', {
          method: tag ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tag ? body : { id, ...body }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          btn.disabled = false;
          return formError(res.status === 409 ? `"${id}"은(는) 이미 있는 태그입니다.`
            : res.status === 401 || res.status === 403 ? '권한이 없습니다(Manager 이상).'
            : (err.error || `HTTP ${res.status}`));
        }
      } catch (e) {
        btn.disabled = false;
        return formError(e.message);
      }
      await afterChange(tag ? null : id);
    };

    // ---- 여러 개 만들기
    const showBulk = () => {
      editing = { bulk: true };
      formWrap.innerHTML = bulkHtml(data);
      d.querySelector('.tm').classList.add('editing');
      formWrap.hidden = false;
      drawButtons();
      updateBulk();
    };
    const picked = () => [...formWrap.querySelectorAll('tr[data-reg]')].filter((tr) => tr.querySelector('[data-pick]').checked);
    // 체크 수에 맞춰 버튼 문구, 장비별·전체 체크 상태 맞춤
    const updateBulk = () => {
      const rows = [...formWrap.querySelectorAll('tr[data-reg]')];
      const n = picked().length;
      const btn = btns.querySelector('[data-k="bulk-create"]');
      if (btn) { btn.disabled = !n; btn.textContent = n ? `${n}개 만들기` : '만들기'; }
      const state = (list, box) => {
        if (!box) return;
        const c = list.filter((tr) => tr.querySelector('[data-pick]').checked).length;
        box.checked = c > 0 && c === list.length;
        box.indeterminate = c > 0 && c < list.length;
      };
      formWrap.querySelectorAll('[data-grp]').forEach((g) => state(rows.filter((tr) => tr.dataset.dev === g.dataset.grp), g));
      state(rows, formWrap.querySelector('[data-all]'));
    };
    const bulkCreate = async () => {
      const rows = picked();
      const items = rows.map((tr) => ({ tr, registerId: Number(tr.dataset.reg), id: tr.querySelector('[data-bid]').value.trim(), name: tr.querySelector('[data-bname]').value.trim() }));
      // 검사: id 규칙·중복(기존 + 이번 목록 안), 이름
      formWrap.querySelectorAll('.tm-bin').forEach((i) => i.classList.remove('bad'));
      const existing = new Set(data.tags.map((t) => t.id));
      const seen = new Set();
      let bad = 0;
      for (const it of items) {
        const idBad = !ID_RE.test(it.id) || existing.has(it.id) || seen.has(it.id);
        seen.add(it.id);
        if (idBad) it.tr.querySelector('[data-bid]').classList.add('bad');
        if (!it.name) it.tr.querySelector('[data-bname]').classList.add('bad');
        if (idBad || !it.name) bad++;
      }
      if (bad) return formError(`${bad}개 행의 TAG ID·TAG NAME을 확인하세요(규칙: 영문·숫자·_·- 64자, 중복 불가, 이름 필수).`);
      formError('');
      btns.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      const failed = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        status.innerHTML = `<span class="tm-busy"></span>태그 만드는 중… <small>${i + 1}/${items.length}</small>` +
          `<span class="tm-progress"><i style="width:${(i / items.length) * 100}%"></i></span>`;
        try {
          const res = await apiFetch('/api/hmi/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: it.id, name: it.name, source: { registerId: it.registerId } }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            failed.push(`${it.id}: ${res.status === 409 ? '이미 있는 id' : res.status === 403 ? '권한 없음' : (err.error || `HTTP ${res.status}`)}`);
          }
        } catch (e) {
          failed.push(`${it.id}: ${e.message}`);
        }
      }
      status.textContent = '';
      if (failed.length) {
        // 일부 실패 — 만든 것은 목록에서 빠지도록 다시 읽고, 실패 이유를 보여준다
        try { data = await loadAll(editor); summary.textContent = summaryText(data); } catch (_) {}
        showBulk();
        formError(`${items.length - failed.length}개 만들었고 ${failed.length}개는 실패했습니다 — ${failed.join(' / ')}`);
        refreshEditor(editor).catch(() => {});
        return;
      }
      await afterChange();
    };

    // ---- 여러 개 삭제: 확인 화면 → 하나씩 삭제 → 자동 점검
    // 기본은 선택한 태그 전부 삭제. 확인 화면은 "남길 것"을 쉽게 판단하도록 화면에서 쓰는 태그를
    // 따로 보여주고(사용처 포함), 행마다 체크를 풀어 삭제에서 뺄 수 있게 한다.
    const multiTargets = () => [...formWrap.querySelectorAll('[data-md]')].filter((c) => c.checked).map((c) => c.dataset.md);
    const showMultiDelete = () => {
      editing = { multiDel: true };
      const ids = sortRows(data.tags.filter((t) => selected.has(t.id)), 'tags', { key: 'id', dir: 1 }, data).map((t) => t.id);
      const unused = ids.filter((id) => !data.usage.has(id));
      const used = ids.filter((id) => data.usage.has(id));
      const tagOf = (id) => data.tags.find((t) => t.id === id);
      const sourceOf = (t) => {
        const src = data.regs.get(t.source && t.source.registerId);
        return src ? `${esc(src.dev.displayName || src.dev.name)} <small>· ${esc(src.reg.tagName)}</small>` : '<span class="tm-err">레지스터 없음</span>';
      };
      // 사용처: 화면별로 묶은 위젯 목록
      const usageOf = (id) => {
        const by = new Map();
        for (const sc of data.screens) for (const w of sc.content.widgets || []) {
          const asValue = w.tag === id;
          const asCond = w.enableWhen && w.enableWhen.tag === id;
          if (asValue || asCond) {
            if (!by.has(sc.title)) by.set(sc.title, []);
            // 용도: 위젯 종류(값 표시/조작), 쓰기 허용 조건으로 쓰면 그 표시
            by.get(sc.title).push(`${esc(w.id)} <span class="tm-use-type">${esc(TYPE_NAME[w.type] || w.type)}${asCond ? (asValue ? ' · 쓰기 조건' : ' 쓰기 조건') : ''}</span>`);
          }
        }
        return [...by].map(([title, ws]) => `<div><b>${esc(title)}</b><div class="tm-use-list">${ws.map((x) => `<span>${x}</span>`).join('')}</div></div>`).join('');
      };
      const section = (key, title, note, list, withUsage) => !list.length ? '' : `
        <div class="tm-md-sec${withUsage ? ' warn' : ''}">
          <div class="tm-md-head"><b>${title} ${list.length}개</b>${note ? `<span class="tm-md-note">${note}</span>` : ''}
            <span class="tm-spacer"></span>
            <button type="button" data-k="md-all" data-sec="${key}">전체 선택</button><button type="button" data-k="md-none" data-sec="${key}">전체 해제</button>
          </div>
          <table class="tm-table">${colgroup(withUsage ? [5, 20, 17, 22, 36] : [5, 28, 27, 40])}
            <thead><tr><th class="tm-chk"><input type="checkbox" data-md-sec="${key}" checked></th><th>TAG ID</th><th>TAG NAME</th><th>소스(장비 · 레지스터)</th>${withUsage ? '<th>사용처(화면 · 위젯)</th>' : ''}</tr></thead>
            <tbody>${list.map((id) => {
              const t = tagOf(id);
              return `<tr data-sec="${key}"><td class="tm-chk"><input type="checkbox" data-md="${esc(id)}" checked></td>
                <td class="tm-id" title="${esc(id)}">${esc(id)}</td><td>${esc(t.name || '')}</td><td>${sourceOf(t)}</td>${withUsage ? `<td class="tm-md-use">${usageOf(id)}</td>` : ''}</tr>`;
            }).join('')}</tbody>
          </table>
        </div>`;
      formWrap.innerHTML = `<div class="tm-form tm-md">
        <div class="tm-form-title">선택한 태그 ${ids.length}개 삭제 <small>체크를 풀면 삭제에서 빠집니다</small></div>
        ${section('used', '화면에서 쓰는 태그', '지우면 오른쪽 위젯이 값을 표시하지 못합니다 — 남길 태그는 체크를 푸세요', used, true)}
        ${section('unused', '화면에서 쓰지 않는 태그', '', unused, false)}
        <div class="tm-form-err"></div>
      </div>`;
      d.querySelector('.tm').classList.add('editing');
      formWrap.hidden = false;
      drawButtons();
      updateMultiDelete();
    };
    // 체크 수 → [N개 삭제] 버튼, 구역 머리글 체크(전체/일부), 빠진 행은 흐리게
    const updateMultiDelete = () => {
      const n = multiTargets().length;
      const btn = btns.querySelector('[data-k="multi-del-ok"]');
      if (btn) { btn.disabled = !n; btn.textContent = n ? `${n}개 삭제` : '삭제할 태그 없음'; }
      formWrap.querySelectorAll('[data-md-sec]').forEach((box) => {
        const list = [...formWrap.querySelectorAll(`tr[data-sec="${box.dataset.mdSec}"] [data-md]`)];
        const c = list.filter((x) => x.checked).length;
        box.checked = c > 0 && c === list.length;
        box.indeterminate = c > 0 && c < list.length;
      });
      formWrap.querySelectorAll('tr[data-sec]').forEach((tr) => tr.classList.toggle('tm-keep', !tr.querySelector('[data-md]').checked));
    };
    const setSection = (sec, on) => {
      formWrap.querySelectorAll(`tr[data-sec="${sec}"] [data-md]`).forEach((c) => { c.checked = on; });
      updateMultiDelete();
    };
    const multiDelete = async () => {
      const ids = multiTargets();
      if (!ids.length) return;
      btns.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      const failed = [];
      for (let i = 0; i < ids.length; i++) {
        status.innerHTML = `<span class="tm-busy"></span>태그 삭제 중… <small>${i + 1}/${ids.length}</small>` +
          `<span class="tm-progress"><i style="width:${(i / ids.length) * 100}%"></i></span>`;
        try {
          const res = await apiFetch(`/api/hmi/tags/${encodeURIComponent(ids[i])}`, { method: 'DELETE' });
          if (!res.ok && res.status !== 404) failed.push(`${ids[i]}: ${res.status === 403 ? '권한 없음' : `HTTP ${res.status}`}`);
        } catch (e) {
          failed.push(`${ids[i]}: ${e.message}`);
        }
      }
      status.textContent = '';
      selected.clear();
      await afterChange();
      if (failed.length) status.textContent = `${failed.length}개 삭제 실패 — ${failed.join(' / ')}`;
    };

    // 삭제 — 쓰는 위젯이 있으면 목록을 보여주고 한 번 더 확인(써도 지울 수는 있음)
    const askDelete = () => {
      const box = formWrap.querySelector('.tm-del-confirm');
      const used = usageList(editing.tag.id, data);
      box.innerHTML = `<b>'${esc(editing.tag.id)}' 태그를 삭제할까요?</b>` +
        (used.length ? `<div>이 태그를 쓰는 위젯 ${used.length}개는 값이 표시되지 않게 됩니다(점검에서 오류로 표시):</div><ul>${used.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>`
          : '<div>이 태그를 쓰는 위젯은 없습니다.</div>') +
        '<div class="tm-del-btns"><button type="button" data-k="del-cancel">취소</button><button type="button" data-k="del-ok" class="tm-danger">삭제</button></div>';
      box.hidden = false;
    };
    const doDelete = async () => {
      try {
        const res = await apiFetch(`/api/hmi/tags/${encodeURIComponent(editing.tag.id)}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return formError(res.status === 401 || res.status === 403 ? '권한이 없습니다(Manager 이상).' : (err.error || `HTTP ${res.status}`));
        }
      } catch (e) {
        return formError(e.message);
      }
      await afterChange();
    };

    const close = () => { document.removeEventListener('keydown', onKey, true); window.WHMI.dialog.close(); };
    // Esc: 편집 폼이면 목록으로, 목록이면 닫기
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); if (editing && !opts.createFor) showList(); else close(); } };
    // 목록 선택 체크 상자 — 머리글은 지금 보이는 행만 전체 선택/해제
    d.querySelector('.tm-wrap').addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.sel) { if (t.checked) selected.add(t.dataset.sel); else selected.delete(t.dataset.sel); syncSelection(); }
      else if (t.dataset.selall !== undefined) {
        for (const id of visibleIds) { if (t.checked) selected.add(id); else selected.delete(id); }
        bodyTable.querySelectorAll('[data-sel]').forEach((c) => { c.checked = selected.has(c.dataset.sel); });
        syncSelection();
      } else if (t.dataset.md) updateMultiDelete();
      else if (t.dataset.mdSec) setSection(t.dataset.mdSec, t.checked);
    });
    // 여러 개 만들기 체크 상자
    formWrap.addEventListener('change', (e) => {
      if (!editing || !editing.bulk) return;
      const t = e.target;
      const rows = [...formWrap.querySelectorAll('tr[data-reg]')];
      if (t.dataset.all !== undefined) rows.forEach((tr) => { tr.querySelector('[data-pick]').checked = t.checked; });
      else if (t.dataset.grp) rows.filter((tr) => tr.dataset.dev === t.dataset.grp).forEach((tr) => { tr.querySelector('[data-pick]').checked = t.checked; });
      updateBulk();
    });
    document.addEventListener('keydown', onKey, true);
    search.addEventListener('input', draw);
    d.addEventListener('click', (e) => {
      const row = !editing && tab === 'tags' && !e.target.closest('.tm-chk') && e.target.closest('.tm-body-wrap tr[data-id]');
      if (row && data) { const t = data.tags.find((x) => x.id === row.dataset.id); if (t) showForm(t); return; }
      const b = e.target.closest('[data-k],[data-tab],[data-level],[data-sort]');
      if (!b) return;
      if (b.dataset.sort) {
        const so = sort[tab];
        if (so.key === b.dataset.sort) so.dir = -so.dir; else { so.key = b.dataset.sort; so.dir = 1; }
        saveSort(sort);
        draw();
        return;
      }
      if (b.dataset.k === 'close') close();
      else if (b.dataset.k === 'reload') load();
      else if (b.dataset.k === 'check') runCheck();
      else if (b.dataset.k === 'new') { if (data) showForm(null); }
      else if (b.dataset.k === 'bulk') { if (data) showBulk(); }
      else if (b.dataset.k === 'bulk-create') bulkCreate();
      else if (b.dataset.k === 'multi-del') { if (data && selected.size) showMultiDelete(); }
      else if (b.dataset.k === 'multi-del-ok') multiDelete();
      else if (b.dataset.k === 'md-all') setSection(b.dataset.sec, true);
      else if (b.dataset.k === 'md-none') setSection(b.dataset.sec, false);
      else if (b.dataset.k === 'back') { if (opts.createFor) close(); else showList(); }
      else if (b.dataset.k === 'save') save();
      else if (b.dataset.k === 'delete') askDelete();
      else if (b.dataset.k === 'del-cancel') formWrap.querySelector('.tm-del-confirm').hidden = true;
      else if (b.dataset.k === 'del-ok') doDelete();
      else if (b.dataset.tab) { tab = b.dataset.tab; draw(); drawButtons(); }
      else if (b.dataset.level) { level = level === b.dataset.level ? null : b.dataset.level; draw(); }
    });
    drawButtons();
    draw();
    search.focus();
    load().then(() => { if (opts.createFor && data) showForm(null); });
  }

  window.WHMI.TagManager = { open };
})();
