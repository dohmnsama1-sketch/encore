const test = require('node:test'); const assert = require('node:assert');
const director = require('../src/director'); const { StubQloo } = require('../src/stub'); const { Qloo } = require('../src/qloo');
test('agent plans lanes from goal', () => {
  assert.ok(director.planLanesHeuristic('quiet cafe, book lovers').includes('book'));
  assert.ok(director.planLanesHeuristic('students and gamers').includes('video_game'));
});
test('full run produces a non-repeating calendar and outreach', async () => {
  const steps = []; const r = await director.run({ qloo: new StubQloo(), venueQuery: 'Blue Lantern', city: 'Austin', goal: 'fill Thursdays', env: {}, onStep: s => steps.push(s) });
  assert.equal(r.calendar.length, 8);
  assert.equal(new Set(r.calendar.map(e => e.anchor)).size, 8, 'no repeated anchors');
  assert.ok(r.outreach.length === 2);
  assert.ok(steps.some(s => s.tool === 'qloo.insights'));
});
test('Qloo client builds correct hackathon requests', async () => {
  const seen = []; const orig = global.fetch;
  global.fetch = async (url, opt) => { seen.push({ url, opt }); return { ok: true, status: 200, text: async () => JSON.stringify({ results: { entities: [{ entity_id: 'A', name: 'X', query: { affinity: 0.9 } }] } }) }; };
  try { const q = new Qloo({ apiKey: 'k' }); const r = await q.insights({ 'filter.type': 'urn:entity:artist', 'signal.interests.entities': 'V' }); await q.insights({ 'filter.type': 'urn:entity:artist', 'signal.interests.entities': 'V' });
    assert.equal(r[0].affinity, 0.9); assert.equal(seen.length, 1, 'cached');
    assert.match(seen[0].url, /^https:\/\/hackathon\.api\.qloo\.com\/v2\/insights\?/); assert.equal(seen[0].opt.headers['X-Api-Key'], 'k');
    assert.match(seen[0].url, /filter\.type=urn%3Aentity%3Aartist/); }
  finally { global.fetch = orig; }
});
