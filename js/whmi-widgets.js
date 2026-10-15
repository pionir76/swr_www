// WHMI 기본 위젯 (v0.1)
// 각 위젯은 (0,0)~(w,h) 로컬 좌표에서 그린다. 위치 이동은 런타임이 <g transform>으로 처리.
(function () {
  'use strict';

  const { svg, register } = window.WHMI;

  // ---- 공통 헬퍼 ------------------------------------------------------------
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function ratio(info) {
    const span = info.max - info.min;
    if (!info.ok || typeof info.value !== 'number' || !(span > 0)) return 0;
    return clamp((info.value - info.min) / span, 0, 1);
  }

  function fmt(info) {
    if (!info.ok || info.value == null) return '----';
    return Number(info.value).toFixed(info.decimals);
  }

  // ---- 값 변화 애니메이션 ----------------------------------------------------
  // 막대 길이/게이지 호처럼 CSS transition이 안 먹는(또는 브라우저마다 다른) 도형을
  // requestAnimationFrame으로 보간한다. 진행 중에 새 값이 오면 "지금 그려진 값"에서
  // 이어서 움직여 튀지 않는다. 첫 값·품질 불량 직후·ms<=0·OS 동작 줄이기 설정이면 즉시 표시.
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  function animator(ms) {
    let cur = null;
    let raf = 0;
    return {
      to(target, draw) {
        cancelAnimationFrame(raf);
        if (cur == null || !(ms > 0) || reduceMotion || cur === target) {
          cur = target;
          draw(target);
          return;
        }
        const from = cur;
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / ms);
          cur = from + (target - from) * easeOut(k);
          draw(cur);
          if (k < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      // 값이 없거나 품질 불량 — 진행 중인 애니메이션을 멈추고 다음 값은 즉시 표시되게 함
      reset() {
        cancelAnimationFrame(raf);
        cur = null;
      },
    };
  }

  // ranges: [{ from?, to?, color }] — 첫 번째로 일치하는 구간의 색. from/to 생략 시 무한대.
  function matchRange(ranges, v) {
    if (ranges && typeof v === 'number') {
      for (const r of ranges) {
        if ((r.from == null || v >= r.from) && (r.to == null || v <= r.to)) return r;
      }
    }
    return null;
  }

  function rangeColor(ranges, v, fallback) {
    const r = matchRange(ranges, v);
    return r ? r.color : fallback;
  }

  function cylinderGradient(defs) {
    if (defs.querySelector('#whmi-cyl')) return;
    const lg = svg('linearGradient', { id: 'whmi-cyl', x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
    svg('stop', { offset: '0', 'stop-color': '#000', 'stop-opacity': 0.35 }, lg);
    svg('stop', { offset: '0.35', 'stop-color': '#fff', 'stop-opacity': 0.18 }, lg);
    svg('stop', { offset: '0.6', 'stop-color': '#fff', 'stop-opacity': 0.02 }, lg);
    svg('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': 0.35 }, lg);
  }

  // 막대 음영: 세로 막대는 탱크와 같은 좌우 음영(whmi-cyl), 가로 막대는 위아래 음영.
  function shadeGradient(defs, horizontal) {
    if (!horizontal) { cylinderGradient(defs); return 'whmi-cyl'; }
    const id = 'whmi-shade-h';
    if (!defs.querySelector(`#${id}`)) {
      const lg = svg('linearGradient', { id, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
      svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': 0.22 }, lg);
      svg('stop', { offset: '0.45', 'stop-color': '#fff', 'stop-opacity': 0.04 }, lg);
      svg('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': 0.35 }, lg);
    }
    return id;
  }

  // ---- 숫자 표시 상자 (numeric, input 공용) ---------------------------------
  // 7세그먼트 폰트 DSEG7(SIL OFL, assets/fonts) — 디바이스 웹서버에서 받으므로 OS 설치 불필요.
  // 소수점은 폭 0, '!'는 모든 세그먼트가 꺼진 한 자리(숫자와 같은 폭)라서, 잔상 "888.8"과
  // 실제 값을 '!'로 자릿수만 맞추면 어떤 정렬에서도 세그먼트 위치가 정확히 겹친다.
  if (document.fonts && document.fonts.load) {
    document.fonts.load('16px DSEG7').catch(() => {});
    document.fonts.load('italic 16px DSEG7').catch(() => {});
  }

  const FONT_FAMILY = { seg7: "'DSEG7', monospace", sans: "Pretendard, 'Malgun Gothic', sans-serif" };

  // preset: 색/효과 묶음 — 위젯 props가 프리셋보다 우선한다
  const BOX_PRESETS = {
    led: { font: 'seg7', bg: '#050505', border: '#1f1f1f', color: '#ff3b30', ghost: true, glow: true, captionColor: '#7a4a48', unitColor: '#a0605c' },
    lcd: { font: 'seg7', bg: '#a9bf8f', border: '#5d6f4c', color: '#1d2a14', ghost: true, ghostOpacity: 0.1, bevel: true, captionColor: '#3d4f2f', unitColor: '#2f3f22' },
    vfd: { font: 'seg7', bg: '#04161c', border: '#0f3440', color: '#46f0e0', ghost: true, glow: true, captionColor: '#2c7f78', unitColor: '#2fa59a' },
  };

  //  font         "mono"(기본, 고정폭) | "seg7"(7세그먼트) | "sans"
  //  italic       기울인 글꼴(seg7은 전용 BoldItalic 글꼴, 그 외는 브라우저 기울임)
  //  align        "end"(기본) | "start" | "center"
  //  ghost        꺼진 세그먼트 잔상(seg7 전용), ghostOpacity
  //  glow         숫자 발광
  //  caption      상자 왼쪽 위 이름표, captionColor
  //  unitPosition "right"(기본) | "below" | "none", unitColor
  //  radius/borderWidth, bevel(안쪽으로 파인 입체감), glass(위쪽 유리 반사)
  const BOX_DEFAULTS = {
    preset: null, font: 'mono', italic: false, align: 'end', fontSize: null, showUnit: true, unitPosition: 'right', unitColor: null,
    ghost: false, ghostOpacity: 0.14, glow: false, caption: '', captionColor: '#8a93a3',
    radius: 4, borderWidth: 1, bevel: false, glass: false,
  };

  const withPreset = (defaults, props) => Object.assign({}, defaults, props && BOX_PRESETS[props.preset], props);

  function glowFilter(defs, id, fs) {
    const fid = `glow-${id}`;
    if (!defs.querySelector(`#${fid}`)) {
      const f = svg('filter', { id: fid, x: '-30%', y: '-60%', width: '160%', height: '220%' }, defs);
      svg('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: Math.max(1.5, fs * 0.08), result: 'b' }, f);
      const m = svg('feMerge', {}, f);
      svg('feMergeNode', { in: 'b' }, m);
      svg('feMergeNode', { in: 'SourceGraphic' }, m);
    }
    return fid;
  }

  function boxShade(defs, kind) {
    const id = `whmi-box-${kind}`;
    if (!defs.querySelector(`#${id}`)) {
      const lg = svg('linearGradient', { id, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
      const stops = kind === 'bevel'
        ? [[0, '#000', 0.45], [0.25, '#000', 0], [0.85, '#fff', 0], [1, '#fff', 0.08]]
        : [[0, '#fff', 0.2], [1, '#fff', 0.02]];
      for (const [o, c, a] of stops) svg('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }, lg);
    }
    return id;
  }

  // 잔상 문자열: 값 범위(min/max)를 담을 수 있는 자릿수만큼 8 — 음수 범위면 부호 자리 하나 더
  function ghostOf(info) {
    const span = Math.max(Math.abs(info.min), Math.abs(info.max));
    const intDigits = String(Math.trunc(span)).length;
    return (info.min < 0 ? '8' : '') + '8'.repeat(intDigits) + (info.decimals > 0 ? `.${'8'.repeat(info.decimals)}` : '');
  }

  function valueBox(g, w, p, ctx) {
    const fs = p.fontSize || Math.round(w.h * 0.55);
    const seg = p.font === 'seg7';
    const bg = svg('rect', { width: w.w, height: w.h, rx: p.radius, fill: p.bg, stroke: p.border, 'stroke-width': p.borderWidth, class: 'num-bg' }, g);
    if (p.bevel) svg('rect', { width: w.w, height: w.h, rx: p.radius, fill: `url(#${boxShade(ctx.defs, 'bevel')})`, 'pointer-events': 'none' }, g);
    if (p.caption) {
      svg('text', { x: 6, y: 4, 'dominant-baseline': 'hanging', 'font-size': Math.max(9, Math.round(fs * 0.28)), fill: p.captionColor }, g)
        .textContent = p.caption;
    }
    const below = p.unitPosition === 'below';
    const unitT = svg('text', { 'font-size': Math.round(fs * 0.45), class: 'unit', 'text-anchor': 'end',
      ...(below ? { x: w.w - 6, y: w.h - 4 } : { x: w.w - 8, y: w.h / 2, 'dominant-baseline': 'central' }) }, g);
    if (p.unitColor) unitT.style.fill = p.unitColor;
    const digitText = () => {
      const t = svg('text', { y: w.h / 2, 'dominant-baseline': 'central', 'font-size': fs, class: 'digits' }, g);
      if (FONT_FAMILY[p.font]) t.style.fontFamily = FONT_FAMILY[p.font];  // CSS(.digits)보다 우선하도록 style로
      if (seg) t.style.fontWeight = 'normal';
      if (p.italic) t.style.fontStyle = 'italic';
      return t;
    };
    const ghostT = seg && p.ghost ? digitText() : null;
    const valT = digitText();
    if (ghostT) ghostT.setAttribute('fill-opacity', p.ghostOpacity);
    if (p.glow) valT.setAttribute('filter', `url(#${glowFilter(ctx.defs, w.id, fs)})`);
    if (p.glass) svg('rect', { width: w.w, height: w.h / 2, rx: p.radius, fill: `url(#${boxShade(ctx.defs, 'glass')})`, 'pointer-events': 'none' }, g);

    // 숫자 위치 — 단위가 오른쪽이면 단위 폭만큼 비켜서 정렬
    const place = () => {
      const unitW = !below && unitT.textContent ? unitT.getComputedTextLength() + 4 : 0;
      const right = w.w - 8 - unitW;
      const [x, anchor] = p.align === 'start' ? [8, 'start'] : p.align === 'center' ? [(8 + right) / 2, 'middle'] : [right, 'end'];
      for (const t of [ghostT, valT]) {
        if (!t) continue;
        t.setAttribute('x', x);
        t.setAttribute('text-anchor', anchor);
      }
    };
    place();

    return {
      bg,
      text: valT,
      // str: 표시할 숫자 문자열(또는 '----'), c: { text, bg, border } 색
      set(str, info, c) {
        const u = p.showUnit === false || p.unitPosition === 'none' ? '' : (info.unit || '');
        if (u !== unitT.textContent) { unitT.textContent = u; place(); }
        let s = str;
        if (ghostT) {
          const gs = ghostOf(info);
          if (ghostT.textContent !== gs) ghostT.textContent = gs;
          ghostT.style.fill = c.text;
          const pad = gs.replace('.', '').length - s.replace('.', '').length;
          if (pad > 0) s = '!'.repeat(pad) + s;
        }
        valT.textContent = s;
        valT.style.fill = c.text;  // CSS(.w .digits의 fill)보다 우선하도록 style로
        bg.setAttribute('fill', c.bg);
        bg.setAttribute('stroke', c.border);
      },
    };
  }

  // ---- 정적 요소 ------------------------------------------------------------
  register('rect', {
    defaults: { fill: '#1b212b', stroke: '#2e3846', strokeWidth: 1, radius: 8 },
    create(g, w, p) {
      svg('rect', { width: w.w, height: w.h, rx: p.radius, fill: p.fill, stroke: p.stroke, 'stroke-width': p.strokeWidth }, g);
    },
  });

  register('label', {
    defaults: { text: '', fontSize: 15, color: '#e6e9ef', align: 'left', bold: false },
    create(g, w, p) {
      const x = { left: 0, center: w.w / 2, right: w.w }[p.align];
      const anchor = { left: 'start', center: 'middle', right: 'end' }[p.align];
      const t = svg('text', {
        x, y: w.h / 2, 'text-anchor': anchor, 'dominant-baseline': 'central',
        'font-size': p.fontSize, 'font-weight': p.bold ? 700 : 400, fill: p.color,
      }, g);
      t.textContent = p.text;
    },
  });

  // ---- 표시 위젯 ------------------------------------------------------------
  //  ranges/rangeTarget  구간색을 "text"(기본) | "bg" | "border" 중 어디에 적용할지. 구간에 blink:true면 깜빡임
  //  animMs        숫자 카운트 애니메이션(기본 0=끔 — 계기 숫자는 실제로 없던 중간값이 보이지 않는 게 기본)
  //  flashOnChange 값이 바뀌는 순간 상자가 잠깐 밝아짐
  //  showTrend     직전 값보다 오르면 ▲, 내리면 ▼(오른쪽 위)
  const NUMERIC_DEFAULTS = Object.assign({}, BOX_DEFAULTS, {
    color: '#7cfc9a', bg: '#0b0f14', border: '#2e3846', ranges: null, rangeTarget: 'text',
    animMs: 0, flashOnChange: false, showTrend: false,
  });

  register('numeric', {
    defaults: NUMERIC_DEFAULTS,
    create(g, w, _p, ctx) {
      const p = withPreset(NUMERIC_DEFAULTS, w.props);
      const box = valueBox(g, w, p, ctx);
      const fs = p.fontSize || Math.round(w.h * 0.55);
      const trendT = p.showTrend
        ? svg('text', { x: w.w - 6, y: 4, 'dominant-baseline': 'hanging', 'text-anchor': 'end', 'font-size': Math.max(9, Math.round(fs * 0.3)) }, g)
        : null;
      const anim = animator(p.animMs);
      let prev = null;

      const flash = () => {
        box.bg.classList.remove('flash');
        void box.bg.getBoundingClientRect();  // 리플로우로 애니메이션 재시작
        box.bg.classList.add('flash');
      };

      return {
        update(info) {
          const ok = info.ok && typeof info.value === 'number';
          const target = ok ? info.value : null;
          const rg = matchRange(p.ranges, target);  // 구간 판정은 보간값이 아니라 실제 값 기준
          const rc = rg ? rg.color : null;
          const c = {
            text: p.rangeTarget === 'text' && rc ? rc : p.color,
            bg: p.rangeTarget === 'bg' && rc ? rc : p.bg,
            border: p.rangeTarget === 'border' && rc ? rc : p.border,
          };
          const blinkEl = p.rangeTarget === 'text' ? box.text : box.bg;
          box.text.classList.remove('blink-on');
          box.bg.classList.remove('blink-on');
          if (rg && rg.blink) blinkEl.classList.add('blink-on');

          const changed = ok && prev != null && target !== prev;
          if (changed && trendT) {
            trendT.textContent = target > prev ? '▲' : '▼';
            trendT.setAttribute('fill', c.text);
          }
          if (changed && p.flashOnChange) flash();
          if (ok) prev = target;

          const draw = (v) => box.set(v == null ? '----' : Number(v).toFixed(info.decimals), info, c);
          if (ok) anim.to(target, draw);
          else { anim.reset(); draw(null); }
        },
      };
    },
  });

  register('lamp', {
    // bit: 지정하면 값을 그대로 쓰지 않고 (value >> bit) & 1로 해당 비트만 뽑아 판정한다.
    // 레지스터 하나가 여러 상태를 비트로 묶어 담고 있을 때 쓴다(scale:1인 정수 태그 전제).
    defaults: { onColor: '#2ecc71', offColor: '#3a4250', onValue: null, bit: null, blink: false, text: '', fontSize: 15, textColor: '#e6e9ef' },
    create(g, w, p) {
      const d = p.text ? w.h : Math.min(w.w, w.h);
      const r = d / 2 - 2;
      const lamp = svg('circle', { cx: d / 2, cy: w.h / 2, r, stroke: '#0b0f14', 'stroke-width': 2, class: 'lamp' }, g);
      svg('circle', { cx: d / 2 - r * 0.3, cy: w.h / 2 - r * 0.3, r: r * 0.35, fill: '#fff', 'fill-opacity': 0.25 }, g);
      if (p.text) {
        svg('text', { x: d + 10, y: w.h / 2, 'dominant-baseline': 'central', 'font-size': p.fontSize, fill: p.textColor }, g)
          .textContent = p.text;
      }
      return {
        update(info) {
          let v = info.value;
          if (info.ok && p.bit != null && typeof v === 'number') v = (Math.trunc(v) >> p.bit) & 1;
          const on = info.ok && (p.onValue != null ? v == p.onValue : !!v);
          const color = on ? p.onColor : p.offColor;
          lamp.setAttribute('fill', color);
          lamp.style.filter = on ? `drop-shadow(0 0 ${r * 0.5}px ${color})` : '';
          lamp.classList.toggle('blink', on && p.blink);
        },
      };
    },
  });

  register('tank', {
    defaults: { fillColor: '#3fa7ff', bgColor: '#0b0f14', shellColor: '#4a5566', ranges: null, showValue: true, showScale: true, ticks: 5 },
    create(g, w, p, ctx) {
      cylinderGradient(ctx.defs);
      const bw = w.w - (p.showScale ? 44 : 0);
      const h = w.h;
      const rx = Math.min(bw * 0.18, 20);
      const clipId = `clip-${w.id}`;
      svg('rect', { width: bw, height: h, rx }, svg('clipPath', { id: clipId }, ctx.defs));

      svg('rect', { width: bw, height: h, rx, fill: p.bgColor }, g);
      const level = svg('rect', { width: bw, height: h, class: 'level' }, svg('g', { 'clip-path': `url(#${clipId})` }, g));
      svg('rect', { width: bw, height: h, rx, fill: 'url(#whmi-cyl)' }, g);
      svg('rect', { width: bw, height: h, rx, fill: 'none', stroke: p.shellColor, 'stroke-width': 2 }, g);

      const tickLabels = [];
      if (p.showScale) {
        for (let i = 0; i < p.ticks; i++) {
          const y = h - (h * i) / (p.ticks - 1);
          svg('line', { x1: bw + 4, x2: bw + 10, y1: y, y2: y, stroke: '#4a5566' }, g);
          tickLabels.push(svg('text', { x: bw + 13, y, 'dominant-baseline': 'central', class: 'scale' }, g));
        }
      }
      const val = p.showValue
        ? svg('text', { x: bw / 2, y: h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Math.round(bw * 0.17), class: 'outlined' }, g)
        : null;

      let scaleKey = '';
      return {
        update(info) {
          const r = ratio(info);
          level.style.transform = `translateY(${h * (1 - r)}px)`;
          level.setAttribute('fill', rangeColor(p.ranges, info.value, p.fillColor));
          if (val) val.textContent = `${fmt(info)} ${info.unit}`;
          const key = `${info.min}|${info.max}|${info.decimals}`;
          if (key !== scaleKey) {
            scaleKey = key;
            tickLabels.forEach((t, i) => {
              t.textContent = (info.min + ((info.max - info.min) * i) / (p.ticks - 1)).toFixed(info.decimals);
            });
          }
        },
      };
    },
  });

  // 막대 게이지. 좌표는 "주축(값 방향)"과 "교차축(두께 방향)"으로 계산한 뒤 pt()/box()로
  // 가로·세로를 바꿔 끼운다. 새 옵션은 전부 기본값이 꺼져 있어, 옵션 없이 쓰면 예전처럼
  // 박스 전체를 min부터 채우는 막대가 된다.
  //  thickness  트랙 두께(px). 생략 시 눈금/라벨/구간띠가 있으면 박스의 절반, 없으면 박스 전체
  //  showScale/ticks/minorTicks/tickLabels  눈금(주 눈금 개수, 사이 보조 눈금 수, 주 눈금 숫자)
  //  showMinMax  양 끝 min/max 숫자 — 눈금 숫자가 켜져 있으면 겹치므로 생략
  //  scalePosition  "after"(가로=아래, 세로=오른쪽) | "before"
  //  gradient   [{ at: 값, color }] 값 축 그라데이션 — 지정하면 ranges 색보다 우선
  //  shade      막대 음영(입체감)
  //  showValue  트랙 안에 현재 값 표시
  //  origin     채우기 기준값(예: 0이면 음수는 반대쪽으로). 생략 시 min부터
  //  showRanges ranges 구간을 트랙 옆 색 띠로 표시
  //  markers    [{ value, color? }] 고정값 기준선
  register('bar', {
    defaults: {
      orientation: 'v', fillColor: '#3fa7ff', bgColor: '#0b0f14', border: '#2e3846', ranges: null,
      thickness: null, radius: 3,
      showScale: false, ticks: 5, minorTicks: 0, tickLabels: true, showMinMax: false, scalePosition: 'after',
      gradient: null, shade: false, showValue: false, origin: null, showRanges: false, markers: null,
      tickColor: '#4a5566', labelColor: '#8a93a3', fontSize: 11, animMs: 400, valueAlign: 'end',
    },
    create(g, w, p, ctx) {
      const H = p.orientation === 'h';
      const L = H ? w.w : w.h;                       // 주축 길이
      const C = H ? w.h : w.w;                       // 교차축 길이
      // origin을 지정하면 기준값 라벨을 그리므로 라벨 자리도 확보한다
      const hasSide = p.showScale || p.showMinMax || p.showRanges || p.origin != null;
      const th = Math.min(C, p.thickness ?? (hasSide ? Math.round(C * 0.5) : C));
      const after = p.scalePosition !== 'before';
      const t0 = after ? 0 : C - th;                 // 트랙 시작(교차축)
      const dir = after ? 1 : -1;                    // 트랙에서 눈금 쪽으로 나가는 방향
      const edge = after ? t0 + th : t0;             // 눈금 쪽 트랙 가장자리
      const bandAt = edge + dir * 2;                 // 구간 띠(두께 4)
      const tickAt = edge + dir * (p.showRanges ? 8 : 2);
      const labelAt = tickAt + dir * (p.showScale ? 9 : 1);  // 눈금이 없으면 라벨을 트랙에 붙임

      const pt = (m, c) => (H ? { x: m, y: c } : { x: c, y: m });
      const box = (m0, ml, c0, cl) => {
        const c = Math.min(c0, c0 + cl);
        const ca = Math.abs(cl);
        return H ? { x: m0, y: c, width: ml, height: ca } : { x: c, y: m0, width: ca, height: ml };
      };
      // 값 → 주축 좌표(가로는 왼쪽이 min, 세로는 아래가 min)
      const mainOf = (v, mn, mx) => {
        const f = clamp((v - mn) / ((mx - mn) || 1), 0, 1);
        return H ? f * L : (1 - f) * L;
      };

      const clipId = `clip-${w.id}`;
      const track = box(0, L, t0, th);
      svg('rect', { ...track, rx: p.radius }, svg('clipPath', { id: clipId }, ctx.defs));
      svg('rect', { ...track, rx: p.radius, fill: p.bgColor, stroke: p.border }, g);
      const level = svg('rect', box(0, 0, t0, th), svg('g', { 'clip-path': `url(#${clipId})` }, g));
      if (p.shade) {
        svg('rect', { ...track, rx: p.radius, fill: `url(#${shadeGradient(ctx.defs, H)})`, 'pointer-events': 'none' }, g);
      }
      // 그라데이션은 트랙 전체 길이에 고정 — 채워진 만큼만 색이 드러난다(userSpaceOnUse)
      const gradId = `grad-${w.id}`;
      const grad = p.gradient
        ? svg('linearGradient', { id: gradId, gradientUnits: 'userSpaceOnUse',
            ...(H ? { x1: 0, y1: 0, x2: L, y2: 0 } : { x1: 0, y1: L, x2: 0, y2: 0 }) }, ctx.defs)
        : null;
      const scaleG = svg('g', {}, g);  // 눈금/라벨/구간 띠/마커 — min/max가 바뀌면 다시 그림
      const fs = Math.max(10, Math.min(16, Math.round(th * 0.55)));
      // valueAlign: "start"(가로=왼쪽, 세로=아래) | "center" | "end"(가로=오른쪽, 세로=위, 기본)
      //             | "follow"(채워진 막대 끝을 따라감 — 막대 안에 자리가 없으면 바깥 빈 트랙에)
      const cMid = t0 + th / 2;
      const fixedPos = {
        start: H ? { m: 6, anchor: 'start' } : { m: L - 10, anchor: 'middle' },
        center: { m: L / 2, anchor: 'middle' },
        end: H ? { m: L - 6, anchor: 'end' } : { m: 10, anchor: 'middle' },
      };
      const placeVal = (m, anchor) => {
        const q = pt(m, cMid);
        valText.setAttribute('x', q.x);
        valText.setAttribute('y', q.y);
        valText.setAttribute('text-anchor', anchor);
      };
      const valText = p.showValue
        ? svg('text', { 'dominant-baseline': 'central', 'font-size': fs, class: 'outlined' }, g)
        : null;
      if (valText) {
        const f = fixedPos[p.valueAlign] || fixedPos.end;
        placeVal(f.m, f.anchor);
      }

      // 라벨 숫자는 태그 소수 자릿수 그대로(정수로 떨어져도 100 → 100.0) — 값 표시와 자릿수를 맞춘다
      function label(v, m, dec) {
        const anchor = H ? (m <= 0.5 ? 'start' : m >= L - 0.5 ? 'end' : 'middle') : (after ? 'start' : 'end');
        const baseline = H ? (after ? 'hanging' : 'alphabetic') : 'central';
        svg('text', { ...pt(m, labelAt), 'text-anchor': anchor, 'dominant-baseline': baseline,
          'font-size': p.fontSize, fill: p.labelColor }, scaleG).textContent = Number(v).toFixed(dec);
      }

      function drawScale(mn, mx, dec) {
        scaleG.innerHTML = '';
        const labeled = [];  // 이미 라벨을 그린 값 — origin 라벨이 눈금/min/max와 겹치면 생략
        const lbl = (v) => { label(v, mainOf(v, mn, mx), dec); labeled.push(v); };
        if (grad) {
          grad.innerHTML = '';
          [...p.gradient].sort((a, b) => a.at - b.at).forEach((s) => {
            svg('stop', { offset: clamp((s.at - mn) / ((mx - mn) || 1), 0, 1), 'stop-color': s.color }, grad);
          });
        }
        if (p.showRanges) {
          for (const r of p.ranges || []) {
            const a = mainOf(r.from ?? mn, mn, mx);
            const b = mainOf(r.to ?? mx, mn, mx);
            svg('rect', { ...box(Math.min(a, b), Math.abs(a - b), bandAt, dir * 4), fill: r.color }, scaleG);
          }
        }
        if (p.showScale) {
          const minor = Math.max(0, p.minorTicks | 0);
          const steps = (Math.max(2, p.ticks) - 1) * (minor + 1);
          for (let i = 0; i <= steps; i++) {
            const major = i % (minor + 1) === 0;
            const v = mn + ((mx - mn) * i) / steps;
            const m = mainOf(v, mn, mx);
            const a = pt(m, tickAt);
            const b = pt(m, tickAt + dir * (major ? 6 : 3));
            svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: p.tickColor }, scaleG);
            if (major && p.tickLabels) lbl(v);
          }
        }
        if (p.showMinMax && !(p.showScale && p.tickLabels)) {
          lbl(mn);
          lbl(mx);
        }
        if (p.origin != null && p.origin >= mn && p.origin <= mx
            && !labeled.some((v) => Math.abs(v - p.origin) < 1e-9)) {
          lbl(p.origin);
        }
        for (const mk of p.markers || []) {
          const m = mainOf(mk.value, mn, mx);
          const a = pt(m, t0 - 3);
          const b = pt(m, t0 + th + 3);
          svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: mk.color || '#e6e9ef', 'stroke-width': 2 }, scaleG);
        }
      }

      const anim = animator(p.animMs);
      let scaleKey = '';
      return {
        update(info) {
          const key = `${info.min}|${info.max}|${info.decimals}`;
          if (key !== scaleKey) { scaleKey = key; drawScale(info.min, info.max, info.decimals); }
          // v: 지금 그릴 값(애니메이션 중엔 보간값) — null이면 빈 막대 + "----"
          const draw = (v) => {
            const a = mainOf(p.origin ?? info.min, info.min, info.max);  // 채우기 시작점
            const b = v == null ? a : mainOf(v, info.min, info.max);     // 채워진 막대 끝
            const m0 = Math.min(a, b);
            const ml = Math.abs(a - b);
            const r = box(m0, ml, t0, th);
            for (const k in r) level.setAttribute(k, r[k]);
            level.setAttribute('fill', grad ? `url(#${gradId})` : rangeColor(p.ranges, v, p.fillColor));
            if (valText) {
              const s = v == null ? '----' : Number(v).toFixed(info.decimals);
              valText.textContent = info.unit ? `${s} ${info.unit}` : s;
              if (p.valueAlign === 'follow') {
                // sd: 막대가 자라는 방향(주축 좌표 기준). 막대 안에 글자가 들어가면 끝 안쪽,
                // 아니면 끝 바깥쪽 빈 트랙에 둔다. 세로는 글자 높이, 가로는 글자 폭으로 판단.
                const sd = Math.sign(b - a) || (H ? 1 : -1);
                const need = H ? valText.getComputedTextLength() + 8 : fs + 6;
                const inside = ml >= need;
                const pad = H ? 4 : fs * 0.7;
                const m = inside ? b - sd * pad : b + sd * pad;
                const anchor = !H ? 'middle' : (sd > 0) === inside ? 'end' : 'start';
                placeVal(m, anchor);
              }
            }
          };
          if (info.ok && typeof info.value === 'number') {
            anim.to(info.value, draw);
          } else {
            anim.reset();
            draw(null);
          }
        },
      };
    },
  });

  register('gauge', {
    // 각도: 0° = 12시 방향, 시계방향 증가
    // lineCap: "butt"(각진 끝, 기본) | "round"(둥근 끝)
    defaults: { startAngle: -135, endAngle: 135, arcColor: '#3fa7ff', trackColor: '#2a313c', ranges: null, title: '', thickness: null, animMs: 400, lineCap: 'butt' },
    create(g, w, p) {
      const titleH = p.title ? 26 : 0;
      const areaH = w.h - titleH;
      const r = (Math.min(w.w, areaH) / 2) * 0.78;
      const th = p.thickness || r * 0.18;
      const cx = w.w / 2;
      const cy = areaH / 2 + r * 0.12;
      const a0 = p.startAngle;
      const a1 = p.endAngle;

      const pt = (a, rad) => {
        const t = (a * Math.PI) / 180;
        return [cx + rad * Math.sin(t), cy - rad * Math.cos(t)];
      };
      const arc = (from, to, rad) => {
        if (to - from < 0.05) return '';
        const [x0, y0] = pt(from, rad);
        const [x1, y1] = pt(to, rad);
        return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${rad} ${rad} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
      };

      // 둥근 끝은 선 두께의 절반만큼 호 밖으로 튀어나오므로, 그만큼(capDeg) 호를 안쪽으로
      // 줄여 그려야 눈에 보이는 시작·끝이 startAngle/endAngle과 정확히 맞는다.
      const round = p.lineCap === 'round';
      const capDeg = round ? ((th / 2) / r) * (180 / Math.PI) : 0;
      // 값 호: 둥근 끝이면 값이 0에 가까워도 시작점에 둥근 점 하나는 보이게(길이 0 경로)
      const valuePath = (to) => {
        const from = a0 + capDeg;
        const end = Math.max(from, to - capDeg);
        if (round && end - from < 0.05) {
          const [x, y] = pt(from, r);
          return `M${x.toFixed(2)} ${y.toFixed(2)}L${x.toFixed(2)} ${y.toFixed(2)}`;
        }
        return arc(from, end, r);
      };

      svg('path', { d: arc(a0 + capDeg, a1 - capDeg, r), fill: 'none', stroke: p.trackColor, 'stroke-width': th, 'stroke-linecap': p.lineCap }, g);
      const bands = svg('g', {}, g);
      const valueArc = svg('path', { fill: 'none', 'stroke-width': th, 'stroke-linecap': p.lineCap }, g);
      const valText = svg('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Math.round(r * 0.4), class: 'digits' }, g);
      const unitText = svg('text', { x: cx, y: cy + r * 0.38, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Math.round(r * 0.17), class: 'unit' }, g);
      const [mx0, my0] = pt(a0, r);
      const [mx1, my1] = pt(a1, r);
      const minText = svg('text', { x: mx0, y: my0 + th + 6, 'text-anchor': 'middle', class: 'scale' }, g);
      const maxText = svg('text', { x: mx1, y: my1 + th + 6, 'text-anchor': 'middle', class: 'scale' }, g);
      if (p.title) {
        svg('text', { x: cx, y: w.h - titleH / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 15, fill: '#e6e9ef' }, g)
          .textContent = p.title;
      }

      const angleOf = (v, info) => a0 + (a1 - a0) * clamp((v - info.min) / (info.max - info.min || 1), 0, 1);
      const anim = animator(p.animMs);
      let scaleKey = '';
      return {
        update(info) {
          const key = `${info.min}|${info.max}|${info.decimals}`;
          if (key !== scaleKey) {
            scaleKey = key;
            minText.textContent = Number(info.min).toFixed(info.decimals);
            maxText.textContent = Number(info.max).toFixed(info.decimals);
            bands.innerHTML = '';
            for (const rg of p.ranges || []) {
              const from = angleOf(rg.from == null ? info.min : rg.from, info);
              const to = angleOf(rg.to == null ? info.max : rg.to, info);
              svg('path', { d: arc(from, to, r + th / 2 + 5), fill: 'none', stroke: rg.color, 'stroke-width': 4 }, bands);
            }
          }
          unitText.textContent = info.unit;
          const draw = (v) => {
            valueArc.setAttribute('d', v == null ? '' : valuePath(angleOf(v, info)));
            valueArc.setAttribute('stroke', rangeColor(p.ranges, v, p.arcColor));
            valText.textContent = v == null ? '----' : Number(v).toFixed(info.decimals);
          };
          if (info.ok && typeof info.value === 'number') {
            anim.to(info.value, draw);
          } else {
            anim.reset();
            draw(null);
          }
        },
      };
    },
  });

  // ---- 조작 위젯 (쓰기) -------------------------------------------------------
  register('button', {
    // action: "set" → value 기록, "toggle" → 현재 값이 onValue면 offValue로, 아니면
    // onValue로 씀(switch 위젯과 동일한 값 비교 방식 — 불리언 전제의 !cur 반전이 아님.
    // 숫자형이면서 on/off 의미가 반전된 태그(예: 0=운전,1=정지)도 올바르게 토글된다).
    // onText/offText: 지정하면 현재 상태(onValue 일치 여부)에 따라 버튼 라벨도 바뀐다
    // (예: "운전"/"정지"). 생략 시 text 고정 — 기존 화면은 그대로 동작.
    defaults: { text: '버튼', action: 'set', value: true, onValue: true, offValue: false, onText: null, offText: null, color: '#2d6cdf', activeColor: null, textColor: '#fff', fontSize: 16, confirm: null },
    create(g, w, p, ctx) {
      const bg = svg('rect', { width: w.w, height: w.h, rx: 6, fill: p.color }, g);
      const label = svg('text', { x: w.w / 2, y: w.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': p.fontSize, 'font-weight': 600, fill: p.textColor }, g);
      label.textContent = p.text;
      let cur;
      g.addEventListener('click', () => {
        if (g.classList.contains('readonly')) return;
        const next = p.action === 'toggle' ? (cur == p.onValue ? p.offValue : p.onValue) : p.value;
        ctx.write(w, next, p.confirm);
      });
      return {
        update(info) {
          cur = info.value;
          g.classList.toggle('readonly', !info.writable);
          const isOn = info.ok && info.value == p.onValue;
          if (p.onText != null || p.offText != null) {
            label.textContent = isOn ? (p.onText ?? p.text) : (p.offText ?? p.text);
          }
          if (p.activeColor) bg.setAttribute('fill', isOn ? p.activeColor : p.color);
        },
      };
    },
  });

  register('switch', {
    defaults: { onColor: '#2b7a4b', offColor: '#3a4250', onText: 'ON', offText: 'OFF', onValue: true, offValue: false, confirm: null },
    create(g, w, p, ctx) {
      const h = w.h;
      const track = svg('rect', { width: w.w, height: h, rx: h / 2 }, g);
      const label = svg('text', { y: h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': Math.round(h * 0.4), 'font-weight': 600, fill: '#e6e9ef' }, g);
      const knob = svg('circle', { cx: h / 2, cy: h / 2, r: h / 2 - 4, fill: '#e6e9ef', class: 'knob' }, g);
      let on = false;
      g.addEventListener('click', () => {
        if (g.classList.contains('readonly')) return;
        ctx.write(w, on ? p.offValue : p.onValue, p.confirm);
      });
      return {
        update(info) {
          on = info.ok && info.value == p.onValue;
          track.setAttribute('fill', on ? p.onColor : p.offColor);
          knob.style.transform = on ? `translateX(${w.w - h}px)` : '';
          label.setAttribute('x', on ? (w.w - h) / 2 + 4 : (w.w + h) / 2 - 4);
          label.textContent = on ? p.onText : p.offText;
          g.classList.toggle('readonly', !info.writable);
        },
      };
    },
  });

  // 숫자 상자의 폰트/테두리/프리셋 옵션은 numeric과 공유(애니메이션·깜빡임·추세는 입력창엔 없음)
  const INPUT_DEFAULTS = Object.assign({}, BOX_DEFAULTS, { color: '#e6e9ef', bg: '#0b0f14', border: '#3fa7ff', borderWidth: 1.5 });

  register('input', {
    defaults: INPUT_DEFAULTS,
    create(g, w, _p, ctx) {
      const p = withPreset(INPUT_DEFAULTS, w.props);
      const box = valueBox(g, w, p, ctx);
      const draw = (info) => box.set(fmt(info), info, { text: p.color, bg: p.bg, border: p.border });
      let last;
      g.addEventListener('click', async () => {
        if (!last || !last.writable) return;
        const v = await ctx.inputDialog({
          title: last.tag.name || w.tag,
          value: last.ok ? last.value : null,
          min: last.min, max: last.max, decimals: last.decimals, unit: last.unit,
        });
        if (v != null) ctx.write(w, v, p.confirm);
      });
      return {
        update(info) {
          last = info;
          draw(info);
          g.classList.toggle('readonly', !info.writable);
        },
      };
    },
  });

  // 로터리 셀렉터(산업용 판넬의 돌리는 노브). options의 각 위치를 startAngle~endAngle에
  // 고르게 배치한다(각도: 0° = 12시, 시계방향 +). 라벨을 누르면 그 위치로, 노브를 누르면
  // 다음 위치로 간다. 현재 값이 어느 option과도 같지 않으면 노브는 12시, 라벨 강조 없음.
  register('selector', {
    defaults: {
      options: [{ value: false, text: 'OFF' }, { value: true, text: 'ON' }],
      startAngle: -45, endAngle: 45,
      ringColor: '#1b212b', knobColor: '#3a4250', handleColor: '#5a6678',
      labelColor: '#8a93a3', activeColor: '#2ecc71', fontSize: 14, confirm: null, animMs: 300,
    },
    create(g, w, p, ctx) {
      const opts = p.options || [];
      const n = opts.length;
      const angleAt = (i) => (n <= 1 ? 0 : p.startAngle + ((p.endAngle - p.startAngle) * i) / (n - 1));
      const labelGap = p.fontSize + 6;
      const R = Math.max(10, Math.min(w.w / 2 - 40, w.h - labelGap * 2) * 0.55);
      const cx = w.w / 2;
      const cy = w.h - R - 6;
      const pos = (a, rad) => {
        const t = (a * Math.PI) / 180;
        return { x: cx + rad * Math.sin(t), y: cy - rad * Math.cos(t) };
      };

      svg('circle', { cx, cy, r: R, fill: p.ringColor, stroke: '#2e3846', 'stroke-width': 2 }, g);
      const labels = opts.map((o, i) => {
        const a = angleAt(i);
        const d = pos(a, R - 4);
        svg('circle', { cx: d.x, cy: d.y, r: 2.5, fill: p.labelColor }, g);  // 위치 눈금 점
        const q = pos(a, R + labelGap);
        const t = svg('text', {
          x: q.x, y: q.y, 'dominant-baseline': 'central', 'font-size': p.fontSize, 'font-weight': 600,
          'text-anchor': a < -5 ? 'end' : a > 5 ? 'start' : 'middle', fill: p.labelColor, 'data-i': i,
        }, g);
        t.textContent = o.text;
        return t;
      });
      const knob = svg('g', {}, g);
      const kr = R * 0.74;
      svg('circle', { cx, cy, r: kr, fill: p.knobColor, stroke: '#0b0f14', 'stroke-width': 2 }, knob);
      const hw = Math.max(8, kr * 0.42);
      svg('rect', { x: cx - hw / 2, y: cy - kr + 2, width: hw, height: kr * 2 - 4, rx: hw / 2, fill: p.handleColor }, knob);
      svg('line', { x1: cx, y1: cy, x2: cx, y2: cy - kr + 6, stroke: '#e6e9ef', 'stroke-width': 3, 'stroke-linecap': 'round' }, knob);

      const rotate = (a) => knob.setAttribute('transform', `rotate(${a} ${cx} ${cy})`);
      rotate(0);
      const anim = animator(p.animMs);
      let cur;
      let curIdx = -1;

      const choose = (i) => {
        if (g.classList.contains('readonly') || i < 0 || i >= n || i === curIdx) return;
        ctx.write(w, opts[i].value, p.confirm);
      };
      g.addEventListener('click', (e) => {
        const i = e.target.getAttribute && e.target.getAttribute('data-i');
        if (i != null) choose(Number(i));
        else if (n) choose((curIdx + 1) % n);  // 노브/링 클릭 — 다음 위치(현재 미정이면 첫 위치)
      });

      return {
        update(info) {
          cur = info.value;
          g.classList.toggle('readonly', !info.writable);
          curIdx = info.ok ? opts.findIndex((o) => o.value == cur) : -1;
          labels.forEach((t, i) => {
            t.setAttribute('fill', i === curIdx ? p.activeColor : p.labelColor);
          });
          if (curIdx >= 0) anim.to(angleAt(curIdx), rotate);
          else { anim.reset(); rotate(0); }
        },
      };
    },
  });

  // ---- 화면 전환 위젯 -------------------------------------------------------
  register('screenlink', {
    // mode: "replace"(현재 화면을 통째로 교체) — "modal"은 아직 미지원(후속 작업).
    // 태그 바인딩이 없는 위젯이라 값 폴링과 무관하게 항상 클릭 가능하다.
    defaults: { text: '화면 이동', screen: null, mode: 'replace', color: '#3a4250', textColor: '#e6e9ef', fontSize: 16 },
    create(g, w, p, ctx) {
      svg('rect', { width: w.w, height: w.h, rx: 6, fill: p.color }, g);
      svg('text', { x: w.w / 2, y: w.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': p.fontSize, 'font-weight': 600, fill: p.textColor }, g)
        .textContent = p.text;
      g.addEventListener('click', () => {
        if (!p.screen) return;
        if (p.mode === 'replace' || !p.mode) ctx.goto(p.screen);
      });
      return {};
    },
  });
})();
