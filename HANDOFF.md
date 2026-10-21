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

## Mini flight simulator (2026-10-21, Claude)

- `dist/flight-sim.js` + `dist/flight-sim.css`, lazy-loaded by the app (`openSim` in flight-app.js) from the **Simulator** page (#sim), "Fly it again" in a flight's sheet and on the overview track tile, and "Fly this route" in the nav log.
- **Replay:** an autopilot flies the logged track (or plotted route / nav plan) at 1–32×: take-off roll, Vy-style climb, cruise, coordinated turns, flapped 3° approach, flare and landing, with a scrubber.
- **Fly it:** the student flies with keyboard (arrows/WASD pitch and roll, R/F or +/− and 1–0 power, V flaps, P autopilot, G gates, C camera, Space pause, M sound), a gamepad, or on phones a touch stick, power slider and optional tilt steering. Scored on time inside the route gates and 250 ft of the planned height; landing rated by touchdown rate. Best score per route in localStorage.
- **Scenery:** MapLibre GL 4.7.1 with 3D terrain from AWS Terrain Tiles (Terrarium), Sentinel-2 cloudless **2017** satellite imagery by EOX (CC BY 4.0: later years are non-commercial, keep it pinned), OpenFreeMap labels/roads/runways/buildings, sky and haze. Attribution is in the map's info button.
- **Aircraft:** low-poly painted trainer drawn in a WebGL2 overlay sharing the map camera geometry, with sun lighting, a projected ground shadow, prop disc and nav lights.
- **Gotchas:** in MapLibre 4 `queryTerrainElevation` is relative to the camera centre, so the sim reads `map.terrain.getElevationForLngLatZoom` for absolute height; unloaded DEM tiles read 0 m and are ignored. Route projection prefers continuity so closed circuits don't jump from end to start.
- Labelled as a practice toy, not an approved training device. Heights are estimated (logs have no altitude). EOX tiles are free but rate-limited; heavy traffic may need EOX's commercial service or another imagery provider.

## Open items

- Question bank needs instructor review before marketing it as exam prep.
- Pricing section shows Free vs Advanced ($99.99/year or $11.99/month, monthly/yearly switch). The Free/Advanced feature split (e.g. 10-flight limit on Free) is a proposal — nothing enforces it yet, and checkout isn't wired up (CTAs go to sign-in).
- No privacy or terms pages exist yet; the footer Legal column was removed until they do.
- Unused legacy CSS/JS in `dist/` could be cleaned up.
