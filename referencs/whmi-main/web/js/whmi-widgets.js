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

  // ranges: [{ from?, to?, color }] — 첫 번째로 일치하는 구간의 색. from/to 생략 시 무한대.
  function rangeColor(ranges, v, fallback) {
    if (ranges && typeof v === 'number') {
      for (const r of ranges) {
        if ((r.from == null || v >= r.from) && (r.to == null || v <= r.to)) return r.color;
      }
    }
    return fallback;
  }

  function cylinderGradient(defs) {
    if (defs.querySelector('#whmi-cyl')) return;
    const lg = svg('linearGradient', { id: 'whmi-cyl', x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
    svg('stop', { offset: '0', 'stop-color': '#000', 'stop-opacity': 0.35 }, lg);
    svg('stop', { offset: '0.35', 'stop-color': '#fff', 'stop-opacity': 0.18 }, lg);
    svg('stop', { offset: '0.6', 'stop-color': '#fff', 'stop-opacity': 0.02 }, lg);
    svg('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': 0.35 }, lg);
  }

  // 숫자 표시 상자 (numeric, input 공용)
  function valueBox(g, w, p) {
    const fs = p.fontSize || Math.round(w.h * 0.55);
    svg('rect', { width: w.w, height: w.h, rx: 4, fill: p.bg, stroke: p.border, 'stroke-width': p.borderWidth || 1 }, g);
    const t = svg('text', { x: w.w - 8, y: w.h / 2, 'text-anchor': 'end', 'dominant-baseline': 'central', class: 'digits' }, g);
    const tv = svg('tspan', { 'font-size': fs }, t);
    const tu = svg('tspan', { 'font-size': Math.round(fs * 0.45), dx: 4, class: 'unit' }, t);
    return (info, color) => {
      tv.textContent = fmt(info);
      tv.setAttribute('fill', color);
      tu.textContent = p.showUnit === false ? '' : info.unit;
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
  register('numeric', {
    defaults: { color: '#7cfc9a', bg: '#0b0f14', border: '#2e3846', fontSize: null, ranges: null, showUnit: true },
    create(g, w, p) {
      const draw = valueBox(g, w, p);
      return { update: (info) => draw(info, rangeColor(p.ranges, info.value, p.color)) };
    },
  });

  register('lamp', {
    defaults: { onColor: '#2ecc71', offColor: '#3a4250', onValue: null, blink: false, text: '', fontSize: 15, textColor: '#e6e9ef' },
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
          const on = info.ok && (p.onValue != null ? info.value == p.onValue : !!info.value);
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
          const key = `${info.min}|${info.max}`;
          if (key !== scaleKey) {
            scaleKey = key;
            tickLabels.forEach((t, i) => {
              t.textContent = +(info.min + ((info.max - info.min) * i) / (p.ticks - 1)).toFixed(2);
            });
          }
        },
      };
    },
  });

  register('bar', {
    defaults: { orientation: 'v', fillColor: '#3fa7ff', bgColor: '#0b0f14', border: '#2e3846', ranges: null },
    create(g, w, p, ctx) {
      const clipId = `clip-${w.id}`;
      svg('rect', { width: w.w, height: w.h, rx: 3 }, svg('clipPath', { id: clipId }, ctx.defs));
      svg('rect', { width: w.w, height: w.h, rx: 3, fill: p.bgColor, stroke: p.border }, g);
      const level = svg('rect', { width: w.w, height: w.h, class: 'level' }, svg('g', { 'clip-path': `url(#${clipId})` }, g));
      const horizontal = p.orientation === 'h';
      return {
        update(info) {
          const r = ratio(info);
          level.style.transform = horizontal ? `translateX(${-w.w * (1 - r)}px)` : `translateY(${w.h * (1 - r)}px)`;
          level.setAttribute('fill', rangeColor(p.ranges, info.value, p.fillColor));
        },
      };
    },
  });

  register('gauge', {
    // 각도: 0° = 12시 방향, 시계방향 증가
    defaults: { startAngle: -135, endAngle: 135, arcColor: '#3fa7ff', trackColor: '#2a313c', ranges: null, title: '', thickness: null },
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

      svg('path', { d: arc(a0, a1, r), fill: 'none', stroke: p.trackColor, 'stroke-width': th }, g);
      const bands = svg('g', {}, g);
      const valueArc = svg('path', { fill: 'none', 'stroke-width': th }, g);
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
      let scaleKey = '';
      return {
        update(info) {
          const key = `${info.min}|${info.max}`;
          if (key !== scaleKey) {
            scaleKey = key;
            minText.textContent = info.min;
            maxText.textContent = info.max;
            bands.innerHTML = '';
            for (const rg of p.ranges || []) {
              const from = angleOf(rg.from == null ? info.min : rg.from, info);
              const to = angleOf(rg.to == null ? info.max : rg.to, info);
              svg('path', { d: arc(from, to, r + th / 2 + 5), fill: 'none', stroke: rg.color, 'stroke-width': 4 }, bands);
            }
          }
          valueArc.setAttribute('d', arc(a0, a0 + (a1 - a0) * ratio(info), r));
          valueArc.setAttribute('stroke', rangeColor(p.ranges, info.value, p.arcColor));
          valText.textContent = fmt(info);
          unitText.textContent = info.unit;
        },
      };
    },
  });

  // ---- 조작 위젯 (쓰기) -------------------------------------------------------
  register('button', {
    // action: "set" → value 기록, "toggle" → 현재 값 반전(bool)
    defaults: { text: '버튼', action: 'set', value: true, color: '#2d6cdf', activeColor: null, textColor: '#fff', fontSize: 16, confirm: null },
    create(g, w, p, ctx) {
      const bg = svg('rect', { width: w.w, height: w.h, rx: 6, fill: p.color }, g);
      svg('text', { x: w.w / 2, y: w.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': p.fontSize, 'font-weight': 600, fill: p.textColor }, g)
        .textContent = p.text;
      let cur;
      g.addEventListener('click', () => {
        if (g.classList.contains('readonly')) return;
        ctx.write(w, p.action === 'toggle' ? !cur : p.value, p.confirm);
      });
      return {
        update(info) {
          cur = info.value;
          g.classList.toggle('readonly', !info.writable);
          if (p.activeColor) bg.setAttribute('fill', info.ok && info.value ? p.activeColor : p.color);
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

  register('input', {
    defaults: { color: '#e6e9ef', bg: '#0b0f14', border: '#3fa7ff', borderWidth: 1.5, fontSize: null, showUnit: true },
    create(g, w, p, ctx) {
      const draw = valueBox(g, w, p);
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
          draw(info, p.color);
          g.classList.toggle('readonly', !info.writable);
        },
      };
    },
  });
})();
