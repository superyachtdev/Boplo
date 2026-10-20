# Boplo

Boplo Landing is a global move-planning product. It turns a destination, budget and real-life priorities into a practical plan for a move abroad.

## Deploy with Cloudflare Pages

Connect this GitHub repository in Cloudflare Pages, then use:

- **Production branch:** `main`
- **Framework preset:** None
- **Build command:** Leave blank
- **Build output directory:** `dist`

The front end is static; Pages Functions provide authenticated move data, paid-plan access, and later Stripe checkout/local-adviser workflows.

## Move Plan backend

Run `migrations/0008_boplo_move_plans.sql` against the same D1 database after the existing migrations. It adds:

- one move profile per signed-in user;
- 90-day paid Move Plan entitlements;
- saved first-month / three-month Move Calculator results;
- a moderated local-adviser directory and private request queue.

The authenticated Pages Function API is mounted at `/move`:

- `GET` / `PUT` `/move/profile`
- `GET` / `POST` `/move/calculator` — requires a paid Move Plan
- `GET` `/move/advisors?city=Barcelona`
- `GET` / `POST` `/move/local-requests` — requires a paid Move Plan
- `POST` `/move/checkout` and `/move/checkout/verify`

Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `APP_ORIGIN` before enabling checkout. Configure Stripe to send `checkout.session.completed` and `checkout.session.async_payment_succeeded` to `/move/webhook`.

## Current prototype behaviour

- The landing page includes an in-browser Scout Plan prototype.
- Visitors can explore the marketing prototype and sign in through the existing account routes.
- Paid calculator and local-help routes are backend-complete, but the signed-in Move Plan screens and Stripe configuration still need to be connected before public launch.
