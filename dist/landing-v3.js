(() => {
  const site = document.querySelector('#wingman-site');
  if (!site) return;

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
          <div class="bv-hero-stats"><span><b>3 min</b> to start your plan</span><span><b>3 cities</b> at launch</span><span><b>£8.99</b> one clear plan</span></div>
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
        <details><summary>Which cities are available?</summary><p>London, Barcelona and Amsterdam are the first launch cities. We will add more once each plan is genuinely useful, not just present.</p></details>
        <details><summary>Is this a subscription?</summary><p>Launch plans are designed as a one-off £8.99 purchase. Future local insight features will be introduced separately.</p></details>
      </div></div></section>

      <section class="bv-final"><div class="bv-container" data-bv-reveal><p>Your next city is waiting.</p><h2>Start making<br><em>it make sense.</em></h2><button type="button" class="bv-main-button" data-bv-open>Build my move plan</button></div></section>
      <footer class="bv-footer"><div class="bv-container"><a class="bv-logo" href="#top" aria-label="Boplo home"><img src="/assets/boplo-wordmark-blue.png" alt="Boplo"></a><span>Personal move plans for your next city.</span><small>© 2026 Boplo</small></div></footer>
    </main>
    <dialog class="bv-dialog" aria-labelledby="bv-dialog-title"><form method="dialog"><button class="bv-close" value="cancel" aria-label="Close">Close</button><p>Early access</p><h2 id="bv-dialog-title">Your next city<br>starts here.</h2><label>Email address<input required type="email" name="email" autocomplete="email" placeholder="you@example.com"></label><label>First city<select required name="city"><option value="">Choose a city</option><option>London</option><option>Barcelona</option><option>Amsterdam</option></select></label><button class="bv-main-button" type="submit">Join early access</button><output aria-live="polite"></output></form></dialog>
  `;

  const dialog = site.querySelector('.bv-dialog');
  site.querySelectorAll('[data-bv-open]').forEach((button) => button.addEventListener('click', () => dialog.showModal()));
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const city = form.elements.city.value;
    localStorage.setItem('boplo-early-access-preview', JSON.stringify({ city, email: form.elements.email.value, savedAt: Date.now() }));
    form.querySelector('output').textContent = `You’re on the preview list for ${city}.`;
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
