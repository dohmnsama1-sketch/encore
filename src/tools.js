'use strict';
// Encore's Qloo-grounded tools. The agent (LLM tool-calling or the rules planner) composes these; MCP exposes them.
// Every number Encore shows comes from a field Qloo returned: affinity, popularity, audience_growth, demographics.
const { LANES, tagLabel, MUSIC } = require('./lanes');
const { resolveVenue } = require('./qloo');

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const r3 = x => x == null ? null : Math.round(x * 1000) / 1000;
const slim = e => ({ id: e.id, name: e.name, type: e.type, affinity: r3(e.affinity), popularity: r3(e.popularity), growth: e.growth, image: e.image, year: e.year,
  city: e.city, neighborhood: e.neighborhood, address: e.address, lat: e.lat, lon: e.lon, url: e.url, rating: e.rating, priceLevel: e.priceLevel,
  categories: (e.tags || []).filter(t => /genre:place|category:place/.test(t.type || '')).map(t => t.name).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3) });

// 1. Resolve the real venue entity.
async function findVenue(ctx, { venue, city }) {
  const list = await resolveVenue(ctx.qloo, venue, city);
  if (!list.length) { const e = new Error(`Couldn't find "${venue}"${city ? ' in ' + city : ''} in Qloo. Try the venue's full name.`); e.status = 404; throw e; }
  const v = list[0];
  return { ...slim(v), tags: v.tags, description: v.description, alternatives: list.slice(1, 4).map(a => ({ id: a.id, name: a.name, city: a.city, address: a.address })) };
}

// 2. Crowd taste DNA: the tags most associated with this venue's audience, diversified across tag families.
async function crowdDNA(ctx, { venueId }) {
  const tags = await ctx.qloo.tagInsights({ 'signal.interests.entities': venueId, take: 40, 'diversify.by': 'subtype', 'diversify.take': 4 });
  const seen = new Set(); const uniq = tags.filter(t => !seen.has(t.name.toLowerCase()) && seen.add(t.name.toLowerCase()));
  const dish = t => /specialty_dish/.test(t.subtype || '');
  return [...uniq.filter(t => !dish(t)), ...uniq.filter(dish).slice(0, 3)].slice(0, 16)
    .map(t => ({ ...t, name: String(t.name).trim().replace(/^\w/, c => c.toUpperCase()), family: String(t.subtype || '').split(':')[2] || 'tag', affinity: r3(t.affinity) }));
}

// 3. Who the crowd is: Qloo demographic skew (age buckets and gender, -1..1 relative to the general population).
async function crowdDemographics(ctx, { venueId }) {
  const d = await ctx.qloo.demographics(venueId); if (!d) return null;
  const ages = Object.entries(d.age).map(([k, v]) => ({ bucket: k, label: k.replace(/_/g, ' ').replace('and younger', '& under').replace('and older', '& over').replace(' to ', '–'), skew: r3(v) }));
  const top = ages.slice().sort((a, b) => b.skew - a.skew)[0];
  const g = d.gender || {}; const gender = g.female != null ? { female: r3(g.female), male: r3(g.male) } : null;
  return { ages, peak: top, gender };
}

// 4. Genre radar: for each candidate genre, how strongly does THIS crowd over-index on the best entities in it?
//    score = mean Qloo affinity of the top 5 entities (signal = venue, filter = genre, localised for music).
async function genreRadar(ctx, { lane, venueId, city, genres, take = 6 }) {
  const L = LANES[lane]; if (!L) throw new Error(`Unknown lane ${lane}`);
  const list = (genres && genres.length ? genres : L.genres).slice(0, 12);
  if (!list.length) { const ents = await laneEntities(ctx, { lane, venueId, city, take: 12 }); return { lane, genres: [{ tag: null, label: L.label, score: r3(mean(ents.slice(0, 5).map(e => e.affinity))), entities: ents }] }; }
  const rows = await Promise.all(list.map(async tag => {
    try {
      const ents = await laneEntities(ctx, { lane, venueId, city, tag, take });
      if (!ents.length) return null;
      return { tag, label: tagLabel(tag), score: r3(mean(ents.slice(0, 5).map(e => e.affinity))), via: ents[0] && ents[0].via, entities: ents };
    } catch { return null; }
  }));
  const genresOut = rows.filter(Boolean).sort((a, b) => b.score - a.score);
  return { lane, genres: genresOut };
}

// Entities for one lane. Signal = the venue entity. Qloo doesn't accept every place as a cross-domain signal for every
// entity type (some return 400, or results without affinity, which means the signal was ignored). Encore then falls back
// to the crowd's signature artists (ctx.proxies) and finally to the crowd's taste tags, and labels the result `via`.
async function laneEntities(ctx, { lane, venueId, city, tag, take = 10, ages, exclude }) {
  const L = LANES[lane];
  const base = { 'filter.type': L.type, take, 'filter.tags': tag };
  if (L.local && city) base['signal.location.query'] = city;
  if (ages && ages.length) { base['signal.demographics.age'] = ages.join(','); base['signal.demographics.age.weight'] = 'high'; }
  if (exclude && exclude.length) base['filter.exclude.entities'] = exclude.join(',');
  const signals = [{ via: 'venue', p: { 'signal.interests.entities': venueId } }];
  if (ctx.proxies && ctx.proxies.length) signals.push({ via: 'signature artists', p: { 'signal.interests.entities': ctx.proxies.map(e => e.id).join(',') } });
  if (ctx.dnaTags && ctx.dnaTags.length) signals.push({ via: 'crowd tags', p: { 'signal.interests.tags': ctx.dnaTags.join(','), 'operator.signal.interests.tags': 'union' } });
  let lastErr = null;
  for (const sig of signals) {
    const p = { ...base, ...sig.p };
    try {
      let ents;
      try { ents = await ctx.qloo.insights(p); }
      catch (e) { if (p['signal.location.query'] && e.status === 400) { delete p['signal.location.query']; ents = await ctx.qloo.insights(p); } else throw e; }
      const scored = ents.filter(e => e.affinity != null);
      if (!ents.length) return [];                       // valid signal, nothing in this genre
      if (scored.length) return scored.map(e => ({ ...slim(e), via: sig.via }));
      lastErr = Object.assign(new Error('signal ignored'), { status: 422 });
    } catch (e) { lastErr = e; if (e.status !== 400 && e.status !== 422) throw e; }
  }
  throw lastErr || new Error('no usable signal');
}

// The crowd's signature artists: used as a taste proxy for entity types where the venue itself isn't a valid signal.
async function signatureArtists(ctx, { venueId, city, take = 5 }) {
  const c = { qloo: ctx.qloo };   // venue signal only, no fallback
  return laneEntities(c, { lane: 'artist', venueId, city, take });
}

// Prepare fallback signals for a standalone tool call (gut check / MCP). Results are cached by the client.
async function prepareCtx(ctx, { venueId, city }) {
  const [sig, dna] = await Promise.all([signatureArtists(ctx, { venueId, city }).catch(() => []), crowdDNA(ctx, { venueId }).catch(() => [])]);
  ctx.proxies = sig.slice(0, 3); ctx.dnaTags = dna.filter(t => t.id && !/specialty_dish/.test(t.id)).slice(0, 5).map(t => t.id);
  return ctx;
}

// 5. Bridge picks: entities loved by the current crowd AND by a target age group (grow without alienating regulars).
async function bridgePicks(ctx, { lane, venueId, city, tag, ages, baseline = [] }) {
  const ents = await laneEntities(ctx, { lane, venueId, city, tag, ages, take: 10 });
  const base = new Set(baseline.map(e => e.id));
  return ents.map(e => ({ ...e, newToPlan: !base.has(e.id) }));
}

// 6. Neighbour partners: places near the venue its crowd also loves (cross-promo, pre/post-show deals).
async function neighbourPartners(ctx, { venue, take = 8 }) {
  const p = { 'filter.type': 'urn:entity:place', 'signal.interests.entities': venue.id, 'filter.exclude.entities': venue.id, take: 20 };
  if (venue.lat != null) { p['filter.location'] = `POINT(${venue.lon} ${venue.lat})`; p['filter.location.radius'] = 1500; }
  else if (venue.city) p['filter.location.query'] = venue.city;
  const all = (await ctx.qloo.insights(p)).map(slim);
  const generic = /^(place|restaurant|bar|tourist attraction|event venue|point of interest|establishment|shopping)$/i;
  const own = new Set((venue.categories || []).filter(c => !generic.test(c)).map(c => c.toLowerCase()));
  const withDist = e => ({ ...e, distanceM: venue.lat != null && e.lat != null ? Math.round(haversine(venue, e)) : null });
  const isRival = e => e.categories.some(c => own.has(c.toLowerCase()));
  return { partners: all.filter(e => !isRival(e)).slice(0, take).map(withDist), rivals: all.filter(isRival).slice(0, 5).map(withDist) };
}

// 7. Brand collaborators the crowd over-indexes on.
async function brandCollabs(ctx, { venueId, take = 6 }) {
  try { return (await ctx.qloo.insights({ 'filter.type': 'urn:entity:brand', 'signal.interests.entities': venueId, take })).map(slim); }
  catch (e) {
    // Some places aren't valid brand signals in the hackathon index (400): fall back to the crowd's signature artists.
    if (e.status !== 400 || !(ctx.proxies && ctx.proxies.length)) throw e;
    return (await ctx.qloo.insights({ 'filter.type': 'urn:entity:brand', 'signal.interests.entities': ctx.proxies.map(x => x.id).join(','), take }, { timeoutMs: 8000 })).map(x => ({ ...slim(x), via: 'signature artists' }));
  }
}

// 8. Taste twins: same kind of room, other cities, whose crowds overlap most with yours (one per city).
async function tasteTwins(ctx, { venue, categoryTag, take = 6 }) {
  const p = { 'filter.type': 'urn:entity:place', 'signal.interests.entities': venue.id, 'filter.exclude.entities': venue.id, take: 20, 'diversify.by': 'properties.geocode.city', 'diversify.take': 1 };
  if (categoryTag) p['filter.tags'] = categoryTag;
  let list = (await ctx.qloo.insights(p)).map(slim);
  if (list.length < 3 && categoryTag) { delete p['filter.tags']; list = (await ctx.qloo.insights(p)).map(slim); }
  const away = list.filter(e => e.city && venue.city && e.city !== venue.city);
  return (away.length >= 3 ? away : list).slice(0, take);
}

// 9. Flyer zones: neighbourhoods in the city where this crowd's taste concentrates (Qloo heatmap, locality boundary),
//    plus geohash cells for the map.
async function flyerZones(ctx, { venueId, city, venueCity }) {
  const where = city || venueCity;
  const [areas, cells] = await Promise.all([
    ctx.qloo.heatmap({ 'signal.interests.entities': venueId, 'filter.location.query': where, 'output.heatmap.boundary': 'urn:entity:locality', take: 30 }).then(r => r.areas || []).catch(() => []),
    ctx.qloo.heatmap({ 'signal.interests.entities': venueId, 'filter.location.query': where, take: 50 }).then(r => r.cells || []).catch(() => []),
  ]);
  const lc = x => String(x || '').toLowerCase();
  const broad = /(^united states|^contiguous|county$|community district|^greater |^inner london$|^outer london$|^england$|^france$|^[iî]le-de-france$|^long island$|^new jersey$|^manhattan$|^brooklyn$|^queens$|^the bronx$|^bronx$|^staten island$|^westchester$|^nassau$)/i;
  const seen = new Set([lc(where), lc(venueCity), 'new york', 'los angeles', 'london', 'paris']);
  const clean = n => String(n).replace(/^(London Borough of|Royal Borough of|City of|Borough of)\s+/i, '').trim();
  const broad2 = /^(great britain|united kingdom|outer london.*|inner london.*|greater london|westchester|europe)$/i;
  // Tiny estates/blocks can top the list on noise; prefer well-known areas (Qloo popularity) when there are enough.
  const named = areas.filter(a => a.name && !broad.test(a.name) && !broad2.test(a.name));
  const known = named.filter(a => (a.popularity ?? 1) >= 0.8);
  const neighbourhoods = (known.length >= 4 ? known : named).map(a => ({ name: clean(a.name), affinity: r3(a.affinity) }))
    .filter(a => !seen.has(lc(a.name)) && seen.add(lc(a.name))).slice(0, 8);
  return { neighbourhoods, cells: cells.slice(0, 50).map(c => ({ lat: c.lat, lon: c.lon, affinity: r3(c.affinity) })) };
}

// 10. Gut check: the owner's own idea ("salsa night", "K-pop", "horror double bill") scored against this crowd.
async function gutCheck(ctx, { idea, venueId, city, radar = {} }) {
  const text = String(idea || '').replace(/\b(night|nights|evening|party|club|session|series|event|a|an|the|do|host|run|weekly|monthly)\b/gi, ' ').replace(/\s+/g, ' ').trim() || String(idea || '');
  const tags = await ctx.qloo.findTags(text, undefined, 12);
  const laneOf = t => (t.parents.includes('urn:entity:artist') && /:music:/.test(t.id)) ? 'artist' : t.parents.includes('urn:entity:movie') ? 'movie' : t.parents.includes('urn:entity:book') ? 'book' : t.parents.includes('urn:entity:podcast') ? 'podcast' : t.parents.includes('urn:entity:tv_show') ? 'tv_show' : null;
  const raw = String(idea || '').toLowerCase();
  const hint = /film|movie|cinema|screening|double bill/.test(raw) ? 'movie' : /book|read|novel|poet|author|literar/.test(raw) ? 'book' : /podcast|talk|q&a|lecture/.test(raw) ? 'podcast' : /tv|series|show|finale/.test(raw) ? 'tv_show' : null;
  const slugText = text.toLowerCase().replace(/\b(films?|movies?|books?|novels?|podcasts?|talks?|music|tv|series)\b/g, ' ').trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const pref = t => (hint && laneOf(t) === hint ? 4 : 0) + (t.id.split(':').pop() === slugText ? 2 : 0) + (!hint && /:music:/.test(t.id) ? 1 : 0);
  const cand = tags.filter(t => /^urn:tag:genre:/.test(t.id) && laneOf(t)).sort((a, b) => pref(b) - pref(a));
  if (!cand.length) return { idea, verdict: 'unknown', message: `Qloo has no genre tag matching "${idea}". Try a genre or format, e.g. "salsa", "horror films", "poetry".` };
  const tag = cand[0]; const lane = laneOf(tag);
  const ents = await laneEntities(ctx, { lane, venueId, city, tag: tag.id, take: 6 });
  if (!ents.length) return { idea, tag: tag.id, lane, verdict: 'unknown', message: `No ${LANES[lane].label.toLowerCase()} for "${tag.name}" overlap with this crowd in Qloo.` };
  const score = mean(ents.slice(0, 5).map(e => e.affinity));
  let dist = radar[lane];
  if (!dist) dist = (await genreRadar(ctx, { lane, venueId, city, genres: LANES[lane].genres.slice(0, 8) })).genres;
  const scores = dist.map(g => g.score).filter(x => x != null);
  const pct = scores.length ? Math.round(100 * scores.filter(s => s <= score).length / scores.length) : null;
  const best = dist.filter(g => g.tag !== tag.id)[0];
  const verdict = pct == null ? 'unknown' : pct >= 66 ? 'go' : pct >= 33 ? 'tweak' : 'rethink';
  const tn = tagLabel(tag.id);
  const message = verdict === 'go' ? `Go. Your crowd over-indexes on ${tn}: it beats ${pct}% of the ${LANES[lane].label.toLowerCase()} genres Encore tested for them.`
    : verdict === 'tweak' ? `Workable. ${tn} sits mid-pack for this crowd (${pct}th percentile). Pair it with ${best ? best.label : 'a stronger genre'} to lift it.`
    : `Rethink. ${tn} is near the bottom for this crowd (${pct}th percentile). ${best ? `${best.label} is a much stronger fit.` : ''}`;
  return { idea, tag: tag.id, tagName: tagLabel(tag.id), lane, score: r3(score), percentile: pct, verdict, message, bookThese: ents.slice(0, 3), betterBet: best ? { label: best.label, score: best.score, entities: best.entities.slice(0, 3) } : null, tested: scores.length };
}

function haversine(a, b) {
  const R = 6371e3, t = x => x * Math.PI / 180; const dLat = t(b.lat - a.lat), dLon = t(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h));
}

// Tool specs for LLM tool-calling and MCP (JSON Schema).
const SPECS = [
  { name: 'genre_radar', description: 'Score candidate genres for one programme lane by how strongly this venue\'s crowd over-indexes on them (Qloo affinity). Returns genres ranked with top entities.',
    parameters: { type: 'object', properties: { lane: { type: 'string', enum: Object.keys(LANES) }, genres: { type: 'array', items: { type: 'string' }, description: 'Qloo genre tag IDs to test (optional; defaults to the lane\'s verified list).' } }, required: ['lane'] } },
  { name: 'gut_check', description: 'Score an event idea from the owner (e.g. "salsa night", "horror double bill") against this crowd\'s taste and suggest a better bet.',
    parameters: { type: 'object', properties: { idea: { type: 'string' } }, required: ['idea'] } },
  { name: 'bridge_picks', description: 'Find entities loved by the current crowd AND a target age group, to grow the audience without alienating regulars.',
    parameters: { type: 'object', properties: { lane: { type: 'string', enum: Object.keys(LANES) }, ages: { type: 'array', items: { type: 'string', enum: ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'] } } }, required: ['lane', 'ages'] } },
  { name: 'neighbour_partners', description: 'Places within ~1.5 km whose audiences overlap with this venue (cross-promotion partners).', parameters: { type: 'object', properties: {} } },
  { name: 'brand_collabs', description: 'Brands this crowd over-indexes on (pop-up and sponsorship partners).', parameters: { type: 'object', properties: {} } },
  { name: 'taste_twins', description: 'Similar rooms in other cities whose crowds overlap most with this one (proven playbooks).', parameters: { type: 'object', properties: {} } },
  { name: 'flyer_zones', description: 'Neighbourhoods in the city where this crowd\'s taste concentrates (Qloo heatmap), for flyers and local ads.', parameters: { type: 'object', properties: {} } },
];

module.exports = { prepareCtx, signatureArtists, findVenue, crowdDNA, crowdDemographics, genreRadar, laneEntities, bridgePicks, neighbourPartners, brandCollabs, tasteTwins, flyerZones, gutCheck, SPECS, mean, slim, haversine };
