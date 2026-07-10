(() => {
  // ── DOM refs ─────────────────────────────────────────────────────────────────
  const kpiTotal        = $('#kpiTotal');
  const kpiOk           = $('#kpiOk');
  const kpiOkPct        = $('#kpiOkPct');
  const kpiError        = $('#kpiError');
  const kpiErrorPct     = $('#kpiErrorPct');
  const kpiUnknown      = $('#kpiUnknown');
  const kpiPolling      = $('#kpiPolling');
  const kpiPollingSub   = $('#kpiPollingSub');

  // syscard refs
  const scDiskUsed     = $('#scDiskUsed');
  const scDiskTotal    = $('#scDiskTotal');
  const scDiskPct      = $('#scDiskPct');
  const scDiskBar      = $('#scDiskBar');
  const scSysVer       = $('#scSysVer');
  const scSysRev       = $('#scSysRev');
  const scSysUpdate    = $('#scSysUpdate');
  const scEth0Role     = $('#scEth0Role');
  const scEth0State    = $('#scEth0State');
  const scEth0Ip       = $('#scEth0Ip');
  const scEth1Role     = $('#scEth1Role');
  const scEth1State    = $('#scEth1State');
  const scEth1Ip       = $('#scEth1Ip');
  const scMbState      = $('#scMbState');
  const scMbPort       = $('#scMbPort');
  const scMbSlave      = $('#scMbSlave');

  const deviceStatusBody  = $('#deviceStatusBody');
  const realtimeBody      = $('#realtimeBody');
  const alertLogList      = $('#alertLogList');
  const logList           = $('#logList');

  // ── State ─────────────────────────────────────────────────────────────────────
  let allDevices  = [];
  let allAlerts   = [];
  let allLogs     = [];
  let isFirstLoad = true;

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function fmtTime(val) {
    if (!val) return '—';
    const d = new Date(val);
    if (!isNaN(d)) {
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }
    const m = String(val).match(/(\d{2}:\d{2}:\d{2})/);
    return m ? m[1] : val;
  }

  function emptyRow(colspan, msg) {
    return `<tr><td colspan="${colspan}" style="text-align:center;color:#5a6b7e;padding:24px 0">${msg}</td></tr>`;
  }

  function deviceBadgeHtml(d) {
    const state = d.state ?? 'unknown';
    const cls   = state === 'ok' ? 'ok' : state === 'error' ? 'error' : 'warn';
    const txt   = state === 'ok' ? '정상' : state === 'error' ? '오류' : '알 수 없음';
    const errBadge = (d.consecutiveErrors > 0)
      ? ` <span class="err-count">${d.consecutiveErrors}</span>` : '';
    return `<span class="badge ${cls}">${txt}</span>${errBadge}`;
  }

  // ── syscard 헬퍼 ─────────────────────────────────────────────────────────────

  function fmtBytes(bytes) {
    if (bytes == null) return '—';
    const gb = bytes / (1024 ** 3);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    return `${Math.round(bytes / (1024 ** 2))} MB`;
  }

  function scBadge(enabled, onLabel = '활성', offLabel = '비활성') {
    return enabled
      ? `<span class="sc-badge ok">${onLabel}</span>`
      : `<span class="sc-badge off">${offLabel}</span>`;
  }

  async function fetchSysInfo() {
    try {
      const [infoRes, cfgRes] = await Promise.all([
        apiFetch('/api/system/info'),
        apiFetch('/api/config'),
      ]);
      if (!infoRes.ok || !cfgRes.ok) return;
      const sysData = await infoRes.json();
      const cfgData = await cfgRes.json();

      // 디스크
      const disk = sysData.disk ?? {};
      const pct  = disk.usedPercent ?? 0;
      if (scDiskUsed)  scDiskUsed.textContent  = fmtBytes(disk.used);
      if (scDiskTotal) scDiskTotal.textContent = fmtBytes(disk.total);
      if (scDiskPct)   scDiskPct.textContent   = `${pct}%`;
      if (scDiskBar) {
        const color = pct >= 90 ? '#ff5d62' : pct >= 70 ? '#ffad32' : '#2f80ff';
        scDiskBar.style.width      = `${Math.min(pct, 100)}%`;
        scDiskBar.style.background = color;
      }

      // 시스템 정보
      const si = sysData.info ?? {};
      if (scSysVer)    scSysVer.textContent    = si.ver            ?? '—';
      if (scSysRev)    scSysRev.textContent    = si.rev            ?? '—';
      if (scSysUpdate) scSysUpdate.textContent = si.lastUpdateDate ?? '—';

      // 네트워크 인터페이스
      const ifaces = cfgData.network?.interfaces ?? [];
      const eth0   = ifaces[0] ?? {};
      const eth1   = ifaces[1] ?? {};
      if (scEth0Role)  scEth0Role.textContent = eth0.role      || '—';
      if (scEth0State) scEth0State.innerHTML  = scBadge(eth0.enabled, '사용 중', '미사용');
      if (scEth0Ip)    scEth0Ip.textContent   = eth0.ipAddress || '—';
      if (scEth1Role)  scEth1Role.textContent = eth1.role      || '—';
      if (scEth1State) scEth1State.innerHTML  = scBadge(eth1.enabled, '사용 중', '미사용');
      if (scEth1Ip)    scEth1Ip.textContent   = eth1.ipAddress || '—';

      // Modbus TCP 서버
      const mb = cfgData.modbusServer ?? {};
      if (scMbState) scMbState.innerHTML   = scBadge(mb.enabled, '활성', '비활성');
      if (scMbPort)  scMbPort.textContent  = mb.port    ?? '—';
      if (scMbSlave) scMbSlave.textContent = mb.slaveId ?? '—';

    } catch (e) {
      console.warn('[Dashboard] fetchSysInfo:', e);
    }
  }

  // ── KPI ───────────────────────────────────────────────────────────────────────
  function updateKpi(kpi) {
    const total = kpi.totalDevices   ?? 0;
    const ok    = kpi.okDevices      ?? 0;
    const err   = kpi.errorDevices   ?? 0;
    const unk   = kpi.unknownDevices ?? 0;

    if (kpiTotal)    kpiTotal.textContent    = total;
    if (kpiOk)       kpiOk.textContent       = ok;
    if (kpiOkPct)    kpiOkPct.textContent    = total ? `${Math.round(ok  / total * 100)}%` : '—';
    if (kpiError)    kpiError.textContent    = err;
    if (kpiErrorPct) kpiErrorPct.textContent = total ? `${Math.round(err / total * 100)}%` : '—';
    if (kpiUnknown)  kpiUnknown.textContent  = unk > 0 ? `알 수 없음 ${unk}대` : ' ';
  }

  // ── Polling Status (KPI 전용) ─────────────────────────────────────────────────
  function updatePollingStatus(running) {
    if (kpiPolling) {
      kpiPolling.textContent = running ? '실행 중' : '정지';
      kpiPolling.className   = `kpi-value ${running ? 'violet-text' : 'red-text'}`;
    }
    if (kpiPollingSub) kpiPollingSub.textContent = running ? '정상' : '중단됨';
  }

  // ── Device rows ───────────────────────────────────────────────────────────────
  function renderDeviceRows(devices, tbody) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!devices.length) { tbody.innerHTML = emptyRow(6, '장비 없음'); return; }

    devices.forEach((d) => {
      const dur = (d.lastPollDurationMs != null && d.lastPollDurationMs >= 0)
        ? `${d.lastPollDurationMs}` : '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${d.name || '—'}</td>
        <td>${d.deviceCode || '—'}</td>
        <td>${d.connType   || '—'}</td>
        <td>${d.protocol   || '—'}</td>
        <td>${deviceBadgeHtml(d)}</td>
        <td class="mono" style="text-align:right">${dur}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderDeviceAllRows(devices, tbody) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!devices.length) { tbody.innerHTML = emptyRow(7, '장비 없음'); return; }

    devices.forEach((d) => {
      const dur = (d.lastPollDurationMs != null && d.lastPollDurationMs >= 0)
        ? `${d.lastPollDurationMs}ms` : '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${d.name || '—'}</td>
        <td>${d.deviceCode || '—'}</td>
        <td>${d.connType   || '—'}</td>
        <td>${d.protocol   || '—'}</td>
        <td>${deviceBadgeHtml(d)}</td>
        <td class="mono" style="text-align:right">${dur}</td>
        <td class="last-error-cell">${d.lastError || '—'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ── Realtime ──────────────────────────────────────────────────────────────────
  function renderRealtimeRows(regs, tbody, deviceCodeMap) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!regs.length) { tbody.innerHTML = emptyRow(6, '레지스터 없음'); return; }

    regs.forEach((r) => {
      const qualCls   = r.quality === 'good'   ? 'state-ok'
                      : r.quality === 'normal' ? 'amber-text' : 'red-text';
      const devCode   = deviceCodeMap?.[r.deviceId] ?? '—';
      const val       = RegFmt.value(r.scaledValue, r);
      const tr        = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${devCode}</td>
        <td>${r.displayName || r.tagName || '—'}</td>
        <td class="mono">${RegFmt.address(r.address)}</td>
        <td class="${qualCls}">${val}</td>
        <td>${r.unit || '—'}</td>
        <td>${fmtTime(r.lastUpdated)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ── Poll Log ──────────────────────────────────────────────────────────────────
  // ── Alerts ────────────────────────────────────────────────────────────────────
  function alertLevelClass(level) {
    return level === 'ERROR' ? 'log-error' : 'log-warn';
  }

  function renderAlertItems(alerts, container) {
    if (!container) return;
    container.innerHTML = '';
    if (!alerts.length) {
      container.innerHTML = '<div style="padding:16px;color:#5a6b7e;text-align:center">경보 없음</div>';
      return;
    }
    alerts.forEach((a) => {
      const cls = alertLevelClass(a.level);
      const div = document.createElement('div');
      div.innerHTML = `
        <b class="${cls}">${a.level}</b>
        <p>${a.message || '—'}</p>
        <em>${fmtTime(a.timestamp)}</em>
      `;
      container.appendChild(div);
    });
  }

  function renderAlertTable(alerts, tbody) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!alerts.length) { tbody.innerHTML = emptyRow(3, '경보 없음'); return; }
    alerts.forEach((a) => {
      const cls = alertLevelClass(a.level);
      const tr  = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${fmtTime(a.timestamp)}</td>
        <td><b class="${cls}">${a.level}</b></td>
        <td>${a.message || '—'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ── Logs ─────────────────────────────────────────────────────────────────────
  function renderLogItems(logs, container) {
    if (!container) return;
    container.innerHTML = '';
    if (!logs.length) {
      container.innerHTML = '<div style="padding:16px;color:#5a6b7e;text-align:center">로그 없음</div>';
      return;
    }
    logs.forEach((l) => {
      const cls = l.level === 'INFO' ? 'log-info' : l.level === 'WARN' ? 'log-warn' : 'log-error';
      const div = document.createElement('div');
      div.innerHTML = `
        <b class="${cls}">${l.level}</b>
        <span>${l.message || ''}</span>
        <em>${fmtTime(l.timestamp)}</em>
      `;
      container.appendChild(div);
    });
  }

  function renderLogTable(logs, tbody) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!logs.length) { tbody.innerHTML = emptyRow(3, '로그 없음'); return; }
    logs.forEach((l) => {
      const cls = l.level === 'INFO' ? 'log-info' : l.level === 'WARN' ? 'log-warn' : 'log-error';
      const tr  = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${fmtTime(l.timestamp)}</td>
        <td><b class="${cls}">${l.level}</b></td>
        <td>${l.message || ''}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ── Trend Chart (가상 데이터) ─────────────────────────────────────────────────
  function drawTrendChart() {
    const canvas = $('#trendChart');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.clientWidth;
    const H   = canvas.clientHeight;
    if (W === 0 || H === 0) return;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const N = 49; // 30분 간격 24시간
    const now = Date.now();

    function smooth(base, amp, freq, noise) {
      return Array.from({ length: N }, (_, i) => {
        const t = i / (N - 1);
        return base
          + amp  * Math.sin(t * Math.PI * 2 * freq)
          + amp  * 0.4 * Math.sin(t * Math.PI * 2 * freq * 2.3 + 1)
          + noise * (Math.random() - 0.5);
      });
    }

    const SERIES = [
      { label: '메인룸 온도',    unit: '°C', color: '#4da0ff', data: smooth(23.5, 2.2, 1,   0.4) },
      { label: '냉수 공급 온도', unit: '°C', color: '#65e684', data: smooth(7.8,  1.4, 1.3, 0.3) },
      { label: '목표 온도',      unit: '°C', color: '#ffc15c', data: smooth(22.0, 0.0, 0,   0.0) },
    ];

    const pad = { top: 14, right: 14, bottom: 36, left: 42 };
    const cw  = W - pad.left - pad.right;
    const ch  = H - pad.top  - pad.bottom;

    const allV  = SERIES.flatMap(s => s.data);
    const minV  = Math.floor(Math.min(...allV) - 1);
    const maxV  = Math.ceil(Math.max(...allV)  + 1);
    const range = maxV - minV;

    const xPos = (i) => pad.left + (i / (N - 1)) * cw;
    const yPos = (v) => pad.top  + (1 - (v - minV) / range) * ch;

    // 배경 그리드
    const gridCount = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth   = 1;
    for (let i = 0; i <= gridCount; i++) {
      const y = pad.top + (ch / gridCount) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke();
    }

    // Y 축 레이블
    ctx.fillStyle  = '#6a7f99';
    ctx.font       = `${11}px sans-serif`;
    ctx.textAlign  = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= gridCount; i++) {
      const v = maxV - (range / gridCount) * i;
      ctx.fillText(v.toFixed(1), pad.left - 6, pad.top + (ch / gridCount) * i);
    }

    // X 축 시간 레이블 (6시간 간격)
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    const step6h = Math.round((N - 1) / 4);
    for (let i = 0; i <= 4; i++) {
      const idx = i * step6h;
      const ms  = now - (N - 1 - idx) * 30 * 60 * 1000;
      const d   = new Date(ms);
      const lbl = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      ctx.fillStyle = '#6a7f99';
      ctx.fillText(lbl, xPos(idx), H - pad.bottom + 6);
    }

    // 라인 그리기
    SERIES.forEach(s => {
      // 영역 채우기
      ctx.beginPath();
      s.data.forEach((v, i) => i === 0 ? ctx.moveTo(xPos(i), yPos(v)) : ctx.lineTo(xPos(i), yPos(v)));
      ctx.lineTo(xPos(N - 1), pad.top + ch);
      ctx.lineTo(xPos(0), pad.top + ch);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
      grad.addColorStop(0,   s.color + '28');
      grad.addColorStop(1,   s.color + '00');
      ctx.fillStyle = grad;
      ctx.fill();

      // 라인
      ctx.beginPath();
      s.data.forEach((v, i) => i === 0 ? ctx.moveTo(xPos(i), yPos(v)) : ctx.lineTo(xPos(i), yPos(v)));
      ctx.strokeStyle = s.color;
      ctx.lineWidth   = 1.8;
      ctx.lineJoin    = 'round';
      ctx.stroke();
    });

    // 범례
    const legendEl = $('#trendLegend');
    if (legendEl && legendEl.childElementCount === 0) {
      legendEl.innerHTML = SERIES.map(s =>
        `<span class="trend-legend-item">
           <i style="background:${s.color}"></i>${s.label}
         </span>`
      ).join('');
    }
  }

  // ── Modals ────────────────────────────────────────────────────────────────────
  function openModal(id)  { const m = $(id); if (m) m.hidden = false; }
  function closeModal(id) { const m = $(id); if (m) m.hidden = true;  }

  $('#deviceAllBtn')?.addEventListener('click', () => {
    openModal('#deviceAllModal');
    renderDeviceAllRows(allDevices, $('#deviceAllBody'));
  });
  $('#deviceAllClose')?.addEventListener('click', () => closeModal('#deviceAllModal'));

  $('#alertAllBtn')?.addEventListener('click', () => {
    openModal('#alertAllModal');
    renderAlertTable(allAlerts, $('#alertAllBody'));
  });
  $('#alertAllClose')?.addEventListener('click', () => closeModal('#alertAllModal'));

  $('#logAllBtn')?.addEventListener('click', () => {
    openModal('#logAllModal');
    renderLogTable(allLogs, $('#logAllBody'));
  });
  $('#logAllClose')?.addEventListener('click', () => closeModal('#logAllModal'));

  // ── Init & Refresh ────────────────────────────────────────────────────────────
  const REFRESH_INTERVAL_MS = 2000;
  let refreshTimer = null;
  let destroyed    = false;

  async function loadAll() {
    const t0 = performance.now();
    //console.group(`[Dashboard] loadAll @ ${new Date().toLocaleTimeString()}`);
    
    let ok = false;
    try {
      const res = await apiFetch('/api/dashboard');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const kpi     = data.kpi     ?? {};
      const polling = data.polling ?? {};

      updateKpi(kpi);
      updatePollingStatus(polling.running ?? false);

      allDevices  = data.devices  ?? [];
      allAlerts   = data.alerts   ?? [];
      allLogs     = data.logs     ?? [];

      const deviceCodeMap = Object.fromEntries(allDevices.map((d) => [d.id, d.deviceCode]));

      renderDeviceRows(allDevices.slice(0, 8), deviceStatusBody);
      renderRealtimeRows(data.realtimeRegisters ?? [], realtimeBody, deviceCodeMap);
      renderAlertItems(allAlerts.slice(0, 8), alertLogList);
      renderLogItems(allLogs.slice(0, 8), logList);

      if (isFirstLoad) {
        isFirstLoad = false;
        PageLoader.hide($('#pageContent'));
        requestAnimationFrame(drawTrendChart);
      }

      ok = true;
    } catch (err) {
      console.warn(`✗ loadAll:`, err);
      if (isFirstLoad) {
        PageLoader.showError(err.message, () => {
          PageLoader.show();
          isFirstLoad = true;
          scheduleRefresh();
        });
      }
    }
    
    return ok;
  }

  async function scheduleRefresh() {
    const ok = await loadAll();
    if (destroyed) return;  // hashchange가 await 도중에 발생한 경우 타이머 등록 방지
    if (ok || !isFirstLoad) {
      refreshTimer = setTimeout(scheduleRefresh, REFRESH_INTERVAL_MS);
    }
  }

  window.addEventListener('hashchange', () => {
    destroyed = true;
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }, { once: true });

  PageLoader.show();
  scheduleRefresh();
  fetchSysInfo();
  setInterval(fetchSysInfo, 30000);
})();
