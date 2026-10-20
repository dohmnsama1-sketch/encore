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
  async searchPlace(query) {
    const j = await this.get('/search', { query, types: 'urn:entity:place', take: 5 });
    return (j.results || []).map(normalize);
  }
  async insights(params) {
    const j = await this.get('/v2/insights', { take: 10, 'feature.explainability': true, ...params });
    return ((j.results && j.results.entities) || []).map(normalize);
  }
  async tasteTags(venueId) {
    try { const j = await this.get('/v2/insights', { 'filter.type': 'urn:tag', 'signal.interests.entities': venueId, take: 15 });
      return ((j.results && (j.results.tags || j.results.entities)) || []).map(t => ({ id: t.tag_id || t.id || t.entity_id, name: t.name, type: t.subtype || t.type, affinity: t.query?.affinity })); }
    catch { return []; }
  }
}
function normalize(e) {
  return { id: e.entity_id || e.id, name: e.name, type: e.subtype || e.type, popularity: e.popularity, affinity: e.query && e.query.affinity,
    explain: e.query && e.query.explainability, address: e.properties && e.properties.address, image: e.properties && e.properties.image && e.properties.image.url,
    tags: (e.tags || []).slice(0, 6).map(t => t.name), url: e.properties && (e.properties.website || e.properties.url), year: e.properties && (e.properties.release_year || e.properties.publication_year) };
}
module.exports = { Qloo, normalize };
