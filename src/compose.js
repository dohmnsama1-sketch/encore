'use strict';
// Turns Qloo tool results into a programme. Deterministic, explainable, and fully grounded:
// every night is anchored on an entity ID that Qloo returned for this venue's crowd.
const { LANES } = require('./lanes');

const poss = n => /s$/i.test(String(n).trim()) ? `${n}'` : `${n}'s`;
const median = a => { const s = a.filter(x => x != null).slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// Label each candidate relative to its own lane (Qloo affinities are compressed, so absolute cut-offs mislead).
function labelPool(pool) {
  const ma = median(pool.map(e => e.affinity)), mp = median(pool.map(e => e.popularity));
  return pool.map(e => {
    let label = 'Strong fit';
    if (e.affinity != null && e.popularity != null && ma != null && mp != null) {
      if (e.affinity >= ma && e.popularity < mp) label = 'Hidden gem';
      else if (e.affinity >= ma) label = 'Crowd favourite';
      else if (e.popularity >= mp) label = 'Crowd-puller';
    }
    return { ...e, label };
  });
}

// Bookability: a small room can actually book a niche act; for global stars Marquee proposes a tribute / listening night.
function bookability(e) {
  if (e.popularity == null) return 'book';
  return e.popularity >= 0.97 ? 'tribute' : 'book';
}

const short = n => { const s = String(n || '').split(/\s+--\s+|:\s/)[0].trim(); return s.length > 48 ? s.slice(0, 45).replace(/\s+\S*$/, '') + '…' : s; };

function titleFor(lane, e, genreLabel) {
  switch (lane) {
    case 'artist': return bookability(e) === 'tribute' ? `${genreLabel || 'Listening'} night: the music of ${short(e.name)}` : `${genreLabel ? genreLabel + ' live: ' : 'Live: '}${short(e.name)}`;
    case 'movie': return `Cinema club: ${short(e.name)}${e.year ? ` (${e.year})` : ''}`;
    case 'book': return `Book club: ${short(e.name)}`;
    case 'podcast': return `Live listening + Q&A: ${short(e.name)}`;
    case 'tv_show': return `Watch party: ${short(e.name)}`;
    case 'videogame': return `Game night: ${short(e.name)}`;
    default: return short(e.name);
  }
}

function whyText(e, venueName, genreLabel) {
  const parts = [];
  if (e.affinity != null) parts.push(`${Math.round(e.affinity * 100)}/100 affinity with ${poss(venueName)} crowd`);
  if (genreLabel) parts.push(`top pick inside ${genreLabel}, one of this crowd's strongest genres`);
  if (e.label === 'Hidden gem') parts.push(`less mainstream than this crowd's other favourites, so it feels like a discovery${e.type === 'urn:entity:artist' ? ' (and is easier to book)' : ''}`);
  if (e.growth > 0) parts.push(`audience growing`);
  return parts.join('; ');
}

function promoTemplate(ev, venue) {
  const L = LANES[ev.lane];
  const hook = { artist: ev.mode === 'tribute' ? `an evening built around the music of ${ev.anchor}` : `${ev.anchor} live, up close`,
    movie: `${ev.anchor} on the big screen, with a pre-show drink`, book: `this month's pick, ${ev.anchor}. Read it, or just come for the talk`,
    podcast: `a live listening session of ${ev.anchor}, then open Q&A`, tv_show: `${ev.anchor}, watched together`, videogame: `${ev.anchor} tournament, couch-co-op style` }[ev.lane] || ev.anchor;
  return `${ev.day} at ${venue.name}: ${hook}. ${L.format}, doors 7pm. Picked because our regulars love it.`;
}

const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function nextDates(nights, weeks, from = new Date()) {
  const out = []; const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1));
  for (let w = 0; w < weeks; w++) for (const d of nights) {
    const dt = new Date(start); const delta = (DAY_INDEX[d] - dt.getUTCDay() + 7) % 7 + w * 7; dt.setUTCDate(dt.getUTCDate() + delta);
    out.push({ week: w + 1, day: d, date: dt.toISOString().slice(0, 10) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Build the calendar. Lanes rotate with the primary lane weighted; within a lane we walk the crowd's strongest genres,
// alternating crowd favourites and hidden gems; bridge picks (if a growth audience was set) take every third slot.
function buildCalendar({ venue, lanes, radar, bridges = [], nights = ['Tue', 'Thu'], weeks = 4, from }) {
  const slots = nextDates(nights, weeks, from);
  const pools = {};
  for (const lane of lanes) {
    const genres = (radar[lane] || []).slice(0, 3);
    const pool = []; const seen = new Set();
    // interleave the top genres so the month isn't one genre
    for (let i = 0; i < 8; i++) for (const g of genres) { const e = g.entities[i]; if (e && !seen.has(e.id)) { seen.add(e.id); pool.push({ ...e, genre: g.label, genreTag: g.tag }); } }
    pools[lane] = labelPool(pool);
  }
  const order = []; lanes.forEach((l, i) => { order.push(l); if (i === 0) order.push(l); }); // primary lane twice per cycle
  const used = new Set(); const events = []; let gemTurn = false; let k = 0;
  const bridgeQueue = bridges.filter(b => !used.has(b.id));
  slots.forEach((slot, i) => {
    let pick = null, lane = null, bridge = false;
    if (bridgeQueue.length && i % 3 === 2) { const b = bridgeQueue.shift(); if (b && !used.has(b.entity.id)) { pick = { ...b.entity, genre: b.genre, label: 'Bridge pick' }; lane = b.lane; bridge = true; } }
    for (let tries = 0; !pick && tries < order.length * 2; tries++) {
      lane = order[k++ % order.length]; const pool = (pools[lane] || []).filter(e => !used.has(e.id));
      if (!pool.length) continue;
      pick = (gemTurn ? pool.find(e => e.label === 'Hidden gem') : pool.find(e => e.label !== 'Hidden gem')) || pool[0];
      gemTurn = !gemTurn;
    }
    if (!pick) return;
    used.add(pick.id);
    const ev = { ...slot, lane, format: LANES[lane].format, icon: LANES[lane].icon, anchor: pick.name, anchorId: pick.id, image: pick.image, genre: pick.genre,
      label: pick.label, bridge, mode: lane === 'artist' ? bookability(pick) : 'host', affinity: pick.affinity, popularity: pick.popularity };
    ev.title = titleFor(lane, pick, pick.genre);
    ev.why = bridge ? `Loved by your regulars AND your growth audience (${Math.round((pick.affinity || 0) * 100)}/100 affinity with both signals combined)` : whyText(pick, venue.name, pick.genre);
    ev.promo = promoTemplate(ev, venue);
    events.push(ev);
  });
  return events;
}

function pitches({ venue, partners = [], brands = [], twins = [] }) {
  const out = [];
  const p = partners[0], b = brands[0];
  if (p) out.push({ to: p.name, kind: 'Neighbour cross-promo', affinity: p.affinity, distanceM: p.distanceM,
    draft: `Hi ${p.name} team,\n\nWe run ${venue.name}${p.distanceM ? `, about ${Math.max(1, Math.round(p.distanceM / 100) / 10)} km from you` : ' nearby'}. Taste data shows our crowds overlap strongly, so we'd love to try a simple swap this month: your guests get a drink on us before our events, and we send our audience your way with a "show your ticket" offer.\n\nUp for a quick chat this week?\n\n— ${venue.name}` });
  if (b) out.push({ to: b.name, kind: 'Brand pop-up', affinity: b.affinity,
    draft: `Hi ${b.name} partnerships team,\n\n${poss(venue.name)} regulars over-index on ${b.name} (Qloo taste data, ${Math.round((b.affinity || 0) * 100)}/100 affinity). We're programming themed nights this month and would love you to co-host one: you bring product or a pop-up, we bring a room full of people who already love you.\n\nCould we send over dates?\n\n— ${venue.name}` });
  if (twins[0]) out.push({ to: twins[0].name, kind: 'Taste twin: swap notes', affinity: twins[0].affinity,
    draft: `Hi ${twins[0].name} team,\n\nWe run ${venue.name} in ${venue.city || 'our city'}. Our crowds look remarkably alike on taste data, and we'd love to swap notes on what's working in your programme (and maybe route touring acts between us).\n\nFancy a 20-minute call?\n\n— ${venue.name}` });
  return out;
}

// The critic: checks the plan before it ships and reports a transparent scorecard.
function critique({ events, lanes, radarIds, nights = 2 }) {
  const ids = events.map(e => e.anchorId);
  const grounded = ids.filter(id => radarIds.has(id)).length;
  const fits = events.map(e => e.affinity).filter(x => x != null);
  const issues = [];
  const repeats = ids.length - new Set(ids).size; if (repeats) issues.push(`${repeats} repeated anchor(s)`);
  const usedLanes = new Set(events.map(e => e.lane)); const minFormats = Math.min(3, lanes.length, Math.max(1, Math.ceil(events.length / 2)));
  if (usedLanes.size < minFormats) issues.push(`fewer than ${minFormats} formats`);
  if (grounded < ids.length) issues.push(`${ids.length - grounded} night(s) not grounded in Qloo results`);
  return {
    nights: events.length, avgFit: fits.length ? Math.round(100 * fits.reduce((a, b) => a + b, 0) / fits.length) : null,
    hiddenGems: events.filter(e => e.label === 'Hidden gem').length, bridges: events.filter(e => e.bridge).length,
    formats: usedLanes.size, repeats, groundedPct: ids.length ? Math.round(100 * grounded / ids.length) : 0,
    bookable: events.filter(e => e.lane === 'artist' && e.mode === 'book').length, issues, ok: issues.length === 0,
  };
}

function personas({ dna = [], demographics }) {
  const fam = f => dna.filter(t => t.family === f).map(t => t.name);
  const vibe = [...fam('inclusivity'), ...fam('good_for'), ...fam('customer_identity'), ...fam('amenities'), ...fam('genre')].slice(0, 4);
  const food = fam('specialty_dish').slice(0, 3); const other = dna.filter(t => !['specialty_dish'].includes(t.family)).map(t => t.name);
  const age = demographics && demographics.peak ? demographics.peak.label : null;
  const g = demographics && demographics.gender; const gender = g ? (g.female > 0.15 ? 'skews female' : g.male > 0.15 ? 'skews male' : 'balanced gender mix') : null;
  return { headline: [age ? `Peak age ${age}` : null, gender].filter(Boolean).join(' · '), vibe: vibe.length ? vibe : other.slice(0, 4), food };
}

module.exports = { buildCalendar, labelPool, bookability, titleFor, pitches, critique, personas, nextDates, promoTemplate };
