(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COVER = { SKC: 'Sky clear', CLR: 'Clear below 12,000 ft', NSC: 'No significant cloud', NCD: 'No cloud detected', FEW: 'Few clouds (1–2 oktas)', SCT: 'Scattered clouds (3–4 oktas)', BKN: 'Broken clouds (5–7 oktas)', OVC: 'Overcast (8 oktas)', VV: 'Sky obscured, vertical visibility' };
  const DESC = { MI: 'shallow', PR: 'partial', BC: 'patches of', DR: 'low drifting', BL: 'blowing', SH: 'showers of', TS: 'thunderstorm with', FZ: 'freezing' };
  const PH = { DZ: 'drizzle', RA: 'rain', SN: 'snow', SG: 'snow grains', IC: 'ice crystals', PL: 'ice pellets', GR: 'hail', GS: 'small hail', UP: 'unknown precipitation', BR: 'mist', FG: 'fog', FU: 'smoke', VA: 'volcanic ash', DU: 'dust', SA: 'sand', HZ: 'haze', PY: 'spray', PO: 'dust whirls', SQ: 'squalls', FC: 'funnel cloud', SS: 'sandstorm', DS: 'duststorm' };
  const ft = n => Number(n).toLocaleString('en-US');
  const frac = v => { const m = v.match(/^(\d+)?\s?(\d)\/(\d)$/); return m ? (Number(m[1] || 0) + m[2] / m[3]) : Number(v); };

  function decode(raw) {
    const t = raw.trim().toUpperCase().replace(/=+$/, '').split(/\s+/);
    const rows = []; let i = 0, ceil = Infinity, vis = null;
    const add = (code, title, text) => rows.push({ code, title, text });
    if (t[i] === 'METAR' || t[i] === 'SPECI') { add(t[i], 'Report type', t[i] === 'SPECI' ? 'Special report, issued because conditions changed' : 'Routine hourly report'); i++; }
    if (/^[A-Z][A-Z0-9]{3}$/.test(t[i] || '')) { add(t[i], 'Station', t[i]); i++; }
    let m;
    if ((m = (t[i] || '').match(/^(\d{2})(\d{2})(\d{2})Z$/))) { add(t[i], 'Time', `Day ${Number(m[1])} of the month at ${m[2]}:${m[3]} UTC (Zulu)`); i++; }
    if (t[i] === 'AUTO' || t[i] === 'COR') { add(t[i], t[i] === 'AUTO' ? 'Automated' : 'Corrected', t[i] === 'AUTO' ? 'Fully automated report, no human observer' : 'A correction to an earlier report'); i++; }
    if ((m = (t[i] || '').match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))) {
      const u = m[4] === 'KT' ? 'knots' : 'm/s';
      add(t[i], 'Wind', m[2] === '00' && m[1] === '000' ? 'Calm' : `${m[1] === 'VRB' ? 'Variable direction' : 'From ' + Number(m[1]) + '°'} at ${Number(m[2])} ${u}${m[3] ? ', gusting ' + Number(m[3]) + ' ' + u : ''}`); i++;
    }
    if ((m = (t[i] || '').match(/^(\d{3})V(\d{3})$/))) { add(t[i], 'Wind varying', `Direction varies between ${Number(m[1])}° and ${Number(m[2])}°`); i++; }
    if (t[i] === 'CAVOK') { add('CAVOK', 'Ceiling and visibility OK', 'Visibility 10 km or more, no cloud below 5,000 ft, no significant weather'); vis = 10; i++; }
    else {
      let v = t[i] || '';
      if (/^\d$/.test(v) && /^\d\/\dSM$/.test(t[i + 1] || '')) { v = v + ' ' + t[i + 1]; i++; }
      if ((m = v.match(/^(P|M)?([\d\s/]+)SM$/))) { vis = frac(m[2].trim()); add(v, 'Visibility', `${m[1] === 'P' ? 'More than ' : m[1] === 'M' ? 'Less than ' : ''}${m[2].trim()} statute mile${vis === 1 ? '' : 's'}`); i++; }
      else if (/^\d{4}$/.test(v)) { const n = Number(v); vis = n / 1609; add(v, 'Visibility', n === 9999 ? '10 km or more' : `${ft(n)} metres`); i++; }
    }
    while ((m = (t[i] || '').match(/^R(\d{2}[LCR]?)\/([PM]?\d{4})(?:V([PM]?\d{4}))?(FT)?/))) { add(t[i], 'Runway visual range', `Runway ${m[1]}: ${m[2].replace(/^P/, 'above ').replace(/^M/, 'below ')}${m[3] ? ' to ' + m[3] : ''} ${m[4] ? 'ft' : 'm'}`); i++; }
    while ((m = (t[i] || '').match(/^(-|\+|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)?$/)) && (m[2] || m[3])) {
      const ph = (m[3] || '').match(/../g) || [];
      const intensity = m[1] === '-' ? 'Light ' : m[1] === '+' ? 'Heavy ' : m[1] === 'VC' ? 'In the vicinity: ' : '';
      const text = (intensity + [DESC[m[2]] || '', ph.map(p => PH[p]).join(' and ')].filter(Boolean).join(' ')).trim();
      add(t[i], 'Weather', text.charAt(0).toUpperCase() + text.slice(1)); i++;
    }
    while ((m = (t[i] || '').match(/^(SKC|CLR|NSC|NCD|FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)?(CB|TCU)?$/))) {
      const h = m[2] && m[2] !== '///' ? Number(m[2]) * 100 : null;
      if ((m[1] === 'BKN' || m[1] === 'OVC' || m[1] === 'VV') && h != null) ceil = Math.min(ceil, h);
      add(t[i], 'Clouds', `${COVER[m[1]]}${h != null ? ' at ' + ft(h) + ' ft above ground' : ''}${m[3] === 'CB' ? ', cumulonimbus (thunderstorm cloud)' : m[3] === 'TCU' ? ', towering cumulus' : ''}${(m[1] === 'BKN' || m[1] === 'OVC') && h != null && ceil === h ? ' (this is the ceiling)' : ''}`); i++;
    }
    if ((m = (t[i] || '').match(/^(M?\d{2})\/(M?\d{2})?$/))) {
      const c = s => s ? Number(s.replace('M', '-')) : null, T = c(m[1]), D = c(m[2]);
      add(t[i], 'Temperature / dew point', `${T}°C, dew point ${D ?? 'missing'}°C${D != null ? ` (spread ${T - D}°C${T - D <= 3 ? ', fog or low cloud possible' : ''})` : ''}`); i++;
    }
    if ((m = (t[i] || '').match(/^A(\d{4})$/))) { add(t[i], 'Altimeter', `${m[1].slice(0, 2)}.${m[1].slice(2)} inHg`); i++; }
    else if ((m = (t[i] || '').match(/^Q(\d{4})$/))) { add(t[i], 'Altimeter (QNH)', `${Number(m[1])} hPa`); i++; }
    const rest = t.slice(i);
    const rmk = rest.indexOf('RMK');
    const before = rmk < 0 ? rest : rest.slice(0, rmk);
    if (before.length) add(before.join(' '), 'Other groups', before.includes('NOSIG') ? 'NOSIG: no significant change expected in the next 2 hours' : 'Trend or extra groups not decoded here');
    if (rmk >= 0) {
      const r = rest.slice(rmk + 1), bits = [];
      r.forEach(x => {
        if (x === 'AO2') bits.push('AO2: automated station with a precipitation sensor');
        else if (x === 'AO1') bits.push('AO1: automated station without a precipitation sensor');
        else if ((m = x.match(/^SLP(\d{3})$/))) bits.push(`SLP${m[1]}: sea-level pressure ${(Number(m[1]) / 10 + (Number(m[1]) < 500 ? 1000 : 900)).toFixed(1)} hPa`);
        else if ((m = x.match(/^T([01])(\d{3})([01])(\d{3})$/))) bits.push(`${x}: temperature ${(m[1] === '1' ? '-' : '') + Number(m[2]) / 10}°C, dew point ${(m[3] === '1' ? '-' : '') + Number(m[4]) / 10}°C (precise)`);
      });
      add('RMK ' + r.join(' '), 'Remarks', bits.length ? bits.join('<br>') : 'Extra notes for pilots and forecasters');
    }
    let cat = null;
    if (vis != null || ceil !== Infinity) {
      const v = vis ?? 99;
      cat = ceil < 500 || v < 1 ? 'LIFR' : ceil < 1000 || v < 3 ? 'IFR' : ceil <= 3000 || v <= 5 ? 'MVFR' : 'VFR';
    }
    return { rows, cat };
  }

  function render(raw, meta) {
    const { rows, cat } = decode(raw);
    const label = { VFR: 'Visual flight rules', MVFR: 'Marginal VFR', IFR: 'Instrument flight rules', LIFR: 'Low IFR' };
    $('#mx-out').innerHTML = `
      ${meta ? `<p class="mx-meta">${esc(meta)}</p>` : ''}
      <pre class="mx-raw">${esc(raw)}</pre>
      ${cat ? `<div class="mx-cat mx-${cat.toLowerCase()}"><b>${cat}</b><span>${label[cat]}</span></div>` : ''}
      <dl class="mx-list">${rows.map(r => `<div><dt><code>${esc(r.code)}</code><span>${esc(r.title)}</span></dt><dd>${r.text.includes('<br>') ? r.text.split('<br>').map(esc).join('<br>') : esc(r.text)}</dd></div>`).join('')}</dl>`;
  }

  async function lookup(q) {
    const out = $('#mx-out');
    q = q.trim();
    if (!q) return;
    if (q.split(/\s+/).length > 2) { render(q); return; }
    out.innerHTML = '<p class="mx-meta">Fetching the latest report…</p>';
    try {
      const r = await fetch('/wx?id=' + encodeURIComponent(q));
      const d = await r.json();
      if (!r.ok) { out.innerHTML = `<p class="mx-err">${esc(d.error || 'Something went wrong.')}</p>`; return; }
      render(d.raw, `${d.id}${d.name ? ' · ' + d.name : ''} · live from ${d.source}`);
      if (d.taf) out.insertAdjacentHTML('beforeend', `<h3>Forecast (TAF)</h3><pre class="mx-raw">${esc(d.taf)}</pre>`);
    } catch { out.innerHTML = '<p class="mx-err">Couldn’t reach the weather service. Paste a METAR instead.</p>'; }
  }

  $('#mx-form').addEventListener('submit', e => { e.preventDefault(); const q = $('#mx-in').value; history.replaceState(null, '', '?q=' + encodeURIComponent(q.trim())); lookup(q); });
  document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => { $('#mx-in').value = b.dataset.q; lookup(b.dataset.q); }));
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) { $('#mx-in').value = q0; lookup(q0); }
})();
