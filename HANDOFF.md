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

## Open items

- Pricing section shows Free vs Advanced ($99.99/year or $11.99/month, monthly/yearly switch). The Free/Advanced feature split (e.g. 10-flight limit on Free) is a proposal — nothing enforces it yet, and checkout isn't wired up (CTAs go to sign-in).
- No privacy or terms pages exist yet; the footer Legal column was removed until they do.
- Unused legacy CSS/JS in `dist/` could be cleaned up.
