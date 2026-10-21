// Offline stand-in for Qloo used ONLY for tests and UI preview when no API key is set.
// All names are fictional and the UI labels this mode "SAMPLE DATA, not Qloo".
const N = { 'urn:entity:artist': ['The Velvet Hours', 'Nadia Sol', 'Low Tide Collective', 'Marrow & Moss', 'Kite Theory'],
  'urn:entity:movie': ['Midnight Ferry', 'The Last Lantern', 'Paper Suns', 'Northbound'], 'urn:entity:podcast': ['Slow Money Show', 'Small Rooms Radio', 'The Long Table'],
  'urn:entity:book': ['Salt and Saffron', 'The Quiet Engine'], 'urn:entity:tv_show': ['Harbour Lights'], 'urn:entity:videogame': ['Lantern Rally'],
  'urn:entity:brand': ['Copperleaf Coffee', 'Northwind Vinyl'], 'urn:entity:place': ['Juniper Books', 'Atlas Record Shop', 'Fig & Ember Bakery'] };
class StubQloo {
  constructor() { this.calls = 0; this.stub = true; }
  async searchPlace(q) { this.calls++; return [{ id: 'stub-venue', name: String(q).split(' ').slice(0, 3).join(' ') || 'Sample Venue', type: 'urn:entity:place', address: 'Sample City' }]; }
  async tasteTags() { this.calls++; return ['Indie', 'Jazz', 'Cocktail bar', 'Vinyl', 'Late night', 'Date night'].map((name, i) => ({ id: `t${i}`, name, affinity: 0.9 - i * 0.07 })); }
  async insights(p) { this.calls++;
    if (p['filter.type'] === 'urn:entity:place' && !p['filter.location.query']) return ['Sample Twin Club (Lisbon)', 'Sample Twin Bar (Berlin)', 'Sample Twin Room (Melbourne)'].map((name, i) => ({ id: `twin:${i}`, name, type: 'urn:entity:place', affinity: +(0.9 - i * 0.05).toFixed(2), popularity: 0.5, tags: [] }));
    return (N[p['filter.type']] || []).map((name, i) => ({ id: `${p['filter.type']}:${i}`, name, type: p['filter.type'], affinity: +(0.95 - i * 0.06).toFixed(2), popularity: +(0.75 - i * 0.12).toFixed(2), tags: [] })); }
}
module.exports = { StubQloo };
