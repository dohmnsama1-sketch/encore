// Encore agent: resolves a venue, reads its crowd's taste from Qloo, plans which
// "lanes" to explore (tools), then composes a month of events + partner outreach.
const { chatJSON, enabled } = require('./llm');

const LANES = {
  artist:  { type: 'urn:entity:artist',  label: 'Live music & DJs', format: 'Live night' },
  movie:   { type: 'urn:entity:movie',   label: 'Screenings',       format: 'Cinema club' },
  podcast: { type: 'urn:entity:podcast', label: 'Talks & podcasts', format: 'Live listening + Q&A' },
  book:    { type: 'urn:entity:book',    label: 'Book club',        format: 'Book club' },
  tv_show: { type: 'urn:entity:tv_show', label: 'Watch parties',    format: 'Watch party' },
  video_game: { type: 'urn:entity:videogame', label: 'Game nights', format: 'Game night' },
  brand:   { type: 'urn:entity:brand',   label: 'Brand collabs',    format: 'Pop-up collab' },
  place:   { type: 'urn:entity:place',   label: 'Neighbour partners', format: 'Cross-promo' },
};
const DAYS = ['Thu', 'Sat'];

function planLanesHeuristic(goal = '') {
  const g = goal.toLowerCase(); const lanes = ['artist', 'movie', 'podcast', 'brand', 'place'];
  if (/book|read|literary|quiet|cafe|coffee/.test(g)) lanes.splice(3, 0, 'book');
  if (/game|student|young|gen ?z|family|kids/.test(g)) lanes.splice(3, 0, 'video_game');
  if (/series|show|finale|sport/.test(g)) lanes.splice(3, 0, 'tv_show');
  return [...new Set(lanes)];
}

async function planLanes(goal, venue, tags, env) {
  try {
    const j = await chatJSON('You are a venue programming director. Choose which taste lanes to explore. Reply JSON {"lanes":[...],"why":"..."} using only: ' + Object.keys(LANES).join(', '),
      `Venue: ${venue.name} (${venue.address || ''}). Owner goal: ${goal || 'fill quiet nights'}. Crowd taste tags: ${tags.slice(0, 10).map(t => t.name).join(', ') || 'unknown'}`, env);
    if (j && Array.isArray(j.lanes)) { const l = j.lanes.filter(x => LANES[x]); if (l.length >= 3) return { lanes: [...new Set([...l, 'place'])], why: j.why, by: 'llm' }; }
  } catch {}
  return { lanes: planLanesHeuristic(goal), why: 'Default lanes for the stated goal', by: 'rules' };
}

// Transparent scoring, computed only from Qloo's own affinity and popularity fields.
// fit = how strongly this crowd over-indexes on the anchor; reach = how widely known it is.
function score(e) {
  const fit = e.affinity != null ? Math.round(e.affinity * 100) : null;
  const reach = e.popularity != null ? Math.round(e.popularity * 100) : null;
  let label = 'Strong fit';
  if (fit != null && reach != null) {
    if (fit >= 80 && reach < 60) label = 'Hidden gem';          // loved by THIS crowd, not yet mainstream: easier to book, feels like discovery
    else if (fit >= 80) label = 'Crowd favourite';
    else if (fit < 60) label = 'Stretch pick';
  }
  return { fit, reach, label };
}

function programmeSummary(events) {
  const fits = events.map(e => e.score && e.score.fit).filter(x => x != null);
  const avg = fits.length ? Math.round(fits.reduce((a, b) => a + b, 0) / fits.length) : null;
  return { nights: events.length, avgFit: avg, hiddenGems: events.filter(e => e.score && e.score.label === 'Hidden gem').length,
    lanes: [...new Set(events.map(e => e.lane))].length, repeats: events.length - new Set(events.map(e => e.anchor)).size };
}

// Crowd personas from Qloo taste tags (no invented data: every persona is built from returned tags).
function personas(tags) {
  const t = tags.filter(x => x && x.name).slice(0, 9); const out = [];
  for (let i = 0; i < t.length && out.length < 3; i += 3) {
    const g = t.slice(i, i + 3); if (!g.length) break;
    out.push({ name: `The ${g[0].name} crowd`, tags: g.map(x => x.name), hook: `Lead with ${g.map(x => x.name.toLowerCase()).join(' + ')} in the copy and visuals.` });
  }
  return out;
}

const short = n => { const s = String(n || '').split(/\s+--\s+|:\s/)[0].trim(); return s.length > 60 ? s.slice(0, 57).replace(/\s+\S*$/, '') + '…' : s; };
function why(e) {
  const a = e.affinity != null ? `${Math.round(e.affinity * 100)}% affinity with your crowd` : 'high affinity with your crowd';
  return a + (e.popularity != null ? `, popularity ${Math.round(e.popularity * 100)}th pct` : '');
}

function composeHeuristic({ venue, lanesData, weeks = 4 }) {
  const pools = Object.fromEntries(Object.entries(lanesData).filter(([k]) => !['brand', 'place'].includes(k)).map(([k, v]) => [k, [...v]]));
  const order = Object.keys(pools); const events = []; let i = 0;
  for (let w = 1; w <= weeks; w++) for (const d of DAYS) {
    let tries = 0, lane, pick;
    while (tries++ < order.length && !pick) { lane = order[i++ % order.length]; pick = pools[lane].shift(); }
    if (!pick) continue;
    const L = LANES[lane];
    events.push({ week: w, day: d, lane, format: L.format, anchor: pick.name, anchorId: pick.id, score: score(pick), title: `${L.format}: ${short(pick.name)}${lane === 'artist' ? ' & friends' : ''}`,
      why: why(pick), promo: `${d} at ${venue.name}: ${L.format.toLowerCase()} built around ${pick.name}, chosen because your regulars over-index on it. Doors 7pm.` });
  }
  const brand = (lanesData.brand || [])[0], place = (lanesData.place || [])[0];
  const outreach = [];
  if (brand) outreach.push({ to: brand.name, kind: 'Brand collab', why: why(brand), draft: `Hi ${brand.name} team, our guests at ${venue.name} show a strong taste overlap with your brand. We'd love to co-host a pop-up night this month: you bring product, we bring the crowd. Interested?` });
  if (place) outreach.push({ to: place.name, kind: 'Neighbour cross-promo', why: why(place), draft: `Hi ${place.name}, we're ${venue.name} nearby, and our crowds love the same things. Want to swap flyers and offer each other's guests 10% this month?` });
  return { events, outreach, by: 'template' };
}

async function compose(ctx, env) {
  const base = composeHeuristic(ctx);
  try {
    const j = await chatJSON('You write punchy, specific event titles and one-line promo copy for an independent venue. Keep every anchor exactly as given. Reply JSON {"events":[{"i":0,"title":"...","promo":"..."}],"outreach":[{"i":0,"draft":"..."}]}',
      JSON.stringify({ venue: ctx.venue.name, goal: ctx.goal, events: base.events.map((e, i) => ({ i, day: e.day, format: e.format, anchor: e.anchor, why: e.why })), outreach: base.outreach.map((o, i) => ({ i, to: o.to, kind: o.kind })) }), env);
    if (j) {
      for (const x of j.events || []) if (base.events[x.i]) Object.assign(base.events[x.i], { title: String(x.title).slice(0, 90), promo: String(x.promo).slice(0, 240) });
      for (const x of j.outreach || []) if (base.outreach[x.i]) base.outreach[x.i].draft = String(x.draft).slice(0, 600);
      base.by = env.AI_MODEL;
    }
  } catch {}
  return base;
}

async function genericGuess(venue, goal, env) {
  try { const j = await chatJSON('Suggest 4 event ideas for this venue WITHOUT any data. Reply JSON {"ideas":["..."]}', `${venue.name}, ${venue.address || ''}. Goal: ${goal}`, env); return j && j.ideas; } catch { return null; }
}

async function run({ qloo, venueQuery, city, goal = '', weeks = 4, env = process.env, onStep = () => {} }) {
  const step = (tool, detail, data) => onStep({ ts: Date.now(), tool, detail, data });
  step('qloo.search', `Finding "${venueQuery}" in ${city}`);
  const found = await qloo.searchPlace(venueQuery, city);
  if (!found.length) throw new Error(`Couldn't find "${venueQuery}" in Qloo. Try the exact venue name and city.`);
  const venue = found[0]; step('qloo.search', `Matched ${venue.name}${venue.address ? ' · ' + venue.address : ''}`, { venue, alternatives: found.slice(1, 4).map(f => ({ name: f.name, address: f.address })) });
  const tags = await qloo.tasteTags(venue.id); step('qloo.taste', `Crowd taste: ${tags.slice(0, 6).map(t => t.name).join(', ') || '(not available)'}`, { tags });
  const plan = await planLanes(goal, venue, tags, env); step('plan', `Exploring ${plan.lanes.map(l => LANES[l].label).join(' · ')} (${plan.by})`, plan);
  const lanesData = {};
  await Promise.all(plan.lanes.map(async lane => {
    const p = { 'filter.type': LANES[lane].type, 'signal.interests.entities': venue.id, take: lane === 'place' ? 8 : 10 };
    if (lane === 'place') { p['filter.location.query'] = city; p['filter.exclude.entities'] = venue.id; } else if (city) p['signal.location.query'] = city;
    try { lanesData[lane] = await qloo.insights(p); step('qloo.insights', `${LANES[lane].label}: ${lanesData[lane].slice(0, 3).map(e => e.name).join(', ')}`, { lane }); }
    catch (e) { lanesData[lane] = []; step('qloo.insights', `${LANES[lane].label}: unavailable (${e.message})`, { lane }); }
  }));
  const plan2 = await compose({ venue, lanesData, weeks, goal }, env); step('compose', `Drafted ${plan2.events.length} events and ${plan2.outreach.length} partner pitches (${plan2.by})`);
  // Taste twins: venues anywhere whose crowd overlaps with this one (no location filter). Their programme is a proven playbook.
  // Prefer rooms in other cities (a proven playbook elsewhere); fall back to same-city rooms not already pitched.
  let twins = [];
  try { const local = new Set((lanesData.place || []).map(p => p.id)); const seen = new Set([venue.name]);
    const cand = (await qloo.insights({ 'filter.type': 'urn:entity:place', 'signal.interests.entities': venue.id, 'filter.exclude.entities': venue.id, take: 50 }))
      .filter(t => t.id !== venue.id && !local.has(t.id) && !seen.has(t.name) && seen.add(t.name));
    const away = cand.filter(t => t.metro && venue.metro ? t.metro !== venue.metro : t.city !== venue.city);
    twins = (away.length ? away : cand).slice(0, 5);
    step('qloo.insights', `Taste twins${away.length ? ' worldwide' : ' nearby'}: ${twins.slice(0, 3).map(t => t.name + (t.city ? ' (' + t.city + ')' : '')).join(', ') || 'none'}`, { twins: twins.length }); }
  catch (e) { step('qloo.insights', `Taste twins unavailable (${e.message})`); }
  const summary = programmeSummary(plan2.events); step('score', `Programme fit ${summary.avgFit ?? 'n/a'}/100 · ${summary.hiddenGems} hidden gems · ${summary.lanes} formats · ${summary.repeats} repeats`);
  const generic = enabled(env) ? await genericGuess(venue, goal, env) : null;
  return { venue, city, goal, tags, personas: personas(tags), lanes: plan.lanes, lanesData, calendar: plan2.events, outreach: plan2.outreach, twins, summary, generic, qlooCalls: qloo.calls };
}
module.exports = { run, LANES, planLanesHeuristic, composeHeuristic, score, programmeSummary, personas };
