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
    // the browser loads each player as its tile comes near the screen (native lazy loading), the first few straight away
    row.querySelectorAll('.tt-tile').forEach((t, i) => {
      const f = document.createElement('iframe');
      f.src = `https://www.tiktok.com/player/v1/${t.dataset.id}?music_info=1&description=1&controls=1&progress_bar=1&rel=0&native_context_menu=0&closed_caption=1`;
      f.title = 'TikTok post from @boploflight'; f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture'; f.allowFullscreen = true;
      if (i > 4) f.loading = 'lazy';
      f.onload = () => t.classList.remove('wait'); t.appendChild(f);
    });
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
