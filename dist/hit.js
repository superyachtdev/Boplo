/* Boplo visit counter: no cookies, nothing personal. Counts a page view and remembers (on this device) where you first came from. */
(() => {
  try {
    const q = new URLSearchParams(location.search), src = q.get('utm_source') || q.get('ref') || q.get('src') || '';
    let ref = ''; try { const r = document.referrer && new URL(document.referrer); if (r && r.host !== location.host) ref = r.hostname; } catch { }
    try { if (!localStorage.getItem('boplo-first')) localStorage.setItem('boplo-first', JSON.stringify({ s: src, r: ref, l: location.pathname, t: Date.now() })); } catch { }
    const body = JSON.stringify({ p: location.pathname, r: ref, s: src });
    if (!(navigator.sendBeacon && navigator.sendBeacon('/flight/hit', new Blob([body], { type: 'text/plain' })))) fetch('/flight/hit', { method: 'POST', body, keepalive: true, credentials: 'omit' }).catch(() => { });
  } catch { }
})();
