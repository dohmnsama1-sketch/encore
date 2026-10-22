'use strict';
delete process.env.QLOO_API_KEY; for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN']) delete process.env[k];
const test = require('node:test'); const assert = require('node:assert/strict'); const http = require('http');
const { StubQloo } = require('../src/stub'); const agent = require('../src/agent'); const mcp = require('../src/mcp'); const T = require('../src/tools');
const { handle, planArgs } = require('../src/app');

test('agent runs end-to-end and passes its own critic (sample data)', async () => {
  const events = [];
  const r = await agent.run({ qloo: new StubQloo(), venue: 'Sample Jazz Room', city: 'Sample City', goal: 'fill quiet Tuesdays, attract students', idea: 'salsa night', nights: ['Tue', 'Thu'], weeks: 4, env: {}, onEvent: e => events.push(e), from: new Date(Date.UTC(2026, 9, 22)) });
  assert.equal(r.calendar.length, 8);
  assert.equal(r.score.groundedPct, 100); assert.equal(r.score.repeats, 0);
  assert.equal(r.plan.by, 'rules'); assert.equal(r.stats.llm, false);
  assert.ok(r.strategy.headline && r.strategy.text);
  assert.ok(r.gut.length === 1 && ['go', 'tweak', 'rethink'].includes(r.gut[0].verdict));
  assert.ok(r.bridges.length > 0, 'student goal adds bridge picks');
  assert.ok(r.partners.length && r.twins.length && r.zones.neighbourhoods.length);
  assert.ok(events.some(e => e.tool === 'critic' && e.status === 'done'));
  assert.ok(r.steps.every(s => s.status !== 'running'));
});

test('gut check returns a percentile and a better bet', async () => {
  const ctx = await T.prepareCtx({ qloo: new StubQloo() }, { venueId: 'stub-venue', city: 'Sample City' });
  const g = await T.gutCheck(ctx, { idea: 'k-pop', venueId: 'stub-venue', city: 'Sample City' });
  assert.ok(g.percentile >= 0 && g.percentile <= 100); assert.ok(g.message.length > 10);
});

test('planArgs sanitises user input', () => {
  const a = planArgs({ venue: 'X\u0000'.repeat(80), nights: ['Tue', 'Bogus', 'Fri'], weeks: 99 });
  assert.ok(a.venue.length <= 100); assert.ok(!a.venue.includes('\u0000'));
  assert.ok(a.weeks <= 6); assert.ok(a.nights.every(n => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].includes(n)));
});

test('MCP: initialize, list, call, notifications, errors', async () => {
  const deps = { qloo: new StubQloo(), env: {} };
  const init = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, deps);
  assert.equal(init.result.protocolVersion, '2025-06-18'); assert.equal(init.result.serverInfo.name, 'encore');
  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps), null);
  const list = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, deps);
  assert.deepEqual(list.result.tools.map(t => t.name), ['encore_plan_month', 'encore_gut_check', 'encore_crowd_profile']);
  const call = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'encore_gut_check', arguments: { venue: 'Sample Room', idea: 'jazz' } } }, deps);
  assert.equal(call.result.isError, false); assert.ok(call.result.structuredContent.verdict);
  const plan = await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'encore_plan_month', arguments: { venue: 'Sample Room', weeks: 2 } } }, deps);
  assert.equal(plan.result.structuredContent.calendar.length, 4);
  const bad = await mcp.handle({ jsonrpc: '2.0', id: 5, method: 'nope' }, deps); assert.equal(bad.error.code, -32601);
  const inv = await mcp.handle({ id: 6 }, deps); assert.equal(inv.error.code, -32600);
  const batch = await mcp.handle([{ jsonrpc: '2.0', id: 7, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }], deps);
  assert.equal(batch.length, 1);
});

test('HTTP API: status, plan (JSON + SSE), gutcheck, mcp, validation, 404', async () => {
  const srv = http.createServer(handle); await new Promise(r => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (p, body, h = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  try {
    const st = await (await fetch(base + '/api/status')).json(); assert.equal(st.ok, true); assert.equal(st.qloo, 'sample');
    const plan = await (await post('/api/plan', { venue: 'Sample Room', city: 'Sample City', weeks: 1 })).json(); assert.equal(plan.mode, 'sample'); assert.ok(plan.calendar.length >= 1);
    const sse = await (await post('/api/plan?stream=1', { venue: 'Sample Room', weeks: 1 })).text();
    assert.match(sse, /event: hello/); assert.match(sse, /event: step|event: agent/); assert.match(sse, /event: result/);
    assert.equal((await post('/api/plan', { venue: '' })).status, 400);
    const g = await (await post('/api/gutcheck', { venue: 'Sample Room', idea: 'jazz' })).json(); assert.ok(g.verdict);
    assert.equal((await post('/api/gutcheck', { venue: 'Sample Room' })).status, 400);
    const m = await (await post('/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json(); assert.equal(m.result.tools.length, 3);
    assert.equal((await post('/api/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    assert.equal((await fetch(base + '/api/mcp')).status, 405);
    assert.equal((await fetch(base + '/api/nope')).status, 404);
  } finally { srv.close(); }
});
