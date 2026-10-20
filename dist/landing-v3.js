(() => {
  const site = document.querySelector('#wingman-site');
  if (!site) return;

  const money = (amount, currency = 'GBP') => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount || 0);
  const safeJson = async response => { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.'); return data; };
  const renderMoveApp = async () => {
    site.innerHTML = `<main class="bm-app"><header class="bm-nav"><a class="bv-logo" href="#top" aria-label="Boplo home"><img src="/assets/boplo-wordmark-blue.png" alt="Boplo"></a><div><span id="bm-user">Loading your move…</span><button type="button" data-bm-logout>Sign out</button></div></header><section class="bm-shell"><div class="bm-intro"><p>Your move</p><h1>Make the next city<br><em>make sense.</em></h1><span>Start with the details that change everything. Your profile is free; the complete Move Plan unlocks the calculator and local help.</span></div><div class="bm-grid"><section class="bm-panel bm-profile"><header><p>01 / Your move</p><h2>Start with your reality.</h2></header><form id="bm-profile-form"><label>Where are you moving?<input name="destination" required maxlength="100" placeholder="e.g. Melbourne, Australia"></label><div class="bm-two"><label>When?<input name="moveDate" type="month"></label><label>Currency<input name="currency" maxlength="3" value="GBP" aria-label="Currency code"></label></div><label>Why are you moving?<select name="moveReason"><option value="">Choose one</option><option>Work</option><option>Study</option><option>A fresh start</option><option>Family</option><option>Other</option></select></label><label>What matters most?<input name="priorities" maxlength="160" placeholder="Budget, walkability, a short commute"></label><button class="bm-primary" type="submit">Save my move</button><output aria-live="polite"></output></form></section><section class="bm-panel bm-access"><p>Move Plan</p><h2 id="bm-access-title">Checking access…</h2><span id="bm-access-copy">Your personalised calculator, saved decisions and local-help requests live here.</span><button class="bm-primary" id="bm-unlock" type="button">Unlock Move Plan · £8.99</button><small>One payment · 90 days of plan access</small></section></div><section class="bm-panel bm-calculator hidden" id="bm-calculator"><header><p>Move Calculator</p><h2>Know the number before the move.</h2><span>Every total comes directly from your own assumptions — no generic city average dressed up as certainty.</span></header><form id="bm-calculator-form"><div class="bm-calculator-grid"><label>Monthly rent<input name="monthlyRent" type="number" min="0" inputmode="decimal" required value="1000"></label><label>Deposit (months)<input name="depositMonths" type="number" min="0" max="12" step="0.5" inputmode="decimal" required value="1"></label><label>Monthly living costs<input name="monthlyLiving" type="number" min="0" inputmode="decimal" required value="550"></label><label>Travel + setup<input name="travelAndSetup" type="number" min="0" inputmode="decimal" required value="400"></label><label>Emergency buffer<input name="emergencyBuffer" type="number" min="0" inputmode="decimal" required value="500"></label><label>Current savings<input name="savings" type="number" min="0" inputmode="decimal" required value="3500"></label></div><button class="bm-primary" type="submit">Save calculation</button><output aria-live="polite"></output></form><div class="bm-results hidden" id="bm-results" aria-live="polite"></div></section><section class="bm-panel bm-local"><header><p>Ask a local</p><h2>Answers data cannot give you.</h2><span>When approved Boplo locals are available for your destination, you can ask a written question or request a short call inside your plan.</span></header><div id="bm-advisors" class="bm-advisors">Save a destination to see local availability.</div></section></section></main>`;
    const userLabel = site.querySelector('#bm-user'), accessTitle = site.querySelector('#bm-access-title'), accessCopy = site.querySelector('#bm-access-copy'), unlock = site.querySelector('#bm-unlock'), profileForm = site.querySelector('#bm-profile-form'), calculator = site.querySelector('#bm-calculator'), calculatorForm = site.querySelector('#bm-calculator-form'), calculatorOutput = calculatorForm.querySelector('output'), profileOutput = profileForm.querySelector('output'), adviserArea = site.querySelector('#bm-advisors');
    let access;
    try {
      const status = await safeJson(await fetch('/move/status'));
      access = status.entitlement;
      userLabel.textContent = status.user.displayName || status.user.email;
      if (access.plan === 'move_plan') { accessTitle.textContent = 'Your Move Plan is active.'; accessCopy.textContent = `Calculator, saved numbers and local-help requests are unlocked until ${new Date(access.activeUntil).toLocaleDateString()}.`; unlock.remove(); calculator.classList.remove('hidden'); }
      else { accessTitle.textContent = 'Unlock the full move plan.'; accessCopy.textContent = 'Use the paid Move Calculator, save your first-month numbers, and request help from approved locals.'; }
      const profileData = await safeJson(await fetch('/move/profile'));
      const profile = profileData.profile || {}, queuedDestination = localStorage.getItem('boplo-move-destination') || '';
      profileForm.elements.destination.value = profile.destination || queuedDestination;
      profileForm.elements.moveDate.value = profile.move_date || '';
      profileForm.elements.moveReason.value = profile.move_reason || '';
      profileForm.elements.currency.value = profile.currency || 'GBP';
      profileForm.elements.priorities.value = Array.isArray(profile.priorities) ? profile.priorities.join(', ') : '';
      if (profile.destination) loadAdvisers(profile.destination);
    } catch (error) { window.location.hash = '#top'; window.location.reload(); return; }
    site.querySelector('[data-bm-logout]').addEventListener('click', async () => { await fetch('/auth/logout', { method: 'POST' }); window.location.hash = '#top'; window.location.reload(); });
    profileForm.addEventListener('submit', async event => { event.preventDefault(); const button = profileForm.querySelector('button'); button.disabled = true; profileOutput.textContent = 'Saving…'; try { const payload = { destination: profileForm.elements.destination.value, moveDate: profileForm.elements.moveDate.value, moveReason: profileForm.elements.moveReason.value, currency: profileForm.elements.currency.value, priorities: profileForm.elements.priorities.value.split(',').map(value => value.trim()).filter(Boolean) }; const data = await safeJson(await fetch('/move/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })); localStorage.removeItem('boplo-move-destination'); profileOutput.textContent = 'Your move is saved.'; loadAdvisers(data.profile.destination); } catch (error) { profileOutput.textContent = error.message; } finally { button.disabled = false; } });
    async function loadAdvisers(destination) { if (!destination) return; adviserArea.textContent = 'Checking local availability…'; try { const data = await safeJson(await fetch(`/move/advisors?city=${encodeURIComponent(destination.split(',')[0])}`)); adviserArea.innerHTML = data.advisors.length ? data.advisors.map(adviser => `<article><b>${adviser.display_name}</b><span>${adviser.city}${adviser.country ? ` · ${adviser.country}` : ''}</span><p>${adviser.bio}</p><small>${adviser.completed_sessions} completed sessions · ${adviser.rating.toFixed(1)} rating</small></article>`).join('') : 'No approved local advisers are available here yet. Your saved plan will be ready when coverage reaches this city.'; } catch { adviserArea.textContent = 'Local availability will appear here once your destination is saved.'; } }
    if (unlock) unlock.addEventListener('click', async () => { unlock.disabled = true; unlock.textContent = 'Opening secure checkout…'; try { const data = await safeJson(await fetch('/move/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); if (data.url) window.location.assign(data.url); } catch (error) { unlock.disabled = false; unlock.textContent = error.message.includes('not connected') ? 'Checkout is not connected yet' : 'Unlock Move Plan · £8.99'; accessCopy.textContent = error.message; } });
    if (calculatorForm) calculatorForm.addEventListener('submit', async event => { event.preventDefault(); const button = calculatorForm.querySelector('button'); button.disabled = true; calculatorOutput.textContent = 'Calculating…'; try { const input = Object.fromEntries(new FormData(calculatorForm)); input.destination = profileForm.elements.destination.value; input.currency = profileForm.elements.currency.value; const data = await safeJson(await fetch('/move/calculator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })); const calc = data.calculation, results = site.querySelector('#bm-results'); results.classList.remove('hidden'); results.innerHTML = `<div><span>FIRST MONTH</span><b>${money(calc.firstMonthTotal, calc.currency)}</b></div><div><span>THREE MONTHS</span><b>${money(calc.threeMonthTotal, calc.currency)}</b></div><div><span>${calc.gapToFirstMonth ? 'SHORTFALL' : 'LEFT AFTER MONTH ONE'}</span><b>${money(calc.gapToFirstMonth || calc.remainingAfterFirstMonth, calc.currency)}</b></div>`; calculatorOutput.textContent = 'Saved to your Move Plan.'; } catch (error) { calculatorOutput.textContent = error.message; } finally { button.disabled = false; } });
  };
  if (window.location.hash.startsWith('#move')) { renderMoveApp(); return; }

  site.innerHTML = `
    <main class="boplo-v3" id="top">
      <header class="bv-nav-wrap"><nav class="bv-nav" aria-label="Primary navigation">
        <a class="bv-logo" href="#top" aria-label="Boplo home"><img src="/assets/boplo-wordmark-blue.png" alt="Boplo"></a>
        <div class="bv-nav-links"><a href="#how">How it works</a><a href="#cities">Cities</a><a href="#faq">FAQ</a></div>
        <button type="button" class="bv-nav-button" data-bv-open>Start planning</button>
      </nav></header>

      <section class="bv-hero" aria-labelledby="bv-hero-title">
        <div class="bv-orb bv-orb-one"></div><div class="bv-orb bv-orb-two"></div>
        <div class="bv-container bv-hero-inner">
          <div class="bv-switch" role="group" aria-label="Boplo experience"><button type="button" class="active" data-bv-mode="plan">I’m planning a move</button><button type="button" data-bv-mode="settle">I’ve just arrived</button></div>
          <h1 id="bv-hero-title"><span data-bv-title-line-one>A clear plan for</span><em data-bv-title-line-two>your next city.</em></h1>
          <p data-bv-description>Make the money, neighbourhood and first-month decisions before they become stressful.</p>
          <div class="bv-actions"><button type="button" class="bv-main-button" data-bv-open>Build my move plan</button><a href="#how">See how it works</a></div>
          <div class="bv-hero-stats"><span><b>3 min</b> to start your plan</span><span><b>Any city</b> starts with your reality</span><span><b>£8.99</b> one clear plan</span></div>
        </div>
      </section>

      <section class="bv-how" id="how">
        <div class="bv-container">
          <header class="bv-section-head"><h2>What your move<br><em>looks like with Boplo.</em></h2><p>Not a generic relocation guide. A living view of the decisions in front of you, arranged around what you actually need.</p></header>
          <div class="bv-product-stage" data-bv-reveal>
            <article class="bv-phone" aria-label="Interactive Boplo mobile move plan preview">
              <div class="bv-phone-top"><span>9:41</span><i aria-hidden="true"></i><span>5G</span></div>
              <div class="bv-phone-brand"><span>boplo</span><small id="bv-phone-state">your move</small></div>
              <section class="bv-phone-screen" id="bv-phone-screen" aria-live="polite"></section>
              <nav aria-label="Mobile app navigation" role="tablist">
                <button type="button" class="active" role="tab" aria-selected="true" data-bv-screen="plan">Plan</button>
                <button type="button" role="tab" aria-selected="false" data-bv-screen="money">Money</button>
                <button type="button" role="tab" aria-selected="false" data-bv-screen="areas">Areas</button>
              </nav>
            </article>
            <ol class="bv-step-list">
              <li class="active"><button type="button" class="bv-step-control" aria-pressed="true" data-bv-screen="plan"><span>01</span><span><b>Start with your real life.</b><small>Tell Boplo when you’re moving, what you have saved, and what a good day in your new city looks like.</small></span></button></li>
              <li><button type="button" class="bv-step-control" aria-pressed="false" data-bv-screen="money"><span>02</span><span><b>See the move in one view.</b><small>See the rent, deposit and first-week costs together before you have ten tabs and a blank notes app.</small></span></button></li>
              <li><button type="button" class="bv-step-control" aria-pressed="false" data-bv-screen="areas"><span>03</span><span><b>Keep moving with clarity.</b><small>Compare neighbourhoods around your budget and routine, then keep the right next step close.</small></span></button></li>
            </ol>
          </div>
        </div>
      </section>

      <section class="bv-city-section" id="cities"><div class="bv-container">
        <div class="bv-city-copy" data-bv-reveal><p>Made for the big decisions</p><h2>Your plan should know more than your destination.</h2><span>Work, study, a fresh start — every move has a different shape. Boplo plans around yours.</span></div>
        <div class="bv-desktop-product" data-bv-reveal aria-label="Boplo city decision dashboard preview">
          <header><b>boplo</b><span>Barcelona move plan</span><small>September 2026</small></header>
          <aside><span class="active">Overview</span><span>Budget</span><span>Areas</span><span>Timeline</span></aside>
          <main><p>YOUR MOVE AT A GLANCE</p><h3>Ready for the<br>right reasons.</h3><div class="bv-glance"><section><span>YOUR TARGET</span><strong>£3,150</strong><small>First month, fully accounted for</small></section><section><span>START HERE</span><b>Check your tenancy documents</b><small>Week 1 · housing</small></section></div></main>
        </div>
      </div></section>

      <section class="bv-principle"><div class="bv-container" data-bv-reveal><p>Built around the human part of moving.</p><h2>Less <em>“where do I even start?”</em><br>More <em>“I’ve got this.”</em></h2></div></section>

      <section class="bv-faq" id="faq"><div class="bv-container"><header><h2>Questions,<br><em>answered simply.</em></h2></header><div class="bv-faq-list">
        <details><summary>What do I get in a Boplo plan?</summary><p>A personalised first-month budget, neighbourhood direction and a practical sequence for getting set up in your new city.</p></details>
        <details><summary>Which cities are available?</summary><p>Boplo is built for moves anywhere. Your plan starts with your own numbers and priorities; depth of local adviser coverage grows city by city.</p></details>
        <details><summary>Is this a subscription?</summary><p>Launch plans are designed as a one-off £8.99 purchase. Future local insight features will be introduced separately.</p></details>
      </div></div></section>

      <section class="bv-final"><div class="bv-container" data-bv-reveal><p>Your next city is waiting.</p><h2>Start making<br><em>it make sense.</em></h2><button type="button" class="bv-main-button" data-bv-open>Build my move plan</button></div></section>
      <footer class="bv-footer"><div class="bv-container"><a class="bv-logo" href="#top" aria-label="Boplo home"><img src="/assets/boplo-wordmark-blue.png" alt="Boplo"></a><span>Personal move plans for your next city.</span><small>© 2026 Boplo</small></div></footer>
    </main>
    <dialog class="bv-dialog" aria-labelledby="bv-dialog-title"><form id="bv-signup-form"><button class="bv-close" type="button" value="cancel" aria-label="Close">Close</button><p>Start your move</p><h2 id="bv-dialog-title">Your next city<br>starts here.</h2><button class="bv-google-button" type="button" data-bv-google><span aria-hidden="true">G</span>Continue with Google</button><span class="bv-auth-divider">or use email</span><label>Email address<input required type="email" name="email" autocomplete="email" placeholder="you@example.com"></label><label>Where are you moving?<input name="destination" autocomplete="address-level2" placeholder="Any city, anywhere"></label><button class="bv-main-button" type="submit">Send my sign-in link</button><output aria-live="polite"></output></form></dialog>
  `;

  const dialog = site.querySelector('.bv-dialog');
  site.querySelectorAll('[data-bv-open]').forEach((button) => button.addEventListener('click', () => dialog.showModal()));
  dialog.querySelector('.bv-close').addEventListener('click', () => dialog.close());
  site.querySelector('[data-bv-google]').addEventListener('click', () => { window.location.assign('/auth/google'); });
  dialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const output = form.querySelector('output'), submit = form.querySelector('[type="submit"]');
    submit.disabled = true; output.textContent = 'Sending your secure sign-in link…';
    try {
      const response = await fetch('/auth/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.elements.email.value }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'We could not send that link.');
      localStorage.setItem('boplo-move-destination', form.elements.destination.value.trim());
      output.textContent = 'Check your email — your secure sign-in link is on its way.';
    } catch (error) { output.textContent = error.message || 'We could not send that link.'; }
    finally { submit.disabled = false; }
  });
  const modes = { plan: { title: ['A clear plan for', 'your next city.'], description: 'Make the money, neighbourhood and first-month decisions before they become stressful.' }, settle: { title: ['A steadier start in', 'your new city.'], description: 'Keep the details that matter in one place while you learn your new routine.' } };
  site.querySelectorAll('[data-bv-mode]').forEach((button) => button.addEventListener('click', () => {
    site.querySelectorAll('[data-bv-mode]').forEach((item) => item.classList.toggle('active', item === button));
    const mode = modes[button.dataset.bvMode];
    site.querySelector('[data-bv-title-line-one]').textContent = mode.title[0];
    site.querySelector('[data-bv-title-line-two]').textContent = mode.title[1];
    site.querySelector('[data-bv-description]').textContent = mode.description;
  }));
  const phoneScreen = site.querySelector('#bv-phone-screen');
  const phoneState = site.querySelector('#bv-phone-state');
  const phoneScreens = {
    plan: {
      label: 'move overview',
      content: `<div class="bv-phone-location"><p>EXAMPLE MOVE</p><h3>Barcelona</h3><span>September 2026</span></div><section class="bv-phone-progress"><div><span>YOUR MOVE</span><b>2 of 5 decisions clear</b></div><i><em></em></i></section><section class="bv-phone-next"><p>UP NEXT</p><h4>Find your area</h4><span>Three neighbourhoods that work around your pace and budget.</span><button type="button" data-bv-screen="areas">Open shortlist</button></section>`
    },
    money: {
      label: 'first month',
      content: `<section class="bv-phone-title"><p>FIRST MONTH</p><h3>Make the numbers<br>feel doable.</h3><span>Example plan · Barcelona</span></section><section class="bv-phone-money"><div><span>Rent</span><b>£1,250</b></div><div><span>Deposit</span><b>£1,250</b></div><div><span>Set-up week</span><b>£650</b></div><footer><span>PLANNED TOTAL</span><b>£3,150</b></footer></section><section class="bv-phone-tip"><p>GOOD TO KNOW</p><span>Keep one month of rent outside your move-in budget.</span></section>`
    },
    areas: {
      label: 'area shortlist',
      content: `<section class="bv-phone-title"><p>YOUR SHORTLIST</p><h3>Pick a place<br>that fits.</h3><span>Matched to your example plan</span></section><section class="bv-area-list"><button type="button"><span><b>Gràcia</b><small>Creative · local · 28 min to centre</small></span><em>1</em></button><button type="button"><span><b>Sant Antoni</b><small>Central · social · 19 min to centre</small></span><em>2</em></button><button type="button"><span><b>Poblenou</b><small>Coastal · calm · 31 min to centre</small></span><em>3</em></button></section><section class="bv-phone-tip"><p>YOUR PRIORITY</p><span>Walkability, a calm weekday, and an easy commute.</span></section>`
    }
  };
  const setPhoneScreen = (name) => {
    const screen = phoneScreens[name] || phoneScreens.plan;
    phoneState.textContent = screen.label;
    phoneScreen.classList.remove('is-changing');
    phoneScreen.innerHTML = screen.content;
    void phoneScreen.offsetWidth;
    phoneScreen.classList.add('is-changing');
    site.querySelectorAll('[data-bv-screen]').forEach((control) => {
      const active = control.dataset.bvScreen === name;
      control.classList.toggle('active', active);
      if (control.matches('[role="tab"]')) control.setAttribute('aria-selected', String(active));
      if (control.matches('.bv-step-control')) control.setAttribute('aria-pressed', String(active));
      if (control.closest('li')) control.closest('li').classList.toggle('active', active);
    });
  };
  site.addEventListener('click', (event) => {
    const control = event.target.closest('[data-bv-screen]');
    if (control) setPhoneScreen(control.dataset.bvScreen);
  });
  setPhoneScreen('plan');
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add('visible'); }), { threshold: 0.14 });
  site.querySelectorAll('[data-bv-reveal]').forEach((element) => observer.observe(element));
})();
