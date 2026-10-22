'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = x => x == null ? '–' : Math.round(x * 100);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LANE = { artist: 'Live music', movie: 'Screenings', book: 'Book club', podcast: 'Talks & podcasts', tv_show: 'Watch parties', videogame: 'Game nights' };
let last = null; let status = {};

function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1800); }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed'); } }
function download(name, text, type = 'text/plain') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// ---- status + form setup ---------------------------------------------------------
fetch('/api/status').then(r => r.json()).then(s => {
  status = s; const m = $('#mode');
  m.textContent = s.qloo === 'live' ? `Qloo live · ${s.llm ? 'LLM agent' : 'rules planner'}` : 'SAMPLE DATA — not Qloo';
  m.className = 'pill ' + (s.qloo === 'live' ? 'live' : 'sample');
  m.title = s.llm ? `Planner: ${s.llm.model}` : (s.llmNote || 'Deterministic rules planner (no LLM configured)');
  if (!s.llm) $('#vsCard').classList.add('hidden');
}).catch(() => { $('#mode').textContent = 'offline'; });
$('#mcpSnippet').textContent = JSON.stringify({ mcpServers: { marquee: { url: `${location.origin}/api/mcp` } } }, null, 2);

const picked = new Set(['Tue', 'Thu']);
$('#days').innerHTML = DAYS.map(d => `<button type="button" class="day" aria-pressed="${picked.has(d)}" data-d="${d}">${d}</button>`).join('');
$('#days').addEventListener('click', e => { const b = e.target.closest('.day'); if (!b) return; const d = b.dataset.d;
  if (picked.has(d)) { if (picked.size > 1) picked.delete(d); } else if (picked.size < 4) picked.add(d); syncDays(); });
function syncDays() { document.querySelectorAll('.day').forEach(b => b.setAttribute('aria-pressed', picked.has(b.dataset.d))); }
function daysFromGoal(g) { const m = [...String(g).toLowerCase().matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*/g)].map(x => x[1][0].toUpperCase() + x[1].slice(1)); return [...new Set(m)]; }
$('#f').goal.addEventListener('change', e => { const d = daysFromGoal(e.target.value); if (d.length) { picked.clear(); d.slice(0, 4).forEach(x => picked.add(x)); syncDays(); } });
document.querySelectorAll('.presets button').forEach(b => b.onclick = () => {
  const f = $('#f'); f.venue.value = b.dataset.v; f.city.value = b.dataset.c; f.goal.value = b.dataset.g || ''; f.idea.value = b.dataset.i || '';
  const d = daysFromGoal(f.goal.value); if (d.length) { picked.clear(); d.forEach(x => picked.add(x)); syncDays(); }
  f.requestSubmit();
});

// ---- run the agent (SSE stream) ---------------------------------------------------
$('#f').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; const btn = $('#go');
  const body = { venue: f.venue.value.trim(), city: f.city.value.trim(), goal: f.goal.value.trim(), idea: f.idea.value.trim(), weeks: f.weeks.value, nights: DAYS.filter(d => picked.has(d)) };
  if (!body.venue) return f.venue.focus();
  history.replaceState(null, '', '?' + new URLSearchParams({ venue: body.venue, city: body.city, goal: body.goal, idea: body.idea, nights: body.nights.join(','), weeks: body.weeks }));
  btn.disabled = true; btn.innerHTML = 'Reading your crowd…';
  $('#live').classList.remove('hidden'); $('#out').classList.add('hidden'); $('#steps').innerHTML = '';
  const t0 = performance.now(); const timer = setInterval(() => { $('#timer').textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's'; }, 100);
  $('#live').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const r = await fetch('/api/plan?stream=1', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body) });
    if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; let result = null;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (chunk.match(/^event: (.*)$/m) || [])[1]; const data = (chunk.match(/^data: (.*)$/m) || [])[1]; if (!data) continue;
        const d = JSON.parse(data);
        if (ev === 'step') step(d); else if (ev === 'agent') agentCall(d); else if (ev === 'result') result = d; else if (ev === 'fail') throw new Error(d.error);
      }
    }
    if (!result) throw new Error('The agent stopped early. Please try again.');
    last = result; render(result);
  } catch (err) {
    $('#steps').insertAdjacentHTML('beforeend', `<li class="error"><span class="st"></span><span><b>Couldn't finish:</b> ${esc(err.message)}</span><span></span></li>`);
  } finally { clearInterval(timer); btn.disabled = false; btn.innerHTML = 'Programme my month <span aria-hidden="true">→</span>'; }
});

function step(s) {
  let li = document.getElementById('s' + s.id);
  if (!li) { li = document.createElement('li'); li.id = 's' + s.id; $('#steps').appendChild(li); }
  li.className = s.status;
  li.innerHTML = `<span class="st"></span><span><code>${esc(s.tool)}</code>${esc(s.label)}${s.summary ? `<span class="sum">${esc(s.summary)}</span>` : ''}</span><span class="ms">${s.ms != null ? s.ms + ' ms' : ''}</span>`;
}
function agentCall(d) {
  const li = document.createElement('li'); li.className = 'done agent';
  li.innerHTML = `<span class="st"></span><span><code>agent → ${esc(d.tool)}</code>${esc(JSON.stringify(d.args)).slice(0, 160)}</span><span></span>`; $('#steps').appendChild(li);
}

// ---- render -----------------------------------------------------------------------
function render(j) {
  $('#out').classList.remove('hidden');
  const v = j.venue;
  $('#venueLine').textContent = `${v.name} · ${v.address || j.city}${j.mode === 'sample' ? ' · SAMPLE DATA (not Qloo)' : ''}`;
  $('#headline').textContent = j.strategy.headline;
  $('#strategyText').textContent = j.strategy.text || '';
  $('#planBy').textContent = `Planned by ${j.plan.by === 'llm' ? 'the LLM agent' : 'the rules planner'} · ${j.plan.rationale || ''} · ${j.stats.qlooCalls} Qloo calls in ${(j.stats.ms / 1000).toFixed(1)}s`;
  const s = j.score;
  $('#score').innerHTML = [['Avg crowd fit', s.avgFit != null ? s.avgFit : '–', true], ['Nights', s.nights], ['Formats', s.formats], ['Hidden gems', s.hiddenGems], [j.plan.audience ? 'Bridge nights' : 'Bookable acts', j.plan.audience ? s.bridges : s.bookable], ['Grounded in Qloo', s.groundedPct + '%', s.groundedPct === 100]]
    .map(([k, val, good]) => `<div class="${good ? 'good' : ''}"><b>${esc(val)}</b><span>${esc(k)}</span></div>`).join('');

  // crowd
  $('#persona').textContent = j.persona.headline || 'Crowd profile';
  $('#dna').innerHTML = (j.dna || []).slice(0, 14).map(t => `<span title="${esc(t.family)}">${esc(t.name)}</span>`).join('') || '<span>Taste tags unavailable</span>';
  const ages = (j.demographics && j.demographics.ages) || [];
  const mx = Math.max(0.01, ...ages.map(a => Math.abs(a.skew)));
  $('#ages').innerHTML = ages.map(a => `<div class="age"><span>${esc(a.label)}</span><div class="bar"><i class="fill ${a.skew >= 0 ? 'pos' : 'neg'}" style="width:${(Math.abs(a.skew) / mx) * 50}%"></i></div><span>${a.skew > 0 ? '+' : ''}${Math.round(a.skew * 100)}</span></div>`).join('');

  // radar
  const lanes = Object.keys(j.radar).filter(l => j.radar[l].length);
  $('#laneTabs').innerHTML = lanes.map((l, i) => `<button role="tab" aria-selected="${i === 0}" data-l="${l}">${esc(LANE[l] || l)}</button>`).join('');
  $('#laneTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; document.querySelectorAll('#laneTabs button').forEach(x => x.setAttribute('aria-selected', x === b)); radar(b.dataset.l); };
  const used = new Set(j.calendar.map(e => e.genre));
  function radar(l) {
    const gs = j.radar[l] || []; const scores = gs.map(g => g.score); const lo = Math.min(...scores) - 0.01, hi = Math.max(...scores);
    $('#radar').innerHTML = gs.map(g => `<div class="rbar ${used.has(g.label) ? 'used' : ''}"><span class="name" title="${esc(g.tag || '')}">${esc(g.label)}${used.has(g.label) ? ' ✓' : ''}</span><div class="track"><div class="fill" style="width:${Math.max(6, ((g.score - lo) / (hi - lo || 1)) * 100)}%"></div></div><b>${pct(g.score)}</b><span class="who">${esc(g.entities.slice(0, 3).map(e => e.name).join(' · '))}</span></div>`).join('');
  }
  if (lanes[0]) radar(lanes[0]);

  // calendar
  const badge = l => ({ 'Hidden gem': 'gem', 'Crowd favourite': 'fav', 'Bridge pick': 'bridge', 'Crowd-puller': 'pull' }[l] || '');
  $('#cal').innerHTML = j.calendar.map((e, i) => `<article class="ev">
    <div class="img" style="${e.image ? `background-image:url('${esc(e.image)}')` : ''}"><span class="date">${esc(e.day)} ${esc(fmtDate(e.date))}</span>${e.label ? `<span class="badge ${badge(e.label)}">${esc(e.label)}</span>` : ''}</div>
    <div class="body"><span class="fmt">${esc(e.icon || '')} ${esc(e.format)}${e.genre ? ' · ' + esc(e.genre) : ''}</span><h4>${esc(e.title)}</h4>
    <div class="fitbar" title="Qloo affinity ${pct(e.affinity)}/100"><i style="width:${pct(e.affinity)}%"></i></div>
    ${e.draw ? `<div class="drawrow"><span class="chip-draw" title="Draw index: 50% crowd fit, 25% genre strength, 25% reach">Draw <b>${e.draw.index}</b></span><span class="tiny muted">fit ${pct(e.affinity)} · reach ${pct(e.popularity)}</span></div>` : ''}
    <p class="why">${esc(e.why)}</p>
    ${e.reasons && e.reasons.length ? `<details class="whyx"><summary>Why this works</summary><ul>${e.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul><p class="tiny muted">Qloo signal: ${esc(e.evidence ? e.evidence.signal : '')}</p></details>` : ''}
    <p class="promo">${esc(e.promo)}</p>
    <div class="ops"><button data-a="copy" data-i="${i}">Copy promo</button><button data-a="poster" data-i="${i}">Poster</button></div></div></article>`).join('');
  $('#cal').onclick = e => { const b = e.target.closest('button'); if (!b) return; const ev = j.calendar[+b.dataset.i]; if (b.dataset.a === 'copy') copy(ev.promo); else poster(ev, j.venue); };

  // gut checks
  $('#gut').innerHTML = (j.gut || []).map(gutHTML).join('');
  // bridges
  if (j.plan.audience) {
    $('#bridgeNote').textContent = `Goal mentions ${j.plan.audience.label}: these are loved by your current regulars AND ${j.plan.audience.label} (Qloo, crowd signal + age signal). Every third night uses one.`;
    $('#bridges').innerHTML = (j.bridges || []).map(b => `<div class="item"><span>${esc(b.name)}<small>${esc(LANE[b.lane] || '')}</small></span><span class="aff">${pct(b.affinity)}</span></div>`).join('') || '<p class="muted tiny">No bridge picks found.</p>';
  } else {
    $('#bridgeNote').textContent = 'Add a growth audience to your goal (e.g. "attract students" or "after-work professionals") and Marquee finds picks your regulars AND that audience both love.';
    $('#bridges').innerHTML = '';
  }
  // map + zones
  map(j); $('#zones').innerHTML = (j.zones.neighbourhoods || []).map((n, i) => `<span>${i + 1}. ${esc(n.name)}</span>`).join('') || '<span>No heatmap data for this city</span>';
  // partners, rivals, brands, twins, pitches
  const dist = m => m == null ? '' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
  $('#partners').innerHTML = (j.partners || []).slice(0, 6).map(p => `<div class="item"><span>${esc(p.name)}<small>${esc([p.categories.join(' / '), dist(p.distanceM)].filter(Boolean).join(' · '))}</small></span><span class="aff">${pct(p.affinity)}</span></div>`).join('') || '<p class="muted tiny">No partners found nearby.</p>';
  $('#rivals').innerHTML = (j.rivals || []).map(p => `<span>${esc(p.name)}${p.distanceM != null ? ' · ' + dist(p.distanceM) : ''}</span>`).join('') || '<span>None nearby</span>';
  $('#brands').innerHTML = (j.brands || []).slice(0, 8).map(b => `<span>${esc(b.name)}</span>`).join('');
  $('#twins').innerHTML = (j.twins || []).map(t => `<li class="item"><span>${esc(t.name)}<small>${esc(t.city || '')}</small></span><span class="aff">${pct(t.affinity)}</span></li>`).join('');
  $('#outreach').innerHTML = (j.outreach || []).map((o, i) => `<div class="pitch"><span class="k">${esc(o.kind)}</span><b> → ${esc(o.to)}</b><pre>${esc(o.draft)}</pre><button class="ghost" data-i="${i}">Copy</button></div>`).join('');
  $('#outreach').onclick = e => { const b = e.target.closest('button'); if (b) copy(j.outreach[+b.dataset.i].draft); };
  $('#vs').innerHTML = '';
  forecast(); provenance(j);
  if (!$('#cf').va.value) { $('#cf').va.value = j.venue.name; $('#cf').ca.value = j.city || ''; }
  setTimeout(() => $('#out').scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
}
const fmtDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

function gutHTML(g) {
  if (!g || g.verdict === 'unknown') return `<div class="verdict"><b>${esc(g && g.idea)}</b><p class="tiny">${esc(g && g.message)}</p></div>`;
  return `<div class="verdict ${g.verdict}"><div class="h-row"><span class="big">${{ go: 'Go', tweak: 'Tweak it', rethink: 'Rethink' }[g.verdict]}</span><span class="muted tiny">"${esc(g.idea)}" → Qloo tag <code>${esc(g.tagName)}</code></span></div>
    <div class="gauge" title="${g.percentile}th percentile"><i style="left:calc(${g.percentile}% - 2px)"></i></div>
    <p>${esc(g.message)}${g.draw ? ` <span class="chip-draw sm">Draw <b>${g.draw.index}</b></span>` : ''}</p>
    ${g.bookThese && g.bookThese.length ? `<p class="tiny"><b>If you do it, anchor it on:</b> ${esc(g.bookThese.map(e => e.name).join(' · '))}</p>` : ''}
    ${g.betterBet ? `<p class="tiny"><b>Better bet — ${esc(g.betterBet.label)}:</b> ${esc(g.betterBet.entities.map(e => e.name).join(' · '))}</p>` : ''}</div>`;
}
$('#gf').addEventListener('submit', async e => {
  e.preventDefault(); if (!last) return; const idea = e.target.idea.value.trim(); if (!idea) return;
  const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Checking…';
  try { const r = await fetch('/api/gutcheck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea, venueId: last.venue.id, city: last.city }) });
    const g = await r.json(); if (g.error) throw new Error(g.error); $('#gut').insertAdjacentHTML('afterbegin', gutHTML(g)); }
  catch (err) { $('#gut').insertAdjacentHTML('afterbegin', `<p class="err">${esc(err.message)}</p>`); }
  finally { btn.disabled = false; btn.textContent = 'Check'; }
});

$('#vsBtn').addEventListener('click', async () => {
  if (!last) return; const b = $('#vsBtn'); b.disabled = true; b.textContent = 'Running…';
  try { const r = await fetch('/api/generic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ venueId: last.venue.id, venue: last.venue.name, city: last.city, goal: last.goal }) });
    const x = await r.json(); if (x.error) throw new Error(x.error); if (!x.available) throw new Error('No LLM configured on this deployment.');
    const v = { go: '✅ fits', tweak: '🟡 mid-pack', rethink: '❌ poor fit', unknown: '— not measurable' };
    $('#vs').innerHTML = `<div class="vsgrid"><div><h4>Generic AI (no taste data)</h4><div class="list">${x.ideas.map(i => `<div class="item"><span>${esc(i.idea)}<small>${i.tagName ? 'Qloo: ' + esc(i.tagName) + (i.percentile != null ? ` · ${i.percentile}th pct for this crowd` : '') : ''}</small></span><span>${v[i.verdict] || ''}</span></div>`).join('')}</div></div>
      <div><h4>Marquee (Qloo-grounded)</h4><div class="list">${last.calendar.slice(0, 6).map(e => `<div class="item"><span>${esc(e.title)}<small>${esc(e.genre || '')}</small></span><span class="aff">${pct(e.affinity)}</span></div>`).join('')}</div></div></div>`;
  } catch (err) { $('#vs').innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  finally { b.disabled = false; b.textContent = 'Run the proof'; }
});

// ---- draw & ROI forecast (client-side so the assumptions update instantly) --------------------------------
const money = x => (x < 0 ? '−' : '') + '$' + Math.abs(Math.round(x)).toLocaleString();
function forecast() {
  if (!last) return; const f = $('#fcf'); const n = k => Math.max(0, Number(f[k].value) || 0);
  const cap = Math.max(1, n('cap')), base = Math.min(n('base'), cap), ticket = n('ticket'), spend = n('spend'), cost = n('cost');
  const guests = d => Math.round(base + (cap - base) * (d / 100) * 0.8);
  const rows = last.calendar.map(e => { const d = e.draw ? e.draw.index : 50; const g = guests(d); return { e, d, g, lo: Math.round(g * 0.85), hi: Math.min(cap, Math.round(g * 1.15)), net: g * (ticket + spend) - cost - base * spend }; });
  const extra = rows.reduce((s, r) => s + (r.g - base), 0); const net = rows.reduce((s, r) => s + r.net, 0); const spent = cost * rows.length;
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.g, 0) / rows.length) : 0;
  $('#fcTotals').innerHTML = [['Avg guests / night', `${avg}<small>/${cap}</small>`, true], ['Extra guests this month', '+' + extra], ['Net uplift vs a quiet night', money(net), net > 0], ['Return on spend', spent ? Math.round((net / spent) * 100) + '%' : '–', net > 0], ['Avg draw index', last.score.avgDraw ?? '–'], ['Nights', rows.length]]
    .map(([k, v, good]) => `<div class="${good ? 'good' : ''}"><b>${v}</b><span>${esc(k)}</span></div>`).join('');
  $('#fcBars').innerHTML = rows.map(r => `<div class="fcrow"><span class="fcl">${esc(r.e.day)} ${esc(fmtDate(r.e.date))}<small>${esc(r.e.anchor)}</small></span><div class="fct" role="img" aria-label="${r.g} expected guests of ${cap}"><i class="base" style="width:${(base / cap) * 100}%"></i><i class="up" style="left:${(base / cap) * 100}%;width:${((r.g - base) / cap) * 100}%"></i><i class="rng" style="left:${(r.lo / cap) * 100}%;width:${((r.hi - r.lo) / cap) * 100}%"></i></div><span class="fcv"><span><b>${r.g}</b> guests</span><small>${money(r.net)} net</small></span></div>`).join('');
  const g = (last.gut || []).find(x => x.draw);
  if (g) { const ig = guests(g.draw.index); $('#fcIdea').innerHTML = `<b>Your idea, "${esc(g.idea)}":</b> draw ${g.draw.index} ≈ ${ig} guests a night vs ${avg} for Marquee's month (${avg - ig >= 0 ? '+' : ''}${avg - ig} per night).`; }
  else $('#fcIdea').textContent = '';
}
$('#fcf').addEventListener('input', forecast);
$('#fcf').addEventListener('submit', e => e.preventDefault());

// ---- provenance ---------------------------------------------------------------------
function provenance(j) {
  const p = j.provenance || []; $('#provN').textContent = `(${p.length})`;
  $('#prov tbody').innerHTML = p.map((c, i) => `<tr><td>${i + 1}</td><td><code>${esc(c.path)}</code></td><td class="params">${esc(Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join('  '))}</td><td>${c.ms}</td><td>${c.cached ? 'hit' : c.ok ? 'live' : 'error'}</td></tr>`).join('');
}

// ---- compare two venues ---------------------------------------------------------------
document.querySelectorAll('[data-cmp]').forEach(b => b.onclick = () => { const [va, ca, vb, cb] = b.dataset.cmp.split('|'); const f = $('#cf'); Object.assign(f.va, { value: va }); f.ca.value = ca; f.vb.value = vb; f.cb.value = cb; f.requestSubmit(); });
$('#cf').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; const btn = $('#cgo'); btn.disabled = true; btn.textContent = 'Comparing…';
  $('#cmp').innerHTML = '<p class="muted tiny">Scoring 12 genres against both crowds in Qloo…</p>';
  try {
    const r = await fetch('/api/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: { venue: f.va.value, city: f.ca.value }, b: { venue: f.vb.value, city: f.cb.value } }) });
    const c = await r.json(); if (c.error) throw new Error(c.error); renderCompare(c);
  } catch (err) { $('#cmp').innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  finally { btn.disabled = false; btn.textContent = 'Compare crowds'; }
});
function renderCompare(c) {
  const A = c.a.venue.name, B = c.b.venue.name; const all = c.genres.flatMap(g => [g.a, g.b]); const lo = Math.min(...all) - 0.01, hi = Math.max(...all);
  const w = x => Math.max(4, ((x - lo) / (hi - lo || 1)) * 100);
  $('#cmp').innerHTML = `<div class="cmphead"><div class="ring" style="--v:${c.overlap}"><b>${c.overlap}</b><span>taste overlap</span></div>
    <div><h4>${esc(A)} <span class="muted">(${esc(c.a.venue.city)})</span> vs ${esc(B)} <span class="muted">(${esc(c.b.venue.city)})</span></h4><p>${esc(c.verdict)}</p>
    <p class="tiny muted">Genre-rank agreement ${c.rank} · average score gap ${c.meanGap} pts · ${c.stats.qlooCalls ? `${c.stats.qlooCalls} Qloo calls in ${(c.stats.ms / 1000).toFixed(1)}s` : 'served from the private Qloo cache'}</p></div></div>
    <div class="cmpgrid"><div class="legend"><span class="la">■ ${esc(A)}</span><span class="lb">■ ${esc(B)}</span></div>
    ${c.genres.map(g => `<div class="cmprow"><span class="name">${esc(g.label)}</span><div class="pair"><i class="a" style="width:${w(g.a)}%"></i><i class="b" style="width:${w(g.b)}%"></i></div><span class="nums">${pct(g.a)} · ${pct(g.b)}</span></div>`).join('')}</div>
    <div class="grid-2 tight"><div><h4>${esc(A)}'s crowd leans to</h4><div class="chips">${c.moreA.map(r => `<span>${esc(r.label)}</span>`).join('') || '<span>no strong lean</span>'}</div></div>
    <div><h4>${esc(B)}'s crowd leans to</h4><div class="chips">${c.moreB.map(r => `<span>${esc(r.label)}</span>`).join('') || '<span>no strong lean</span>'}</div></div></div>
    ${c.sharedFavourites.length ? `<h4 class="mt">Loved by both crowds: book them for both rooms</h4><div class="chips">${c.sharedFavourites.map(e => `<span>${esc(e.name)}</span>`).join('')}</div>` : ''}`;
}

// ---- booking pack (.zip, built in the browser, no dependencies) ---------------------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) { // store-only ZIP
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
  }
  const size = central.reduce((s, x) => s + x.length, 0); const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
const csvCell = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
$('#pack').onclick = () => {
  if (!last) return; const j = last; const base = slug(j.venue.name);
  const f = $('#fcf'); const cap = +f.cap.value || 80, b0 = +f.base.value || 0;
  const nights = [['date', 'day', 'title', 'format', 'genre', 'anchor', 'label', 'qloo_affinity', 'qloo_popularity', 'draw_index', 'expected_guests', 'why', 'promo'].join(','),
    ...j.calendar.map(e => [e.date, e.day, e.title, e.format, e.genre, e.anchor, e.label, e.affinity, e.popularity, e.draw && e.draw.index, Math.round(b0 + (cap - b0) * ((e.draw ? e.draw.index : 50) / 100) * 0.8), e.why, e.promo].map(csvCell).join(','))].join('\n');
  const files = [
    { name: `${base}/README.txt`, data: `Marquee booking pack for ${j.venue.name}\nGenerated ${new Date().toISOString().slice(0, 10)} from Qloo taste data (${j.stats.qlooCalls} calls).\n\nmonth-plan.md      the full brief: strategy, calendar with evidence, crowd, radar, gut checks, flyer zones, partners\nnights.csv         one row per night with Qloo scores, draw index and expected guests (your assumptions)\ncalendar.ics       import into Google Calendar, Outlook or Apple Calendar\noutreach/          ready-to-send pitches\nposters/           one SVG poster per night\nprovenance.csv     every Qloo call behind this plan\n` },
    { name: `${base}/month-plan.md`, data: briefMD(j) }, { name: `${base}/nights.csv`, data: nights }, { name: `${base}/calendar.ics`, data: icsText(j) },
    { name: `${base}/provenance.csv`, data: ['endpoint,parameters,ms,cache', ...(j.provenance || []).map(c => [c.path, Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join(' '), c.ms, c.cached ? 'hit' : 'live'].map(csvCell).join(','))].join('\n') },
    ...(j.outreach || []).map((o, i) => ({ name: `${base}/outreach/${i + 1}-${slug(o.kind)}-${slug(o.to)}.txt`, data: `To: ${o.to}\n\n${o.draft}\n` })),
    ...j.calendar.map(e => ({ name: `${base}/posters/${slug(e.date + '-' + e.anchor)}.svg`, data: posterSVG(e, j.venue) })),
  ];
  const a = document.createElement('a'); a.href = URL.createObjectURL(zip(files)); a.download = `marquee-booking-pack-${base}.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); toast('Booking pack downloaded');
};

// ---- taste map (SVG, no third-party tiles) ------------------------------------------
function map(j) {
  const cells = j.zones.cells || []; const pts = [...cells]; if (j.venue.lat != null) pts.push({ lat: j.venue.lat, lon: j.venue.lon });
  if (pts.length < 2) { $('#map').innerHTML = '<p class="muted tiny" style="padding:16px">No heatmap for this area.</p>'; return; }
  const W = 600, H = 260, pad = 24;
  const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
  const [a, b, c, d] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const k = Math.cos(((a + b) / 2) * Math.PI / 180); const sx = (W - 2 * pad) / Math.max(1e-6, (d - c) * k), sy = (H - 2 * pad) / Math.max(1e-6, b - a); const s = Math.min(sx, sy);
  const X = lon => W / 2 + (lon - (c + d) / 2) * k * s, Y = lat => H / 2 - (lat - (a + b) / 2) * s;
  const dots = cells.map(p => `<circle cx="${X(p.lon).toFixed(1)}" cy="${Y(p.lat).toFixed(1)}" r="${(4 + 14 * (p.affinity || 0)).toFixed(1)}" fill="url(#g)" opacity="${(0.25 + 0.6 * (p.affinity || 0)).toFixed(2)}"/>`).join('');
  const parts = (j.partners || []).filter(p => p.lat != null).slice(0, 6).map(p => `<circle cx="${X(p.lon)}" cy="${Y(p.lat)}" r="3.5" fill="#8b7bff"><title>${esc(p.name)}</title></circle>`).join('');
  const star = j.venue.lat != null ? `<text x="${X(j.venue.lon)}" y="${Y(j.venue.lat) + 6}" text-anchor="middle" font-size="18" fill="#fff">★</text>` : '';
  $('#map').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Taste heatmap"><defs><radialGradient id="g"><stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#ff5d8f" stop-opacity="0"/></radialGradient></defs>${dots}${parts}${star}</svg>`;
}

// ---- exports ----------------------------------------------------------------------
function poster(e, v) { download(`${slug(e.date + '-' + e.anchor)}.svg`, posterSVG(e, v), 'image/svg+xml'); }
function posterSVG(e, v) {
  const lines = wrap(e.title, 22).slice(0, 4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a1030"/><stop offset="1" stop-color="#3a0f2a"/></linearGradient><linearGradient id="a" x1="0" x2="1"><stop offset="0" stop-color="#ff5d8f"/><stop offset="1" stop-color="#ffb347"/></linearGradient></defs>
<rect width="1080" height="1350" fill="url(#b)"/><circle cx="900" cy="220" r="320" fill="#ff5d8f" opacity=".12"/><circle cx="160" cy="1150" r="360" fill="#8b7bff" opacity=".12"/>
<text x="80" y="160" font-family="Inter,Arial" font-size="34" fill="#ffb347" letter-spacing="6">${esc(e.format.toUpperCase())}${e.genre ? ' · ' + esc(e.genre.toUpperCase()) : ''}</text>
${lines.map((l, i) => `<text x="80" y="${330 + i * 112}" font-family="Georgia,serif" font-weight="800" font-size="96" fill="#fff">${esc(l)}</text>`).join('')}
<rect x="80" y="${400 + lines.length * 112}" width="220" height="10" fill="url(#a)"/>
<text x="80" y="1080" font-family="Inter,Arial" font-size="56" font-weight="700" fill="#fff">${esc(e.day)} ${esc(fmtDate(e.date))} · 7pm</text>
<text x="80" y="1160" font-family="Inter,Arial" font-size="44" fill="#d9d2ff">${esc(v.name)}</text>
<text x="80" y="1270" font-family="Inter,Arial" font-size="26" fill="#a9a3c4">Programmed with Marquee · picked from what our crowd loves</text></svg>`;
  return svg;
}
function wrap(t, n) { const out = []; let cur = ''; for (const w of String(t).split(/\s+/)) { if ((cur + ' ' + w).trim().length > n) { if (cur) out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out; }

$('#ics').onclick = () => { if (last) download(`marquee-${slug(last.venue.name)}.ics`, icsText(last), 'text/calendar'); };
function icsText(last) {
  const dt = d => d.replace(/-/g, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Marquee//Venue programme//EN', 'CALSCALE:GREGORIAN',
    ...last.calendar.flatMap((e, i) => ['BEGIN:VEVENT', `UID:${dt(e.date)}-${i}-${slug(e.anchor)}@marquee`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART:${dt(e.date)}T190000`, `DTEND:${dt(e.date)}T230000`, `SUMMARY:${icsEsc(e.title)}`, `DESCRIPTION:${icsEsc(e.promo + '\n\nWhy: ' + e.why)}`, `LOCATION:${icsEsc(last.venue.name + (last.venue.address ? ', ' + last.venue.address : ''))}`, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
}
const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
$('#brief').onclick = () => { if (last) download(`marquee-brief-${slug(last.venue.name)}.md`, briefMD(last), 'text/markdown'); };
function briefMD(j) {
  return [`# ${j.venue.name}: programme brief`, `_${j.venue.address || j.city} · generated by Marquee from Qloo taste data_`, '', `## ${j.strategy.headline}`, j.strategy.text || '', '',
    `**Scorecard:** avg crowd fit ${j.score.avgFit}/100 · ${j.score.nights} nights · ${j.score.formats} formats · ${j.score.hiddenGems} hidden gems · ${j.score.groundedPct}% grounded in Qloo`, '',
    '## Calendar', ...j.calendar.map(e => `- **${e.day} ${e.date}: ${e.title}** (${e.label || ''}${e.draw ? `, draw ${e.draw.index}` : ''})  \n  ${e.why}  \n${(e.reasons || []).map(r => `  - ${r}`).join('\n')}${e.reasons && e.reasons.length ? '\n' : ''}  _${e.promo}_`), '',
    '## Crowd', `- ${j.persona.headline}`, `- Taste DNA: ${(j.dna || []).slice(0, 12).map(t => t.name).join(', ')}`, '',
    '## Genre radar', ...Object.entries(j.radar).map(([l, gs]) => `- ${LANE[l] || l}: ${gs.slice(0, 5).map(g => `${g.label} ${pct(g.score)}`).join(' · ')}`), '',
    ...(j.gut || []).length ? ['## Gut checks', ...j.gut.map(g => `- "${g.idea}": ${g.message}`), ''] : [],
    '## Flyer zones', (j.zones.neighbourhoods || []).map(n => n.name).join(', '), '',
    '## Partners', ...(j.partners || []).slice(0, 6).map(p => `- ${p.name}`), '', '## Pitches', ...(j.outreach || []).map(o => `### ${o.kind} → ${o.to}\n\n${o.draft}\n`),
    '', '---', `Draw index = 50% crowd fit + 25% genre strength + 25% reach (+5 growth, +5 bridge), from Qloo signals. ${j.stats.qlooCalls} Qloo calls; see provenance.csv.`].join('\n');
}
$('#share').onclick = () => copy(location.href);
$('#print').onclick = () => window.print();

// deep links: /?venue=…&city=… runs automatically
const qs = new URLSearchParams(location.search);
if (qs.get('venue')) { const f = $('#f'); f.venue.value = qs.get('venue'); f.city.value = qs.get('city') || ''; f.goal.value = qs.get('goal') || ''; f.idea.value = qs.get('idea') || '';
  if (qs.get('weeks')) f.weeks.value = qs.get('weeks'); const n = (qs.get('nights') || '').split(',').filter(d => DAYS.includes(d)); if (n.length) { picked.clear(); n.forEach(d => picked.add(d)); syncDays(); }
  setTimeout(() => f.requestSubmit(), 50); }
