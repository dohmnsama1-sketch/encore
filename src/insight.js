'use strict';
// Explainability, draw forecasting and crowd comparison, all computed from Qloo signals the agent already fetched.
// Nothing here calls an LLM or invents numbers: every input is a Qloo affinity, popularity or audience-growth value,
// and every formula is printed next to its output in the UI.
const { LANES } = require('./lanes');

const clamp = (x, a = 0, b = 1) => Number.isFinite(x) ? Math.max(a, Math.min(b, x)) : a;
const r2 = x => Math.round(x * 100) / 100;
const tier = p => p == null ? 'unknown' : p >= 0.97 ? 'headliner (very widely known)' : p >= 0.85 ? 'well known' : p >= 0.6 ? 'rising / mid-tier' : 'niche';

// Draw index (0–100): how hard a night should pull THIS crowd. Weights are stated, not learned:
//  50% crowd fit (the entity's Qloo affinity with this venue's audience, rescaled from 0.80–1.00),
//  25% genre strength (how strongly this crowd over-indexes on the whole genre, same scale),
//  25% reach (Qloo popularity: wider awareness pulls walk-ins), +5 if Qloo flags audience growth, +5 for a bridge pick.
const WEIGHTS = { fit: 0.5, genre: 0.25, reach: 0.25, growth: 0.05, bridge: 0.05 };
function drawIndex({ affinity, genreScore, popularity, growth, bridge }) {
  const fit = clamp(((affinity ?? 0.8) - 0.8) / 0.2), genre = clamp(((genreScore ?? affinity ?? 0.8) - 0.8) / 0.2), reach = clamp(popularity ?? 0.5);
  const d = WEIGHTS.fit * fit + WEIGHTS.genre * genre + WEIGHTS.reach * reach + (growth > 0 ? WEIGHTS.growth : 0) + (bridge ? WEIGHTS.bridge : 0);
  return { index: Math.round(clamp(d) * 100), parts: { fit: r2(fit), genre: r2(genre), reach: r2(reach), growth: growth > 0, bridge: !!bridge } };
}

// "Why this works": attach traceable evidence and plain-English reasons to every night.
function explain(events, radar, { venue, proxies = [], city, audience } = {}) {
  for (const ev of events) {
    const genres = radar[ev.lane] || [];
    const gi = genres.findIndex(g => g.label === ev.genre); const g = genres[gi];
    const pool = g ? g.entities : []; const ri = pool.findIndex(e => e.id === ev.anchorId);
    const ent = (pool[ri] || {});
    const via = ent.via || (g && g.via) || 'venue';
    const signal = via === 'venue' ? `${venue.name}'s own audience (venue entity as the Qloo signal)`
      : via === 'signature artists' ? `this crowd's signature artists (${proxies.slice(0, 3).map(p => p.name).join(', ')}), because Qloo has no direct ${LANES[ev.lane] ? LANES[ev.lane].label.toLowerCase() : ''} signal for the venue`
      : via === 'crowd tags' ? 'this crowd\'s taste tags (fallback signal)' : via;
    const growth = ent.growth;
    const draw = drawIndex({ affinity: ev.affinity, genreScore: g && g.score, popularity: ev.popularity, growth, bridge: ev.bridge });
    const reasons = [];
    if (ev.affinity != null) reasons.push(`${Math.round(ev.affinity * 100)}/100 Qloo affinity with this crowd${ri >= 0 ? ` (#${ri + 1} of ${pool.length} Qloo returned in ${ev.genre})` : ''}.`);
    if (g) reasons.push(`${ev.genre} ranks #${gi + 1} of ${genres.length} ${LANES[ev.lane] ? LANES[ev.lane].label.toLowerCase() : ''} genres tested for this crowd (score ${Math.round(g.score * 100)}).`);
    if (ev.popularity != null) reasons.push(`Reach: ${tier(ev.popularity)} (Qloo popularity ${Math.round(ev.popularity * 100)}). ${ev.mode === 'tribute' ? 'Too big to book for a small room, so it is programmed as a tribute or listening night.' : 'Small enough to book directly.'}`);
    if (ev.label === 'Hidden gem') reasons.push('Hidden gem: higher affinity but lower popularity than this crowd\'s other picks, so it feels like a discovery.');
    if (ev.bridge && audience) reasons.push(`Bridge pick: also over-indexed by ${audience.label} (Qloo age signal combined with the crowd signal).`);
    if (growth > 0) reasons.push('Qloo flags growing audience interest.');
    if (ev.lane === 'artist' && city) reasons.push(`Localised to ${city} (signal.location).`);
    ev.evidence = { signal, via, affinity: ev.affinity, popularity: ev.popularity, growth: growth ?? null, genre: ev.genre, genreRank: gi + 1, genresTested: genres.length, genreScore: g ? g.score : null, rankInGenre: ri + 1, poolSize: pool.length };
    ev.reasons = reasons; ev.draw = draw;
  }
  return events;
}

// Draw estimate for an idea the user gut-checked (so the forecast can compare it with the programmed month).
function ideaDraw(g) { if (!g || g.score == null) return null; const top = g.bookThese && g.bookThese[0];
  return drawIndex({ affinity: g.score, genreScore: g.score, popularity: top ? top.popularity : 0.5 }); }

// Compare two crowds (two venues, possibly in two cities) on the same Qloo genre set.
function compareCrowds(A, B) {
  const ga = new Map(A.radar.map(g => [g.tag, g])), gb = new Map(B.radar.map(g => [g.tag, g]));
  const shared = [...ga.keys()].filter(t => gb.has(t));
  const rows = shared.map(t => ({ tag: t, label: ga.get(t).label, a: ga.get(t).score, b: gb.get(t).score, delta: r2((ga.get(t).score - gb.get(t).score) * 100) / 100 }))
    .sort((x, y) => (y.a + y.b) - (x.a + x.b));
  const mad = rows.length ? rows.reduce((s, r) => s + Math.abs(r.a - r.b), 0) / rows.length : 1;
  // Rank agreement (Spearman) between the two crowds' genre orderings, plus closeness of scores.
  const rank = key => new Map(rows.slice().sort((x, y) => y[key] - x[key]).map((r, i) => [r.tag, i]));
  const ra = rank('a'), rb = rank('b'); const n = rows.length;
  const rho = n > 2 ? 1 - (6 * rows.reduce((s, r) => s + (ra.get(r.tag) - rb.get(r.tag)) ** 2, 0)) / (n * (n * n - 1)) : 0;
  const ids = x => new Map(x.radar.flatMap(g => g.entities.slice(0, 6).map(e => [e.id, e])));
  const ea = ids(A), eb = ids(B); const both = [...ea.keys()].filter(id => eb.has(id)).map(id => ({ id, name: ea.get(id).name, a: ea.get(id).affinity, b: eb.get(id).affinity }));
  const ta = new Set(A.dna.map(t => t.name)), tb = new Set(B.dna.map(t => t.name)); const tagShared = [...ta].filter(t => tb.has(t));
  const tagJ = ta.size + tb.size ? tagShared.length / new Set([...ta, ...tb]).size : 0;
  const overlap = Math.round(100 * clamp(0.45 * clamp(1 - mad / 0.08) + 0.35 * clamp((rho + 1) / 2) + 0.2 * tagJ));
  const moreA = rows.filter(r => r.a - r.b >= 0.015).sort((x, y) => (y.a - y.b) - (x.a - x.b)).slice(0, 4);
  const moreB = rows.filter(r => r.b - r.a >= 0.015).sort((x, y) => (y.b - y.a) - (x.b - x.a)).slice(0, 4);
  const verdict = overlap >= 70 ? 'Near-identical taste: share acts, route tours through both rooms, co-promote.'
    : overlap >= 45 ? 'Related crowds: share the genres they agree on, keep each room\'s signature nights distinct.'
    : 'Different crowds: programme each room on its own data.';
  return { overlap, verdict, rank: r2(rho), meanGap: Math.round(mad * 100), genres: rows, moreA, moreB, sharedFavourites: both.slice(0, 10), sharedTags: tagShared.slice(0, 10) };
}

module.exports = { drawIndex, explain, ideaDraw, compareCrowds, WEIGHTS, tier };
