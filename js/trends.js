(() => {

  // ── 채널 색상 팔레트 ────────────────────────────────────────────
  const PALETTE = [
    '#4da0ff', '#4cd96b', '#ffd84a', '#ff6b6b', '#c77dff',
    '#ff9a3c', '#00d4aa', '#ff5d8f', '#7bcfff', '#a8ff78',
    '#ffb347', '#87ceeb', '#dda0dd', '#98fb98', '#f0e68c', '#ff7f50',
  ];

  // ── 시간 범위 정의 ──────────────────────────────────────────────
  const RANGES = {
    '1h':  { sec:      3_600, label: '1시간'  },
    '6h':  { sec:     21_600, label: '6시간'  },
    '24h': { sec:     86_400, label: '24시간' },
    '7d':  { sec:    604_800, label: '7일'    },
    '30d': { sec:  2_592_000, label: '30일'   },
    '1y':  { sec: 31_536_000, label: '1년'    },
  };

  // 데이터 나이 + 범위 폭 기준 resolution 결정 (implement_plan.md 프론트엔드 연동 가이드)
  function calcResolution(fromMs, toMs) {
    const nowSec   = Math.floor(Date.now() / 1000);
    const fromSec  = Math.floor(fromMs / 1000);
    const ageSec   = nowSec - fromSec;
    const rangeSec = (toMs - fromMs) / 1000;

    if (ageSec > 3 * 365 * 86400) return '10m';
    if (ageSec > 365 * 86400)     return rangeSec > 30 * 86400 ? '10m' : '5m';

    if (rangeSec / 10  <= 1000) return 'raw';
    if (rangeSec / 300 <= 1000) return '5m';
    return '10m';
  }

  const RES_LABEL = { raw: 'RAW', '5m': '5m', '10m': '10m' };
  const RES_CLASS = { raw: 'raw', '5m': 'm5', '10m': 'm10' };

  // ── 런타임 상태 ─────────────────────────────────────────────────
  let _slots          = Array(16).fill(null); // 슬롯 인덱스 → 채널 id (null = 미사용)
  let _colorMap       = {};                   // id → 팔레트 색상
  let _visibleIds     = new Set();            // 차트 표시 채널 (stat card 토글)
  let _lastApiMeta    = {};                   // id → { name, unit, scale, isSigned, minValue, maxValue, avg?, min?, max? }
  let _lastChannelPts = {};                   // id → [{ ts(sec), v }]
  let _currentRange  = '24h';
  let _currentTo     = Date.now();
  let _chart         = null;
  let _fetching      = false;
  let _initialized   = false; // 첫 응답 후 슬롯/표시 초기화 완료 여부

  // ── DOM ─────────────────────────────────────────────────────────
  const rangeGroup   = $('#trendsRangeGroup');
  const prevBtn      = $('#trendPrevBtn');
  const nextBtn      = $('#trendNextBtn');
  const resolutionEl = $('#trendsResolutionBadge');
  const timeLabelEl  = $('#trendsTimeLabel');
  const statsRow     = $('#trendsStatsRow');
  const skeleton     = $('#trendsSkeleton');
  const emptyEl      = $('#trendsEmpty');

  // ── 유틸 ────────────────────────────────────────────────────────
  function rawToValue(raw, isSigned, scale) {
    const v = (isSigned && raw > 32767) ? raw - 65536 : raw;
    return v * (scale ?? 1);
  }

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function getTimeWindow() {
    return { from: _currentTo - RANGES[_currentRange].sec * 1000, to: _currentTo };
  }

  function formatTimeLabel(from, to) {
    const fmt = (ts) => {
      const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    return `${fmt(from)} ~ ${fmt(to)}`;
  }

  function showSkeleton() { if (skeleton) skeleton.hidden = false; if (emptyEl) emptyEl.hidden = true; }
  function hideSkeleton()  { if (skeleton) skeleton.hidden = true; }

  // ── 트렌드 데이터 API 호출 ──────────────────────────────────────
  // _slots가 초기화된 후부터 registers를 명시해 데이터 없는 채널도 meta를 수신한다.
  async function fetchTrendData() {
    const { from, to } = getTimeWindow();
    const fromSec    = Math.floor(from / 1000);
    const toSec      = Math.floor(to   / 1000);

    //---------------------------------------------------------//
    // 동적 resolution 결정 (from/to 기준) 
    //---------------------------------------------------------//
    const resolution = calcResolution(from, to);
    const regIds     = _slots.filter(Boolean).join(',');

    const query = `from=${fromSec}&to=${toSec}&resolution=${resolution}` +
                  (regIds ? `&registers=${regIds}` : '');

    const res = await apiFetch(`/api/trend/data?${query}`);

    if (!res.ok){
      throw new Error(`trend/data 오류: ${res.status}`);
    }

    return res.json();
  }

  // ── 응답의 configuredChannels로 슬롯 갱신 ──────────────────────
  function applyConfiguredChannels(list) {
    const newSlots = Array(16).fill(null);
    (list || []).slice(0, 16).forEach((id, i) => { newSlots[i] = id; });

    // 새 채널에 색상 배정 (슬롯 인덱스 기준으로 고정)
    newSlots.forEach((id, i) => {
      if (id !== null && !_colorMap[id]) _colorMap[id] = PALETTE[i % PALETTE.length];
    });

    const newSlotSet  = new Set(newSlots.filter(Boolean));
    const prevSlotSet = new Set(_slots.filter(Boolean));

    if (!_initialized) {
      // 첫 수신: 모든 레코딩 채널 기본 표시
      _visibleIds = new Set(newSlotSet);
      _initialized = true;
    } else {
      // 설정 변경 반영: 제거된 채널 숨기고, 새로 추가된 채널은 기본 표시
      prevSlotSet.forEach((id) => { if (!newSlotSet.has(id)) _visibleIds.delete(id); });
      newSlotSet.forEach((id)  => { if (!prevSlotSet.has(id)) _visibleIds.add(id); });
    }

    _slots = newSlots;
  }

  // ── 차트 렌더 ───────────────────────────────────────────────────
  async function renderChart() {
    if (_fetching) return;
    _fetching = true;

    const { from, to } = getTimeWindow();
    const resolution = calcResolution(from, to);

    if (resolutionEl) {
      resolutionEl.textContent = RES_LABEL[resolution];
      resolutionEl.className   = `trends-resolution-badge ${RES_CLASS[resolution]}`;
    }
    if (timeLabelEl) timeLabelEl.textContent = formatTimeLabel(from, to);

    if (emptyEl) emptyEl.hidden = true;
    showSkeleton();

    try {

      // Loading indicator를 보여주고 fetchTrendData() 호출
      // (fetchTrendData()는 configuredChannels, meta)
      const resp = await fetchTrendData();

      // configuredChannels로 슬롯/표시 채널 갱신 (항상 최신 설정 반영)
      applyConfiguredChannels(resp.configuredChannels);

      // 최신 메타/포인트 저장
      Object.entries(resp.meta || {}).forEach(([key, m]) => {
        _lastApiMeta[Number(key)] = m;
      });
      Object.entries(resp.channels || {}).forEach(([key, pts]) => {
        _lastChannelPts[Number(key)] = pts;
      });

      // 차트 dataset 구성 (_visibleIds 기준으로 필터)
      const datasets = [];
      _visibleIds.forEach((id) => {
        const pts = _lastChannelPts[id];
        if (!pts || pts.length === 0) return;

        const m        = _lastApiMeta[id];
        const color    = _colorMap[id] ?? '#8fa0b7';
        const isSigned = m?.isSigned ?? false;
        const scale    = m?.scale    ?? 1;
        const chartPts = pts.map((p) => ({ x: p.ts * 1000, y: rawToValue(p.v, isSigned, scale) }));

        datasets.push({
          label: m?.name ?? String(id), data: chartPts,
          borderColor: color,
          backgroundColor: hexToRgba(color, resolution !== 'raw' ? 0.07 : 0),
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
          tension: 0.3, fill: false,
          _chId: id,
        });
      });

      hideSkeleton();

      const showEmpty = datasets.length === 0;
      if (emptyEl) {
        emptyEl.hidden = !showEmpty;
        const p = emptyEl.querySelector('p');
        if (p && showEmpty) {
          p.textContent = _visibleIds.size === 0
            ? '표시할 채널이 없습니다'
            : '선택한 기간에 데이터가 없습니다';
        }
      }
      if (_chart) {
        _chart.data.datasets = datasets;
        _chart.options.scales.x.min = from;
        _chart.options.scales.x.max = to;
        _chart.update({ duration: 350, easing: 'easeOutQuart' });
      }

      renderStats();

    } catch (err) {
      hideSkeleton();
      
      console.error('trend data 로드 실패:', err);
      if (emptyEl) {
        emptyEl.hidden = false;
        const p = emptyEl.querySelector('p');
        if (p) p.textContent = '데이터를 불러올 수 없습니다';
      }
    } finally {
      _fetching = false;
    }
  }

  // ── 스탯 카드 렌더 ──────────────────────────────────────────────
  // 항상 16슬롯 전체 표시:
  //   레코딩 채널 + 차트 표시 중 → active
  //   레코딩 채널 + 차트 숨김   → hidden-ch (클릭 시 표시)
  //   미사용 슬롯               → unused (사용안함)
  function renderStats() {
    if (!statsRow) return;
    statsRow.innerHTML = '';

    _slots.forEach((id, i) => {
      const card = document.createElement('div');
      card.style.animationDelay = `${i * 18}ms`;

      if (id === null) {
        // 활성 카드와 동일한 DOM 구조(invisible)로 높이 확보, 텍스트는 absolute overlay
        card.className = 'trends-stat-card unused';
        card.innerHTML =
          `<div class="stat-unused-label">사용안함</div>` +
          `<div class="trends-stat-dot" aria-hidden="true" style="visibility:hidden"></div>` +
          `<div class="trends-stat-info" aria-hidden="true" style="visibility:hidden">` +
            `<div class="trends-stat-name">—</div>` +
            `<div class="trends-stat-values">` +
              `<span class="trends-stat-avg">—<span class="trends-stat-unit"> u</span></span>` +
              `<div class="trends-stat-minmax"><span>▲—</span><span>▼—</span></div>` +
            `</div>` +
          `</div>` +
          `<div class="trends-stat-sparkline" aria-hidden="true" style="visibility:hidden">` +
            `<svg width="52" height="22"></svg>` +
          `</div>`;
        statsRow.appendChild(card);
        return;
      }

      const visible  = _visibleIds.has(id);
      const color    = _colorMap[id] ?? '#8fa0b7';

      // 채널 이름: API meta → id 문자열 fallback (registers 명시로 항상 meta 수신)
      const apiMeta  = _lastApiMeta[id];
      const name     = apiMeta?.name     || String(id);
      const unit     = apiMeta?.unit     || '';
      const scale    = apiMeta?.scale    ?? 1;
      const isSigned = apiMeta?.isSigned ?? false;

      card.className = `trends-stat-card${visible ? ' active' : ' hidden-ch'}`;
      card.style.borderLeftColor = color;
      card.title = visible ? '클릭하여 차트에서 숨기기' : '클릭하여 차트에 표시';

      card.addEventListener('click', () => {
        if (_visibleIds.has(id)) _visibleIds.delete(id);
        else                      _visibleIds.add(id);
        renderChart();
      });

      const dotStyle = visible
        ? `background:${color};box-shadow:0 0 5px ${color}88`
        : 'background:#2a3a4e';

      const toggleIcon = visible ? '👁' : '⊘';

      const spark = visible ? buildSparkline(id, color) : '';
      let valHtml;
      if (visible && apiMeta?.avg !== undefined) {
        const scaleRef  = { scale };
        const avgStr    = RegFmt.value(rawToValue(apiMeta.avg, isSigned, scale), scaleRef);
        const maxStr    = apiMeta.max !== undefined ? RegFmt.value(rawToValue(apiMeta.max, isSigned, scale), scaleRef) : '—';
        const minStr    = apiMeta.min !== undefined ? RegFmt.value(rawToValue(apiMeta.min, isSigned, scale), scaleRef) : '—';
        valHtml =
          `<div class="trends-stat-values">` +
            `<span class="trends-stat-avg">${avgStr}<span class="trends-stat-unit"> ${unit}</span></span>` +
            `<div class="trends-stat-minmax">` +
              `<span>▲${maxStr}</span>` +
              `<span>▼${minStr}</span>` +
            `</div>` +
          `</div>`;
      } else {
        valHtml = `<div class="stat-hidden-label">${visible ? '데이터 없음' : '숨김'}</div>`;
      }

      card.innerHTML =
        `<div class="stat-toggle-btn">${toggleIcon}</div>` +
        `<div class="trends-stat-dot" style="${dotStyle}"></div>` +
        `<div class="trends-stat-info">` +
          `<div class="trends-stat-name">${name}</div>` +
          valHtml +
        `</div>` +
        (spark ? `<div class="trends-stat-sparkline">${spark}</div>` : '');

      statsRow.appendChild(card);
    });
  }

  // ── 스파크라인 (실제 데이터 기반) ──────────────────────────────
  function buildSparkline(id, color) {
    const pts = _lastChannelPts[id];
    if (!pts || pts.length < 2) return '';

    const meta     = _lastApiMeta[id];
    const isSigned = meta?.isSigned ?? false;
    const scale    = meta?.scale    ?? 1;

    const W = 52, H = 22;
    const vals  = pts.map((p) => rawToValue(p.v, isSigned, scale));
    const min   = Math.min(...vals);
    const max   = Math.max(...vals);
    const range = max - min || 1;
    const N     = vals.length;

    const points = vals.map((v, i) =>
      `${(i * W / (N - 1)).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`
    ).join(' ');

    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5"` +
      ` stroke-linejoin="round" stroke-linecap="round" opacity="0.8"/></svg>`;
  }

  // ── 시간 범위 전환 ───────────────────────────────────────────────
  function setRange(range) {
    _currentRange = range;
    _currentTo    = Date.now();
    if (nextBtn) nextBtn.disabled = false;
    $$('.trends-range-btn', rangeGroup).forEach((btn) =>
      btn.classList.toggle('active', btn.dataset.range === range)
    );
    renderChart();
  }

  // ── 크로스헤어 플러그인 ─────────────────────────────────────────
const crosshairPlugin = {
    id: 'crosshair',
    afterEvent(chart, args) {
      const e = args.event;
      if (!chart.chartArea) return;
      const { left, right } = chart.chartArea;
      const prev = chart._crosshairX;
      if (e.type === 'mousemove') {
        chart._crosshairX = (e.x >= left && e.x <= right) ? e.x : null;
      } else if (e.type === 'mouseout') {
        chart._crosshairX = null;
      }
      if (chart._crosshairX !== prev) args.changed = true;
    },
    afterDraw(chart) {
      const x = chart._crosshairX;
      if (x == null) return;

      const { ctx, chartArea: { top, bottom, left, right } } = chart;
      const val = chart.scales.x.getValueForPixel(x);
      if (val == null) return;

      // 수직 점선
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.strokeStyle = 'rgba(77,160,255,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();

      // 시간 레이블 박스
      const d = new Date(val), p = (n) => String(n).padStart(2, '0');
      const label = `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;

      ctx.font = '11px monospace';
      ctx.setLineDash([]);
      const padX = 8, bH = 19;
      const bW = ctx.measureText(label).width + padX * 2;
      const bX = Math.max(left, Math.min(x - bW / 2, right - bW));
      const bY = bottom + 5;

      ctx.fillStyle = 'rgba(14,22,34,0.92)';
      ctx.beginPath();
      ctx.roundRect(bX, bY, bW, bH, 4);
      ctx.fill();

      ctx.strokeStyle = 'rgba(77,160,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bX, bY, bW, bH, 4);
      ctx.stroke();

      ctx.fillStyle = '#8fa0b7';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bX + padX, bY + bH / 2);

      ctx.restore();
    },
  };

  // ── Chart.js 로드 ───────────────────────────────────────────────
  function loadChartJs() {
    return new Promise((resolve, reject) => {
      if (window.Chart) { resolve(); return; }
      const s = document.createElement('script');
      s.src = './assets/vendor/chart.min.js';
      s.onload = resolve; 
      s.onerror = reject;

      document.head.appendChild(s);
    });
  }

  // ── Chart.js 초기화 ─────────────────────────────────────────────
  async function initChart() {
    await loadChartJs();

    const canvas = $('#trendsChart');
    if (!canvas) return;

    _chart = new Chart(canvas, {
      type: 'line',
      data: { datasets: [] },
      plugins: [crosshairPlugin],
      options: {
        responsive: true, 
        maintainAspectRatio: false,
        animation:   { duration: 350, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(14,22,34,0.92)',
            borderColor: 'rgba(77,160,255,0.25)', borderWidth: 1,
            titleColor: '#8fa0b7', bodyColor: '#eaf2ff',
            padding: 10, cornerRadius: 8,
            callbacks: {
              title: (items) => {
                const ts = items[0]?.parsed?.x; if (!ts) return '';
                const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
              },
              label: (item) => {
                const id   = item.dataset._chId;
                const meta = _lastApiMeta[id];
                const unit = meta?.unit || '';
                const val  = RegFmt.value(item.parsed.y, { scale: meta?.scale ?? 1 });
                return ` ${item.dataset.label}  ${val}${unit ? ' ' + unit : ''}`;
              },
              labelColor: (item) => ({
                borderColor:     item.dataset.borderColor,
                backgroundColor: item.dataset.borderColor,
                borderRadius: 3,
              }),
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: Date.now() - RANGES[_currentRange].sec * 1000, max: Date.now(),
            ticks: {
              color: '#4a5f75', maxTicksLimit: 8,
              callback: (val) => {
                const d = new Date(val), p = (n) => String(n).padStart(2, '0');
                const date = `${d.getFullYear()}.${p(d.getMonth()+1)}.${p(d.getDate())}`;
                const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
                return RANGES[_currentRange].sec * 1000 <= 86_400_000
                  ? [date, time]
                  : date;
              },
            },
            grid:   { color: 'rgba(148,163,184,0.06)' },
            border: { color: 'rgba(148,163,184,0.12)' },
          },
          y: {
            ticks:  { color: '#4a5f75' },
            grid:   { color: 'rgba(148,163,184,0.06)' },
            border: { color: 'rgba(148,163,184,0.12)' },
          },
        },
      },
    });

  }

  // ── 이벤트 바인딩 ───────────────────────────────────────────────
  $$('.trends-range-btn', rangeGroup).forEach((btn) =>
    btn.addEventListener('click', () => setRange(btn.dataset.range))
  );

  if (prevBtn) prevBtn.addEventListener('click', () => {
    _currentTo -= RANGES[_currentRange].sec * 1000;
    if (nextBtn) nextBtn.disabled = false;
    renderChart();
  });

  if (nextBtn) nextBtn.addEventListener('click', () => {
    _currentTo = Math.min(_currentTo + RANGES[_currentRange].sec * 1000, Date.now());
    nextBtn.disabled = _currentTo >= Date.now();
    renderChart();
  });

  // ── 초기 실행 ───────────────────────────────────────────────────
  PageLoader.show();
  initChart()
    .then(() => renderChart())
    .then(() => PageLoader.hide(null))
    .catch((err) => {
      console.error('트렌드 초기화 실패:', err);
      PageLoader.showError('트렌드 데이터를 불러올 수 없습니다.');
    });

})();
