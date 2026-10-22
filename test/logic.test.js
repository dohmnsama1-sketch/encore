'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const L = require('../src/lanes'); const C = require('../src/compose'); const T = require('../src/tools'); const llm = require('../src/llm');

test('room profile maps a jazz club to music-first lanes', () => {
  const r = L.roomProfile({ tags: [{ id: 'urn:tag:genre:place:jazz_club', name: 'Jazz club', type: 'urn:tag:genre:place' }, { id: 'urn:tag:genre:place:bar', name: 'Bar', type: 'urn:tag:genre:place' }] });
  assert.equal(r.lanes[0], 'artist'); assert.equal(r.categoryTag, 'urn:tag:genre:place:jazz_club');
});

test('goal parsing: audiences, nights and lanes', () => {
  assert.deepEqual(L.audienceForGoal('attract students and younger fans').ages, ['24_and_younger', '25_to_29']);
  assert.ok(!L.audienceForGoal('just fill the room'));
  assert.deepEqual(L.nightsForGoal('fill Monday and Tuesday nights'), ['Mon', 'Tue']);
  assert.deepEqual(L.nightsForGoal(''), ['Tue', 'Thu']);
  const lanes = L.lanesForGoal({ lanes: ['movie', 'book', 'artist'] }, 'live music for students');
  assert.equal(lanes[0], 'artist'); assert.ok(lanes.length <= 4);
});

test('tag labels are human readable', () => {
  assert.equal(L.tagLabel('urn:tag:genre:music:hip_hop'), 'Hip-hop');
  for (const lane of Object.values(L.LANES)) for (const g of lane.genres) assert.match(g, /^urn:tag:/);
});

test('nextDates returns future dates on the requested weekdays', () => {
  const from = new Date(Date.UTC(2026, 9, 22)); // Thursday
  const d = C.nextDates(['Tue', 'Thu'], 2, from);
  assert.equal(d.length, 4);
  for (const x of d) { const dt = new Date(x.date + 'T00:00:00Z'); assert.ok(dt > from); assert.ok([2, 4].includes(dt.getUTCDay())); }
});

const ent = (id, a, p, extra = {}) => ({ id, name: id, affinity: a, popularity: p, ...extra });
function fakeRadar() {
  return {
    artist: [
      { tag: 'urn:tag:genre:music:jazz', label: 'Jazz', score: 0.97, entities: [ent('a1', 0.98, 0.5), ent('a2', 0.97, 0.9), ent('a3', 0.96, 0.6), ent('a4', 0.95, 0.99)] },
      { tag: 'urn:tag:genre:music:funk', label: 'Funk', score: 0.95, entities: [ent('b1', 0.96, 0.4), ent('b2', 0.94, 0.7)] },
      { tag: 'urn:tag:genre:music:soul', label: 'Soul', score: 0.94, entities: [ent('c1', 0.95, 0.3)] } ],
    movie: [{ tag: 'urn:tag:genre:media:drama', label: 'Drama', score: 0.9, entities: [ent('m1', 0.92, 0.5), ent('m2', 0.9, 0.6)] }],
  };
}

test('calendar: grounded, no repeats, mixes formats, alternates gems', () => {
  const radar = fakeRadar();
  const cal = C.buildCalendar({ venue: { name: 'Smalls Jazz Club' }, lanes: ['artist', 'movie'], radar, nights: ['Tue', 'Thu'], weeks: 3, from: new Date(Date.UTC(2026, 9, 22)) });
  assert.equal(cal.length, 6);
  const ids = cal.map(e => e.anchorId); assert.equal(new Set(ids).size, ids.length, 'no repeated anchors');
  assert.ok(cal.some(e => e.format && /screen|cinema/i.test(e.format + e.title)), 'includes a screening');
  for (const e of cal) { assert.ok(e.why && e.promo && e.title); assert.ok(e.affinity > 0); }
  const radarIds = new Set(Object.values(radar).flatMap(r => r.flatMap(g => g.entities.map(x => x.id))));
  const s = C.critique({ events: cal, lanes: ['artist', 'movie'], radarIds, nights: 2 });
  assert.equal(s.groundedPct, 100); assert.equal(s.repeats, 0); assert.ok(s.ok);
});

test('critic flags ungrounded or repeated nights', () => {
  const events = [{ anchorId: 'x', affinity: 0.9, lane: 'artist' }, { anchorId: 'x', affinity: 0.9, lane: 'artist' }];
  const s = C.critique({ events, lanes: ['artist'], radarIds: new Set(), nights: 1 });
  assert.equal(s.ok, false); assert.ok(s.issues.length >= 1); assert.equal(s.groundedPct, 0);
});

test('labels and bookability', () => {
  const pool = C.labelPool([ent('g', 0.98, 0.2), ent('f', 0.97, 0.95), ent('h', 0.8, 0.99), ent('i', 0.85, 0.5)]);
  assert.equal(pool.find(e => e.id === 'g').label, 'Hidden gem');
  assert.equal(C.bookability({ popularity: 0.99 }), 'tribute'); assert.equal(C.bookability({ popularity: 0.5 }), 'book');
});

test('outreach drafts are addressed and signed', () => {
  const p = C.pitches({ venue: { name: "Ronnie Scott's", city: 'London' }, partners: [{ name: 'Brasserie Zedel', distanceM: 120 }], brands: [{ name: 'GREATS', affinity: 0.9 }], twins: [{ name: 'Blue Note Milano', city: 'Milan' }] });
  assert.ok(p.length >= 3);
  for (const x of p) { assert.ok(x.to && x.draft.includes("Ronnie Scott's")); assert.ok(!x.draft.includes("Scott's's")); }
});

test('haversine and mean helpers', () => {
  assert.ok(Math.abs(T.haversine({ lat: 51.5134, lon: -0.1318 }, { lat: 51.5136, lon: -0.1320 }) - 26) < 10);
  assert.equal(T.mean([1, 2, 3]), 2);
});

test('LLM is off unless configured; JSON parsing is forgiving', () => {
  assert.equal(llm.config({}, undefined), null);
  const c = llm.config({ AI_BASE_URL: 'https://example.test/v1', AI_API_KEY: 'k', AI_MODEL: 'm' });
  assert.equal(c.model, 'm');
  assert.equal(llm.config({}, 'oidc-token').provider.includes('gateway'), true);
  assert.deepEqual(llm.parseJSON('```json\n{"a":1}\n```'), { a: 1 });
});
