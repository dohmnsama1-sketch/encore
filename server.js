require('./src/env').loadEnv();
const http = require('http'); const fs = require('fs'); const path = require('path');
const { Qloo } = require('./src/qloo'); const { StubQloo } = require('./src/stub'); const director = require('./src/director'); const { enabled } = require('./src/llm');
const PORT = Number(process.env.PORT || 8790);
const live = !!process.env.QLOO_API_KEY;
const makeQloo = () => live ? new Qloo({ apiKey: process.env.QLOO_API_KEY, baseUrl: process.env.QLOO_BASE_URL }) : new StubQloo();
const shared = live ? makeQloo() : null; // shared private cache across requests
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const hits = new Map(); // tiny per-IP rate limit to protect the API key
const send = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = req => new Promise((ok, bad) => { let d = ''; req.on('data', c => d += c); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { bad(e); } }); });
async function route(req, res) {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  if (p === '/api/status') return send(res, 200, { qloo: live ? 'live' : 'sample', llm: enabled() });
  if (p === '/api/plan' && req.method === 'POST') {
    const ip = req.socket.remoteAddress; const now = Date.now(); const h = (hits.get(ip) || []).filter(t => now - t < 60e3);
    if (h.length >= 8) return send(res, 429, { error: 'Slow down: max 8 plans per minute' }); h.push(now); hits.set(ip, h);
    const b = await body(req); const steps = [];
    const q = shared || makeQloo(); const before = q.calls;
    const out = await director.run({ qloo: q, venueQuery: String(b.venue || '').slice(0, 80), city: String(b.city || '').slice(0, 60), goal: String(b.goal || '').slice(0, 200), weeks: Math.min(6, Math.max(1, Number(b.weeks) || 4)), onStep: s => steps.push(s) });
    return send(res, 200, { ...out, steps, mode: live ? 'live' : 'sample', qlooCalls: q.calls - before });
  }
  const f = path.join(__dirname, 'public', p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (f.startsWith(path.join(__dirname, 'public')) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res); }
  send(res, 404, { error: 'not found' });
}
const server = http.createServer((q, r) => route(q, r).catch(e => send(r, 400, { error: e.message })));
if (require.main === module) server.listen(PORT, () => console.log(`Encore on :${PORT} (Qloo: ${live ? 'live' : 'SAMPLE'}; LLM: ${enabled()})`));
module.exports = { server };
