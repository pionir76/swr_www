(() => {
  // ── DOM refs ─────────────────────────────────────────────────────────────────
  const levelSel   = $('#logLevelSel');
  const fromDate   = $('#logFromDate');
  const toDate     = $('#logToDate');
  const searchBtn  = $('#logSearchBtn');
  const resetBtn   = $('#logResetBtn');

  const kpiTotal   = $('#logKpiTotal');
  const kpiInfo    = $('#logKpiInfo');
  const kpiWarn    = $('#logKpiWarn');
  const kpiError   = $('#logKpiError');

  const countLabel = $('#logCountLabel');
  const tbody      = $('#logTableBody');
  const pageInfo   = $('#logPageInfo');
  const pagination = $('#logPagination');

  // ── State ─────────────────────────────────────────────────────────────────────
  const PAGE_SIZE = 18;
  let serverTotal = 0;
  let currentPage = 1;
  let isFirstLoad = true;

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function fmtTimestamp(val) {
    if (!val) return '—';
    const d = new Date(val);
    if (isNaN(d)) return String(val);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function levelBadge(level) {
    const cls = level === 'INFO' ? 'log-info' : level === 'WARN' ? 'log-warn' : 'log-error';
    return `<span class="log-level-badge ${cls}">${level}</span>`;
  }

  // ── KPI: 레벨별 3 병렬 요청 (limit=1 → total만 취득) ─────────────────────────
  async function fetchKpi() {
    const fr = fromDate?.value;
    const to = toDate?.value;

    function kpiParams(level) {
      const p = new URLSearchParams({ level, limit: '1', offset: '0' });
      if (fr) p.set('from', fr);
      if (to) p.set('to',   `${to}T23:59:59`);
      return p;
    }

    try {
      const [iRes, wRes, eRes] = await Promise.all([
        apiFetch(`/api/logs?${kpiParams('INFO')}`).then(r  => r.json()),
        apiFetch(`/api/logs?${kpiParams('WARN')}`).then(r  => r.json()),
        apiFetch(`/api/logs?${kpiParams('ERROR')}`).then(r => r.json()),
      ]);
      const info = iRes.total ?? 0;
      const warn = wRes.total ?? 0;
      const err  = eRes.total ?? 0;
      if (kpiTotal) kpiTotal.textContent = (info + warn + err).toLocaleString();
      if (kpiInfo)  kpiInfo.textContent  = info.toLocaleString();
      if (kpiWarn)  kpiWarn.textContent  = warn.toLocaleString();
      if (kpiError) kpiError.textContent = err.toLocaleString();
    } catch (e) {
      console.warn('[Logs] fetchKpi:', e);
    }
  }

  // ── 테이블 렌더링 ─────────────────────────────────────────────────────────────
  function renderTable(logs) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!logs.length) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#5a6b7e;padding:36px 0">로그 없음</td></tr>`;
      return;
    }
    const frag = document.createDocumentFragment();
    logs.forEach(l => {
      const tr = document.createElement('tr');
      const lvCls = l.level === 'INFO' ? 'log-row-info' : l.level === 'WARN' ? 'log-row-warn' : 'log-row-error';
      tr.className = lvCls;
      tr.innerHTML = `
        <td class="log-ts">${fmtTimestamp(l.timestamp)}</td>
        <td>${levelBadge(l.level)}</td>
        <td class="log-msg">${l.message || ''}</td>
      `;
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  function renderMeta(logs) {
    const totalPages = Math.max(1, Math.ceil(serverTotal / PAGE_SIZE));
    const start      = (currentPage - 1) * PAGE_SIZE + 1;
    const end        = start - 1 + logs.length;

    if (countLabel) {
      countLabel.textContent = serverTotal ? `(${serverTotal.toLocaleString()}건)` : '';
    }
    if (pageInfo) {
      pageInfo.textContent = serverTotal
        ? `${start.toLocaleString()}–${end.toLocaleString()} / 전체 ${serverTotal.toLocaleString()}건`
        : '';
    }
    renderPagination(totalPages);
  }

  // ── 페이지네이션 ─────────────────────────────────────────────────────────────
  function renderPagination(totalPages) {
    if (!pagination) return;
    pagination.innerHTML = '';

    function makeBtn(label, page, active = false, disabled = false) {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (active)   btn.classList.add('active');
      btn.disabled = disabled;
      if (!disabled) btn.addEventListener('click', () => {
        currentPage = page;
        fetchLogs(false);
      });
      return btn;
    }

    function makeEllipsis() {
      const sp = document.createElement('span');
      sp.className = 'page-ellipsis';
      sp.textContent = '…';
      return sp;
    }

    pagination.appendChild(makeBtn('‹', currentPage - 1, false, currentPage <= 1));
    pageRange(currentPage, totalPages).forEach(p =>
      pagination.appendChild(p === '…' ? makeEllipsis() : makeBtn(p, p, p === currentPage))
    );
    pagination.appendChild(makeBtn('›', currentPage + 1, false, currentPage >= totalPages));
  }

  function pageRange(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (cur <= 4)          return [1, 2, 3, 4, 5, '…', total];
    if (cur >= total - 3)  return [1, '…', total-4, total-3, total-2, total-1, total];
    return [1, '…', cur-1, cur, cur+1, '…', total];
  }

  // ── API 조회 ─────────────────────────────────────────────────────────────────
  // refreshKpi: 조회/초기화 시 true, 페이지 이동 시 false
  // busy: 조회/초기화 시 true → showBusy + 800ms 최소 딜레이
  async function fetchLogs(refreshKpi = true, busy = false) {
    if (searchBtn) searchBtn.disabled = true;
    if (busy) showBusy();
    const minDelay = busy ? new Promise((r) => setTimeout(r, 800)) : Promise.resolve();

    try {
      const params = new URLSearchParams();
      const lv = levelSel?.value;
      const fr = fromDate?.value;
      const to = toDate?.value;
      if (lv) params.set('level',  lv);
      if (fr) params.set('from',   fr);
      if (to) params.set('to',     `${to}T23:59:59`);
      params.set('limit',  String(PAGE_SIZE));
      params.set('offset', String((currentPage - 1) * PAGE_SIZE));

      const [res] = await Promise.all([apiFetch(`/api/logs?${params}`), minDelay]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const logs  = data.logs  ?? [];
      serverTotal = data.total ?? logs.length;

      renderTable(logs);
      renderMeta(logs);

      if (refreshKpi) fetchKpi();

      if (isFirstLoad) {
        isFirstLoad = false;
        PageLoader.hide($('#pageContent'));
      }
    } catch (err) {
      console.error('[Logs] fetchLogs:', err);
      if (isFirstLoad) {
        PageLoader.showError(err.message, () => {
          PageLoader.show();
          isFirstLoad = true;
          fetchLogs();
        });
      }
    } finally {
      if (busy) hideBusy();
      if (searchBtn) searchBtn.disabled = false;
    }
  }

  // ── 이벤트 ───────────────────────────────────────────────────────────────────
  searchBtn?.addEventListener('click', () => {
    currentPage = 1;
    fetchLogs(true, true);
  });

  resetBtn?.addEventListener('click', () => {
    if (levelSel) levelSel.value = '';
    if (fromDate) fromDate.value = todayStr();
    if (toDate)   toDate.value   = todayStr();
    currentPage = 1;
    fetchLogs(true, true);
  });

  // ── 초기 로드 ─────────────────────────────────────────────────────────────────
  if (fromDate) fromDate.value = todayStr();
  if (toDate)   toDate.value   = todayStr();
  PageLoader.show();
  fetchLogs(true);
})();
