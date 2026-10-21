# Boplo Flight workspace

Entry: `/flight-app.html`. Design preview: `/flight-app.html?preview=1` (explicit example data, no persistence and no access to real records).

## Database

Existing Google identity uses the tables in `0002_darts_product.sql`; preserve those existing users and sessions. Apply `migrations/0009_boplo_flight.sql` to the same D1 database bound as `DB`. No existing tables are modified by the Flight migration.

Local: `npx wrangler d1 execute DB --local --config work/flight-local.json --persist-to .wrangler/state --file=migrations/0009_boplo_flight.sql`. The local-only configuration matches the development server's `local-DB` binding; do not use it for remote deployment.
Production: apply that SQL to the existing bound database using the Cloudflare D1 console, or substitute its actual database name in a remote Wrangler command.

## Identity

The existing Google client configuration is reused. Keep its registered callback URL unchanged (`/auth/auth/google/callback` when using the canonical entry `/auth/auth/google`). Successful canonical identity callbacks now return to `/flight-app.html`. Existing legacy `/darts` identity routes are unchanged.

## Maps

Set `GOOGLE_MAPS_BROWSER_KEY` in Pages configuration. This is deliberately a public browser key: restrict it to the production Boplo domain and approved development origins, and restrict APIs to Maps JavaScript API. Enable Maps billing and usage controls. Do not put a server/service-account credential in this setting.

Maps load only on map-bearing screens and use Google satellite/hybrid imagery with its own attribution. Coordinates are optional and supplied by the user, one latitude,longitude pair per line. Endpoint connections are labelled separately from recorded tracks. No road routing or aviation route calculation is performed. Without a configured key the UI explains that maps are not connected.

## Current scope and release gates

Implemented: resumable server-saved onboarding, profile edits, flight create/edit/delete, preparation notes, flight map overlays, analytics by period/role/month, responsive app navigation, existing Google sign-in, account isolation.

Not yet enabled: checkout/paid entitlements, CSV/ADS-B imports, airport search dataset, instructor confirmation, official programme requirement tracking, AI-generated theory or operational guidance. The landing-page price is not a working Flight checkout. Do not market these unfinished features as available or charge for them.

Programme requirements need a named aviation reviewer, jurisdiction-specific versioned sources, and review dates before release. Current hours are descriptive records only. Opening balance minutes are separate from dated analytics. Solo and PIC are exclusive recording categories in this initial UI, not an assessment of regulatory credit.

Preview edits disappear on reload. Real records are stored in D1. No preview data is written to production.
