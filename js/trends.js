(() => {

  // ── 채널 색상 팔레트 (js/tnd-format.js 공용) ─────────────────
  const PALETTE = TndFormat.PALETTE;

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
  let _liveBusy    = false;  // live 요청 진행 중(응답이 주기보다 늦을 때 같은 구간 중복 요청 방지)
  let _viewFrom    = 0;      // 현재 뷰 시작 (unix sec)
  let _viewTo      = 0;      // 현재 뷰 종료 (unix sec)
  let _loadingFull = false;  // 파일 전체 적재 중(pollLatest와 경쟁 방지)
  let _isLive      = false;
  let _destroyed   = false;  // 다른 페이지로 이동해 이 페이지 스크립트가 정리된 상태
  let _rangeSelectActive = false; // 구간 보기 모드(드래그 = 팬 대신 영역 선택 후 확대)
  // 바늘(기록계 펜): 그래프와 오른쪽 y축 눈금 사이 공간에 채널별 맨 오른쪽 값을 표시.
  // 'overlap' = 모두 한 줄에 겹쳐, 'spread' = 보이는 채널마다 칸을 따로(그만큼 그래프 폭 줄어듦)
  const NEEDLE_KEY = 'swr.trendNeedleMode';
  const NEEDLE_OVERLAP_PX = 18;
  const NEEDLE_LANE_PX = 12;
  let _needleMode = (() => { try { return localStorage.getItem(NEEDLE_KEY) === 'spread' ? 'spread' : 'overlap'; } catch (_) { return 'overlap'; } })();

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
  const needleBtn      = $('#tfileNeedleBtn');
  const timeLabelEl = $('#tfileTimeLabel');
  const statsRow    = $('#tfileStatsRow');

  // ── 바이너리 파싱 (공용 로직은 js/tnd-format.js의 TndFormat 참고) ─────────
  const parseTndHeader = TndFormat.parseHeader;
  const rawToValue     = TndFormat.rawToValue;

  // buf: ArrayBuffer of N*32 bytes. fromSec/toSec: requested range unix sec.
  // step: step sent to server (server may have bumped it silently).
  function parseSampleBuf(buf, fromSec, toSec, step) {
    return TndFormat.parseSample(buf, fromSec, toSec, step, _file);
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
      const prev = _status;
      _status = await res.json();
      if (_destroyed) return;
      updateStatusUI(_status);
      renderFileList();
      followRecordingChange(prev, _status);
    } catch {}
  }

  // 다른 브라우저·사용자가 녹화를 시작·중지해도 따라간다(이 화면의 녹화 버튼도 같은 경로를
  // 지나지만 중복 호출은 무해 — selectFile은 마지막 선택만 반영).
  // 새 녹화로 넘어가는 건 사용자가 최신 파일(또는 녹화 중이던 파일)을 보고 있을 때만 —
  // 지난 파일을 일부러 열어 보는 중이면 화면을 바꾸지 않고 목록만 갱신한다.
  async function followRecordingChange(prev, cur) {
    if (!prev) return;                                   // 첫 조회
    const prevRec = prev.recording ? prev.filename : null;
    const curRec  = cur.recording  ? cur.filename  : null;
    if (prevRec === curRec) return;

    const latest = _files.reduce((a, f) => (!a || f.startTime > a.startTime ? f : a), null);
    const following = !_file || _file.filename === prevRec || _file.filename === latest?.filename;

    if (prevRec && !curRec && _isLive && _file?.filename === prevRec) stopLive();   // 녹화 끝남
    await fetchFiles();
    if (_destroyed) return;
    if (curRec && following && _file?.filename !== curRec) selectFile(curRec);      // 새 녹화
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

  // 뷰 범위 규칙(LIVE·지난 파일·드래그·확대·버튼 모두 이 하나로):
  //  - 창 폭은 [최소 폭, 최대 폭]. 최대 폭 = max(1:1 폭, 데이터 길이) — 데이터가 1:1 창보다
  //    짧으면 1:1 폭까지만(늘려 보이지 않음), 길면 전체 보기(데이터 전체)까지.
  //  - 창이 데이터보다 넓으면 기록계처럼 데이터를 오른쪽 끝에 붙이고 왼쪽은 비운다.
  //  - 데이터가 창보다 길면 데이터 범위 안에서만 움직인다.
  function maxViewWidthSec() {
    return Math.max(oneToOneWidthSec(), dataEndSec() - dataStartSec());
  }

  function clampView(from, to) {
    if (!_file) return [from, to];
    const minWidth = Math.max(1, _file.freq * MIN_VIEW_POINTS);
    const start = dataStartSec(), end = dataEndSec();
    const width = Math.min(maxViewWidthSec(), Math.max(minWidth, to - from));
    if (width >= end - start) return [end - width, end];      // 짧은 데이터: 오른쪽 정렬
    from = Math.min(Math.max(from, start), end - width);
    return [from, from + width];
  }

  // 휠 줌·드래그 팬(플러그인) 한계를 같은 규칙으로 — 오른쪽 정렬된 빈 왼쪽까지 허용
  function updateZoomLimits() {
    if (!_chart || !_file) return;
    const end = dataEndSec();
    _chart.options.plugins.zoom.limits.x = {
      min: (end - maxViewWidthSec()) * 1000,
      max: end * 1000,
      minRange: Math.max(1000, _file.freq * MIN_VIEW_POINTS * 1000),
    };
  }

  // "1픽셀 = 데이터 1개" 기본 뷰 폭(초 단위) — 캔버스 폭(px) × 레코딩 주기(초)
  // 실제 그래프 영역 폭(px) — 오른쪽 바늘 공간·y축 눈금을 뺀 폭
  function plotWidthPx() {
    const a = _chart?.chartArea;
    return a ? Math.max(50, Math.round(a.right - a.left)) : (_chart?.canvas?.clientWidth || 1200);
  }

  function oneToOneWidthSec() {
    const canvasW = plotWidthPx();
    // [from, to] 구간은 양끝 포함이라 폭을 canvasW*freq로 두면 실제로는
    // (canvasW+1)개 레코드가 걸쳐 computeViewPts의 stride가 2로 올림돼(=포인트
    // 절반 손실) 진짜 1:1이 깨진다. canvasW-1로 정확히 canvasW개가 되게 맞춘다.
    return Math.max(1, (canvasW - 1) * _file.freq);
  }

  // 정지된(레코딩 중이 아닌) 파일의 기본 뷰: 파일 시작점부터 1:1. 데이터가 창보다
  // 짧으면 clampView가 오른쪽 정렬로 바꾼다.
  function computeOneToOneStartWindow() {
    const from = dataStartSec();
    return [from, from + oneToOneWidthSec()];
  }

  // 레코딩 중인(라이브) 파일의 뷰: 종이 기록계처럼 최신 데이터가 늘 오른쪽 끝(바늘
  // 자리)에 있고 그래프가 왼쪽으로 흘러간다. 데이터가 창보다 적으면 왼쪽은 빈 채로 둔다.
  function computeLiveWindow() {
    const width = oneToOneWidthSec();
    const to    = dataEndSec();
    return [to - width, to];
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
    const stride  = Math.max(1, Math.ceil(slice.length / plotWidthPx()));
    if (stride === 1) return slice;
    const out = slice.filter((_, i) => i % stride === 0);
    if (out[out.length - 1] !== slice[slice.length - 1]) out.push(slice[slice.length - 1]);  // 바늘 위치
    return out;
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
        yAxisID:          'y',   // 'needle'(바늘 공간용 빈 축)이 아니라 값 축에
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
  // 범위는 항상 clampView 규칙(짧은 데이터는 오른쪽 정렬, 늘려 보이지 않음).
  function renderViewFromMemory(fromSec, toSec) {
    if (!_file) return;
    updateZoomLimits();
    const [f, t] = clampView(fromSec, toSec);
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
    updateZoomLimits();
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
    // 이전/다음: 더 갈 곳이 없으면 비활성(짧은 데이터는 둘 다)
    const eps = (_file.freq || 1) / 2;
    if (prevBtn) prevBtn.disabled = _isLive || _viewFrom <= dataStartSec() + eps;
    if (nextBtn) nextBtn.disabled = _isLive || _viewTo >= dataEndSec() - eps;
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
      // 끝 시각은 장치가 알려준 기록 수로 정한다(마지막 레코드 = 시작 + (기록 수 - 1) × 주기).
      // 브라우저 시계를 쓰면 PC 시계가 앞선 만큼 요청 구간이 길어져, 받은 개수로 간격을
      // 역산하는 parseSample이 간격을 잘못 잡고(점이 미래로 늘어짐) LIVE가 멈춘다.
      const estimatedEnd = isRecFile
        ? _file.startTime + Math.max(0, (_status.recordCount || 0) - 1) * _file.freq
        : (fi?.endTime ?? _file.startTime);

      // 파일 전체를 메모리에 적재 (서버 호출은 이 1번뿐 — 이후 이동/줌은 전부 로컬 연산)
      await loadFullFile(filename, estimatedEnd);
      if (_destroyed || myToken !== _selectToken) return; // 페이지 이탈 or 다른 파일 선택됨 — 이 결과는 버림

      // 뷰 범위 결정: "1픽셀 = 데이터 1개" 기본 뷰. 녹화 중 파일이면 최신이 오른쪽 끝,
      // 아니면 파일 시작점부터(데이터가 창보다 짧으면 오른쪽 정렬). 휠·드래그 한계는
      // renderViewFromMemory가 같은 규칙으로 갱신한다.
      applyNeedleLayout(false);   // 채널 수가 바뀌면 펼침 모드 칸 수가 달라짐 — 1:1 폭 계산 전에
      const [vf, vt] = isRecFile ? computeLiveWindow() : computeOneToOneStartWindow();
      _viewFrom = vf;
      _viewTo   = vt;

      renderViewFromMemory(_viewFrom, _viewTo);
      // 새 데이터로 y축 숫자 폭이 바뀌면 그래프 폭도 바뀐다 — 확정된 폭으로 1:1 창을 한 번 더
      const [vf2, vt2] = isRecFile ? computeLiveWindow() : computeOneToOneStartWindow();
      if (Math.abs((vt2 - vf2) - (vt - vf)) >= _file.freq) renderViewFromMemory(vf2, vt2);
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

  // 라이브 파일에 새로 기록된 레코드를 sample 한 번으로 받아 _allPts에 이어붙인다.
  // 레코드 번호 = (시각 - startTime) / freq 이고 서버는 실제 기록된 마지막 레코드까지만
  // 돌려주므로, "지금 가진 다음 칸부터"를 요청하면 새 레코드가 0개·1개·밀린 여러 개로
  // 그대로 온다 — 값 비교가 필요 없어 값이 안 변해도 점이 빠지지 않고, 요청이 하나라
  // 상태 조회와의 경쟁도 없다. 시각은 서버 응답 개수로 간격을 짐작하는
  // parseSample을 쓰지 않고 from + i × 간격으로 직접 계산한다(to를 넉넉히 잡으므로).
  // 전체 적재 때 서버가 step을 올렸으면(_allPtsStep > 1) 같은 간격으로 이어 받는다.
  const LIVE_SPAN_SEC = 3600;   // 한 번에 받을 최대 구간 — 밀리면 다음 주기에 나눠 따라잡음
  async function pollLatest() {
    if (_destroyed || !_file || _loadingFull || _liveBusy) return;
    const file = _file;
    const step = _allPtsStep;
    const gap  = step * file.freq;                       // 이어붙일 점 사이 간격(초)
    const from = _allPts.length ? dataEndSec() + gap : file.startTime;
    const to   = from + Math.max(LIVE_SPAN_SEC, gap);
    _liveBusy = true;
    try {
      const res = await apiFetch(`/api/tfile/sample?file=${encodeURIComponent(file.filename)}&from=${from}&to=${to}&step=${step}`);
      if (_destroyed || _file !== file || _loadingFull || !res.ok) return;
      const buf = await res.arrayBuffer();
      if (_destroyed || _file !== file || _loadingFull) return;
      const n = Math.floor(buf.byteLength / 32);
      if (n === 0) return;                               // 아직 새 레코드 없음

      const dv = new DataView(buf);
      for (let i = 0; i < n; i++) {
        const vals = new Array(16);
        for (let ch = 0; ch < 16; ch++) vals[ch] = dv.getUint16(i * 32 + ch * 2, true);
        _allPts.push({ ts: from + i * gap, vals });
      }

      // 뷰 범위 전진 — 최신 데이터가 늘 오른쪽 끝(휠·드래그 한계도 render에서 갱신)
      const [lf, lt] = computeLiveWindow();
      _viewFrom = lf;
      _viewTo   = lt;

      renderViewFromMemory(_viewFrom, _viewTo);
      updateStatsLastValue();

    } catch {
      // 일시적 통신 오류 — 다음 주기에 같은 칸부터 다시 요청한다
    } finally {
      _liveBusy = false;
    }
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
            applyNeedleLayout();          // 펼침 모드면 칸 수가 바뀜 — 부드럽게
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

  // ── 바늘(기록계 펜) 플러그인 ─────────────────────────────────
  // 그래프 오른쪽 끝과 y축 눈금 사이 공간에, 보이는 채널마다 "지금 화면 맨 오른쪽 데이터"의
  // 값 높이에 채널 색 삼각형(◀)을 그린다. LIVE면 최신 값, 드래그로 지난 구간을 보면 그
  // 구간 끝 값. 공간은 그래프와 y축 사이에 끼운 눈금 없는 빈 축('needle')의 폭으로 확보 —
  // Chart.js가 그만큼 그래프 폭을 줄인다(y축 눈금 여백을 크게 주면 높이까지 줄어들어서 이 방식).
  function needleSpacePx() {
    return _needleMode === 'spread'
      ? Math.max(1, _visibleCh.size) * NEEDLE_LANE_PX + 2
      : NEEDLE_OVERLAP_PX;
  }

  function channelColor(i) {
    const color = _colorMap[i] ?? PALETTE[i % PALETTE.length];
    return _selectedCh != null && _selectedCh !== i ? dimColor(color, 0.25) : color;
  }

  // 디자인 색(트렌드 그래프 전용)
  const RULER   = 'rgba(170,190,215,0.55)';   // 주 눈금
  const RULER_2 = 'rgba(170,190,215,0.30)';   // 보조 눈금

  // y축 눈금 위치(px) 목록과 그 사이 중간 위치(보조 눈금)
  function yTickPixels(yScale) {
    const major = yScale.ticks.map((_, k) => yScale.getPixelForTick(k));
    const minor = [];
    for (let k = 1; k < major.length; k++) minor.push((major[k - 1] + major[k]) / 2);
    return { major, minor };
  }

  function hLine(ctx, x1, x2, y) {
    const yy = Math.round(y) + 0.5;
    ctx.beginPath(); ctx.moveTo(x1, yy); ctx.lineTo(x2, yy); ctx.stroke();
  }

  // 그래프 영역 배경: 위쪽이 아주 조금 밝은 은은한 그라데이션
  const plotBgPlugin = {
    id: 'plotBg',
    beforeDraw(chart) {
      const a = chart.chartArea;
      if (!a) return;
      const { ctx } = chart;
      const g = ctx.createLinearGradient(0, a.top, 0, a.bottom);
      g.addColorStop(0, 'rgba(120,160,210,0.07)');
      g.addColorStop(1, 'rgba(120,160,210,0.01)');
      ctx.save();
      ctx.fillStyle = g;
      ctx.fillRect(a.left, a.top, a.right - a.left, a.bottom - a.top);
      ctx.restore();
    },
  };

  const needlePlugin = {
    id: 'needle',
    afterDatasetsDraw(chart) {
      if (!_file || !chart.chartArea) return;
      const { ctx, chartArea: { top, bottom, left } } = chart;
      const edge   = chart.scales.needle?.left ?? chart.chartArea.right;   // 그래프 오른쪽 경계
      const yScale = chart.scales.y;
      const axisA  = _needleAnim.axis;      // 펼침 진행도 0(겹침)~1(펼침): 값 축·칸 구분선 투명도
      const { major, minor } = yTickPixels(yScale);

      ctx.save();
      ctx.lineWidth = 1;
      // 그래프 경계 눈금자(주·보조)
      ctx.strokeStyle = RULER;   major.forEach((y) => hLine(ctx, edge, edge + 7, y));
      ctx.strokeStyle = RULER_2; minor.forEach((y) => hLine(ctx, edge, edge + 4, y));
      // 값 눈금 축(펼침 모드): y축 왼쪽 세로선 + 눈금(├). 전환 때 서서히 나타나고 사라짐
      if (axisA > 0.01) {
        const ax = Math.round(yScale.left) + 0.5;
        ctx.globalAlpha = axisA;
        ctx.strokeStyle = 'rgba(170,190,215,0.35)';
        ctx.beginPath(); ctx.moveTo(ax, top); ctx.lineTo(ax, bottom); ctx.stroke();
        ctx.strokeStyle = RULER;   major.forEach((y) => hLine(ctx, ax, ax + 5, y));
        ctx.strokeStyle = RULER_2; minor.forEach((y) => hLine(ctx, ax, ax + 3, y));
        ctx.globalAlpha = 1;
      }

      if (_chartPts.length === 0) { ctx.restore(); return; }
      const last  = _chartPts[_chartPts.length - 1];
      const lastX = chart.scales.x.getPixelForValue(last.ts * 1000);
      const showDot = lastX >= left - 1 && lastX <= edge + 1;
      const lanes = [..._visibleCh].filter((i) => i < _file.chCnt).sort((a, b) => a - b);
      const order = lanes.filter((i) => i !== _selectedCh);       // 강조 채널은 맨 위에
      if (_selectedCh != null && lanes.includes(_selectedCh)) order.push(_selectedCh);

      if (axisA > 0.01) {   // 칸 구분선(아주 옅게)
        ctx.strokeStyle = `rgba(148,163,184,${0.08 * axisA})`;
        for (let k = 1; k < lanes.length; k++) {
          const x = Math.round(edge + 2 + k * NEEDLE_LANE_PX) + 0.5;
          ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        }
      }
      for (const i of order) {
        const ch  = _file.channels[i];
        const v   = rawToValue(last.vals[i], ch.isSigned, ch.dotpos);
        const y   = Math.max(top, Math.min(bottom, yScale.getPixelForValue(v)));
        const x0  = edge + 2 + (_needleAnim.lane[i] ?? 0);   // 칸 위치(전환 중엔 미끄러지는 중)
        const col = channelColor(i);
        const sel = _selectedCh === i;
        // 펜 선: 선 끝에서 자기 바늘까지(겹침 모드는 바늘이 바로 옆이라 길이 0)
        if (showDot && x0 > lastX + 3) {
          ctx.strokeStyle = col; ctx.globalAlpha = 0.75;
          hLine(ctx, lastX, x0, y);
          ctx.globalAlpha = 1;
        }
        // 선 끝 점
        if (showDot) {
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(lastX, y, sel ? 3.2 : 2.6, 0, Math.PI * 2); ctx.fill();
        }
        // 바늘(펜 끝이 그래프 쪽을 가리킴)
        const w = 10, h = sel ? 10 : 7;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + w, y - h / 2);
        ctx.lineTo(x0 + w, y + h / 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },
  };

  // 바늘 배치 상태 — 실제로 그리는 값. 모드 전환·채널 표시 변경 때 목표값으로 애니메이션.
  //  space: 바늘 공간 폭(px, 빈 축 afterFit이 읽음) / axis: 펼침 진행도 0~1 / lane: 채널별 칸 위치(px)
  const _needleAnim = { space: null, axis: _needleMode === 'spread' ? 1 : 0, lane: {} };
  const NEEDLE_ANIM_MS = 300;
  let _needleAnimFrame = null;

  function needleTarget() {
    const spread = _needleMode === 'spread';
    const lanes = [..._visibleCh].filter((i) => !_file || i < _file.chCnt).sort((a, b) => a - b);
    const lane = {};
    lanes.forEach((ch, k) => { lane[ch] = spread ? k * NEEDLE_LANE_PX : 0; });
    return { space: needleSpacePx(), axis: spread ? 1 : 0, lane };
  }

  // 바늘 배치를 목표값으로 — animate=false면 바로(파일 열기 등). 그래프 폭이 바뀌면
  // 매 프레임 배율을 유지하며 다시 그린다(rerenderForWidth). 바뀐 게 없으면 false.
  function applyNeedleLayout(animate = true) {
    if (!_chart) return false;
    cancelAnimationFrame(_needleAnimFrame);
    const to   = needleTarget();
    const from = { space: _needleAnim.space ?? to.space, axis: _needleAnim.axis, lane: { ..._needleAnim.lane } };
    const same = from.space === to.space && from.axis === to.axis
      && Object.keys(to.lane).every((k) => from.lane[k] === to.lane[k]);
    if (same) { _needleAnim.lane = to.lane; return false; }

    const frame = (e) => {
      const prevW = plotWidthPx();
      _needleAnim.space = from.space + (to.space - from.space) * e;
      _needleAnim.axis  = from.axis + (to.axis - from.axis) * e;
      const lane = {};
      for (const k of Object.keys(to.lane)) {
        const f = from.lane[k] ?? to.lane[k];          // 새로 보이는 채널은 제자리에서 시작
        lane[k] = f + (to.lane[k] - f) * e;
      }
      _needleAnim.lane = lane;
      _chart.update('none');                            // 빈 축 폭 반영(레이아웃)
      if (_file && Math.abs(plotWidthPx() - prevW) >= 0.5) rerenderForWidth(prevW);
    };
    if (!animate) { frame(1); return true; }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / NEEDLE_ANIM_MS);
      frame(easeInOutQuad(p));
      if (p < 1) _needleAnimFrame = requestAnimationFrame(step);
    };
    _needleAnimFrame = requestAnimationFrame(step);
    return true;
  }

  // 그래프 폭이 바뀐 뒤 다시 그리기 — LIVE는 1:1 창 다시 계산, 아니면 배율(1px당 시간)을
  // 그대로 두고 오른쪽 끝 기준으로 보이는 폭만 조정(폭이 넓어졌는데 그래프가 늘어나지 않게)
  function rerenderForWidth(prevW) {
    if (!_file) return;
    if (_isLive) {
      const [f, t] = computeLiveWindow();
      renderViewFromMemory(f, t);
    } else {
      const span = (_viewTo - _viewFrom) * (prevW ? plotWidthPx() / prevW : 1);
      renderViewFromMemory(_viewTo - span, _viewTo);
    }
  }

  const NEEDLE_ICONS = {
    overlap: '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><path d="M7 3l5-2.5v5z"/><path d="M7 8l5-2.5v5z"/><path d="M7 13l5-2.5v5z"/><path d="M4 1v14" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
    spread:  '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><path d="M3 3l4-2.3v4.6z"/><path d="M7 8l4-2.3v4.6z"/><path d="M11 13l4-2.3v4.6z"/><path d="M1 1v14" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>',
  };

  function updateNeedleBtn() {
    if (!needleBtn) return;
    const spread = _needleMode === 'spread';
    needleBtn.innerHTML = NEEDLE_ICONS[_needleMode];
    needleBtn.classList.toggle('active', spread);
    needleBtn.title = spread ? '바늘: 펼침 (누르면 한 줄로 겹침)' : '바늘: 겹침 (누르면 채널별로 펼침)';
  }

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
      plugins: [plotBgPlugin, needlePlugin, crosshairPlugin],
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
                  `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
                  `${p(d.getMonth() + 1)}/${p(d.getDate())}`,
                ];
              },
            },
            grid:   { color: 'rgba(148,163,184,0.07)', drawTicks: false },
            border: { color: 'rgba(148,163,184,0.25)' },
          },
          // 바늘 공간: 그래프 바로 오른쪽의 눈금 없는 축(weight 0 = 그래프에 가장 가까움)
          needle: {
            type: 'linear', position: 'right', weight: 0,
            grid:   { display: false, drawOnChartArea: false },
            ticks:  { display: false },
            border: { color: 'rgba(170,190,215,0.35)' },     // 그래프 오른쪽 경계(눈금자 기준선)
            afterFit: (scale) => { scale.width = _needleAnim.space ?? needleSpacePx(); },
          },
          // 값 축: 숫자 앞 눈금(-)은 숨김. 펼침 모드의 세로선 + 눈금(├)은 바늘 플러그인이
          // 그린다(전환 때 서서히 나타나게). 숫자 여백은 두 모드 같게 — 전환 때 숫자가 안 움직임
          y: {
            position: 'right', weight: 1,
            ticks:  { color: '#8fa0b7', padding: 10 },
            grid:   { color: 'rgba(148,163,184,0.12)', drawTicks: false },
            border: { display: false, dash: [2, 4] },
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
    renderViewFromMemory(from, to);
    startLive();
  });

  if (prevBtn)    prevBtn.addEventListener('click',    () => shiftView(-1));
  if (nextBtn)    nextBtn.addEventListener('click',    () => shiftView(1));
  if (zoomInBtn)  zoomInBtn.addEventListener('click',  () => zoomView(ZOOM_IN_FACTOR));
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoomView(ZOOM_OUT_FACTOR));
  if (rangeSelectBtn) rangeSelectBtn.addEventListener('click', toggleRangeSelect);
  if (fitAllBtn)       fitAllBtn.addEventListener('click', toggleFitAll);
  updateNeedleBtn();
  if (needleBtn) needleBtn.addEventListener('click', () => {
    _needleMode = _needleMode === 'spread' ? 'overlap' : 'spread';
    try { localStorage.setItem(NEEDLE_KEY, _needleMode); } catch (_) {}
    updateNeedleBtn();
    applyNeedleLayout();
  });

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
  // 정리하지 않는다. main.js가 loadPage()를 다시 호출할 때마다(실제 메뉴 이동뿐
  // 아니라 언어 전환으로 같은 페이지를 재로드하는 경우 포함) 'spa:beforeload'를
  // 발생시키므로, 그 시점에 무조건 정리한다 — realtime.js와 동일한 패턴.
  function onBeforeLoad() {
    _destroyed = true;
    if (_statusTimer) { clearTimeout(_statusTimer); _statusTimer = null; }
    if (_diskTimer)   { clearInterval(_diskTimer);   _diskTimer = null; }
    stopLive();
    window.removeEventListener('spa:beforeload', onBeforeLoad);
  }
  window.addEventListener('spa:beforeload', onBeforeLoad);

  PageLoader.show();
  init()
    .then(() => PageLoader.hide(null))
    .catch((err) => {
      console.error('파일 트렌드 초기화 오류:', err);
      PageLoader.showError('파일 트렌드를 불러올 수 없습니다.');
    });

})();
