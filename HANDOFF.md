# Boplo — handoff notes

Shared notes for whoever picks this up next (ChatGPT/Codex or Claude). Update this file at the end of each session.

## Current product

**Boplo Flight**: a flight desk for student pilots (PPL(A), LAPL, next rating). Prepare for the next lesson, log flights, see tracks on a map and hours by month/role. It never clears anyone to fly and never replaces the instructor, the official logbook or official weather/NOTAM sources. Older products in this repo (Scout, Darts, Wingman, Landing/Move) are legacy.

- Landing page: `dist/index.html` + `dist/flight-home.css` + `dist/flight-home.js`
- App: `dist/flight-app.html` (`?preview=1` shows example data). See `docs/FLIGHT_SETUP.md`.
- Hosting: Cloudflare Pages, output dir `dist`, Functions in `functions/`, D1 bound as `DB`.

## Landing page (rebuilt 2026-10-21, Claude)

- Hero is a 560vh scroll section with a sticky, rounded frame. A dependency-free WebGL2 scene renders procedural terrain as contour-chart lines in electric blue; scrolling flies an example lesson (Lesson 12, navigation) from runway 09 round 6 waypoints and back. A HUD shows altitude/heading/speed, and captions step through: before the lesson → in the air → after landing → toward your licence. The end pulls back to show the logged track.
- The terrain, route, minimap (desk section) and final-card contours all come from the same `height()` function in `flight-home.js`, so they match.
- No WebGL2 or `prefers-reduced-motion` → `.static` layout with the captions shown as cards.
- Smooth scroll uses the existing `vendor/lenis.min.js` (desktop only). GSAP is no longer used by the landing.
- Font: Archivo (Google Fonts), italic at width 112 for display, regular for body.
- Previous landing (`flight-landing.*`, `flight-expansion.css`) is untouched on disk; the old `index.html` is backed up at `work/index.flight-landing-previous.html`.

## Flight desk app (rebuilt 2026-10-21, Claude)

- `dist/flight-app.html|css|js`, same visual system as the landing (Archivo, night navy sidebar, cloud work surface, electric blue).
- Screens: sign-in (Google + email magic link via `POST /auth/auth/email`), 5-step onboarding, Overview, Logbook (search + role filter, table on desktop / cards on phone), Map (SVG track view; Google satellite if `GOOGLE_MAPS_BROWSER_KEY` is set), Analytics (12-month stacked hours by role, airfields), Prepare (lesson, checklist, questions, notes, last debriefs), Profile.
- Same API as before (`/flight/workspace`, `/flight/profile`, `/flight/flights[/:id]`). Profile gained `goalHours` (0–2000) and `checklist` (text lines `[x] item` / `[ ] item`); tests updated.
- `?preview=1` loads a richer example desk (12 flights from first lesson to navigation, with tracks around EGHP).

## Countries, authorities and licence minimums (2026-10-21, Claude)

- `dist/flight-rules.js` holds the data: every ISO country (names from the browser), country → licensing system (UK CAA, EASA with national authority names, FAA, Transport Canada, CASA, CAA NZ, else ICAO/other), licence options per system, and each licence's published minimum hours with source link and `checked` date.
- UK reflects the CAA changes of 1 Oct 2025: PPL(A) 40 h, NPPL(A) 32 h, LAPL(A) no longer issued (kept for existing holders).
- Profile stores `countryCode`, `regime`, `authority` (display text), `licence`. Older profiles (free-text country, old authority values) are mapped automatically.
- Minimums are shown as guidance with the source, never as eligibility. Re-verify figures and bump `checked` when rules change. CASA RPL (25 h) currently links to a secondary summary; swap in a CASA primary source.

## Chart map and airfields (2026-10-21, Claude)

- `dist/flight-map.js`: MapLibre GL 4.7.1 (from unpkg) + OpenFreeMap vector tiles (free, no key) in a custom Boplo night-chart style. Used on the Map page and in the route plotter opened from the flight form ("Plot on the map").
- Airfields: `dist/airfields/<ISO2>.json` built from OurAirports (public domain) by `scripts/build-airfields.mjs` (clone ourairports-data, run the script, commit). 49k airfields, with runways and main frequencies. Cards say "check the official AIP".
- Flight form: From/To autocomplete real codes; if both are known airfields and no route is plotted, a start-to-end line is saved automatically. New routeKind `route` = plotted.
- Falls back to the SVG track view if the map library or tiles can't load.

## Training utility features (2026-10-21, Claude)

- **Cost and pace:** profile `currency`, `rateAircraft`, `rateInstructor`; flight `cost` (optional, otherwise estimated from rates). Overview "Your pace" forecasts finish date and total spend from the last 8 weeks.
- **Progress:** syllabus checklists in `flight-rules.js` (`syllabusFor`): UK/EASA PPL(A) exercises 1–19 plus QXC, RT, exams and skill test; FAA Private Pilot ACS areas/tasks; a general ICAO outline elsewhere. State in profile `syllabus` (JSON). Milestones (first flight, first solo, first cross-country, hour and landing marks, test passed) with 1080×1920 share cards drawn on canvas.
- **Study:** `dist/flight-questions.js`, 67 original questions across 9 subjects. STATUS: DRAFT, pending review by a qualified instructor (set `reviewed`). Practice by subject (weakest first), 16-question mock exam with pass mark (FAA 70%, others 75%). State in profile `study` (JSON).
- **Weather:** `GET /flight/weather?lat&lng` proxies aviationweather.gov (NOAA) METAR/TAF for the nearest stations. App decodes every group in plain English and works out head/crosswind on your home runways. Labelled as a learning tool, not a briefing.
- **Voice debrief:** browser speech recognition fills the debrief notes; `POST /flight/debrief` uses Gemini (`GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`) to tidy only what the student said into went well / work on / prepare / questions, and can add prep items and questions to the next lesson.
- **Public cost planner:** `dist/plan.html` (no sign-in). Saves the plan to localStorage; signing up pre-fills setup from it. Linked from the landing nav, pricing and footer.

## Pilot tools (2026-10-21, Claude, second round)

- **Weather lookup:** `GET /flight/weather?ids=CODE&lat&lng` returns the exact station's METAR + TAF (`exact:true`), falling back to the nearest stations by bbox. The app searches any ICAO code or airfield name (home country first, then `dist/airfields/codes.json`, built by `scripts/build-airfields.mjs`). Decodes US RMK remarks (AO1/AO2, SLP, T-group, pressure tendency, PRESRR/PRESFR) and colour states. Live NOAA data; only `?preview=1` shows example data.
- **Nav log (#navlog):** plot a route or start from a logged flight's route; TAS, wind, variation (user-entered), fuel burn, taxi and reserve. Per leg: TT, distance, WCA, TH, MH, GS, time, fuel. "Use wind from the departure METAR", printable kneeboard, up to 8 saved plans in profile `navlogs`. Labelled as a planning aid.
- **Currency (#currency):** user-entered medical / rating / FAA flight review / solo endorsement / custom dates in profile `docs`. Passenger currency (3 landings in 90 days), FAA night currency from flight `nightLandings`, UK/EASA SEP revalidation-by-experience bars (FCL.740.A). Sources linked.
- **Logbook:** Export CSV, Print (EASA/UK or FAA-style columns, landscape), Import CSV with a preview → `POST /flight/flights/import` (≤500 rows per call, returns per-row errors).
- **Instructor share:** Progress → "Share with your instructor". `POST /flight/share` returns a 48-hex token (only its SHA-256 is stored as `shareHash`); `DELETE` revokes. Public read-only `dist/share.html?t=` calls `GET /flight/shared` (first name, next lesson, prep, questions, syllabus, totals, last 12 flights with debriefs). `share.html?t=example` shows a sample.
- **Radio practice (#radio):** UK/ICAO or FAA scenarios using the student's own registration spelled phonetically. Speech recognition or typing; checks each required element, shows a model call; best scores in profile `radio`. Labelled as practice.

## Mini flight simulator (2026-10-21, Claude; engine rebuilt the same evening)

- `dist/flight-sim.js` + `dist/flight-sim.css`, lazy-loaded by the app (`openSim` in flight-app.js) from the **Simulator** page (#sim), "Fly it again" in a flight's sheet and on the overview track tile, and "Fly this route" in the nav log.
- **Engine: CesiumJS 1.144.0** from jsDelivr (CESIUM_BASE_URL set to the CDN build). Own render loop (`useDefaultRenderLoop: false`).
- **Scenery:** Google Photorealistic 3D Tiles when `GOOGLE_MAPS_BROWSER_KEY` (Cloudflare env) is set and the Map Tiles API is enabled on it: real 3D terrain, airports and buildings. The key reaches the app via `/flight/workspace` (signed in) or the public `GET /flight/simkey` (example desk). Restrict the key by HTTP referrer to boplo.app. Billing: 1,000 free root-tileset sessions/month, then $6 per 1,000; a session lasts up to 3 h. Google attribution/logo shows in the credits. Don't mix Google tiles with other basemaps.
- **Fallback (no key or tiles fail):** Cesium globe with Sentinel-2 cloudless **2017** imagery by EOX (CC BY 4.0; later years are non-commercial, keep it pinned) and AWS Terrain Tiles (Terrarium PNGs fed through `CustomHeightmapTerrainProvider`). Soft at runway level; fine from ~1,000 ft.
- **Aircraft:** low-wing trainer generated in code as a GLB (`aircraftGLB()`): lofted smooth fuselage, NACA-style aerofoil wings with dihedral, glass canopy, wheel fairings, spinning prop node + blur disc, nav lights and strobe. Casts real shadows near the ground.
- **Ground height:** Google mode uses `scene.sampleHeight` (excluding our own primitives) with a small cache; heights are ellipsoidal, so the geoid offset is derived from the departure airfield's published elevation for the altitude readout. Globe mode reads the z14 Terrarium tile directly (`provider.sampleAt`), because `globe.getHeight` returns coarse-tile garbage until detail loads.
- **Replay:** autopilot flies the logged track at 1–32×: take-off roll, climb at ≥70 kt, cruise, coordinated turns, flapped 3° approach aimed 600 m before the route end, flare, landing. Scrubber.
- **Fly it:** keyboard (arrows/WASD, R/F or +/− and 1–0 power, V flaps, P autopilot, G gates, C camera, Space pause, M sound), gamepad, or touch stick, power slider and tilt on phones. Scored on time inside the gates and within 250 ft of the planned height; landing rated by touchdown rate.
- Debug handle: set localStorage `boplo-sim-debug` to `true` to get `window.__boploSim`.
- Labelled as a practice toy, not an approved training device. Heights are estimated (logs have no altitude).

## Payments, plans and legal (2026-10-21, Claude)

- **Stripe subscriptions** via REST in `functions/lib/billing.js` (no SDK). Stripe API version pinned to `2024-06-20`. Prices are created on first use by lookup key: `boplo_flight_advanced_monthly` ($11.99) and `boplo_flight_advanced_yearly` ($99.99), product metadata `boplo=flight_advanced`.
- **Env (Cloudflare Pages):** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_FLIGHT_WEBHOOK_SECRET` (the Flight endpoint's own signing secret; the old `/api` product uses `STRIPE_WEBHOOK_SECRET`). Optional: `STRIPE_TAX=on` (collects billing address and enables Stripe Tax), `BILLING_TRIAL_DAYS` (default 7, `0` disables).
- **Migration 0010** creates `flight_billing` (one row per user: customer, subscription, status, interval, period end, cancel flag, trial).
- **Routes:** `GET /flight/billing`, `POST /flight/billing/subscribe|sync|cancel|resume|portal`, `POST /flight/billing/webhook` (public, signature checked, runs before the origin check), `GET /flight/account/export`, `POST /flight/account/delete` (`{confirm:'DELETE'}`; cancels any subscription, deletes data, clears cookie). Workspace includes `billing`.
- **Checkout UX:** Boplo's own sheet with Stripe's Payment Element (cards, Apple Pay, Google Pay); subscription created `default_incomplete`, trial uses the pending SetupIntent, then `/billing/sync` polls until active. Redirect-based methods come back to `/flight-app.html#plan?...` and finish on load. A trial only counts as Advanced once Stripe has a card.
- **Plans:** Advanced = active, trialing (with card) or past_due. Free: 15 flights (server-enforced, 402), 1 saved nav plan, replays only. Advanced-only: CSV import, instructor share, debrief tidy (server-enforced), plus currency, study, radio and simulator fly mode (client-gated). Export/print stays free. Any 402 opens the upgrade sheet.
- **Landing:** pricing lists match the plans; "Start 7-day free trial" stores `boplo-intent` so the desk opens Plan & billing after sign-in.
- **Legal:** `dist/terms.html`, `privacy.html`, `refunds.html` (14-day money-back guarantee, EU/UK withdrawal right and model form, Google Maps/Earth terms for the 3D tiles). Seller is named as BOPLO (sole trader; owner asked for no address or tax ID on the pages). Sign-in screen and checkout link to them; landing footer has a Legal column. Drafts: get a lawyer to review before taking real money.
- **Promotion codes:** "Have a code?" in checkout → `POST /flight/billing/promo` validates a Stripe promotion code (dashboard: Products → Coupons → Promotion codes) and shows the discounted first payment; `subscribe` passes it as `discounts[0][promotion_code]`. Promotion-code metadata `skip_trial=true` charges immediately instead of starting the trial. A 100%-off code activates without a card.
- `_headers` Referrer-Policy changed from `no-referrer` to `strict-origin-when-cross-origin` (needed for referrer-restricted Google keys and Stripe).

## Ask Boplo, the AI study assistant (2026-10-21, Claude)

- `functions/lib/ask.js` + `POST /flight/ask` (server-sent events stream) and `GET /flight/ask/usage`. Chat page `#ask` in `flight-app.js` (`askPage`), also a mobile tab.
- **Model:** Claude Haiku 5.5 (`claude-haiku-5-5`) via `ANTHROPIC_API_KEY`, streaming, `max_tokens` 900. The system prompt is cached (`cache_control: ephemeral`). Gemini 2.5 Flash-Lite fallback when `AI_PROVIDER=gemini` or there's no Anthropic key. Env options: `AI_MODEL`, `AI_DAILY_FREE` (3), `AI_DAILY_ADV` (40), `AI_OFF=1`.
- **Grounding:** a curated, link-checked index of official sources (`SOURCES`: PHAK 25C and AFH 3C chapter lists, AIM, Aviation Weather Handbook, ACS, 14 CFR 61/91, EASA Aircrew and SERA, CAP 413, Skyway Code, UK CAA licensing, ICAO Annex 2, AWC). Answers end with "Sources:", which the UI turns into linked chips. There's no full-text retrieval yet; next step is chunking the FAA handbooks into D1 FTS5.
- **Context:** the browser sends a compact summary of the student's desk (`askContext()`: licence, hours, next lesson and checklist, syllabus progress, next expiry, last 5 flights with debriefs), wrapped as data in `<student_context>`.
- **Safety rules** in the system prompt: no go/no-go decisions, weather or NOTAM briefings or "you're legal to fly"; in-flight emergencies get fly the aircraft / checklist / ATC or 121.5; medical goes to an AME; stays on aviation; never invents citations.
- **Limits:** daily count per user in `flight_ai_usage` (created on first use). Free gets 3 a day (then 402 → upgrade sheet), Advanced 40 (then 429).
- Chat history lives in the browser's localStorage only. The privacy policy lists Anthropic as a processor.

## Navigation hubs (2026-10-22, Claude)
- The sidebar was 14 items and scrolled, so pages are grouped into 5 hubs (`HUBS` in `dist/flight-app.js`): Overview · Ask Boplo · Logbook (Flights, Map, Analytics) · Training (Progress, Prepare, Study, Radio, Currency) · Flight planning (Nav log, Weather) · Simulator (its own highlighted entry with a 3D tag; "Fly" in the phone tab bar, which has 6 tabs).
- Hubs with more than one page show pill sub-tabs (`.subnav`) above the page title. Each hub remembers the last sub-tab used (`ui.lastSub`) for the session.
- Mobile: the 5 hubs are the bottom tabs. The topbar avatar opens `#more`, now the Account page (Profile, Plan & billing, legal links, sign out).
- Desktop sidebar lists each section's pages underneath it. `fitNav()` folds sections (other sections bottom-up first, then the current one) only when the window is too short, so the sidebar never scrolls; the top sub-tabs show on desktop only when the current section is folded.
- Every page keeps its own hash (`#currency`, `#sim` …), so old links still work; `#training`, `#planning` and `#account` also resolve.

## Student-retention features (2026-10-22, Claude)
Built from market research: students quit over cost overruns, lost momentum and not knowing where they stand; AI mock checkrides are the 2026 trend.
- **Licence checklist** (`R.requirementsFor(regime, licence)` in `dist/flight-rules.js`; `requirements()` in the app): per-licence requirements (EASA PPL/LAPL, UK PPL/NPPL, FAA Private/Sport/Recreational, TC, CASA, NZ, ICAO). Hours (total, dual, solo, solo cross-country) and night landings come from the logbook. The long solo cross-country is detected from a solo flight's track length. Other items (exams, test, medical, RT…) are ticked by the pilot and stored in `profile.reqs` keyed `regime|licence`. Medical auto-ticks from the Currency expiry date. Shown on Progress (full) and Overview (next milestone + 4 open items).
- **Budget page** (`#budget`, Training hub; `forecast()`): projects completion hours from the published minimum × a pace factor (1.4 at 2+ flights a week, 1.65 weekly, 1.9 less often; typical private pilots finish at about 1.8× the FAA minimum). Spend comes from flight costs/rates plus "other costs" (`profile.budget` = {total, extras:[{n,amt,paid}]}). It shows the projected total, finish month, monthly spend, the month the budget runs out and the shortfall, and a "fly twice a week" saving. Overview has a Cost forecast tile.
- **Momentum** (Overview tile): days since last flight with a level message (7/20/59/89-day bands), flights per week over 8 weeks against the profile frequency target, a weekly streak, an email-reminders switch (`profile.reminders`) and an Install button.
- **Reminder emails** (`functions/lib/nudges.js`): `POST /flight/cron/nudges` with `Authorization: Bearer CRON_SECRET` sends a gap email (10+ days, then weekly; monthly after 90 days) and a "lesson tomorrow" email, via Resend (RESEND_API_KEY, EMAIL_FROM). Sends are recorded in the lazily created `flight_nudges` table. Each email has a signed one-click unsubscribe: `GET /flight/nudges/off`. Triggered daily by `.github/workflows/nudges.yml`, which needs the repo secret CRON_SECRET; the same value goes in Cloudflare.
- **PWA**: `dist/manifest.webmanifest`, `dist/sw.js` (network-first, caches the shell for offline, never caches /flight /auth /api), `dist/icons/*`. Registered on https only.
- **Mock checkride** (Ask Boplo → "Mock checkride", Advanced only, server-enforced 402): `mode:'examiner'` + `setup {focus, style, questions}` appends `examinerBlock()` to the system prompt. It keeps up to 48 messages and caps a turn at 1,500 output tokens (the prompt keeps turns short). The debrief format ("Score: NN/100", "Result:") is parsed client-side into a score badge, with history in localStorage. Voice mode: the examiner's turn is spoken with speechSynthesis, then the mic listens and auto-sends.
- **Study**: Leitner spaced repetition (each question stores [right, seen, box, dueDay]; boxes 0/1/3/7/16/35 days), daily review queue, per-subject and overall exam readiness, and "Explain it another way" (one Ask Boplo call, inline). The question bank grew from 76 to 138 (all original, still awaiting instructor review).

## Simulator runways (2026-10-22, Claude)
- `scripts/build-runways.mjs` builds `dist/runways/<ISO2>.json` from OurAirports `runways.csv`: both runway ends, length, width, surface, lighting and displaced thresholds. About 14k runways have surveyed end coordinates. About 21k (mostly small strips) are placed through the airport point on their true heading, using the data or the designator corrected by a dipole magnetic-declination estimate, and are flagged approx. Rebuild with: `git clone --depth 1 https://github.com/davidmegginson/ourairports-data /tmp/oa && node scripts/build-runways.mjs /tmp/oa dist/runways`.
- `flight-sim.js` picks the departure and arrival runway ends: into the wind when it's 5 kt or more, otherwise lined up with the route, preferring long paved runways. The route becomes threshold → runway → 1.8 km climb-out → route → (base entry if the turn onto final is over 65°) → 3 NM final → threshold → rollout. Short local flights fly a left-hand circuit off the real runway. Airfields with no published runway get a 550 m grass strip along the route.
- Runways are drawn by us as textured meshes, painted in `runwayCanvas()` with ICAO threshold stripes, designators (with L/R/C), centreline, aiming point, touchdown zone and edge lines. Grass and dirt strips get edge markers. Heights are sampled from the scenery and the aircraft rides on the runway surface (`rwHeight`). If the scenery heights arrive late, the datum correction moves the runways too, and they are re-sampled.

## Simulator aircraft (2026-10-22, Claude)
- `dist/flight-aircraft.js` (`window.BoploAircraft`) builds nine training types as glTF binaries in code from short specs in metres: Cessna 152 and 172, Piper PA-28 Warrior, Diamond DA40 and DA20, Tecnam P2008, Robin DR400, Cirrus SR20 and Piper J-3 Cub. Specs cover high or low wing, struts, cranked tips, conventional or T-tail, tricycle or tailwheel, fairings, cabin or bubble canopy and a generic livery (no manufacturer marks).
- `model(id)` turns book figures (stall, rotate, approach, cruise, top speed, climb) into the sim's thrust and drag. `flight-sim.js` uses them for lift-off, stall, approach speeds, autopilot targets and overspeed. The Cub sits nose-up on its tailwheel (`groundAtt`) and raises the tail during the take-off roll.
- The Simulator page has an Aircraft picker (`ui.sim.ac`, kept in localStorage `boplo-sim-ac`), with rendered images (`dist/aircraft/<id>.webp`, regenerate with `scripts/aircraft-renders`: serve a folder with render.html + flight-aircraft.js, run render.mjs, then `python3 composite.py r dist/aircraft`). "Match my logbook" maps the flight's aircraft text with `match()` (for example "PA-28 Warrior" → pa28), falling back to the profile aircraft and then the C172.

## Simulator flight model and controls (2026-10-22, Claude)
- `dist/flight-physics.js` (`window.BoploPhysics`) is a rigid-body flight model:
  - aerodynamics: lift from angle of attack with a real stall, induced and parasite drag, propeller thrust η·P/√(V²+V0²) with density lapse, pitch dynamics (the elevator commands angle of attack about the trimmed one), roll and yaw dynamics with weathervane and dihedral stability, adverse yaw, prop/torque yaw at high power and low speed, sideslip
  - flaps and engine: flaps in each type's real notches (`DATA`), elevator trim, carb heat, optional auto-rudder
  - ground: nosewheel or tailwheel steering, rolling friction by surface, brakes, parking brake; crash checks for hard landings, wing strikes, nosewheel-first landings and prop strikes
- Calibration comes from mass, wing area, hp and book speeds. CLmax comes from Vs/Vso, and CD0 from the top speed at full power. `scripts/sim-physics-check.cjs` reports each type's lift-off, climb, top speed, clean and full-flap stall speeds and landing; stall speeds match the book within about 1 kt.
- `BoploPhysics.pilot()` holds the autopilot control laws: take-off, initial climb, track/heading, VS-to-pitch with an integrator and auto-trim, auto-throttle, flaps, flare and rollout braking. `scripts/sim-autopilot-check.cjs` flies a full trip per type.
- `flight-sim.js` maps the model to the existing HUD, scoring and replay. Autopilot modes: NAV (route, lateral and vertical, with auto-throttle), HDG, ALT and SPD holds with ± buttons.
- Controls: W/S or arrows (elevator), A/D or arrows (ailerons), Q/E (rudder), R/F (throttle), V and Shift+V or ] [ (flaps), T/G (trim), B (brakes), Shift+B (parking brake), H (carb heat), U (auto-rudder), I (panel), C (camera), J (gates). Gamepad and touch (stick, rudder slider, flap, trim and brake buttons) are covered too.
- Six-pack canvas (`drawSixPack`): ASI with the type's arcs (Vso–Vfe white, Vs–Vno green, Vno–Vne yellow, Vne red), AI, altimeter, turn coordinator with slip ball, HSI with heading bug, route course and deviation, VSI, plus an engine and systems column. Cockpit camera uses the eye point from `BoploAircraft.build().eye`.

## Simulator graphics, weather and control settings (2026-10-22, Claude)
- Aircraft GLBs (flight-aircraft.js) have separate ailL/ailR/flapL/flapR/elev/rud nodes with pivot/axis metadata; flight-sim.js placeAircraft rotates them from the control inputs (rate-limited). Beacon, nav, strobe and landing lights (L).
- Runway lighting from buildRunwayLights(): edge lights, threshold/end lights, approach lights with a sequenced rabbit, and a 4-box PAPI (2.5–3.5°) coloured per frame from the eye angle.
- O.time ('day' | 'golden' | 'night') tints the 3D tiles (customShader u_light) and scales lights. O.weather {clouds:[{cover,base ft AGL}], visM, gust, turb, windRel:{off,spd,gust}} drives fog, a CloudCollection ring around the aircraft, gusts and turbulence (windAt). The app's sim page has Weather (presets or Live METAR) and Time of day options.
- Cameras: Chase, Cockpit, Wing, Tower (auto-placed beside the nearest runway, zooms on the aircraft), Wide, High. Drag to orbit/look, wheel or pinch to zoom, double-click resets.
- Controls panel (K): sensitivity curve (expo), key rate, spring-to-centre, invert, auto-rudder, mouse yoke (Y), and joystick/yoke axis mapping with Detect, reverse and a throttle-lever axis. Saved in localStorage 'boplo-sim-ctl' style store key 'ctl'.
- Takeoff "launch" fix: runways and the datum are never shifted while the aircraft is on them; far runways are resampled lazily when within 9 km.

## Open items

- Question bank needs instructor review before marketing it as exam prep.
- Stripe is in test mode until the owner switches keys to live. Get the legal pages reviewed.
- Unused legacy CSS/JS in `dist/` could be cleaned up.
