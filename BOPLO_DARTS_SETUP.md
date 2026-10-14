# Boplo Darts: Cloudflare setup

The site now has a Cloudflare Pages Functions API under `/darts` and a D1 migration for player data.

## 1. Create and bind D1

In Cloudflare, create a D1 database named `boplo-darts`. In the Boplo Pages project, add a D1 binding named `DB` that points to it.

Apply these migrations in order against that database:

1. `migrations/0001_scout.sql` only if you still need the old Scout product tables.
2. `migrations/0002_darts_product.sql` for Boplo Darts accounts, practice sessions, and drill completions.

For the Darts product alone, only migration `0002_darts_product.sql` is needed.

## 2. Add Pages secrets

Add these production environment variables in Pages. Keep their values out of GitHub.

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | `https://boplo.app` |
| `RESEND_API_KEY` | Sends passwordless email sign-in links |
| `EMAIL_FROM` | A verified Resend sender, e.g. `Boplo <hello@boplo.app>` |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth web client secret |

## 3. Configure Google OAuth

Create a Google OAuth web client and add this exact authorised redirect URI:

`https://boplo.app/darts/auth/google/callback`

For Pages preview deployments, add the preview URL callback only if you intend to test Google sign-in there.

## 4. Configure Resend

Verify the sender domain used by `EMAIL_FROM`. Magic links are sent by `/darts/auth/email` and expire after 15 minutes.

## 5. Deploy

Push this repository to `main`. Cloudflare Pages will deploy `dist/` and the `functions/` folder together. After deployment, visit `boplo.app`, choose email or Google sign-in, and log a session from the dashboard.
