(() => {
  let autoRefresh   = true;
  let refreshMs     = 3000;
  let refreshTimer  = null;
  let isFetching    = false;
  let destroyed     = false;
  let deviceMap     = {};
  let lastRegs      = [];
  let selectedRegId = null;
  let currentPage   = 1;
  let pageSize      = 20;

  const tbody          = $('#realtimeBody');
  const totalCountEl   = $('#realtimeTotalCount');
  const lastRefreshEl  = $('#lastRefreshTime');
  const liveDot        = document.querySelector('.live-dot');
  const autoToggle     = $('#autoRefreshToggle');
  const periodSelect   = $('#refreshPeriodSelect');
  const refreshBtn     = $('#refreshBtn');
  const filterDevice   = $('#filterDevice');
  const filterStatus   = $('#filterStatus');
  const filterType     = $('#filterType');
  const searchInput    = $('#searchInput');
  const filterResetBtn  = $('#filterResetBtn');
  const pageSizeSelect  = $('#pageSizeSelect');
  const pageInfoEl      = $('#pageInfoEl');
  const paginationEl    = $('#paginationEl');

  // ── 장비 목록 선조회 (deviceId → displayName 매핑) ───────────────
  async function loadDevices() {

    try {
      const res = await apiFetch('/api/devices');
      if (!res.ok) return;
      const data = await res.json();
      deviceMap = {};
      (data.devices ?? []).forEach((d) => {
        deviceMap[d.id] = d.displayName || d.name || `#${d.id}`;
      });
      if (filterDevice) {
        filterDevice.innerHTML = '<option value="">전체</option>';
        Object.entries(deviceMap).forEach(([id, name]) => {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = name;
          filterDevice.appendChild(opt);
        });
      }
    } catch (_) { /* 장비 목록 실패는 무시 */ }
  }

  // ── GET /api/registers/realtime ──────────────────────────────────
  async function loadRealtime() {

    if (isFetching) return;
    isFetching = true;
    try {
      const res = await apiFetch('/api/registers/realtime');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      lastRegs = data.registers ?? [];
      
      if (!destroyed) {
        renderTable(lastRegs);
        updateLastRefreshTime();
      }
    } catch (err) {
      console.error('realtime fetch error:', err);
    } finally {
      isFetching = false;
    }
  }

  // ── 상태 판별 ────────────────────────────────────────────────────
  function getStatus(r) {
    if (!r.isValid)   return 'bad';
    if (r.outOfRange) return 'warn';
    if (r.quality === 'bad' || r.quality === 'normal') return 'stale';
    return 'good';
  }

  const STATUS_LABEL = {
    good: '정상', bad: '통신 오류', warn: '범위 초과', stale: '미갱신',
  };

  const QUALITY_CLASS = { good: 'q-good', normal: 'q-normal', bad: 'q-bad' };

  const SOURCE_TYPE_LABEL = {
    holding_register: 'Holding Register',
    input_register:   'Input Register',
    coil_status:      'Coil Status',
    discrete_input:   'Discrete Input',
  };

  const fmtValue   = (v, reg) => RegFmt.value(v, reg);
  const fmtAddress = (addr)   => RegFmt.address(addr);

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function fmtDatetime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // ── 상세 패널 ────────────────────────────────────────────────────
  function showDetail(r) {
    const set = (id, val) => {
      const el = $(`#${id}`);
      if (el) el.textContent = val ?? '—';
    };

    // 기본 정보
    set('dtlUnifiedAddr', 40000 + r.id);
    set('dtlTagName',     r.tagName);
    set('dtlDisplayName', r.displayName);
    set('dtlUnit',        r.unit || '—');
    set('dtlScale',       r.scale != null ? r.scale : '—');

    // 소스 정보
    set('dtlDevice',  deviceMap[r.deviceId] ?? `#${r.deviceId}`);
    set('dtlSrcAddr', fmtAddress(r.localAddress));
    set('dtlSrcType', SOURCE_TYPE_LABEL[r.sourceType] ?? r.sourceType ?? '—');

    // 현재 값 정보
    const valEl = $('#dtlValue');
    if (valEl) {
      valEl.className = '';
      if (!r.isValid) {
        valEl.className = 'error-value';
        valEl.textContent = '--';
      } else if (r.outOfRange) {
        valEl.className = 'warning-value';
        valEl.textContent = `${fmtValue(r.scaledValue, r)} ${r.unit || ''}`.trim();
      } else {
        valEl.className = 'value-cell';
        valEl.textContent = `${fmtValue(r.scaledValue, r)} ${r.unit || ''}`.trim();
      }
    }

    set('dtlRawWord', r.rawWord != null ? r.rawWord : '—');

    // 비트 라벨
    const bitSection = $('#dtlBitSection');
    const bitList    = $('#dtlBitList');
    let parsedLabels = null;
    try { if (r.bitLabels) parsedLabels = JSON.parse(r.bitLabels); } catch (_) {}
    if (bitSection && bitList && parsedLabels && Object.keys(parsedLabels).length > 0 && r.rawWord != null) {
      bitList.innerHTML = '';
      const word = r.rawWord;
      Object.entries(parsedLabels)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .forEach(([pos, name]) => {
          const isOn = ((word >> parseInt(pos)) & 1) === 1;
          const row = document.createElement('div');
          row.className = 'bit-row';
          row.innerHTML =
            `<span class="bit-name">${name}</span>` +
            `<span class="bit-state ${isOn ? 'on' : 'off'}">` +
              `<span class="bit-dot"></span>${isOn ? 'ON' : 'OFF'}` +
            `</span>`;
          bitList.appendChild(row);
        });
      bitSection.hidden = false;
    } else if (bitSection) {
      bitSection.hidden = true;
      if (bitList) bitList.innerHTML = '';
    }

    const qEl = $('#dtlQuality');
    if (qEl) {
      const status = getStatus(r);
      qEl.className = status === 'good' ? 'quality-good' : '';
      qEl.textContent = STATUS_LABEL[status] ?? '—';
    }

    set('dtlLastUpdated', fmtDatetime(r.lastUpdated));
    set('dtlErrMsg', r.errorMessage || '—');

    // 쓰기 모드
    const rwEl = $('#dtlRwMode');
    if (rwEl) {
      const cls  = r.readOnly ? 'readonly' : 'readwrite';
      const text = r.readOnly ? 'READ ONLY' : 'READ WRITE';
      rwEl.innerHTML = `<span class="mode-badge ${cls}">${text}</span>`;
    }
  }

  function clearDetail() {
    $$('#dtlUnifiedAddr,#dtlTagName,#dtlDisplayName,#dtlUnit,#dtlScale,' +
       '#dtlDevice,#dtlSrcAddr,#dtlSrcType,' +
       '#dtlValue,#dtlRawWord,#dtlQuality,#dtlLastUpdated,#dtlErrMsg,' +
       '#dtlRwMode').forEach((el) => { el.textContent = '—'; el.className = ''; });
    const bs = $('#dtlBitSection');
    const bl = $('#dtlBitList');
    if (bs) bs.hidden = true;
    if (bl) bl.innerHTML = '';
  }

  // ── Summary Cards ────────────────────────────────────────────────
  function updateSummary(registers) {
    const total = registers.length;
    let good = 0, bad = 0, warn = 0, stale = 0;
    for (const r of registers) {
      const s = getStatus(r);
      if (s === 'good')       good++;
      else if (s === 'bad')   bad++;
      else if (s === 'warn')  warn++;
      else if (s === 'stale') stale++;
    }
    const pct = (n) => total ? `${(n / total * 100).toFixed(1)}%` : '';

    const set = (id, val) => { const el = $(`#${id}`); if (el) el.textContent = val; };
    set('sumTotal',    total.toLocaleString());
    set('sumGood',     good.toLocaleString());
    set('sumGoodPct',  pct(good));
    set('sumBad',      bad.toLocaleString());
    set('sumBadPct',   pct(bad));
    set('sumWarn',     warn.toLocaleString());
    set('sumWarnPct',  pct(warn));
    set('sumStale',    stale.toLocaleString());
    set('sumStalePct', pct(stale));
  }

  // ── 페이지네이션 ─────────────────────────────────────────────────
  function pageRange(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (cur <= 4)         return [1, 2, 3, 4, 5, '…', total];
    if (cur >= total - 3) return [1, '…', total-4, total-3, total-2, total-1, total];
    return [1, '…', cur-1, cur, cur+1, '…', total];
  }

  function renderPagination(totalPages) {
    if (!paginationEl) return;
    paginationEl.innerHTML = '';
    if (totalPages <= 1) return;

    const btn = (label, page, active = false, disabled = false) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (active)   b.classList.add('active');
      b.disabled = disabled;
      if (!disabled) b.addEventListener('click', () => {
        currentPage = page;
        renderTable(lastRegs);
      });
      return b;
    };

    const ellipsis = () => {
      const sp = document.createElement('span');
      sp.className = 'page-ellipsis';
      sp.textContent = '…';
      return sp;
    };

    paginationEl.appendChild(btn('‹', currentPage - 1, false, currentPage <= 1));
    pageRange(currentPage, totalPages).forEach((p) =>
      paginationEl.appendChild(p === '…' ? ellipsis() : btn(p, p, p === currentPage))
    );
    paginationEl.appendChild(btn('›', currentPage + 1, false, currentPage >= totalPages));
  }

  // ── 테이블 렌더링 ────────────────────────────────────────────────
  function renderTable(registers) {
    updateSummary(registers);

    const devFilter    = filterDevice?.value ?? '';
    const statusFilter = filterStatus?.value ?? '';
    const typeFilter   = filterType?.value   ?? '';
    const query        = (searchInput?.value ?? '').trim().toLowerCase();

    const filtered = registers.filter((r) => {
      if (devFilter    && String(r.deviceId) !== devFilter) return false;
      if (statusFilter && getStatus(r) !== statusFilter)    return false;
      if (typeFilter   && r.sourceType !== typeFilter)      return false;
      if (query) {
        const hay = `${r.tagName} ${r.displayName} ${r.id} ${r.localAddress}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    const total      = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;

    const start  = (currentPage - 1) * pageSize;
    const paged  = filtered.slice(start, start + pageSize);
    const end    = start + paged.length;

    if (totalCountEl) totalCountEl.textContent = `총 ${total.toLocaleString()}개`;
    if (pageInfoEl)   pageInfoEl.textContent   = total
      ? `${(start + 1).toLocaleString()}–${end.toLocaleString()} / ${total.toLocaleString()}`
      : '—';
    renderPagination(totalPages);

    if (!tbody) return;
    tbody.innerHTML = '';
    paged.forEach((r) => {
      const status   = getStatus(r);
      const devName  = deviceMap[r.deviceId] ?? `#${r.deviceId}`;
      const qClass   = QUALITY_CLASS[r.quality] ?? 'q-bad';
      const modeText = r.readOnly ? 'READ ONLY' : 'READ WRITE';
      const modeCls  = r.readOnly ? 'readonly' : 'readwrite';

      let valueCell;
      if (!r.isValid) {
        valueCell = `<span class="error-value">--</span>`;
      } else if (r.outOfRange) {
        valueCell = `<span class="warning-value">${fmtValue(r.scaledValue, r)}</span>`;
      } else {
        valueCell = `<span class="value-cell">${fmtValue(r.scaledValue, r)}</span>`;
      }

      const tr = document.createElement('tr');
      tr.dataset.regId = r.id;
      if (r.id === selectedRegId) tr.classList.add('selected-row');

      tr.innerHTML = `
        <td><span class="status-label ${status}"><i></i>${STATUS_LABEL[status]}</span></td>
        <td class="mono">${40000 + r.id}</td>
        <td class="mono">${r.tagName ?? '—'}</td>
        <td>${r.displayName ?? '—'}</td>
        <td>${valueCell}</td>
        <td>${r.unit || '—'}</td>
        <td>${devName}</td>
        <td class="mono">${fmtAddress(r.localAddress)}</td>
        <td>${SOURCE_TYPE_LABEL[r.sourceType] ?? r.sourceType ?? '—'}</td>
        <td><span class="mode-badge ${modeCls}">${modeText}</span></td>
        <td class="${qClass}">${fmtTime(r.lastUpdated)}</td>
      `;

      tr.addEventListener('click', () => {
        $$('tr.selected-row', tbody).forEach((el) => el.classList.remove('selected-row'));
        tr.classList.add('selected-row');
        selectedRegId = r.id;
        showDetail(r);
      });

      if (!r.readOnly) {
        tr.querySelector('.mode-badge.readwrite')?.addEventListener('click', (e) => {
          e.stopPropagation();
          openWriteModal(r);
        });
      }

      tbody.appendChild(tr);
    });

    // 선택된 행이 있으면 최신 데이터로 상세 패널 갱신
    if (selectedRegId != null) {
      const fresh = registers.find((r) => r.id === selectedRegId);
      if (fresh) showDetail(fresh);
    }
  }

  function updateLiveDot() {
    if (!liveDot) return;
    liveDot.classList.toggle('paused', !autoRefresh);
  }

  function updateLastRefreshTime() {
    if (!lastRefreshEl) return;
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const time =
      `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ` +
      `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
    lastRefreshEl.textContent = autoRefresh ? time : `${time} — 갱신 정지`;
  }

  // ── 자동 갱신 ────────────────────────────────────────────────────
  // setInterval 대신 recursive setTimeout — 응답 완료 후 다음 타이머 등록해 중첩 방지.
  async function scheduleRefresh() {
    await loadRealtime();
    if (destroyed || !autoRefresh) return;
    refreshTimer = setTimeout(scheduleRefresh, refreshMs);
  }

  function startAutoRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    scheduleRefresh();
  }

  function stopAutoRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  // ── 쓰기 모달 ────────────────────────────────────────────────────
  const writeModal    = $('#writeModal');
  const wmTagName     = $('#wmTagName');
  const wmDisplayName = $('#wmDisplayName');
  const wmUnifiedAddr = $('#wmUnifiedAddr');
  const wmCurrentVal  = $('#wmCurrentVal');
  const wmCoilWrap    = $('#wmCoilWrap');
  const wmCoilSelect  = $('#wmCoilSelect');
  const wmWordWrap    = $('#wmWordWrap');
  const wmValueInput  = $('#wmValueInput');
  const wmUnitLabel   = $('#wmUnitLabel');
  const wmRangeHint   = $('#wmRangeHint');
  const wmRawHint     = $('#wmRawHint');
  const wmError       = $('#wmError');
  const wmCloseBtn    = $('#wmCloseBtn');
  const wmCancelBtn   = $('#wmCancelBtn');
  const wmSubmitBtn   = $('#wmSubmitBtn');

  let _writeReg = null;

  const hasLimit = (v) => v != null && Number.isFinite(v) && Math.abs(v) < 1e15;

  function openWriteModal(r) {
    _writeReg = r;
    const isCoil = r.sourceType === 'coil_status';

    wmTagName.textContent     = r.tagName ?? '—';
    wmDisplayName.textContent = r.displayName ?? '—';
    wmUnifiedAddr.textContent = 40000 + r.id;
    wmCurrentVal.textContent  = r.isValid
      ? `${fmtValue(r.scaledValue, r)} ${r.unit || ''}`.trim()
      : '-- (Comm Error)';

    wmCoilWrap.hidden = !isCoil;
    wmWordWrap.hidden = isCoil;

    if (isCoil) {
      wmCoilSelect.value = (r.rawWord ?? 0) ? '1' : '0';
      wmRangeHint.hidden = true;
      wmRawHint.textContent = '';
    } else {
      const unit = r.unit || '';
      wmUnitLabel.textContent = unit;
      wmValueInput.value = r.isValid ? fmtValue(r.scaledValue, r) : '';
      wmValueInput.removeAttribute('min');
      wmValueInput.removeAttribute('max');

      const hasMin = hasLimit(r.minValue);
      const hasMax = hasLimit(r.maxValue);
      if (hasMin || hasMax) {
        const minStr = hasMin ? r.minValue : '—';
        const maxStr = hasMax ? r.maxValue : '—';
        wmRangeHint.textContent = `Range: ${minStr} ~ ${maxStr}${unit ? ' ' + unit : ''}`;
        wmRangeHint.hidden = false;
        if (hasMin) wmValueInput.min = r.minValue;
        if (hasMax) wmValueInput.max = r.maxValue;
      } else {
        wmRangeHint.hidden = true;
      }
      updateRawHint();
    }

    wmError.hidden = true;
    wmSubmitBtn.disabled = false;
    writeModal.hidden = false;
    if (!isCoil) setTimeout(() => wmValueInput?.focus(), 50);
  }

  function updateRawHint() {
    const val = parseFloat(wmValueInput?.value);
    if (!wmRawHint) return;
    if (isNaN(val) || !_writeReg) { wmRawHint.textContent = ''; return; }
    const raw = Math.round(val / (_writeReg.scale || 1));
    wmRawHint.textContent = `Raw: ${raw}`;
  }

  function closeWriteModal() {
    writeModal.hidden = true;
    _writeReg = null;
  }

  function showWmError(msg) {
    wmError.textContent = msg;
    wmError.hidden = false;
  }

  async function submitWrite() {
    if (!_writeReg) return;
    const isCoil = _writeReg.sourceType === 'coil_status';
    let rawValues;

    if (isCoil) {
      rawValues = [parseInt(wmCoilSelect.value)];
    } else {
      const val = parseFloat(wmValueInput.value);
      if (isNaN(val)) { showWmError('Please enter a value.'); return; }
      if (hasLimit(_writeReg.minValue) && val < _writeReg.minValue) {
        showWmError(`Value is below minimum (${_writeReg.minValue}).`); return;
      }
      if (hasLimit(_writeReg.maxValue) && val > _writeReg.maxValue) {
        showWmError(`Value exceeds maximum (${_writeReg.maxValue}).`); return;
      }
      rawValues = [Math.round(val / (_writeReg.scale || 1))];
    }

    wmSubmitBtn.disabled = true;
    wmError.hidden = true;
    showBusy();

    const minDelay = new Promise((r) => setTimeout(r, 800));
    try {
      const [res] = await Promise.all([
        apiFetch(`/api/registers/${_writeReg.registerId}/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawValues }),
        }),
        minDelay,
      ]);
      hideBusy();
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showWmError(data.error || `Error (HTTP ${res.status})`);
        wmSubmitBtn.disabled = false;
        return;
      }
      closeWriteModal();
      loadRealtime();
    } catch {
      hideBusy();
      showWmError('Network error. Please try again.');
      wmSubmitBtn.disabled = false;
    }
  }

  wmCloseBtn?.addEventListener('click', closeWriteModal);
  wmCancelBtn?.addEventListener('click', closeWriteModal);
  wmSubmitBtn?.addEventListener('click', submitWrite);
  wmValueInput?.addEventListener('input', updateRawHint);

  // ── 이벤트 연결 ──────────────────────────────────────────────────
  autoToggle?.addEventListener('change', () => {
    autoRefresh = autoToggle.checked;
    autoRefresh ? startAutoRefresh() : stopAutoRefresh();
    updateLiveDot();
  });

  periodSelect?.addEventListener('change', () => {
    refreshMs = Number(periodSelect.value) || 3000;
    if (autoRefresh) startAutoRefresh();
  });

  refreshBtn?.addEventListener('click', loadRealtime);

  function resetPage() { currentPage = 1; }

  filterDevice?.addEventListener('change', () => { resetPage(); renderTable(lastRegs); });
  filterStatus?.addEventListener('change', () => { resetPage(); renderTable(lastRegs); });
  filterType?.addEventListener('change',   () => { resetPage(); renderTable(lastRegs); });
  searchInput?.addEventListener('input',   () => { resetPage(); renderTable(lastRegs); });

  pageSizeSelect?.addEventListener('change', () => {
    pageSize = Number(pageSizeSelect.value) || 20;
    resetPage();
    renderTable(lastRegs);
  });

  filterResetBtn?.addEventListener('click', () => {
    if (filterDevice) filterDevice.value = '';
    if (filterStatus) filterStatus.value = '';
    if (filterType)   filterType.value   = '';
    if (searchInput)  searchInput.value  = '';
    resetPage();
    renderTable(lastRegs);
  });

  $('#detailCloseBtn')?.addEventListener('click', () => {
    selectedRegId = null;
    clearDetail();
    $$('tr.selected-row', tbody).forEach((el) => el.classList.remove('selected-row'));
  });

  // ── 페이지 전환 시 타이머 정리 ───────────────────────────────────
  function onHashChange() {
    if (location.hash !== '#realtime') {
      destroyed = true;
      stopAutoRefresh();
      window.removeEventListener('hashchange', onHashChange);
    }
  }
  window.addEventListener('hashchange', onHashChange);

  // ── 초기 실행 ────────────────────────────────────────────────────
  loadDevices().then(() => {
    if (destroyed) return;
    startAutoRefresh();
  });
})();
