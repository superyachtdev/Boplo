/* Boplo Flight landing: the latest @boploflight posts, each in TikTok's own player so the real video or
   slideshow shows right on the page. The list comes from /flight/tiktok (picked in owner analytics). */
(() => {
  const root = document.querySelector('[data-tt]'); if (!root) return;
  const row = root.querySelector('[data-tt-row]'), prev = root.querySelector('[data-tt-prev]'), next = root.querySelector('[data-tt-next]');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const arrows = () => { const over = row.scrollWidth > row.clientWidth + 4; prev.hidden = next.hidden = !over; prev.disabled = row.scrollLeft < 8; next.disabled = row.scrollLeft + row.clientWidth > row.scrollWidth - 8; };
  const step = d => { const t = row.querySelector('.tt-tile'); row.scrollBy({ left: d * ((t?.offsetWidth || 260) + 16) * 2, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
  prev.onclick = () => step(-1); next.onclick = () => step(1);
  row.addEventListener('scroll', arrows, { passive: true }); addEventListener('resize', arrows);

  function build(videos) {
    row.innerHTML = videos.slice(0, 12).map((v, i) => `<div class="tt-tile wait" data-id="${esc(v.id)}" role="group" aria-label="TikTok post ${i + 1} of ${Math.min(12, videos.length)}${v.title ? ': ' + esc(v.title) : ''}"></div>`).join('');
    // Every player starts muted. Only the posts actually on screen play, and only the one under the mouse has sound,
    // so a row of posts never talks over itself and nothing is heard once you've scrolled past.
    const tiles = [...row.querySelectorAll('.tt-tile')], st = new Map();
    const send = (t, type) => { try { t.querySelector('iframe')?.contentWindow?.postMessage({ type, value: undefined, 'x-tiktok-player': true }, '*'); } catch { } };
    const apply = t => { const o = st.get(t); if (!o?.ready) return; if (o.vis && !document.hidden) { send(t, o.hover ? 'unMute' : 'mute'); send(t, 'play'); } else { send(t, 'mute'); send(t, 'pause'); } };
    tiles.forEach((t, i) => {
      st.set(t, { ready: false, vis: false, hover: false });
      const f = document.createElement('iframe');
      f.src = `https://www.tiktok.com/player/v1/${t.dataset.id}?autoplay=1&muted=1&loop=1&music_info=1&description=1&controls=1&progress_bar=1&rel=0&native_context_menu=0&closed_caption=1`;
      f.title = 'TikTok post from @boploflight'; f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture'; f.allowFullscreen = true;
      if (i > 4) f.loading = 'lazy';
      f.onload = () => t.classList.remove('wait'); t.appendChild(f);
      t.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; tiles.forEach(o => { const s2 = st.get(o); if (s2.hover && o !== t) { s2.hover = false; apply(o); } }); st.get(t).hover = true; apply(t); });
      t.addEventListener('pointerleave', e => { if (e.pointerType !== 'mouse') return; st.get(t).hover = false; apply(t); });
    });
    addEventListener('message', e => {
      let d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
      if (!d || !d['x-tiktok-player']) return;
      const t = tiles.find(x => x.querySelector('iframe')?.contentWindow === e.source); if (!t) return;
      if (d.type === 'onPlayerReady') { st.get(t).ready = true; apply(t); }
      // a post that starts playing while off screen (TikTok's autoplay) is paused straight away
      else if (d.type === 'onStateChange' && d.value === 1 && !st.get(t).vis) { send(t, 'mute'); send(t, 'pause'); }
    });
    // "on screen" means at least half the tile is visible, inside the row and inside the window
    const vio = new IntersectionObserver(es => es.forEach(e => { const o = st.get(e.target); const v = e.isIntersecting && e.intersectionRatio >= .5; if (v !== o.vis) { o.vis = v; if (!v) o.hover = false; apply(e.target); } }), { threshold: [0, .5, 1] });
    tiles.forEach(t => vio.observe(t));
    document.addEventListener('visibilitychange', () => tiles.forEach(apply));
    requestAnimationFrame(arrows);
  }
  let started = false;
  const start = async () => {
    if (started) return; started = true;
    let d = null; try { d = await fetch('/flight/tiktok').then(r => r.ok ? r.json() : null); } catch { }
    if (d?.videos?.length) build(d.videos);
    else { row.outerHTML = '<p class="tt-none">New posts are on their way. Follow along on TikTok in the meantime.</p>'; prev.hidden = next.hidden = true; }
  };
  const near = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { near.disconnect(); start(); } }, { rootMargin: '800px 0px' });
  near.observe(root);
  addEventListener('load', () => setTimeout(start, 2500), { once: true });
})();
