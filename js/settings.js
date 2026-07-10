(() => {
  const validTabs = ['settings', 'settings-maintenance'];

  let currentTab = window.location.hash.replace('#', '');
  if (!validTabs.includes(currentTab)) currentTab = 'settings';

  let cachedConfig = null;

  const tabSubtitles = {
    'settings':             '네트워크, RS485, Modbus TCP Server 설정을 관리합니다.',
    'settings-maintenance': '시스템 정보 확인, 백업·복원, 펌웨어 업데이트 및 재시작을 관리합니다.',
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

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash.startsWith('settings')) switchTab(hash);
  });

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
    let el = $('#settingsMsg');
    if (!el) {
      el = document.createElement('div');
      el.id = 'settingsMsg';
      $('.settings-action-bar')?.insertAdjacentElement('beforebegin', el);
    }
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
      const warns = data.warnings ?? [];
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
      ];
      optEl.innerHTML = ITEMS.map(({ key, label, defaultOn, showCount, warn }) => {
        const item = data[key];
        if (!item?.available) return '';
        const countBadge = showCount && item.count
          ? `<span class="restore-option-count">${item.count.toLocaleString()}개</span>` : '';
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
      }).join('');
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

  PollingState.subscribe(updateApplyPollWarning);

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

  PollingState.subscribe((running) => {
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

  // ── 초기 실행 ────────────────────────────────────────────────────
  switchTab(currentTab);
  loadConfig();
  loadSystemInfo();
  loadCurrentUserRole();
  loadSystemResources();
  setInterval(loadSystemResources, 8000);
})();
