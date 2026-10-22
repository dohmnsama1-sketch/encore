'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const I = require('../src/insight');

test('drawIndex: weights sum to 1 (+bonuses), higher signals give a higher draw', () => {
  const W = I.WEIGHTS; assert.equal(Math.round((W.fit + W.genre + W.reach) * 100), 100);
  const lo = I.drawIndex({ affinity: 0.82, popularity: 0.2, genreScore: 0.85 });
  const hi = I.drawIndex({ affinity: 0.99, popularity: 0.95, genreScore: 0.97, growth: 1, bridge: true });
  assert.ok(hi.index > lo.index); assert.ok(hi.index <= 100 && lo.index >= 0);
  assert.ok(hi.parts && typeof hi.parts.fit === 'number');
});

test('drawIndex clamps nonsense input', () => {
  const d = I.drawIndex({ affinity: 7, popularity: -3, genreScore: NaN });
  assert.ok(d.index >= 0 && d.index <= 100);
});

test('compareCrowds: identical crowds overlap fully, opposite ones barely', () => {
  const genres = ['jazz', 'soul', 'rock', 'house', 'latin', 'pop'];
  const mk = (vals, tags = ['a', 'b', 'c']) => ({ radar: genres.map((g, i) => ({ tag: g, label: g, score: vals[i], entities: [{ id: g + i, name: g, affinity: vals[i] }] })), dna: tags.map(name => ({ name })) });
  const A = mk([0.97, 0.95, 0.9, 0.85, 0.82, 0.8]);
  const same = I.compareCrowds(A, mk([0.97, 0.95, 0.9, 0.85, 0.82, 0.8]));
  const opp = I.compareCrowds(A, mk([0.8, 0.82, 0.85, 0.9, 0.95, 0.97], ['x', 'y']));
  assert.ok(same.overlap >= 90, 'same ' + same.overlap); assert.ok(opp.overlap < same.overlap - 30, 'opp ' + opp.overlap);
  assert.equal(same.sharedFavourites.length, genres.length); assert.ok(typeof same.verdict === 'string' && same.verdict.length > 10);
});
