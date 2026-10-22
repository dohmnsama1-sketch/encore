'use strict';
// Qloo client for the hackathon environment (https://hackathon.api.qloo.com).
// - Key is sent only in the X-Api-Key header, server-side. It never reaches the browser.
// - Responses are cached privately in server memory (LRU + TTL). Nothing is written to disk or to the repo,
//   as the hackathon terms require.
// - Timeouts, retry with exponential backoff + jitter on 429/5xx/network errors, a concurrency cap,
//   and in-flight request de-duplication protect both the key's quota and the user experience.

const DEFAULT_BASE = 'https://hackathon.api.qloo.com';

class LRU {
  constructor(max = 2000, ttlMs = 6 * 3600e3) { this.max = max; this.ttl = ttlMs; this.map = new Map(); }
  get(k) {
    const v = this.map.get(k); if (!v) return undefined;
    if (Date.now() - v.t > this.ttl) { this.map.delete(k); return undefined; }
    this.map.delete(k); this.map.set(k, v); return v.v;
  }
  set(k, v) { this.map.delete(k); this.map.set(k, { v, t: Date.now() }); while (this.map.size > this.max) this.map.delete(this.map.keys().next().value); }
  get size() { return this.map.size; }
}

class Semaphore {
  constructor(n) { this.n = n; this.q = []; }
  async run(fn) {
    if (this.n <= 0) await new Promise(r => this.q.push(r));
    this.n--;
    try { return await fn(); } finally { this.n++; const next = this.q.shift(); if (next) next(); }
  }
}

class QlooError extends Error {
  constructor(message, status, path) { super(message); this.name = 'QlooError'; this.status = status; this.path = path; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Token bucket: the hackathon key allows 10 requests/second (x-second-ratelimit-limit). We pace at 8/s by default
// so parallel agent tool calls never trip a 429.
class RateLimiter {
  constructor(perSecond = 8) { this.rate = perSecond; this.tokens = perSecond; this.last = Date.now(); this.chain = Promise.resolve(); }
  take() {
    const p = this.chain.then(async () => {
      for (;;) {
        const now = Date.now(); this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate); this.last = now;
        if (this.tokens >= 1) { this.tokens -= 1; return; }
        await sleep(Math.ceil(((1 - this.tokens) / this.rate) * 1000));
      }
    });
    this.chain = p.catch(() => {}); return p;
  }
}

class Qloo {
  constructor({ apiKey, baseUrl = DEFAULT_BASE, timeoutMs = 12000, retries = 3, concurrency = 6, perSecond = 8, cache, fetchImpl } = {}) {
    if (!apiKey) throw new Error('QLOO_API_KEY is required for live mode');
    this.apiKey = apiKey; this.base = String(baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    this.timeoutMs = timeoutMs; this.retries = retries; this.sem = new Semaphore(concurrency);
    this.cache = cache || new LRU(); this.inflight = new Map(); this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.limiter = new RateLimiter(perSecond);
    this.stats = { calls: 0, cacheHits: 0, retries: 0, errors: 0, monthRemaining: null, monthLimit: null };
  }
  get calls() { return this.stats.calls; }

  url(path, params = {}) {
    const u = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    return u.toString();
  }

  async get(path, params = {}, opts = {}) {
    const key = this.url(path, params);
    const hit = this.cache.get(key);
    if (hit !== undefined) { this.stats.cacheHits++; return hit; }
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = this.sem.run(() => this._fetchWithRetry(path, key, opts)).then(j => { this.cache.set(key, j); return j; }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async _fetchWithRetry(path, url, { timeoutMs = this.timeoutMs, retries = this.retries } = {}) {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) { this.stats.retries++; await sleep(Math.min(4000, 400 * 2 ** attempt) + Math.random() * 250); }
      await this.limiter.take();
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        this.stats.calls++;
        const r = await this.fetch(url, { headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' }, signal: ctrl.signal });
        const rem = r.headers && r.headers.get && r.headers.get('x-month-ratelimit-remaining');
        if (rem != null && rem !== '') { this.stats.monthRemaining = Number(rem); this.stats.monthLimit = Number(r.headers.get('x-month-ratelimit-limit')) || null; }
        const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
        if (r.ok) return j;
        const msg = (j && (j.error?.message || j.message || j.error)) || String(text).slice(0, 160);
        last = new QlooError(`Qloo ${path} ${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, r.status, path);
        if (!(r.status === 429 || r.status >= 500)) break; // 4xx (bad params, unsupported type) won't improve on retry
      } catch (e) {
        if (e.name === 'AbortError') { last = new QlooError(`Qloo ${path} timed out after ${timeoutMs}ms`, 504, path); break; } // a slow query won't get faster: fail fast, caller degrades
        last = new QlooError(`Qloo ${path} network error: ${e.message}`, 0, path);
      } finally { clearTimeout(timer); }
    }
    this.stats.errors++;
    throw last;
  }

  // ---- Endpoints -------------------------------------------------------------------------
  async search(query, types = 'urn:entity:place', take = 10) {
    const j = await this.get('/search', { query, types, take });
    return (j.results || []).map(normalize);
  }
  async insights(params, opts) {
    const j = await this.get('/v2/insights', { take: 10, ...params }, opts);
    return ((j.results && j.results.entities) || []).map(normalize);
  }
  async tagInsights(params) {
    const j = await this.get('/v2/insights', { 'filter.type': 'urn:tag', take: 30, ...params });
    return ((j.results && (j.results.tags || j.results.entities)) || []).map(t => ({
      id: t.tag_id || t.id, name: t.name, subtype: t.subtype || t.type, affinity: t.query?.affinity, popularity: t.popularity,
    })).filter(t => t.name);
  }
  async demographics(entityId) {
    const j = await this.get('/v2/insights', { 'filter.type': 'urn:demographics', 'signal.interests.entities': entityId });
    const d = j.results && j.results.demographics && j.results.demographics[0];
    return d ? { age: d.query?.age || {}, gender: d.query?.gender || {} } : null;
  }
  async heatmap(params, opts) {
    const j = await this.get('/v2/insights', { 'filter.type': 'urn:heatmap', take: 50, ...params }, { timeoutMs: 25000, ...opts });
    if (j.results && j.results.heatmap) return { cells: j.results.heatmap.map(h => ({ lat: h.location.latitude, lon: h.location.longitude, geohash: h.location.geohash, affinity: h.query?.affinity, popularity: h.query?.popularity })) };
    // Locality boundary output: keep names + scores only (boundaries are large WKT polygons we don't need).
    return { areas: ((j.results && j.results.entities) || []).map(e => ({ id: e.entity_id, name: e.name, affinity: e.query?.affinity, popularity: e.popularity, disambiguation: e.disambiguation })) };
  }
  async findTags(query, tagTypes, take = 8) {
    const j = await this.get('/v2/tags', { 'filter.query': query, 'filter.tag.types': tagTypes, take });
    return ((j.results && j.results.tags) || []).map(t => ({ id: t.id, name: t.name, type: t.type, parents: (t.parents || []).map(p => p.type), popularity: t.popularity }));
  }
}

function normalize(e) {
  const p = e.properties || {}; const g = p.geocode || {};
  return {
    id: e.entity_id || e.id, name: e.name, type: e.subtype || (Array.isArray(e.types) ? e.types[0] : e.types) || e.type,
    popularity: e.popularity, affinity: e.query && e.query.affinity,
    explain: e.query && e.query.explainability ? summarizeExplain(e.query.explainability) : undefined,
    city: g.city, metro: g.metro, neighborhood: g.name || p.neighborhood, country: g.country_code, region: g.admin1_region,
    lat: e.location?.lat, lon: e.location?.lon, growth: e.query?.measurements?.audience_growth,
    address: p.address, image: p.image && p.image.url, url: p.website || p.url,
    year: p.release_year || p.publication_year, description: p.description || p.short_description,
    rating: p.business_rating, priceLevel: p.price_level,
    tags: (e.tags || []).map(t => ({ id: t.tag_id || t.id, name: t.name, type: t.type || t.subtype })).filter(t => t.name),
  };
}
function summarizeExplain(x) {
  const list = x['signal.interests.entities'] || x.signal?.interests?.entities || [];
  return Array.isArray(list) ? list.map(s => ({ id: s.entity_id, score: s.score })).filter(s => s.id) : undefined;
}

// ---- Venue resolution ------------------------------------------------------------------
// Qloo search can rank a famous landmark in the city above the exact venue when the city is in the query,
// so we query "name city" and "name" and re-rank by name similarity + city/metro match.
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
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
async function resolveVenue(qloo, name, city = '') {
  const qs = [...new Set([`${name} ${city}`.trim(), String(name).trim()])];
  const lists = await Promise.all(qs.map(q => qloo.search(q, 'urn:entity:place', 10).catch(() => [])));
  const seen = new Set(); const all = [];
  for (const e of lists.flat()) if (e.id && !seen.has(e.id)) { seen.add(e.id); all.push(e); }
  return rankPlaces(all, name, city);
}

module.exports = { Qloo, QlooError, LRU, Semaphore, RateLimiter, normalize, rankPlaces, nameScore, resolveVenue, norm };
