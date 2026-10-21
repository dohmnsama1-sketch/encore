const $ = s => document.querySelector(s); let last = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
fetch('/api/status').then(r => r.json()).then(s => { $('#mode').textContent = s.qloo === 'live' ? `Qloo live · ${s.llm ? 'LLM on' : 'template writer'}` : 'SAMPLE DATA (not Qloo): add QLOO_API_KEY'; });
document.querySelectorAll('.examples a').forEach(a => a.onclick = () => { $('#f').venue.value = a.dataset.v; $('#f').city.value = a.dataset.c; });
$('#f').onsubmit = async e => {
  e.preventDefault(); const f = e.target; const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Reading your crowd…';
  try {
    const r = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ venue: f.venue.value, city: f.city.value, goal: f.goal.value, weeks: f.weeks.value }) });
    const j = await r.json(); if (j.error) throw new Error(j.error); last = j; render(j);
  } catch (err) { alert(err.message); } finally { btn.disabled = false; btn.textContent = 'Plan my month →'; }
};
const LBL = { artist: 'Live music & DJs', movie: 'Screenings', podcast: 'Talks & podcasts', book: 'Book club', tv_show: 'Watch parties', video_game: 'Game nights', brand: 'Brand collabs', place: 'Neighbour partners' };
function render(j) {
  $('#out').classList.remove('hidden');
  $('#steps').innerHTML = j.steps.map(s => `<li><code>${esc(s.tool)}</code> ${esc(s.detail)}</li>`).join('') + `<li><code>done</code> ${j.qlooCalls} Qloo calls</li>`;
  $('#venue').innerHTML = `${esc(j.venue.name)}<small>${esc(j.venue.address || j.city)}</small>`;
  $('#tags').innerHTML = (j.tags.length ? j.tags.slice(0, 14) : [{ name: 'taste tags unavailable' }]).map(t => `<span>${esc(t.name)}</span>`).join('');
  const sm = j.summary || {};
  $('#score').innerHTML = [['Avg crowd fit', sm.avgFit != null ? sm.avgFit + '/100' : 'n/a'], ['Nights planned', sm.nights], ['Hidden gems', sm.hiddenGems], ['Formats', sm.lanes], ['Repeats', sm.repeats], ['Qloo calls', j.qlooCalls]].map(([k, v]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
  $('#personas').innerHTML = (j.personas || []).map(p => `<div class="persona"><h4>${esc(p.name)}</h4><div class="chips">${p.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div><small>${esc(p.hook)}</small></div>`).join('');
  $('#cal').innerHTML = j.calendar.map((e, i) => `<div class="ev"><div class="d">Week ${e.week} · ${e.day} · ${esc(e.format)}</div>${e.score && e.score.fit != null ? `<div class="fit ${({"Hidden gem":"gem","Crowd favourite":"fav","Stretch pick":"stretch"}[e.score.label]||"")}"><b>${e.score.fit}</b> fit · ${esc(e.score.label)}</div>` : ''}<h3>${esc(e.title)}</h3><p>${esc(e.promo)}</p><div class="w">★ ${esc(e.why)}</div><button class="ghost poster" data-p="${i}">Poster (SVG)</button></div>`).join('');
  $('#cal').onclick = ev => { const i = ev.target.dataset.p; if (i != null) poster(j, j.calendar[i]); };
  $('#twins').innerHTML = (j.twins || []).map(t => `<li><span>${esc(t.name)}</span>${t.affinity != null ? `<small>${Math.round(t.affinity * 100)} overlap</small>` : ''}</li>`).join('') || '<li>No twins found.</li>';
  $('#lanes').innerHTML = j.lanes.map(l => `<div class="lane"><h3>${LBL[l]}</h3><ol>${(j.lanesData[l] || []).slice(0, 6).map(x => `<li><span>${esc(x.name)}</span>${x.affinity != null ? `<span><i class="bar" style="width:${Math.round(x.affinity * 50)}px"></i> ${Math.round(x.affinity * 100)}</span>` : ''}</li>`).join('') || '<li>No data</li>'}</ol></div>`).join('');
  $('#outreach').innerHTML = j.outreach.map((o, i) => `<div class="pitch"><b>${esc(o.kind)} → ${esc(o.to)}</b><div class="w"><small>${esc(o.why)}</small></div><p>${esc(o.draft)}</p><button class="ghost" data-i="${i}">Copy</button></div>`).join('') || 'No partners found.';
  $('#outreach').onclick = e => { if (e.target.dataset.i) navigator.clipboard.writeText(j.outreach[e.target.dataset.i].draft); };
  $('#vsPanel').classList.toggle('hidden', !j.generic); $('#vsPanel').parentElement.style.gridTemplateColumns = j.generic ? '' : '1fr';
  if (j.generic) $('#vs').innerHTML = `<div class="vs"><div><h4>Plain LLM (guessing)</h4>${j.generic.map(x => `<p>${esc(x)}</p>`).join('')}</div><div><h4>Encore (knows)</h4>${j.calendar.slice(0, 4).map(e => `<p><b>${esc(e.title)}</b><br><small>${esc(e.why)}</small></p>`).join('')}</div></div>`;
  $('#out').scrollIntoView({ behavior: 'smooth' });
}
$('#ics').onclick = () => {
  if (!last) return; const start = new Date(); const pad = n => String(n).padStart(2, '0');
  const dt = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T190000`;
  const next = (w, day) => { const d = new Date(start); const target = day === 'Thu' ? 4 : 6; d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7 || 7) + (w - 1) * 7); return d; };
  const ev = last.calendar.map((e, i) => `BEGIN:VEVENT\nUID:encore-${i}-${Date.now()}@encore\nDTSTAMP:${dt(start)}Z\nDTSTART:${dt(next(e.week, e.day))}\nSUMMARY:${e.title.replace(/[,;]/g, ' ')}\nDESCRIPTION:${(e.promo + ' | ' + e.why).replace(/[,;\n]/g, ' ')}\nEND:VEVENT`).join('\n');
  const blob = new Blob([`BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Encore//EN\n${ev}\nEND:VCALENDAR`], { type: 'text/calendar' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${last.venue.name}-encore.ics`; a.click();
};
// Shareable links: /?venue=Blue%20Note&city=New%20York&goal=... auto-runs the plan.
const qp = new URLSearchParams(location.search);
if (qp.get('venue') && qp.get('city')) { const f = $('#f'); f.venue.value = qp.get('venue'); f.city.value = qp.get('city'); f.goal.value = qp.get('goal') || ''; f.requestSubmit(); }

// One-click event poster: a print-ready SVG built from the event and the venue's taste tags.
function poster(j, e) {
  const W = 1080, H = 1350, x = s => esc(s);
  const wrap = (t, n) => { const w = String(t).split(' '), L = []; let c = ''; for (const k of w) { if ((c + ' ' + k).trim().length > n) { L.push(c.trim()); c = k; } else c += ' ' + k; } if (c.trim()) L.push(c.trim()); return L.slice(0, 4); };
  const title = wrap(e.anchor, 16).map((l, k) => `<text x="80" y="${520 + k * 120}" font-size="110" font-weight="800" fill="#fff">${x(l)}</text>`).join('');
  const tags = (j.tags || []).slice(0, 4).map(t => t.name).join('  ·  ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter,Helvetica,Arial,sans-serif"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1035"/><stop offset=".55" stop-color="#3b1d6e"/><stop offset="1" stop-color="#ff5e62"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="900" cy="230" r="260" fill="#ffd166" opacity=".18"/><text x="80" y="160" font-size="40" letter-spacing="8" fill="#ffd166" font-weight="700">${x(e.day.toUpperCase())} · WEEK ${e.week} · ${x(e.format.toUpperCase())}</text><text x="80" y="330" font-size="56" fill="#fff" opacity=".85">${x(j.venue.name)} presents</text>${title}<text x="80" y="1110" font-size="34" fill="#fff" opacity=".85">${x(tags)}</text><text x="80" y="1190" font-size="40" font-weight="700" fill="#ffd166">Doors 7pm</text><text x="80" y="1270" font-size="26" fill="#fff" opacity=".6">Programmed with Encore · taste data from Qloo</text></svg>`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); a.download = `${j.venue.name}-${e.anchor}.svg`.replace(/[^\w.-]+/g, '-'); a.click();
}
