# Activate paid Boplo Scout Plans

The implementation is in this repository. Live purchases and AI output require your own provider accounts and Cloudflare bindings. Do not put secret keys in HTML, GitHub, or chat.

## 1. Cloudflare storage

Create a D1 database called `boplo-scout` in Cloudflare's Storage & databases → D1 area. Run the SQL in `migrations/0001_scout.sql` in its console. On the existing **Boplo Pages project**, add a D1 binding named **DB** pointing to that database. Set the binding in production, and use a separate database for previews.

Keep the existing GitHub integration: branch `main`, output directory `dist`, repository root as project root. Functions are in the root `functions/` directory; Cloudflare builds them automatically. There is no application build command. The Pages project must deploy Functions, not just upload static assets.

## 2. OpenAI

Create an API project at https://platform.openai.com/, add API billing, and create a project API key. ChatGPT subscriptions do not fund API requests. Add the key as the Cloudflare Pages secret **OPENAI_API_KEY**. The default model is `gpt-4.1-mini`; **OPENAI_MODEL** can select another Responses model supporting structured output.

The system creates the complete plan before payment, then stores it privately. Failed AI calls do not open checkout. It reuses identical requests for an hour and limits fresh generation to five previews per IP and browser identity per UTC day, plus a global 100/day default. Set **DAILY_AI_LIMIT** to a smaller positive integer during launch; also configure provider spending limits. These limits are cost controls, not a complete bot defense. A busy campus or shared network can hit the shared IP limit.

## 3. Stripe test mode first

Create a Stripe account at https://dashboard.stripe.com/. Use a sandbox/test secret key first. Set **STRIPE_SECRET_KEY** in Cloudflare Pages. Do not use the publishable key.

Create a Stripe webhook destination at `https://boplo.app/api/webhook` for these events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `charge.refunded`

Set its signing secret as **STRIPE_WEBHOOK_SECRET** in Cloudflare. Test and live destinations have different signing secrets. Stripe sends callbacks only after the Functions deployment exists. Initial callback failures before configuration will retry.

No Stripe product or price creation is necessary: checkout creates a GBP 499-pence one-off line item on the server. The browser never supplies the amount. Only card payments are enabled for a simple synchronous flow. Boplo Plus subscriptions are outside this implementation.

## 4. Weather and location search

Open-Meteo's free hosted API is for evaluation/non-commercial use. During private testing, set **ALLOW_FREE_WEATHER=true**. For commercial launch, obtain its commercial API key at https://open-meteo.com/en/pricing and set **OPEN_METEO_API_KEY**. The code uses the customer endpoints when the key is present and refuses live Stripe checkout without it. Remove **ALLOW_FREE_WEATHER** for production.

This integration resolves cities and towns, not exact photo locations. It does not verify venue access, crowds, local hazards, buildings or terrain shadows. Solar position is calculated from the selected coordinates and date, with the location's IANA time zone and daylight-saving rules. The forecast is fetched for dates within roughly two weeks. If the provider fails or the date is outside its range, the preview explicitly discloses that weather is unavailable before payment. No forecast is invented. All plans are snapshots, not continuously updated forecasts.

## 5. Remaining configuration

Set **APP_ORIGIN=https://boplo.app**. Use that domain consistently when testing; redirect the `pages.dev` domain to it for public purchases so the checkout return retains the guest cookie.

Set **SESSION_SECRET** to a randomly generated string of at least 32 bytes (for example, generate one in a password manager). Keep it stable: changing it invalidates existing guest sessions and location tokens. Signed session cookies are HttpOnly, SameSite=Lax and Secure on HTTPS. Keys never enter browser assets.

After adding the database binding and variables, redeploy. `https://boplo.app/api/status` should return `ready: true` and `paymentsMode: test`. Missing setup leaves the public app unavailable for purchase rather than simulating success.

## 6. Acceptance check before live payments

1. Open Boplo → Create a Scout Plan. Search and choose a city, pick a future date, vibe and subject.
2. Generate the preview. It must not contain the exact timing or complete prompts, including in network responses.
3. Select **Unlock this plan · £4.99**. In Stripe test mode, use its documented test card `4242 4242 4242 4242`, a future expiry and any test CVC. This is test data, not a real payment.
4. Return to Boplo. It must verify the session on the server, then show the full plan. Refresh and confirm it remains available in My plans.
5. Download the plan and save its private access link. Open that link in another browser to check recovery. Anyone holding the link can view the plan. Creating a new link invalidates the old link.
6. Cancel a separate checkout and retry. There should be no paid entitlement and the existing open checkout should be reused.
7. Refund the test payment in Stripe. After its webhook, the plan should be marked refunded and should no longer be returned by the API. Copies already downloaded cannot be revoked.
8. Verify webhook delivery in Stripe, and inspect the rendered AI output for several cities, seasons, vibes and subjects. Local tests simulate AI/Stripe responses; they do not establish live provider quality or account configuration.

Only after the test succeeds, complete Stripe business activation, replace the test key with the live key and replace the webhook signing secret with the live destination's secret. Keep the £4.99 price inclusive of whatever tax you must account for; automated tax is not configured here. Configure your Stripe receipt/support/business details before accepting public payments.

## Storage and access

Paid and preview plans are stored in D1; drafts remain in browser local storage. A purchase uses a guest browser identity, not Google sign-in. Paid plans can be reopened from that browser or a saved private access link. Checkout collects payment details on Stripe; Boplo does not store card data. Account login, purchase recovery by email, automatic email delivery, subscriptions and shared account history are not included. The UI asks buyers to keep their plan and access link.

The AI request includes the chosen city, date, vibe, subject, calculated sun data and forecast. It uses `store:false`. No email or payment-card data is passed to OpenAI. Rate-limit IP values are hashed with the session secret. Expired rate rows are cleaned up; plan records are retained. Add an appropriate privacy notice and operational deletion/retention process before a public launch.

## Developer verification

`npm ci` installs the pinned Cloudflare tooling. `npm test` runs solar, validation, signing, paywall and payment lifecycle tests with an in-memory SQLite adapter and simulated providers. `npm run deploy:check` bundles the Pages Functions. `node tests/preview-server.js` runs a local UI fixture: its checkout action simulates a paid Stripe response. That test server is never deployed and cannot charge money. `npm run dev` starts the actual Cloudflare local runtime; use ignored `.dev.vars` for real test keys and apply the migration locally first.

References: [Cloudflare D1 bindings](https://developers.cloudflare.com/pages/functions/bindings/), [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Open-Meteo licence](https://open-meteo.com/en/pricing).
