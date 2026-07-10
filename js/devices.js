(() => {
  // 연결 방식(connType)에 따라 선택 가능한 프로토콜이 다르다.
  const PROTOCOLS = {
    tcp: [
      ["modbus_tcp", "Modbus TCP"],
      ["pclink_sum", "PCLink+SUM"],
    ],
    serial: [
      ["modbus_rtu", "Modbus RTU"],
      ["modbus_ascii", "Modbus ASCII"],
      ["pclink", "PCLink"],
      ["pclink_sum", "PCLink+SUM"],
    ],
  };

  // GET /api/devices 가 돌려주는 protocol 문자열 → 표시 라벨
  // (이전에는 숫자 코드였으나 API가 문자열로 변경됨 — select value와 동일한 값)
  const PROTOCOL_LABELS = {
    modbus_rtu:   "Modbus RTU",
    modbus_tcp:   "Modbus TCP",
    modbus_ascii: "Modbus ASCII",
    pclink:       "PCLink",
    pclink_sum:   "PCLink+SUM",
  };

  const connTypeSelect    = $("#connTypeSelect");
  const protocolSelect    = $("#protocolSelect");
  const tableBody         = $("#deviceTableBody");
  const summary           = $("#deviceSummary");
  const selectAllCheckbox = $("#selectAllCheckbox");

  // 상세 정보 패널
  const selectedChip = $("#selectedChip");
  const dfCode       = $("#dfCode");
  const dfName       = $("#dfName");
  const dfDisplay    = $("#dfDisplay");
  const dfSlave      = $("#dfSlave");
  const dfIp         = $("#dfIp");
  const dfPort       = $("#dfPort");
  const dfTimeout    = $("#dfTimeout");
  const dfInterval   = $("#dfInterval");
  const dfByteOrder  = $("#dfByteOrder");
  const dfRetry      = $("#dfRetry");
  const dfLastComm   = $("#dfLastComm");
  const dfCommState  = $("#dfCommState");
  const dfLastError  = $("#dfLastError");
  const dfFormMsg    = $("#dfFormMsg");

  const dfSaveBtn     = $("#dfSaveBtn");
  const dfResetBtn    = $("#dfResetBtn");
  const dfDeleteBtn   = $("#dfDeleteBtn");
  const bulkDeleteBtn = $("#bulkDeleteBtn");

  // 신규 장비 등록 모달
  const addDeviceBtn   = $("#addDeviceBtn");
  const addDeviceModal = $("#addDeviceModal");
  const addModalClose  = $("#addModalClose");
  const ndCode      = $("#ndCode");
  const ndName      = $("#ndName");
  const ndDisplay   = $("#ndDisplay");
  const ndConnType  = $("#ndConnType");
  const ndProtocol  = $("#ndProtocol");
  const ndSlave     = $("#ndSlave");
  const ndIp        = $("#ndIp");
  const ndPort      = $("#ndPort");
  const ndTimeout   = $("#ndTimeout");
  const ndInterval  = $("#ndInterval");
  const ndByteOrder = $("#ndByteOrder");
  const ndRetry     = $("#ndRetry");
  const ndFormMsg   = $("#ndFormMsg");
  const ndCancelBtn = $("#ndCancelBtn");
  const ndSubmitBtn = $("#ndSubmitBtn");

  let devices         = [];
  let statusById       = {};
  let selectedDeviceId = null;
  let selectedIds       = new Set(); // 행 체크박스로 선택된 장비 id 목록 (새로고침에도 유지)

  // ── 연결 방식 → 프로토콜 옵션 동적 구성 ────────────────────────────────────

  function populateProtocolOptions(targetSelect, connType, selectedValue) {
    const opts = PROTOCOLS[connType] || PROTOCOLS.serial;
    targetSelect.innerHTML = opts
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");
    if (selectedValue) targetSelect.value = selectedValue;
  }

  if (connTypeSelect && protocolSelect) {
    connTypeSelect.addEventListener("change", () => {
      populateProtocolOptions(protocolSelect, connTypeSelect.value);
    });
    // 초기 로드 시 현재 연결 방식에 맞는 프로토콜 목록으로 채운다.
    populateProtocolOptions(protocolSelect, connTypeSelect.value);
  }

  // ── Busy overlay ─────────────────────────────────────────────────────────

  const _busyEl = (() => {
    const el = document.createElement('div');
    el.className = 'busy-overlay';
    el.hidden = true;
    el.innerHTML = `<div class="busy-overlay-box"><div class="busy-spinner"></div><p id="_busyMsg"></p></div>`;
    document.body.appendChild(el);
    return el;
  })();
  const _busyMsg = _busyEl.querySelector('#_busyMsg');

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

  // ── 공통 유틸 ───────────────────────────────────────────────────────────

  function escHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function fmtTime(ms) {
    if (!ms) return "-";
    return new Date(ms).toLocaleString("ko-KR", { hour12: false });
  }

  function stateBadge(state) {
    if (state === "ok")    return `<span class="badge ok">정상</span>`;
    if (state === "warn")  return `<span class="badge warn">경고</span>`;
    if (state === "error") return `<span class="badge error">오류</span>`;
    return `<span class="badge" style="color:#9badc5;background:rgba(255,255,255,0.06)">대기</span>`;
  }

  function showFormMsg(msg, isError = true) {
    if (!dfFormMsg) return;
    dfFormMsg.textContent = msg;
    dfFormMsg.hidden = false;
    dfFormMsg.style.color = isError ? "" : "#68f184";
    dfFormMsg.style.background = isError ? "" : "rgba(76, 217, 107, 0.12)";
    dfFormMsg.style.borderColor = isError ? "" : "rgba(76, 217, 107, 0.3)";
  }

  function hideFormMsg() {
    if (!dfFormMsg) return;
    dfFormMsg.hidden = true;
    dfFormMsg.textContent = "";
  }

  // ── 장비 목록 테이블 렌더링 ─────────────────────────────────────────────

  function renderDeviceRows() {
    if (devices.length === 0) {
      tableBody.innerHTML =
        `<tr><td colspan="8" class="muted" style="text-align:center; height:64px;">등록된 장비가 없습니다.</td></tr>`;
      updateSelectAllCheckbox();
      return;
    }

    tableBody.innerHTML = devices.map((d) => {
      const s         = statusById[d.id];
      const connLabel = d.connType === "tcp" ? "TCP/IP" : "Serial";
      const protoLabel = PROTOCOL_LABELS[d.protocol] || `프로토콜 #${d.protocol}`;
      const addr      = d.connType === "tcp" ? `${escHtml(d.ipAddress)} : ${d.tcpPort}` : "-";
      const selected  = d.id === selectedDeviceId ? " selected-row" : "";
      const checked   = selectedIds.has(d.id) ? "checked" : "";

      return `
        <tr data-id="${d.id}" class="device-row clickable${selected}">
          <td><input type="checkbox" data-id="${d.id}" ${checked} /></td>
          <td>${escHtml(d.deviceCode)}</td>
          <td>${escHtml(d.displayName)}</td>
          <td>${connLabel}</td>
          <td>${escHtml(protoLabel)}</td>
          <td>${addr}</td>
          <td>${d.slaveId}</td>
          <td>${stateBadge(s?.state)}</td>
        </tr>
      `;
    }).join("");

    updateSelectAllCheckbox();
  }

  // ── 전체 선택 체크박스 (헤더) ────────────────────────────────────────────

  function updateSelectAllCheckbox() {
    if (!selectAllCheckbox) return;
    const total    = devices.length;
    const selected = devices.filter((d) => selectedIds.has(d.id)).length;

    selectAllCheckbox.checked       = total > 0 && selected === total;
    selectAllCheckbox.indeterminate = selected > 0 && selected < total;
  }

  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", () => {
      const checked = selectAllCheckbox.checked;
      if (checked) devices.forEach((d) => selectedIds.add(d.id));
      else selectedIds.clear();

      $$('input[type="checkbox"][data-id]', tableBody).forEach((cb) => {
        cb.checked = checked;
      });
      selectAllCheckbox.indeterminate = false;
    });
  }

  // 행 체크박스 변경 (이벤트 위임 — 새로고침으로 행이 다시 그려져도 항상 동작)
  tableBody.addEventListener("change", (e) => {
    if (!e.target.matches('input[type="checkbox"][data-id]')) {
      return;
    }

    const id = Number(e.target.dataset.id);
    if (e.target.checked) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
    
    updateSelectAllCheckbox();
  });

  // ── 상세 정보 패널 ──────────────────────────────────────────────────────

  function fillMeta(status) {
    dfLastComm.textContent = fmtTime(status?.lastPollTimestamp);

    dfCommState.className = "";
    if (status?.state === "ok") {
      dfCommState.textContent = "정상";
      dfCommState.className = "green-text";
    } else if (status?.state === "warn") {
      dfCommState.textContent = "경고";
      dfCommState.className = "amber-text";
    } else if (status?.state === "error") {
      dfCommState.textContent = "오류";
      dfCommState.className = "red-text";
    } else {
      dfCommState.textContent = "대기";
      dfCommState.className = "muted-text";
    }

    if (status?.lastError) {
      dfLastError.textContent = status.lastError;
      dfLastError.className = "red-text";
    } else {
      dfLastError.textContent = "없음";
      dfLastError.className = "muted-text";
    }
  }

  function fillDetailForm(device, status) {
    dfCode.value     = device.deviceCode ?? "";
    dfName.value     = device.name ?? "";
    dfDisplay.value  = device.displayName ?? "";
    connTypeSelect.value = device.connType === "tcp" ? "tcp" : "serial";
    populateProtocolOptions(protocolSelect, connTypeSelect.value, device.protocol);
    dfSlave.value    = device.slaveId ?? 1;
    dfIp.value       = device.ipAddress ?? "";
    dfPort.value     = device.tcpPort ?? 502;
    dfTimeout.value  = device.timeoutMs ?? 1000;
    dfInterval.value = device.intervalMs ?? 5000;
    dfByteOrder.value = device.byteOrder ?? "big";
    dfRetry.value    = device.retryCount ?? 3;

    selectedChip.textContent = `선택: ${device.deviceCode}`;
    fillMeta(status);
    hideFormMsg();
  }

  function clearDetailForm() {
    selectedDeviceId = null;
    selectedChip.textContent = "선택 장비";
    [dfCode, dfName, dfDisplay, dfSlave, dfIp, dfPort, dfTimeout, dfInterval, dfRetry]
      .forEach((el) => { el.value = ""; });
    connTypeSelect.value = "serial";
    populateProtocolOptions(protocolSelect, "serial");
    dfByteOrder.value = "big";
    dfLastComm.textContent  = "-";
    dfCommState.textContent = "-";
    dfCommState.className   = "muted-text";
    dfLastError.textContent = "-";
    dfLastError.className   = "muted-text";
    hideFormMsg();
  }

  function highlightSelectedRow() {
    $$(".device-row", tableBody).forEach((row) => {
      row.classList.toggle("selected-row", Number(row.dataset.id) === selectedDeviceId);
    });
  }

  function selectDevice(id) {
    const device = devices.find((d) => d.id === id);
    if (!device) return;
    selectedDeviceId = id;
    fillDetailForm(device, statusById[id]);
    highlightSelectedRow();
  }

  // 장비 목록 행 클릭 → 상세 정보 패널 업데이트 (체크박스 클릭은 제외)
  tableBody.addEventListener("click", (e) => {
    if (e.target.matches('input[type="checkbox"]')) return;
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    selectDevice(Number(row.dataset.id));
  });

  // ── 저장 (PUT /api/devices/:id) ─────────────────────────────────────────

  function buildFormBody() {
    const body = {
      deviceCode:  dfCode.value.trim(),
      name:        dfName.value.trim(),
      displayName: dfDisplay.value.trim(),
      connType:    connTypeSelect.value,
      protocol:    protocolSelect.value,
      slaveId:     parseInt(dfSlave.value) || 1,
      byteOrder:   dfByteOrder.value,
      timeoutMs:   parseInt(dfTimeout.value) || 1000,
      intervalMs:  parseInt(dfInterval.value) || 5000,
      retryCount:  parseInt(dfRetry.value) || 0,
    };
    if (connTypeSelect.value === "tcp") {
      body.ipAddress = dfIp.value.trim();
      body.tcpPort   = parseInt(dfPort.value) || 502;
    }
    return body;
  }

  async function saveDevice() {
    if (!selectedDeviceId) {
      showFormMsg("먼저 목록에서 장비를 선택하세요.");
      return;
    }
    if (!dfCode.value.trim() || !dfName.value.trim() || !dfDisplay.value.trim()) {
      showFormMsg("장비 코드 · 장비명 · 표시명은 필수입니다.");
      return;
    }

    hideFormMsg();
    dfSaveBtn.disabled = true;
    dfSaveBtn.textContent = "저장 중…";

    try {
      const res = await apiFetch(`/api/devices/${selectedDeviceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildFormBody()),
      });

      if (!res.ok) {
        let message = `저장에 실패했습니다. (HTTP ${res.status})`;
        try {
          const data = await res.json();
          if (data.error) message = data.error;
        } catch { /* no-op */ }
        showFormMsg(message);
        return;
      }

      showFormMsg("저장되었습니다.", false);
      await loadDeviceList();
    } catch {
      showFormMsg("서버에 연결할 수 없습니다.");
    } finally {
      dfSaveBtn.disabled = false;
      dfSaveBtn.textContent = "저장";
    }
  }

  // ── 초기화 (원래 값으로 되돌리기) ───────────────────────────────────────

  function resetForm() {
    if (!selectedDeviceId) {
      showFormMsg("먼저 목록에서 장비를 선택하세요.");
      return;
    }
    const device = devices.find((d) => d.id === selectedDeviceId);
    if (!device) {
      clearDetailForm();
      return;
    }

    const label = device ? `${device.displayName} (${device.deviceCode})` : "선택한 장비";
    if (!window.confirm(`${label} 수정사항을 초기화하시겠습니까?`)) {
      return;
    }

    fillDetailForm(device, statusById[selectedDeviceId]);
  }

  // ── 삭제 (DELETE /api/devices/:id) ──────────────────────────────────────

  async function deleteDevice() {
    if (!selectedDeviceId) {
      showFormMsg("먼저 목록에서 장비를 선택하세요.");
      return;
    }
    const device = devices.find((d) => d.id === selectedDeviceId);
    const label = device ? `${device.displayName} (${device.deviceCode})` : "선택한 장비";
    if (!window.confirm(`${label} 장비를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }

    hideFormMsg();
    dfDeleteBtn.disabled = true;
    dfDeleteBtn.textContent = "삭제 중…";
    showBusy('장비 삭제 중…');

    try {
      const [res] = await Promise.all([
        apiFetch(`/api/devices/${selectedDeviceId}`, { method: "DELETE" }),
        minDelay(500),
      ]);

      if (!res.ok) {
        let message = `삭제에 실패했습니다. (HTTP ${res.status})`;
        try {
          const data = await res.json();
          if (data.error) message = data.error;
        } catch { /* no-op */ }
        showFormMsg(message);
        return;
      }

      clearDetailForm();
      await loadDeviceList();
    } catch {
      showFormMsg("서버에 연결할 수 없습니다.");
    } finally {
      hideBusy();
      dfDeleteBtn.disabled = false;
      dfDeleteBtn.textContent = "삭제";
    }
  }

  // ── 일괄 삭제 (선택된 체크박스 장비 전체) ───────────────────────────────────

  async function bulkDeleteDevices() {
    if (selectedIds.size === 0) {
      window.alert("삭제할 장비를 먼저 선택하세요.");
      return;
    }

    const targets = devices.filter((d) => selectedIds.has(d.id));
    const names   = targets.map((d) => `${d.displayName} (${d.deviceCode})`).join("\n  ");
    if (!window.confirm(`다음 장비 ${targets.length}대를 삭제하시겠습니까?\n\n  ${names}\n\n이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }

    bulkDeleteBtn.disabled    = true;
    bulkDeleteBtn.textContent = "삭제 중…";
    showBusy(`장비 ${targets.length}대 삭제 중…`);

    const failed = [];
    const deleteAll = async () => {
      for (const device of targets) {
        try {
          const res = await apiFetch(`/api/devices/${device.id}`, { method: "DELETE" });
          if (res.ok) {
            selectedIds.delete(device.id);
            if (selectedDeviceId === device.id) clearDetailForm();
          } else {
            failed.push(device.deviceCode);
          }
        } catch {
          failed.push(device.deviceCode);
        }
      }
    };

    await Promise.all([deleteAll(), minDelay(500)]);
    await loadDeviceList();
    hideBusy();

    if (failed.length) {
      window.alert(`일부 장비 삭제에 실패했습니다:\n${failed.join(", ")}`);
    }

    bulkDeleteBtn.disabled    = false;
    bulkDeleteBtn.textContent = "− 선택 삭제";
  }

  if (dfSaveBtn)     dfSaveBtn.addEventListener("click", saveDevice);
  if (dfResetBtn)    dfResetBtn.addEventListener("click", resetForm);
  if (dfDeleteBtn)   dfDeleteBtn.addEventListener("click", deleteDevice);
  if (bulkDeleteBtn) bulkDeleteBtn.addEventListener("click", bulkDeleteDevices);

  // ── 신규 장비 등록 모달 (POST /api/devices) ─────────────────────────────

  function showNdFormMsg(msg) {
    if (!ndFormMsg) return;
    ndFormMsg.textContent = msg;
    ndFormMsg.hidden = false;
  }

  function hideNdFormMsg() {
    if (!ndFormMsg) return;
    ndFormMsg.hidden = true;
    ndFormMsg.textContent = "";
  }

  function resetAddForm() {
    ndCode.value = "";
    ndName.value = "";
    ndDisplay.value = "";
    ndConnType.value = "serial";
    populateProtocolOptions(ndProtocol, "serial");
    ndSlave.value = "1";
    ndIp.value = "";
    ndPort.value = "502";
    ndTimeout.value = "1000";
    ndInterval.value = "5000";
    ndByteOrder.value = "big";
    ndRetry.value = "3";

    hideNdFormMsg();
  }

  function openAddModal() {
    if (PollingState.running) {
      window.alert("폴링 실행 중에는 장비를 추가할 수 없습니다.\n폴링을 정지한 후 다시 시도하세요.");
      return;
    }
    resetAddForm();
    addDeviceModal.hidden = false;
  }

  function closeAddModal() {
    addDeviceModal.hidden = true;
  }

  if (ndConnType) {
    ndConnType.addEventListener("change", () => {
      populateProtocolOptions(ndProtocol, ndConnType.value);
    });
  }

  function buildAddBody() {
    const body = {
      deviceCode:  ndCode.value.trim(),
      name:        ndName.value.trim(),
      displayName: ndDisplay.value.trim(),
      connType:    ndConnType.value,
      protocol:    ndProtocol.value,
      slaveId:     parseInt(ndSlave.value) || 1,
      byteOrder:   ndByteOrder.value,
      timeoutMs:   parseInt(ndTimeout.value) || 1000,
      intervalMs:  parseInt(ndInterval.value) || 5000,
      retryCount:  parseInt(ndRetry.value) || 0,
    };
    if (ndConnType.value === "tcp") {
      body.ipAddress = ndIp.value.trim();
      body.tcpPort   = parseInt(ndPort.value) || 502;
    }
    return body;
  }

  async function submitAddDevice() {
    if (!ndCode.value.trim() || !ndName.value.trim() || !ndDisplay.value.trim()) {
      showNdFormMsg("장비 코드 · 장비명 · 표시명은 필수입니다.");
      return;
    }

    hideNdFormMsg();
    ndSubmitBtn.disabled = true;
    ndSubmitBtn.textContent = "추가 중…";
    showBusy('장비 추가 중…');

    try {
      const [res] = await Promise.all([
        apiFetch("/api/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildAddBody()),
        }),
        minDelay(500),
      ]);

      if (!res.ok) {
        let message = `등록에 실패했습니다. (HTTP ${res.status})`;
        try {
          const data = await res.json();
          if (data.error) message = data.error;
        } catch { /* no-op */ }
        showNdFormMsg(message);
        return;
      }

      closeAddModal();
      await loadDeviceList();
    } catch {
      showNdFormMsg("서버에 연결할 수 없습니다.");
    } finally {
      hideBusy();
      ndSubmitBtn.disabled = false;
      ndSubmitBtn.textContent = "추가";
    }
  }

  if (addDeviceBtn)  addDeviceBtn.addEventListener("click", openAddModal);
  if (ndCancelBtn)   ndCancelBtn.addEventListener("click", closeAddModal);
  if (addModalClose) addModalClose.addEventListener("click", closeAddModal);
  if (ndSubmitBtn) ndSubmitBtn.addEventListener("click", submitAddDevice);

  // ── 전역 폴링 상태 구독 ──────────────────────────────────────────────────
  // 폴링 실행 중에는 설정 변경 API가 모두 거부되므로, 저장/삭제 버튼을
  // 미리 비활성화해 사용자가 시도 전에 알 수 있도록 한다. 정지/시작은
  // topbar(main.js)에서만 수행한다.

  function updateButtonsForPolling(running) {
    const disabled = running === true;
    if (dfSaveBtn)    dfSaveBtn.disabled    = disabled;
    if (dfDeleteBtn)  dfDeleteBtn.disabled  = disabled;
    if (bulkDeleteBtn) bulkDeleteBtn.disabled = disabled;
    if (ndSubmitBtn)  ndSubmitBtn.disabled  = disabled;

    const title = disabled ? "폴링 실행 중에는 사용할 수 없습니다. topbar에서 폴링을 정지하세요." : "";
    if (dfSaveBtn)    dfSaveBtn.title    = title;
    if (dfDeleteBtn)  dfDeleteBtn.title  = title;
    if (bulkDeleteBtn) bulkDeleteBtn.title = title;
    if (ndSubmitBtn)  ndSubmitBtn.title  = title;
  }

  const unsubscribePolling = PollingState.subscribe(updateButtonsForPolling);

  // ── 장비 목록 조회 (GET /api/devices, GET /api/devices/status) ────────────
  // referencs/ApiServer.cpp의 handleGetDevices / handleGetDeviceStatus 스펙대로
  // apiFetch(config.js)로 Authorization: Bearer <token> 헤더를 자동 첨부한다.

  let isFirstLoad = true;
  let isFetching  = false;

  async function loadDeviceList() {
    if (!tableBody) return false;
    if (isFetching) return false;
    isFetching = true;
    let ok = false;

    try {
      const [devRes, statusRes] = await Promise.all([
        apiFetch("/api/devices"),
        apiFetch("/api/devices/status"),
      ]);

      if (!devRes.ok) throw new Error(`장비 목록 조회 실패 (HTTP ${devRes.status})`);
      const devData = await devRes.json();
      devices = devData.devices || [];

      statusById = {};
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        for (const s of statusData.devices || []) statusById[s.deviceId] = s;
      }

      if (selectedDeviceId && !devices.some((d) => d.id === selectedDeviceId)) {
        clearDetailForm();
      }
      for (const id of selectedIds) {
        if (!devices.some((d) => d.id === id)) selectedIds.delete(id);
      }

      renderDeviceRows();
      if (summary) summary.textContent = `총 ${devices.length}대`;
      if (selectedDeviceId) {
        fillMeta(statusById[selectedDeviceId]);
      }

      if (isFirstLoad) {
        isFirstLoad = false;
        PageLoader.hide($('#pageContent'));
      }
      ok = true;
    } catch (err) {
      if (isFirstLoad) {
        PageLoader.showError(err.message, () => {
          isFirstLoad = true;
          isFetching  = false;
          PageLoader.show();
          scheduleRefresh();
        });
      }
    } finally {
      isFetching = false;
    }
    return ok;
  }

  // ── 정주기 자동 갱신 ──────────────────────────────────────────────────────────
  // setInterval 대신 recursive setTimeout 사용 — 이전 응답 완료 후 다음 타이머 등록
  // (응답 지연 시 호출 중첩 방지). isFetching 가드는 save/delete와의 동시 실행 방지용.
  const REFRESH_INTERVAL_MS = 3000;
  let refreshTimer = null;
  let destroyed    = false;

  async function scheduleRefresh() {
    //console.log(`scheduleRefresh() called`);

    const ok = await loadDeviceList();
    if (destroyed) return;  // hashchange가 await 도중에 발생한 경우 타이머 등록 방지
    if (ok || !isFirstLoad) {
      refreshTimer = setTimeout(scheduleRefresh, REFRESH_INTERVAL_MS);
    }
  }

  function stopAutoRefresh() {
    destroyed = true;
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  // 다른 페이지로 이동하면(hash 변경) 타이머를 정리해 백그라운드에서
  // 계속 폴링하거나 중복 타이머가 누적되는 것을 막는다.
  function onHashChange() {
    const current = window.location.hash.replace("#", "").trim();
    if (current !== "devices") {
      stopAutoRefresh();
      unsubscribePolling();
      window.removeEventListener("hashchange", onHashChange);
    }
  }
  window.addEventListener("hashchange", onHashChange);

  PageLoader.show();
  scheduleRefresh();
})();
