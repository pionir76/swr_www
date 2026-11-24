// WHMI 판정 엔진 — "태그 값 → 결과"를 정하는 규칙을 한 곳에서 판정한다.
// 상태 칸(보이기·조작 허용·켜짐), 램프 켜짐, 상태 표시 목록, 구간 색이 모두 이 규칙을 쓴다.
// 설계: docs/architecture/hmi.md §5.6
//
// 조건(cond): { tag?, test, value?, min?, max?, bits? }
//   test  eq / ne      같음 / 다름 — 둘 다 숫자로 읽히면(참거짓은 1/0) 숫자 비교, 아니면 글자 비교
//         gt / lt      큼 / 작음 — 숫자로 읽힐 때만(아니면 거짓)
//         range        min ≤ 값 ≤ max(양 끝 포함, 비우면 끝없음)
//         bitAny       bits 중 하나라도 1 / bitNone 모두 0 — 값을 정수로 내림, 비트 0~31
//   예전 형식 { tag, equals } 는 eq로 읽는다(enableWhen 호환).
// 값(sample): 값 응답의 { v, q } 한 항목. 없거나 q가 bad/disabled면 판정 불가 → null.
(function () {
  'use strict';
  if (!window.WHMI) return;   // HMI 페이지를 떠나며 정리된 뒤 늦게 도착한 스크립트

  const TESTS = ['eq', 'ne', 'gt', 'lt', 'range', 'bitAny', 'bitNone'];

  const usable = (s) => !!s && s.q !== 'bad' && s.q !== 'disabled' && s.v !== undefined && s.v !== null;

  // 숫자로 읽기 — 참거짓은 1/0, 숫자 모양 글자는 숫자, 그 밖은 NaN
  function num(x) {
    if (typeof x === 'boolean') return x ? 1 : 0;
    if (typeof x === 'number') return x;
    if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
    return NaN;
  }

  function same(a, b) {
    const na = num(a), nb = num(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
    return String(a) === String(b);
  }

  const bitList = (b) => (b == null ? [] : [].concat(b)).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 31);

  function normalize(c) {
    if (!c || typeof c !== 'object') return null;
    if (c.test) return TESTS.includes(c.test) ? c : null;
    if ('equals' in c) return { tag: c.tag, test: 'eq', value: c.equals };
    return null;
  }

  // 조건 하나 → true / false / null(판정 불가: 값 없음·통신 불량·잘못된 조건)
  function test(cond, sample) {
    const c = normalize(cond);
    if (!c || !usable(sample)) return null;
    const v = sample.v;
    switch (c.test) {
      case 'eq': return same(v, c.value);
      case 'ne': return !same(v, c.value);
      case 'gt': case 'lt': {
        const a = num(v), b = num(c.value);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
        return c.test === 'gt' ? a > b : a < b;
      }
      case 'range': {
        const a = num(v);
        if (!Number.isFinite(a)) return false;
        return (c.min == null || a >= num(c.min)) && (c.max == null || a <= num(c.max));
      }
      case 'bitAny': case 'bitNone': {
        const a = num(v), bits = bitList(c.bits);
        if (!Number.isFinite(a) || !bits.length) return false;
        const w = Math.trunc(a);
        const any = bits.some((b) => ((w >> b) & 1) === 1);
        return c.test === 'bitAny' ? any : !any;
      }
      default: return null;
    }
  }

  // 대응표: rows 중 위에서부터 처음 맞는 줄. toCond(row)가 그 줄의 조건을 만든다(같은 값으로 판정).
  // → { index, row } / 맞는 줄 없음 { index: -1, row: null } / 판정 불가 null
  function pick(rows, sample, toCond) {
    if (!usable(sample)) return null;
    const list = rows || [];
    for (let i = 0; i < list.length; i++) {
      if (test(toCond(list[i]), sample) === true) return { index: i, row: list[i] };
    }
    return { index: -1, row: null };
  }

  // 조건들이 참조하는 태그 id(폴링 대상 모으기용)
  function tagsOf(...conds) {
    const out = new Set();
    for (const c of conds) { const n = normalize(c); if (n && n.tag) out.add(n.tag); }
    return out;
  }

  // ---- 식(AST) → 읽을 글자 — 계산 태그의 식을 목록·미리보기에 보여 줄 때(hmi.md §5.3). 계산은 백엔드가 한다.
  //  노드: { tag } | { value } | { op, args }. 바깥(top)이 아니면 그리고/또는 묶음에 괄호
  const CMP = { eq: '=', ne: '≠', gt: '>', ge: '≥', lt: '<', le: '≤' };
  function exprText(n, top = true) {
    if (!n || typeof n !== 'object') return '?';
    if ('tag' in n) return String(n.tag);
    if ('value' in n) return typeof n.value === 'string' ? `"${n.value}"` : n.value === null ? '없음' : String(n.value);
    const a = (n.args || []), t = (i) => exprText(a[i], false);
    if (CMP[n.op]) return `${t(0)} ${CMP[n.op]} ${t(1)}`;
    if (n.op === 'range') return `${t(0)}이(가) ${a[1] && a[1].value != null ? t(1) : '…'} ~ ${a[2] && a[2].value != null ? t(2) : '…'}`;
    if (n.op === 'bitAny' || n.op === 'bitNone') {
      const bits = bitList(a[1] && a[1].value).join('·') || '?';
      return `${t(0)} 비트 ${bits} ${n.op === 'bitAny' ? (bits.includes('·') ? '중 하나라도 1' : '= 1') : (bits.includes('·') ? '모두 0' : '= 0')}`;
    }
    if (n.op === 'and' || n.op === 'or') { const s = a.map((x) => exprText(x, false)).join(n.op === 'and' ? ' 그리고 ' : ' 또는 '); return top ? s : `(${s})`; }
    if (n.op === 'not') return `아님(${exprText(a[0], true)})`;
    if (n.op === 'select') {
      const rows = []; for (let i = 0; i + 1 < a.length; i += 2) rows.push(`${exprText(a[i], true)} → ${t(i + 1)}`);
      return `${rows.join(', ')}, 그 외 → ${t(a.length - 1)}`;
    }
    return `${n.op}(${a.map((x) => exprText(x, true)).join(', ')})`;
  }
  // 식이 참조하는 태그 id(중복 없이)
  function exprTags(n, out = new Set()) {
    if (n && typeof n === 'object') { if ('tag' in n) out.add(String(n.tag)); else (n.args || []).forEach((x) => exprTags(x, out)); }
    return [...out];
  }

  window.WHMI.rules = { TESTS, test, pick, normalize, tagsOf, bitList, usable, same, num, exprText, exprTags };
})();
