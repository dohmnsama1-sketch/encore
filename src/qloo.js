// Qloo client (hackathon environment). GET /search and GET /v2/insights with X-Api-Key.
// Responses are cached privately in memory only (never written to the public repo).
class Qloo {
  constructor({ apiKey, baseUrl = 'https://hackathon.api.qloo.com' }) { this.apiKey = apiKey; this.base = baseUrl.replace(/\/$/, ''); this.cache = new Map(); this.calls = 0; }
  async get(path, params) {
    const u = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    const key = u.toString();
    if (this.cache.has(key)) return this.cache.get(key);
    this.calls++;
    const r = await fetch(key, { headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' } });
    const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
    if (!r.ok) { const e = new Error(`Qloo ${path} ${r.status}: ${(j && (j.error?.message || j.message)) || text.slice(0, 120)}`); e.status = r.status; throw e; }
    this.cache.set(key, j); return j;
  }
  // Venue resolution: query "name city" and "name" alone, then rank by name match + city/metro match.
  // (Qloo search can rank a big landmark in the city above the exact venue when the city is in the query.)
  async searchPlace(name, city = '') {
    const qs = [...new Set([`${name} ${city}`.trim(), name.trim()])];
    const lists = await Promise.all(qs.map(query => this.get('/search', { query, types: 'urn:entity:place', take: 10 }).then(j => j.results || []).catch(() => [])));
    const seen = new Set(); const all = [];
    for (const e of lists.flat()) { const n = normalize(e); if (n.id && !seen.has(n.id)) { seen.add(n.id); all.push(n); } }
    return rankPlaces(all, name, city);
  }
  async insights(params) {
    const j = await this.get('/v2/insights', { take: 10, 'feature.explainability': true, ...params });
    return ((j.results && j.results.entities) || []).map(normalize);
  }
  // Crowd taste tags. Menu-item tags (urn:tag:specialty_dish) are kept but ranked last so the
  // crowd's vibe/genre/audience tags lead, and at most 3 dishes are shown.
  async tasteTags(venueId) {
    try { const j = await this.get('/v2/insights', { 'filter.type': 'urn:tag', 'signal.interests.entities': venueId, take: 40 });
      const all = ((j.results && (j.results.tags || j.results.entities)) || []).map(t => ({ id: t.tag_id || t.id || t.entity_id, name: t.name, type: t.subtype || t.type, affinity: t.query?.affinity }));
      const seen = new Set(); const uniq = all.filter(t => t.name && !seen.has(t.name.toLowerCase()) && seen.add(t.name.toLowerCase()));
      const dish = t => /specialty_dish/.test(t.type || '');
      return [...uniq.filter(t => !dish(t)), ...uniq.filter(dish).slice(0, 3)].slice(0, 15); }
    catch { return []; }
  }
}
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an)\b/g, ' ').trim();
function nameScore(cand, q) {
  const a = norm(cand), b = norm(q); if (!a || !b) return 0; if (a === b) return 3;
  const A = new Set(a.split(' ')), B = b.split(' '); const hit = B.filter(w => A.has(w)).length / B.length;
  return (a.startsWith(b) || b.startsWith(a) ? 1 : 0) + 2 * hit - 0.1 * Math.max(0, A.size - B.length);
}
function rankPlaces(list, name, city) {
  const c = norm(city);
  return list.map((e, i) => ({ e, s: nameScore(e.name, name) + (c && [e.city, e.metro, e.region, e.address].some(x => norm(x).includes(c)) ? 1.5 : 0) - i * 0.01 }))
    .sort((x, y) => y.s - x.s).map(x => x.e);
}
function normalize(e) {
  const g = (e.properties && e.properties.geocode) || {};
  return { city: g.city, metro: g.metro, region: g.admin2_region || g.admin1_region, country: g.country_code, id: e.entity_id || e.id, name: e.name, type: e.subtype || e.type || (e.types && e.types[0]), popularity: e.popularity, affinity: e.query && e.query.affinity,
    explain: e.query && e.query.explainability, address: e.properties && e.properties.address, image: e.properties && e.properties.image && e.properties.image.url,
    tags: (e.tags || []).slice(0, 6).map(t => t.name), url: e.properties && (e.properties.website || e.properties.url), year: e.properties && (e.properties.release_year || e.properties.publication_year) };
}
module.exports = { Qloo, normalize, rankPlaces, nameScore };
