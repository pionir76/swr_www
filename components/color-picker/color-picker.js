// 색 선택 창 — 색 판(채도·밝기) · 색상 바 · 투명도 바 · 8자리 값 · R G B A · 확인/취소. 제목 줄을 끌어 옮길 수 있다.
// 다른 코드에 기대지 않는 독립 부품이다. 이 폴더(color-picker.js, color-picker.css)만 복사하면 다른 프로젝트에서도 쓴다.
// 스타일은 이 파일이 자기 위치 옆의 color-picker.css를 한 번 불러온다(따로 <link>를 넣지 않아도 됨).
// 사용법·옵션은 같은 폴더의 README.md.
//
// 화면에 보이는 글자는 영어로 통일한다(Color picker, Cancel, OK).
//
//   ColorPicker.open(anchor, { value, alpha, onInput(v), onChange(v), onClose(ok) })
//     anchor    창을 띄울 기준 요소(그 아래에 뜨고, 자리가 없으면 위·왼쪽으로)
//     value     '#rrggbb' 또는 '#rrggbbaa'
//     alpha     false면 투명도 바·A 칸 없이
//     onInput   끄는 동안·입력할 때마다          onChange  한 번의 조작이 끝났을 때(놓았을 때, 입력 확정)
//     onClose(ok)  창이 닫힐 때. ok=true 확인([확인]·바깥 클릭·Enter), false 취소([취소]·Esc)
//                  — 끄는 동안 이미 onInput으로 알렸으므로, 취소면 부르는 쪽이 처음 상태로 되돌린다
//   돌려주는 값: 투명도 100%면 '#rrggbb', 미만이면 '#rrggbbaa'(소문자)
//   ColorPicker.close(ok) · ColorPicker.show(v) → '#RRGGBBAA' 표시용 · ColorPicker.parse(v) → { r, g, b, a(0~100) }
(function () {
  'use strict';
  // 스타일 불러오기 — 이 스크립트와 같은 폴더의 color-picker.css
  const BASE = (document.currentScript && document.currentScript.src || '').replace(/[^/]*$/, '');
  function loadCss() {
    if (document.querySelector('link[data-color-picker]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = `${BASE}color-picker.css`; l.dataset.colorPicker = '';
    document.head.appendChild(l);
  }
  loadCss();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

  function hsv2rgb(h, s, v) {
    const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5) * 255, f(3) * 255, f(1) * 255];
  }
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
  }
  // '#rrggbb[aa]' → { r, g, b, a(0~100) } 또는 null
  function parse(v) {
    const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(v || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: m[2] ? Math.round((parseInt(m[2], 16) * 100) / 255) : 100 };
  }
  const alphaHex = (a) => hex2((clamp(a, 0, 100) * 255) / 100);
  // 화면 표시용: 항상 대문자 8자리
  const show = (v) => { const c = parse(v); return c ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${alphaHex(c.a)}`.toUpperCase() : String(v || ''); };

  let current = null;   // 열려 있는 창 { el, close }

  // ok === false일 때만 취소. 그 밖(인자 없음·이벤트 객체)은 확인으로 닫는다
  function close(ok) {
    if (!current) return;
    const c = current;
    current = null;
    document.removeEventListener('pointerdown', c.onOutside, true);
    document.removeEventListener('keydown', c.onKey, true);
    window.removeEventListener('resize', c.onResize);
    c.el.remove();
    if (c.onClose) c.onClose(ok !== false);
  }

  function open(anchor, opts = {}) {
    close();
    const useAlpha = opts.alpha !== false;
    const init = parse(opts.value) || { r: 0, g: 0, b: 0, a: 100 };
    let [h, s, v] = rgb2hsv(init.r, init.g, init.b);
    let a = useAlpha ? init.a : 100;

    const el = document.createElement('div');
    el.className = 'cpk';
    el.innerHTML = `
      <div class="cpk-head" data-move title="Drag to move">Color picker</div>
      <div class="cpk-sv" data-drag="sv"><span class="cpk-dot"></span></div>
      <div class="cpk-bar cpk-hue" data-drag="hue"><span class="cpk-knob"></span></div>
      ${useAlpha ? '<div class="cpk-bar cpk-chk" data-drag="alpha"><div class="cpk-alpha"></div><span class="cpk-knob"></span></div>' : ''}
      <div class="cpk-row"><span class="cpk-sw cpk-chk"><i></i></span><input class="cpk-hex" data-in="hex" spellcheck="false" maxlength="9"></div>
      <div class="cpk-nums${useAlpha ? '' : ' no-a'}">
        <label>R<input data-in="r" inputmode="numeric"></label><label>G<input data-in="g" inputmode="numeric"></label><label>B<input data-in="b" inputmode="numeric"></label>
        ${useAlpha ? '<label>A (%)<input data-in="a" inputmode="numeric"></label>' : ''}
      </div>
      <div class="cpk-btns"><button type="button" data-act="cancel" title="Revert and close (Esc)">Cancel</button><button type="button" data-act="ok" class="primary" title="Apply and close (Enter)">OK</button></div>`;
    // 전체 화면 중에는 전체 화면 요소 안에 있어야 보인다
    (document.fullscreenElement || document.body).appendChild(el);
    const q = (sel) => el.querySelector(sel);

    const rgb = () => hsv2rgb(h, s, v).map(Math.round);
    const value = () => { const [r, g, b] = rgb(); return `#${hex2(r)}${hex2(g)}${hex2(b)}${a >= 100 ? '' : alphaHex(a)}`; };
    // skip: 지금 입력 중인 칸(값을 덮어쓰지 않는다)
    const paint = (skip) => {
      const [r, g, b] = rgb();
      q('.cpk-sv').style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))`;
      Object.assign(q('.cpk-dot').style, { left: `${s * 100}%`, top: `${(1 - v) * 100}%` });
      q('.cpk-hue .cpk-knob').style.left = `${(h / 360) * 100}%`;
      if (useAlpha) {
        q('.cpk-alpha').style.background = `linear-gradient(to right, rgba(${r},${g},${b},0), rgb(${r},${g},${b}))`;
        q('.cpk-chk .cpk-knob').style.left = `${a}%`;
      }
      q('.cpk-sw i').style.background = `rgba(${r},${g},${b},${a / 100})`;
      const set = (k, val) => { const i = q(`[data-in="${k}"]`); if (i && i !== skip) i.value = val; };
      set('hex', useAlpha ? show(value()) : `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase());
      set('r', r); set('g', g); set('b', b); set('a', Math.round(a));
    };
    const emit = (done, skip) => {
      paint(skip);
      if (opts.onInput) opts.onInput(value());
      if (done && opts.onChange) opts.onChange(value());
    };

    // 제목 줄을 잡고 끌면 창 이동(화면 밖으로는 나가지 않음). 위치는 기억하지 않는다 — 다음엔 다시 색 칸 옆에 뜬다
    el.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('[data-move]')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => Object.assign(el.style, {
        left: `${clamp(ev.clientX - dx, 0, Math.max(0, window.innerWidth - r.width))}px`,
        top: `${clamp(ev.clientY - dy, 0, Math.max(0, window.innerHeight - r.height))}px`,
      });
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); el.classList.remove('moving'); };
      el.classList.add('moving');
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    // 색 판·바 끌기
    el.addEventListener('pointerdown', (e) => {
      const area = e.target.closest('[data-drag]');
      if (!area) return;
      e.preventDefault();
      const kind = area.dataset.drag;
      const at = (ev) => {
        const r = area.getBoundingClientRect();
        const x = clamp((ev.clientX - r.left) / r.width, 0, 1), y = clamp((ev.clientY - r.top) / r.height, 0, 1);
        if (kind === 'sv') { s = x; v = 1 - y; } else if (kind === 'hue') h = Math.min(359.999, x * 360); else a = Math.round(x * 100);
        emit(false);
      };
      const up = () => { document.removeEventListener('pointermove', at); document.removeEventListener('pointerup', up); emit(true); };
      document.addEventListener('pointermove', at);
      document.addEventListener('pointerup', up);
      at(e);
    });
    // 값 직접 입력
    el.addEventListener('input', (e) => {
      const i = e.target, k = i.dataset.in;
      if (!k) return;
      if (k === 'hex') {
        const c = parse(i.value);
        if (!c) return;
        [h, s, v] = rgb2hsv(c.r, c.g, c.b);
        if (useAlpha) a = c.a;
      } else {
        const n = Number(i.value);
        if (i.value.trim() === '' || !Number.isFinite(n)) return;
        if (k === 'a') a = clamp(Math.round(n), 0, 100);
        else { const c = rgb(); c['rgb'.indexOf(k)] = clamp(Math.round(n), 0, 255); [h, s, v] = rgb2hsv(c[0], c[1], c[2]); }
      }
      emit(false, i);
    });
    el.addEventListener('change', (e) => { if (e.target.dataset.in) emit(true); });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) close(b.dataset.act === 'ok');
    });

    // 위치: 칸 아래 왼쪽 정렬. 화면을 넘으면 위·왼쪽으로
    const place = () => {
      const r = anchor.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight, gap = 6;
      let x = r.left, y = r.bottom + gap;
      if (y + hh > window.innerHeight - 8) y = r.top - hh - gap;
      if (y < 8) y = Math.max(8, window.innerHeight - hh - 8);
      x = clamp(x, 8, Math.max(8, window.innerWidth - w - 8));
      Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
    };

    // 바깥 클릭·Enter는 확인, Esc는 취소
    const onOutside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(true); };
    const onKey = (e) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      e.preventDefault(); e.stopPropagation();   // 편집기의 Esc(선택 해제)·대화상자까지 가지 않게
      if (e.key === 'Enter' && e.target.dataset && e.target.dataset.in) emit(true);
      close(e.key === 'Enter');
    };
    const onResize = () => close(true);
    current = { el, anchor, onOutside, onKey, onResize, onClose: opts.onClose };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    paint();
    place();
    return { close };
  }

  window.ColorPicker = { open, close, show, parse, isOpenFor: (anchor) => !!current && current.anchor === anchor };
})();
