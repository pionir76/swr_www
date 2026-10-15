(() => {
  const validTabs = ['settings', 'settings-maintenance', 'settings-trend'];

  let currentTab = window.location.hash.replace('#', '');
  if (!validTabs.includes(currentTab)) currentTab = 'settings';

  let cachedConfig    = null;
  let _trendRegMap    = {};    // regId → register object (from /api/registers/realtime)
  let _trendCfgChMap  = {};    // regId → TrendChannelConfig (from /api/trend/config)

  // 트렌드 채널 페이지네이션 — 전체 레지스터는 한 번에 불러오되(서버 페이징 없음)
  // 테이블은 클라이언트에서 페이지 단위로 잘라 보여준다. 체크/태그 상태는 페이지
  // 전환에도 유지되도록 DOM이 아닌 아래 상태를 단일 소스로 사용한다.
  const TREND_PAGE_SIZE   = 16;
  let _trendRegistersAll  = [];        // 정렬된 전체 레지스터 목록
  let _trendDevMap        = {};        // deviceId → device
  let _trendCheckedSet    = new Set(); // 현재 선택된 regId
  let _trendTagMap        = new Map(); // regId → 입력된 태그명
  let _trendPage          = 1;

  const tabSubtitles = {
    'settings':             '네트워크, RS485, Modbus TCP Server 설정을 관리합니다.',
    'settings-maintenance': '시스템 정보 확인, 백업·복원, 펌웨어 업데이트 및 재시작을 관리합니다.',
    'settings-trend':       '트렌드 레코딩 채널과 샘플 간격을 설정합니다.',
  };

  // ── 탭 전환 ───────────────────────────────────────────────────────
  function switchTab(tabName) {
    currentTab = tabName;
    $$('.tab-content').forEach((el) => { el.hidden = true; });

    const panel = $(`.tab-content[data-tab="${tabName}"]`);
    if (panel) panel.hidden = false;
    
    $$('.settings-tab').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === `#${tabName}`);
    });
    const subtitle = $('.page-title-row p');
    if (subtitle) subtitle.textContent = tabSubtitles[tabName] ?? '';
  }

  function onHashChangeTab() {
    const hash = window.location.hash.replace('#', '');
    if (hash.startsWith('settings')) switchTab(hash);
  }
  window.addEventListener('hashchange', onHashChangeTab);

  // ── GET /api/config → 전체 폼 채우기 ─────────────────────────────
  async function loadConfig() {
    try {
      const res = await apiFetch('/api/config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cachedConfig = await res.json();
      fillAllForms(cachedConfig);
    } catch (err) {
      showMsg(`설정 불러오기 실패: ${err.message}`, 'error');
    }
  }

  function fillAllForms(cfg) {
    fillNetwork(cfg.network);
    fillSerial(cfg.serial);
    fillModbus(cfg.modbusServer);
  }

  function fillNetwork(net) {
    if (!net?.interfaces) return;
    $$('.network-card').forEach((card) => {
      const iface = net.interfaces.find((i) => i.name === card.dataset.iface);
      if (!iface) return;

      const enabledCb = $("input[data-net='enabled']", card);
      if (enabledCb) enabledCb.checked = !!iface.enabled;
      applyEnabledState(card, !!iface.enabled);

      const modeEl = $("[data-net='mode']", card);
      if (modeEl) {
        modeEl.value = iface.mode ?? 'static';
        applyDhcpMode(card, iface.mode === 'dhcp');
      }

      const set = (key, val) => {
        const el = $(`[data-net='${key}']`, card);
        if (el) el.value = val ?? '';
      };
      set('ip',      iface.ipAddress);
      set('netmask', iface.netmask);
      set('gateway', iface.gateway);
      set('dns',     iface.dns);
    });
  }

  function fillSerial(serial) {
    if (!serial) return;
    const set = (key, val) => {
      const el = $(`[data-serial='${key}']`);
      if (el) el.value = String(val ?? '');
    };
    set('device',   serial.device);
    set('baudRate', serial.baudRate);
    set('parity',   serial.parity);
    set('stopBits', serial.stopBits);
    set('dataBits', serial.dataBits);
  }

  function fillModbus(mbs) {
    if (!mbs) return;
    const enabledCb = $("[data-modbus='enabled']");
    if (enabledCb) enabledCb.checked = !!mbs.enabled;
    const port = $("[data-modbus='port']");
    if (port) port.value = mbs.port ?? '';
    const slaveId = $("[data-modbus='slaveId']");
    if (slaveId) slaveId.value = mbs.slaveId ?? '';
  }

  // ── DHCP 모드: 정적 IP 필드 비활성화 ─────────────────────────────
  const STATIC_FIELDS = ['ip', 'netmask', 'gateway', 'dns'];

  function applyDhcpMode(card, isDhcp) {
    STATIC_FIELDS.forEach((key) => {
      const input = $(`[data-net='${key}']`, card);
      if (!input) return;
      input.disabled = isDhcp;
      input.closest('.form-field').classList.toggle('field-disabled', isDhcp);
    });
  }

  function applyEnabledState(card, isEnabled) {
    const chip = $('.status-chip', card);
    if (chip) {
      chip.classList.toggle('ok',  isEnabled);
      chip.classList.toggle('off', !isEnabled);
      chip.textContent = isEnabled ? '사용 중' : '미사용';
    }

    // 미사용 시 모든 설정 입력 비활성화
    $$('select[data-net], input[data-net]', card).forEach((el) => {
      if (el.dataset.net === 'enabled') return; // 토글 자체는 유지
      el.disabled = !isEnabled;
      el.closest('.form-field')?.classList.toggle('field-disabled', !isEnabled);
    });

    // 활성화 시 DHCP 모드 재적용 (정적 IP 필드 상태 복원)
    if (isEnabled) {
      const modeEl = $("[data-net='mode']", card);
      if (modeEl) applyDhcpMode(card, modeEl.value === 'dhcp');
    }
  }

  $$('.network-card').forEach((card) => {
    $("[data-net='mode']", card)?.addEventListener('change', (e) => {
      applyDhcpMode(card, e.target.value === 'dhcp');
    });

    $("input[data-net='enabled']", card)?.addEventListener('change', (e) => {
      applyEnabledState(card, e.target.checked);
    });
  });

  // ── 저장: 네트워크·RS485·Modbus 동시 저장 ────────────────────────
  async function save() {
    const btn = $('#netSaveBtn');
    if (btn) btn.disabled = true;
    try {
      await Promise.all([saveNetwork(), saveSerial(), saveModbus()]);
      showMsg('저장되었습니다. 변경사항 적용을 위해 재시작이 필요할 수 있습니다.');
    } catch (err) {
      showMsg(`저장 실패: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // PUT /api/config/network
  async function saveNetwork() {
    const interfaces = $$('.network-card').map((card) => {
      const ifaceName  = card.dataset.iface;
      // role은 UI에서 수정 불가 — 서버 응답값 그대로 유지
      const cachedRole = cachedConfig?.network?.interfaces
        ?.find((i) => i.name === ifaceName)?.role ?? '';
      const mode   = $("[data-net='mode']", card)?.value ?? 'static';
      const isDhcp = mode === 'dhcp';
      return {
        name:      ifaceName,
        role:      cachedRole,
        enabled:   $("input[data-net='enabled']", card)?.checked ?? true,
        mode,
        // DHCP이면 빈 문자열 — 서버가 자동 할당
        ipAddress: isDhcp ? '' : ($("[data-net='ip']",      card)?.value ?? ''),
        netmask:   isDhcp ? '' : ($("[data-net='netmask']", card)?.value ?? ''),
        gateway:   isDhcp ? '' : ($("[data-net='gateway']", card)?.value ?? ''),
        dns:       isDhcp ? '' : ($("[data-net='dns']",     card)?.value ?? ''),
      };
    });
    const res = await apiFetch('/api/config/network', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interfaces }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error ?? `network: HTTP ${res.status}`);
    }
  }

  // PUT /api/config/serial
  async function saveSerial() {
    const body = {
      baudRate: Number($("[data-serial='baudRate']")?.value),
      dataBits: Number($("[data-serial='dataBits']")?.value),
      parity:   $("[data-serial='parity']")?.value ?? 'none',
      stopBits: Number($("[data-serial='stopBits']")?.value),
    };
    const res = await apiFetch('/api/config/serial', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error ?? `serial: HTTP ${res.status}`);
    }
  }

  // PUT /api/config/modbus-server
  async function saveModbus() {
    const body = {
      enabled: $("[data-modbus='enabled']")?.checked ?? false,
      port:    Number($("[data-modbus='port']")?.value),
      slaveId: Number($("[data-modbus='slaveId']")?.value),
    };
    const res = await apiFetch('/api/config/modbus-server', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error ?? `modbus: HTTP ${res.status}`);
    }
  }

  // ── POST /api/config/reset → 팩토리 기본값 수신 후 폼 갱신 ──────
  async function reset() {
    if (!window.confirm('설정을 공장 초기값으로 되돌립니다.\n계속하시겠습니까?')) return;
    const btn = $('#netResetBtn');
    if (btn) btn.disabled = true;
    try {
      const res = await apiFetch('/api/config/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const defaults = await res.json();
      // 캐시를 기본값으로 교체 후 폼 갱신
      cachedConfig = defaults;
      fillAllForms(defaults);
      const msg = defaults.restartRequired
        ? '초기화되었습니다. 재시작 후 적용됩니다.'
        : '초기화되었습니다.';
      showMsg(msg);
    } catch (err) {
      showMsg(`초기화 실패: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── POST /api/system/restart ──────────────────────────────────────
  async function restart() {
    if (!window.confirm('시스템을 재시작합니다.\n진행 중인 폴링이 중단됩니다. 계속하시겠습니까?')) return;
    const btn = $('#netRestartBtn');
    if (btn) btn.disabled = true;
    try {
      const res = await apiFetch('/api/system/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // 재시작 후 앱이 종료되므로 버튼은 disabled 유지
      showMsg('재시작 요청이 전송되었습니다. 잠시 후 연결이 끊어집니다.');
    } catch (err) {
      showMsg(`재시작 실패: ${err.message}`, 'error');
      if (btn) btn.disabled = false;
    }
  }

  // ── 메시지 배너 (4초 후 자동 숨김) ──────────────────────────────
  function showMsg(text, type = 'ok') {
    // 트렌드 탭: 적용 버튼 옆 인라인 메시지 사용
    const trendMsg = $('#trendMsg');
    if (trendMsg && !trendMsg.closest('.tab-content')?.hidden) {
      trendMsg.textContent = text;
      trendMsg.className = `trend-msg${type === 'error' ? ' error' : ''}`;
      trendMsg.hidden = false;
      clearTimeout(trendMsg._timer);
      trendMsg._timer = setTimeout(() => { trendMsg.hidden = true; }, 4000);
      return;
    }

    let el = $('#settingsMsg');
    if (!el) {
      el = document.createElement('div');
      el.id = 'settingsMsg';
    }
    const anchor = $('.settings-action-bar') ?? $('.tab-content:not([hidden])');
    anchor?.insertAdjacentElement('beforebegin', el);

    el.className = `banner${type === 'error' ? ' warn' : ''}`;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  // ── 복원 (validate → apply) ──────────────────────────────────────
  let restoreId = null;

  const restoreFileInput = $('#restoreFileInput');
  const restoreDropZone  = $('#restoreDropZone');

  function setRestoreState(state) {
    const map = {
      IDLE:           '#restoreIdle',
      VALIDATING:     '#restoreValidating',
      READY_TO_APPLY: '#restorePreview',
      APPLYING:       '#restoreApplying',
      DONE:           '#restoreDone',
    };
    Object.values(map).forEach((sel) => {
      const el = $(sel); if (el) el.hidden = true;
    });
    const active = $(map[state]);
    if (active) active.hidden = false;
  }

  restoreFileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) doValidate(file);
  });

  restoreDropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    restoreDropZone.classList.add('drag-over');
  });
  restoreDropZone?.addEventListener('dragleave', () => {
    restoreDropZone.classList.remove('drag-over');
  });
  restoreDropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    restoreDropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file) doValidate(file);
  });

  async function doValidate(file) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      showMsg('ZIP 파일만 업로드할 수 있습니다.', 'error');
      return;
    }
    setRestoreState('VALIDATING');
    try {
      const buf = await file.arrayBuffer();
      const minDelay = new Promise((r) => setTimeout(r, 800));
      const [res] = await Promise.all([
        apiFetch('/api/maintenance/restore/validate', {
          method:  'POST',
          headers: { 'Content-Type': 'application/zip' },
          body:    buf,
        }),
        minDelay,
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      restoreId = data.restoreId;
      renderPreview(data);
      setRestoreState('READY_TO_APPLY');
    } catch (err) {
      showMsg(`파일 검증 실패: ${err.message}`, 'error');
      setRestoreState('IDLE');
      if (restoreFileInput) restoreFileInput.value = '';
    }
  }

  function renderPreview(data) {
    const info = data.backupInfo ?? {};
    const metaEl = $('#restoreMetaInfo');
    if (metaEl) {
      metaEl.innerHTML = [
        info.createdAt     ? `<span class="restore-meta-chip">생성: ${info.createdAt.replace('T', ' ')}</span>` : '',
        info.hostname      ? `<span class="restore-meta-chip">호스트: ${info.hostname}</span>` : '',
        info.version       ? `<span class="restore-meta-chip">Ver.${info.version} Rev.${info.revision}</span>` : '',
        info.schemaVersion != null ? `<span class="restore-meta-chip">Schema v${info.schemaVersion}</span>` : '',
      ].join('');
    }

    const warningsEl = $('#restoreWarnings');
    if (warningsEl) {
      // 'HMI만 복원 + 레지스터 미복원' 경고는 백엔드가 항상 내려준다 — 그 조합일 때만 아래 옵션 영역에서 표시
      const warns = (data.warnings ?? []).filter((w) => !/without registers/i.test(w));
      if (warns.length) {
        warningsEl.innerHTML = warns.map((w) => `<div>⚠ ${w}</div>`).join('');
        warningsEl.hidden = false;
      } else {
        warningsEl.hidden = true;
      }
    }

    const optEl = $('#restoreOptions');
    if (optEl) {
      const ITEMS = [
        { key: 'config',    label: '시스템 설정',   defaultOn: true  },
        { key: 'devices',   label: '장비 목록',     defaultOn: true,  showCount: true },
        { key: 'registers', label: '레지스터 목록', defaultOn: true,  showCount: true },
        { key: 'users',     label: '사용자 계정',   defaultOn: true,  showCount: true },
        { key: 'network',   label: '네트워크 설정', defaultOn: false, warn: 'IP 충돌 가능' },
        { key: 'hmi',       label: 'HMI 화면·태그', defaultOn: true,  showCount: true, countUnit: '개 화면', warn: '기존 HMI 전체 교체' },
      ];
      optEl.innerHTML = ITEMS.map(({ key, label, defaultOn, showCount, countUnit = '개', warn }) => {
        const item = data[key];
        if (!item?.available) return '';
        const countBadge = showCount && item.count
          ? `<span class="restore-option-count">${item.count.toLocaleString()}${countUnit}</span>` : '';
        const warnBadge = warn
          ? `<span class="restore-option-warn">⚠ ${warn}</span>` : '';
        return `
          <div class="restore-option-row">
            <label>
              <input type="checkbox" data-opt="${key}"${defaultOn ? ' checked' : ''}>
              ${label}
            </label>
            ${countBadge}${warnBadge}
          </div>`;
      }).join('') + `
        <div class="restore-warnings" id="restoreHmiWarn" hidden>
          ⚠ 레지스터를 복원하지 않고 HMI만 복원하면, 현재 장비에 없는 레지스터를 가리키는 HMI 태그는 삭제됩니다.
        </div>`;
      const updateHmiWarn = () => {
        const checked = (k) => !!$(`[data-opt="${k}"]`, optEl)?.checked;
        $('#restoreHmiWarn', optEl).hidden = !(checked('hmi') && !checked('registers'));
      };
      optEl.onchange = updateHmiWarn;
      updateHmiWarn();
    }
  }

  $('#restoreCancelBtn')?.addEventListener('click', () => {
    restoreId = null;
    if (restoreFileInput) restoreFileInput.value = '';
    setRestoreState('IDLE');
  });

  $('#restoreApplyBtn')?.addEventListener('click', async () => {
    if (!restoreId) return;
    if (!window.confirm('현재 설정이 백업 파일의 내용으로 교체됩니다.\n복원 후 시스템 재시작이 필요합니다. 계속하시겠습니까?')) return;
    const options = { config: false, devices: false, registers: false, network: false, users: false, hmi: false };
    $$('[data-opt]', $('#restoreOptions')).forEach((cb) => {
      if (Object.prototype.hasOwnProperty.call(options, cb.dataset.opt))
        options[cb.dataset.opt] = cb.checked;
    });
    setRestoreState('APPLYING');
    try {
      const minDelay = new Promise((r) => setTimeout(r, 800));
      const [res] = await Promise.all([
        apiFetch('/api/maintenance/restore/apply', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ restoreId, options }),
        }),
        minDelay,
      ]);
      const data = await res.json();
      if (res.status === 409) {
        showMsg('폴링이 실행 중입니다. 폴링을 정지한 후 다시 시도하세요.', 'error');
        setRestoreState('READY_TO_APPLY');
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      restoreId = null;
      setRestoreState('DONE');
    } catch (err) {
      showMsg(`복원 실패: ${err.message}`, 'error');
      setRestoreState('IDLE');
      if (restoreFileInput) restoreFileInput.value = '';
    }
  });

  function updateApplyPollWarning(running) {
    const note     = $('.restore-apply-note');
    const applyBtn = $('#restoreApplyBtn');
    if (!note || !applyBtn) return;
    if (running) {
      note.textContent = '⚠ 폴링이 실행 중입니다. 폴링을 정지한 후 복원을 적용할 수 있습니다.';
      note.classList.add('polling-warn');
      applyBtn.disabled = true;
    } else {
      note.textContent = '복원 적용 후 시스템 재시작이 필요합니다.';
      note.classList.remove('polling-warn');
      applyBtn.disabled = false;
    }
  }

  const unsubApplyPollWarning = PollingState.subscribe(updateApplyPollWarning);

  // ── GET /api/maintenance/backup → ZIP 다운로드 ───────────────────
  async function downloadBackup() {

     if (!window.confirm('백업 파일을 다운로드합니다.\n계속하시겠습니까?')) return;

    const btn = $('#backupDownloadBtn');
    if (btn) { btn.disabled = true; btn.textContent = '생성 중…'; }
    try {
      const res = await apiFetch('/api/maintenance/backup');
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const cd   = res.headers.get('Content-Disposition') ?? '';
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1]
        : `swr_backup_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}.zip`;

      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showMsg(`백업 다운로드 실패: ${err.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Download'; }
    }
  }

  // ── 버튼 이벤트 ──────────────────────────────────────────────────
  $('#netSaveBtn')?.addEventListener('click', save);
  $('#netResetBtn')?.addEventListener('click', reset);
  $('#netRestartBtn')?.addEventListener('click', restart);
  $('#backupDownloadBtn')?.addEventListener('click', downloadBackup);

  // ── NTP 적용 ─────────────────────────────────────────────────────
  $('#ntpApplyBtn')?.addEventListener('click', async () => {
    const input = $('#ntpServerInput');
    const server = input?.value.trim();
    if (!server) { showMsg('NTP 서버 주소를 입력하세요.', 'error'); return; }

    if (!window.confirm(
      `NTP 서버를 "${server}"으로 변경합니다.\n변경사항은 재시작 후 적용됩니다. 계속하시겠습니까?`
    )) return;

    try {
      const res = await apiFetch('/api/config/system', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ntpServer: server }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showMsg(`저장 실패: ${d.error || `HTTP ${res.status}`}`, 'error');
        return;
      }
      showMsg('NTP 서버가 저장되었습니다. 재시작 후 적용됩니다.');
    } catch (err) {
      showMsg(`저장 실패: ${err.message}`, 'error');
    }
  });

  // ── 시간대 / NTP on-off / 수동 시간 설정 ────────────────────────────
  let _ntpEnabled      = true;  // 조회 전까지는 보수적으로 true(수동 입력 비활성) 가정
  let _recordingActive = false; // 트렌드 레코딩 중이면 시간대/시간 변경 자체를 막음

  function updateSystimeGuards() {
    const tzSel       = $('#timezoneSelect');
    const manualInput = $('#manualDatetimeInput');
    const applyBtn    = $('#systimeApplyBtn');
    const hint        = $('#systimeHint');

    // NTP가 꺼져 있으면(수동 시간 관리 모드) 시간대 변경은 막는다 — 시간대만 바꾸고
    // 수동 시간을 다시 안 맞추면 표시 시각이 꼬이는 걸 방지. NTP/수동시간/시간대는
    // 서로 배타적으로 하나만 활성화된다. 적용 버튼은 하나를 공유하며, NTP 상태에 따라
    // 시간대 적용/수동시간 적용으로 동작이 바뀐다(레코딩 중일 때만 버튼 자체를 잠금).
    const tzBlocked = _recordingActive || !_ntpEnabled;
    if (tzSel) tzSel.disabled = tzBlocked;

    const manualBlocked = _recordingActive || _ntpEnabled;
    if (manualInput) manualInput.disabled = manualBlocked;

    if (applyBtn) applyBtn.disabled = _recordingActive;

    if (hint) {
      if (_recordingActive) {
        hint.textContent = '레코딩 중에는 시간대·시간을 변경할 수 없습니다. 먼저 레코딩을 정지하세요.';
        hint.hidden = false;
      } else if (!_ntpEnabled) {
        hint.textContent = 'NTP가 꺼진 상태에서는 시간대를 변경할 수 없습니다. 시간대를 바꾸려면 NTP를 다시 켜세요.';
        hint.hidden = false;
      } else {
        hint.hidden = true;
      }
    }
  }

  async function loadSystemTime() {
    try {
      const res = await apiFetch('/api/system/time');
      if (!res.ok) return;
      const d = await res.json();

      _ntpEnabled = !!d.ntpEnabled;
      const toggle = $('#ntpEnabledToggle');
      if (toggle) toggle.checked = _ntpEnabled;

      const tzSel = $('#timezoneSelect');
      if (tzSel && d.timezone) tzSel.value = d.timezone;

      const manualInput = $('#manualDatetimeInput');
      if (manualInput && d.localTime) manualInput.value = d.localTime.slice(0, 19);

      updateSystimeGuards();
    } catch (_) { /* API 미구현 시 무시 */ }
  }

  async function loadRecordingGuardState() {
    try {
      const res = await apiFetch('/api/tfile/status');
      if (!res.ok) return;
      const d = await res.json();
      _recordingActive = !!d.recording;
      updateSystimeGuards();
      updateTrendGuards();
    } catch (_) { /* tfile API 미구현 시 무시 */ }
  }

  // 녹화 중에는 트렌드 채널/샘플 간격 설정과 전체 삭제를 잠근다 — 이미 시작된
  // 파일의 헤더는 시작 시점 설정으로 고정되므로, 녹화 중 변경은 혼란만 준다.
  function updateTrendGuards() {
    $$('input[name="trendInterval"]').forEach((r) => { r.disabled = _recordingActive; });

    const selectAllCb = $('#trendSelectAll');
    if (selectAllCb) selectAllCb.disabled = _recordingActive;

    $('#trendChannelList')?.querySelectorAll('tr').forEach((tr) => {
      const cb  = tr.querySelector('input[type="checkbox"]');
      const tag = tr.querySelector('.trend-tag-input');
      if (!cb) return;
      cb.disabled = _recordingActive;
      if (tag) tag.disabled = _recordingActive || !cb.checked;
    });

    const applyBtn = $('#trendApplyBtn');
    if (applyBtn) applyBtn.disabled = _recordingActive;

    const deleteAllBtn = $('#trendDeleteAllBtn');
    if (deleteAllBtn) deleteAllBtn.disabled = _recordingActive;

    const guardHint = $('#trendGuardHint');
    if (guardHint) guardHint.hidden = !_recordingActive;

    const deleteNote = $('#trendDeleteAllNote');
    if (deleteNote) {
      deleteNote.textContent = _recordingActive ? '⚠ 녹화 중입니다. 정지한 후 삭제할 수 있습니다.' : '';
      deleteNote.className   = `factory-reset-note${_recordingActive ? ' polling-warn' : ''}`;
    }
  }

  $('#ntpEnabledToggle')?.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    const msg = enabled
      ? 'NTP 자동 동기화를 켭니다. 계속하시겠습니까?'
      : 'NTP 자동 동기화를 끕니다. 이후 수동으로 시간을 설정할 수 있습니다. 계속하시겠습니까?';
    if (!window.confirm(msg)) { e.target.checked = !enabled; return; }

    e.target.disabled = true;
    showBusy(); // NTP on/off는 실제 적용(timedatectl)까지 살짝 지연이 있어 진행 중임을 표시
    const minDelay = new Promise((r) => setTimeout(r, 800));
    try {
      const [res] = await Promise.all([
        apiFetch('/api/system/ntp', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        }),
        minDelay,
      ]);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showMsg(`NTP 설정 실패: ${d.error || `HTTP ${res.status}`}`, 'error');
        e.target.checked = !enabled;
        return;
      }
      const d = await res.json();
      _ntpEnabled = !!d.ntpEnabled;
      updateSystimeGuards();
      showMsg(enabled ? 'NTP 동기화가 켜졌습니다.' : 'NTP 동기화가 꺼졌습니다. 수동으로 시간을 설정하세요.');
    } catch (err) {
      showMsg(`NTP 설정 실패: ${err.message}`, 'error');
      e.target.checked = !enabled;
    } finally {
      hideBusy();
      e.target.disabled = false;
    }
  });

  async function applyTimezone() {
    const tz = $('#timezoneSelect')?.value;
    if (!tz) return;
    if (!window.confirm(`시간대를 "${tz}"(으)로 변경합니다. 계속하시겠습니까?`)) return;

    const btn = $('#systimeApplyBtn');
    if (btn) btn.disabled = true;
    try {
      const res = await apiFetch('/api/system/timezone', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: tz }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showMsg(`시간대 변경 실패: ${d.error || `HTTP ${res.status}`}`, 'error');
        return;
      }
      showMsg('시간대가 변경되었습니다.');
      await loadSystemTime();
    } catch (err) {
      showMsg(`시간대 변경 실패: ${err.message}`, 'error');
    } finally {
      updateSystimeGuards(); // 단일 소스(NTP/레코딩 상태)로 다시 계산 — 임의로 덮어쓰지 않음
    }
  }

  async function applyManualTime() {
    const raw = $('#manualDatetimeInput')?.value;
    if (!raw) { showMsg('날짜/시간을 입력하세요.', 'error'); return; }
    if (!window.confirm(`시스템 시간을 "${raw}"(으)로 변경합니다. 계속하시겠습니까?`)) return;

    const btn = $('#systimeApplyBtn');
    if (btn) btn.disabled = true;
    try {
      // datetime-local 값은 초가 생략될 수 있음(YYYY-MM-DDTHH:mm)
      const datetime = raw.length === 16 ? `${raw}:00` : raw;
      const res = await apiFetch('/api/system/time', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datetime }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        showMsg(`시간 설정 실패: ${d.error || `HTTP ${res.status}`}`, 'error');
        return;
      }
      showMsg('시스템 시간이 변경되었습니다.');
      await loadSystemTime();
    } catch (err) {
      showMsg(`시간 설정 실패: ${err.message}`, 'error');
    } finally {
      updateSystimeGuards(); // 단일 소스(NTP/레코딩 상태)로 다시 계산 — 임의로 덮어쓰지 않음
    }
  }

  // 적용 버튼 하나를 공유 — NTP 켜짐이면 시간대 적용, 꺼짐이면 수동시간 적용
  // (두 필드가 서로 배타적으로만 활성화되므로 버튼도 그에 맞춰 동작이 바뀐다)
  $('#systimeApplyBtn')?.addEventListener('click', () => {
    if (_ntpEnabled) applyTimezone();
    else applyManualTime();
  });

  // ── 언어 설정 (디바이스 공통, ManagerOrAbove만 변경 가능) ────────────
  function loadLanguageSetting() {
    const sel = $('#languageSelect');
    if (sel) sel.value = I18n.lang;
    updateLanguageControl();
  }

  function updateLanguageControl() {
    const sel  = $('#languageSelect');
    const btn  = $('#languageApplyBtn');
    const hint = $('#languageHint');
    if (!sel || !btn || !hint) return;

    const allowed = currentUserRole === 'admin' || currentUserRole === 'manager';
    sel.disabled = !allowed;
    btn.disabled = !allowed;
    if (allowed) {
      hint.hidden = true;
    } else {
      hint.textContent = '⚠ Admin 또는 Manager 계정으로만 언어를 변경할 수 있습니다.';
      hint.hidden = false;
    }
  }

  $('#languageApplyBtn')?.addEventListener('click', async () => {
    const sel = $('#languageSelect');
    const lang = sel?.value;
    if (!lang || lang === I18n.lang) return;

    const btn = $('#languageApplyBtn');
    if (btn) btn.disabled = true;
    try {
      const result = await I18n.setLanguage(lang);
      if (!result.ok) {
        showMsg(`언어 변경 실패: ${result.error || `HTTP ${result.status}`}`, 'error');
        return;
      }
      loadPage(getCurrentPage()); // 현재 페이지를 새 언어로 다시 렌더링
    } catch (err) {
      showMsg(`언어 변경 실패: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = !(currentUserRole === 'admin' || currentUserRole === 'manager');
    }
  });

  // ── GET /api/system/info ──────────────────────────────────────────
  async function loadSystemInfo() {
    try {
      const res = await apiFetch('/api/system/info');
      if (!res.ok) return;
      const d = await res.json();

      if (d.info) {
        const set = (id, val) => { const el = $(`#${id}`); if (el && val != null) el.textContent = val; };
        set('sysVersion',    d.info.ver   != null ? `Ver.${String(d.info.ver).padStart(2, '0')}`     : null);
        set('sysRevision',   d.info.rev   != null ? `Rev.${String(d.info.rev).padStart(3, '0')}`     : null);
        set('sysZcode',      d.info.zcode != null ? `Zcode.${String(d.info.zcode).padStart(2, '0')}` : null);
        set('sysLastUpdate', d.info.lastUpdateDate);
      }

      if (d.summary) {
        const dc = $('#backupDeviceCount');
        const rc = $('#backupRegisterCount');
        if (dc) dc.textContent = `장비 ${(d.summary.deviceCount ?? 0).toLocaleString()}대`;
        if (rc) rc.textContent = `레지스터 ${(d.summary.registerCount ?? 0).toLocaleString()}개`;
      }

      if (d.ntp) {
        const serverInput = $('#ntpServerInput');
        if (serverInput && d.ntp.server) serverInput.value = d.ntp.server;

        const syncedEl = $('#ntpSyncedEl');
        const errorEl  = $('#ntpErrorEl');
        if (syncedEl) {
          const ok = !!d.ntp.synced;
          syncedEl.textContent = ok ? '● 동기화됨' : '● 미동기화';
          syncedEl.className   = ok ? 'ntp-synced-on' : 'ntp-synced-off';
        }
        if (errorEl) {
          errorEl.textContent = d.ntp.synced && d.ntp.maxErrorMs != null
            ? `${d.ntp.maxErrorMs.toFixed(1)} ms`
            : '—';
        }
      }
    } catch (_) { /* API 미구현 시 무시 */ }
  }

  // ── GET /api/system/resources (5초 주기 폴링) ─────────────────────
  const SYSRES_CIRC = 2 * Math.PI * 40; // r=40, ≈ 251.3

  function setDonut(fillId, pctId, pct) {
    const fill = $(`#${fillId}`);
    const lbl  = $(`#${pctId}`);
    if (fill) fill.style.strokeDashoffset = SYSRES_CIRC * (1 - Math.min(pct, 100) / 100);
    if (lbl)  lbl.textContent = `${Math.round(pct)}%`;
  }

  function fmtKb(kb) {
    if (kb == null || kb < 0) return '—';
    if (kb >= 1048576) return (kb / 1048576).toFixed(1) + ' GB';
    if (kb >= 1024)    return (kb / 1024).toFixed(0) + ' MB';
    return kb + ' KB';
  }

  function fmtMb(mb) {
    if (mb == null || mb < 0) return '—';
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return mb + ' MB';
  }

  function fmtBytes(bytes) {
    if (bytes == null || bytes < 0) return '—';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes >= 1048576)    return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024)       return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  function fmtUptime(sec) {
    if (sec == null || sec < 0) return '—';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}일 ${h}시간`;
    if (h > 0) return `${h}시간 ${m}분`;
    return `${m}분`;
  }

  function renderSysres(d) {
    const el = (id, v) => { const e = $(`#${id}`); if (e) e.textContent = v; };

    // CPU
    const cpu = d.cpu ?? {};
    setDonut('cpuDonutFill', 'cpuDonutPct', cpu.usagePercent ?? 0);
    el('cpuUsageVal', `${(cpu.usagePercent ?? 0).toFixed(1)} %`);
    el('cpuTemp',  cpu.tempCelsius != null ? `${cpu.tempCelsius.toFixed(1)} °C` : '—');
    el('cpuLoad1', cpu.loadAvg1    != null ? cpu.loadAvg1.toFixed(2) : '—');
    el('cpuLoad5', cpu.loadAvg5    != null ? cpu.loadAvg5.toFixed(2) : '—');

    // Memory
    const mem  = d.memory ?? {};
    const swap = d.swap   ?? {};
    setDonut('memDonutFill', 'memDonutPct', mem.usagePercent ?? 0);
    el('memUsageVal', `${(mem.usagePercent ?? 0).toFixed(1)} %`);
    el('memUsedVal',  fmtKb(mem.usedKb));
    el('memTotalVal', fmtKb(mem.totalKb));
    el('swapUsedVal', (swap.usedKb ?? 0) > 0 ? fmtKb(swap.usedKb) : '미사용');

    // Disk
    const disks = d.disk ?? [];
    const dRoot = disks.find((dk) => dk.mount === '/');

    if (dRoot) {
      setDonut('diskRootFill', 'diskRootPct', dRoot.usagePercent ?? 0);
      el('diskRootUsageVal', `${(dRoot.usagePercent ?? 0).toFixed(1)} %`);
      el('diskRootUsed',  fmtMb(dRoot.usedMb));
      el('diskRootTotal', fmtMb(dRoot.totalMb));
      el('diskRootFree',  fmtMb((dRoot.totalMb ?? 0) - (dRoot.usedMb ?? 0)));
    }

    // Strip
    el('sysUptime', fmtUptime(d.uptimeSeconds));
    const eth0 = d.network?.eth0;
    const eth1 = d.network?.eth1;
    el('ethRx0', eth0 ? fmtBytes(eth0.rxBytes) : '—');
    el('ethTx0', eth0 ? fmtBytes(eth0.txBytes) : '—');
    el('ethRx1', eth1 ? fmtBytes(eth1.rxBytes) : '—');
    el('ethTx1', eth1 ? fmtBytes(eth1.txBytes) : '—');
    const cat = (d.cachedAt ?? '').replace('T', ' ');
    el('sysCachedAt', cat ? cat.slice(11, 16) : '—');
  }

  async function loadSystemResources() {
    try {
      const res = await apiFetch('/api/system/resources');
      if (!res.ok) return;
      renderSysres(await res.json());
    } catch (_) {}
  }

  // ── 공장 초기화 ──────────────────────────────────────────────────
  let currentUserRole = null;
  let frPollingRunning = false;

  async function loadCurrentUserRole() {
    try {
      const res = await apiFetch('/api/users');
      if (!res.ok) return;
      const data = await res.json();
      const me = (data.users ?? []).find((u) => u.username === getUsername());
      if (me) currentUserRole = me.role;
    } catch (_) {}
    updateFactoryResetBtn();
    updateLanguageControl();
  }

  function updateFactoryResetBtn() {
    const btn  = $('#factoryResetBtn');
    const note = $('#factoryResetNote');
    if (!btn || !note) return;
    if (frPollingRunning) {
      note.textContent = '⚠ 폴링이 실행 중입니다. 폴링을 정지한 후 공장 초기화를 수행할 수 있습니다.';
      note.className   = 'factory-reset-note polling-warn';
      btn.disabled     = true;
    } else if (currentUserRole !== 'admin') {
      note.textContent = '⚠ Admin 계정으로만 공장 초기화를 수행할 수 있습니다.';
      note.className   = 'factory-reset-note role-warn';
      btn.disabled     = true;
    } else {
      note.textContent = '';
      note.className   = 'factory-reset-note';
      btn.disabled     = false;
    }
  }

  const unsubFactoryResetPoll = PollingState.subscribe((running) => {
    frPollingRunning = running;
    updateFactoryResetBtn();
  });

  function closeFactoryResetModal() {
    const modal = $('#factoryResetModal');
    if (modal) modal.hidden = true;
  }

  $('#factoryResetBtn')?.addEventListener('click', () => {
    if (!window.confirm(
      '공장 초기화를 수행합니다.\n\n' +
      '장비·레지스터·사용자·설정·로그가 모두 삭제됩니다.\n' +
      '이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?'
    )) return;
    const modal   = $('#factoryResetModal');
    const pwInput = $('#factoryResetPwInput');
    const errEl   = $('#factoryResetPwError');
    if (modal) modal.hidden = false;
    if (pwInput) { pwInput.value = ''; pwInput.focus(); }
    if (errEl) errEl.hidden = true;
  });

  $('#factoryResetModalClose')?.addEventListener('click', closeFactoryResetModal);
  $('#factoryResetModalCancel')?.addEventListener('click', closeFactoryResetModal);

  $('#factoryResetModal')?.addEventListener('click', (e) => {
    if (e.target === $('#factoryResetModal')) closeFactoryResetModal();
  });

  $('#factoryResetPwInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#factoryResetModalConfirm')?.click();
  });

  $('#factoryResetModalConfirm')?.addEventListener('click', async () => {
    const pwInput    = $('#factoryResetPwInput');
    const errEl      = $('#factoryResetPwError');
    const confirmBtn = $('#factoryResetModalConfirm');
    const password   = pwInput?.value ?? '';

    if (!password) {
      if (errEl) { errEl.textContent = '비밀번호를 입력하세요.'; errEl.hidden = false; }
      return;
    }

    if (confirmBtn) confirmBtn.disabled = true;
    try {
      // 비밀번호 검증 — POST /api/login 재사용
      const verifyRes = await fetch('/api/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: getUsername(), password }),
      });
      if (!verifyRes.ok) {
        const msg = verifyRes.status === 401
          ? '비밀번호가 올바르지 않습니다.'
          : '계정 확인에 실패하였습니다. 다시 시도하세요.';
        if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
        return;
      }

      // 모달 닫고 busy 상태 전환
      closeFactoryResetModal();
      const idleEl = $('#factoryResetIdle');
      const busyEl = $('#factoryResetBusy');
      if (idleEl) idleEl.hidden = true;
      if (busyEl) busyEl.hidden = false;

      // 공장 초기화 (최소 3초 busy)
      const minDelay = new Promise((r) => setTimeout(r, 3000));
      const [frRes] = await Promise.all([
        apiFetch('/api/maintenance/factory-reset', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    '{}',
        }),
        minDelay,
      ]);

      if (!frRes.ok) {
        const e = await frRes.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${frRes.status}`);
      }

      // 자동 재시작
      await apiFetch('/api/system/restart', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    '{}',
      });
      showMsg('공장 초기화가 완료되었습니다. 시스템을 재시작합니다…');
    } catch (err) {
      showMsg(`공장 초기화 실패: ${err.message}`, 'error');
      const idleEl = $('#factoryResetIdle');
      const busyEl = $('#factoryResetBusy');
      if (busyEl) busyEl.hidden = true;
      if (idleEl) idleEl.hidden = false;
    } finally {
      if (confirmBtn) confirmBtn.disabled = false;
    }
  });

  // ── 트렌드 설정 ──────────────────────────────────────────────────

  async function loadTrendConfig() {
    const tbodyEl = $('#trendChannelList');
    if (!tbodyEl) return;

    try {
      const [regRes, devRes, cfgRes] = await Promise.all([
        apiFetch('/api/registers/realtime'),
        apiFetch('/api/devices'),
        apiFetch('/api/trend/config'),
      ]);

      if (!regRes.ok || !devRes.ok || !cfgRes.ok) throw new Error('로드 실패');

      const regData = await regRes.json();
      const devData = await devRes.json();
      const cfg     = await cfgRes.json();

      // 디바이스 맵 (id → device)
      const devMap = {};
      (devData.devices ?? []).forEach((d) => { devMap[d.id] = d; });

      // 샘플 간격 라디오
      const radio = $(`input[name="trendInterval"][value="${cfg.sampleIntervalSec ?? 10}"]`);
      if (radio) radio.checked = true;

      // 레지스터 맵 / 기존 트렌드 채널 맵 저장 (PUT 시 참조)
      _trendRegMap   = {};
      _trendCfgChMap = {};

      (regData.registers ?? []).forEach((r) => { _trendRegMap[r.id] = r; });
      (cfg.channels ?? []).forEach((ch) => { _trendCfgChMap[ch.regId] = ch; });

      // 채널 테이블 상태 초기화 (페이지네이션은 클라이언트 측에서 처리)
      _trendRegistersAll = (regData.registers ?? []).slice().sort((a, b) => a.id - b.id);
      _trendDevMap       = devMap;
      _trendCheckedSet   = new Set((cfg.channels ?? []).map((ch) => ch.regId));
      _trendTagMap       = new Map((cfg.channels ?? []).map((ch) => [ch.regId, ch.tag]));
      _trendPage         = 1;

      renderChannelPage();

    } catch (err) {
      tbodyEl.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center;padding:24px 0;">불러오기 실패: ${err.message}</td></tr>`;
    }
  }

  // 현재 페이지(_trendPage)의 레지스터만 tbody에 그린다. 체크/태그 상태는
  // _trendCheckedSet/_trendTagMap에 보관되므로 페이지를 넘겨도 유지된다.
  function renderChannelPage() {
    const tbodyEl = $('#trendChannelList');
    const countEl = $('#trendChannelCount');
    if (!tbodyEl) return;

    const registers = _trendRegistersAll;
    if (registers.length === 0) {
      tbodyEl.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px 0;">등록된 레지스터가 없습니다.</td></tr>';
      updateChannelCount(countEl, 0);
      renderTrendPagination(1);
      const pageInfoEl = $('#trendPageInfo');
      if (pageInfoEl) pageInfoEl.textContent = '';
      return;
    }

    const totalPages = Math.max(1, Math.ceil(registers.length / TREND_PAGE_SIZE));
    _trendPage = Math.min(Math.max(1, _trendPage), totalPages);

    // 기본 태그(CH_NN)의 슬롯 순번은 페이지와 무관하게 전체 목록 기준으로 매긴다.
    const slotIndexByRegId = new Map();
    let slot = 0;
    registers.forEach((r) => { if (_trendCheckedSet.has(r.id)) slotIndexByRegId.set(r.id, ++slot); });

    const start         = (_trendPage - 1) * TREND_PAGE_SIZE;
    const pageRegisters = registers.slice(start, start + TREND_PAGE_SIZE);

    tbodyEl.innerHTML = '';
    pageRegisters.forEach((r) => {
      const unifiedAddr = r.id;
      const isActive    = _trendCheckedSet.has(unifiedAddr);

      const addrStr  = `4${String(unifiedAddr).padStart(4, '0')}`;
      const dev      = _trendDevMap[r.deviceId] ?? {};
      const devName  = dev.displayName || dev.name || `장치 ${r.deviceId}`;
      const regName  = r.displayName || r.tagName || '—';

      const defaultTag = `CH_${String(slotIndexByRegId.get(unifiedAddr) ?? 0).padStart(2, '0')}`;
      const tagValue   = _trendTagMap.get(unifiedAddr) || (isActive ? defaultTag : '');

      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td class="col-check"><input type="checkbox" value="${unifiedAddr}"${isActive ? ' checked' : ''}></td>` +
        `<td class="col-addr">${addrStr}</td>` +
        `<td class="col-devname">${devName}</td>` +
        `<td class="col-devaddr">${r.localAddress}</td>` +
        `<td class="col-regname">${regName}</td>` +
        `<td class="col-tag">` +
          `<input class="trend-tag-input" type="text" maxlength="15" ` +
            `placeholder="${isActive ? defaultTag : 'CH_NN'}" ` +
            `value="${tagValue}"${!isActive ? ' disabled' : ''}>` +
        `</td>`;

      const cb       = tr.querySelector('input[type="checkbox"]');
      const tagInput = tr.querySelector('.trend-tag-input');

      cb.addEventListener('change', (e) => {
        if (e.target.checked && _trendCheckedSet.size >= 16) {
          e.target.checked = false;
          showMsg('최대 16개 채널까지 선택 가능합니다.', 'error');
          return;
        }
        if (e.target.checked) {
          _trendCheckedSet.add(unifiedAddr);
          tagInput.disabled = false;
          if (!tagInput.value.trim()) {
            tagInput.value = `CH_${String(_trendCheckedSet.size).padStart(2, '0')}`;
            _trendTagMap.set(unifiedAddr, tagInput.value);
          }
        } else {
          _trendCheckedSet.delete(unifiedAddr);
          tagInput.disabled = true;
        }
        updateChannelCount(countEl, _trendCheckedSet.size);
        syncSelectAll();
      });

      tagInput.addEventListener('input', () => { _trendTagMap.set(unifiedAddr, tagInput.value); });

      tbodyEl.appendChild(tr);
    });

    updateChannelCount(countEl, _trendCheckedSet.size);
    syncSelectAll();
    renderTrendPagination(totalPages);

    const pageInfoEl = $('#trendPageInfo');
    if (pageInfoEl) {
      const endNum = start + pageRegisters.length;
      pageInfoEl.textContent = `${start + 1}–${endNum} / 전체 ${registers.length}개`;
    }

    updateTrendGuards();
  }

  // logs.js의 페이지네이션 렌더링 방식을 그대로 따른다(‹ 1 … n › + 생략 부호).
  function renderTrendPagination(totalPages) {
    const pagination = $('#trendPagination');
    if (!pagination) return;
    pagination.innerHTML = '';

    function makeBtn(label, page, active = false, disabled = false) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      if (active) btn.classList.add('active');
      btn.disabled = disabled;
      if (!disabled) btn.addEventListener('click', () => {
        _trendPage = page;
        renderChannelPage();
      });
      return btn;
    }

    function makeEllipsis() {
      const sp = document.createElement('span');
      sp.className = 'page-ellipsis';
      sp.textContent = '…';
      return sp;
    }

    pagination.appendChild(makeBtn('‹', _trendPage - 1, false, _trendPage <= 1));
    trendPageRange(_trendPage, totalPages).forEach((p) =>
      pagination.appendChild(p === '…' ? makeEllipsis() : makeBtn(p, p, p === _trendPage))
    );
    pagination.appendChild(makeBtn('›', _trendPage + 1, false, _trendPage >= totalPages));
  }

  function trendPageRange(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (cur <= 4)         return [1, 2, 3, 4, 5, '…', total];
    if (cur >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '…', cur - 1, cur, cur + 1, '…', total];
  }

  // 전체 선택은 페이지 단위가 아니라 전체 레지스터 기준(최대 16개)으로 동작한다.
  $('#trendSelectAll')?.addEventListener('change', (e) => {
    if (e.target.checked) {
      _trendCheckedSet = new Set(_trendRegistersAll.slice(0, 16).map((r) => r.id));
      if (_trendRegistersAll.length > 16) showMsg('최대 16개까지만 선택됩니다.', 'error');
    } else {
      _trendCheckedSet.clear();
    }
    renderChannelPage();
  });

  function syncSelectAll() {
    const selectAllCb = $('#trendSelectAll');
    if (!selectAllCb) return;

    const total   = _trendRegistersAll.length;
    const checked = _trendCheckedSet.size;

    selectAllCb.indeterminate = checked > 0 && checked < total;
    selectAllCb.checked       = total > 0 && checked === total;
  }

  function updateChannelCount(countEl, n) {
    if (countEl) countEl.textContent = `(${n} / 16)`;
  }

  // ── 트렌드 설정 PUT 실행 ─────────────────────────────────────────
  async function applyTrendConfig(sampleIntervalSec, channels) {
    const btn = $('#trendApplyBtn');
    if (btn) btn.disabled = true;
    try {
      const res = await apiFetch('/api/trend/config', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sampleIntervalSec, channels }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }

      const saved = await res.json();

      _trendCfgChMap = {};
      _trendTagMap   = new Map();
      (saved.channels ?? []).forEach((ch) => {
        _trendCfgChMap[ch.regId] = ch;
        _trendTagMap.set(ch.regId, ch.tag);
      });
      renderChannelPage();
      showMsg('트렌드 설정이 저장되었습니다.');
    } catch (err) {
      showMsg(`저장 실패: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = _recordingActive;
    }
  }

  // ── 적용 버튼 ────────────────────────────────────────────────────
  // 파일 기반 레코딩은 채널 구성을 바꿔도 기존 파일(자체 헤더 보유)에 영향이 없으므로,
  // 과거 DB 방식처럼 "채널 변경 시 데이터 전체 삭제" 경고/확인 절차가 필요 없다.
  const trendApplyBtn = $('#trendApplyBtn');
  if (trendApplyBtn) {
    trendApplyBtn.addEventListener('click', async () => {
      if (_recordingActive) return;
      const sampleIntervalSec = parseInt($('input[name="trendInterval"]:checked')?.value ?? '10', 10);

      const channels = [];
      let slotIdx = 0;
      _trendRegistersAll.forEach((r) => {
        if (!_trendCheckedSet.has(r.id)) return;
        slotIdx++;
        const regId = r.id;
        const reg   = _trendRegMap[regId]   ?? {};
        const prev  = _trendCfgChMap[regId] ?? {};
        const tag   = (_trendTagMap.get(regId)?.trim() || `CH_${String(slotIdx).padStart(2, '0')}`).substring(0, 15);
        channels.push({
          regId,
          tag,
          name:     reg.displayName || reg.tagName || String(regId),
          unit:     reg.unit     ?? '',
          scale:    reg.scale    ?? 1.0,
          isSigned: prev.isSigned ?? false,
          minValue: prev.minValue ?? 0,
          maxValue: prev.maxValue ?? 65535,
        });
      });

      if (!window.confirm('트렌드 설정을 저장합니다. 계속하시겠습니까?')) return;
      await applyTrendConfig(sampleIntervalSec, channels);
    });
  }

  // ── 트렌드 기록 파일 전체 삭제 ────────────────────────────────────
  $('#trendDeleteAllBtn')?.addEventListener('click', () => {
    if (_recordingActive) return;
    const modal = $('#trendDeleteAllModal');
    if (modal) modal.hidden = false;
  });

  $('#trendDeleteAllModalClose')?.addEventListener('click', () => { $('#trendDeleteAllModal').hidden = true; });
  $('#trendDeleteAllModalCancel')?.addEventListener('click', () => { $('#trendDeleteAllModal').hidden = true; });
  $('#trendDeleteAllModal')?.addEventListener('click', (e) => {
    if (e.target === $('#trendDeleteAllModal')) $('#trendDeleteAllModal').hidden = true;
  });

  $('#trendDeleteAllModalConfirm')?.addEventListener('click', async () => {
    const confirmBtn = $('#trendDeleteAllModalConfirm');
    if (confirmBtn) confirmBtn.disabled = true;
    showBusy(); // 파일 개수에 따라 삭제가 순간적으로 끝날 수 있어 최소 노출 시간을 둔다
    const minDelay = new Promise((r) => setTimeout(r, 800));
    try {
      const [deletedCount] = await Promise.all([
        (async () => {
          const res = await apiFetch('/api/tfile/files');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data  = await res.json();
          const files = data.files ?? [];

          for (const f of files) {
            const r = await apiFetch(`/api/tfile/files/${encodeURIComponent(f.filename)}`, { method: 'DELETE' });
            if (!r.ok) throw new Error(`${f.filename} 삭제 실패`);
          }
          return files.length;
        })(),
        minDelay,
      ]);

      $('#trendDeleteAllModal').hidden = true;
      showMsg(`녹화 파일 ${deletedCount}개가 삭제되었습니다.`);
    } catch (err) {
      showMsg(`전체 삭제 실패: ${err.message}`, 'error');
    } finally {
      hideBusy();
      if (confirmBtn) confirmBtn.disabled = false;
    }
  });

  // ── 초기 실행 ────────────────────────────────────────────────────
  switchTab(currentTab);

  loadConfig();
  loadSystemInfo();
  loadLanguageSetting();
  loadCurrentUserRole();
  loadSystemResources();
  const sysResourcesTimer = setInterval(loadSystemResources, 8000);
  loadSystemTime();
  loadRecordingGuardState();
  const recordingGuardTimer = setInterval(loadRecordingGuardState, 8000);
  loadTrendConfig();

  // ── 페이지 전환 시 타이머/구독 정리 ────────────────────────────────
  // main.js가 loadPage()를 다시 부를 때마다(언어 전환으로 같은 페이지를 재로드하는
  // 경우 포함) 'spa:beforeload'가 발생하므로 그 시점에 무조건 정리한다.
  window.addEventListener('spa:beforeload', () => {
    clearInterval(sysResourcesTimer);
    clearInterval(recordingGuardTimer);
    unsubApplyPollWarning();
    unsubFactoryResetPoll();
    window.removeEventListener('hashchange', onHashChangeTab);
  }, { once: true });
})();
