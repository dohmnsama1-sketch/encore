'use strict';
// Programme "lanes" (event formats) and the Qloo genre tags Marquee can test for each.
// Every tag ID below was verified against the hackathon API to return entities for its filter.type.

const G = (prefix, ids) => ids.map(id => `${prefix}${id}`);
const MUSIC = 'urn:tag:genre:music:'; const MEDIA = 'urn:tag:genre:media:';

const LANES = {
  artist: { type: 'urn:entity:artist', label: 'Live music', format: 'Live night', icon: '🎷', local: true,
    genres: G(MUSIC, ['jazz', 'soul', 'neo_soul', 'r_and_b', 'blues', 'funk', 'latin', 'salsa', 'reggaeton', 'hip_hop', 'electronic', 'house',
      'dance', 'disco', 'classical', 'rock', 'punk', 'indie', 'metal', 'country', 'folk_rock', 'singer_songwriter', 'pop', 'reggae', 'gospel', 'afrobeats', 'k_pop', 'ambient']) },
  movie: { type: 'urn:entity:movie', label: 'Screenings', format: 'Cinema club', icon: '🎬',
    genres: G(MEDIA, ['drama', 'comedy', 'documentary', 'thriller', 'crime', 'romance', 'horror', 'musical', 'music', 'animation']) },
  book: { type: 'urn:entity:book', label: 'Book club', format: 'Book club', icon: '📚',
    genres: G(MEDIA, ['fiction', 'literary_fiction', 'history', 'biography', 'mystery', 'poetry', 'science_fiction', 'fantasy', 'romance']) },
  podcast: { type: 'urn:entity:podcast', label: 'Talks & live podcasts', format: 'Live listening + Q&A', icon: '🎙️',
    genres: G(MEDIA, ['comedy', 'arts', 'true_crime', 'business', 'music', 'history', 'food', 'technology', 'sports']) },
  tv_show: { type: 'urn:entity:tv_show', label: 'Watch parties', format: 'Watch party', icon: '📺',
    genres: G(MEDIA, ['comedy', 'drama', 'animation', 'documentary']) },
  videogame: { type: 'urn:entity:videogame', label: 'Game nights', format: 'Game night', icon: '🎮', genres: [] },
};
const PROGRAMME_LANES = Object.keys(LANES);

const PRETTY = { r_and_b: 'R&B', hip_hop: 'Hip-hop', k_pop: 'K-pop', neo_soul: 'Neo-soul', folk_rock: 'Folk rock', singer_songwriter: 'Singer-songwriter',
  true_crime: 'True crime', science_fiction: 'Sci-fi', literary_fiction: 'Literary fiction', tv_show: 'TV', afrobeats: 'Afrobeats', edm: 'EDM' };
function tagLabel(id) {
  const last = String(id || '').split(':').pop();
  return PRETTY[last] || last.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

// The room's identity, from the venue's own Qloo tags (category / genre:place), decides the primary lane and
// which genres to test first. Owner goal keywords can add lanes.
const ROOM_RULES = [
  { re: /jazz/i, lanes: ['artist', 'movie', 'podcast'], seeds: ['jazz', 'soul', 'neo_soul', 'blues', 'funk', 'latin', 'classical', 'r_and_b'] },
  { re: /book|librar|literary/i, lanes: ['book', 'podcast', 'movie', 'artist'], seeds: ['singer_songwriter', 'folk_rock', 'jazz', 'classical'] },
  { re: /cinema|movie|theat|drafthouse|film/i, lanes: ['movie', 'tv_show', 'podcast', 'artist'], seeds: ['electronic', 'rock', 'indie', 'pop'] },
  { re: /comedy/i, lanes: ['podcast', 'tv_show', 'movie', 'artist'], seeds: ['hip_hop', 'pop', 'rock', 'indie'] },
  { re: /night ?club|dance|disco/i, lanes: ['artist', 'tv_show', 'podcast'], seeds: ['house', 'electronic', 'dance', 'disco', 'hip_hop', 'reggaeton', 'afrobeats', 'funk'] },
  { re: /music|concert|live|rock|club/i, lanes: ['artist', 'movie', 'podcast'], seeds: ['rock', 'indie', 'punk', 'singer_songwriter', 'folk_rock', 'electronic', 'soul', 'hip_hop'] },
  { re: /cafe|coffee|tea|bakery/i, lanes: ['book', 'artist', 'podcast', 'movie'], seeds: ['singer_songwriter', 'folk_rock', 'jazz', 'indie', 'ambient', 'classical'] },
  { re: /pub|bar|tavern|brew|wine|cocktail/i, lanes: ['artist', 'tv_show', 'podcast', 'movie'], seeds: ['soul', 'rock', 'indie', 'funk', 'disco', 'country', 'jazz', 'hip_hop'] },
  { re: /restaurant|bistro|eatery|kitchen/i, lanes: ['artist', 'movie', 'podcast', 'book'], seeds: ['jazz', 'soul', 'latin', 'r_and_b', 'disco', 'classical'] },
];
const DEFAULT_ROOM = { lanes: ['artist', 'movie', 'podcast', 'book'], seeds: ['soul', 'jazz', 'rock', 'indie', 'hip_hop', 'electronic', 'singer_songwriter', 'latin'] };

function roomProfile(venue) {
  const cats = (venue.tags || []).filter(t => /genre:place|category:place/.test(t.type || t.id || '')).map(t => t.name);
  const text = [venue.name, ...cats].join(' ');
  const rule = ROOM_RULES.find(r => r.re.test(text)) || DEFAULT_ROOM;
  // The tag that best describes the room (e.g. urn:tag:genre:place:jazz_club) is used to find taste twins of the same kind.
  const placeTags = (venue.tags || []).filter(t => /^urn:tag:genre:place:/.test(t.id || ''));
  const generic = /:(restaurant|restaurant:bar|bar|tourist_attraction|place|event_venue)$/;
  const categoryTag = (placeTags.find(t => rule.re && rule.re.test(t.name) && !generic.test(t.id)) || placeTags.find(t => !generic.test(t.id)) || placeTags.find(t => /:bar$/.test(t.id)) || {}).id;
  return { categories: [...new Set(cats)].slice(0, 6), lanes: rule.lanes.slice(), seeds: rule.seeds.map(s => MUSIC + s), categoryTag };
}

function lanesForGoal(room, goal = '') {
  const g = goal.toLowerCase(); const lanes = room.lanes.slice();
  const add = l => { const i = lanes.indexOf(l); if (i > 0) lanes.splice(i, 1); if (i !== 0) lanes.splice(1, 0, l); };
  if (/book|read|literar|poet|author/.test(g)) add('book');
  if (/film|movie|cinema|screen/.test(g)) add('movie');
  if (/talk|podcast|comedy|q&a|speaker/.test(g)) add('podcast');
  if (/series|show|finale|tv|binge/.test(g)) add('tv_show');
  if (/game|gamer|esport|arcade/.test(g)) add('videogame');
  if (/music|band|dj|gig|live/.test(g)) { const i = lanes.indexOf('artist'); if (i >= 0) lanes.splice(i, 1); lanes.unshift('artist'); }
  return lanes.slice(0, 4);
}

const AGE_BUCKETS = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'];
function audienceForGoal(goal = '') {
  const g = goal.toLowerCase();
  if (/younger|student|gen ?z|uni|college|20s|twenty/.test(g)) return { label: 'under-30s', ages: ['24_and_younger', '25_to_29'] };
  if (/older|mature|40s|50s|professional|after[- ]?work|grown/.test(g)) return { label: '35–54s', ages: ['35_to_44', '45_to_54'] };
  if (/senior|retire|60|65/.test(g)) return { label: '55+', ages: ['55_and_older'] };
  return null;
}

const DAY_NAMES = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
function nightsForGoal(goal = '', fallback = ['Tue', 'Thu']) {
  const found = [...String(goal).toLowerCase().matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*/g)].map(m => DAY_NAMES[m[1]]);
  return found.length ? [...new Set(found)].slice(0, 3) : fallback;
}

module.exports = { LANES, PROGRAMME_LANES, tagLabel, roomProfile, lanesForGoal, audienceForGoal, nightsForGoal, AGE_BUCKETS, MUSIC, MEDIA };
