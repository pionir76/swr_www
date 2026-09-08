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
    if (bytes < 1024)          return `${bytes} B`;
    if (bytes < 1024 ** 2)     return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3)     return `${Math.round(bytes / (1024 ** 2))} MB`;
    return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
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

  // ── Trend Chart (파일 기반 트렌드 기록 실데이터) ───────────────────────────────
  // 대시보드는 "지금 상태를 훑어보는" 위젯이므로 항상 최신 파일 하나만 본다 —
  // 레코딩 중이면 그 파일을 계속 갱신하고, 아니면 마지막으로 완료된 파일을
  // 1회만 읽는다(별도로 "레코딩 중이 아닐 때" 분기를 두지 않아도 됨).
  let _trendData = null; // { header, points, recording } | null — 최근 성공한 결과(실패 시 유지해 깜빡임 방지)
  // 캔버스가 실제로 그려졌을 때 측정된 폭 캐시. 최초 로드 시(PageLoader가 콘텐츠를
  // 아직 숨긴 상태라 폭을 읽을 수 없는 순간) 넉넉하게 큰 값으로 시작해 부족하게
  // 가져오는 일이 없게 하고, 렌더링 시점에 실제 폭만큼만 잘라서 그린다.
  let _lastGoodWidthPx = 1200;

  async function loadTrendWidget() {
    try {
      const statusRes = await apiFetch('/api/tfile/status');
      if (!statusRes.ok) throw new Error(`status ${statusRes.status}`);
      const status = await statusRes.json();

      let filename, toSec, durationSec, fileSize;
      if (status.recording) {
        filename    = status.filename;
        toSec       = Math.floor(Date.now() / 1000);
        durationSec = status.elapsedSec;
        fileSize    = status.fileSize;
      } else {
        const filesRes = await apiFetch('/api/tfile/files');
        if (!filesRes.ok) throw new Error(`files ${filesRes.status}`);
        const files = (await filesRes.json()).files ?? [];
        if (files.length === 0) { _trendData = null; renderTrendChart(); return; }
        const latest = files.reduce((a, b) => (b.endTime > a.endTime ? b : a));
        filename    = latest.filename;
        toSec       = latest.endTime;
        durationSec = latest.endTime - latest.startTime;
        fileSize    = latest.fileSize;
      }

      const hdrRes = await apiFetch(`/api/tfile/header?file=${encodeURIComponent(filename)}`);
      if (!hdrRes.ok) throw new Error(`header ${hdrRes.status}`);
      const header = TndFormat.parseHeader(await hdrRes.arrayBuffer());

      // 항상 1픽셀 = 1데이터(step=1)로 그린다 — 데이터가 캔버스 폭보다 적으면(막
      // 녹화를 시작한 경우) 그 수만큼만 그려지고, 많으면 최신 데이터로 캔버스
      // 폭만큼만 잘라서 가져온다. 늘려서 채우지 않는다.
      // 폭은 캔버스가 아니라 항상 보이는 wrap에서 측정 — 캔버스 자체는 최초
      // 로드 시 hidden 상태라 clientWidth가 0으로 읽힐 수 있어, 그 경우 마지막으로
      // 측정에 성공한 폭(또는 넉넉한 기본값)을 대신 쓴다.
      const widthPx = $('.trend-chart-wrap')?.clientWidth || _lastGoodWidthPx;
      const fromSec = Math.max(header.startTime, toSec - widthPx * header.freq);

      const sampleRes = await apiFetch(
        `/api/tfile/sample?file=${encodeURIComponent(filename)}&from=${fromSec}&to=${toSec}&step=1`
      );
      if (!sampleRes.ok) throw new Error(`sample ${sampleRes.status}`);
      const points = TndFormat.parseSample(await sampleRes.arrayBuffer(), fromSec, toSec, 1, header);

      _trendData = { header, points, recording: !!status.recording, durationSec, fileSize };
    } catch (err) {
      console.warn('[Dashboard] loadTrendWidget:', err);
      // 실패 시 직전 상태를 그대로 유지 — 일시적 네트워크 오류로 위젯이 비는 것 방지
    }
    renderTrendChart();
  }

  function trendFormatElapsed(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(s)}`;
  }

  function trendFormatDate(unixSec) {
    const d = new Date(unixSec * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function renderTrendChart() {
    const canvas  = $('#trendChart');
    const emptyEl = $('#trendEmpty');
    const badgeEl = $('#trendRecBadge');
    const infoEl  = $('#trendInfo');
    const legend  = $('#trendLegend');
    if (!canvas) return;

    const hasData = !!_trendData && _trendData.points.length > 0 && _trendData.header.chCnt > 0;
    if (badgeEl) badgeEl.hidden = !_trendData?.recording;
    if (emptyEl) emptyEl.hidden = hasData;
    canvas.hidden = !hasData;
    if (infoEl) infoEl.hidden = !hasData;
    if (!hasData) { if (legend) legend.innerHTML = ''; return; }

    const { header, points, durationSec, fileSize } = _trendData;
    const channels = header.channels.slice(0, header.chCnt);

    // 기본 정보(시작 일시/기간/용량) — 타이틀과 같은 줄에 한 줄로 표시하고
    // 공간이 모자라면 말줄임표로 잘린다(중요도 순으로 앞에 배치). 라벨 없이
    // 값만 "|"로 구분.
    if (infoEl) {
      infoEl.textContent =
        `${trendFormatDate(header.startTime)} | ${trendFormatElapsed(durationSec ?? 0)} | ${fmtBytes(fileSize)}`;
    }

    // 범례는 캔버스 레이아웃(폭/높이)과 무관하게 항상 갱신한다 — 위젯이 막
    // 나타난 직후라 캔버스 크기가 아직 0으로 측정되는 경우에도 정상 표시되도록.
    // 채널명 대신 고정 CH01~ 번호만 표시(메인 화면은 전반적인 추세만 보여주는
    // 용도라 세부 채널명은 트렌드 기록 메뉴에서 확인).
    if (legend) {
      legend.innerHTML = channels.map((_, i) =>
        `<span class="trend-legend-item"><i style="background:${TndFormat.PALETTE[i % TndFormat.PALETTE.length]}"></i>CH${String(i + 1).padStart(2, '0')}</span>`
      ).join('');
    }

    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.clientWidth;
    const H   = canvas.clientHeight;
    // 최초 로드 시 PageLoader.hide()가 #pageContent를 최소 노출시간(setTimeout)
    // 이후에 보여주므로, 그 사이에 데이터 fetch가 먼저 끝나면 캔버스 크기가
    // 아직 0으로 읽힌다 — 다음 프레임에 다시 시도(15초 폴링까지 기다리지 않음).
    if (W === 0 || H === 0) { requestAnimationFrame(() => renderTrendChart()); return; }
    _lastGoodWidthPx = W; // 다음 fetch가 이 값을 기준으로 정확한 폭만큼 요청하도록 캐시
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const pad = { top: 14, right: 14, bottom: 34, left: 42 };
    const cw  = W - pad.left - pad.right;

    // 실제 그리는 영역(cw)보다 데이터가 많으면(fetch 시점 폭 추정이 부정확했거나
    // 창 크기가 바뀐 경우) 최신 데이터만 남기고 앞부분을 자른다 — 우측 끝이
    // 항상 최신 데이터와 맞닿고, 우측에 빈 공간이 남지 않도록.
    const maxCols       = Math.max(1, Math.floor(cw) + 1);
    const visiblePoints = points.length > maxCols ? points.slice(-maxCols) : points;
    const N             = visiblePoints.length;
    const SERIES        = channels.map((ch, i) => ({
      color: TndFormat.PALETTE[i % TndFormat.PALETTE.length],
      data:  visiblePoints.map((p) => TndFormat.rawToValue(p.vals[i], ch.isSigned, ch.dotpos)),
    }));
    const ch2 = H - pad.top  - pad.bottom;

    const allV  = SERIES.flatMap((s) => s.data).filter(Number.isFinite);
    const minV  = allV.length ? Math.floor(Math.min(...allV) - 1) : 0;
    const maxV  = allV.length ? Math.ceil(Math.max(...allV)  + 1) : 1;
    const range = Math.max(1e-6, maxV - minV);

    // 1픽셀 = 1데이터 — 늘려서 채우지 않고 왼쪽 끝부터 실제 데이터 개수만큼만 그린다.
    const xPos = (i) => pad.left + i;
    const yPos = (v) => pad.top  + (1 - (v - minV) / range) * ch2;

    // X축 시간 레이블도 그리드와 동일하게 데이터 개수와 무관하게 캔버스 폭
    // 기준으로 균등 배치한다(pixelOffset은 데이터 배열 인덱스가 아니라 pad.left
    // 로부터의 픽셀 거리). 시각은 첫 표시 데이터의 timestamp에 freq만큼씩
    // 더해 계산 — 1픽셀=1데이터(step=1)라 실제 데이터가 없는 구간(녹화 시작
    // 직후 캔버스 우측 빈 공간)도 정확한 시각으로 외삽된다.
    const labelCount    = 4;
    const labelIdxList  = Array.from({ length: labelCount + 1 }, (_, i) => Math.round((i / labelCount) * cw));
    const firstVisibleTs = N > 0 ? visiblePoints[0].ts : Math.floor(Date.now() / 1000);

    // 배경 그리드 (가로 + 세로) — 데이터 개수와 무관하게 항상 캔버스 전체 폭/높이
    // 기준으로 균등하게 그린다. labelIdxList(실제 데이터 인덱스)를 그대로 쓰면
    // 데이터가 적을 때(예: 녹화 시작 직후 10개) 그 좁은 구간 안에서만 나뉘어
    // 그려져 그리드가 다닥다닥 겹쳐 보이는 문제가 있었다.
    const gridCount = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth   = 1;
    for (let i = 0; i <= gridCount; i++) {
      const y = pad.top + (ch2 / gridCount) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke();
    }
    for (let i = 0; i <= gridCount; i++) {
      const x = pad.left + (cw / gridCount) * i;
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ch2); ctx.stroke();
    }

    // 바운딩 박스 (trends.js 축 border와 동일한 톤)
    ctx.strokeStyle = 'rgba(148,163,184,0.28)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(pad.left + 0.5, pad.top + 0.5, cw - 1, ch2 - 1);

    // Y 축 레이블
    ctx.fillStyle  = '#6a7f99';
    ctx.font       = '11px sans-serif';
    ctx.textAlign  = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= gridCount; i++) {
      const v = maxV - (range / gridCount) * i;
      ctx.fillText(v.toFixed(1), pad.left - 6, pad.top + (ch2 / gridCount) * i);
    }

    // X 축 시간 레이블 — trends.js와 동일하게 날짜/시간 두 줄로 표시.
    // 첫 값은 좌측 라인에서 시작(왼쪽 정렬), 마지막 값은 우측 라인에서 끝나도록
    // (오른쪽 정렬) — 가운데 정렬이면 양 끝 텍스트 절반이 박스 밖으로 튀어나감.
    ctx.textBaseline = 'top';
    ctx.font         = '10px sans-serif';
    labelIdxList.forEach((pixelOffset, i) => {
      const d   = new Date((firstVisibleTs + pixelOffset * header.freq) * 1000);
      const p   = (n) => String(n).padStart(2, '0');
      const dateLbl = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
      const timeLbl = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      ctx.textAlign = i === 0 ? 'left' : (i === labelIdxList.length - 1 ? 'right' : 'center');
      ctx.fillStyle = '#6a7f99';
      ctx.fillText(dateLbl, xPos(pixelOffset), H - pad.bottom + 6);
      ctx.fillText(timeLbl, xPos(pixelOffset), H - pad.bottom + 18);
    });

    // 라인만 그리기 (영역 그라데이션 채우기 없음)
    SERIES.forEach((s) => {
      ctx.beginPath();
      s.data.forEach((v, i) => i === 0 ? ctx.moveTo(xPos(i), yPos(v)) : ctx.lineTo(xPos(i), yPos(v)));
      ctx.strokeStyle = s.color;
      ctx.lineWidth   = 1.6;
      ctx.lineJoin    = 'round';
      ctx.stroke();
    });
  }

  // 창 크기를 줄였다가 되돌리면 캔버스의 실제 비트맵 해상도(canvas.width/height)가
  // CSS 표시 크기와 어긋나 확대/저해상도로 보인다 — 15초 폴링을 기다리지 않고
  // 크기 변화가 감지되는 즉시 다시 그린다. 서버 재요청 없이 이미 받아둔
  // _trendData를 그대로 재사용하는 캔버스 repaint라 비용이 크지 않고, rAF로
  // 묶어서 드래그 리사이즈 중 과도하게 반복 호출되지 않게 한다.
  let _resizeRaf = null;
  const trendResizeObserver = new ResizeObserver(() => {
    if (_resizeRaf) return;
    _resizeRaf = requestAnimationFrame(() => {
      _resizeRaf = null;
      renderTrendChart();
    });
  });
  const trendChartWrapEl = $('.trend-chart-wrap');
  if (trendChartWrapEl) trendResizeObserver.observe(trendChartWrapEl);

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
        loadTrendWidget();
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

  // main.js가 loadPage()를 다시 부를 때마다(언어 전환으로 같은 페이지를 재로드하는
  // 경우 포함) 'spa:beforeload'가 발생하므로 그 시점에 무조건 정리한다.
  window.addEventListener('spa:beforeload', () => {
    destroyed = true;
    clearTimeout(refreshTimer);
    refreshTimer = null;
    clearInterval(sysInfoTimer);
    clearInterval(trendTimer);
    trendResizeObserver.disconnect();
    if (_resizeRaf) { cancelAnimationFrame(_resizeRaf); _resizeRaf = null; }
  }, { once: true });

  PageLoader.show();
  scheduleRefresh();
  fetchSysInfo();
  const sysInfoTimer = setInterval(fetchSysInfo, 30000);
  const trendTimer   = setInterval(loadTrendWidget, 15000);
})();
