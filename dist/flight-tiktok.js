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
    row.innerHTML = videos.slice(0, 12).map((v, i) => `<div class="tt-tile wait" data-id="${esc(v.id)}" data-kind="${esc(v.kind || '')}" role="group" aria-label="TikTok post ${i + 1} of ${Math.min(12, videos.length)}${v.title ? ': ' + esc(v.title) : ''}"></div>`).join('');
    // Every player starts paused and muted. With a mouse, only the post under it plays (with sound): slideshows don't all
    // flick through their pictures at once and nothing talks over itself. On touch screens a post plays when it's tapped.
    // Anything off screen, or scrolled past, is paused.
    const touch = matchMedia('(hover: none)').matches;
    const tiles = [...row.querySelectorAll('.tt-tile')], st = new Map();
    const send = (t, type) => { try { t.querySelector('iframe')?.contentWindow?.postMessage({ type, value: undefined, 'x-tiktok-player': true }, '*'); } catch { } };
    const live = o => o.vis && o.hover && !document.hidden;
    const apply = t => { const o = st.get(t); if (!o?.ready) return; if (live(o)) { send(t, 'unMute'); send(t, 'play'); } else if (!touch || !o.vis || document.hidden) { send(t, 'mute'); send(t, 'pause'); } };
    tiles.forEach((t, i) => {
      st.set(t, { ready: false, vis: false, hover: false });
      load(t, t.dataset.kind || 'photo', i > 4);
      t.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse') return; tiles.forEach(o => { const s2 = st.get(o); if (s2.hover && o !== t) { s2.hover = false; apply(o); } }); st.get(t).hover = true; apply(t); });
      t.addEventListener('pointerleave', e => { if (e.pointerType !== 'mouse') return; st.get(t).hover = false; apply(t); });
    });
    addEventListener('message', e => {
      let d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
      if (!d || !d['x-tiktok-player']) return;
      const t = tiles.find(x => x.querySelector('iframe')?.contentWindow === e.source); if (!t) return;
      if (d.type === 'onPlayerReady') { const o = st.get(t); o.ready = true; o.at = performance.now(); if (!live(o)) { send(t, 'mute'); send(t, 'pause'); } apply(t); }
      // a post that starts playing by itself (TikTok's autoplay) when it shouldn't is paused straight away;
      // on touch screens a tapped post may play, and any other that was playing stops
      else if (d.type === 'onStateChange' && d.value === 1) {
        const o = st.get(t);
        const tapped = touch && o.vis && performance.now() - (o.at || 0) > 2000; // TikTok's own autoplay comes right after loading; a tap comes later
        if (tapped) tiles.forEach(x => { if (x !== t && st.get(x).ready) { send(x, 'mute'); send(x, 'pause'); } });
        else if (!live(o)) { send(t, 'mute'); send(t, 'pause'); }
      }
    });
    // "on screen" means at least half the tile is visible, inside the row and inside the window
    const vio = new IntersectionObserver(es => es.forEach(e => { const o = st.get(e.target); const v = e.isIntersecting && e.intersectionRatio >= .5; if (v !== o.vis) { o.vis = v; if (!v) o.hover = false; apply(e.target); } }), { threshold: [0, .5, 1] });
    tiles.forEach(t => vio.observe(t));
    // TikTok's player only takes commands with the right start-up setting for the kind of post: a slideshow with autoplay on
    // ignores "pause" (and keeps flicking through its pictures), a video with autoplay off never gets ready. If a player
    // hasn't said it's ready a while after loading, it's reloaded with the other setting.
    function load(t, kind, lazy) {
      t.querySelector('iframe')?.remove(); const o = st.get(t); o.kind = kind; o.ready = false;
      const f = document.createElement('iframe');
      f.src = `https://www.tiktok.com/player/v1/${t.dataset.id}?autoplay=${kind === 'video' ? 1 : 0}&muted=1&loop=1&music_info=1&description=1&controls=1&progress_bar=1&rel=0&native_context_menu=0&closed_caption=1`;
      f.title = 'TikTok post from @boploflight'; f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture'; f.allowFullscreen = true;
      if (lazy) f.loading = 'lazy';
      f.onload = () => { t.classList.remove('wait'); if (!o.retried) setTimeout(() => { if (!o.ready && !o.retried) { o.retried = true; load(t, kind === 'video' ? 'photo' : 'video', false); } }, 10000); };
      t.appendChild(f);
    }
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
