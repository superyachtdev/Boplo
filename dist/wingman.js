(() => {
  const site = document.createElement('main');
  site.id = 'wingman-site';
  site.innerHTML = `
    <div class="w-wrap"><header class="w-nav"><a class="w-logo" href="#top" aria-label="Boplo home"><i aria-hidden="true"></i><span>boplo</span></a><nav class="w-nav-right"><a href="#how">How it works</a><a href="#features">Features</a><a href="#privacy">Privacy</a><button class="w-button" data-wingman-start>Try Boplo</button></nav></header></div>
    <section class="w-hero" id="top"><div class="w-glow"></div><div class="w-wrap w-hero-inner"><div class="w-kicker"><b>NEW</b> &nbsp;YOUR AI RIZZ WINGMAN</div><h1 class="w-title">Never overthink<br>the <span>reply.</span></h1><p class="w-sub">Upload the chat. Get a reply that actually sounds like you.</p><div class="w-hero-actions"><button class="w-button gradient" data-wingman-start>Get your rizz ↗</button><a class="w-text-button" href="#how">See how it works ↓</a></div><div class="w-phone" aria-label="Illustrative Boplo chat reply app"><div class="w-screen"><div class="w-app-head">boplo<span>AI</span></div><div class="w-profile"><div class="w-profile-row"><i class="w-avatar"></i><div><b>Maya, 22</b><small>Match · 2 miles away</small></div></div></div><div class="w-prompt">WHAT SHOULD WE FOCUS ON?</div><div class="w-bubble">That place is elite. You are definitely choosing the first drink though.<small>suggested reply</small></div><div class="w-bubble two">Okay, but only if you promise not to judge my bowling score.<small>suggested reply</small></div><button class="w-app-button">more rizz ✦</button></div></div><p class="w-trust"><b>3 free reads.</b> No card required.</p></div></section>
    <div class="w-marquee"><div>CHAT READS <i>✦</i> PROFILE REVIEWS <i>✦</i> BETTER OPENERS <i>✦</i> DATE MOVES <i>✦</i> CHAT READS <i>✦</i> PROFILE REVIEWS <i>✦</i> BETTER OPENERS <i>✦</i> DATE MOVES <i>✦</i></div></div>
    <section class="w-section" id="how"><div class="w-wrap"><div class="w-section-head w-reveal"><span class="w-eyebrow">THE SIMPLE BIT</span><h2>A better reply in seconds.</h2><p>No corny pickup-line generator. Just useful rizz for the exact chat you are in.</p></div><div class="w-flow"><article class="w-flow-card w-reveal"><i>01</i><h3>Upload</h3><p>Drop in a screenshot from Hinge, Tinder, iMessage, Instagram, or wherever the chat is happening.</p><b>PRIVATE BY DEFAULT</b></article><article class="w-flow-card w-reveal"><i>02</i><h3>Choose your vibe</h3><p>Keep it funny, smooth, bold, or genuine. Boplo works from the tone you actually want.</p><b>YOUR VOICE, NOT AI VOICE</b></article><article class="w-flow-card w-reveal"><i>03</i><h3>Copy. Send.</h3><p>Pick the one that feels most you, make it your own, then stop staring at the typing bar.</p><b>ONE GOOD NEXT MOVE</b></article></div></div></section>
    <section class="w-section light" id="features"><div class="w-wrap"><div class="w-feature-block"><div class="w-feature-copy w-reveal"><span class="w-eyebrow">READ THE ROOM</span><h2>More than<br>a good line.</h2><p>Boplo sees the context, not just the last message. It gives you a clearer next move without pretending it can read someone’s mind.</p><ul class="w-checks"><li>Conversation tone and momentum</li><li>Three replies, in your chosen vibe</li><li>A simple recommendation for what to do next</li></ul></div><div class="w-card-ui w-reveal"><div class="w-ui-bar"><b>YOUR CHAT READ</b><span>PRIVATE</span></div><div class="w-message-row"><div class="w-message">You always find the best places though.</div><div class="w-message user">Only because I take food seriously.</div></div><div class="w-verdict"><small>THE READ</small><b>Warm. Keep it playful.</b><p>They gave you an easy opening. Match the energy and make the next message easy to answer.</p></div></div></div><div class="w-feature-block reverse" id="privacy"><div class="w-feature-copy w-reveal"><span class="w-eyebrow">SOUNDS LIKE YOU</span><h2>Rizz without<br>the cringe.</h2><p>Choose a vibe and get replies you can actually send. Boplo is there for the nudge, not to turn you into somebody else.</p><ul class="w-checks"><li>Funny, smooth, bold or genuine</li><li>Ask-them-out and follow-up modes</li><li>Profile and opener feedback</li></ul></div><div class="w-card-ui dark w-reveal"><div class="w-ui-bar"><b>REPLY OPTIONS</b><span>YOUR VIBE</span></div><div class="w-message-row"><div class="w-message">That sounds like a strong claim. I might need proof over a drink.</div><div class="w-message">You have convinced me. When are we testing this theory?</div><div class="w-message">Okay, but I’m holding you to that recommendation.</div></div><div class="w-verdict"><small>WHY THIS WORKS</small><b>Light, direct, easy to answer.</b><p>You are moving it forward without forcing a huge moment.</p></div></div></div></div></section>
    <section class="w-cta"><div class="w-wrap w-reveal"><span class="w-eyebrow">YOUR NEXT MOVE STARTS HERE</span><h2>Get the rizz.<br>Keep the credit.</h2><p>Three free chat reads. No card required. Keep what sounds like you.</p><button class="w-button gradient" data-wingman-start>Try Boplo free ↗</button></div></section>
    <footer class="w-footer"><div class="w-wrap"><a class="w-logo" href="#top" aria-label="Boplo home"><i aria-hidden="true"></i><span>boplo</span></a><small>AI rizz that sounds like you. · © ${new Date().getFullYear()} Boplo</small></div></footer>`;
  document.body.prepend(site);
  site.querySelectorAll('[data-wingman-start]').forEach(button => button.addEventListener('click', () => document.querySelector('#modal')?.classList.remove('hidden')));
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('on'); observer.unobserve(entry.target); }
  }), { threshold: .12 });
  site.querySelectorAll('.w-reveal').forEach(item => observer.observe(item));
  const app = document.querySelector('#app');
  if (app) new MutationObserver(() => { if (!app.classList.contains('hidden')) site.classList.add('hidden'); }).observe(app, { attributes: true });
  document.addEventListener('click', event => { if (event.target.closest('[data-exit]')) site.classList.remove('hidden'); });

  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const accountNav = user => `<header class="w-nav w-workspace-nav"><a class="w-logo" href="#top" aria-label="Boplo home"><i aria-hidden="true"></i><span>boplo</span></a><div class="w-account"><span>${escape(user.email)}</span><button class="w-text-button" data-boplo-signout>Sign out</button></div></header>`;
  const bindAccountNav = () => site.querySelector('[data-boplo-signout]')?.addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }); location.hash = '#top'; location.reload(); });
  const chatIntake = user => {
    site.classList.add('w-workspace');
    site.innerHTML = `<div class="w-wrap">${accountNav(user)}<main class="w-workspace-main w-chat-main"><button class="w-back" data-boplo-home>← Workspace</button><div class="w-chat-head"><span class="w-eyebrow">NEW CHAT READ · 01 / 02</span><h1>Show us the chat.</h1><p>Paste the conversation or upload one clear screenshot. You will review everything before Boplo uses it.</p></div><form class="w-chat-form" data-boplo-intake><label class="w-dropzone" for="boplo-chat-image"><input id="boplo-chat-image" type="file" accept="image/png,image/jpeg,image/webp"><b>Upload a chat screenshot</b><span>PNG, JPG or WebP · under 4 MB</span><em>Choose image</em></label><div class="w-chat-or"><span>or paste it in</span></div><label class="w-chat-label" for="boplo-chat-text">Conversation</label><textarea id="boplo-chat-text" maxlength="12000" placeholder="Me: I take food seriously.&#10;Them: That is a bold claim.&#10;Me: ..."></textarea><p class="w-private-note">Your screenshot is only used to extract the chat. It is not saved as a file.</p><button class="w-button gradient" type="submit">Review the chat ↗</button><p class="w-chat-error" aria-live="polite"></p></form></main></div>`;
    bindAccountNav();
    site.querySelector('[data-boplo-home]').addEventListener('click', () => workspace(user));
    let selectedImage = null;
    const fileInput = site.querySelector('#boplo-chat-image'), dropzone = site.querySelector('.w-dropzone');
    fileInput.addEventListener('change', () => { selectedImage = fileInput.files?.[0] || null; dropzone.classList.toggle('selected', Boolean(selectedImage)); dropzone.querySelector('b').textContent = selectedImage ? selectedImage.name : 'Upload a chat screenshot'; dropzone.querySelector('span').textContent = selectedImage ? `${Math.ceil(selectedImage.size / 1024)} KB · ready to read` : 'PNG, JPG or WebP · under 4 MB'; });
    site.querySelector('[data-boplo-intake]').addEventListener('submit', async event => {
      event.preventDefault();
      const error = site.querySelector('.w-chat-error'), button = event.currentTarget.querySelector('button[type="submit"]'), pasted = site.querySelector('#boplo-chat-text').value.trim();
      error.textContent = '';
      if (!selectedImage && !pasted) { error.textContent = 'Add a screenshot or paste the chat first.'; return; }
      button.disabled = true; button.textContent = selectedImage ? 'Reading screenshot…' : 'Preparing chat…';
      try {
        let transcript = pasted, source = 'Pasted chat';
        if (selectedImage) {
          if (selectedImage.size > 4 * 1024 * 1024) throw new Error('Keep screenshots under 4 MB.');
          const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('We could not read that file.')); reader.readAsDataURL(selectedImage); });
          const response = await fetch('/auth/chat/extract', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error || 'We could not read that screenshot.');
          transcript = data.transcript; source = 'Screenshot extraction';
        }
        sessionStorage.setItem('boplo-chat-draft', transcript);
        chatReview(user, transcript, source);
      } catch (reason) { error.textContent = reason.message || 'Something went wrong. Please try again.'; button.disabled = false; button.textContent = 'Review the chat ↗'; }
    });
  };
  const chatReview = (user, transcript, source) => {
    site.classList.add('w-workspace');
    site.innerHTML = `<div class="w-wrap">${accountNav(user)}<main class="w-workspace-main w-chat-main"><button class="w-back" data-boplo-edit>← Edit input</button><div class="w-chat-head"><span class="w-eyebrow">NEW CHAT READ · 02 / 02</span><h1>Check the context.</h1><p>We extracted this from your ${escape(source).toLowerCase()}. Correct anything before continuing.</p></div><form class="w-chat-form w-review-form" data-boplo-review><label class="w-chat-label" for="boplo-review-text">What Boplo will read</label><textarea id="boplo-review-text" maxlength="12000"></textarea><p class="w-private-note">Only the confirmed chat will be used for your reply suggestions. You control what gets saved later.</p><button class="w-button gradient" type="submit">Chat confirmed ↗</button><p class="w-chat-success" aria-live="polite"></p></form></main></div>`;
    site.querySelector('#boplo-review-text').value = transcript;
    bindAccountNav(); site.querySelector('[data-boplo-edit]').addEventListener('click', () => chatIntake(user));
    site.querySelector('[data-boplo-review]').addEventListener('submit', event => { event.preventDefault(); const finalText = site.querySelector('#boplo-review-text').value.trim(); const notice = site.querySelector('.w-chat-success'); if (!finalText) { notice.textContent = 'Keep at least one message in the chat.'; return; } sessionStorage.setItem('boplo-chat-draft', finalText); notice.textContent = 'Chat confirmed. Next, Boplo will create your read and reply options.'; event.currentTarget.querySelector('button').textContent = 'Ready for reply options ✓'; });
  };
  const workspace = user => {
    const firstName = String(user.display_name || user.email || 'there').trim().split(/\s|@/)[0];
    site.classList.add('w-workspace');
    site.innerHTML = `<div class="w-wrap"><header class="w-nav w-workspace-nav"><a class="w-logo" href="#top" aria-label="Boplo home"><i aria-hidden="true"></i><span>boplo</span></a><div class="w-account"><span>${escape(user.email)}</span><button class="w-text-button" data-boplo-signout>Sign out</button></div></header><main class="w-workspace-main"><div class="w-workspace-top"><div><span class="w-eyebrow">YOUR BOPLO SPACE</span><h1>Hey, ${escape(firstName)}.</h1><p>You are in. Your chat reads and saved replies will live here.</p></div><span class="w-credit"><b>3</b> free reads left</span></div><section class="w-new-read"><div><span class="w-eyebrow">NEW CHAT READ</span><h2>What are we replying to?</h2><p>Upload a screenshot or paste the conversation when the reply tool opens.</p></div><button class="w-button gradient" data-boplo-coming>Start a chat read ↗</button></section><section class="w-workspace-grid"><article class="w-workspace-card"><span class="w-eyebrow">YOUR ACCOUNT</span><h3>Make it yours.</h3><form data-boplo-profile><label for="boplo-name">Display name</label><div><input id="boplo-name" name="displayName" value="${escape(user.display_name || '')}" maxlength="60" placeholder="Your name"><button class="w-button" type="submit">Save</button></div><small>Your name is only used in your Boplo workspace.</small></form></article><article class="w-workspace-card dark"><span class="w-eyebrow">COMING NEXT</span><h3>Your first good reply.</h3><p>The reply engine is next: context, vibe, three options, then copy and send.</p><div class="w-mini-steps"><b>01</b><b>02</b><b>03</b></div></article><article class="w-workspace-card"><span class="w-eyebrow">PRIVATE BY DEFAULT</span><h3>Your chats stay yours.</h3><p>We will only keep the reads you choose to save. Delete controls will be built into the chat history from day one.</p></article></section></main></div>`;
    bindAccountNav();
    site.querySelector('[data-boplo-coming]').addEventListener('click', () => chatIntake(user));
    site.querySelector('[data-boplo-profile]').addEventListener('submit', async event => { event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.textContent = 'Saving…'; const response = await fetch('/auth/profile', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: new FormData(event.currentTarget).get('displayName') }) }); if (!response.ok) { button.textContent = 'Try again'; return; } button.textContent = 'Saved ✓'; setTimeout(() => { button.textContent = 'Save'; }, 1500); });
  };
  let workspaceRequest = false;
  const renderWorkspace = () => {
    if (location.hash !== '#workspace' || workspaceRequest) return;
    workspaceRequest = true;
    fetch('/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (data?.user) workspace(data.user);
        else {
          location.hash = '#top';
          document.querySelector('#modal')?.classList.remove('hidden');
        }
      })
      .catch(() => {
        location.hash = '#top';
        document.querySelector('#modal')?.classList.remove('hidden');
      })
      .finally(() => { workspaceRequest = false; });
  };
  window.addEventListener('hashchange', renderWorkspace);
  renderWorkspace();
})();
