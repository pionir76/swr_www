(() => {

  // ── 채널 색상 팔레트 ────────────────────────────────────────
  const PALETTE = [
    '#4da0ff', '#4cd96b', '#ffd84a', '#ff6b6b', '#c77dff',
    '#ff9a3c', '#00d4aa', '#ff5d8f', '#7bcfff', '#a8ff78',
    '#ffb347', '#87ceeb', '#dda0dd', '#98fb98', '#f0e68c', '#ff7f50',
  ];

  // 줌 배율 (서로 역수 관계 — 확대/축소 반복 시 원위치)
  const ZOOM_IN_FACTOR  = 0.8;
  const ZOOM_OUT_FACTOR = 1.25;
  const MIN_VIEW_POINTS = 10; // 최대 확대 시 최소 표시 포인트 수

  // ── 런타임 상태 ─────────────────────────────────────────────
  let _status      = null;   // /api/tfile/status 응답
  let _files       = [];     // /api/tfile/files.files 배열
  let _file        = null;   // 선택 파일: { filename, startTime, freq, chCnt, channels[] }
  let _allPts      = [];     // 파일 전체를 메모리에 적재한 원본 레코드 [{ ts, vals }] (_allPtsStep 간격)
  let _allPtsStep  = 1;      // _allPts 레코드 간 실제 간격(레코드 인덱스 단위). 서버가 50000개 캡으로
                              // step을 올렸을 경우를 대비해 실측값을 저장(=1이면 매 레코드가 그대로 있음)
  let _chartPts    = [];     // 현재 화면에 그려지는 다운샘플된 부분집합 [{ ts, vals }]
  let _chart       = null;
  let _visibleCh   = new Set();
  let _selectedCh  = null;   // 그래프에서 강조 표시할 채널(단일, 없으면 null) — 표시 여부와 무관
  let _statCardEls = [];     // 채널 카드 DOM 참조(인덱스별) — 선택 갱신 시 관련 카드만 업데이트
  let _colorMap    = {};     // ch_index → hex color
  let _liveTimer   = null;   // setInterval ID (live polling)
  let _statusTimer = null;   // setTimeout ID (재귀 상태 폴링 — freq에 맞춰 주기 재계산)
  let _diskTimer   = null;   // setInterval ID (시스템 디스크 사용량 폴링)
  let _lastLiveBuf = null;   // Uint8Array — 마지막 수신 레코드 (중복 감지용)
  let _lastLiveTs  = 0;      // 마지막 live 레코드 타임스탬프 (unix sec)
  let _viewFrom    = 0;      // 현재 뷰 시작 (unix sec)
  let _viewTo      = 0;      // 현재 뷰 종료 (unix sec)
  let _loadingFull = false;  // 파일 전체 적재 중(pollLatest와 경쟁 방지)
  let _isLive      = false;
  let _destroyed   = false;  // 다른 페이지로 이동해 이 페이지 스크립트가 정리된 상태
  let _rangeSelectActive = false; // 구간 보기 모드(드래그 = 팬 대신 영역 선택 후 확대)

  // ── DOM ─────────────────────────────────────────────────────
  const recDot      = $('#tfileRecDot');
  const statusText  = $('#tfileStatusText');
  const recSep      = $('#tfileRecSep');
  const recFilename = $('#tfileRecFilename');
  const startSep    = $('#tfileStartSep');
  const recStartEl  = $('#tfileRecStart');
  const countSep    = $('#tfileCountSep');
  const recCountEl  = $('#tfileRecCount');
  const elapsedSep  = $('#tfileElapsedSep');
  const elapsedEl   = $('#tfileElapsed');
  const freqSep     = $('#tfileFreqSep');
  const recFreqEl   = $('#tfileRecFreq');
  const sizeSep     = $('#tfileSizeSep');
  const fileSizeEl  = $('#tfileFileSize');
  const usageFill   = $('#tfileUsageFill');
  const usagePct    = $('#tfileUsagePct');
  const recToggleBtn = $('#tfileRecToggleBtn');
  const fileItems   = $('#tfileFileItems');
  const refreshBtn  = $('#tfileRefreshFiles');
  const skeleton    = $('#tfileSkeleton');
  const loadProgress     = $('#tfileLoadProgress');
  const loadProgressFill = $('#tfileLoadProgressFill');
  const loadProgressText = $('#tfileLoadProgressText');
  const liveBtn     = $('#tfileLiveBtn');
  const prevBtn     = $('#tfilePrevBtn');
  const nextBtn     = $('#tfileNextBtn');
  const zoomInBtn   = $('#tfileZoomInBtn');
  const zoomOutBtn  = $('#tfileZoomOutBtn');
  const rangeSelectBtn = $('#tfileRangeSelectBtn');
  const fitAllBtn      = $('#tfileFitAllBtn');
  const timeLabelEl = $('#tfileTimeLabel');
  const statsRow    = $('#tfileStatsRow');

  // ── 바이너리 파싱 ────────────────────────────────────────────

  // STIME[6] = {yy, mm, dd, hh, min, ss} binary (NOT BCD), 로컬 시각
  function stimeToUnix(u8, offset) {
    return Math.floor(new Date(
      2000 + u8[offset], u8[offset + 1] - 1, u8[offset + 2],
      u8[offset + 3], u8[offset + 4], u8[offset + 5]
    ).getTime() / 1000);
  }

  // 백엔드가 CHTAG/UNIT을 Latin-1로 기록해(예: "°C"의 "°"가 단일 바이트 0xB0)
  // UTF-8로 해석하면 깨진 문자(U+FFFD)가 나온다. UTF-8로 먼저 시도하고
  // 깨졌으면 Latin-1로 재해석해 예전에 기록된 파일도 정상 표시되게 한다.
  function decodeNullStr(u8slice) {
    let end = u8slice.indexOf(0);
    if (end < 0) end = u8slice.length;
    const bytes = u8slice.slice(0, end);
    const utf8  = new TextDecoder('utf-8').decode(bytes);
    if (utf8.includes('�')) return new TextDecoder('iso-8859-1').decode(bytes);
    return utf8;
  }

  function parseTndHeader(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    if (buf.byteLength < 512) throw new Error('Header too short');
    if (u8[0] !== 0x53 || u8[1] !== 0x57) throw new Error('Invalid magic');

    const chCnt    = u8[5];
    const startTime = stimeToUnix(u8, 6);
    const freq     = dv.getUint16(12, true);
    const channels = [];

    for (let i = 0; i < 16; i++) {
      const off = 64 + i * 28;
      // TndChannelInfo layout (28 bytes): CHTAG[16] INRH[2] INRL[2] DOTPOS[1] IS_SIGNED[1] UNIT[4] reserved[2]
      channels.push({
        chtag:    decodeNullStr(u8.slice(off,      off + 16)),
        inrh:     dv.getUint16(off + 16, true),
        inrl:     dv.getUint16(off + 18, true),
        dotpos:   u8[off + 20],
        isSigned: u8[off + 21] !== 0,
        unit:     decodeNullStr(u8.slice(off + 22, off + 26)),
      });
    }
    return { chCnt, startTime, freq, channels };
  }

  // buf: ArrayBuffer of N*32 bytes
  // fromSec/toSec: requested range unix sec
  // step: step sent to server (server may have bumped it silently)
  function parseSampleBuf(buf, fromSec, toSec, step) {
    if (!_file || buf.byteLength < 32) return [];
    const dv  = new DataView(buf);
    const nRec = Math.floor(buf.byteLength / 32);
    const riStart = Math.max(0, Math.floor((fromSec - _file.startTime) / _file.freq));
    // Server may bump step when (to-from)/step > 50000; infer actual step from nRec
    const riEnd = Math.floor((toSec - _file.startTime) / _file.freq);
    const actualStep = nRec > 1
      ? Math.max(step, Math.round((riEnd - riStart) / (nRec - 1)))
      : step;
    const pts = [];
    for (let i = 0; i < nRec; i++) {
      const ri = riStart + i * actualStep;
      const ts = _file.startTime + ri * _file.freq;
      const vals = new Array(16);
      for (let ch = 0; ch < 16; ch++) {
        vals[ch] = dv.getUint16(i * 32 + ch * 2, true);
      }
      pts.push({ ts, vals });
    }
    return pts;
  }

  // ── 값 변환 ──────────────────────────────────────────────────
  function rawToValue(raw, isSigned, dotpos) {
    const v = (isSigned && raw > 32767) ? raw - 65536 : raw;
    return v / Math.pow(10, dotpos);
  }

  // ── 포맷 유틸 ────────────────────────────────────────────────
  function formatElapsed(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const p = (n) => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(s)}`;
  }

  function formatBytes(bytes) {
    if (bytes < 1024)          return `${bytes} B`;
    if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3)     return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function formatDate(unixSec) {
    const d = new Date(unixSec * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 시작~종료를 한 줄에 표시. 같은 날짜면 종료 쪽은 시:분만 남겨 최대한 짧게 만든다.
  function formatDateRange(startSec, endSec) {
    const s = new Date(startSec * 1000);
    const e = new Date(endSec * 1000);
    const p = (n) => String(n).padStart(2, '0');
    const startStr = formatDate(startSec);
    const sameDay = s.getFullYear() === e.getFullYear() &&
                    s.getMonth()    === e.getMonth() &&
                    s.getDate()     === e.getDate();
    const endStr = sameDay ? `${p(e.getHours())}:${p(e.getMinutes())}` : formatDate(endSec);
    return `${startStr} ~ ${endStr}`;
  }

  // 목록에 표시할 때만 확장자를 뗀다 — 선택/삭제 등 실제 API 호출은 항상 원본 파일명 사용
  function stripExt(filename) {
    const i = filename.lastIndexOf('.');
    return i > 0 ? filename.slice(0, i) : filename;
  }

  // 현재 레코딩 중인 파일의 시작 시각 추정. /api/tfile/status엔 시작 시각이 없어서,
  // 이미 알고 있는 정보(선택된 파일의 헤더 파싱값 → 파일 목록) 순으로 찾고,
  // 아직 둘 다 없으면(초기 로드 중 등) 경과시간으로 역산한 근사치를 쓴다.
  function findRecordingStartSec(s) {
    if (_file && _file.filename === s.filename) return _file.startTime;
    const fi = _files.find((f) => f.filename === s.filename);
    if (fi) return fi.startTime;
    return Math.floor(Date.now() / 1000) - s.elapsedSec;
  }

  // ── 상태 UI 업데이트 ─────────────────────────────────────────
  function updateStatusUI(s) {
    if (!s) return;
    const rec = s.recording;

    if (recDot)     recDot.className = `tfile-rec-dot${rec ? ' recording' : ''}`;
    if (statusText) statusText.textContent = rec ? '녹화 중' : '대기 중';

    const show = (el, visible) => { if (el) el.hidden = !visible; };
    show(recSep,     rec);
    show(startSep,   rec);
    show(countSep,   rec);
    show(elapsedSep, rec);
    show(freqSep,    rec);
    show(sizeSep,    rec);

    if (recFilename) recFilename.textContent = rec ? stripExt(s.filename) : '';
    if (recStartEl)  recStartEl.textContent  = rec ? formatDate(findRecordingStartSec(s)) : '';
    if (recCountEl)  recCountEl.textContent  = rec ? `${(s.recordCount ?? 0).toLocaleString()}개` : '';
    if (elapsedEl)   elapsedEl.textContent   = rec ? formatElapsed(s.elapsedSec) : '';
    if (recFreqEl)   recFreqEl.textContent   = rec ? `${s.freq}초 간격` : '';
    if (fileSizeEl)  fileSizeEl.textContent  = rec ? formatBytes(s.fileSize) : '';

    if (recToggleBtn) {
      recToggleBtn.textContent = rec ? '■ 녹화 중지' : '● 녹화 시작';
      recToggleBtn.classList.toggle('primary', !rec);
      recToggleBtn.classList.toggle('danger',  rec);
    }
  }

  // 시스템 전체 저장공간 사용량(트렌드 파일이 저장되는 파티션과 동일한 루트 파티션) —
  // 설정 페이지의 디스크 도넛과 같은 /api/system/resources를 재사용한다. 개별 파일의
  // 4GB 회전 한도(fileSizeLimit)와는 무관한, 기기 전체 저장공간 기준 지표다.
  async function loadDiskUsage() {
    try {
      const res = await apiFetch('/api/system/resources');
      if (_destroyed || !res.ok) return;
      const data = await res.json();
      if (_destroyed) return;
      const root = (data.disk ?? []).find((d) => d.mount === '/');
      if (!root || !usageFill) return;
      const pct = root.usagePercent ?? 0;
      usageFill.style.width = `${Math.min(100, pct).toFixed(1)}%`;
      usageFill.className = `tfile-usage-fill${pct > 90 ? ' danger' : pct > 70 ? ' warn' : ''}`;
      if (usagePct) usagePct.textContent = `${pct.toFixed(1)}%`;
    } catch {}
  }

  // ── 파일 목록 렌더 ───────────────────────────────────────────
  function renderFileList() {
    if (!fileItems) return;
    fileItems.innerHTML = '';

    if (_files.length === 0) {
      fileItems.innerHTML = '<div class="tfile-list-empty">저장된 파일이 없습니다</div>';
      return;
    }

    const isRec   = (fn) => _status?.recording && _status?.filename === fn;
    const isActive = (fn) => _file?.filename === fn;

    [..._files].reverse().forEach((f) => {
      const item = document.createElement('div');
      item.className = `tfile-file-item${isActive(f.filename) ? ' active' : ''}`;
      item.dataset.filename = f.filename;

      item.innerHTML =
        `<div class="tfile-file-item-name">` +
          (isRec(f.filename) ? `<span class="tfile-file-rec-badge">REC</span>` : '') +
          `<span>${stripExt(f.filename)}</span>` +
        `</div>` +
        `<div class="tfile-file-item-meta">` +
          `<span class="tfile-file-item-range">${formatDateRange(f.startTime, f.endTime)}</span>` +
          `<span>${formatBytes(f.fileSize)} · ${f.chCount}ch · ${f.freq}s</span>` +
        `</div>`;

      item.addEventListener('click', () => selectFile(f.filename));

      // 삭제 버튼 (녹화 중 파일 제외)
      if (!isRec(f.filename)) {
        const delBtn = document.createElement('button');
        delBtn.className = 'tfile-file-del-btn';
        delBtn.title = '파일 삭제';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`${f.filename} 을 삭제하시겠습니까?`)) return;
          try {
            const res = await apiFetch(`/api/tfile/files/${encodeURIComponent(f.filename)}`, { method: 'DELETE' });
            if (!res.ok) { const d = await res.json(); alert(d.error || '삭제 실패'); return; }
            if (_file?.filename === f.filename) { _file = null; _allPts = []; _chartPts = []; stopLive(); resetChart(); }
            await fetchFiles();
          } catch { alert('삭제 중 오류'); }
        });
        item.appendChild(delBtn);
      }

      fileItems.appendChild(item);
    });
  }

  // ── API 호출 ─────────────────────────────────────────────────
  async function fetchStatus() {
    try {
      const res = await apiFetch('/api/tfile/status');
      if (_destroyed || !res.ok) return;
      _status = await res.json();
      if (_destroyed) return;
      updateStatusUI(_status);
      renderFileList();
    } catch {}
  }

  async function fetchFiles() {
    try {
      const res = await apiFetch('/api/tfile/files');
      if (_destroyed || !res.ok) return;
      const data = await res.json();
      if (_destroyed) return;
      _files = data.files ?? [];
      renderFileList();
    } catch {}
  }

  // ── 뷰 범위 유틸 ────────────────────────────────────────────
  // 메모리에 실제로 적재된 데이터의 시작/끝 시각. 헤더가 알려주는 _file.startTime
  // (이론상 시작 시각)과 다를 수 있다 — 예를 들어 파일 앞부분 일부를 못 받아온
  // 경우 등. "이론상 경계"가 아니라 항상 "실제로 로드된 데이터" 기준으로 경계를
  // 잡아야 처음/끝 위치로 이동했을 때 빈 구간 없이 정확히 데이터가 있는 지점에서
  // 멈춘다. 라이브 파일이면 pollLatest가 _allPts를 계속 늘리므로 dataEndSec()도
  // 자연히 함께 전진한다(Date.now()를 쓰지 않는 이유이기도 함 — 시계가 실제 로드된
  // 데이터보다 앞서 있으면 그 사이 빈 구간으로 패닝/줌이 가능해져 그래프가 깨진다).
  function dataStartSec() {
    if (!_file) return 0;
    if (_allPts.length === 0) return _file.startTime;
    return _allPts[0].ts;
  }
  function dataEndSec() {
    if (!_file) return 0;
    if (_allPts.length === 0) return _file.startTime;
    return _allPts[_allPts.length - 1].ts;
  }

  // 뷰 범위를 실제 로드된 데이터 경계 안으로 클램프 (폭은 최대한 유지)
  // PREV/NEXT/줌/휠·드래그처럼 "파일 밖으로 못 나가게" 막는 탐색용 — 요청한 폭이
  // 실제 데이터 범위보다 넓으면 폭 자체를 줄여서 있는 데이터에 맞춘다.
  function clampView(from, to) {
    if (!_file) return [from, to];
    const minWidth = Math.max(1, _file.freq * MIN_VIEW_POINTS);
    let width = Math.max(minWidth, to - from);
    const start = dataStartSec();
    const end   = Math.max(start + minWidth, dataEndSec());

    if (width > end - start) width = end - start;
    if (from < start) { from = start; to = from + width; }
    if (to > end)      { to = end;    from = to - width; }
    if (from < start)  { from = start; }
    return [from, to];
  }

  // 시작 경계만 고정하고 폭은 줄이지 않는 클램프 — "1픽셀=데이터 1개" 기본 뷰처럼
  // 데이터가 창을 다 못 채워도 늘려서 보여주지 않고 나머지를 빈 채로 둬야 할 때 사용.
  function clampViewKeepWidth(from, to) {
    if (!_file) return [from, to];
    const start = dataStartSec();
    const width = Math.max(1, to - from);
    if (from < start) { from = start; to = from + width; }
    return [from, to];
  }

  // "1픽셀 = 데이터 1개" 기본 뷰 폭(초 단위) — 캔버스 폭(px) × 레코딩 주기(초)
  function oneToOneWidthSec() {
    const canvasW = _chart?.canvas?.clientWidth || 1200;
    // [from, to] 구간은 양끝 포함이라 폭을 canvasW*freq로 두면 실제로는
    // (canvasW+1)개 레코드가 걸쳐 computeViewPts의 stride가 2로 올림돼(=포인트
    // 절반 손실) 진짜 1:1이 깨진다. canvasW-1로 정확히 canvasW개가 되게 맞춘다.
    return Math.max(1, (canvasW - 1) * _file.freq);
  }

  // 정지된(레코딩 중이 아닌) 파일의 기본 뷰: 파일 시작점부터 1:1로, 데이터가 캔버스
  // 폭보다 적으면 나머지 오른쪽은 빈 채로 둔다.
  function computeOneToOneStartWindow() {
    const from = dataStartSec();
    return [from, from + oneToOneWidthSec()];
  }

  // 레코딩 중인(라이브) 파일의 뷰: 아직 창을 다 못 채웠으면 시작점에 고정된 채
  // 오른쪽이 한 픽셀씩 채워지고, 창을 다 채우고 나면 최신 데이터가 오른쪽 끝에
  // 고정되는 슬라이딩 창으로 자연스럽게 전환된다.
  function computeLiveWindow() {
    const width = oneToOneWidthSec();
    const to    = dataEndSec();
    const from  = Math.max(dataStartSec(), to - width);
    return [from, from + width];
  }

  // _allPts에서 지정 구간을 잘라 캔버스 폭에 맞게 다운샘플링(순수 함수 — 부수효과 없음)
  function computeViewPts(fromSec, toSec) {
    if (!_file || _allPts.length === 0) return [];
    const stepSec = _allPtsStep * _file.freq;
    let riStart = Math.round((fromSec - _file.startTime) / stepSec);
    let riEnd   = Math.round((toSec   - _file.startTime) / stepSec);
    riStart = Math.max(0, Math.min(_allPts.length - 1, riStart));
    riEnd   = Math.max(riStart, Math.min(_allPts.length - 1, riEnd));
    const slice = _allPts.slice(riStart, riEnd + 1);
    const canvasW = _chart?.canvas?.clientWidth || 1200;
    const stride  = Math.max(1, Math.ceil(slice.length / canvasW));
    return stride === 1 ? slice : slice.filter((_, i) => i % stride === 0);
  }

  // hex 색상을 지정 투명도의 rgba로 변환 — 선택되지 않은 채널을 흐리게 표시할 때 사용
  function dimColor(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // _chart.data.datasets만 구성한다 — 스케일(축 범위)은 건드리지 않고, chart.update()도
  // 호출자가 책임진다. (스케일 애니메이션과 분리해야 포인트가 뒤틀리는 애니메이션 없이
  // 매끄럽게 처리 가능 — animateViewTo 참고)
  function setChartDatasets(pts) {
    _chartPts = pts;
    if (!_chart) return;
    if (!_file || pts.length === 0) {
      _chart.data.datasets = [];
      return;
    }
    const datasets = [];
    let selectedDataset = null;
    for (let i = 0; i < _file.chCnt; i++) {
      if (!_visibleCh.has(i)) continue;
      const ch       = _file.channels[i];
      const color    = _colorMap[i] ?? PALETTE[i % PALETTE.length];
      const selected = _selectedCh === i;
      // 선택된 채널이 있으면 그 채널만 굵게/원색으로 강조하고 나머지는 흐리게
      const dimmed   = _selectedCh != null && !selected;
      const dataset = {
        label:            ch.chtag || `CH${i + 1}`,
        data:             pts.map((p) => ({ x: p.ts * 1000, y: rawToValue(p.vals[i], ch.isSigned, ch.dotpos) })),
        borderColor:      dimmed ? dimColor(color, 0.25) : color,
        backgroundColor:  'transparent',
        borderWidth:      selected ? 3.5 : 2,
        pointRadius:      0,
        pointHoverRadius: 4,
        tension:          0.3,
        _chIdx:           i,
      };
      if (selected) selectedDataset = dataset;
      else datasets.push(dataset);
    }
    // 강조된 채널을 배열 맨 뒤에 둬서 다른 선들 위에 그려지게 한다
    if (selectedDataset) datasets.push(selectedDataset);
    _chart.data.datasets = datasets;
  }

  // 즉시(애니메이션 없이) 지정 구간으로 뷰를 갱신 — 초기 로드/라이브 폴링/LIVE 토글/
  // 마우스 휠·드래그(플러그인이 스케일을 이미 실시간으로 옮겨주고 있으므로 데이터만
  // 동기화하면 됨)에서 사용. 전부 로컬 메모리 연산이라 네트워크 왕복이 없다.
  // keepWidth: true면 폭을 줄이지 않는 클램프 사용 — 1:1 기본 뷰처럼 데이터가
  // 창을 다 못 채워도 늘리지 않고 나머지를 빈 채로 둬야 할 때(초기 로드/라이브).
  function renderViewFromMemory(fromSec, toSec, { keepWidth = false } = {}) {
    if (!_file) return;
    const [f, t] = keepWidth ? clampViewKeepWidth(fromSec, toSec) : clampView(fromSec, toSec);
    _viewFrom = f;
    _viewTo   = t;
    setChartDatasets(computeViewPts(f, t));
    if (_chart) {
      _chart.options.scales.x.min = f * 1000;
      _chart.options.scales.x.max = t * 1000;
      _chart.update('none');
    }
    updateTimeLabel();
  }

  // 마우스 휠 줌 / 드래그 팬: 제스처 중 계속 발생하는 콜백에서 매번 호출한다.
  // 전부 로컬 메모리 슬라이싱이라 네트워크 스로틀이 필요 없다 — 이동/확대 중에도
  // 실시간으로 데이터가 채워진다.
  function syncViewFromChart({ chart }) {
    renderViewFromMemory(chart.scales.x.min / 1000, chart.scales.x.max / 1000);
  }

  // 버튼(ZOOM IN/OUT, PREV/NEXT) 네비게이션: x축 min/max를 직접
  // requestAnimationFrame으로 보간(tween)한다.
  //
  // Chart.js의 기본 애니메이션 시스템은 데이터셋의 개별 포인트(x/y 값)만 애니메이션
  // 대상으로 삼고, 스케일의 min/max 자체는 애니메이션 가능한 속성이 아니다 — 그래서
  // chartjs-plugin-zoom의 zoomScale(..., 'default')를 호출해도(데이터는 안 바뀐 채
  // 스케일만 바뀌면) 실제로는 아무 애니메이션 없이 그냥 즉시 스냅된다. 이 때문에 직접
  // 매 프레임 min/max를 계산해 update('none')로 찍어주는 방식으로 구현했다.
  //
  // 애니메이션 도중 데이터셋은 "이전 범위 ∪ 목표 범위"(합집합)로 채운다. 목표
  // 범위만 미리 채우면, 스케일이 움직이기도 전에 이전 범위 중 목표 범위 밖에
  // 있던 절반이 데이터셋에서 사라져 화면에 빈 여백부터 보이는 버그가 생긴다.
  // 애니메이션이 끝난 뒤에야 정확히 목표 범위만으로 다시 정리한다(메모리 절약).
  const NAV_ANIM_MS = 480;

  // easeInOutQuad: 시작할 때 서서히 가속, 목표 지점에 가까워질수록 서서히 감속 —
  // easeOut 계열(처음부터 최고 속도로 시작)보다 "스르륵 흐르는" 느낌이 강하다.
  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  let _navAnimFrame = null;
  function animateViewTo(newFrom, newTo) {
    const [f, t] = clampView(newFrom, newTo);
    const startFrom = _viewFrom, startTo = _viewTo;

    const bufFrom = Math.min(startFrom, f);
    const bufTo   = Math.max(startTo, t);
    setChartDatasets(computeViewPts(bufFrom, bufTo));
    if (_chart) _chart.update('none');

    _viewFrom = f;
    _viewTo   = t;
    updateTimeLabel();

    if (!_chart) return;

    cancelAnimationFrame(_navAnimFrame);
    setNavAnimating(true); // 애니메이션 도중 재조작(빠른 연속 클릭) 방지
    const startMin = startFrom * 1000, startMax = startTo * 1000;
    const endMin   = f * 1000,         endMax   = t * 1000;
    const t0 = performance.now();

    function step(now) {
      const p = Math.min(1, (now - t0) / NAV_ANIM_MS);
      const e = easeInOutQuad(p);
      _chart.options.scales.x.min = startMin + (endMin - startMin) * e;
      _chart.options.scales.x.max = startMax + (endMax - startMax) * e;
      _chart.update('none');
      if (p < 1) {
        _navAnimFrame = requestAnimationFrame(step);
      } else {
        // 애니메이션 완료 — 합집합 버퍼 대신 목표 구간만으로 다시 정리
        setChartDatasets(computeViewPts(f, t));
        _chart.update('none');
        setNavAnimating(false);
        updateViewControlButtons();
      }
    }
    _navAnimFrame = requestAnimationFrame(step);
  }

  // 애니메이션 도중 네비게이션 버튼을 잠근다(LIVE 잠금과는 별개) — 겹쳐서 클릭하면
  // 논리적 목표값 기준으로 다음 애니메이션이 시작돼 화면이 살짝 튀는 문제를 방지.
  function setNavAnimating(disabled) {
    [prevBtn, nextBtn, zoomInBtn, zoomOutBtn, rangeSelectBtn, fitAllBtn]
      .forEach((b) => { if (b) b.disabled = disabled; });
  }

  // ZOOM IN(factor<1)/ZOOM OUT(factor>1): 뷰 중심을 유지한 채 폭만 배율 조정
  function zoomView(factor) {
    if (!_file || _isLive) return;
    const center = (_viewFrom + _viewTo) / 2;
    const minWidth = Math.max(1, _file.freq * MIN_VIEW_POINTS);
    const newWidth = Math.max(minWidth, (_viewTo - _viewFrom) * factor);
    animateViewTo(center - newWidth / 2, center + newWidth / 2);
  }

  // PREV(dir=-1)/NEXT(dir=+1): 현재 보는 영역의 절반만큼 이동
  function shiftView(dir) {
    if (!_file || _isLive) return;
    const width = Math.max(1, _viewTo - _viewFrom);
    const shift = (width / 2) * dir;
    animateViewTo(_viewFrom + shift, _viewTo + shift);
  }

  // 현재 뷰가 "파일 전체 보기" 상태인지(저장된 플래그가 아니라 실제 범위로 판단 —
  // ZOOM OUT을 반복해도 결과적으로 전체 보기가 되면 동일하게 인식돼야 하므로).
  function isFitAllView() {
    if (!_file) return false;
    return Math.abs(_viewFrom - dataStartSec()) < 0.5 && Math.abs(_viewTo - dataEndSec()) < 0.5;
  }

  // 전체 보기 ↔ 1:1 토글. 1:1 상태에서 이미 파일 전체가 한 화면에 들어오면
  // (데이터가 캔버스 폭보다 적으면) 굳이 다른 동작이 없으므로 버튼을 비활성화한다.
  function toggleFitAll() {
    if (!_file || _isLive) return;
    if (isFitAllView()) {
      const [f, t] = computeOneToOneStartWindow();
      animateViewTo(f, t);
    } else {
      animateViewTo(dataStartSec(), dataEndSec());
    }
  }

  // 구간 보기 토글: 켜지면 드래그가 팬 대신 "영역 선택 후 그 구간으로 확대"로 바뀐다.
  // 확대된 결과는 되돌리기가 없다 — 사용자가 전체 보기나 줌아웃으로 직접 빠져나온다.
  function toggleRangeSelect() {
    if (!_file || _isLive) return;
    _rangeSelectActive = !_rangeSelectActive;
    if (_chart) {
      _chart.options.plugins.zoom.pan.enabled      = !_rangeSelectActive;
      _chart.options.plugins.zoom.zoom.drag.enabled = _rangeSelectActive;
      _chart.update('none');
    }
    if (rangeSelectBtn) rangeSelectBtn.classList.toggle('active', _rangeSelectActive);
  }

  // 전체 보기 버튼의 활성/비활성·토글 표시 상태를 현재 뷰 기준으로 갱신.
  // updateTimeLabel()이 뷰가 바뀔 때마다 항상 같이 호출되므로 거기서 함께 호출한다.
  function updateViewControlButtons() {
    if (!_file || !fitAllBtn) return;
    const canFitAll = (dataEndSec() - dataStartSec()) > oneToOneWidthSec();
    fitAllBtn.disabled = _isLive || !canFitAll;
    fitAllBtn.classList.toggle('active', isFitAllView());
  }

  // LIVE 모드 동안 수동 네비게이션(버튼) 비활성화. 마우스 휠/드래그는 2안에서
  // 항상 로컬 메모리 기반이라 라이브 중에도 안전하지만, 라이브 추적을 방해하지
  // 않도록 동일하게 잠가둔다.
  function setNavDisabled(disabled) {
    [prevBtn, nextBtn, zoomInBtn, zoomOutBtn, rangeSelectBtn].forEach((b) => { if (b) b.disabled = disabled; });
    // LIVE 진입 시 구간 보기 모드는 해제(드래그는 팬으로 복귀) — 라이브 추적 중엔
    // 어차피 버튼이 잠기지만, 드래그 설정 자체도 정상 상태로 되돌려 둔다.
    if (disabled && _rangeSelectActive) {
      _rangeSelectActive = false;
      if (rangeSelectBtn) rangeSelectBtn.classList.remove('active');
    }
    if (_chart) {
      _chart.options.plugins.zoom.zoom.wheel.enabled = !disabled;
      _chart.options.plugins.zoom.zoom.pinch.enabled = !disabled;
      _chart.options.plugins.zoom.zoom.drag.enabled  = !disabled && _rangeSelectActive;
      _chart.options.plugins.zoom.pan.enabled = !disabled && !_rangeSelectActive;
      _chart.update('none');
    }
    updateViewControlButtons();
  }

  // ── 파일 전체를 메모리에 적재 ─────────────────────────────────
  // 로드가 너무 빨리 끝나면(캐시 등) 프로그래스바가 뜨자마자 사라져 껌벅이는
  // 느낌을 준다. 최소 표시 시간을 보장해 항상 눈에 들어올 정도는 유지한다.
  const LOAD_PROGRESS_MIN_MS = 400;
  let _loadProgressShownAt = 0;
  let _loadProgressHideTimer = null;

  function showLoadProgress() {
    clearTimeout(_loadProgressHideTimer);
    _loadProgressHideTimer = null;
    _loadProgressShownAt = Date.now();
    showSkeleton();
    if (loadProgress)     loadProgress.hidden = false;
    if (loadProgressFill) loadProgressFill.style.width = '0%';
    if (loadProgressText) loadProgressText.textContent = '불러오는 중…';
  }
  function hideLoadProgress() {
    const elapsed = Date.now() - _loadProgressShownAt;
    const delay = Math.max(0, LOAD_PROGRESS_MIN_MS - elapsed);
    clearTimeout(_loadProgressHideTimer);
    _loadProgressHideTimer = setTimeout(() => {
      _loadProgressHideTimer = null;
      hideSkeleton();
      if (loadProgress) loadProgress.hidden = true;
    }, delay);
  }
  function updateLoadProgress(received, total) {
    if (total > 0) {
      const pct = Math.min(100, Math.round((received / total) * 100));
      if (loadProgressFill) loadProgressFill.style.width = `${pct}%`;
      if (loadProgressText) loadProgressText.textContent = `${formatBytes(received)} / ${formatBytes(total)} (${pct}%)`;
    } else if (loadProgressText) {
      loadProgressText.textContent = `${formatBytes(received)} 불러오는 중…`;
    }
  }

  // Response body를 스트리밍으로 읽으며 진행률을 갱신한다. 스트리밍이 지원되지
  // 않는 환경에서는 그냥 arrayBuffer()로 폴백(진행률 없이 한 번에 받음).
  async function readBodyWithProgress(res) {
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !res.body.getReader) return res.arrayBuffer();

    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      updateLoadProgress(received, total);
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
    return out.buffer;
  }

  // 파일의 [startTime, toSec] 구간 전체를 1회 요청으로 받아 _allPts에 적재한다.
  // 서버가 (to-from)/step > 50000 보호 규칙으로 step=1 요청을 자체적으로 올렸을
  // 수 있으므로, 반환된 레코드의 실제 timestamp 간격으로부터 _allPtsStep을 역산한다.
  async function loadFullFile(filename, toSec) {
    const url = `/api/tfile/sample?file=${encodeURIComponent(filename)}&from=${_file.startTime}&to=${toSec}&step=1`;
    const res = await apiFetch(url);
    if (!res.ok) throw new Error(`sample fetch ${res.status}`);

    const buf = await readBodyWithProgress(res);
    const pts = parseSampleBuf(buf, _file.startTime, toSec, 1);
    _allPts     = pts;
    _allPtsStep = pts.length > 1
      ? Math.max(1, Math.round((pts[1].ts - pts[0].ts) / _file.freq))
      : 1;
  }

  // ── 파일 선택 ────────────────────────────────────────────────
  // 파일을 빠르게 연속으로 바꿔 클릭하면 이전 선택의 loadFullFile()이 늦게
  // 끝나면서 최신 선택 결과를 덮어쓸 수 있다. _selectToken으로 "가장 마지막
  // 선택"만 반영하고, 뒤늦게 끝난 이전 선택의 결과는 폐기한다.
  let _selectToken = 0;
  async function selectFile(filename) {
    const myToken = ++_selectToken;
    stopLive();
    _loadingFull = true;
    showLoadProgress();

    try {
      // 헤더 512 bytes 수신 + 파싱
      const hdrRes = await apiFetch(`/api/tfile/header?file=${encodeURIComponent(filename)}`);
      if (!hdrRes.ok) throw new Error('header fetch failed');
      const parsed = parseTndHeader(await hdrRes.arrayBuffer());
      if (_destroyed || myToken !== _selectToken) return; // 페이지 이탈 or 다른 파일 선택됨 — 중단

      _file = { filename, ...parsed };
      _lastLiveBuf = null; // 이전에 선택했던(다른) 파일의 중복 감지 상태 초기화

      // 채널별 색상 배정 (처음 한 번)
      for (let i = 0; i < _file.chCnt; i++) {
        if (!_colorMap[i]) _colorMap[i] = PALETTE[i % PALETTE.length];
      }

      // 처음 파일 선택 or 채널 수가 달라진 경우 전 채널 표시
      if (_visibleCh.size === 0) {
        _visibleCh = new Set(Array.from({ length: _file.chCnt }, (_, i) => i));
      }

      const isRecFile = _status?.recording && _status?.filename === filename;
      const fi = _files.find((f) => f.filename === filename);
      const estimatedEnd = isRecFile ? Math.floor(Date.now() / 1000) : (fi?.endTime ?? _file.startTime);

      // 파일 전체를 메모리에 적재 (서버 호출은 이 1번뿐 — 이후 이동/줌은 전부 로컬 연산)
      await loadFullFile(filename, estimatedEnd);
      if (_destroyed || myToken !== _selectToken) return; // 페이지 이탈 or 다른 파일 선택됨 — 이 결과는 버림

      // 휠 줌/드래그 팬 한계를 실제 로드된 데이터 경계로 갱신
      if (_chart) {
        _chart.options.plugins.zoom.limits.x = {
          min: dataStartSec() * 1000,
          max: dataEndSec() * 1000,
          minRange: Math.max(1000, _file.freq * MIN_VIEW_POINTS * 1000),
        };
      }

      // 뷰 범위 결정: "1픽셀 = 데이터 1개" 기본 뷰. 녹화 중 파일이면 실시간 창
      // (창을 다 못 채웠으면 시작점부터 자라나다 다 채우면 최신 데이터에 고정),
      // 아니면 파일 시작점부터 캔버스 폭만큼 — 데이터가 적어도 늘려 보여주지 않는다.
      const [vf, vt] = isRecFile ? computeLiveWindow() : computeOneToOneStartWindow();
      _viewFrom = vf;
      _viewTo   = vt;

      renderViewFromMemory(_viewFrom, _viewTo, { keepWidth: true });
      renderStatsCards();
      highlightFileItem(filename);

      if (isRecFile) startLive();

    } catch (err) {
      if (!_destroyed && myToken === _selectToken) {
        console.error('파일 선택 오류:', err);
        // 헤더는 이미 새 파일로 갱신됐는데 전체 적재가 중간에 실패하면 _file(새 파일
        // 메타데이터)과 _allPts(이전 파일 또는 빈 상태)가 서로 어긋난 채로 남는다 —
        // 그대로 두면 "헤더는 11시인데 실제로 보이는 데이터는 이전 파일의 2시부터"
        // 같은 불일치가 조용히 발생하므로, 실패 시 반드시 상태를 깨끗이 비운다.
        _file = null;
        _allPts = [];
        _chartPts = [];
        resetChart();
        renderStatsCards();
        alert('파일을 불러오지 못했습니다. 다시 시도해 주세요.');
      }
    } finally {
      if (myToken === _selectToken) {
        _loadingFull = false;
        hideLoadProgress();
      }
    }
  }

  function highlightFileItem(filename) {
    $$('.tfile-file-item', fileItems).forEach((el) => {
      el.classList.toggle('active', el.dataset.filename === filename);
    });
  }

  // ── Live 폴링 ────────────────────────────────────────────────
  function startLive() {
    _isLive = true;
    if (liveBtn) liveBtn.classList.add('active');
    setNavDisabled(true);
    const intervalMs = Math.max(1000, _file.freq * 1000);
    _liveTimer = setInterval(pollLatest, intervalMs);
  }

  function stopLive() {
    _isLive = false;
    if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
    if (liveBtn) liveBtn.classList.remove('active');
    setNavDisabled(false);
  }

  // 라이브 파일의 최신 레코드 1개만 받아 _allPts에 이어붙인다(추가 서버 호출은
  // 이것뿐). _allPtsStep이 1이 아니면(초대용량 파일이라 전체 적재 시 서버가
  // step을 올린 경우) 간격이 안 맞아 이어붙일 수 없으므로 생략한다 — 드문 경우.
  async function pollLatest() {
    if (_destroyed || !_file || _loadingFull || _allPtsStep !== 1) return;
    try {
      const res = await apiFetch(`/api/tfile/latest?file=${encodeURIComponent(_file.filename)}`);
      if (_destroyed || !res.ok) return;
      const buf = await res.arrayBuffer();
      if (_destroyed || buf.byteLength < 32) return;

      const u8 = new Uint8Array(buf);

      // 이전과 동일한 레코드면 스킵 (아직 새 레코드 미기록)
      if (_lastLiveBuf && _lastLiveBuf.length === u8.length &&
          _lastLiveBuf.every((v, i) => v === u8[i])) return;
      _lastLiveBuf = u8;

      _lastLiveTs = dataEndSec() + _file.freq;

      const vals = new Array(16);
      const dv   = new DataView(buf);
      for (let ch = 0; ch < 16; ch++) vals[ch] = dv.getUint16(ch * 2, true);

      _allPts.push({ ts: _lastLiveTs, vals });

      // 휠/드래그 팬 한계도 함께 전진시켜 새로 들어온 구간까지 접근 가능하게 함
      if (_chart) _chart.options.plugins.zoom.limits.x.max = dataEndSec() * 1000;

      // 뷰 범위 전진 (실시간 추적 창 유지) — 창을 다 못 채웠으면 시작점 고정,
      // 다 채우면 최신 데이터가 오른쪽 끝에 오는 슬라이딩 창으로 자연 전환
      const [lf, lt] = computeLiveWindow();
      _viewFrom = lf;
      _viewTo   = lt;

      renderViewFromMemory(_viewFrom, _viewTo, { keepWidth: true });
      updateStatsLastValue();

    } catch {}
  }

  // ── 차트 데이터 업데이트 ─────────────────────────────────────
  function resetChart() {
    setChartDatasets([]);
    if (_chart) _chart.update('none');
  }

  // 뷰 범위(= 시간축)는 그대로 두고, 현재 _chartPts만으로 데이터셋을 다시 그린다.
  // 채널 표시/숨김 토글처럼 "무엇을 그릴지"만 바뀌고 "어느 구간을 볼지"는 안 바뀔 때 사용.
  function updateChartData() {
    setChartDatasets(_chartPts);
    if (_chart) _chart.update('none');
  }

  function updateTimeLabel() {
    if (!_file) return;
    if (timeLabelEl) timeLabelEl.textContent = `${formatDate(_viewFrom)} ~ ${formatDate(_viewTo)}`;
    updateViewControlButtons();
  }

  // ── 스탯 카드 ────────────────────────────────────────────────
  // 카드 하나의 내용(클래스/타이틀/내부 HTML)만 채운다 — DOM 노드 자체는 건드리지
  // 않으므로 .tfile-stat-card의 진입 애니메이션(statFadeIn)이 재생되지 않는다.
  function applyStatCardContent(card, i) {
    if (!_file || i >= _file.chCnt) {
      card.className = 'tfile-stat-card unused';
      card.innerHTML = '<div class="stat-unused-label">미사용</div>';
      return;
    }

    const ch       = _file.channels[i];
    const visible  = _visibleCh.has(i);
    const selected = _selectedCh === i;
    const color    = _colorMap[i] ?? PALETTE[i % PALETTE.length];

    card.className = `tfile-stat-card${visible ? ' active' : ' hidden-ch'}${selected ? ' selected' : ''}`;
    card.style.setProperty('--ch-color', color);
    card.style.borderLeftColor = color;
    card.title = selected ? '클릭하여 강조 해제' : '클릭하여 그래프에서 강조 표시';

    const dotStyle = visible ? `background:${color};box-shadow:0 0 5px ${color}88` : 'background:#2a3a4e';

    card.innerHTML =
      `<div class="stat-toggle-btn" title="${visible ? '숨기기' : '표시하기'}">${visible ? '👁' : '⊘'}</div>` +
      `<div class="tfile-stat-dot" style="${dotStyle}"></div>` +
      `<div class="tfile-stat-info">` +
        `<div class="tfile-stat-name">${ch.chtag || `CH${i + 1}`}</div>` +
        buildStatValueHtml(i, ch, visible) +
      `</div>`;
  }

  // 채널 선택/해제(단일) — 그래프에서 해당 채널만 강조. 표시 여부(_visibleCh)와는
  // 완전히 독립적으로 동작한다 — 숨겨진 채널도 선택은 가능하다(카드만 강조되고
  // 그래프엔 그려지지 않음). 영향받는 카드 2개(이전 선택/새 선택)만 갱신한다.
  function toggleSelectChannel(i) {
    const prev = _selectedCh;
    _selectedCh = (_selectedCh === i) ? null : i;
    if (prev != null && _statCardEls[prev]) applyStatCardContent(_statCardEls[prev], prev);
    if (_selectedCh != null && _statCardEls[_selectedCh]) applyStatCardContent(_statCardEls[_selectedCh], _selectedCh);
    updateChartData();
  }

  // 파일 선택 등으로 카드 16개를 전부 새로 만들 때만 사용 — 진입 애니메이션은
  // 이때만(최초 표시) 재생되는 게 자연스럽다.
  function renderStatsCards() {
    if (!statsRow) return;
    statsRow.innerHTML = '';
    _statCardEls = new Array(16).fill(null);

    for (let i = 0; i < 16; i++) {
      const card = document.createElement('div');
      card.style.animationDelay = `${i * 18}ms`;
      applyStatCardContent(card, i);
      _statCardEls[i] = card;

      if (_file && i < _file.chCnt) {
        // 눈 아이콘 클릭 = 표시/숨김 토글, 그 외 카드 본문 클릭 = 선택(강조) 토글.
        // 카드 자체(=이 리스너가 붙은 요소)는 재생성되지 않으므로 이벤트 위임으로
        // 아이콘을 구분해도 innerHTML 갱신과 무관하게 계속 동작한다.
        card.addEventListener('click', (e) => {
          if (e.target.closest('.stat-toggle-btn')) {
            if (_visibleCh.has(i)) _visibleCh.delete(i);
            else _visibleCh.add(i);
            applyStatCardContent(card, i);
            updateChartData();
            return;
          }
          toggleSelectChannel(i);
        });
      }

      statsRow.appendChild(card);
    }
  }

  function buildStatValueHtml(idx, ch, visible) {
    if (!visible || _chartPts.length === 0) {
      return `<div class="stat-hidden-label">${visible ? '데이터 없음' : '숨김'}</div>`;
    }
    const lastVal = rawToValue(_chartPts[_chartPts.length - 1].vals[idx], ch.isSigned, ch.dotpos);
    let minV = Infinity, maxV = -Infinity;
    _chartPts.forEach((p) => {
      const v = rawToValue(p.vals[idx], ch.isSigned, ch.dotpos);
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    });
    const fmt = (n) => Number.isFinite(n) ? n.toFixed(ch.dotpos) : '—';
    return `<div class="tfile-stat-values">` +
      `<span class="tfile-stat-avg">${fmt(lastVal)}<span class="tfile-stat-unit"> ${ch.unit}</span></span>` +
      `<div class="tfile-stat-minmax"><span>▲${fmt(maxV)}</span><span>▼${fmt(minV)}</span></div>` +
      `</div>`;
  }

  // live 폴링 시 스탯 카드 최신값만 경량 업데이트
  function updateStatsLastValue() {
    if (!statsRow || !_file || _chartPts.length === 0) return;
    const cards = $$('.tfile-stat-card:not(.unused)', statsRow);
    cards.forEach((card, i) => {
      if (i >= _file.chCnt) return;
      const ch = _file.channels[i];
      const infoEl = card.querySelector('.tfile-stat-info');
      if (!infoEl) return;
      const nameEl = infoEl.querySelector('.tfile-stat-name');
      const name   = nameEl?.outerHTML ?? '';
      infoEl.innerHTML = name + buildStatValueHtml(i, ch, _visibleCh.has(i));
    });
  }

  // ── 스켈레톤 ────────────────────────────────────────────────
  function showSkeleton() {
    if (skeleton) skeleton.hidden = false;
  }
  function hideSkeleton() {
    if (skeleton) skeleton.hidden = true;
  }

  // ── 크로스헤어 플러그인 ──────────────────────────────────────
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

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.strokeStyle = 'rgba(77,160,255,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();

      const d = new Date(val), p = (n) => String(n).padStart(2, '0');
      const label = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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

  // ── Chart.js 초기화 ─────────────────────────────────────────
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function loadChartJs() {
    if (!window.Chart) await loadScript('./assets/vendor/chart.min.js');
    // chartjs-plugin-zoom은 터치 팬/핀치 제스처 처리에 Hammer.js를 필요로 함(선반드시 먼저 로드)
    if (!window.Hammer) await loadScript('./assets/vendor/hammer.min.js');
    if (!window.ChartZoom) await loadScript('./assets/vendor/chartjs-plugin-zoom.min.js');
  }

  async function initChart() {
    await loadChartJs();
    const canvas = $('#tfileChart');
    if (!canvas) return;

    _chart = new Chart(canvas, {
      type: 'line',
      data: { datasets: [] },
      plugins: [crosshairPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
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
                const ts = items[0]?.parsed?.x;
                if (!ts) return '';
                const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
              },
              label: (item) => {
                const idx = item.dataset._chIdx;
                const ch  = _file?.channels[idx];
                const val = item.parsed.y.toFixed(ch?.dotpos ?? 0);
                const unit = ch?.unit ? ` ${ch.unit}` : '';
                return ` ${item.dataset.label}  ${val}${unit}`;
              },
              labelColor: (item) => ({
                borderColor:     item.dataset.borderColor,
                backgroundColor: item.dataset.borderColor,
                borderRadius:    3,
              }),
            },
          },
          zoom: {
            // 2안(전체 파일 메모리 적재)에서는 휠 줌/드래그 팬이 전부 로컬 슬라이싱이라
            // 서버 부하 걱정 없이 제스처 중(onPan/onZoom) 매번 실시간으로 동기화한다.
            limits: { x: { minRange: 1000 } },
            pan: {
              enabled: true,
              mode: 'x',
              onPan: syncViewFromChart,
              onPanComplete: syncViewFromChart,
            },
            zoom: {
              wheel: { enabled: true, speed: 0.12 },
              pinch: { enabled: true },
              // 구간 보기 모드에서만 활성화 — 드래그로 영역을 선택하면 그 구간으로 확대.
              // mode:'x'라 세로축(값) 확대는 없고 시간축만 선택한 구간으로 채워진다.
              drag: {
                enabled: false,
                backgroundColor: 'rgba(77,160,255,0.15)',
                borderColor: 'rgba(77,160,255,0.6)',
                borderWidth: 1,
              },
              mode: 'x',
              onZoom: syncViewFromChart,
              onZoomComplete: syncViewFromChart,
            },
          },
        },
        scales: {
          x: {
            type:   'linear',
            ticks:  {
              color: '#8fa0b7', maxTicksLimit: 8,
              callback: (val) => {
                const d = new Date(val), p = (n) => String(n).padStart(2, '0');
                return [
                  `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`,
                  `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
                ];
              },
            },
            grid:   { color: 'rgba(148,163,184,0.13)' },
            border: { color: 'rgba(148,163,184,0.28)' },
          },
          y: {
            ticks:  { color: '#8fa0b7' },
            grid:   { color: 'rgba(148,163,184,0.13)' },
            border: { color: 'rgba(148,163,184,0.28)' },
          },
        },
      },
    });
  }

  // ── 이벤트 바인딩 ────────────────────────────────────────────

  // 녹화 시작/중지 겸용 버튼: 현재 상태(_status.recording)에 따라 동작이 바뀐다.
  if (recToggleBtn) recToggleBtn.addEventListener('click', async () => {
    recToggleBtn.disabled = true;
    const wasRecording = !!_status?.recording;
    try {
      if (wasRecording) {
        const res = await apiFetch('/api/tfile/stop', {
          method: 'POST', body: '{}',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          stopLive();
          await fetchStatus();
          await fetchFiles();
        }
      } else {
        const res = await apiFetch('/api/tfile/start', {
          method: 'POST', body: '{}',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) { const d = await res.json(); alert(d.error || '녹화 시작 실패'); return; }
        const data = await res.json();
        await fetchStatus();
        await fetchFiles();
        if (data.filename) selectFile(data.filename);
      }
    } catch {
      if (!wasRecording) alert('녹화 시작 중 오류');
    } finally {
      recToggleBtn.disabled = false;
    }
  });

  // LIVE 토글: OFF 상태 → 실시간 창으로 전환 후 폴링 시작
  //           ON 상태(_isLive) → 폴링 중지, 수동 조작 가능 상태로 복귀
  if (liveBtn) liveBtn.addEventListener('click', () => {
    if (!_file) return;
    if (_isLive) { stopLive(); return; }
    const isRecFile = _status?.recording && _status?.filename === _file.filename;
    if (!isRecFile) return;
    const [from, to] = computeLiveWindow();
    renderViewFromMemory(from, to, { keepWidth: true });
    startLive();
  });

  if (prevBtn)    prevBtn.addEventListener('click',    () => shiftView(-1));
  if (nextBtn)    nextBtn.addEventListener('click',    () => shiftView(1));
  if (zoomInBtn)  zoomInBtn.addEventListener('click',  () => zoomView(ZOOM_IN_FACTOR));
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoomView(ZOOM_OUT_FACTOR));
  if (rangeSelectBtn) rangeSelectBtn.addEventListener('click', toggleRangeSelect);
  if (fitAllBtn)       fitAllBtn.addEventListener('click', toggleFitAll);

  if (refreshBtn) refreshBtn.addEventListener('click', () => {
    fetchStatus();
    fetchFiles();
  });

  // ── 초기화 ──────────────────────────────────────────────────
  async function init() {
    await Promise.all([fetchStatus(), fetchFiles()]);
    await initChart();

    if (_status?.recording && _status?.filename) {
      // 녹화 중이면 현재 파일 자동 선택
      await selectFile(_status.filename);
    } else if (_files.length > 0) {
      // 가장 최근 파일 자동 선택
      const latest = [..._files].sort((a, b) => b.startTime - a.startTime)[0];
      await selectFile(latest.filename);
    } else {
      hideSkeleton();
    }

    // 상태 폴링: 녹화 중이면 레코드 간격(freq)에 맞춰, 대기 중이면 10초마다.
    // setInterval 대신 재귀 setTimeout — 매 회 최신 freq로 다음 주기를 다시 계산한다.
    scheduleStatusPoll();
    loadDiskUsage();
    _diskTimer = setInterval(loadDiskUsage, 5000);
  }

  function scheduleStatusPoll() {
    if (_destroyed) return;
    fetchStatus().finally(() => {
      if (_destroyed) return;
      const intervalMs = _status?.recording
        ? Math.max(1000, (_status.freq || 10) * 1000)
        : 10000;
      _statusTimer = setTimeout(scheduleStatusPoll, intervalMs);
    });
  }

  // ── 페이지 전환 시 타이머 정리 ───────────────────────────────────
  // main.js의 loadPageJs()는 <script> 태그만 교체할 뿐 실행 중인 타이머/클로저는
  // 정리하지 않는다. 정리하지 않으면 다른 메뉴로 이동해도 _statusTimer/_liveTimer가
  // 백그라운드에서 계속 돌며 API를 호출한다 — realtime.js와 동일한 패턴으로 방지.
  function onHashChange() {
    if (location.hash !== '#trends') {
      _destroyed = true;
      if (_statusTimer) { clearTimeout(_statusTimer); _statusTimer = null; }
      if (_diskTimer)   { clearInterval(_diskTimer);   _diskTimer = null; }
      stopLive();
      window.removeEventListener('hashchange', onHashChange);
    }
  }
  window.addEventListener('hashchange', onHashChange);

  PageLoader.show();
  init()
    .then(() => PageLoader.hide(null))
    .catch((err) => {
      console.error('파일 트렌드 초기화 오류:', err);
      PageLoader.showError('파일 트렌드를 불러올 수 없습니다.');
    });

})();
