#!/usr/bin/env node
// MCP stdio server: lets any agent (Claude, Cursor, Grok...) call Encore as a tool.
require('./env').loadEnv();
const { Qloo } = require('./qloo'); const director = require('./director');
const qloo = new Qloo({ apiKey: process.env.QLOO_API_KEY, baseUrl: process.env.QLOO_BASE_URL });
const TOOLS = [{ name: 'encore_plan_month', description: 'Plan a month of events for a real venue using its crowd\'s cultural taste (Qloo taste graph): bookings, screenings, talks, brand collabs and neighbour partners.',
  inputSchema: { type: 'object', properties: { venue: { type: 'string' }, city: { type: 'string' }, goal: { type: 'string' }, weeks: { type: 'number' } }, required: ['venue', 'city'] } }];
const out = m => process.stdout.write(JSON.stringify(m) + '\n'); let buf = '';
process.stdin.on('data', async c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; let m; try { m = JSON.parse(line); } catch { continue; }
  const reply = result => out({ jsonrpc: '2.0', id: m.id, result });
  try { if (m.method === 'initialize') reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'encore', version: '1.0.0' } });
    else if (m.method === 'tools/list') reply({ tools: TOOLS });
    else if (m.method === 'tools/call') { const a = m.params.arguments || {}; const r = await director.run({ qloo, venueQuery: a.venue, city: a.city, goal: a.goal, weeks: a.weeks });
      reply({ content: [{ type: 'text', text: JSON.stringify({ venue: r.venue.name, calendar: r.calendar, outreach: r.outreach }, null, 2) }] }); }
    else if (m.id !== undefined) reply({}); } catch (e) { out({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: e.message } }); } } });
