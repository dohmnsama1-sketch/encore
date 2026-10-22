'use strict';
// Offline stand-in for Qloo, used ONLY for tests and for previewing the UI without an API key.
// Every name is fictional and the UI labels this mode "SAMPLE DATA — not Qloo". No Qloo data is stored in this repo.
const NAMES = {
  'urn:entity:artist': ['The Velvet Hours', 'Nadia Sol', 'Low Tide Collective', 'Marrow & Moss', 'Kite Theory', 'June Arcade', 'Ola Brightwater', 'The Saltlines'],
  'urn:entity:movie': ['Midnight Ferry', 'The Last Lantern', 'Paper Suns', 'Northbound', 'A Quiet Orchard', 'Glass Harbour'],
  'urn:entity:podcast': ['Slow Money Show', 'Small Rooms Radio', 'The Long Table', 'Overheard Downtown', 'Night Shift Notes'],
  'urn:entity:book': ['Salt and Saffron', 'The Quiet Engine', 'Letters to a Small City', 'Wild Acre', 'The Borrowed Coast'],
  'urn:entity:tv_show': ['Harbour Lights', 'Second Shift', 'Copper Valley'], 'urn:entity:videogame': ['Lantern Rally', 'Tiny Kingdoms', 'Orbit Kitchen'],
  'urn:entity:brand': ['Copperleaf Coffee', 'Northwind Vinyl', 'Fieldnote Denim', 'Sable Tonic'],
  'urn:entity:place': ['Juniper Books', 'Atlas Record Shop', 'Fig & Ember Bakery', 'Hollow Pine Bar', 'The Lamplighter'],
};
const hash = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
class StubQloo {
  constructor() { this.stub = true; this.stats = { calls: 0, cacheHits: 0, retries: 0, errors: 0, monthRemaining: null }; }
  get calls() { return this.stats.calls; }
  async search(q) { this.stats.calls++; const name = String(q).split(' ').slice(0, 3).join(' ') || 'Sample Venue';
    return [{ id: 'stub-venue', name, type: 'urn:entity:place', city: 'Sample City', address: '1 Sample Street, Sample City', lat: 40.73, lon: -74.0,
      tags: [{ id: 'urn:tag:genre:place:jazz_club', name: 'Jazz club', type: 'urn:tag:genre:place' }, { id: 'urn:tag:genre:place:bar', name: 'Bar', type: 'urn:tag:genre:place' }] }]; }
  async tagInsights() { this.stats.calls++; return ['Live music', 'Date night', 'Cocktails', 'Vinyl', 'Late night', 'LGBTQ+ friendly'].map((name, i) => ({ id: `t${i}`, name, subtype: 'urn:tag:good_for:qloo', affinity: 0.9 - i * 0.05 })); }
  async demographics() { this.stats.calls++; return { age: { '24_and_younger': -0.2, '25_to_29': 0.3, '30_to_34': 0.2, '35_to_44': 0.05, '45_to_54': -0.1, '55_and_older': -0.3 }, gender: { female: 0.1, male: -0.1 } }; }
  async heatmap(p) { this.stats.calls++;
    if (p['output.heatmap.boundary']) return { areas: ['Sample Heights', 'Old Harbour', 'Mill District', 'Riverside'].map((name, i) => ({ name, affinity: 0.95 - i * 0.1 })) };
    return { cells: Array.from({ length: 12 }, (_, i) => ({ lat: 40.70 + (i % 4) * 0.02, lon: -74.02 + Math.floor(i / 4) * 0.02, affinity: 1 - i * 0.07 })) }; }
  async findTags(q) { this.stats.calls++; return [{ id: `urn:tag:genre:music:${String(q).toLowerCase().replace(/[^a-z]+/g, '_')}`, name: q, parents: ['urn:entity:artist'] }]; }
  async insights(p) { this.stats.calls++;
    const type = p['filter.type']; const salt = hash(String(p['filter.tags'] || '') + (p['signal.demographics.age'] || ''));
    const base = NAMES[type] || []; const ex = new Set(String(p['filter.exclude.entities'] || '').split(','));
    const rot = base.map((_, i) => base[(i + salt) % base.length]);
    const twin = type === 'urn:entity:place' && p['diversify.by'];
    return rot.map((name, i) => ({ id: `${type}:${name}`, name: twin ? `${name} (twin)` : name, type, affinity: +(0.95 - i * 0.03 - (salt % 7) / 100).toFixed(3), popularity: +(0.9 - ((i * 37 + salt) % 50) / 100).toFixed(3),
      city: twin ? ['Lisbon', 'Berlin', 'Melbourne', 'Austin', 'Osaka'][i % 5] : 'Sample City', lat: 40.73 + i * 0.002, lon: -74.0 + i * 0.002,
      tags: type === 'urn:entity:place' ? [{ name: i % 2 ? 'Bookstore' : 'Bakery', type: 'urn:tag:genre:place' }] : [] }))
      .filter(e => !ex.has(e.id)).slice(0, p.take || 10); }
}
module.exports = { StubQloo };
