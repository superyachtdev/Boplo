# Boplo Flight

A training companion for student pilots: next-lesson prep, a logbook with GPS tracks, theory study,
Ask Boplo (AI), radio practice, planning tools, schools, and a 3D landing simulator. It runs at
[boplo.app](https://boplo.app) and as a native iOS app.

Earlier Boplo products (Darts, Scout Plans, Move) still have routes in `functions/` and pages in `dist/`.
They share the sign-in system. Boplo Flight is the live product.

## Layout

| Path | What it is |
|---|---|
| `dist/` | The website and web app, served as static files. `flight-app.html` is the desk. |
| `functions/` | Cloudflare Pages Functions (the API). `functions/flight/` is Boplo Flight; `functions/auth/` is sign-in; `functions/lib/` is shared code. `_middleware.js` reports errors to Sentry. |
| `migrations/` | D1 (SQLite) schema, applied in number order. |
| `ios-native/` | The native SwiftUI app (Xcode project `BoploFlight.xcodeproj`), its widgets and Live Activity (`BoploWidgets/`) and code shared between them (`BoploShared/`). |
| `ios/`, `native/` | The older Capacitor wrapper. Not what ships. |
| `scripts/` | Data builders (airfields, runways), checks, and `export-ios-data.cjs`, which copies questions and rules into the iOS app. |
| `tests/` | `npm test` (Node's test runner). |

## Develop

```sh
npm ci
npx playwright install webkit   # once, for the iOS-shell test
npm test
npm run dev                     # wrangler pages dev, with a local D1
```

Secrets for local runs go in `.dev.vars` (never committed).

## Deploying

Cloudflare Pages deploys from GitHub on every push.

- **`main` → production** at boplo.app.
- **`staging` → preview** at `staging.<project>.pages.dev`. Push there first, check it, then merge to `main`.

GitHub Actions (`.github/workflows/ci.yml`) runs the tests and a Functions build on every push and pull
request. Don't merge to `main` while it's red.

For staging to work end to end, the Preview environment in Cloudflare Pages needs its own bindings:
Settings → Bindings → Preview → D1 `DB` pointing at a separate staging database (apply `migrations/`
to it), plus preview copies of the secrets below. Use Stripe test keys there.

### Rolling back

Every deploy is kept. In Cloudflare: Workers & Pages → the Boplo project → Deployments → pick the last
good production deploy → **Rollback to this deployment**. It takes effect in seconds. Then fix forward
with `git revert <sha>` on `main`, so the next push doesn't bring the bad change back.

Database changes don't roll back with a deploy. Migrations should only add tables and columns. D1 keeps
30 days of history: `wrangler d1 time-travel restore <db> --timestamp=<unix>` restores to a point in
time. Try it on the staging database once so the steps are known before they're needed.

## Configuration (Cloudflare → Settings → Variables and secrets)

Names only. Values never go in the repo or in chat.

- **Core:** `SESSION_SECRET`, `APP_ORIGIN`, `CRON_SECRET`, `OWNER_EMAILS`
- **Sign-in:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID`
- **App Review account:** `REVIEW_EMAIL`, `REVIEW_CODE` (signs in with a fixed code, no email)
- **Payments:** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_FLIGHT_WEBHOOK_SECRET`, `STRIPE_TAX`; Apple: `APPLE_ROOT_PEM`
- **AI:** `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (also the fallback when Claude is down), `OPENAI_API_KEY` (logbook scan), `AI_MODEL`, `AI_PROVIDER`
- **AI spend limits:** `AI_DAILY_FREE` (default 3 a person), `AI_DAILY_ADV` (40), `AI_GLOBAL_DAILY` (3000 calls a day across everyone), `AI_OFF` (any value switches Ask off)
- **Maps and weather:** `GOOGLE_MAPS_BROWSER_KEY`, `OPEN_METEO_API_KEY`
- **Live traffic:** `ADSB_API_KEY` (FlyItalyADSB, free plan: 500 km radius, 300,000 calls a month), `ADSB_DAILY` (daily ceiling on upstream calls, default 9,500). Each area is cached for 15 s and shared by everyone viewing it.
- **Monitoring:** `SENTRY_DSN`

## Monitoring

- **Errors:** set `SENTRY_DSN` and every API crash or 5xx (except deliberate 503s) is reported with its
  path and method. No query strings, bodies, cookies or emails are sent.
- **Uptime:** an external monitor (UptimeRobot, Better Stack or Cloudflare Health Checks) on
  `https://boplo.app/` and `https://boplo.app/flight/weather?ids=KJFK` every 5 minutes, alerting by email or push.
- **Spend:** monthly limits and alerts on the Anthropic, Google Cloud and OpenAI consoles, and a
  billing notification in Cloudflare. The `AI_*` limits above are the app's own ceiling.
- **iOS crashes:** Xcode → Window → Organizer → Crashes, and TestFlight feedback.

## iOS app

Open `ios-native/BoploFlight.xcodeproj` in Xcode 26 or later, pick your team under Signing & Capabilities
for both targets (BoploFlight and BoploWidgets), and run. Minimum iOS 17; Liquid Glass appears on iOS 26.
After changing questions or rules on the web, run `node scripts/export-ios-data.cjs` to copy them in.

App Store submission notes are in `APP_STORE_REVIEW.md`.
