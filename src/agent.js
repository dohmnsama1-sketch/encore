'use strict';
// Marquee agent: perceive → plan → act (parallel Qloo tool calls) → compose → critique → write.
// Planning is done by an LLM with tool calling when one is configured, and by a transparent rules planner otherwise.
// Either way, a coverage check guarantees the brief has every section, and the critic verifies that every night is
// anchored on an entity Qloo returned for this crowd.
const T = require('./tools');
const C = require('./compose');
const { LANES, roomProfile, lanesForGoal, audienceForGoal, nightsForGoal, tagLabel, MUSIC } = require('./lanes');
const llm = require('./llm');
const I = require('./insight');

// Per-run provenance: wrap the shared Qloo client so this run records every call it made (path, parameters, timing, cache).
function withProvenance(qloo) {
  const log = []; const q = Object.create(qloo);
  if (typeof qloo.get !== 'function') { // sample-data mode: log the high-level calls so the provenance table still works
    const PATHS = { search: '/search', insights: '/v2/insights', tagInsights: '/v2/insights (tags)', demographics: '/v2/insights (demographics)', heatmap: '/v2/insights (heatmap)', findTags: '/v2/tags' };
    for (const [m, path] of Object.entries(PATHS)) if (typeof qloo[m] === 'function') q[m] = async (...a) => {
      const t = Date.now(); let ok = true;
      try { return await qloo[m](...a); } catch (e) { ok = false; throw e; }
      finally { log.push({ path, params: { sample: 'true' }, ms: Date.now() - t, cached: false, ok }); }
    };
    return { q, log };
  }
  q.get = async (path, params = {}, opts) => {
    const t = Date.now(); const cached = qloo.cache && qloo.cache.map ? qloo.cache.map.has(qloo.url(path, params)) : false; let ok = true;
    try { return await qloo.get(path, params, opts); } catch (e) { ok = false; throw e; }
    finally { log.push({ path, params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v).length > 70 ? String(v).slice(0, 67) + '…' : String(v)])), ms: Date.now() - t, cached, ok }); }
  };
  return { q, log };
}

function tracer(onEvent) {
  let n = 0; const steps = [];
  async function step(tool, label, fn, summarize = () => '') {
    const id = ++n; const t0 = Date.now(); const s = { id, tool, label, status: 'running' }; steps.push(s);
    onEvent && onEvent({ type: 'step', ...s });
    try { const out = await fn(); Object.assign(s, { status: 'done', ms: Date.now() - t0, summary: summarize(out) }); onEvent && onEvent({ type: 'step', ...s }); return out; }
    catch (e) {
      // An unavailable LLM is a planned fallback, not a failure: show it as skipped.
      const skipped = !!e.llmUnavailable;
      Object.assign(s, { status: skipped ? 'skipped' : 'error', ms: Date.now() - t0, summary: skipped ? 'LLM unavailable: the rules planner takes over' : e.message });
      onEvent && onEvent({ type: 'step', ...s }); throw e; }
  }
  const soft = (tool, label, fn, sum, fallback = null) => step(tool, label, fn, sum).catch(() => fallback);
  return { step, soft, steps };
}

const names = (list, n = 3) => (list || []).slice(0, n).map(e => e.name).join(', ');

async function run({ qloo, venue: venueQuery, city = '', goal = '', idea = '', nights, weeks = 4, env = process.env, oidc, onEvent, from }) {
  if (!venueQuery || !String(venueQuery).trim()) { const e = new Error('Tell Marquee your venue name.'); e.status = 400; throw e; }
  const tr = tracer(onEvent); const t0 = Date.now();
  const callsBefore = qloo.calls; const prov = withProvenance(qloo); const ctx = { qloo: prov.q };

  // PERCEIVE ---------------------------------------------------------------------------
  const venue = await tr.step('qloo.search', `Finding "${venueQuery}"${city ? ' in ' + city : ''}`, () => T.findVenue(ctx, { venue: venueQuery, city }),
    v => `${v.name}${v.address ? ' · ' + v.address : ''}`);
  const where = city || venue.city || '';
  const room = roomProfile(venue);
  venue.categories = room.categories;
  const [dna, demographics, proxies] = await Promise.all([
    tr.soft('qloo.insights · urn:tag', 'Reading the crowd\'s taste DNA', () => T.crowdDNA(ctx, { venueId: venue.id }), d => d.slice(0, 5).map(t => t.name).join(', '), []),
    tr.soft('qloo.insights · urn:demographics', 'Profiling who the crowd is', () => T.crowdDemographics(ctx, { venueId: venue.id }), d => d ? `peak age ${d.peak.label}` : 'n/a', null),
    tr.soft('qloo.insights · urn:entity:artist', 'Finding the crowd\'s signature artists', () => T.signatureArtists(ctx, { venueId: venue.id, city: city || venue.city }), x => names(x), []),
  ]);
  ctx.proxies = (proxies || []).slice(0, 3);
  ctx.dnaTags = (dna || []).filter(t => t.id && !/specialty_dish/.test(t.id)).slice(0, 5).map(t => t.id);

  // PLAN --------------------------------------------------------------------------------
  const audience = audienceForGoal(goal);
  const plannedNights = nights && nights.length ? nights : nightsForGoal(goal);
  let plan = { lanes: lanesForGoal(room, goal), genres: { artist: room.seeds }, ideas: idea ? [idea] : [], audience, by: 'rules', rationale: `Room reads as ${room.categories.slice(0, 2).join(' / ') || 'a general venue'}; lanes chosen for the room and the goal.` };
  const radar = {}; const gathered = new Map(); const keep = list => (list || []).forEach(e => e && e.id && gathered.set(e.id, e));
  const gut = []; let bridges = []; let partners = [], rivals = [], brands = [], twins = [], zones = { neighbourhoods: [], cells: [] };

  const runRadar = async (lane, genres) => {
    const L = LANES[lane]; if (!L) return;
    const list = (genres && genres.length ? genres : L.genres).filter(Boolean).slice(0, lane === plan.lanes[0] ? 10 : 6);
    const r = await tr.soft(`qloo.insights · ${L.type}`, `Genre radar: ${L.label} (${list.length || 1} genres × this crowd)`, () => T.genreRadar(ctx, { lane, venueId: venue.id, city: where, genres: list }),
      x => x.genres.length ? x.genres.slice(0, 3).map(g => `${g.label} ${Math.round(g.score * 100)}`).join(' · ') + (x.genres[0].via && x.genres[0].via !== 'venue' ? ` (via ${x.genres[0].via})` : '') : 'no usable signal for this crowd', { lane, genres: [] });
    radar[lane] = r.genres; r.genres.forEach(g => keep(g.entities)); return r;
  };
  const toolImpl = {
    genre_radar: async a => { const r = await runRadar(a.lane, a.genres); return r && r.genres.slice(0, 5).map(g => ({ genre: g.label, tag: g.tag, score: g.score, top: g.entities.slice(0, 3).map(e => ({ id: e.id, name: e.name, affinity: e.affinity, popularity: e.popularity })) })); },
    gut_check: async a => { const g = await tr.soft('qloo.tags + insights', `Gut-checking "${a.idea}"`, () => T.gutCheck(ctx, { idea: a.idea, venueId: venue.id, city: where, radar }), x => x.message, null); if (g) { gut.push(g); keep(g.bookThese); } return g; },
    bridge_picks: async a => { const lane = a.lane || plan.lanes[0]; const top = (radar[lane] || [])[0];
      const r = await tr.soft(`qloo.insights · signal.demographics.age`, `Bridge picks: ${LANES[lane].label} loved by regulars and ${a.label || a.ages.join(', ')}`, () => T.bridgePicks(ctx, { lane, venueId: venue.id, city: where, tag: top && top.tag, ages: a.ages, baseline: top ? top.entities : [] }), x => names(x), []);
      bridges.push(...r.filter(e => e.newToPlan).slice(0, 3).map(e => ({ lane, entity: e, genre: top && top.label }))); keep(r); return r.slice(0, 5).map(e => ({ id: e.id, name: e.name, affinity: e.affinity })); },
    neighbour_partners: async () => { const r = await tr.soft('qloo.insights · urn:entity:place', 'Finding neighbour partners within 1.5 km', () => T.neighbourPartners(ctx, { venue }), x => `partners: ${names(x.partners)}${x.rivals.length ? ` · rivals: ${names(x.rivals, 2)}` : ''}`, { partners: [], rivals: [] }); partners = r.partners; rivals = r.rivals; return { partners: partners.map(p => ({ name: p.name, affinity: p.affinity, categories: p.categories })), rivals: rivals.map(p => p.name) }; },
    brand_collabs: async () => { brands = await tr.soft('qloo.insights · urn:entity:brand', 'Finding brand collaborators', () => T.brandCollabs(ctx, { venueId: venue.id }), x => names(x), []); return brands.map(b => ({ name: b.name, affinity: b.affinity })); },
    taste_twins: async () => { twins = await tr.soft('qloo.insights · diversify.by city', 'Finding taste twins in other cities', () => T.tasteTwins(ctx, { venue, categoryTag: room.categoryTag }), x => x.slice(0, 3).map(t => `${t.name} (${t.city})`).join(', '), []); return twins.map(t => ({ name: t.name, city: t.city, affinity: t.affinity })); },
    flyer_zones: async () => { zones = await tr.soft('qloo.insights · urn:heatmap', `Mapping where this taste concentrates in ${where}`, () => T.flyerZones(ctx, { venueId: venue.id, city: where, venueCity: venue.city }), x => x.neighbourhoods.slice(0, 4).map(n => n.name).join(', '), zones); return zones.neighbourhoods; },
  };

  // Context tools don't depend on the plan: start them now, in parallel with planning (results are de-duplicated by the client).
  const early = [toolImpl.neighbour_partners(), toolImpl.brand_collabs(), toolImpl.taste_twins(), toolImpl.flyer_zones()];
  let agentNotes = null;
  const llmOn = llm.enabled(env, oidc);
  if (llmOn) {
    try { agentNotes = await tr.step('llm.agent', 'Agent planning which tools to call', () => llmPlan({ venue, where, goal, idea, room, dna, demographics, audience, toolImpl, env, oidc, onEvent }), x => x && x.rationale ? x.rationale.slice(0, 140) : 'planned'); }
    catch { agentNotes = null; }
    if (agentNotes && Array.isArray(agentNotes.lanes)) { const l = agentNotes.lanes.filter(x => LANES[x]); if (l.length >= 2) plan = { ...plan, lanes: [...new Set(l)].slice(0, 4), by: 'llm', rationale: agentNotes.rationale || plan.rationale }; }
  }

  // ACT: coverage check. Whatever the planner did, make sure the brief has every section. -----------------
  await Promise.all(plan.lanes.filter(l => !radar[l]).map(l => runRadar(l, l === 'artist' ? uniq([...(plan.genres.artist || []), ...LANES.artist.genres]) : null)));
  await Promise.all(early);
  const jobs = [];
    if (audience && !bridges.length) jobs.push(toolImpl.bridge_picks({ lane: plan.lanes[0], ages: audience.ages, label: audience.label }));
  if (idea && !gut.some(g => g.idea === idea)) jobs.push(toolImpl.gut_check({ idea }));
  await Promise.all(jobs);

  // COMPOSE + CRITIQUE ----------------------------------------------------------------
  const lanesWithData = plan.lanes.filter(l => (radar[l] || []).length);
  const events = await tr.step('compose', `Programming ${weeks} weeks of ${plannedNights.join(' + ')} nights`, async () =>
    C.buildCalendar({ venue, lanes: lanesWithData, radar, bridges, nights: plannedNights, weeks, from }), ev => `${ev.length} nights across ${new Set(ev.map(e => e.lane)).size} formats`);
  const score = await tr.step('critic', 'Critic: checking grounding, repeats and variety', async () => C.critique({ events, lanes: lanesWithData, radarIds: new Set(gathered.keys()), nights: plannedNights.length }),
    s => s.ok ? `Passed: ${s.groundedPct}% grounded in Qloo, ${s.repeats} repeats, ${s.formats} formats` : `Issues: ${s.issues.join('; ')}`);
  I.explain(events, radar, { venue, proxies: ctx.proxies, city: where, audience });
  const outreach = C.pitches({ venue, partners, brands, twins });

  // WRITE (LLM copywriter, optional) --------------------------------------------------
  let strategy = null; let by = plan.by;
  if (llmOn) {
    const copy = !llm.enabled(env, oidc) ? null : await tr.soft('llm.copywriter', 'Writing promo copy (only from Qloo-grounded facts)', () => llmCopy({ venue, goal, events, dna, demographics, radar, env, oidc }), x => x && x.headline ? x.headline : 'done', null);
    if (copy) {
      strategy = copy.strategy || null;
      for (const ev of events) { const c = copy.promos && copy.promos[ev.anchorId]; if (typeof c === 'string' && c.length > 20 && c.length < 400 && c.toLowerCase().includes(String(ev.anchor).toLowerCase().split(/[\s:]/)[0])) ev.promo = c; }
      if (copy.headline) strategy = { headline: copy.headline, ...(strategy && typeof strategy === 'object' ? strategy : { text: strategy }) };
    }
  }
  if (!strategy) strategy = rulesStrategy({ venue, radar, plan, demographics, audience, zones, gut });

  const steps = tr.steps;
  return {
    version: 2, venue, city: where, goal, idea, nights: plannedNights, weeks, room, plan: { lanes: plan.lanes, by, rationale: plan.rationale, audience },
    dna, demographics, signature: proxies || [], persona: C.personas({ dna, demographics }),
    radar: Object.fromEntries(Object.entries(radar).map(([k, v]) => [k, v.map(g => ({ tag: g.tag, label: g.label, score: g.score, via: g.via, entities: g.entities.slice(0, 6) }))])),
    calendar: events, score: { ...score, avgDraw: events.length ? Math.round(events.reduce((s, e) => s + e.draw.index, 0) / events.length) : null }, gut: gut.map(g => ({ ...g, draw: I.ideaDraw(g) })), drawModel: I.WEIGHTS, provenance: prov.log, bridges: bridges.map(b => ({ lane: b.lane, ...b.entity })), partners, rivals, brands, twins, zones, outreach, strategy,
    steps, stats: { qlooCalls: qloo.calls - callsBefore, ms: Date.now() - t0, llm: llmOn, planner: by },
  };
}

const uniq = a => [...new Set(a)];
const poss = n => /s$/i.test(String(n).trim()) ? `${n}'` : `${n}'s`;

function rulesStrategy({ venue, radar, plan, demographics, audience, zones, gut }) {
  const L0 = plan.lanes[0]; const top = (radar[L0] || [])[0]; const second = (radar[L0] || [])[1];
  const lines = [];
  if (top) lines.push(`Lead with ${top.label}: it's the strongest ${LANES[L0].label.toLowerCase()} genre for ${poss(venue.name)} crowd${second ? `, ahead of ${second.label}` : ''}.`);
  const others = plan.lanes.slice(1).map(l => (radar[l] || [])[0] && `${(radar[l][0]).label} ${LANES[l].label.toLowerCase()}`).filter(Boolean);
  if (others.length) lines.push(`Fill the other nights with ${others.join(' and ')}, so regulars come back for different reasons.`);
  if (audience) lines.push(`Every third night is a bridge pick that both your regulars and ${audience.label} over-index on.`);
  if (zones.neighbourhoods.length) lines.push(`Put flyers and local ads in ${zones.neighbourhoods.slice(0, 3).map(n => n.name).join(', ')}, where this taste concentrates.`);
  if (gut[0]) lines.push(`Your idea: ${gut[0].message}`);
  return { headline: top ? `${top.label} is your crowd's language. Speak it on quiet nights.` : `A month built on what your crowd already loves.`, text: lines.join(' ') };
}

// LLM planner: a real tool-calling loop over Marquee's Qloo tools (max 3 rounds, parallel calls).
async function llmPlan({ venue, where, goal, idea, room, dna, demographics, audience, toolImpl, env, oidc, onEvent }) {
  const sys = `You are Marquee, an AI programming director for independent venues. You plan a month of events by calling tools that query Qloo's taste graph for THIS venue's crowd. Rules: (1) Call genre_radar for 2-4 lanes that fit the room and the owner's goal; for the music lane, pass 8-10 Qloo genre tag IDs (format urn:tag:genre:music:<genre>, e.g. jazz, soul, neo_soul, r_and_b, blues, funk, latin, salsa, hip_hop, electronic, house, disco, classical, rock, indie, punk, folk_rock, singer_songwriter, pop, reggae, afrobeats, k_pop, ambient, gospel, country, metal, dance, reggaeton). (2) If the owner gave an idea, call gut_check. (3) If the goal implies a new audience (e.g. students, younger, older), call bridge_picks with the matching age buckets. (4) Call neighbour_partners, brand_collabs, taste_twins and flyer_zones. Never invent data; use only tool results. When done, reply with JSON only: {"lanes":[lane ids in priority order],"rationale":"one or two sentences on why"}.`;
  const user = `Venue: ${venue.name} (${venue.address || where}). Room type from Qloo: ${room.categories.join(', ') || 'unknown'}. City: ${where}. Owner goal: ${goal || 'fill quiet nights'}. Owner idea to check: ${idea || 'none'}. Crowd taste DNA (Qloo tags): ${dna.slice(0, 12).map(t => t.name).join(', ') || 'n/a'}. Demographics: ${demographics ? `peak age ${demographics.peak.label}` : 'n/a'}. Suggested growth audience: ${audience ? audience.label + ' ' + audience.ages.join(',') : 'none'}. Lanes available: ${Object.keys(LANES).join(', ')}.`;
  const messages = [{ role: 'system', content: sys }, { role: 'user', content: user }];
  for (let round = 0; round < 3; round++) {
    const m = await llm.chat({ messages, tools: require('./tools').SPECS, maxTokens: 900 }, env, oidc);
    if (!m) return null;
    messages.push({ role: 'assistant', content: m.content || '', tool_calls: m.tool_calls });
    if (!m.tool_calls || !m.tool_calls.length) return llm.parseJSON(m.content);
    const results = await Promise.all(m.tool_calls.map(async tc => {
      let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
      onEvent && onEvent({ type: 'agent', tool: tc.function.name, args });
      const impl = toolImpl[tc.function.name];
      let out; try { out = impl ? await impl(args) : { error: 'unknown tool' }; } catch (e) { out = { error: e.message }; }
      return { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 6000) };
    }));
    messages.push(...results);
  }
  const final = await llm.chat({ messages: [...messages, { role: 'user', content: 'Reply now with the JSON only.' }], json: true, maxTokens: 300 }, env, oidc);
  return final ? llm.parseJSON(final.content) : null;
}

async function llmCopy({ venue, goal, events, dna, demographics, radar, env, oidc }) {
  const facts = events.map(e => ({ id: e.anchorId, date: e.date, day: e.day, title: e.title, anchor: e.anchor, format: e.format, genre: e.genre, label: e.label, affinity: e.affinity }));
  const sys = 'You write short, warm, specific promo copy for an independent venue. Use ONLY the facts provided. Do not invent performers, dates, prices or claims. Each promo: max 40 words, must name the anchor exactly, no hashtags. Reply JSON: {"headline":"max 12 words strategy headline","strategy":"2-3 sentences on why this month works for this crowd, citing genres from the radar","promos":{"<id>":"copy"}}';
  const user = JSON.stringify({ venue: venue.name, city: venue.city, goal, crowd: dna.slice(0, 10).map(t => t.name), peakAge: demographics && demographics.peak && demographics.peak.label,
    radar: Object.fromEntries(Object.entries(radar).map(([k, v]) => [k, v.slice(0, 4).map(g => `${g.label} ${Math.round(g.score * 100)}`)])), nights: facts });
  return llm.chatJSON(sys, user, env, oidc, { maxTokens: 1600 });
}

// LLM-only baseline for the "Generic AI vs Marquee" proof: the same model, no tools. Each generic idea is then gut-checked against Qloo.
async function genericVsMarquee({ ctx: given, qloo, venue, city, goal, env, oidc }) {
  if (!llm.enabled(env, oidc)) return { available: false };
  const j = await llm.chatJSON('You are a helpful assistant. Reply JSON only: {"ideas":["six short event ideas, 2-5 words each, each naming a genre or format"]}',
    `Suggest six event nights for ${venue.name} in ${city || venue.city}. Goal: ${goal || 'fill quiet nights'}.`, env, oidc, { maxTokens: 300, temperature: 0.7 });
  const ideas = (j && Array.isArray(j.ideas) ? j.ideas : []).slice(0, 6).map(String);
  const ctx = given || await T.prepareCtx({ qloo }, { venueId: venue.id, city: city || venue.city });
  const checks = await Promise.all(ideas.map(idea => T.gutCheck(ctx, { idea, venueId: venue.id, city: city || venue.city }).catch(() => ({ idea, verdict: 'unknown' }))));
  return { available: true, ideas: checks.map(c => ({ idea: c.idea, verdict: c.verdict, percentile: c.percentile, tagName: c.tagName, betterBet: c.betterBet && c.betterBet.label })) };
}

// Multi-venue / multi-city comparison: the same 12 music genres scored against two crowds.
const COMPARE_GENRES = ['jazz', 'soul', 'r_and_b', 'hip_hop', 'electronic', 'house', 'rock', 'indie', 'pop', 'latin', 'classical', 'country'].map(g => MUSIC + g);
async function snapshot(qloo, { venue: name, city = '' }) {
  if (!name || !String(name).trim()) { const e = new Error('Name both venues.'); e.status = 400; throw e; }
  const ctx = { qloo }; const venue = await T.findVenue(ctx, { venue: name, city }); const where = city || venue.city || '';
  await T.prepareCtx(ctx, { venueId: venue.id, city: where });
  const [dna, demographics, radar] = await Promise.all([
    T.crowdDNA(ctx, { venueId: venue.id }).catch(() => []), T.crowdDemographics(ctx, { venueId: venue.id }).catch(() => null),
    T.genreRadar(ctx, { lane: 'artist', venueId: venue.id, city: where, genres: COMPARE_GENRES }).then(r => r.genres).catch(() => [])]);
  return { venue: { id: venue.id, name: venue.name, address: venue.address, city: where }, dna, demographics, radar };
}
async function compareVenues({ qloo, a, b }) {
  const t0 = Date.now(); const before = qloo.calls;
  const [A, B] = await Promise.all([snapshot(qloo, a), snapshot(qloo, b)]);
  if (!A.radar.length || !B.radar.length) { const e = new Error('Qloo has too little taste data for one of these venues to compare.'); e.status = 422; throw e; }
  const cmp = I.compareCrowds(A, B);
  const slimR = r => r.map(g => ({ tag: g.tag, label: g.label, score: g.score, top: g.entities.slice(0, 3).map(e => e.name) }));
  return { a: { ...A, radar: slimR(A.radar), dna: A.dna.slice(0, 10) }, b: { ...B, radar: slimR(B.radar), dna: B.dna.slice(0, 10) }, ...cmp, stats: { qlooCalls: qloo.calls - before, ms: Date.now() - t0 } };
}

module.exports = { run, genericVsMarquee, rulesStrategy, compareVenues };
