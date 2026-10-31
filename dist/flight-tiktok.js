/* Boplo Flight landing: the @boploflight TikTok feed. Videos come from /flight/tiktok (set in owner analytics).
   Each slide shows the cover; a tap plays it in TikTok's own player. Only the playing slide holds a player. */
(() => {
  const root = document.querySelector('[data-tt]'); if (!root) return;
  const feed = root.querySelector('[data-tt-feed]'), up = root.querySelector('[data-tt-up]'), down = root.querySelector('[data-tt-down]'), out = root.querySelector('[data-tt-n]');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
  let slides = [], cur = 0;

  const stop = s => { s.querySelector('iframe')?.remove(); s.classList.remove('playing'); };
  const play = s => {
    slides.forEach(o => o !== s && stop(o));
    if (s.querySelector('iframe')) return;
    const f = document.createElement('iframe');
    f.src = `https://www.tiktok.com/player/v1/${s.dataset.id}?autoplay=1&loop=1&music_info=1&description=1&rel=0&native_context_menu=0`;
    f.title = 'TikTok video from @boploflight'; f.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture'; f.allowFullscreen = true; f.loading = 'lazy';
    s.appendChild(f); s.classList.add('playing');
  };
  const sync = () => { out.textContent = slides.length ? `${cur + 1} / ${slides.length}` : ''; up.disabled = cur <= 0; down.disabled = cur >= slides.length - 1; };
  const go = i => { i = Math.max(0, Math.min(slides.length - 1, i)); const wasPlaying = slides[cur]?.classList.contains('playing'); slides[i]?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' }); if (wasPlaying && i !== cur) setTimeout(() => play(slides[i]), 350); };
  up.onclick = () => go(cur - 1); down.onclick = () => go(cur + 1);
  root.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); go(cur + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); go(cur - 1); } });

  function build(videos) {
    feed.innerHTML = videos.map((v, i) => `<div class="tt-slide" data-id="${esc(v.id)}" style="${v.thumb ? `background-image:url('${esc(v.thumb)}')` : ''}" role="group" aria-roledescription="video" aria-label="Video ${i + 1} of ${videos.length}">
      <button type="button" class="tt-play" aria-label="Play${v.title ? ': ' + esc(v.title) : ' this video'}"><span>${PLAY}</span></button>
      <div class="tt-cap"><b>@boploflight</b>${v.title ? `<p>${esc(v.title)}</p>` : ''}</div></div>`).join('');
    slides = [...feed.querySelectorAll('.tt-slide')];
    slides.forEach(s => s.querySelector('.tt-play').onclick = () => play(s));
    // whichever slide fills the screen is the current one; scrolling away stops the one that was playing
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && e.intersectionRatio > .6) { cur = slides.indexOf(e.target); sync(); } else if (!e.isIntersecting || e.intersectionRatio < .3) stop(e.target); }), { root: feed, threshold: [0, .3, .6, 1] });
    slides.forEach(s => io.observe(s)); sync();
  }
  // no videos picked yet: TikTok's own profile widget, which lists the latest posts
  function creatorEmbed() {
    root.querySelector('.tt-ctrl').hidden = true;
    feed.className = 'tt-embed';
    feed.innerHTML = '<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@boploflight" data-unique-id="boploflight" data-embed-type="creator" style="max-width:780px;min-width:288px"><section><a target="_blank" rel="noopener" href="https://www.tiktok.com/@boploflight?refer=creator_embed">@boploflight</a></section></blockquote>';
    const s = document.createElement('script'); s.async = true; s.src = 'https://www.tiktok.com/embed.js'; document.body.appendChild(s);
  }
  // load once the section is close, so the rest of the page isn't slowed down
  const start = async () => {
    let d = null; try { d = await fetch('/flight/tiktok').then(r => r.ok ? r.json() : null); } catch { }
    if (d?.videos?.length) build(d.videos); else creatorEmbed();
  };
  const near = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { near.disconnect(); start(); } }, { rootMargin: '600px 0px' });
  near.observe(root);
})();
