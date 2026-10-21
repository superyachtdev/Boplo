(() => {
  const site = document.querySelector('#wingman-site');
  if (!site) return;

  site.innerHTML = `
    <main class="boplo-landing" id="top">
      <header class="bl-nav-wrap">
        <nav class="bl-nav" aria-label="Primary navigation">
          <a class="bl-brand" href="#top" aria-label="Boplo home"><img src="/assets/boplo-wordmark-blue.png" alt="Boplo"></a>
          <div class="bl-nav-links">
            <a href="#how">How it works</a>
            <a href="#cities">Cities</a>
            <a href="#insight">Local insight</a>
          </div>
          <button class="bl-nav-cta" type="button" data-landing-open>Start a plan</button>
        </nav>
      </header>

      <section class="bl-hero" aria-labelledby="hero-title">
        <img class="bl-hero-image" src="/assets/landing/blue-hour-arrival.png" alt="A traveller arriving in a city at blue hour with a suitcase">
        <div class="bl-hero-shade"></div>
        <div class="bl-container bl-hero-content">
          <p class="bl-hero-note">A clearer way to move abroad</p>
          <h1 id="hero-title">Make your next city<br><em>make sense.</em></h1>
          <p class="bl-hero-copy">Move with a plan for the money, neighbourhoods, and first days that actually fit your life.</p>
          <button class="bl-primary" type="button" data-landing-open>Build my move plan</button>
        </div>
        <p class="bl-hero-caption">Your move, made personal.</p>
      </section>

      <section class="bl-thesis bl-container" data-bl-reveal>
        <p>Moving abroad should feel exciting. It rarely feels simple.</p>
        <h2>Boplo turns the unknowns into <em>a plan you can act on.</em></h2>
      </section>

      <section class="bl-plan-section" id="how">
        <div class="bl-container bl-plan-intro" data-bl-reveal>
          <h2>Everything you need.<br><em>Nothing you don’t.</em></h2>
          <p>Tell Boplo where you’re heading and what matters. We turn your real budget, timeline, and priorities into one focused move plan.</p>
        </div>
        <div class="bl-container" data-bl-reveal>
          <article class="bl-plan-window" aria-label="Example Boplo move plan">
            <header>
              <span class="bl-window-dot"></span><span class="bl-window-dot"></span><span class="bl-window-dot"></span>
              <strong>Example Boplo plan</strong>
              <span class="bl-window-status">Personalised</span>
            </header>
            <div class="bl-plan-body">
              <aside>
                <span class="bl-mark">b</span>
                <a class="active" href="#plan">Overview</a>
                <a href="#plan">Money</a>
                <a href="#plan">Neighbourhoods</a>
                <a href="#plan">First month</a>
              </aside>
              <div class="bl-plan-main" id="plan">
                <p class="bl-plan-city">Barcelona · September</p>
                <h3>Move with a clear<br>first month.</h3>
                <div class="bl-plan-columns">
                  <div class="bl-plan-target">
                    <span>Example first-month target</span>
                    <strong>£3,150</strong>
                    <small>Housing, deposit and first-week essentials</small>
                    <div class="bl-plan-progress"><i></i></div>
                    <b>87% prepared</b>
                  </div>
                  <div class="bl-plan-next">
                    <span>Next up</span>
                    <h4>Choose your<br>neighbourhood.</h4>
                    <p>Three areas matched to your budget, commute and the kind of life you want to build.</p>
                    <button type="button" data-landing-open>See the match</button>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section class="bl-flow bl-container" data-bl-reveal>
        <div class="bl-flow-intro"><h2>One move.<br><em>One clear path.</em></h2><p>Built for the decisions that make a new city feel like home sooner.</p></div>
        <ol>
          <li><span>01</span><div><h3>Tell us what’s real.</h3><p>Where you’re moving from, when you’re going, what you can spend and what matters most.</p></div></li>
          <li><span>02</span><div><h3>See the whole move.</h3><p>Your first-month budget, neighbourhood shortlist and a practical timeline in one place.</p></div></li>
          <li><span>03</span><div><h3>Arrive prepared.</h3><p>Know what to do before you go, in your first week, and when local questions come up.</p></div></li>
        </ol>
      </section>

      <section class="bl-cities" id="cities">
        <div class="bl-container bl-cities-grid">
          <figure data-bl-reveal><img src="/assets/landing/apartment-viewing.png" alt="A city apartment viewing at blue hour"><figcaption>Plan the life around the move.</figcaption></figure>
          <div class="bl-cities-copy" data-bl-reveal>
            <h2>Not just a city.<br><em>Your version of it.</em></h2>
            <p>Rent isn’t the only thing that changes when you move. Boplo makes space for the details that usually get buried in twenty open tabs.</p>
            <ul>
              <li>Realistic first-month spending</li>
              <li>Areas that fit your day-to-day</li>
              <li>A timeline for the things that matter</li>
            </ul>
            <button class="bl-text-link" type="button" data-landing-open>Explore launch cities</button>
          </div>
        </div>
      </section>

      <section class="bl-insight" id="insight">
        <div class="bl-container bl-insight-grid">
          <div class="bl-insight-copy" data-bl-reveal>
            <h2>Built to get you there.<br><em>Not just get you started.</em></h2>
            <p>Start with a move plan. Soon, you’ll be able to add practical local insight from people who’ve made the same move before you.</p>
            <p class="bl-future-note">Coming after launch: trusted city voices, honest answers and guidance when a generic checklist isn’t enough.</p>
          </div>
          <figure data-bl-reveal><img src="/assets/landing/city-morning.png" alt="A quiet city street seen from a café on a rainy morning"><figcaption>The parts no city guide knows.</figcaption></figure>
        </div>
      </section>

      <section class="bl-final" data-bl-reveal>
        <div class="bl-container">
          <p>Moving to London, Barcelona or Amsterdam?</p>
          <h2>Start making it<br><em>feel possible.</em></h2>
          <button class="bl-primary bl-primary-light" type="button" data-landing-open>Build my move plan</button>
        </div>
      </section>

      <footer class="bl-footer"><div class="bl-container"><a class="bl-brand" href="#top" aria-label="Boplo home"><img src="/assets/boplo-wordmark-blue.png" alt="Boplo"></a><p>Personal move plans for your next city.</p><small>© 2026 Boplo</small></div></footer>
    </main>

    <dialog class="bl-dialog" aria-labelledby="bl-dialog-title">
      <form method="dialog" class="bl-dialog-card">
        <button class="bl-dialog-close" value="cancel" aria-label="Close">Close</button>
        <p>Early access</p>
        <h2 id="bl-dialog-title">Your next city<br>starts here.</h2>
        <label>Email address<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
        <label>First city<select name="city" required><option value="">Choose a city</option><option>London</option><option>Barcelona</option><option>Amsterdam</option></select></label>
        <button class="bl-primary" value="default" type="submit">Get early access</button>
        <output class="bl-dialog-output" aria-live="polite"></output>
      </form>
    </dialog>
  `;

  const dialog = site.querySelector('.bl-dialog');
  site.querySelectorAll('[data-landing-open]').forEach((button) => button.addEventListener('click', () => dialog.showModal()));
  const form = dialog.querySelector('form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const saved = { email: form.elements.email.value, city: form.elements.city.value, savedAt: Date.now() };
    localStorage.setItem('boplo-early-access-preview', JSON.stringify(saved));
    form.querySelector('output').textContent = `You’re on the preview list for ${saved.city}.`;
  });

  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add('bl-visible');
  }), { threshold: 0.13 });
  site.querySelectorAll('[data-bl-reveal]').forEach((element) => observer.observe(element));
})();
