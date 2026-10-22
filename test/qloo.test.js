'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { Qloo, LRU, Semaphore, RateLimiter, normalize, rankPlaces, nameScore, norm } = require('../src/qloo');

const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });
const FAKE_KEY = 'test-key-not-real';

test('sends the key only as the X-Api-Key header and caches responses', async () => {
  const seen = [];
  const q = new Qloo({ apiKey: FAKE_KEY, perSecond: 100, fetchImpl: async (url, init) => { seen.push({ url, init }); return json({ results: { entities: [{ entity_id: 'e1', name: 'One', query: { affinity: 0.9 } }] } }, 200, { 'x-month-ratelimit-remaining': '49000', 'x-month-ratelimit-limit': '50000' }); } });
  const a = await q.insights({ 'filter.type': 'urn:entity:artist' });
  const b = await q.insights({ 'filter.type': 'urn:entity:artist' });
  assert.equal(seen.length, 1, 'second call served from cache');
  assert.equal(q.stats.cacheHits, 1);
  assert.equal(seen[0].init.headers['X-Api-Key'], FAKE_KEY);
  assert.ok(!seen[0].url.includes(FAKE_KEY), 'key never in the URL');
  assert.deepEqual(a, b); assert.equal(a[0].affinity, 0.9);
  assert.equal(q.stats.monthRemaining, 49000); assert.equal(q.stats.monthLimit, 50000);
});

test('de-duplicates identical in-flight requests', async () => {
  let n = 0;
  const q = new Qloo({ apiKey: FAKE_KEY, perSecond: 100, fetchImpl: async () => { n++; await new Promise(r => setTimeout(r, 20)); return json({ results: { entities: [] } }); } });
  await Promise.all([q.insights({ x: 1 }), q.insights({ x: 1 }), q.insights({ x: 1 })]);
  assert.equal(n, 1);
});

test('retries 429 and 5xx, then succeeds', async () => {
  let n = 0;
  const q = new Qloo({ apiKey: FAKE_KEY, perSecond: 100, fetchImpl: async () => (++n < 3 ? json({ error: 'busy' }, n === 1 ? 429 : 503) : json({ results: { entities: [] } })) });
  await q.insights({});
  assert.equal(n, 3); assert.equal(q.stats.retries, 2);
});

test('does not retry a 400 and surfaces a QlooError with status', async () => {
  let n = 0;
  const q = new Qloo({ apiKey: FAKE_KEY, perSecond: 100, fetchImpl: async () => { n++; return json({ error: { message: 'bad signal' } }, 400); } });
  await assert.rejects(q.insights({}), e => e.name === 'QlooError' && e.status === 400 && /bad signal/.test(e.message));
  assert.equal(n, 1);
});

test('fails fast on timeout instead of retrying', async () => {
  let n = 0;
  const q = new Qloo({ apiKey: FAKE_KEY, perSecond: 100, timeoutMs: 30, fetchImpl: (url, { signal }) => { n++; return new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))); } });
  await assert.rejects(q.insights({}), e => e.status === 504);
  assert.equal(n, 1);
});

test('refuses to run live without a key', () => { assert.throws(() => new Qloo({}), /QLOO_API_KEY/); });

test('LRU evicts oldest and expires by TTL', async () => {
  const c = new LRU(2, 1000); c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3);
  assert.equal(c.get('b'), undefined); assert.equal(c.get('a'), 1); assert.equal(c.size, 2);
  const t = new LRU(5, 5); t.set('x', 1); await new Promise(r => setTimeout(r, 15)); assert.equal(t.get('x'), undefined);
});

test('Semaphore caps concurrency', async () => {
  const s = new Semaphore(2); let live = 0, peak = 0;
  await Promise.all(Array.from({ length: 6 }, () => s.run(async () => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 10)); live--; })));
  assert.equal(peak, 2);
});

test('RateLimiter paces requests to the configured rate', async () => {
  const r = new RateLimiter(20); const t0 = Date.now();
  for (let i = 0; i < 30; i++) await r.take();
  assert.ok(Date.now() - t0 >= 400, 'about 10 extra tokens at 20/s takes ~500ms');
});

test('normalize maps Qloo entities to a compact shape', () => {
  const e = normalize({ entity_id: 'X', name: 'Smalls', subtype: 'urn:entity:place', popularity: 0.9, query: { affinity: 0.8, measurements: { audience_growth: 0.1 } }, location: { lat: 1, lon: 2 },
    properties: { address: '183 W 10th St', geocode: { city: 'New York', country_code: 'US' }, image: { url: 'https://img' } }, tags: [{ tag_id: 't', name: 'Jazz', type: 'urn:tag:genre:place' }] });
  assert.equal(e.id, 'X'); assert.equal(e.affinity, 0.8); assert.equal(e.city, 'New York'); assert.equal(e.lat, 1); assert.equal(e.lon, 2);
  assert.equal(e.growth, 0.1); assert.equal(e.image, 'https://img'); assert.equal(e.tags[0].id, 't');
});

test('venue ranking prefers the exact name in the right city', () => {
  assert.equal(norm("Ronnie Scott's"), 'ronnie scotts');
  assert.ok(nameScore('Smalls Jazz Club', 'Smalls Jazz Club') > nameScore('Smalls Bar', 'Smalls Jazz Club'));
  const ranked = rankPlaces([{ name: 'Statue of Liberty', city: 'New York' }, { name: 'Smalls Jazz Club', city: 'New York' }, { name: 'Smalls Jazz Club', city: 'Paris' }], 'Smalls Jazz Club', 'New York');
  assert.equal(ranked[0].name, 'Smalls Jazz Club'); assert.equal(ranked[0].city, 'New York');
});
