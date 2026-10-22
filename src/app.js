'use strict';
// HTTP API shared by the local server (server.js) and the Vercel function (api/index.js).
const { Qloo } = require('./qloo'); const { StubQloo } = require('./stub');
const agent = require('./agent'); const T = require('./tools'); const mcp = require('./mcp'); const llm = require('./llm');
const pkg = require('../package.json');

const live = () => !!process.env.QLOO_API_KEY;
function makeQloo() { return live() ? new Qloo({ apiKey: process.env.QLOO_API_KEY, baseUrl: process.env.QLOO_BASE_URL, perSecond: Number(process.env.QLOO_RPS) || 7 }) : new StubQloo(); }
let shared = null; const qlooFor = () => (shared = shared || makeQloo()); // one client per instance = one private cache + one rate limiter

// Per-IP sliding-window limit protects the shared API key (50k calls/month, 10/s).
const hits = new Map();
function limited(ip, max, windowMs = 60e3) {
  const now = Date.now(); const h = (hits.get(ip) || []).filter(t => now - t < windowMs);
  if (h.length >= max) return true; h.push(now); hits.set(ip, h);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
  return false;
}
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();

function send(res, code, obj, extra = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(JSON.stringify(obj));
}
async function readBody(req, limit = 16e3) {
  if (req.body && typeof req.body === 'object') return req.body;            // Vercel pre-parses JSON
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  return new Promise((ok, bad) => { let d = ''; req.on('data', c => { d += c; if (d.length > limit) { bad(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch { bad(Object.assign(new Error('Invalid JSON'), { status: 400 })); } }); req.on('error', bad); });
}
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function planArgs(b) {
  const nights = Array.isArray(b.nights) ? b.nights.map(String).filter(d => DAYS.includes(d)).slice(0, 4) : undefined;
  return { venue: str(b.venue, 100), city: str(b.city, 60), goal: str(b.goal, 200), idea: str(b.idea, 60), nights: nights && nights.length ? nights : undefined, weeks: Math.min(6, Math.max(1, Number(b.weeks) || 4)) };
}
const friendly = e => e.status === 429 ? 'Qloo is busy right now — try again in a few seconds.' : e.message;

async function handle(req, res) {
  const u = new URL(req.url, 'http://x'); const p = u.pathname.replace(/\/+$/, '') || '/';
  const oidc = req.headers['x-vercel-oidc-token'];
  const env = process.env;
  try {
    if (p === '/api/status' || p === '/api/health') {
      const q = qlooFor(); const c = llm.status(env, oidc);
      return send(res, 200, { ok: true, version: pkg.version, qloo: live() ? 'live' : 'sample', llm: c && c.available ? { provider: c.provider, model: c.model } : null, ...(c && !c.available ? { llmNote: c.note } : {}),
        cache: q.cache ? q.cache.size : 0, quota: q.stats && q.stats.monthRemaining != null ? { monthRemaining: q.stats.monthRemaining, monthLimit: q.stats.monthLimit } : null });
    }
    if (p === '/api/plan' && req.method === 'POST') {
      if (limited(ipOf(req), 8)) return send(res, 429, { error: 'Slow down: up to 8 plans per minute.' });
      const a = planArgs(await readBody(req));
      if (!a.venue) return send(res, 400, { error: 'Tell Marquee your venue name.' });
      const q = qlooFor();
      const stream = u.searchParams.get('stream') === '1' || /text\/event-stream/.test(req.headers.accept || '');
      if (!stream) { const out = await agent.run({ qloo: q, ...a, env, oidc }); return send(res, 200, { ...out, mode: live() ? 'live' : 'sample' }); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      emit('hello', { mode: live() ? 'live' : 'sample' });
      try { const out = await agent.run({ qloo: q, ...a, env, oidc, onEvent: ev => emit(ev.type, ev) }); emit('result', { ...out, mode: live() ? 'live' : 'sample' }); }
      catch (e) { emit('fail', { error: friendly(e), status: e.status || 500 }); }
      return res.end();
    }
    if (p === '/api/gutcheck' && req.method === 'POST') {
      if (limited(ipOf(req) + ':g', 20)) return send(res, 429, { error: 'Slow down: up to 20 checks per minute.' });
      const b = await readBody(req); const idea = str(b.idea, 60); if (!idea) return send(res, 400, { error: 'Type an idea, e.g. "salsa night".' });
      const ctx = { qloo: qlooFor() }; const city = str(b.city, 60);
      const venueId = str(b.venueId, 64) || (await T.findVenue(ctx, { venue: str(b.venue, 100), city })).id;
      await T.prepareCtx(ctx, { venueId, city });
      return send(res, 200, await T.gutCheck(ctx, { idea, venueId, city }));
    }
    if (p === '/api/generic' && req.method === 'POST') {
      if (limited(ipOf(req) + ':x', 6)) return send(res, 429, { error: 'Slow down.' });
      const b = await readBody(req); const ctx = { qloo: qlooFor() };
      const venue = b.venueId ? { id: str(b.venueId, 64), name: str(b.venue, 100), city: str(b.city, 60) } : await T.findVenue(ctx, { venue: str(b.venue, 100), city: str(b.city, 60) });
      await T.prepareCtx(ctx, { venueId: venue.id, city: str(b.city, 60) || venue.city });
      return send(res, 200, await agent.genericVsMarquee({ ctx, qloo: ctx.qloo, venue, city: str(b.city, 60), goal: str(b.goal, 200), env, oidc }));
    }
    if (p === '/api/compare' && req.method === 'POST') {
      if (limited(ipOf(req) + ':c', 6)) return send(res, 429, { error: 'Slow down: up to 6 comparisons per minute.' });
      const b = await readBody(req); const side = x => ({ venue: str(x && x.venue, 100), city: str(x && x.city, 60) });
      return send(res, 200, { ...(await agent.compareVenues({ qloo: qlooFor(), a: side(b.a), b: side(b.b) })), mode: live() ? 'live' : 'sample' });
    }
    if (p === '/api/mcp') {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (req.method === 'GET') return send(res, 405, { error: 'This MCP server is stateless: POST JSON-RPC messages to this URL.' }, { ...cors, Allow: 'POST' });
      if (limited(ipOf(req) + ':m', 30)) return send(res, 429, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Rate limited' } }, cors);
      let msg; try { msg = await readBody(req, 64e3); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, cors); }
      const out = await mcp.handle(msg, { qloo: qlooFor(), env, oidc });
      if (!out) { res.writeHead(202, cors); return res.end(); }
      return send(res, 200, out, cors);
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch {} return; }
    return send(res, e.status && e.status < 600 && e.status >= 400 ? e.status : 500, { error: friendly(e) });
  }
}

module.exports = { handle, makeQloo, planArgs, limited };
