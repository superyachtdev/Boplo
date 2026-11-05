import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { webkit, devices } from 'playwright';

const root = path.join(import.meta.dirname, '..', 'dist');
const workspace = {
  user: { id: 'u1', email: 'pilot@example.com', display_name: 'Alex' },
  profile: { name: 'Alex Morgan', country: 'United Kingdom', countryCode: 'GB', regime: 'uk', authority: 'UK CAA', licence: 'PPL(A)', complete: true, step: 4, openingMinutes: 0, goalHours: 45 },
  flights: [],
  billing: { plan: 'free', status: 'none', enforced: true, ready: true, prices: { monthly: { amount: 1299, currency: 'usd' }, yearly: { amount: 9999, currency: 'usd' } }, limits: { flights: 15, navPlans: 1 }, trialAvailable: false, trialDays: 0 },
  school: null
};

function serve() {
  let signedIn = false;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/flight/workspace') {
      res.setHeader('content-type', 'application/json');
      if (!signedIn) { res.writeHead(401); res.end('{"error":"Sign in required"}'); return; }
      res.end(JSON.stringify(workspace));
      return;
    }
    if (u.pathname.startsWith('/flight/') || u.pathname.startsWith('/auth/')) {
      res.setHeader('content-type', 'application/json');
      res.end('{}');
      return;
    }
    let file = path.join(root, decodeURIComponent(u.pathname === '/' ? '/flight-app.html' : u.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return { server, signIn() { signedIn = true; } };
}

const nativeStub = () => {
  const boom = (name) => () => { throw new Error(name + ' native failed'); };
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    Plugins: {
      SplashScreen: { hide: boom('splash') },
      StatusBar: { setStyle: boom('statusbar'), setBackgroundColor: boom('statusbar') },
      App: { addListener: boom('app') },
      Boplo: {
        unlockInteraction: boom('unlock'),
        signInWithApple: () => Promise.reject(new Error("The operation couldn't be completed. (com.apple.AuthenticationServices.AuthorizationError error 1000.)")),
        registerPush: boom('push'),
        getPushToken: boom('push'),
        startRecording: boom('gps'),
        purchase: boom('store'),
        restore: boom('store')
      }
    }
  };
};

test('iOS sign-in is minimal and the flight desk still receives taps when native calls throw', async () => {
  const { server, signIn } = serve();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await webkit.launch();
  const pageErrors = [];
  try {
    const context = await browser.newContext({ ...devices['iPhone 14 Pro'] });
    await context.addInitScript(nativeStub);
    const page = await context.newPage();
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/flight-app.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ios-auth .tagline');

    const signin = await page.evaluate(() => {
      const tag = document.querySelector('.ios-auth .tagline').textContent.trim();
      const text = document.querySelector('.ios-auth').innerText;
      return {
        tag,
        words: tag.split(/\s+/).filter(Boolean).length,
        apple: document.querySelector('[data-apple]')?.textContent.trim(),
        google: document.querySelector('a[href="/auth/auth/google"]')?.textContent.trim(),
        email: document.querySelector('[data-email-open]')?.textContent.trim(),
        formHidden: document.querySelector('[data-email]').hidden,
        hasLead: !!document.querySelector('.ios-auth .lead'),
        mentionsInstructor: /instructor|official logbook|feature/i.test(text)
      };
    });
    assert.equal(signin.words <= 6, true, signin.tag);
    assert.equal(signin.apple, 'Continue with Apple');
    assert.equal(signin.google, undefined, 'Google sign-in is not offered inside the iOS app (Google blocks embedded web views)');
    assert.equal(signin.email, 'Continue with email');
    assert.equal(signin.formHidden, true);
    assert.equal(signin.hasLead, false);
    assert.equal(signin.mentionsInstructor, false);

    await page.locator('[data-apple]').click();
    await page.waitForFunction(() => document.querySelector('[data-note]')?.textContent.includes('Apple sign-in'));
    const note = await page.locator('[data-note]').innerText();
    assert.match(note, /Apple sign-in isn’t available yet/);
    assert.equal(/com\.apple|AuthorizationError|error 1000/i.test(note), false);

    await page.locator('[data-email-open]').click();
    assert.equal(await page.locator('[data-email]').isVisible(), true);

    signIn();
    await page.goto(`http://127.0.0.1:${port}/flight-app.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ios-tabs');
    const hit = await page.evaluate(() => {
      const btn = document.querySelector('.ios-glance [data-add]');
      const r = btn.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const dialogs = [...document.querySelectorAll('dialog')].map(d => ({ id: d.id, open: d.open, display: getComputedStyle(d).display, pe: getComputedStyle(d).pointerEvents }));
      const tabs = [...document.querySelectorAll('.ios-tabs a')].map(a => a.textContent.trim());
      return { top: top === btn || btn.contains(top), dialogs, onclick: typeof btn.onclick, tabs, side: !!document.querySelector('.side'), bar: !!document.querySelector('.ios-nav') };
    });
    assert.equal(hit.top, true, 'a closed dialog or overlay is covering Log flight');
    assert.equal(hit.onclick, 'function');
    assert.equal(hit.side, false);
    assert.equal(hit.bar, true);
    assert.deepEqual(hit.tabs, ['Desk', 'Logbook', 'Study', 'Fly', 'You']);
    await page.waitForSelector('.bradio');
    const tabBar = async (label) => {
      const info = await page.evaluate(() => {
        const bar = document.querySelector('.ios-tabs');
        const link = bar.querySelector('a[aria-current="page"]') || bar.querySelector('a');
        const br = bar.getBoundingClientRect();
        const lr = link.getBoundingClientRect();
        const cs = getComputedStyle(bar);
        const ls = getComputedStyle(link);
        const hitAt = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2);
        const radio = document.querySelector('.bradio');
        const rr = radio && radio.getBoundingClientRect();
        return {
          h: Math.round(br.height), top: Math.round(br.top), bottom: Math.round(br.bottom), vh: innerHeight,
          inView: br.height > 44 && br.top >= 0 && br.bottom <= innerHeight + 1 && br.width > innerWidth * 0.9,
          opacity: Number(ls.opacity),
          blur: `${cs.backdropFilter || ''} ${cs.webkitBackdropFilter || ''}`.trim(),
          hit: !!(hitAt && (hitAt === link || link.contains(hitAt))),
          radioClears: !rr || rr.width < 2 || rr.bottom <= br.top + 1
        };
      });
      assert.equal(info.inView, true, label + ' ' + JSON.stringify(info));
      assert.equal(info.opacity > 0.9, true, label + ' opacity ' + info.opacity);
      assert.equal(info.hit, true, label + ' not the topmost element ' + JSON.stringify(info));
      assert.equal(/none/.test(info.blur) || info.blur === '', true, label + ' blur ' + info.blur);
      assert.equal(info.radioClears, true, label + ' radio ' + JSON.stringify(info));
    };
    await tabBar('loaded');
    const edge = await page.evaluate(() => {
      const meta = document.querySelector('meta[name=viewport]')?.content || '';
      const bg = getComputedStyle(document.body).backgroundColor;
      const title = document.querySelector('.ios-large')?.getBoundingClientRect();
      const plus = document.querySelector('.ios-plus')?.getBoundingClientRect();
      return { meta, bg, gap: title && plus ? Math.abs(title.top - plus.top) : 999 };
    });
    assert.match(edge.meta, /viewport-fit=cover/);
    assert.equal(edge.bg, 'rgb(237, 242, 250)');
    assert.equal(edge.gap < 28, true, 'plus sits apart from the title ' + edge.gap);
    await page.evaluate(() => { const s = document.querySelector('.ios-scroll'); if (s) s.scrollTop = Math.max(400, s.scrollHeight); });
    await tabBar('scrolled');
    for (const d of hit.dialogs) {
      assert.equal(d.open, false);
      assert.equal(d.display, 'none');
      assert.equal(d.pe, 'none');
    }
    await page.locator('.ios-glance [data-add]').click();
    await page.waitForSelector('#sheet[open]');
    assert.equal(await page.evaluate(() => document.getElementById('sheet').open), true);
    const grab = await page.evaluate(() => getComputedStyle(document.getElementById('sheet'), '::before').height);
    assert.equal(grab, '5px');
    await page.evaluate(() => document.getElementById('sheet').close());
    for (const [href, title] of [['#logbook', 'Logbook'], ['#study', 'Study'], ['#sim', 'Simulator'], ['#more', 'Account']]) {
      await page.locator(`.ios-tabs a[href="${href}"]`).click();
      await page.waitForFunction(h => location.hash === h, href);
      const shown = await page.evaluate(() => document.querySelector('.ios-large')?.textContent.trim());
      assert.equal(shown, title, href);
      await tabBar(href);
    }
    await page.locator('.ios-tabs a[href="#logbook"]').click();
    await page.waitForFunction(() => location.hash === '#logbook');
    await page.locator('.ios-chips a[href="#map"]').click();
    await page.waitForFunction(() => location.hash === '#map');
    assert.equal(await page.locator('.ios-back').innerText(), 'Logbook');
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
