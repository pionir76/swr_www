// WHMI 개발용 서버: web/ 정적 파일 + 라우터 값 API 모의(mock)
//   node tools/devserver.js [port]
// 실제 라우터 펌웨어가 구현해야 할 API 규격의 참조 구현이기도 함 (docs/DESIGN.md §5).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8080;
const WEB = path.join(__dirname, '..', 'web');
const TAGS = JSON.parse(fs.readFileSync(path.join(WEB, 'project', 'tags.json'), 'utf8')).tags;
const tagById = Object.fromEntries(TAGS.map((t) => [t.id, t]));

// ---- 값 시뮬레이션 ---------------------------------------------------------
const state = {};
for (const t of TAGS) {
  state[t.id] = t.type === 'bool' ? false : +(t.min + (t.max - t.min) * (0.3 + Math.random() * 0.4)).toFixed(t.decimals || 0);
}
state.LEVEL_SP = 70;

// 데모용 연동 규칙 (실제 장치에서는 PLC 로직이 담당)
function tick() {
  state.PUMP1_RUN = state.PUMP1_CMD;
  state.PUMP2_RUN = state.PUMP2_CMD;
  for (const t of TAGS) {
    if (t.type !== 'number' || t.access === 'rw') continue;
    const span = t.max - t.min;
    let v = state[t.id] + (Math.random() - 0.5) * span * 0.03;
    if (t.id === 'MOTOR_RPM') v = state.PUMP1_RUN ? v + (1450 - v) * 0.15 : v * 0.7;
    if (t.id === 'TK1_LEVEL') v += (state.PUMP1_RUN ? -0.6 : 0.4) + (state.PUMP2_RUN ? -0.4 : 0);
    if (t.id === 'FLOW_RATE') v += ((state.PUMP1_RUN ? 120 : 0) + (state.PUMP2_RUN ? 80 : 0) - v) * 0.1;
    state[t.id] = +Math.min(t.max, Math.max(t.min, v)).toFixed(t.decimals || 0);
  }
  state.ALARM_HI = state.TK1_LEVEL >= 90;
}
setInterval(tick, 500);

// ---- API ------------------------------------------------------------------
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readValues(url, res) {
  const ids = (url.searchParams.get('tags') || '').split(',').filter(Boolean);
  const values = {};
  for (const id of ids) values[id] = tagById[id] ? { v: state[id], q: 'good' } : { v: null, q: 'bad' };
  json(res, 200, { ts: Date.now(), values });
}

function writeValue(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
  req.on('end', () => {
    let msg;
    try { msg = JSON.parse(body); } catch { return json(res, 400, { error: 'invalid json' }); }
    const t = tagById[msg.tag];
    if (!t) return json(res, 404, { error: 'unknown tag' });
    if (t.access !== 'rw') return json(res, 403, { error: 'read-only tag' });
    // 서버측 검증: 클라이언트 검증만 믿지 않는다
    if (t.type === 'bool') {
      if (typeof msg.v !== 'boolean') return json(res, 400, { error: 'bool expected' });
    } else if (typeof msg.v !== 'number' || !Number.isFinite(msg.v) || msg.v < t.min || msg.v > t.max) {
      return json(res, 400, { error: `number in ${t.min}..${t.max} expected` });
    }
    state[t.id] = msg.v;
    console.log(`[write] ${t.id} = ${msg.v}`);
    tick();
    json(res, 200, { ok: true });
  });
}

// ---- 정적 파일 --------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveStatic(url, res) {
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/values') return readValues(url, res);
  if (req.method === 'POST' && url.pathname === '/api/write') return writeValue(req, res);
  if (req.method === 'GET') return serveStatic(url, res);
  res.writeHead(405); res.end();
}).listen(PORT, () => console.log(`WHMI dev server: http://localhost:${PORT}/`));
