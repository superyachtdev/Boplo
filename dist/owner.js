/* Boplo owner analytics: reads /flight/owner/stats (owner accounts only) and draws the page. */
(() => {
  const $ = s => document.querySelector(s), main = $('#ow');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = n => Number(n || 0).toLocaleString('en-US');
  const money = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 + '%' : '—';
  const fmtDay = (d, opt = { day: 'numeric', month: 'short' }) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', opt);
  const fmtTs = t => t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const COUNTRY = (() => { try { const dn = new Intl.DisplayNames(['en'], { type: 'region' }); return c => { try { return dn.of(c) || c; } catch { return c; } }; } catch { return c => c; } })();
  const SRC = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', reddit: 'Reddit', x: 'X (Twitter)', linkedin: 'LinkedIn', chatgpt: 'ChatGPT', direct: 'Direct or unknown' };
  const srcName = k => SRC[k] || k;
  let days = 30; try { days = +localStorage.getItem('boplo-owner-days') || 30; } catch { }

  const delta = (now, prev, label) => {
    if (!prev && !now) return `<small>No change on the previous ${label}</small>`;
    if (!prev) return `<small><span class="delta up">New</span> vs the previous ${label}</small>`;
    const d = Math.round((now - prev) / prev * 100);
    return `<small><span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}%</span> vs the previous ${label}</small>`;
  };
  const bars = (rows, { label = r => r.k, extra, empty = 'Nothing yet.' } = {}) => {
    if (!rows?.length) return `<p class="empty-s">${empty}</p>`;
    const max = Math.max(...rows.map(r => r.n), 1);
    return `<div class="bars">${rows.map(r => `<div class="bar"><span class="k" title="${esc(label(r))}">${esc(label(r))}</span><span class="t"><span class="f" style="width:${r.n / max * 100}%"></span></span><span class="n">${nf(r.n)}${extra ? extra(r) : ''}</span></div>`).join('')}</div>`;
  };

  // one series over time: an area+line for visitors, columns for sign-ups. Hover shows the day's numbers.
  function timeChart(id, pts, key, kind) {
    const W = 760, H = 200, L = 34, R = 8, T = 10, B = 24, iw = W - L - R, ih = H - T - B;
    const max = Math.max(1, ...pts.map(p => p[key])), nice = (() => { const m = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / m) * m; })();
    const x = i => L + (pts.length === 1 ? iw / 2 : i * iw / (pts.length - 1)), y = v => T + ih - v / nice * ih;
    const ticks = [0, nice / 2, nice].filter((v, i, a) => a.indexOf(v) === i);
    let g = ticks.map(v => `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${nf(Math.round(v))}</text>`).join('');
    const every = Math.ceil(pts.length / 6);
    g += pts.map((p, i) => i % every === 0 || i === pts.length - 1 ? `<text x="${kind === 'col' ? L + (i + .5) * iw / pts.length : x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>` : '').join('');
    if (kind === 'col') {
      const bw = iw / pts.length, w = Math.max(1, bw - Math.min(6, bw * .3));
      g += pts.map((p, i) => { const h = p[key] / nice * ih; return h ? `<path d="M${L + i * bw + (bw - w) / 2},${T + ih} v${-Math.max(0, h - Math.min(4, w / 2))} q0,-${Math.min(4, w / 2, h)} ${Math.min(4, w / 2)},-${Math.min(4, w / 2, h)} h${Math.max(0, w - 2 * Math.min(4, w / 2))} q${Math.min(4, w / 2)},0 ${Math.min(4, w / 2)},${Math.min(4, w / 2, h)} v${Math.max(0, h - Math.min(4, w / 2))}z" fill="var(--electric)"/>` : ''; }).join('');
    } else {
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
      g += `<path d="${line}L${x(pts.length - 1)},${T + ih}L${L},${T + ih}Z" fill="var(--electric)" opacity=".08"/><path d="${line}" fill="none" stroke="var(--electric)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    g += `<line data-cross x1="0" x2="0" y1="${T}" y2="${T + ih}" stroke="var(--ink-3)" stroke-dasharray="3 3" opacity="0"/><circle data-dot r="4.5" fill="var(--electric)" stroke="var(--paper)" stroke-width="2" opacity="0"/>`;
    g += `<rect data-hit x="${L}" y="${T}" width="${iw}" height="${ih}" fill="transparent"/>`;
    return `<div class="chart" id="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(key)} over time">${g}</svg><div class="tip"></div></div>`;
  }
  function wireChart(id, pts, kind, tipFn) {
    const el = document.getElementById(id); if (!el) return;
    const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), cross = svg.querySelector('[data-cross]'), dot = svg.querySelector('[data-dot]'), hit = svg.querySelector('[data-hit]');
    const vb = svg.viewBox.baseVal, L = 34, iw = vb.width - 34 - 8;
    const move = e => {
      const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * vb.width;
      const i = kind === 'col' ? Math.max(0, Math.min(pts.length - 1, Math.floor((sx - L) / (iw / pts.length)))) : Math.max(0, Math.min(pts.length - 1, Math.round((sx - L) / (iw / Math.max(1, pts.length - 1)))));
      const cx = kind === 'col' ? L + (i + .5) * iw / pts.length : L + (pts.length === 1 ? iw / 2 : i * iw / (pts.length - 1));
      const [val, html] = tipFn(pts[i]); const H = vb.height, cy = 10 + (H - 34) - val.y * (H - 34);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('opacity', '.6');
      if (kind !== 'col') { dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('opacity', '1'); }
      tip.innerHTML = html; tip.style.left = (cx / vb.width * r.width) + 'px'; tip.style.top = (Math.min(cy, H - 40) / vb.height * r.height - 8) + 'px'; tip.style.opacity = 1;
    };
    const out = () => { tip.style.opacity = 0; cross.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move); hit.addEventListener('pointerleave', out);
  }

  function gate(title, text, cta) { main.innerHTML = `<section class="tile gate"><h2>${esc(title)}</h2><p>${esc(text)}</p>${cta || ''}</section>`; }

  async function load() {
    document.querySelectorAll('[data-days]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.days === days)));
    let d;
    try {
      const res = await fetch('/flight/owner/stats?days=' + days, { credentials: 'same-origin' });
      d = await res.json().catch(() => ({}));
      if (res.status === 401) return gate('Sign in to see your analytics', 'This page is only for Boplo owner accounts.', '<a class="btn btn-blue" href="/flight-app.html">Sign in</a>');
      if (res.status === 403) return gate('This page is for Boplo owners', 'Your account isn’t on the owner list, so there’s nothing to show here.', '<a class="btn btn-line" href="/flight-app.html">Back to the flight desk</a>');
      if (!res.ok) throw new Error(d.error || 'The analytics didn’t load.');
    } catch (e) { return gate('The analytics didn’t load', e.message + ' Check your connection and try again.', '<button class="btn btn-line" data-retry>Try again</button>'), main.querySelector('[data-retry]').onclick = load; }
    render(d);
  }

  function render(d) {
    const label = d.days === 7 ? '7 days' : d.days === 365 ? '12 months' : d.days + ' days';
    $('[data-gen]').textContent = `Updated ${new Date(d.generated).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Your own owner accounts aren’t counted.`;
    const V = d.visits, S = d.signups, P = d.plans, U = d.usage;
    const paying = P.monthly + P.yearly;
    // a year of days is too many columns; show weeks instead
    let pts = d.series.map(p => ({ ...p, label: fmtDay(p.day) }));
    if (d.days > 90) { const wk = []; for (let i = 0; i < pts.length; i += 7) { const c = pts.slice(i, i + 7); wk.push({ day: c[0].day, end: c[c.length - 1].day, label: fmtDay(c[0].day, { month: 'short' }), views: c.reduce((t, p) => t + p.views, 0), visitors: c.reduce((t, p) => t + p.visitors, 0), signups: c.reduce((t, p) => t + p.signups, 0) }); } pts = wk; }
    const per = d.days > 90 ? 'week' : 'day';
    const vMax = Math.max(1, ...pts.map(p => p.visitors)), sMax = Math.max(1, ...pts.map(p => p.signups));
    const niceOf = m => { const k = Math.pow(10, Math.floor(Math.log10(m))); return Math.ceil(m / k) * k; };
    const when = p => p.end ? `Week of ${fmtDay(p.day)}` : fmtDay(p.day, { weekday: 'short', day: 'numeric', month: 'short' });
    const funnel = [['Signed up', S.total], ['Finished setup', S.onboarded], ['Logged a flight', S.logged], ['Paying for Advanced', paying]];
    const tracking = d.trackingSince && d.trackingSince > d.series[0]?.day ? `<p class="note">Visit counting started on ${fmtDay(d.trackingSince, { day: 'numeric', month: 'long', year: 'numeric' })}, so visits before then show as zero. Sign-ups, plans and usage go back to the start.</p>` : '';

    main.innerHTML = `
      <section class="tile kpi s3"><div class="lab">Visitors</div><div class="big">${nf(V.visitors)}</div>${delta(V.visitors, V.prevVisitors, label)}<br><small>${nf(V.views)} page views</small></section>
      <section class="tile kpi s3"><div class="lab">New sign-ups</div><div class="big">${nf(S.recent)}</div>${delta(S.recent, S.prev, label)}<br><small>${S.recent <= V.visitors && V.visitors ? pct(S.recent, V.visitors) + ' of visitors signed up' : 'Sign-up rate shows once more visits are counted'}</small></section>
      <section class="tile kpi s3"><div class="lab">Paying customers</div><div class="big">${nf(paying + d.schools.filter(s => ['active', 'trialing', 'past_due'].includes(s.status)).length)}</div><small>${nf(paying)} individual${paying === 1 ? '' : 's'} · ${nf(d.schools.filter(s => ['active', 'trialing', 'past_due'].includes(s.status)).length)} school${d.schools.filter(s => ['active', 'trialing', 'past_due'].includes(s.status)).length === 1 ? '' : 's'}</small><br><small>${pct(paying, S.total)} of all users pay</small></section>
      <section class="tile kpi s3"><div class="lab">Monthly recurring revenue</div><div class="big">${money(P.mrr)}</div><small>${money(P.arr)} a year at today’s plans, before tax and Stripe fees</small></section>
      ${tracking}
      <section class="tile s6"><h2>Visitors per ${per}</h2><p class="sub">People who opened any Boplo page, counted once a day each</p>${timeChart('cv', pts, 'visitors', 'line')}</section>
      <section class="tile s6"><h2>Sign-ups per ${per}</h2><p class="sub">New Boplo Flight accounts</p>${timeChart('cs', pts, 'signups', 'col')}</section>
      <section class="tile s6"><h2>From sign-up to paying</h2><p class="sub">Everyone who has ever signed up, and how far they got</p>
        <div class="funnel">${funnel.map(([k, n], i) => { const w = S.total ? n / S.total * 100 : 0; return `<div class="fs"><span class="k">${k}</span><span class="t"><span class="f" style="width:${w}%"></span><span class="v${w < 30 ? ' out' : ''}" style="${w < 30 ? `left:calc(${w}% + 10px)` : ''}">${nf(n)}${i ? `<em>${pct(n, S.total)}</em>` : ''}</span></span></div>`; }).join('')}</div></section>
      <section class="tile s6"><h2>Users on each plan</h2><p class="sub">Right now, across all ${nf(S.total)} users</p>
        <div class="plans"><div class="pl"><b>${nf(P.free)}</b><span>Free</span></div><div class="pl"><b>${nf(P.yearly)}</b><span>Advanced yearly</span></div><div class="pl"><b>${nf(P.monthly)}</b><span>Advanced monthly</span></div><div class="pl"><b>${nf(P.schoolMembers)}</b><span>Through a school</span></div></div>
        <div class="flags">${P.pastDue ? `<span class="chip warn">${nf(P.pastDue)} payment${P.pastDue === 1 ? '' : 's'} failing</span>` : ''}${P.cancelling ? `<span class="chip warn">${nf(P.cancelling)} cancelling at renewal</span>` : ''}<span class="chip">${nf(P.cancelled)} cancelled in the last ${label}</span><span class="chip">${pct(P.yearly, paying)} of subscribers on yearly</span></div></section>
      <section class="tile s4"><h2>Where visitors come from</h2><p class="sub">Add ?utm_source=tiktok to links you post to tag them</p>${bars(V.sources, { label: r => srcName(r.k), empty: 'No visits counted yet.' })}</section>
      <section class="tile s4"><h2>Where sign-ups come from</h2><p class="sub">First place each new user arrived from, last ${label}</p>${bars(S.bySource, { label: r => srcName(r.k), empty: 'No sign-ups with a known source yet. New sign-ups are tagged from today.' })}</section>
      <section class="tile s4"><h2>Which sources pay</h2><p class="sub">All tagged users by source, and how many pay</p>${bars(S.sourceTotals, { label: r => srcName(r.k), extra: r => `<em>${nf(r.paid)} paid</em>`, empty: 'Nothing tagged yet.' })}</section>
      <section class="tile s4"><h2>Most-visited pages</h2><p class="sub">Page views, last ${label}</p>${bars(V.pages, { label: r => ({ '/': 'Home page', '/flight-app.html': 'Flight desk (app)', '/plan.html': 'Training cost planner', '/schools.html': 'For schools', '/share.html': 'Shared logbooks', '/owner.html': 'This page' })[r.k] || r.k, empty: 'No visits counted yet.' })}</section>
      <section class="tile s4"><h2>Visitors by country</h2><p class="sub">From the visit, not the profile</p>${bars(V.countries.map(r => ({ ...r, k: COUNTRY(r.k) })), { empty: 'No visits counted yet.' })}</section>
      <section class="tile s4"><h2>Device</h2><p class="sub">Visitors on each kind of device</p>${bars(V.devices.map(r => ({ ...r, k: r.k[0].toUpperCase() + r.k.slice(1) })), { empty: 'No visits counted yet.' })}</section>
      <section class="tile s6"><h2>How people use Boplo</h2><p class="sub">Last ${label}, unless it says otherwise</p>
        <div class="ostats"><div><b>${nf(U.active7)}</b><span>Active in the last 7 days</span></div><div><b>${nf(U.active30)}</b><span>Active in the last 30 days</span></div><div><b>${nf(U.flights)}</b><span>Flights logged</span></div><div><b>${nf(U.ask)}</b><span>Ask Boplo questions</span></div><div><b>${nf(U.simScores)}</b><span>Scored sim landings</span></div><div><b>${nf(U.simFree)}</b><span>Free short finals flown</span></div><div><b>${nf(U.posts)}</b><span>Q&amp;A posts and answers</span></div><div><b>${nf(d.leads.recent)}</b><span>School enquiries</span></div></div></section>
      <section class="tile s6"><h2>Who your users are</h2><p class="sub">From their training profile</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px"><div><p class="sub" style="margin-bottom:8px;color:var(--ink-2)">Country</p>${bars(d.users.countries.slice(0, 5))}</div><div><p class="sub" style="margin-bottom:8px;color:var(--ink-2)">Authority</p>${bars(d.users.authorities.slice(0, 5))}</div><div><p class="sub" style="margin-bottom:8px;color:var(--ink-2)">Licence</p>${bars(d.users.licences.slice(0, 5))}</div></div></section>
      <section class="tile s12"><h2>Newest sign-ups</h2><p class="sub">The latest 25 accounts</p>${d.users.recent.length ? `<div class="tw"><table class="ot"><thead><tr><th>Joined</th><th>Name</th><th>Country</th><th>Licence</th><th>Plan</th><th>Came from</th><th class="r">Flights</th></tr></thead><tbody>${d.users.recent.map(r => `<tr data-uid="${esc(r.id)}" tabindex="0" title="Open ${esc(r.name || r.email)}"><td>${fmtTs(r.created_at)}</td><td>${esc(r.name || '—')}<small>${esc(r.email)}</small></td><td>${esc(r.country || '—')}</td><td>${esc(r.licence || '—')}${r.complete ? '' : '<small>Setup not finished</small>'}</td><td>${['active', 'trialing', 'past_due'].includes(r.status) ? `Advanced ${r.price_key === 'monthly' ? 'monthly' : 'yearly'}${r.status === 'past_due' ? '<small>Payment failing</small>' : ''}` : 'Free'}</td><td>${esc(r.src ? srcName(r.src) : '—')}</td><td class="r">${nf(r.flights)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-s">No sign-ups yet.</p>'}</section>
      <section class="tile s7"><h2>Schools</h2><p class="sub">Every school that has set up a plan</p>${d.schools.length ? `<div class="tw"><table class="ot"><thead><tr><th>School</th><th>Plan</th><th>Status</th><th class="r">Students</th><th class="r">Staff</th><th>Renews</th></tr></thead><tbody>${d.schools.map(s => `<tr><td>${esc(s.name)}<small>Since ${fmtTs(s.created)}</small></td><td>${esc(s.plan)}</td><td>${s.status === 'active' ? (s.cancelling ? 'Cancelling' : 'Active') : s.status === 'past_due' ? 'Payment failing' : s.status === 'none' ? 'Not paid yet' : esc(s.status)}</td><td class="r">${nf(s.students)}</td><td class="r">${nf(s.instructors)}</td><td>${fmtTs(s.renews ? s.renews * 1000 : 0)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-s">No schools yet.</p>'}</section>
      <section class="tile s5"><h2>Latest school enquiries</h2><p class="sub">From the form on the schools page</p>${d.leads.latest.length ? `<div class="tw"><table class="ot"><tbody>${d.leads.latest.map(l => `<tr><td>${esc(l.school || '—')}<small>${esc(l.name || '')}${l.email ? ' · ' + esc(l.email) : ''}</small></td><td>${esc(l.country || '')}<small>${esc(l.students || '')}${l.students ? ' students' : ''}</small></td><td class="r">${fmtTs(l.created_at)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-s">No enquiries yet.</p>'}</section>
      <section class="tile s12" data-ttbox><h2>TikTok videos on the landing page</h2><p class="sub">Paste @boploflight video links, one per line, newest first. They play in the phone on boplo.app. Leave it empty to show TikTok's own profile widget instead.</p>
        <textarea data-ttl rows="5" style="width:100%;font:inherit;font-size:14px;border-radius:12px;border:1px solid var(--hair-l);padding:12px;resize:vertical" placeholder="https://www.tiktok.com/@boploflight/video/…"></textarea>
        <div style="display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap"><button type="button" class="btn btn-blue btn-sm" data-tts>Save videos</button><span class="sub" data-ttm style="margin:0"></span><a class="text-link" href="/#tiktok" target="_blank" rel="noopener" style="margin-left:auto;font-size:13.5px">See it on the landing page</a></div></section>`;
    wireTiktok();

    wireChart('cv', pts, 'line', p => [{ y: p.visitors / niceOf(vMax) }, `<b>${when(p)}</b><br>${nf(p.visitors)} visitor${p.visitors === 1 ? '' : 's'}<br>${nf(p.views)} page views`]);
    wireChart('cs', pts, 'col', p => [{ y: p.signups / niceOf(sMax) }, `<b>${when(p)}</b><br>${nf(p.signups)} sign-up${p.signups === 1 ? '' : 's'}`]);
  }

  /* ---------- the landing page's TikTok feed ---------- */
  async function wireTiktok() {
    const box = $('[data-ttbox]'); if (!box) return; const ta = box.querySelector('[data-ttl]'), btn = box.querySelector('[data-tts]'), msg = box.querySelector('[data-ttm]');
    try { const d = await fetch('/flight/tiktok', { cache: 'no-store' }).then(r => r.json()); ta.value = (d.videos || []).map(v => `https://www.tiktok.com/@boploflight/video/${v.id}`).join('\n'); msg.textContent = d.videos?.length ? `${d.videos.length} video${d.videos.length === 1 ? '' : 's'} showing` : 'No videos picked yet: the profile widget is showing'; } catch { }
    btn.onclick = async () => {
      btn.disabled = true; msg.textContent = 'Saving…';
      try {
        const r = await fetch('/flight/owner/tiktok', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links: ta.value }) }); const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'That didn’t save.');
        ta.value = d.videos.map(v => `https://www.tiktok.com/@boploflight/video/${v.id}`).join('\n');
        msg.textContent = `Saved ${d.videos.length} video${d.videos.length === 1 ? '' : 's'}.` + (d.bad.length ? ` ${d.bad.length} link${d.bad.length === 1 ? ' wasn’t a TikTok video' : 's weren’t TikTok videos'} and ${d.bad.length === 1 ? 'was' : 'were'} skipped.` : '') + ' The landing page updates within 2 minutes.';
      } catch (e) { msg.textContent = e.message; } finally { btn.disabled = false; }
    };
  }

  /* ---------- one person: search, then their page ---------- */
  const ago = t => { if (!t) return 'Never'; const s = (Date.now() - t) / 1000; if (s < 90) return 'Just now'; if (s < 5400) return Math.round(s / 60) + ' min ago'; if (s < 129600) return Math.round(s / 3600) + ' h ago'; if (s < 86400 * 45) return Math.round(s / 86400) + ' days ago'; return fmtTs(t); };
  const hrs = m => { m = Math.round(m || 0); return m < 60 ? m + ' min' : (Math.round(m / 6) / 10).toLocaleString('en-US') + ' h'; };
  const planOf = (status, price) => ['active', 'trialing', 'past_due'].includes(status) ? `Advanced ${price === 'monthly' ? 'monthly' : 'yearly'}` : 'Free';
  const box = $('[data-us]'), res = $('#us-res');
  let qT = 0, qN = 0, sel = -1, found = [];
  const showRes = html => { res.innerHTML = html; res.hidden = !html; box.setAttribute('aria-expanded', String(!!html)); };
  const pick = i => { sel = i; res.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-selected', String(j === i))); };
  async function search() {
    const q = box.value.trim(), n = ++qN;
    if (q.length < 2) { found = []; return showRes(''); }
    let d; try { const r = await fetch('/flight/owner/users?q=' + encodeURIComponent(q), { credentials: 'same-origin' }); d = await r.json(); if (!r.ok) throw new Error(d.error || 'Search failed.'); } catch (e) { if (n === qN) showRes(`<p>${esc(e.message)}</p>`); return; }
    if (n !== qN) return;
    found = d.users || [];
    if (!found.length) return showRes(`<p>No one matches “${esc(q)}”. Try part of their email.</p>`);
    showRes(found.map((u, i) => `<button type="button" role="option" data-i="${i}"><span><b>${esc(u.name || u.email)}</b><small>${esc(u.name ? u.email : '')}${u.name ? ' · ' : ''}Joined ${fmtTs(u.created_at)}</small></span><span class="tag">${u.desk === 0 ? 'No Flight desk' : esc(u.school_role ? 'School ' + u.school_role : planOf(u.status, u.price_key))}${u.flights ? ` · ${nf(u.flights)} flight${u.flights === 1 ? '' : 's'}` : ''}</span></button>`).join(''));
    pick(0);
  }
  box.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(search, 220); });
  box.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && found.length) { e.preventDefault(); pick(Math.min(found.length - 1, sel + 1)); }
    else if (e.key === 'ArrowUp' && found.length) { e.preventDefault(); pick(Math.max(0, sel - 1)); }
    else if (e.key === 'Enter' && found[sel]) { e.preventDefault(); openUser(found[sel].id); }
    else if (e.key === 'Escape') showRes('');
  });
  res.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) openUser(found[+b.dataset.i].id); });
  document.addEventListener('click', e => { if (!e.target.closest('.us')) showRes(''); });
  main.addEventListener('click', e => { const tr = e.target.closest('tr[data-uid]'); if (tr) openUser(tr.dataset.uid); });
  main.addEventListener('keydown', e => { const tr = e.target.closest('tr[data-uid]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openUser(tr.dataset.uid); } });

  const dlg = $('[data-ud]'), body = $('[data-udb]');
  const closeUser = () => { if (dlg.open) dlg.close(); };
  $('[data-udx]').onclick = closeUser;
  dlg.addEventListener('close', () => { const u = new URL(location.href); if (u.searchParams.has('user')) { u.searchParams.delete('user'); history.replaceState(null, '', u); } });

  // 13 weeks of days, a square per day, darker the more they did
  function heatmap(rows) {
    const first = new Date(rows[0].day + 'T12:00:00Z').getUTCDay(), off = (first + 6) % 7, cs = 13, gp = 3, weeks = Math.ceil((rows.length + off) / 7);
    const tot = r => r.flights + r.ask + r.sim + r.posts, max = Math.max(1, ...rows.map(tot));
    const W = 26 + weeks * (cs + gp), H = 7 * (cs + gp) + 16;
    let g = ['Mon', '', 'Wed', '', 'Fri', '', ''].map((t, i) => t ? `<text x="0" y="${16 + i * (cs + gp) + 10}" font-size="10" fill="var(--ink-3)">${t}</text>` : '').join('');
    rows.forEach((r, k) => {
      const i = k + off, x = 26 + Math.floor(i / 7) * (cs + gp), y = 16 + (i % 7) * (cs + gp), v = tot(r);
      if (i % 7 === 0 && new Date(r.day + 'T12:00:00Z').getUTCDate() <= 7) g += `<text x="${x}" y="10" font-size="10" fill="var(--ink-3)">${fmtDay(r.day, { month: 'short' })}</text>`;
      const parts = [r.flights && `${r.flights} flight${r.flights === 1 ? '' : 's'} logged`, r.ask && `${r.ask} Ask Boplo`, r.sim && `${r.sim} sim landing${r.sim === 1 ? '' : 's'}`, r.posts && `${r.posts} Q&A post${r.posts === 1 ? '' : 's'}`].filter(Boolean);
      g += `<rect x="${x}" y="${y}" width="${cs}" height="${cs}" rx="3" fill="${v ? 'var(--electric)' : 'var(--well)'}" opacity="${v ? (.3 + .7 * v / max).toFixed(2) : 1}"><title>${fmtDay(r.day, { weekday: 'short', day: 'numeric', month: 'short' })}: ${parts.length ? parts.join(', ') : 'nothing'}</title></rect>`;
    });
    return `<svg class="hm" width="${Math.round(W * 1.4)}" height="${Math.round(H * 1.4)}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Activity over the last 90 days">${g}</svg>`;
  }

  async function openUser(id) {
    showRes(''); box.blur();
    const u = new URL(location.href); u.searchParams.set('user', id); history.replaceState(null, '', u);
    body.innerHTML = '<section class="tile s12 sk" style="min-height:180px"></section><section class="tile s6 sk"></section><section class="tile s6 sk"></section>';
    $('[data-udn]').textContent = '';
    if (!dlg.open) dlg.showModal();
    let d; try { const r = await fetch('/flight/owner/user?id=' + encodeURIComponent(id), { credentials: 'same-origin' }); d = await r.json(); if (!r.ok) throw new Error(d.error || 'That user didn’t load.'); }
    catch (e) { body.innerHTML = `<section class="tile s12 gate"><h2>That user didn’t load</h2><p>${esc(e.message)}</p><button class="btn btn-line" data-retry>Try again</button></section>`; body.querySelector('[data-retry]').onclick = () => openUser(id); return; }
    renderUser(d);
  }

  function renderUser(d) {
    const A = d.account, P = d.profile, U = d.usage, L = d.plan, live = L && ['active', 'trialing', 'past_due'].includes(L.status);
    $('[data-udn]').textContent = A.email;
    const active90 = d.activity.filter(r => r.flights + r.ask + r.sim + r.posts).length;
    const chips = [
      live ? `<span class="chip">${planOf(L.status, L.price)}</span>` : d.school ? '' : '<span class="chip">Free</span>',
      L?.status === 'past_due' ? '<span class="chip warn">Payment failing</span>' : '', live && L.cancelling ? '<span class="chip warn">Cancelling at renewal</span>' : '',
      L && !live && L.status === 'canceled' ? '<span class="chip">Cancelled Advanced</span>' : '',
      d.school ? `<span class="chip">${esc(d.school.role[0].toUpperCase() + d.school.role.slice(1))} at ${esc(d.school.name || 'a school')}</span>` : '',
      !P ? '<span class="chip warn">No Flight desk yet</span>' : P.complete ? '' : '<span class="chip warn">Setup not finished</span>',
      A.owner ? '<span class="chip">Owner account</span>' : ''
    ].join('');
    const meta = [['Joined', fmtTs(A.created)], ['Last active', ago(A.lastActive)], ['Last signed in', ago(A.lastSignIn)], ['Signs in with', A.google ? 'Google' : 'Email link'],
      ['Came from', d.source ? srcName(d.source.src) + (d.source.ref && d.source.ref !== d.source.src ? ` (${d.source.ref})` : '') : 'Unknown'], ['First page', d.source?.landing ? ({ '/': 'Home page', '/flight-app.html': 'Flight desk', '/plan.html': 'Cost planner', '/schools.html': 'For schools' })[d.source.landing] || d.source.landing : '—'],
      ...(live ? [[L.cancelling ? 'Plan ends' : 'Renews', fmtTs(L.renews ? L.renews * 1000 : 0)]] : [])];
    const prof = P ? [['Training for', P.licence], ['Authority', P.authority], ['Country', P.country], ['Home airport', P.airport], ['School', P.school], ['Aircraft', P.aircraft], ['Next lesson', [P.nextLesson, P.lessonDate && fmtDay(P.lessonDate, { day: 'numeric', month: 'short', year: 'numeric' })].filter(Boolean).join(' · ')], ['Target date', P.target && fmtDay(P.target, { day: 'numeric', month: 'short', year: 'numeric' })], ['Hours goal', P.goalHours ? P.goalHours + ' h' : ''], ['Hours before Boplo', P.openingMinutes ? hrs(P.openingMinutes) : ''], ['Lessons a week', P.lessonsPerWeek || ''], ['Lesson rates', P.rateAircraft || P.rateInstructor ? `${P.currency || ''} ${P.rateAircraft || 0} aircraft + ${P.rateInstructor || 0} instructor an hour`.trim() : ''], ['Reminders', P.reminders ? 'On' : 'Off']].filter(([, v]) => v) : [];
    body.innerHTML = `
      <section class="tile s12 ud-id"><h2>${esc(A.name || P?.name || A.email)}</h2><a href="mailto:${esc(A.email)}">${esc(A.email)}</a>
        <div class="ud-chips">${chips}</div>
        <div class="ud-meta">${meta.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>
        ${L?.customer ? `<p style="margin-top:16px"><a class="btn btn-line btn-sm" href="https://dashboard.stripe.com/customers/${encodeURIComponent(L.customer)}" target="_blank" rel="noopener">Open in Stripe</a></p>` : ''}</section>
      <section class="tile s6"><h2>What they’ve done</h2><p class="sub">All time, unless it says otherwise</p>
        <div class="ostats"><div><b>${nf(U.flights)}</b><span>Flights logged</span></div><div><b>${hrs(U.minutes)}</b><span>Logged flight time</span></div><div><b>${hrs(U.soloMinutes)}</b><span>Solo or PIC</span></div><div><b>${nf(U.landings)}</b><span>Landings</span></div><div><b>${nf(U.ask)}</b><span>Ask Boplo questions<br>${nf(U.ask30)} in the last 30 days</span></div><div><b>${nf(U.scores)}</b><span>Scored sim landings${U.best != null ? `<br>Best ${nf(U.best)}, average ${nf(U.avg)}` : ''}</span></div><div><b>${nf(U.simFree)}</b><span>Free short finals</span></div><div><b>${nf(U.posts)}</b><span>Q&amp;A posts and answers</span></div><div><b>${U.lastFlight ? fmtDay(U.lastFlight, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</b><span>Last flight</span></div></div></section>
      <section class="tile s6"><h2>Training profile</h2><p class="sub">${P ? 'What they told Boplo' + (d.profileUpdated ? `, last changed ${ago(d.profileUpdated).toLowerCase()}` : '') : 'They haven’t set up a Flight desk'}</p>
        ${prof.length ? `<dl class="ud-dl">${prof.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '<p class="empty-s">Nothing filled in yet.</p>'}</section>
      <section class="tile s12"><h2>Activity, last 90 days</h2><p class="sub">Active on ${nf(active90)} of 90 days. Hover a day for what they did. Counts flights logged, Ask Boplo, sim landings and Q&amp;A posts.</p>${heatmap(d.activity)}
        <div class="hm-leg">Less <i style="background:var(--well)"></i><i style="background:var(--electric);opacity:.35"></i><i style="background:var(--electric);opacity:.65"></i><i style="background:var(--electric)"></i> More</div></section>
      <section class="tile s7"><h2>Latest flights</h2><p class="sub">The 10 most recent in their logbook</p>${d.flights.length ? `<div class="tw"><table class="ot"><thead><tr><th>Date</th><th>Route</th><th>Aircraft</th><th>Role</th><th class="r">Time</th><th class="r">Landings</th></tr></thead><tbody>${d.flights.map(f => `<tr><td>${f.date ? fmtDay(f.date, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td><td>${esc(f.dep || '?')} → ${esc(f.arr || '?')}</td><td>${esc(f.aircraft || '—')}</td><td>${esc(({ dual: 'Dual', solo: 'Solo', pic: 'PIC' })[f.role] || f.role || '—')}</td><td class="r">${hrs(f.minutes)}</td><td class="r">${nf(f.landings)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-s">No flights logged yet.</p>'}</section>
      <section class="tile s5"><h2>Latest sim landings</h2><p class="sub">Scored landings in the simulator</p>${d.scores.length ? `<div class="tw"><table class="ot"><thead><tr><th>When</th><th>Airport</th><th class="r">Score</th><th class="r">Touchdown</th></tr></thead><tbody>${d.scores.map(r => `<tr><td>${ago(r.created_at)}</td><td>${esc(r.ap)}${r.rw ? ' ' + esc(r.rw) : ''}<small>${esc(r.aircraft || '')}</small></td><td class="r">${nf(r.score)}</td><td class="r">${r.fpm != null ? nf(Math.abs(r.fpm)) + ' fpm' : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-s">No scored landings yet.</p>'}</section>
      ${d.posts.length ? `<section class="tile s12"><h2>Q&amp;A posts</h2><p class="sub">Their latest questions and answers</p><div class="tw"><table class="ot"><tbody>${d.posts.map(p => `<tr><td style="white-space:normal">${esc(p.title || (p.answer ? 'Answer' : 'Post'))}${p.hidden ? ' <span class="chip warn">Hidden</span>' : ''}<small>${esc(p.body)}</small></td><td class="r">${nf(p.score)} votes<small>${ago(p.created_at)}</small></td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
  }
  { const id = new URLSearchParams(location.search).get('user'); if (id) openUser(id); }

  document.querySelectorAll('[data-days]').forEach(b => b.onclick = () => { days = +b.dataset.days; try { localStorage.setItem('boplo-owner-days', days); } catch { } load(); });
  load();
})();
