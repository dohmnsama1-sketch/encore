'use strict';
// MCP (Model Context Protocol) server core, shared by the stdio transport (bin/marquee-mcp.js) and the public
// stateless Streamable HTTP endpoint (/api/mcp). Lets any agent — Claude, Cursor, ChatGPT connectors, Grok — use Marquee.
const agent = require('./agent');
const T = require('./tools');

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const TOOLS = [
  { name: 'marquee_plan_month', title: 'Plan a month of events for a venue',
    description: 'Reads a real venue\'s crowd taste from Qloo\'s taste graph and returns a month of events (live music, screenings, talks, book clubs...) anchored on entities the crowd over-indexes on, plus partners, flyer zones and a scorecard.',
    inputSchema: { type: 'object', properties: { venue: { type: 'string', description: 'Venue name, e.g. "Smalls Jazz Club"' }, city: { type: 'string' }, goal: { type: 'string', description: 'e.g. "fill quiet Tuesdays, attract students"' }, idea: { type: 'string', description: 'Optional idea to gut-check, e.g. "salsa night"' }, weeks: { type: 'integer', minimum: 1, maximum: 6 } }, required: ['venue'] },
    annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'marquee_gut_check', title: 'Gut-check an event idea against a venue\'s crowd',
    description: 'Scores an event idea (a genre or format) against what a venue\'s crowd actually loves, with a percentile, a verdict (go / tweak / rethink) and a better bet.',
    inputSchema: { type: 'object', properties: { venue: { type: 'string' }, city: { type: 'string' }, idea: { type: 'string' } }, required: ['venue', 'idea'] },
    annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'marquee_crowd_profile', title: 'Profile a venue\'s crowd',
    description: 'Taste DNA tags, demographic skew, and the music genres the crowd over-indexes on, for any venue Qloo knows.',
    inputSchema: { type: 'object', properties: { venue: { type: 'string' }, city: { type: 'string' } }, required: ['venue'] },
    annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'marquee_compare_venues', title: 'Compare two venues\' crowds (any cities)',
    description: 'Scores the same 12 music genres against two venues\' crowds from Qloo and returns a taste-overlap score, the genres each crowd prefers, shared favourite artists and a verdict (share acts / keep distinct).',
    inputSchema: { type: 'object', properties: { venueA: { type: 'string' }, cityA: { type: 'string' }, venueB: { type: 'string' }, cityB: { type: 'string' } }, required: ['venueA', 'venueB'] },
    annotations: { readOnlyHint: true, openWorldHint: true } },
];

function compactPlan(r) {
  return { venue: { name: r.venue.name, address: r.venue.address }, strategy: r.strategy, scorecard: r.score,
    calendar: r.calendar.map(e => ({ date: e.date, day: e.day, title: e.title, format: e.format, anchor: e.anchor, label: e.label, drawIndex: e.draw && e.draw.index, why: e.why, reasons: e.reasons, promo: e.promo })),
    gutCheck: r.gut.map(g => ({ idea: g.idea, verdict: g.verdict, percentile: g.percentile, message: g.message })),
    partners: r.partners.slice(0, 5).map(p => ({ name: p.name, distanceM: p.distanceM })), brands: r.brands.slice(0, 5).map(b => b.name),
    tasteTwins: r.twins.map(t => `${t.name} (${t.city})`), flyerZones: r.zones.neighbourhoods.map(n => n.name), outreach: r.outreach,
    source: 'Qloo Taste AI (hackathon API) via Marquee' };
}

async function callTool(name, a, { qloo, env, oidc }) {
  const venue = String(a.venue || '').slice(0, 100); const city = String(a.city || '').slice(0, 60);
  if (name === 'marquee_plan_month') return compactPlan(await agent.run({ qloo, venue, city, goal: String(a.goal || '').slice(0, 200), idea: String(a.idea || '').slice(0, 60), weeks: Math.min(6, Math.max(1, Number(a.weeks) || 4)), env, oidc }));
  if (name === 'marquee_compare_venues') { const c = await agent.compareVenues({ qloo, a: { venue: String(a.venueA || '').slice(0, 100), city: String(a.cityA || '').slice(0, 60) }, b: { venue: String(a.venueB || '').slice(0, 100), city: String(a.cityB || '').slice(0, 60) } });
    return { a: c.a.venue, b: c.b.venue, overlap: c.overlap, verdict: c.verdict, aPrefers: c.moreA.map(r => r.label), bPrefers: c.moreB.map(r => r.label), sharedFavourites: c.sharedFavourites.map(e => e.name), genres: c.genres.map(g => ({ genre: g.label, a: g.a, b: g.b })) }; }
  const ctx = { qloo };
  const v = await T.findVenue(ctx, { venue, city });
  await T.prepareCtx(ctx, { venueId: v.id, city: city || v.city });
  if (name === 'marquee_gut_check') return { venue: v.name, ...(await T.gutCheck(ctx, { idea: String(a.idea || '').slice(0, 60), venueId: v.id, city: city || v.city })) };
  if (name === 'marquee_crowd_profile') {
    const [dna, demo, radar] = await Promise.all([T.crowdDNA(ctx, { venueId: v.id }), T.crowdDemographics(ctx, { venueId: v.id }), T.genreRadar(ctx, { lane: 'artist', venueId: v.id, city: city || v.city, genres: require('./lanes').LANES.artist.genres.slice(0, 10) })]);
    return { venue: v.name, address: v.address, tasteDNA: dna.map(t => t.name), demographics: demo, musicGenres: radar.genres.map(g => ({ genre: g.label, score: g.score, top: g.entities.slice(0, 3).map(e => e.name) })) };
  }
  const e = new Error(`Unknown tool: ${name}`); e.code = -32602; throw e;
}

// Handle one JSON-RPC message (or batch). Returns the response object(s), or null for notifications.
async function handle(msg, deps) {
  if (Array.isArray(msg)) { const out = (await Promise.all(msg.map(m => handle(m, deps)))).filter(Boolean); return out.length ? out : null; }
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return { jsonrpc: '2.0', id: msg && msg.id != null ? msg.id : null, error: { code: -32600, message: 'Invalid Request' } };
  const isNote = msg.id === undefined || msg.id === null;
  const ok = result => isNote ? null : { jsonrpc: '2.0', id: msg.id, result };
  const fail = (code, message) => isNote ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } };
  try {
    switch (msg.method) {
      case 'initialize': {
        const want = msg.params && msg.params.protocolVersion;
        return ok({ protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0], capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'marquee', title: 'Marquee — taste-grounded venue programming', version: '2.0.0' },
          instructions: 'Use marquee_plan_month to programme a venue from its crowd\'s Qloo taste data; marquee_gut_check to test an idea; marquee_crowd_profile to understand a crowd.' });
      }
      case 'notifications/initialized': case 'notifications/cancelled': return null;
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: TOOLS });
      case 'tools/call': {
        const { name, arguments: args = {} } = msg.params || {};
        if (!TOOLS.find(t => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
        try { const data = await callTool(name, args, deps); return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: false }); }
        catch (e) { return ok({ content: [{ type: 'text', text: `Marquee error: ${e.message}` }], isError: true }); }
      }
      case 'resources/list': return ok({ resources: [] });
      case 'prompts/list': return ok({ prompts: [] });
      default: return fail(-32601, `Method not found: ${msg.method}`);
    }
  } catch (e) { return fail(-32603, e.message); }
}

module.exports = { handle, TOOLS, VERSIONS, compactPlan };
