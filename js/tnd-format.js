// ── .tnd 트렌드 파일 바이너리 포맷 공용 파서 ──────────────────────────────────
// dashboard.js(트렌드 위젯)와 trends.js(트렌드 기록 페이지)가 공유한다.
// 파일 레이아웃 사양: referencs/TrendHandler/file_based_plan.md 참고.
const TndFormat = (() => {
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

  // buf: /api/tfile/header 응답(512 bytes ArrayBuffer)
  function parseHeader(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    if (buf.byteLength < 512) throw new Error('Header too short');
    if (u8[0] !== 0x53 || u8[1] !== 0x57) throw new Error('Invalid magic');

    const chCnt     = u8[5];
    const startTime = stimeToUnix(u8, 6);
    const freq      = dv.getUint16(12, true);
    const channels  = [];

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

  // buf: /api/tfile/sample 응답(N*32 bytes ArrayBuffer)
  // fromSec/toSec: 요청한 범위(unix sec). step: 서버에 보낸 step(서버가 내부적으로
  // 올렸을 수 있어 nRec으로부터 실제 step을 역산). header: parseHeader() 결과.
  function parseSample(buf, fromSec, toSec, step, header) {
    if (!header || buf.byteLength < 32) return [];
    const dv   = new DataView(buf);
    const nRec = Math.floor(buf.byteLength / 32);
    const riStart = Math.max(0, Math.floor((fromSec - header.startTime) / header.freq));
    const riEnd   = Math.floor((toSec - header.startTime) / header.freq);
    const actualStep = nRec > 1
      ? Math.max(step, Math.round((riEnd - riStart) / (nRec - 1)))
      : step;
    const pts = [];
    for (let i = 0; i < nRec; i++) {
      const ri = riStart + i * actualStep;
      const ts = header.startTime + ri * header.freq;
      const vals = new Array(16);
      for (let ch = 0; ch < 16; ch++) {
        vals[ch] = dv.getUint16(i * 32 + ch * 2, true);
      }
      pts.push({ ts, vals });
    }
    return pts;
  }

  function rawToValue(raw, isSigned, dotpos) {
    const v = (isSigned && raw > 32767) ? raw - 65536 : raw;
    return v / Math.pow(10, dotpos);
  }

  // 채널 색상 팔레트 — 트렌드 관련 화면(대시보드 위젯, 트렌드 기록 페이지)에서 공용.
  const PALETTE = [
    '#4da0ff', '#4cd96b', '#ffd84a', '#ff6b6b', '#c77dff',
    '#ff9a3c', '#00d4aa', '#ff5d8f', '#7bcfff', '#a8ff78',
    '#ffb347', '#87ceeb', '#dda0dd', '#98fb98', '#f0e68c', '#ff7f50',
  ];

  return { parseHeader, parseSample, rawToValue, PALETTE };
})();
