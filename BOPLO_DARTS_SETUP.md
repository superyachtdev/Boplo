# Boplo Darts: Cloudflare setup

The site now has a Cloudflare Pages Functions API under `/darts` and a D1 migration for player data.

## 1. Create and bind D1

In Cloudflare, create a D1 database named `boplo-darts`. In the Boplo Pages project, add a D1 binding named `DB` that points to it.

Apply these migrations in order against that database:

1. `migrations/0001_scout.sql` only if you still need the old Scout product tables.
2. `migrations/0002_darts_product.sql` for Boplo Darts accounts, practice sessions, and drill completions.
3. `migrations/0003_darts_practice_loop.sql` for measurable drill runs and progress history.
4. `migrations/0004_darts_target_data.sql` for target-level practice heatmaps.
5. `migrations/0005_darts_video_reviews.sql` for private video-review records.

For the Darts product alone, run `0002_darts_product.sql`, `0003_darts_practice_loop.sql`, `0004_darts_target_data.sql`, and `0005_darts_video_reviews.sql` in that order.

When you deploy the practice loop update, also run `migrations/0003_darts_practice_loop.sql` in the same D1 Console. It adds drill-result history; until it is applied, account sign-in and session logging still work, but completed drill results are not recorded.

## 2. Add Pages secrets

Add these production environment variables in Pages. Keep their values out of GitHub.

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | `https://boplo.app` |
| `RESEND_API_KEY` | Sends passwordless email sign-in links |
| `EMAIL_FROM` | A verified Resend sender, e.g. `Boplo <hello@boplo.app>` |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth web client secret |
| `GEMINI_API_KEY` | Runs the optional native-video Video Review beta |
| `GEMINI_VISION_MODEL` | Optional model override; defaults to `gemini-3.8-flash` |

## 3. Configure Google OAuth

Create a Google OAuth web client and add this exact authorised redirect URI:

`https://boplo.app/darts/auth/google/callback`

For Pages preview deployments, add the preview URL callback only if you intend to test Google sign-in there.

## 4. Configure Resend

Verify the sender domain used by `EMAIL_FROM`. Magic links are sent by `/darts/auth/email` and expire after 15 minutes.

## 5. Add private video storage (R2)

Create an R2 bucket for player clips, then add it to the Pages project as an R2 binding named `VIDEOS`. Do not expose this bucket publicly: Boplo serves a clip only to its signed-in owner through `/darts/videos/:id/file`.

Video Review accepts short clips up to 18 MB. The original clip remains private in R2 and is sent to Gemini only when its owner requests an analysis. Gemini reviews the full short clip rather than a few browser-captured still frames.

## 6. Deploy

Push this repository to `main`. Cloudflare Pages will deploy `dist/` and the `functions/` folder together. After deployment, visit `boplo.app`, choose email or Google sign-in, and log a session from the dashboard.
