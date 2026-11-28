/* Boplo retention dashboard: reads /flight/owner/retention (owner accounts only). */
(() => {
  const $ = s => document.querySelector(s), main = $('#ow');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = n => Number(n || 0).toLocaleString('en-US');
  const pc = v => v == null ? '—' : `${v}%`;
  let LABEL = {};
  const nm = s => LABEL[s] || String(s || '').replace(/_/g, ' ');
  const fmt = day => new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  let days = 30, pf = 'all';
  try { days = +localStorage.getItem('boplo-ret-days') || 30; pf = localStorage.getItem('boplo-ret-pf') || 'all'; } catch { }

  const tile = (cls, title, sub, body) => `<section class="tile ${cls}"><h2>${esc(title)}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}${body}</section>`;
  const empty = t => `<p class="empty-s">${esc(t)}</p>`;
  const bars = (rows, { label = r => r.k, extra = () => '', cls = () => '', none = 'Nothing yet.' } = {}) => {
    if (!rows?.length) return empty(none);
    const max = Math.max(...rows.map(r => r.n), 1);
    return `<div class="bars">${rows.map(r => `<div class="bar"><span class="k" title="${esc(label(r))}">${esc(label(r))}</span><span class="t"><span class="f ${cls(r)}" style="width:${r.n / max * 100}%"></span></span><span class="n">${nf(r.n)}${extra(r)}</span></div>`).join('')}</div>`;
  };
  // one column per step, % of the start on top, people lost under the label
  const columns = (steps, worst) => {
    const max = Math.max(1, ...steps.map(s => s.n));
    return `<div class="cols">${steps.map(s => `<div class="col"><div class="c ${s === worst ? 'lo' : ''}" style="height:${Math.max(1, s.n / max * 100)}%"><span>${pc(s.ofStart)}<em>(${nf(s.n)})</em></span></div><div class="l">${esc(s.label)}</div><div class="dr">${s.drop > 0 ? '−' + nf(s.drop) : ''}</div></div>`).join('')}</div>`;
  };
  const table = (head, rows) => `<div class="tw"><table class="ot"><thead><tr>${head.map(h => `<th class="${h[1] || ''}">${esc(h[0])}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

  function funnelTile(name, f) {
    const shown = f.map((s, i) => ({ ...s, drop: i ? f[i - 1].n - s.n : 0 }));
    const worst = shown.slice(1).filter(s => s.drop > 0).sort((a, b) => b.drop - a.drop)[0];
    return tile('s12', `${name}: from first open to paying`, 'New people in this period, step by step. The orange column is where most people are lost.',
      columns(shown, worst) + table([['Step'], ['People', 'r'], ['% from start', 'r'], ['% from previous', 'r']],
        f.map(s => `<tr><td>${esc(s.label)}</td><td class="r">${nf(s.n)}</td><td class="r">${pc(s.ofStart)}</td><td class="r ${s.ofPrev != null && s.ofPrev < 60 ? 'rate hi' : ''}">${pc(s.ofPrev)}</td></tr>`)));
  }

  function draw(d) {
    LABEL = d.labels || {};
    const t = d.totals, h = [];
    $('[data-gen]').textContent = `Where people drop off, where they close the app, and what keeps them. ${nf(t.events)} events from ${nf(t.people)} people in the last ${d.days} days.`;

    h.push(tile('s12', 'What to fix first', 'Worked out from the numbers below. The more people behind a finding, the more it means.',
      `<div class="ins">${d.insights.map(i => `<div class="in ${i.tone}"><b>${esc(i.title)}</b><p>${esc(i.text)}</p>${i.action ? `<p class="do">${esc(i.action)}</p>` : ''}</div>`).join('') || empty('No findings yet.')}</div>`));

    const d1 = d.returning.find(r => r.day === 1), d7 = d.returning.find(r => r.day === 7);
    const kpi = (lab, big, small) => `<section class="tile s3 kpi"><div class="lab">${esc(lab)}</div><div class="big">${big}</div><small>${small}</small></section>`;
    h.push(kpi('New people', nf(t.fresh), `${nf(t.people)} active in total · ${nf(t.active7)} in the last 7 days`));
    h.push(kpi('Came back after day 1', pc(d1?.rate), d1?.n ? `${nf(d1.back)} of ${nf(d1.n)} new people` : 'Not enough days yet'));
    h.push(kpi('Still here after a week', pc(d7?.rate), d7?.n ? `${nf(d7.back)} of ${nf(d7.n)} new people` : 'Not enough days yet'));
    h.push(kpi('Trials cancelled', pc(d.trials.cancelRate), d.trials.started ? `${nf(d.trials.cancelled)} of ${nf(d.trials.started)} trials${d.trials.medianHoursToCancel != null ? ` · median ${d.trials.medianHoursToCancel} h in` : ''}` : 'No trials in this period yet'));

    if (d.funnels.ios) h.push(funnelTile('iPhone app', d.funnels.ios));
    if (d.funnels.web) h.push(funnelTile('Website', d.funnels.web));

    for (const [k, path] of Object.entries(d.paths)) {
      if (!path.some(s => s.n)) continue;
      const worst = path.slice(1).filter(s => s.drop).sort((a, b) => b.drop - a.drop)[0];
      h.push(tile('s12', `${k === 'ios' ? 'iPhone' : 'Website'} first run, screen by screen`, 'How many new people reached each screen. The number in orange under a screen is how many were lost just before it.', columns(path, worst)));
    }

    h.push(tile('s6', 'Where visits end', 'The last screen of each visit (no activity for 30 minutes after it). Some of this is normal: people close the app when they’re done.',
      bars(d.closed.map(c => ({ k: nm(c.screen), n: c.n, share: c.share })), { extra: r => `<em>${pc(r.share)}</em>`, none: 'No finished visits yet.' })));
    h.push(tile('s6', 'Last screen before leaving for good', `${nf(d.gone.people)} of ${nf(d.gone.of)} people haven’t been back for 7 days or more. This is the last thing they saw.`,
      bars(d.gone.screens.map(c => ({ k: nm(c.screen), n: c.n, share: c.share })), { extra: r => `<em>${pc(r.share)}</em>`, cls: () => 'lo', none: 'Nobody has left yet.' }) +
      `<h2 style="margin-top:20px">How long they stayed</h2><p class="sub">Time from their first visit to their last.</p>` + bars(d.gone.afterDays.map(b => ({ k: b.label, n: b.n })), { cls: () => 'lo', none: '—' })));

    const scrRows = s => s.map(x => `<tr><td>${esc(nm(x.screen))}<small class="scr">${esc(x.screen)}</small></td><td class="r">${nf(x.views)}</td><td class="r">${nf(x.people)}</td><td class="r">${x.secs == null ? '—' : x.secs < 60 ? x.secs + ' s' : Math.round(x.secs / 6) / 10 + ' min'}</td><td class="r">${nf(x.exits)}</td><td class="r ${x.exitRate >= 30 && x.views >= 10 ? 'rate hi' : ''}">${pc(x.exitRate)}</td></tr>`);
    h.push(`<section class="tile s12"><h2>Every screen</h2><p class="sub">Views, typical time spent, and how often a visit ended there. A high exit rate on a screen that isn’t a natural end point is a problem.</p>
      <div class="tabs" role="group" aria-label="Sort"><button type="button" data-sort="views" aria-pressed="true">Most viewed</button><button type="button" data-sort="exit" aria-pressed="false">Highest exit rate</button><button type="button" data-sort="time" aria-pressed="false">Most time</button></div>
      <div data-screens></div>${d.screens.length > 12 ? `<button type="button" class="btn btn-line btn-sm more" data-all>Show all ${d.screens.length} screens</button>` : ''}</section>`);

    const ret = d.returning.filter(r => r.n);
    h.push(tile('s5', 'Coming back', 'Of the new people, the share who opened Boplo again on that day or later.',
      ret.length ? bars(ret.map(r => ({ k: `Day ${r.day}+`, n: r.rate ?? 0, r })), { extra: r => `%<em>${nf(r.r.back)} of ${nf(r.r.n)}</em>`, cls: r => r.n >= 40 ? 'ok' : r.n < 20 ? 'lo' : '' }) : empty('Needs at least a day of data.')));
    const shade = v => v == null ? '' : `background:rgba(47,123,255,${Math.min(.85, .08 + v / 100 * .8)});color:${v > 55 ? '#fff' : 'var(--ink)'}`;
    h.push(tile('s7', 'Weekly groups', 'People grouped by the week they first opened Boplo, and the share active in each following week.',
      d.cohorts.length ? table([['First week'], ['People', 'r'], ['Week 1'], ['Week 2'], ['Week 3'], ['Week 4']],
        d.cohorts.map(c => `<tr><td>${new Date(c.week + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td><td class="r">${nf(c.n)}</td>${c.weeks.map(v => `<td class="h" style="${shade(v)}">${v == null ? '' : v + '%'}</td>`).join('')}</tr>`)).replace('class="ot"', 'class="ot hm-t"') : empty('No groups yet.')));

    const maxA = Math.max(1, ...d.daily.map(x => x.active));
    h.push(tile('s12', 'Active people each day', '<span class="leg" style="display:inline-flex"><span><i style="background:var(--electric)"></i>Returning</span><span><i style="background:#9ED8FF"></i>New that day</span></span>',
      `<div class="cols" style="height:180px;grid-auto-columns:minmax(10px,1fr);gap:3px;padding-top:8px">${d.daily.map(x => `<div class="col" style="min-width:10px" title="${esc(x.day)}: ${x.active} active, ${x.new} new"><div style="height:${x.active / maxA * 100}%;display:flex;flex-direction:column;border-radius:4px 4px 2px 2px;overflow:hidden;min-height:${x.active ? 2 : 0}px"><i style="flex:${x.active - x.new};background:var(--electric)"></i><i style="flex:${x.new};background:#9ED8FF"></i></div></div>`).join('')}</div>` +
      (d.daily.length ? `<div class="axis"><span>${fmt(d.daily[0].day)}</span><span>${fmt(d.daily[d.daily.length >> 1].day)}</span><span>${fmt(d.daily[d.daily.length - 1].day)}</span></div>` : '')));

    const fb = d.featureBase;
    h.push(tile('s12', 'What the people who stay do in their first 3 days', `Signed-in people who started at least 8 days ago: ${nf(fb.kept)} were still using Boplo after a week, ${nf(fb.lost)} weren’t.`,
      fb.kept + fb.lost ? `<div class="leg"><span><i style="background:#1E9A55"></i>Still here after a week</span><span><i style="background:#E2552B"></i>Gone by then</span></div><div class="fx">${d.features.map(f => `<div class="fx-r"><span>${esc(f.name)}<br><small>${pc(f.kept)} vs ${pc(f.lost)}${f.lift ? ` · ${f.lift}×` : ''}</small></span><span class="fx-b"><i class="k" style="width:${f.kept || 0}%"></i><i class="x" style="width:${f.lost || 0}%"></i></span></div>`).join('')}</div>` : empty('Needs people who started at least 8 days ago.')));

    const tr = d.trials;
    h.push(tile('s6', 'When trials are cancelled', tr.started ? `${nf(tr.started)} trials started, ${nf(tr.cancelled)} cancelled, ${nf(tr.paid)} paid so far. Time from starting the trial to turning off renewal.` : 'Fills in as trials start and Apple or Stripe report cancellations.',
      tr.cancelled ? bars(tr.when.map(w => ({ k: w.label, n: w.n })), { cls: () => 'lo' }) : empty('No cancellations yet.')));
    const cmpRow = (lab, k) => `<tr><td>${lab}</td><td class="r">${tr.keepers[k] ?? '—'}</td><td class="r">${tr.cancellers[k] ?? '—'}</td></tr>`;
    h.push(tile('s6', 'Keepers and cancellers during the trial', 'Typical (median) values in the 3 trial days.',
      table([['', ''], [`Kept it (${tr.keepers.people})`, 'r'], [`Cancelled (${tr.cancellers.people})`, 'r']], [cmpRow('Visits', 'sessions'), cmpRow('Days opened', 'days'), cmpRow('Features used', 'features')]) +
      `<h2 style="margin-top:20px">Last screen before cancelling</h2>` + bars(tr.lastScreen.map(x => ({ k: nm(x.screen), n: x.n })), { cls: () => 'lo', none: 'No cancellations yet.' }) +
      `<p class="sub" style="margin-top:14px">Plans picked: ${nf(tr.plans.yearly)} yearly · ${nf(tr.plans.monthly)} monthly</p>`));

    const pw = d.paywall;
    h.push(tile('s12', 'Where purchases start', `The trial offer was seen by ${nf(pw.gateViews)} people; the paywall sheet opened ${nf(pw.paywallViews)} times.`,
      pw.sources.length ? table([['Started from'], ['Started', 'r'], ['Completed', 'r'], ['Backed out', 'r'], ['Completed %', 'r']],
        pw.sources.map(s => `<tr><td>${esc(nm(s.from))}</td><td class="r">${nf(s.start)}</td><td class="r">${nf(s.success)}</td><td class="r">${nf(s.cancel)}</td><td class="r">${s.start ? Math.round(s.success / s.start * 100) + '%' : '—'}</td></tr>`)) : empty('No purchases started yet.')));

    h.push(`<p class="note">Counts people by account once they sign in, and by install before that. iPhone numbers start with version 1.7; website numbers start from ${new Date(2026, 10, 28).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}. Sandbox and owner purchases are included, so expect a little noise while testing.</p>`);
    main.innerHTML = h.join('');

    const box = $('[data-screens]'); let sort = 'views', all = false;
    const paint = () => {
      const s = [...d.screens].sort(sort === 'exit' ? (x, y) => (y.views >= 10) - (x.views >= 10) || (y.exitRate ?? 0) - (x.exitRate ?? 0) : sort === 'time' ? (x, y) => (y.secs ?? 0) - (x.secs ?? 0) : (x, y) => y.views - x.views);
      box.innerHTML = s.length ? table([['Screen'], ['Views', 'r'], ['People', 'r'], ['Typical time', 'r'], ['Visits ended here', 'r'], ['Exit rate', 'r']], scrRows(all ? s : s.slice(0, 12))) : empty('No screens recorded yet.');
    };
    paint();
    main.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { main.querySelectorAll('[data-sort]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); sort = b.dataset.sort; paint(); });
    const more = $('[data-all]'); if (more) more.onclick = () => { all = !all; more.textContent = all ? 'Show fewer' : `Show all ${d.screens.length} screens`; paint(); };
  }

  async function load() {
    document.querySelectorAll('[data-days]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.days === days)));
    document.querySelectorAll('[data-pf]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pf === pf)));
    main.setAttribute('aria-busy', 'true');
    let d;
    try {
      const r = await fetch(`/flight/owner/retention?days=${days}&platform=${pf}`, { credentials: 'same-origin' });
      d = await r.json();
      if (r.status === 401) { main.innerHTML = `<section class="tile gate"><h2>Sign in first</h2><p>This page is for the owner account.</p><a class="btn btn-blue" href="/flight-app.html">Sign in</a></section>`; return; }
      if (!r.ok) throw new Error(d.error || 'The numbers didn’t load.');
    } catch (e) { main.innerHTML = `<section class="tile gate"><h2>Couldn’t load retention</h2><p>${esc(e.message)}</p><button class="btn btn-blue" type="button" onclick="location.reload()">Try again</button></section>`; return; }
    finally { main.removeAttribute('aria-busy'); }
    draw(d);
  }
  document.querySelectorAll('[data-days]').forEach(b => b.onclick = () => { days = +b.dataset.days; try { localStorage.setItem('boplo-ret-days', days); } catch { } load(); });
  document.querySelectorAll('[data-pf]').forEach(b => b.onclick = () => { pf = b.dataset.pf; try { localStorage.setItem('boplo-ret-pf', pf); } catch { } load(); });
  load();
})();
