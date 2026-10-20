// WHMI 위젯 속성 정의(편집기 속성 창용) — 디자인 모드에서 편집기와 함께만 로드된다.
// 기본값은 여기 두지 않고 위젯 구현(whmi-widgets.js의 defaults)을 그대로 쓴다.
//
// 필드: { key, label, type, group, min?, max?, step?, options?, placeholder?, when?(p) }
//   type  text     글자(비우면 기본값)
//         opttext  글자, 비우면 없음(null 기본값)
//         num      숫자(비우면 기본값)
//         optnum   숫자, 비우면 자동/없음(null 기본값)
//         color    색(#RRGGBB)
//         optcolor 색, 비우면 없음(null 기본값)
//         bool     체크
//         select   선택(options: [[값, 표시]])
//         screen   화면 선택(프로젝트 화면 목록)
//         value    쓰기/판정 값 — true / false / 숫자 / 글자
//         bits     비트 고르기(0~15 격자, 여러 개 = 하나라도 켜지면) — 하나면 숫자, 여러 개면 목록으로 저장
//         image    그림 파일 고르기(줄여서 data URL로 src에, 원래 비율은 ratio에) — 여러 개 편집에선 빠짐
//         enable   쓰기 허용 조건(위젯 필드 enableWhen: { tag, equals }) — props가 아님
//         anim     애니메이션 — "사용" 체크 + 시간(ms). 끄면 0(위젯은 0이면 바로 그림)
//         list     객체 목록(행 추가/삭제). columns: [{ key, label, type: num|text|color|value|bool, required? }],
//                  newRow(현재 목록, 지금 속성) → 새 행. 비우면 기본값
//                  칸: type num|text|color|value|bool|select(options), width?(격자 폭), when?(p) — 거짓이면 그 칸 숨김
//                  warn(현재 목록) → 주의 문구(저장은 막지 않음) 또는 ''
//   when  현재 속성(p, 기본값 포함)을 받아 false면 숨김
//   id    같은 속성(key)을 조건(when)에 따라 다른 칸으로 보여 줄 때 칸을 구분하는 이름(예: 램프 켜짐 값 / 켜짐 조건)
//   numeric(select) 고른 값을 숫자로 저장, nullAs(select) 값이 없을 때 보일 항목
(function () {
  'use strict';

  // 속성 창에 보이는 그룹 순서
  const GROUPS = [
    ['basic', '기본'],
    ['scale', '눈금'],
    ['value', '값'],
    ['color', '색상'],
    ['action', '동작'],
    ['effect', '효과'],
  ];

  const hasBits = (p) => p.bit != null && [].concat(p.bit).length > 0;
  const fontSize = { key: 'fontSize', label: '글자 크기', type: 'num', group: 'basic', min: 6, max: 200 };
  const confirm  = { key: 'confirm', label: '확인 문구', type: 'opttext', group: 'action', placeholder: '없음' };
  // 켜고 끄는 위젯: 켤 때 / 끌 때 문구를 따로(끌 때 문구가 비면 켤 때 문구를 양쪽에 — 예전 동작)
  const confirmOn  = { key: 'confirm', id: 'confirmOn', label: '켤 때 확인 문구', type: 'opttext', group: 'action', placeholder: '없음' };
  const confirmOff = { key: 'confirmOff', label: '끌 때 확인 문구', type: 'opttext', group: 'action', placeholder: '켤 때 문구와 같음' };
  const animMs   = { key: 'animMs', label: '값 변화 애니메이션', type: 'anim', group: 'effect', min: 50, max: 5000, step: 50 };
  const angle    = (key, label) => ({ key, label, type: 'num', group: 'basic', min: -360, max: 360 });

  // 값 구간별 색 — 앞에서부터 처음 맞는 구간을 쓴다(from/to 비우면 끝없음)
  // 새 행: 앞 구간이 끝나는 곳부터. 앞 구간이 위로 끝없으면 그 아래 구간(…~앞 구간 시작)
  const rangeRow = (rows) => {
    const p = rows[rows.length - 1];
    const r = !p ? { from: 0 } : p.to != null ? { from: p.to } : p.from != null ? { to: p.from } : {};
    return { ...r, color: '#e5534b' };
  };
  // 앞 구간이 위로 끝없고 시작도 같거나 낮으면 뒤 구간은 절대 맞지 않는다(처음 맞는 구간만 쓰므로)
  const rangeWarn = (rows) => {
    const k = rows.findIndex((r, i) => rows.slice(0, i).some((p) =>
      p.to == null && (p.from == null || (r.from != null && r.from >= p.from))));
    return k < 0 ? '' : `${k + 1}번째 구간은 앞 구간에 가려 쓰이지 않습니다. 앞 구간의 "까지"를 채우세요.`;
  };
  const ranges = {
    key: 'ranges', label: '구간 색', type: 'list', group: 'value',
    columns: [{ key: 'from', label: '부터', type: 'num' }, { key: 'to', label: '까지', type: 'num' }, { key: 'color', label: '색', type: 'color', required: true }],
    newRow: rangeRow, warn: rangeWarn,
  };

  const TYPES = {
    label: [
      { key: 'preset', label: '스타일', type: 'select', group: 'basic', options: [['', '기본'], ['title', '제목'], ['subtitle', '소제목'], ['caption', '설명'], ['info', '정보'], ['caution', '주의'], ['danger', '경고'], ['neon', '네온']] },
      { key: 'text', label: '글자', type: 'text', group: 'basic' },
      fontSize,
      { key: 'bold', label: '굵게', type: 'bool', group: 'basic' },
      { key: 'italic', label: '기울임', type: 'bool', group: 'basic' },
      { key: 'align', label: '정렬', type: 'select', group: 'basic', options: [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']] },
      { key: 'padding', label: '안쪽 여백', type: 'num', group: 'basic', min: 0, max: 200 },
      { key: 'color', label: '글자색', type: 'color', group: 'color' },
      { key: 'bg', label: '배경색', type: 'optcolor', group: 'color', placeholder: '없음' },
      { key: 'border', label: '테두리색', type: 'optcolor', group: 'color', placeholder: '없음' },
      { key: 'radius', label: '모서리 둥글기', type: 'num', group: 'color', min: 0, max: 500, when: (p) => p.bg || p.border },
      { key: 'glow', label: '글자 발광', type: 'bool', group: 'effect' },
      { key: 'shadow', label: '글자 그림자', type: 'bool', group: 'effect' },
    ],
    image: [
      { key: 'src', label: '이미지', type: 'image', group: 'basic' },
      { key: 'fit', label: '크기 맞춤', type: 'select', group: 'basic', options: [['ratio', '비율 고정'], ['stretch', '상자에 맞춤']] },
      { key: 'radius', label: '모서리 둥글기', type: 'num', group: 'basic', min: 0, max: 500 },
      { key: 'opacity', label: '투명도(0~1)', type: 'num', group: 'effect', min: 0, max: 1, step: 0.05 },
    ],
    rect: [
      { key: 'radius', label: '모서리 둥글기', type: 'num', group: 'basic', min: 0, max: 500 },
      { key: 'strokeWidth', label: '테두리 두께', type: 'num', group: 'basic', min: 0, max: 50 },
      { key: 'fill', label: '채움색', type: 'color', group: 'color' },
      { key: 'stroke', label: '테두리색', type: 'color', group: 'color' },
    ],
    status: [
      { key: 'mode', label: '판정 방식', type: 'select', group: 'basic', options: [['value', '값 일치'], ['bit', '비트']] },
      fontSize,
      { key: 'bold', label: '굵게', type: 'bool', group: 'basic' },
      { key: 'align', label: '정렬', type: 'select', group: 'basic', options: [['center', '가운데'], ['left', '왼쪽'], ['right', '오른쪽']] },
      { key: 'padding', label: '안쪽 여백', type: 'num', group: 'basic', min: 0, max: 200, when: (p) => p.align !== 'center' },
      { key: 'radius', label: '모서리 둥글기', type: 'num', group: 'basic', min: 0, max: 200 },
      { key: 'states', label: '상태 목록 (위에서부터 처음 맞는 줄)', type: 'list', group: 'value',
        columns: [
          { key: 'value', label: '값', type: 'value', required: true, when: (p) => p.mode !== 'bit' },
          { key: 'bit', label: '비트', type: 'select', required: true, options: Array.from({ length: 16 }, (_, i) => [i, String(i)]), when: (p) => p.mode === 'bit' },
          { key: 'text', label: '글자', type: 'text', width: '1.8fr' },
          { key: 'color', label: '글자색', type: 'color' },
          { key: 'bg', label: '배경색', type: 'color' },
          { key: 'blink', label: '깜빡', type: 'bool' },
        ],
        newRow: (rows, p) => {
          const next = (k) => rows.reduce((m, r) => (typeof r[k] === 'number' ? Math.max(m, r[k] + 1) : m), 0);
          return Object.assign(p.mode === 'bit' ? { bit: Math.min(15, next('bit')) } : { value: next('value') }, { text: '상태', color: '#ffffff', bg: '#2d6cdf' });
        } },
      { key: 'noneText', label: '해당 없음 글자', type: 'text', group: 'value' },
      { key: 'noneColor', label: '해당 없음 글자색', type: 'color', group: 'color' },
      { key: 'noneBg', label: '해당 없음 배경색', type: 'color', group: 'color' },
      { key: 'border', label: '테두리색', type: 'color', group: 'color' },
    ],
    lamp: [
      { key: 'preset', label: '스타일', type: 'select', group: 'basic', options: [['', '기본'], ['warning', '경고'], ['error', '오류'], ['info', '정보'], ['ok', '확인'], ['alarm', '경보창']] },
      { key: 'shape', label: '모양', type: 'select', group: 'basic', options: [['circle', '원형'], ['square', '사각'], ['warning', '경고 (삼각형 !)'], ['error', '오류 (원 ×)'], ['info', '정보 (원 i)'], ['ok', '확인 (원 체크)'], ['panel', '알림창 (상자 전체)']] },
      { key: 'text', label: '글자', type: 'text', group: 'basic' },
      fontSize,
      { key: 'blink', label: '켜지면 깜빡임', type: 'bool', group: 'basic' },
      { key: 'onColor', label: '켜짐 색', type: 'color', group: 'color' },
      { key: 'offColor', label: '꺼짐 색', type: 'color', group: 'color' },
      { key: 'textColor', label: '글자색', type: 'color', group: 'color' },
      { key: 'bit', label: '비트', type: 'bits', group: 'value' },
      // 켜짐 값: 비트를 쓰면 0/1만 의미가 있으므로 선택 상자로(같은 속성 onValue, 칸 id만 다름)
      { key: 'onValue', label: '켜짐 값', type: 'value', group: 'value', placeholder: '값이 참이면 켜짐', when: (p) => !hasBits(p) },
      { key: 'onValue', id: 'onValueBit', label: '켜짐 조건', type: 'select', group: 'value', numeric: true, nullAs: '1',
        options: [['1', '비트 = 1일 때'], ['0', '비트 = 0일 때']], when: hasBits },
    ],
    screenlink: [
      { key: 'screen', label: '이동할 화면', type: 'screen', group: 'basic' },
      { key: 'text', label: '글자', type: 'text', group: 'basic' },
      fontSize,
      { key: 'color', label: '버튼색', type: 'color', group: 'color' },
      { key: 'textColor', label: '글자색', type: 'color', group: 'color' },
    ],
    switch: [
      { key: 'onText', label: '켜짐 글자', type: 'text', group: 'basic' },
      { key: 'offText', label: '꺼짐 글자', type: 'text', group: 'basic' },
      { key: 'onColor', label: '켜짐 색', type: 'color', group: 'color' },
      { key: 'offColor', label: '꺼짐 색', type: 'color', group: 'color' },
      { key: 'onValue', label: '켜짐 값', type: 'value', group: 'value' },
      { key: 'offValue', label: '꺼짐 값', type: 'value', group: 'value' },
      confirmOn,
      confirmOff,
    ],
    // 무엇을 쓰는지가 가장 중요하므로 맨 위에. "켜짐 표시 기준 값"은 쓰는 값이 아니라 색·글자를 바꿀 기준
    button: [
      { key: 'action', label: '누르면', type: 'select', group: 'basic', options: [['set', '값 쓰기'], ['toggle', '켜짐/꺼짐 전환']] },
      { key: 'value', label: '쓸 값', type: 'value', group: 'basic', placeholder: '꼭 입력하세요 (예: 1)', when: (p) => p.action !== 'toggle' },
      { key: 'onValue', id: 'onValueToggle', label: '켜짐 값 (켜짐으로 쓸 값)', type: 'value', group: 'basic', when: (p) => p.action === 'toggle' },
      { key: 'offValue', label: '꺼짐 값 (꺼짐으로 쓸 값)', type: 'value', group: 'basic', when: (p) => p.action === 'toggle' },
      { key: 'text', label: '글자', type: 'text', group: 'basic' },
      { key: 'onText', label: '켜짐일 때 글자', type: 'opttext', group: 'basic', placeholder: '글자와 같음' },
      { key: 'offText', label: '꺼짐일 때 글자', type: 'opttext', group: 'basic', placeholder: '글자와 같음' },
      fontSize,
      { key: 'color', label: '버튼색', type: 'color', group: 'color' },
      { key: 'activeColor', label: '켜짐일 때 색', type: 'optcolor', group: 'color', placeholder: '버튼색과 같음' },
      { key: 'textColor', label: '글자색', type: 'color', group: 'color' },
      // 값 쓰기 버튼에서 켜짐 글자·색을 쓸 때만 — 현재 값이 이 값이면 "켜짐"으로 표시
      { key: 'onValue', label: '켜짐 표시 기준 값', type: 'value', group: 'value',
        when: (p) => p.action !== 'toggle' && (p.onText != null || p.offText != null || p.activeColor != null) },
      { ...confirm, when: (p) => p.action !== 'toggle' },
      { ...confirmOn, when: (p) => p.action === 'toggle' },
      { ...confirmOff, when: (p) => p.action === 'toggle' },
    ],
  };

  TYPES.gauge = [
    { key: 'title', label: '제목', type: 'text', group: 'basic' },
    { key: 'thickness', label: '호 두께', type: 'optnum', group: 'basic', min: 1, max: 200 },
    { key: 'lineCap', label: '호 끝 모양', type: 'select', group: 'basic', options: [['butt', '각진 끝'], ['round', '둥근 끝']] },
    angle('startAngle', '시작 각도'),
    angle('endAngle', '끝 각도'),
    ranges,
    { key: 'arcColor', label: '값 색', type: 'color', group: 'color' },
    { key: 'trackColor', label: '바탕 색', type: 'color', group: 'color' },
    animMs,
  ];

  TYPES.tank = [
    { key: 'showValue', label: '값 표시', type: 'bool', group: 'basic' },
    { key: 'showScale', label: '눈금 표시', type: 'bool', group: 'scale' },
    { key: 'ticks', label: '눈금 개수', type: 'num', group: 'scale', min: 2, max: 20, when: (p) => p.showScale },
    ranges,
    { key: 'fillColor', label: '채움색', type: 'color', group: 'color' },
    { key: 'bgColor', label: '바탕색', type: 'color', group: 'color' },
    { key: 'shellColor', label: '외곽색', type: 'color', group: 'color' },
  ];

  TYPES.bar = [
    { key: 'preset', label: '스타일', type: 'select', group: 'basic', options: [['', '기본'], ['meter', '계기'], ['traffic', '신호등'], ['led', 'LED 세그먼트'], ['neon', '네온'], ['slim', '슬림'], ['blue', '블루 계기'], ['heat', '열 세그먼트']] },
    { key: 'orientation', label: '방향', type: 'select', group: 'basic', options: [['v', '세로'], ['h', '가로']] },
    { key: 'thickness', label: '막대 두께', type: 'optnum', group: 'basic', min: 1, max: 500 },
    { key: 'radius', label: '모서리 둥글기', type: 'num', group: 'basic', min: 0, max: 100 },
    { key: 'segments', label: '세그먼트 칸 수(0=끔)', type: 'num', group: 'basic', min: 0, max: 100 },
    { key: 'segmentGap', label: '칸 간격', type: 'num', group: 'basic', min: 0, max: 20, when: (p) => p.segments >= 2 },
    { key: 'showScale', label: '눈금 표시', type: 'bool', group: 'scale' },
    { key: 'ticks', label: '눈금 개수', type: 'num', group: 'scale', min: 2, max: 20, when: (p) => p.showScale },
    { key: 'minorTicks', label: '보조 눈금(사이 개수)', type: 'num', group: 'scale', min: 0, max: 9, when: (p) => p.showScale },
    { key: 'tickLabels', label: '눈금 숫자', type: 'bool', group: 'scale', when: (p) => p.showScale },
    { key: 'showMinMax', label: '최소·최대 숫자', type: 'bool', group: 'scale' },
    { key: 'showRanges', label: '구간 색 띠', type: 'bool', group: 'scale' },
    { key: 'scalePosition', label: '눈금 위치', type: 'select', group: 'scale', options: [['after', '아래 / 오른쪽'], ['before', '위 / 왼쪽']],
      when: (p) => p.showScale || p.showMinMax || p.showRanges || p.origin != null },
    { key: 'fontSize', label: '눈금 글자 크기', type: 'num', group: 'scale', min: 6, max: 40 },
    { key: 'showValue', label: '값 표시', type: 'bool', group: 'value' },
    { key: 'valueAlign', label: '값 위치', type: 'select', group: 'value', options: [['start', '시작(왼쪽 / 아래)'], ['center', '가운데'], ['end', '끝(오른쪽 / 위)'], ['follow', '막대 끝 따라가기']], when: (p) => p.showValue },
    { key: 'origin', label: '채우기 기준값', type: 'optnum', group: 'value', step: 'any', placeholder: '최소값부터' },
    ranges,
    { key: 'markers', label: '기준선', type: 'list', group: 'value',
      columns: [{ key: 'value', label: '값', type: 'num', required: true }, { key: 'color', label: '색', type: 'color' }],
      newRow: () => ({ value: 0, color: '#e6e9ef' }) },
    { key: 'gradient', label: '그라데이션(구간 색보다 우선)', type: 'list', group: 'value',
      columns: [{ key: 'at', label: '값', type: 'num', required: true }, { key: 'color', label: '색', type: 'color', required: true }],
      newRow: (rows) => ({ at: rows.length ? (rows[rows.length - 1].at ?? 0) + 50 : 0, color: rows.length ? '#e5534b' : '#2ecc71' }) },
    { key: 'colorRamp', label: '색 띠(범위 전체)', type: 'select', group: 'color', options: [['', '없음(채움색)'], ['traffic', '신호등'], ['blue', '파랑'], ['heat', '열']] },
    { key: 'fillColor', label: '채움색', type: 'color', group: 'color', when: (p) => !p.colorRamp },
    { key: 'bgColor', label: '바탕색', type: 'color', group: 'color' },
    { key: 'border', label: '테두리색', type: 'color', group: 'color' },
    { key: 'tickColor', label: '눈금색', type: 'color', group: 'color' },
    { key: 'labelColor', label: '눈금 글자색', type: 'color', group: 'color' },
    { key: 'shade', label: '음영(입체감)', type: 'bool', group: 'effect' },
    { key: 'glow', label: '채움 발광', type: 'bool', group: 'effect' },
    animMs,
  ];

  TYPES.selector = [
    { key: 'options', label: '위치', type: 'list', group: 'basic',
      columns: [{ key: 'value', label: '값', type: 'value', required: true }, { key: 'text', label: '글자', type: 'text' }],
      newRow: (rows) => ({ value: rows.length, text: `위치 ${rows.length + 1}` }) },
    angle('startAngle', '시작 각도'),
    angle('endAngle', '끝 각도'),
    { key: 'fontSize', label: '글자 크기', type: 'num', group: 'basic', min: 6, max: 60 },
    { key: 'ringColor', label: '링 색', type: 'color', group: 'color' },
    { key: 'knobColor', label: '노브 색', type: 'color', group: 'color' },
    { key: 'handleColor', label: '손잡이 색', type: 'color', group: 'color' },
    { key: 'labelColor', label: '글자색', type: 'color', group: 'color' },
    { key: 'activeColor', label: '선택된 글자색', type: 'color', group: 'color' },
    confirm,
    animMs,
  ];

  // ── 태그 값 덮어쓰기(값 위젯 공통) — 비우면 태그 정의 값 사용
  const valueOverride = [
    { key: 'min', label: '최소값', type: 'optnum', group: 'value', step: 'any', placeholder: '태그 값 사용' },
    { key: 'max', label: '최대값', type: 'optnum', group: 'value', step: 'any', placeholder: '태그 값 사용' },
    { key: 'unit', label: '단위', type: 'opttext', group: 'value', placeholder: '태그 값 사용' },
    { key: 'decimals', label: '소수점 자리', type: 'optnum', group: 'value', min: 0, max: 6, placeholder: '태그 값 사용' },
  ];
  // 쓰기 위젯 공통 — 다른 태그 값이 조건과 같을 때만 쓰기 허용
  const enableWhen = { key: 'enableWhen', label: '쓰기 허용 조건', type: 'enable', group: 'action' };

  // ── 숫자 표시 / 숫자 입력 상자 공통
  const seg = (p) => p.font === 'seg7';
  const box = [
    { key: 'preset', label: '스타일', type: 'select', group: 'basic', options: [['', '기본'], ['led', 'LED'], ['lcd', 'LCD'], ['vfd', 'VFD']] },
    { key: 'caption', label: '이름표', type: 'text', group: 'basic' },
    { key: 'font', label: '글꼴', type: 'select', group: 'basic', options: [['mono', '고정폭'], ['seg7', '7세그먼트'], ['sans', '일반']] },
    { key: 'fontSize', label: '글자 크기', type: 'optnum', group: 'basic', min: 6, max: 300 },
    { key: 'italic', label: '기울임', type: 'bool', group: 'basic' },
    { key: 'align', label: '정렬', type: 'select', group: 'basic', options: [['end', '오른쪽'], ['center', '가운데'], ['start', '왼쪽']] },
    { key: 'padding', label: '안쪽 여백', type: 'num', group: 'basic', min: 0, max: 200 },
    { key: 'radius', label: '모서리 둥글기', type: 'num', group: 'basic', min: 0, max: 100 },
    { key: 'borderWidth', label: '테두리 두께', type: 'num', group: 'basic', min: 0, max: 20, step: 0.5 },
    ...valueOverride,
    { key: 'showUnit', label: '단위 표시', type: 'bool', group: 'value' },
    { key: 'unitAlign', label: '단위 맞춤', type: 'select', group: 'value', options: [['bottom', '하단'], ['middle', '중간'], ['top', '상단']], when: (p) => p.showUnit },
    { key: 'color', label: '숫자색', type: 'color', group: 'color' },
    { key: 'bg', label: '배경색', type: 'color', group: 'color' },
    { key: 'border', label: '테두리색', type: 'color', group: 'color' },
    { key: 'unitColor', label: '단위색', type: 'optcolor', group: 'color', placeholder: '기본', when: (p) => p.showUnit },
    { key: 'captionColor', label: '이름표 색', type: 'color', group: 'color', when: (p) => !!p.caption },
    { key: 'ghost', label: '꺼진 세그먼트 잔상', type: 'bool', group: 'effect', when: seg },
    { key: 'ghostOpacity', label: '잔상 진하기(0~1)', type: 'num', group: 'effect', min: 0, max: 1, step: 0.01, when: (p) => seg(p) && p.ghost },
    { key: 'glow', label: '숫자 발광', type: 'bool', group: 'effect' },
    { key: 'bevel', label: '안쪽 입체감', type: 'bool', group: 'effect' },
    { key: 'glass', label: '유리 반사', type: 'bool', group: 'effect' },
  ];

  TYPES.numeric = [
    ...box,
    { key: 'ranges', label: '구간 색', type: 'list', group: 'value',
      columns: [{ key: 'from', label: '부터', type: 'num' }, { key: 'to', label: '까지', type: 'num' }, { key: 'color', label: '색', type: 'color', required: true }, { key: 'blink', label: '깜빡', type: 'bool' }],
      newRow: rangeRow, warn: rangeWarn },
    { key: 'rangeTarget', label: '구간 색 적용', type: 'select', group: 'value', options: [['text', '숫자'], ['bg', '배경'], ['border', '테두리']], when: (p) => p.ranges && p.ranges.length },
    { key: 'flashOnChange', label: '값이 바뀌면 반짝임', type: 'bool', group: 'effect' },
    { key: 'showTrend', label: '증감 표시(▲▼)', type: 'bool', group: 'effect' },
    animMs,
  ];

  TYPES.input = [...box, confirm, enableWhen];

  // 값 위젯·쓰기 위젯에 공통 항목 추가
  for (const t of ['gauge', 'tank', 'bar']) TYPES[t].unshift(...valueOverride);
  for (const t of ['button', 'switch', 'selector']) TYPES[t].push(enableWhen);

  if (window.WHMI) window.WHMI.schema = { groups: GROUPS, types: TYPES };   // 페이지를 떠나며 정리됐으면 건너뜀
})();
