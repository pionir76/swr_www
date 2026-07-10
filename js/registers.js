(() => {
  const TYPE_LABELS = {
    holding_register: "Holding Register",
    input_register:   "Input Register",
    coil:             "Coil",
    discrete_input:   "Discrete Input",
  };

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const deviceSelect = $("#deviceSelect");
  const tableBody    = $("#registerTableBody");
  const summary      = $("#registerSummary");

  // Detail panel
  const rfTagName   = $('#rfTagName');
  const rfDisplay   = $('#rfDisplay');
  const rfAddress   = $('#rfAddress');
  const rfType      = $('#rfType');
  const rfLength    = $('#rfLength');
  const rfUnit      = $('#rfUnit');
  const rfScale     = $('#rfScale');
  const rfByteOrder = $('#rfByteOrder');
  const rfReadOnly  = $('#rfReadOnly');
  const rfSigned    = $('#rfSigned');
  const rfMin       = $('#rfMin');
  const rfMax       = $('#rfMax');
  const rfBitLabels = $('#rfBitLabels');
  const formChip    = document.querySelector('.register-detail-panel .form-chip');
  const saveBtn           = $('#saveRegister');
  const resetBtn          = $('#resetRegister');
  const deleteBtn         = $('#deleteRegister');
  const bulkDeleteRegBtn  = $('#bulkDeleteRegisterBtn');
  const selectAllCheckbox = $('#registerTableBody')?.closest('table')?.querySelector('thead input[type="checkbox"]');

  const regPageInfo      = $('#regPageInfo');
  const regPaginationEl  = $('#regPaginationEl');
  const regPageSizeSelect = $('#regPageSizeSelect');

  // Unified ID - detail panel
  const rfUidSelect    = $('#rfUidSelect');
  const rfUnifiedId    = $('#rfUnifiedId');
  const rfUidVerifyBtn = $('#rfUidVerifyBtn');
  const rfUidStatus    = $('#rfUidStatus');

  // Unified ID - add modal
  const arUidSelect    = $('#arUidSelect');
  const arUnifiedId    = $('#arUnifiedId');
  const arUidVerifyBtn = $('#arUidVerifyBtn');
  const arUidStatus    = $('#arUidStatus');

  // ── State ─────────────────────────────────────────────────────────────────
  let devices       = [];
  let _registerList = [];
  let _selectedReg  = null;
  let _origReg      = null;
  let isFirstLoad   = true;
  let currentPage   = 1;
  let pageSize      = 20;

  let selectedRegIds = new Set();

  let _rfUidMode     = 'auto';
  let _rfUidVerified = false;
  let _arUidMode     = 'auto';
  let _arUidVerified = false;

  // ── Busy overlay ─────────────────────────────────────────────────────────
  const _busyEl = (() => {
    const el = document.createElement('div');
    el.className = 'busy-overlay';
    el.hidden = true;
    el.innerHTML = `<div class="busy-overlay-box"><div class="busy-spinner"></div><p id="_regBusyMsg"></p></div>`;
    document.body.appendChild(el);
    return el;
  })();
  const _busyMsg = _busyEl.querySelector('#_regBusyMsg');

  function showBusy(msg = '') {
    if (_busyMsg) _busyMsg.textContent = msg;
    _busyEl.hidden = false;
  }

  function hideBusy() {
    _busyEl.hidden = true;
  }

  function minDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // C++ numeric_limits<double>::lowest/max 센티넬(-1.79e308, 1.79e308) 제외
  function isRealLimit(v) {
    return Number.isFinite(v) && Math.abs(v) < 1e300;
  }

  // ── Unified Register ID helpers ───────────────────────────────────────────
  function setUidStatus(el, cls, msg) {
    if (!el) return;
    el.className = 'uid-status' + (cls ? ` ${cls}` : '');
    el.textContent = msg;
  }

  function applyRfUidMode(mode) {
    _rfUidMode = mode;
    _rfUidVerified = false;
    if (rfUidSelect) rfUidSelect.value = mode;
    const isManual = mode === 'manual';
    if (rfUnifiedId)    rfUnifiedId.disabled    = !isManual;
    if (rfUidVerifyBtn) rfUidVerifyBtn.disabled  = !isManual;
    setUidStatus(rfUidStatus, '', '');
  }

  function applyArUidMode(mode) {
    _arUidMode = mode;
    _arUidVerified = false;
    if (arUidSelect) arUidSelect.value = mode;
    const isManual = mode === 'manual';
    if (arUnifiedId)    arUnifiedId.disabled    = !isManual;
    if (arUidVerifyBtn) arUidVerifyBtn.disabled  = !isManual;
    setUidStatus(arUidStatus, '', '');
  }

  async function runVerify(inputEl, statusEl) {
    const idVal = parseInt(inputEl?.value ?? '');
    if (isNaN(idVal) || idVal < 5000 || idVal > 5999) {
      setUidStatus(statusEl, 'uid-err', '수동 ID는 5000 ~ 5999 범위여야 합니다');
      return false;
    }
    setUidStatus(statusEl, 'uid-checking', '확인 중…');
    try {
      const res = await apiFetch(`/api/registers/unified-id/check?id=${idVal}`);
      if (res.status === 404) {
        setUidStatus(statusEl, 'uid-warn', '✓ 서버 미구현 — 추후 연동 예정');
        return true;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.available) {
        setUidStatus(statusEl, 'uid-ok', '✓ 사용 가능');
        return true;
      }
      setUidStatus(statusEl, 'uid-err', '✗ 이미 사용 중인 ID');
      return false;
    } catch {
      setUidStatus(statusEl, 'uid-warn', '✓ 서버 미구현 — 추후 연동 예정');
      return true;
    }
  }

  // ── Detail panel ──────────────────────────────────────────────────────────
  function fillDetailPanel(r) {
    _selectedReg = r;
    _origReg     = { ...r };

    if (rfTagName)   rfTagName.value   = r.tagName ?? '';
    if (rfDisplay)   rfDisplay.value   = r.displayName ?? '';
    if (rfAddress)   rfAddress.value   = r.localAddress ?? 0;
    if (rfType)      rfType.value      = r.type ?? 'holding_register';
    if (rfLength)    rfLength.value    = String(r.length ?? 1);
    if (rfUnit)      rfUnit.value      = r.unit ?? '';
    if (rfScale)     rfScale.value     = String(r.scale ?? 1);
    if (rfByteOrder) rfByteOrder.value = r.byteOrder ?? 'default';
    if (rfReadOnly)  rfReadOnly.value  = r.readOnly ? 'true' : 'false';
    if (rfSigned)    rfSigned.value    = r.isSigned ? 'true' : 'false';
    if (rfMin)       rfMin.value       = isRealLimit(r.minValue) ? r.minValue : '';
    if (rfMax)       rfMax.value       = isRealLimit(r.maxValue) ? r.maxValue : '';
    if (rfBitLabels) rfBitLabels.value = r.bitLabels ?? '';

    if (r.unifiedAddress != null && r.unifiedAddress >= 5000) {
      // 수동 지정 범위(5000~5999)
      if (rfUnifiedId) rfUnifiedId.value = r.unifiedAddress;
      applyRfUidMode('manual');
      _rfUidVerified = true;
      setUidStatus(rfUidStatus, 'uid-ok', '✓ 현재 등록된 ID');
    } else {
      if (rfUnifiedId) rfUnifiedId.value = '';
      applyRfUidMode('auto');
      if (r.unifiedAddress != null && r.unifiedAddress >= 0) {
        // 자동 할당 범위(1~4999) — 읽기 전용 정보만 표시
        setUidStatus(rfUidStatus, 'uid-ok', `자동 할당됨 (ID: ${r.unifiedAddress})`);
      }
    }

    if (formChip) formChip.textContent = r.tagName || '선택 항목';
  }

  function clearDetailPanel() {
    _selectedReg = null;
    _origReg     = null;

    if (rfTagName)   rfTagName.value   = '';
    if (rfDisplay)   rfDisplay.value   = '';
    if (rfAddress)   { rfAddress.value = ''; rfAddress.disabled = false; }
    if (rfType)      { rfType.value = 'holding_register'; rfType.disabled = false; }
    if (rfLength)    rfLength.value    = '1';
    if (rfUnit)      rfUnit.value      = '';
    if (rfScale)     rfScale.value     = '1';
    if (rfByteOrder) rfByteOrder.value = 'default';
    if (rfReadOnly)  rfReadOnly.value  = 'true';
    if (rfSigned)    rfSigned.value    = 'false';
    if (rfMin)       rfMin.value       = '';
    if (rfMax)       rfMax.value       = '';
    if (rfBitLabels) rfBitLabels.value = '';
    if (rfUnifiedId) rfUnifiedId.value = '';
    applyRfUidMode('auto');
    if (formChip)    formChip.textContent = '선택 항목';
  }

  // ── 장비 목록 → select 옵션 구성 (GET /api/devices) ──────────────────────
  async function loadDevices() {
    deviceSelect.innerHTML = `<option>불러오는 중…</option>`;

    try {
      const res = await apiFetch("/api/devices");
      if (!res.ok) throw new Error(`장비 목록 조회 실패 (HTTP ${res.status})`);
      const data = await res.json();
      devices = data.devices || [];

      if (devices.length === 0) {
        deviceSelect.innerHTML = `<option>등록된 장비가 없습니다</option>`;
        tableBody.innerHTML =
          `<tr><td colspan="10" class="muted" style="text-align:center; height:64px;">등록된 장비가 없습니다.</td></tr>`;
        if (summary) summary.textContent = "";
        if (isFirstLoad) {
          isFirstLoad = false;
          PageLoader.hide($('#pageContent'));
        }
        return;
      }

      deviceSelect.innerHTML = devices
        .map((d) => `<option value="${d.id}">${escHtml(d.displayName)} (${escHtml(d.deviceCode)})</option>`)
        .join("");

      await loadRegisters(devices[0].id);

      if (isFirstLoad) {
        isFirstLoad = false;
        PageLoader.hide($('#pageContent'));
      }
    } catch (err) {
      deviceSelect.innerHTML = `<option>불러오기 실패</option>`;
      if (isFirstLoad) {
        PageLoader.showError(err.message, () => {
          PageLoader.show();
          loadDevices();
        });
      } else {
        tableBody.innerHTML =
          `<tr><td colspan="10" style="text-align:center; height:64px; color:#ff8c91;">${escHtml(err.message)}</td></tr>`;
        if (summary) summary.textContent = "";
      }
    }
  }

  deviceSelect.addEventListener("change", () => {
    const deviceId = Number(deviceSelect.value);
    if (deviceId) {
      currentPage = 1;
      clearDetailPanel();
      loadRegisters(deviceId);
    }
  });

  regPageSizeSelect?.addEventListener('change', () => {
    pageSize    = Number(regPageSizeSelect.value) || 20;
    currentPage = 1;
    renderPage();
  });

  // ── 페이지네이션 ─────────────────────────────────────────────────────────
  function pageRange(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (cur <= 4)         return [1, 2, 3, 4, 5, '…', total];
    if (cur >= total - 3) return [1, '…', total-4, total-3, total-2, total-1, total];
    return [1, '…', cur-1, cur, cur+1, '…', total];
  }

  function renderPagination(totalPages) {
    if (!regPaginationEl) return;
    regPaginationEl.innerHTML = '';
    if (totalPages <= 1) return;

    const btn = (label, page, active = false, disabled = false) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (active) b.classList.add('active');
      b.disabled = disabled;
      if (!disabled) b.addEventListener('click', () => {
        currentPage = page;
        renderPage();
      });
      return b;
    };

    const ellipsis = () => {
      const sp = document.createElement('span');
      sp.className = 'page-ellipsis';
      sp.textContent = '…';
      return sp;
    };

    regPaginationEl.appendChild(btn('‹', currentPage - 1, false, currentPage <= 1));
    pageRange(currentPage, totalPages).forEach((p) =>
      regPaginationEl.appendChild(p === '…' ? ellipsis() : btn(p, p, p === currentPage))
    );
    regPaginationEl.appendChild(btn('›', currentPage + 1, false, currentPage >= totalPages));
  }

  function renderPage() {
    const total      = _registerList.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * pageSize;
    const paged = _registerList.slice(start, start + pageSize);
    const end   = start + paged.length;

    if (regPageInfo) {
      regPageInfo.textContent = total
        ? `전체 ${total.toLocaleString()}개 중 ${(start + 1).toLocaleString()}–${end.toLocaleString()} 표시`
        : '—';
    }
    renderPagination(totalPages);

    tableBody.innerHTML = paged.map((r, pi) => {
      const i         = start + pi;
      const typeLabel = TYPE_LABELS[r.type] || r.type;
      const propBadge = r.readOnly
        ? `<span class="badge readonly">읽기전용</span>`
        : `<span class="badge writable">쓰기가능</span>`;
      return `
        <tr data-index="${i}">
          <td><input type="checkbox" data-id="${r.id}" ${selectedRegIds.has(r.id) ? 'checked' : ''} /></td>
          <td class="mono">${escHtml(r.tagName)}</td>
          <td>${escHtml(r.displayName)}</td>
          <td>${String(r.localAddress).padStart(5, '0')}</td>
          <td>${escHtml(typeLabel)}</td>
          <td>${r.length}</td>
          <td>${escHtml(r.unit) || "-"}</td>
          <td>${r.scale}</td>
          <td>${propBadge}</td>
          <td>${r.unifiedAddress >= 0 ? String(40000 + r.unifiedAddress) : '—'}</td>
        </tr>
      `;
    }).join("");

    tableBody.querySelectorAll('tr[data-index]').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.type === 'checkbox') return;
        selectRow(tr, Number(tr.dataset.index));
      });
    });

    // 선택 행 유지
    if (_selectedReg) {
      const tr = tableBody.querySelector(`tr[data-index="${_registerList.indexOf(_selectedReg)}"]`);
      if (tr) selectRow(tr, Number(tr.dataset.index), false);
    }

    updateSelectAllCheckbox();
  }

  // ── 레지스터 목록 렌더링 ──────────────────────────────────────────────────
  function renderRegisterRows(registers) {
    _registerList = registers;

    if (registers.length === 0) {
      tableBody.innerHTML =
        `<tr><td colspan="10" class="muted" style="text-align:center; height:64px;">등록된 레지스터가 없습니다.</td></tr>`;
      if (regPageInfo)     regPageInfo.textContent    = '—';
      if (regPaginationEl) regPaginationEl.innerHTML  = '';
      clearDetailPanel();
      return;
    }

    // 저장/삭제 후 선택 항목이 있으면 해당 페이지로 이동
    if (_selectedReg) {
      const idx = registers.findIndex(
        (r) => r.id === _selectedReg.id
      );
      if (idx >= 0) {
        _selectedReg = registers[idx];
        currentPage  = Math.ceil((idx + 1) / pageSize);
      } else {
        clearDetailPanel();
      }
    }

    renderPage();
  }

  function selectRow(tr, idx, scroll = true) {
    tableBody.querySelectorAll('tr.selected-row').forEach((el) => el.classList.remove('selected-row'));
    tr.classList.add('selected-row');
    fillDetailPanel(_registerList[idx]);
    if (scroll) tr.scrollIntoView({ block: 'nearest' });
  }

  // ── GET /api/devices/:id/registers ───────────────────────────────────────
  async function loadRegisters(deviceId) {
    tableBody.innerHTML =
      `<tr><td colspan="10" class="muted" style="text-align:center; height:64px;">불러오는 중…</td></tr>`;
    if (summary) summary.textContent = "불러오는 중…";

    try {
      const res = await apiFetch(`/api/devices/${deviceId}/registers`);
      if (!res.ok) throw new Error(`레지스터 목록 조회 실패 (HTTP ${res.status})`);
      const data = await res.json();
      const registers = data.registers || [];

      console.log(data);

      renderRegisterRows(registers);
      if (summary) summary.textContent = `총 ${registers.length}개`;
    } catch (err) {
      tableBody.innerHTML =
        `<tr><td colspan="10" style="text-align:center; height:64px; color:#ff8c91;">${escHtml(err.message)}</td></tr>`;
      if (summary) summary.textContent = "";
    }
  }

  // ── PUT /api/devices/:id/registers (저장) ────────────────────────────────
  function buildPutBody() {
    const body = {
      tagName:     rfTagName?.value.trim() ?? '',
      displayName: rfDisplay?.value.trim() || rfTagName?.value.trim() || '',
      localAddress: parseInt(rfAddress?.value ?? '0') || 0,
      type:        rfType?.value ?? 'holding_register',
      length:      parseInt(rfLength?.value ?? '1') || 1,
      unit:        rfUnit?.value ?? '',
      scale:       parseFloat(rfScale?.value ?? '1') || 1,
      byteOrder:   rfByteOrder?.value ?? 'default',
      readOnly:    rfReadOnly?.value === 'true',
      isSigned:    rfSigned?.value === 'true',
    };
    if (_rfUidMode === 'manual') {
      body.unifiedAddress = parseInt(rfUnifiedId?.value ?? '-1');
    } else if (_selectedReg?.unifiedAddress >= 5000) {
      // MANUAL → AUTO 전환: 서버에 -1 전달해 자동 재할당 트리거
      body.unifiedAddress = -1;
    }
    const minStr = rfMin?.value.trim();
    const maxStr = rfMax?.value.trim();
    const bitStr = rfBitLabels?.value.trim();
    if (minStr !== '') body.minValue  = parseFloat(minStr);
    if (maxStr !== '') body.maxValue  = parseFloat(maxStr);
    if (bitStr !== '') body.bitLabels = bitStr;
    return body;
  }

  saveBtn?.addEventListener('click', async () => {
    if (!_selectedReg) return;
    if (PollingState.running) {
      alert('폴링 실행 중에는 레지스터를 수정할 수 없습니다.\n폴링을 정지한 후 다시 시도하세요.');
      return;
    }
    if (!rfTagName?.value.trim()) {
      alert('태그명은 필수입니다.');
      rfTagName?.focus();
      return;
    }
    if (_rfUidMode === 'manual' && !_rfUidVerified) {
      alert('통합 레지스터 ID의 Verify를 먼저 실행하세요.');
      return;
    }

    const deviceId = Number(deviceSelect?.value);
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중…';
    showBusy('레지스터 저장 중…');

    try {
      const [res] = await Promise.all([
        apiFetch(`/api/registers/${_selectedReg.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPutBody()),
        }),
        minDelay(500),
      ]);

      if (!res.ok) {
        let msg = `저장 실패 (HTTP ${res.status})`;
        try { const d = await res.json(); if (d.error) msg = d.error; } catch { /* no-op */ }
        alert(msg);
        return;
      }

      await loadRegisters(deviceId);
    } catch (err) {
      alert(err.message || '서버 오류가 발생했습니다.');
    } finally {
      hideBusy();
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }
  });

  // ── 초기화 (원래 값으로 복원) ─────────────────────────────────────────────
  resetBtn?.addEventListener('click', () => {
    if (_origReg) fillDetailPanel(_origReg);
  });

  // ── DELETE /api/devices/:id/registers (삭제) ─────────────────────────────
  deleteBtn?.addEventListener('click', async () => {
    if (!_selectedReg) return;
    if (PollingState.running) {
      alert('폴링 실행 중에는 레지스터를 삭제할 수 없습니다.\n폴링을 정지한 후 다시 시도하세요.');
      return;
    }
    if (!confirm(`"${_selectedReg.tagName}" 레지스터를 삭제하시겠습니까?`)) return;

    const deviceId = Number(deviceSelect?.value);
    deleteBtn.disabled = true;
    deleteBtn.textContent = '삭제 중…';
    showBusy('레지스터 삭제 중…');

    try {
      const [res] = await Promise.all([
        apiFetch(`/api/registers/${_selectedReg.id}`, { method: 'DELETE' }),
        minDelay(500),
      ]);

      if (!res.ok) {
        let msg = `삭제 실패 (HTTP ${res.status})`;
        try { const d = await res.json(); if (d.error) msg = d.error; } catch { /* no-op */ }
        alert(msg);
        return;
      }

      clearDetailPanel();
      await loadRegisters(deviceId);
    } catch (err) {
      alert(err.message || '서버 오류가 발생했습니다.');
    } finally {
      hideBusy();
      deleteBtn.disabled = false;
      deleteBtn.textContent = '삭제';
    }
  });

  // ── 레지스터 추가 모달 (POST /api/devices/:id/registers) ─────────────────

  const addRegisterModal = $('#addRegisterModal');
  const arTagName   = $('#arTagName');
  const arDisplay   = $('#arDisplay');
  const arType      = $('#arType');
  const arAddress   = $('#arAddress');
  const arLength    = $('#arLength');
  const arUnit      = $('#arUnit');
  const arScale     = $('#arScale');
  const arByteOrder = $('#arByteOrder');
  const arReadOnly  = $('#arReadOnly');
  const arSigned    = $('#arSigned');
  const arMin       = $('#arMin');
  const arMax       = $('#arMax');
  const arBitLabels = $('#arBitLabels');
  const arFormMsg   = $('#arFormMsg');
  const arSubmitBtn = $('#arSubmitBtn');

  function showArMsg(msg) {
    if (!arFormMsg) return;
    arFormMsg.textContent = msg;
    arFormMsg.hidden = false;
  }

  function hideArMsg() {
    if (!arFormMsg) return;
    arFormMsg.hidden = true;
    arFormMsg.textContent = '';
  }

  function resetAddRegisterForm() {
    if (arTagName)   arTagName.value   = '';
    if (arDisplay)   arDisplay.value   = '';
    if (arType)      arType.value      = 'holding_register';
    if (arAddress)   arAddress.value   = '0';
    if (arLength)    arLength.value    = '1';
    if (arUnit)      arUnit.value      = '';
    if (arScale)     arScale.value     = '1';
    if (arByteOrder) arByteOrder.value = 'default';
    if (arReadOnly)  arReadOnly.value  = 'true';
    if (arSigned)    arSigned.value    = 'false';
    if (arMin)       arMin.value       = '';
    if (arMax)       arMax.value       = '';
    if (arBitLabels) arBitLabels.value = '';
    if (arUnifiedId) arUnifiedId.value = '';
    applyArUidMode('auto');
    hideArMsg();
  }

  function openAddRegisterModal() {
    if (PollingState.running) {
      alert('폴링 실행 중에는 레지스터를 추가할 수 없습니다.\n폴링을 정지한 후 다시 시도하세요.');
      return;
    }
    const deviceId = Number(deviceSelect?.value);
    if (!deviceId) {
      alert('장비를 먼저 선택하세요.');
      return;
    }
    resetAddRegisterForm();
    if (addRegisterModal) addRegisterModal.hidden = false;
  }

  function closeAddRegisterModal() {
    if (addRegisterModal) addRegisterModal.hidden = true;
  }

  async function submitAddRegister() {
    const tag  = arTagName?.value.trim() ?? '';
    const type = arType?.value ?? '';
    if (!tag || !type) {
      showArMsg('태그명과 타입은 필수입니다.');
      return;
    }
    if (_arUidMode === 'manual' && !_arUidVerified) {
      showArMsg('통합 레지스터 ID의 Verify를 먼저 실행하세요.');
      return;
    }

    const deviceId = Number(deviceSelect?.value);
    if (!deviceId) {
      showArMsg('장비가 선택되어 있지 않습니다.');
      return;
    }

    const body = {
      tagName:     tag,
      displayName: arDisplay?.value.trim() || tag,
      type,
      localAddress: parseInt(arAddress?.value ?? '0') || 0,
      length:      parseInt(arLength?.value  ?? '1') || 1,
      unit:        arUnit?.value ?? '',
      scale:       parseFloat(arScale?.value ?? '1') || 1,
      byteOrder:   arByteOrder?.value ?? 'default',
      readOnly:    arReadOnly?.value === 'true',
      isSigned:    arSigned?.value === 'true',
    };
    if (_arUidMode === 'manual') {
      body.unifiedAddress = parseInt(arUnifiedId?.value ?? '-1');
    }

    const minVal = arMin?.value.trim();
    const maxVal = arMax?.value.trim();
    if (minVal !== '') body.minValue = parseFloat(minVal);
    if (maxVal !== '') body.maxValue = parseFloat(maxVal);

    const bitLabelsStr = arBitLabels?.value.trim();
    if (bitLabelsStr) body.bitLabels = bitLabelsStr;

    hideArMsg();
    if (arSubmitBtn) { arSubmitBtn.disabled = true; arSubmitBtn.textContent = '추가 중…'; }
    showBusy('레지스터 추가 중…');

    try {
      const [res] = await Promise.all([
        apiFetch(`/api/devices/${deviceId}/registers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        minDelay(500),
      ]);

      if (!res.ok) {
        let msg = `등록 실패 (HTTP ${res.status})`;
        try { const d = await res.json(); if (d.error) msg = d.error; } catch { /* no-op */ }
        showArMsg(msg);
        return;
      }

      closeAddRegisterModal();
      await loadRegisters(deviceId);
    } catch (err) {
      showArMsg(err.message || '서버 오류가 발생했습니다.');
    } finally {
      hideBusy();
      if (arSubmitBtn) { arSubmitBtn.disabled = false; arSubmitBtn.textContent = '추가'; }
    }
  }

  $('#addRegisterBtn')?.addEventListener('click', openAddRegisterModal);
  $('#arCloseBtn')?.addEventListener('click',  closeAddRegisterModal);
  $('#arCancelBtn')?.addEventListener('click', closeAddRegisterModal);
  $('#arSubmitBtn')?.addEventListener('click', submitAddRegister);

  // ── Unified ID event listeners ────────────────────────────────────────────
  rfUidSelect?.addEventListener('change', () => applyRfUidMode(rfUidSelect.value));
  rfUnifiedId?.addEventListener('input', () => {
    _rfUidVerified = false;
    setUidStatus(rfUidStatus, '', '');
  });
  rfUidVerifyBtn?.addEventListener('click', async () => {
    rfUidVerifyBtn.disabled = true;
    _rfUidVerified = await runVerify(rfUnifiedId, rfUidStatus);
    rfUidVerifyBtn.disabled = false;
  });

  arUidSelect?.addEventListener('change', () => applyArUidMode(arUidSelect.value));
  arUnifiedId?.addEventListener('input', () => {
    _arUidVerified = false;
    setUidStatus(arUidStatus, '', '');
  });
  arUidVerifyBtn?.addEventListener('click', async () => {
    arUidVerifyBtn.disabled = true;
    _arUidVerified = await runVerify(arUnifiedId, arUidStatus);
    arUidVerifyBtn.disabled = false;
  });

  // ── 전체선택 체크박스 상태 동기화 ────────────────────────────────────────
  function updateSelectAllCheckbox() {
    const cbs = tableBody.querySelectorAll('input[type="checkbox"][data-id]');
    if (!selectAllCheckbox || cbs.length === 0) {
      if (selectAllCheckbox) { selectAllCheckbox.checked = false; selectAllCheckbox.indeterminate = false; }
      return;
    }
    const allChecked  = [...cbs].every((cb) => cb.checked);
    const someChecked = [...cbs].some((cb) => cb.checked);
    selectAllCheckbox.checked       = allChecked;
    selectAllCheckbox.indeterminate = someChecked && !allChecked;
  }

  // ── 행 체크박스 변경 이벤트 위임 ─────────────────────────────────────────
  tableBody?.addEventListener('change', (e) => {
    const cb = e.target;
    if (cb.type !== 'checkbox' || !cb.dataset.id) return;
    const id = Number(cb.dataset.id);
    if (cb.checked) selectedRegIds.add(id);
    else            selectedRegIds.delete(id);
    updateSelectAllCheckbox();
  });

  // ── 전체선택 체크박스 핸들러 ──────────────────────────────────────────────
  selectAllCheckbox?.addEventListener('change', () => {
    const cbs = tableBody.querySelectorAll('input[type="checkbox"][data-id]');
    cbs.forEach((cb) => {
      cb.checked = selectAllCheckbox.checked;
      const id = Number(cb.dataset.id);
      if (selectAllCheckbox.checked) selectedRegIds.add(id);
      else                           selectedRegIds.delete(id);
    });
  });

  // ── 선택 삭제 ─────────────────────────────────────────────────────────────
  async function bulkDeleteRegisters() {
    if (PollingState.running) {
      alert('폴링 실행 중에는 레지스터를 삭제할 수 없습니다.\n폴링을 정지한 후 다시 시도하세요.');
      return;
    }
    if (selectedRegIds.size === 0) {
      alert('삭제할 레지스터를 선택하세요.');
      return;
    }
    if (!confirm(`선택한 ${selectedRegIds.size}개 레지스터를 삭제하시겠습니까?`)) return;

    const deviceId = Number(deviceSelect?.value);
    if (bulkDeleteRegBtn) bulkDeleteRegBtn.disabled = true;
    showBusy(`레지스터 ${selectedRegIds.size}개 삭제 중…`);

    try {
      const ids = [...selectedRegIds];
      const [results] = await Promise.all([
        Promise.all(ids.map((id) => apiFetch(`/api/registers/${id}`, { method: 'DELETE' }))),
        minDelay(500),
      ]);

      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) alert(`${failed.length}개 항목 삭제에 실패했습니다.`);

      selectedRegIds.clear();
      clearDetailPanel();
      await loadRegisters(deviceId);
    } catch (err) {
      alert(err.message || '서버 오류가 발생했습니다.');
    } finally {
      hideBusy();
      if (bulkDeleteRegBtn) bulkDeleteRegBtn.disabled = false;
    }
  }

  bulkDeleteRegBtn?.addEventListener('click', bulkDeleteRegisters);

  PageLoader.show();
  loadDevices();
})();
