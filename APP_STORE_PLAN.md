# Boplo Flight on the App Store

This is the plan for shipping Boplo Flight as an iOS app. It was checked against the repo on 3 November 2026, not only against the design brief. Nothing in this branch is submitted to Apple, and nothing here changes prices, Stripe or who can sign in.

The iOS project that goes with this plan is in `ios/`. How to run it in Xcode is in `ios/README.md`.

## Recommendation

Use **Capacitor** to wrap the existing flight desk. Do not rewrite it in Swift, React Native or Flutter, and do not start a second product.

The desk is a large hand-written app: `dist/flight-app.js` and the feature files around it, Pages Functions under `functions/flight/` and `functions/auth/`, and D1. A native rewrite would fork that product. Capacitor keeps one codebase, produces a normal Xcode project Gianni can build on his Mac, and has a place to add the native pieces App Review will look for: Sign in with Apple, push, and a flight recorder that keeps running with the screen off.

The shell in this branch opens the live desk:

`https://boplo.app/flight-app.html#overview`

That is deliberate, and it is **not** the binary to send to App Review.

Capacitor’s own config marks `server.url` as a live-reload setting, not a production setting. Apple’s Guideline 4.2 rejects an app that is only a repackaged website. This URL is how the project can be built and tried on a Mac **without** changing auth. The session cookie and the flight API only work when the page’s origin is `https://boplo.app`. A copy of `dist/` inside the app would be a different origin, and saving a flight would be rejected. Fixing that means an auth change, which this pass does not make.

So the path is:

1. This branch: the Xcode project, plus the account-based App Store entitlement, Sign in with Apple, background recording, and native push described under Decisions. Safe to run in the simulator. Not a submission.
2. The first upload still waits on Gianni’s Apple account, the two subscription products, the push key, a demo account, and `support@boplo.app`. Those are listed at the end. Nothing in this branch is sent to Apple.

## Decisions, 3 November 2026

Gianni decided these. The code in this branch follows them. Browser pricing, the website’s Stripe checkout, and browser sign-in are unchanged. Anything that is iOS-only runs only when `Capacitor.isNativePlatform()` is true.

| # | Decision | What the code does |
|---|---|---|
| 1 | Advanced in the iOS app is an auto-renewable In-App Purchase, yearly by default and monthly as well, worldwide. Stripe stays for the website and for school plans. A Stripe subscriber is Advanced in the app. An App Store subscriber is Advanced on the web. No Stripe checkout and no link to buy on the web inside the iOS app. Restore Purchases is required. | `functions/lib/apple.js` checks the App Store JWS against Apple Root CA - G3 and writes `flight_apple`. `publicBilling` is Advanced if Stripe **or** Apple **or** a school seat **or** an owner email says so. `POST /flight/billing/apple` claims a receipt for the signed-in account and refuses to move it onto a second account. `POST /flight/billing/apple/notifications` takes App Store Server Notifications V2. The iOS plan screen calls StoreKit and shows Restore purchases. RevenueCat was not added: the same Cloudflare Functions and D1 already hold the Stripe row. |
| 2 | iOS prices match the website: **$99.99 a year** and **$11.99 a month**. He will join the Small Business Program. | Product ids `app.boplo.flight.advanced.yearly` and `app.boplo.flight.advanced.monthly`. Both amounts are US price points he can select in App Store Connect. Other countries should stay on Apple’s automatic price. If a storefront has no exact cent, pick the nearest and do not raise the US price. The commission comes out of the same sticker price. |
| 3 | School plans stay on the website. | The iOS app hides “Set up your school”, the Stripe school checkout, “Plans for schools”, and “Billing and invoices”. Joining with a school code still works, and a school member is still Advanced. |
| 4 | Sign in with Apple, next to Google and the email link. | `POST /auth/auth/apple` checks Apple’s identity token. A verified email that already has a Boplo account is linked, unless that account is already tied to a different Apple ID. A private-relay address that matches nobody creates a new account. The button is only in the iOS shell. Google and the magic link are untouched for browsers. |
| 5 | Apple Developer enrolment is **Individual**. The seller name on the store will be Gianni’s personal name. | The checklist says Individual. No organisation or D-U-N-S step. |
| 6 | Hide Students nearby and direct messages in the iOS app until there is an age check. | The iOS shell drops that tab and sends `#students` to Community. The website still has it. |
| 7 | iPhone only for v1. | `TARGETED_DEVICE_FAMILY` is 1. No iPad screenshots. |
| 8 | Background GPS for the logbook recorder, including with the screen off. | `BoploPlugin` uses `CLLocationManager` with the location background mode, nearest-ten-metres accuracy and a 15 metre filter. It records only after Start and stops on Stop. The blue status bar stays visible while it records. |
| 9 | Keep Google 3D Tiles. | `onlyUsingWithGoogleGeocoder: true` stays. Cesium’s credit line stays on screen, and a “3D scenery © Google” or “Imagery © Google” line is added in front of it. The privacy policy already links the Google Maps terms. Runways are still OurAirports and OpenStreetMap, not traced from the tiles. |
| 10 | Native push (APNs). The demo account and `support@boplo.app` will be supplied by Gianni. | The app registers an APNs token at `POST /flight/push/apns`. Sends use the key below when it exists. Placeholders, not values, are in git. |

### What Gianni still has to supply

These are empty on purpose. Do not paste the keys into chat or into git.

| Placeholder | Where it goes | What it is |
|---|---|---|
| Apple ID for the Developer Program | developer.apple.com, Individual | His personal Apple ID. Seller name will be his name. |
| `APPLE_TEAM_ID` | Cloudflare Pages, and App Store Connect | 10-character Team ID |
| `APPLE_APNS_KEY_ID` | Cloudflare | Key ID of an APNs auth key (.p8) |
| `APPLE_APNS_PRIVATE_KEY` | Cloudflare, secret | The .p8 file contents |
| `APPLE_BUNDLE_ID` | Cloudflare, optional | Defaults to `app.boplo.flight` |
| `APPLE_APNS_ENV` | Cloudflare | `sandbox` until TestFlight production, then `production` |
| Sign in with Apple capability | App ID `app.boplo.flight` | Turn it on. The entitlements file already asks for it. |
| Push capability | Same App ID | Turn it on. Create the APNs key. |
| Two subscriptions | App Store Connect | Yearly `app.boplo.flight.advanced.yearly` at US $99.99. Monthly `app.boplo.flight.advanced.monthly` at US $11.99. Group them. Yearly first. |
| Server Notifications V2 | App Store Connect → the app → App Store Server Notifications | Production and sandbox URL `https://boplo.app/flight/billing/apple/notifications` |
| `nodejs_compat` | Cloudflare Pages → Settings → Functions → Compatibility flags | Required or receipt checks return 503. The rest of the desk does not need it. |
| Migration `migrations/0012_apple.sql` | D1 console | Optional. The server also creates the Apple table and the `apple_subject` column on first use. |
| App Review demo account | App Store Connect review notes | A real Boplo email and password, plus what to tap: logbook, record a flight, simulator. |
| `support@boplo.app` | A mailbox that receives mail, and the Support URL in App Store Connect | Not created by this branch. |
| Small Business Program | App Store Connect | Enrol so the commission is the small-business rate. |

Google sign-in inside the WebView will still be refused by Google (`disallowed_useragent`). The button stays, because Google stays as a sign-in method. Sign in with Apple is the one that works in the shell. Error 1004 from `ASAuthorizationController` means the Developer capability is not on yet. The magic link opens in Mail and, until an Associated Domains file exists, in Safari rather than in the app.

The iOS shell does not open the marketing site. A signed-out launch shows an app sign-in screen (Apple, Google, email). A new account then goes through the existing setup (name, country, licence, hours). A signed-in account whose setup is finished opens the desk. The splash hides when that first screen is painted, instead of waiting out the timer. One `Frame load interrupted` line in the simulator log is a cancelled provisional navigation and is harmless if the desk then loads.

### Why the other approaches lose

| Approach | Why it is not the one to build |
|---|---|
| Stay a PWA only | Already works. iOS web push works only after Add to Home Screen. It is not an App Store listing, which is the thing he asked for. |
| Swift, React Native or Flutter rewrite | Throws away the desk, the simulator and the Functions. A second app would drift from boplo.app. |
| Another WebView wrapper (PWABuilder and the like) | Same review risk, less room to add push and background location. |
| Bundle `dist/` in the app now | Breaks sign-in and every save, and would put the GPL jet models inside the App Store binary. See licences. |

## What was checked in the repo

The brief said to verify. These are the facts the plan depends on.

**The website is the app.** Cloudflare Pages serves `dist/` with no build step (`package.json` has tests and `wrangler pages dev`, not a bundler). Functions live in `functions/`. `dist/_routes.json` sends `/api/*`, `/auth/*`, `/darts/*`, `/flight/*` and `/move/*` to Functions.

**Identity is shared and cookie-based.** `functions/auth/[[path]].js` forwards to `functions/darts/[[path]].js`. Users are `darts_users`. The session row is `darts_sessions`. The cookie is set in `cookie()`:

`boplo_session=<token>; Path=/; HttpOnly; SameSite=Lax; Secure`

No `Domain` attribute, so it is host-only for `boplo.app`. The session row in `darts_sessions` expires 30 days after sign-in. The cookie `Max-Age` is passed that same millisecond count, so the cookie outlives the server session. The server is what actually ends the login. The browser posts to `POST /auth/auth/email`. The link in the email is `https://boplo.app/auth/verify?token=…` (15 minutes, one use). Google starts at `/auth/auth/google` and the code sends Google this redirect, not the path named in `docs/FLIGHT_SETUP.md`:

`https://boplo.app/auth/google/callback`

`docs/FLIGHT_SETUP.md` still says `/auth/auth/google/callback`, and it still says Flight checkout is not enabled. Both are stale. Do not “fix” the Google console from that file.

**The flight API refuses other origins.** In `functions/flight/[[path]].js`, every non-GET except the webhook, cron and a couple of public GETs does this:

`Origin` must equal the request’s own origin, or the response is 403. There is no `Access-Control-Allow-Origin`. The browser calls `/flight/*` with same-origin `fetch` and the cookie. A WebView on `capacitor://localhost` would fail that check even if the cookie could be sent. `SameSite=Lax` would not send the cookie on that cross-site `fetch` anyway.

**Payments, unchanged.** `functions/lib/billing.js` pins Stripe API `2024-06-20`. Advanced is `boplo_flight_advanced_monthly` at 1199 cents and `boplo_flight_advanced_yearly` at 9999 cents. There is no trial (`trial_period_days` is forced off). The app mounts Stripe’s Payment Element from `https://js.stripe.com/v3/` inside Boplo’s own sheet. Schools are different: `functions/lib/schools.js` uses hosted Stripe Checkout, $999/year (`99900`) and $1,999/year (`199900`), and the browser navigates to Stripe’s page. Card numbers never touch Boplo. `OWNER_EMAILS` is treated as Advanced with no subscription. If the Stripe secret and publishable keys are both missing, `effectivePlan` returns Advanced for everyone, so a keyless environment does not prove the live mode. Whether production is live or test is a Cloudflare setting. This repo cannot see it.

**Account deletion exists.** Profile → Delete my account posts `{ confirm: "DELETE" }` to `POST /flight/account/delete`, which cancels the Stripe subscription, deletes the flight rows and the user, and clears the cookie. That matters for Guideline 5.1.1(v). It does not yet revoke a Sign in with Apple token, because that sign-in does not exist.

**Maps and the simulator.** The logbook map is MapLibre GL 4.7.1 from unpkg and OpenFreeMap tiles (`dist/flight-map.js`). The simulator is Cesium 1.144.0 from jsDelivr (`dist/flight-sim.js`). Photorealistic 3D Tiles use `Cesium.createGooglePhotorealistic3DTileset` with `onlyUsingWithGoogleGeocoder: true`. The Google browser key is returned by `GET /flight/simkey` **before** the sign-in check, so anyone who can request that URL receives it. Restriction by HTTP referrer is the real control. Credits for Google, EOX, AWS terrain and the FlightGear models are added in the sim.

**Jets are GPL v2.** `tools/aircraft/README.md` and `dist/terms.html` say the converted GLBs in `dist/aircraft-models/` are GPL v2, source on request. They are not copied into `ios/`.

**Offline and push, on the web.** `dist/sw.js` is network-first for same-origin GETs and refuses to cache `/flight`, `/auth`, `/api`, `/darts` and `/move`. Push is Web Push (VAPID) implemented in `functions/lib/push.js` and shown from the service worker. There is no APNs code.

**Device features the desk already calls.** GPS recording uses `navigator.geolocation.watchPosition` plus a screen wake lock (`dist/flight-app.js`). The simulator can request device orientation. Speech recognition is `webkitSpeechRecognition`. Speech synthesis is used for radio, chair-fly and Ask Boplo. Logbook scan uses an `input type="file" accept="image/*"`. None of this has been run inside this WebView. There is no Mac in this environment.

**Privacy copy.** `dist/privacy.html` (updated 29 October 2026) lists account, training records, billing, a session cookie, Ask Boplo (Anthropic), debrief text (Gemini), weather (NOAA), maps, and school sharing. It says Boplo is for people 16 and over, and that under-18s need a parent’s permission to buy. There is no age check in the flight or community code. Community posts can be reported (auto-hide at three reports), blocked, and masked for profanity (`functions/lib/community.js`). Students nearby and direct messages exist.

**Design tokens used for the shell.** `--night: #020611` and `--electric: #0A62FF` in `dist/flight-app.css`. The PWA manifest name is “Boplo Flight”, short name “Boplo”, `background_color` and `theme_color` `#020611`. The iOS home-screen name is Boplo, matching the short name and `apple-mobile-web-app-title`. The App Store name can still be Boplo Flight. That name is set in App Store Connect, not in the binary.

**Other products in this repo, left as they are.** Scout (`functions/api/`), Darts (`functions/darts/` and the shared user table), Wingman (`dist/wingman.js`), Move (`functions/move/`). They are not part of the iOS app. The shell’s start URL is the flight desk, so a reviewer who opens the app does not land in those products. Do not delete them as part of the App Store work.

## Guideline 4.2, minimum functionality

Read from Apple’s App Review Guidelines on 3 November 2026:

> Your app should include features, content, and UI that elevate it beyond a repackaged website. If your app is not particularly useful, unique, or “app-like,” it doesn’t belong on the App Store.

A WebView is allowed. A WebView that only shows boplo.app is the case 4.2 is aimed at. Packaging the PWA does not, by itself, clear it. Apple does not publish a checklist that guarantees acceptance.

What usually moves a wrapper across the line, and how it maps onto this product:

| Native capability | Why it is more than the website | State |
|---|---|---|
| Background GPS for the flight recorder | iOS will not keep a website’s `watchPosition` running with the screen locked. A real lesson log needs `CLLocationManager`, the location background mode, and a clear purpose string. | Built in `BoploPlugin`. Nearest-ten-metres accuracy, 15 metre filter, only while a recording is running. Not yet tried on a phone. |
| Push via APNs | Web Push in this codebase needs a service worker. iOS delivers web push to a Home Screen web app, not to a WKWebView. | Built. The iOS shell registers a device token at `POST /flight/push/apns`. Sends wait for the APNs key in Cloudflare. Web push is unchanged. |
| Offline desk | The service worker caches the shell for Safari. WKWebView support for that worker is unreliable, and this binary does not contain the desk. A reviewer who opens the app in airplane mode will see the navy error page. | The error page exists. Real offline use is later work, and it has to keep the cookie problem in mind. |
| Sign in with Apple | Required for a different guideline (below), and it is a native sign-in sheet rather than a Google page inside the WebView. | Built. The button is iOS-only. The route is `POST /auth/auth/apple`. It still needs the capability on the App ID before Xcode will sign it. |
| Camera logbook scan, microphone, motion | The website already does these. They help only if they work in the WebView and the purpose strings match. Strings are in the binary. Behaviour is untested. | Strings only. |

Also relevant, from the same page:

- **4.2.2** The app should not be mainly marketing. The start URL is the flight desk, not the landing page. Keep it that way.
- **4.2.3(ii)** If the first launch downloads a large resource, say how big it is and ask first. Cesium, from jsDelivr, is that risk once someone opens the simulator. Self-hosting it does not remove the download. It does remove a third-party CDN from the conversation. Do not change the script URLs until that work is intentional.
- **2.5.2** The app must not download native code. JavaScript that WKWebView runs as part of your own site is the ordinary WebView case, and many apps ship that way. It is still the first thing a reviewer can ask about. Keeping Cesium and MapLibre on `boplo.app` rather than unpkg and jsDelivr is the cleaner story. It is not done here, because it would change the website.

Ship at least background recording and APNs, plus Sign in with Apple if Google sign-in stays, before the first review. A build that is only this branch’s WebView should be expected to come back under 4.2.

## Payments

**Chosen on 3 November 2026:** In-App Purchase for Advanced worldwide, at the same prices, Stripe unchanged on the website and for schools. The options below are the reasoning. They are not still open.

Advanced is a digital subscription used inside the app (unlimited logbook, study, the simulator, and the rest listed in the billing code). Apple’s default rule is In-App Purchase. The guidelines were read on 3 November 2026. They have already changed once because of a US court, so read them again on the day of submission.

**What the guidelines say now**

- **3.1.1** Digital content and subscriptions use In-App Purchase.
- **3.1.1(a)** On the **United States storefront**, apps may include buttons, external links or other calls to action for a purchase method other than In-App Purchase. No entitlement is required for that storefront. In every other storefront, those links are not allowed unless a regional entitlement says so. The EU, Japan and Brazil have their own entitlements, with Apple’s disclosure UI and a commission Apple publishes on those pages. This plan does not quote a percentage for those commissions. Confirm the current figure when you apply.
- **3.1.3(b)** An app that also exists on the web may unlock a subscription the person already bought on the web, **provided the same item is available as an In-App Purchase**.
- **3.1.3(c)** An app sold only to organisations, for their staff or students, may use a purchase method other than In-App Purchase. Boplo is also sold to individual students, so the whole app does not qualify. The School plan can stay a website purchase. The consumer Advanced plan cannot hide behind the school plan.
- **3.1.3(a)** Reader apps are magazines, newspapers, books, audio, music and video. Boplo is not one of them.
- Apple Pay inside the Payment Element is a card wallet. It is not In-App Purchase, and it does not satisfy 3.1.1.

Prices in code today, and they should stay the prices until Gianni decides otherwise: Advanced **$11.99 a month** or **$99.99 a year**, School **$999 a year**, School Plus **$1,999 a year**. No free trial. The 14-day refund is Boplo’s own policy on the web (`dist/refunds.html`). Apple refunds for In-App Purchase are requested from Apple, not from that page.

### Options that were considered

The choice is option A, worldwide, at the same prices. B and C are closed. None of this changes the website’s Stripe form.

**A. In-App Purchase for Advanced, Stripe stays on the website.** This is the one that can be sold outside the US. Add two auto-renewable products matching the current prices, yearly first, because the product already pushes yearly. When a purchase completes, the server marks the same `flight_billing` row the Stripe webhook marks, or a sibling row the app already understands. People who already pay Stripe keep access under 3.1.3(b), because the IAP exists too. Apple’s commission (the standard rate, or the Small Business Program rate if the account is eligible) comes out of the same sticker price unless Gianni chooses to charge more on iOS. School checkout stays on `boplo.app` and should not be a button inside the iOS app except on a storefront where an external link is allowed. A student who already has a school seat signs in and is Advanced, which the code already does.

**B. United States storefront only, keep the Stripe sheet.** 3.1.1(a) allows that sheet on the US storefront with no entitlement. The same binary must not offer it on any other storefront. The US is the market he asked to build first. UK and EU students would not be able to download the app from their own storefronts. One billing system, no second price, promo codes keep working. This is a storefront decision, not a code change to make in advance.

**C. Remove every upgrade button from the iOS app and only unlock people who paid on the web.** This does not work under 3.1.3(b) unless Advanced is also an In-App Purchase. A line that says “subscribe on the website” is a call to action, and outside the US it is the thing 3.1.1(a) forbids.

Stripe promotion codes, the customer portal and the school Checkout page do not transfer to In-App Purchase. Apple has its own offer codes. Owner accounts in `OWNER_EMAILS` can keep their free Advanced. That is server-side and should not become a button.

Do not change the Payment Element, the school Checkout redirect, or the prices until one of A or B is chosen.

## Sign in with Apple

Guideline **4.8**, same page, same day: an app that uses a third-party login (the guidelines name Google Sign-In) to create the primary account must also offer a login that only collects name and email, lets the person hide their email, and does not use their activity in the app for ads. Sign in with Apple is the login that meets that test.

Boplo offers Google and an email magic link. The magic link is Boplo’s own system. It satisfies 4.8 only if it is the **only** login. Offering it next to Google does not remove the requirement.

Two acceptable choices:

1. Add Sign in with Apple beside Google and the magic link. The native sheet returns an identity token. A new route, next to the Google callback, verifies it with Apple, upserts `darts_users`, and sets the same `boplo_session` cookie. Account deletion must also revoke the Apple token. Private-relay addresses (`…@privaterelay.appleid.com`) have to be stored as the user’s email.
2. Remove Google sign-in from the iOS app only, and keep the magic link. 4.8 then does not apply. The website can keep Google.

Either way, the current Google button will not survive a WebView. Google blocks OAuth in embedded web views (`disallowed_useragent`). The button in `dist/flight-app.js` is a normal link to `/auth/auth/google`, which sends the WebView to `accounts.google.com`. Expect that to fail on the first simulator run.

The magic link fails for a different reason. Mail opens `https://boplo.app/auth/verify?token=…` in Safari. The `Set-Cookie` lands in Safari. The WebView never sees it. `ios/App/App/SceneDelegate.swift` already forwards universal links into Capacitor, and `dist/flight-native.js` will navigate the WebView to a `https://boplo.app` URL the system hands back. That does nothing until:

- this branch is what boplo.app is serving (the script is on the desk page), and
- the App ID has the Associated Domains capability, and
- `https://boplo.app/.well-known/apple-app-site-association` lists the Team ID and `app.boplo.flight`, with paths covering `/auth/verify`, `/auth/google/callback` and `/flight-app.html`.

Do not upload a placeholder association file. The Team ID does not exist until he enrols. The `boplo://` scheme is registered so a later redirect can use it. No email sends that scheme today.

## Privacy manifest and data labels

`ios/App/App/PrivacyInfo.xcprivacy` is in the app target. Tracking is off. There are no tracking domains. It declares the data the desk actually collects, matching `dist/privacy.html` and the code:

| Manifest type | Linked to the user | Purpose | Where it comes from |
|---|---|---|---|
| Email address | Yes | App functionality | Sign-in |
| Name | Yes | App functionality | Google profile or the desk |
| User ID | Yes | App functionality | `darts_users.id` |
| Precise location | Yes | App functionality | GPS tracks on flights |
| Coarse location | No | Analytics | Country on the cookieless visit counter. The privacy page says the IP is not stored. |
| Photos or videos | Yes | App functionality | Paper logbook scan |
| Audio | No | App functionality | Speech recognition. Boplo stores the text, not a recording. The browser’s speech service may process the audio. |
| Other user content | Yes | App functionality | Notes, debriefs, study, messages |
| Purchase history | Yes | App functionality | Plan and subscription status. Not the card number. |
| Product interaction | No | Analytics | Cookieless page counts |

Card numbers are not declared. Apple’s definition says payment data entered through a payment service the developer never receives is not collected. Stripe’s Payment Element works that way in this code. Say the same thing in App Store Connect. If a reviewer disagrees because the form is inside the WebView, add Payment Info then. Do not add it early and over-declare.

The nutrition labels in App Store Connect are a separate form. Use the same answers. Privacy policy URL: `https://boplo.app/privacy.html`. It is already linked inside the desk.

`NSPrivacyAccessedAPITypes` is empty. The app target’s Swift does not call the required-reason APIs. Capacitor’s package brings its own manifest for the SDK.

Permission strings already in `Info.plist` have to stay specific. They describe the logbook recorder, the logbook scan, radio and the spoken checkride, and tilt-to-steer. Vague strings are a review rejection on their own.

**Age rating and children.** The privacy page says 16+. The code does not check age. Community has public questions and private messages. Guideline 1.2 expects a filter, a report path, a block, and a person who actually looks at reports. The filter, report (hide at three) and block exist. An owner report list exists in the API. There is no in-app age gate, and the brief’s note that under-18s should not get “Students nearby” or DMs was never built. Answer the age-rating questionnaire from that, not from hope. Messaging between users is the item most likely to land on 16+ or 17+.

**5.1.1(ix).** Apple lists air travel among regulated fields that should be submitted by the legal entity that provides the service, not by an individual developer. Boplo is a training logbook and study tool. The product copy says it does not clear anyone to fly, does not brief a real flight, and is not an approved training device. A reviewer can still file it under air travel. Gianni is a sole trader trading as BOPLO. Whether he enrols the developer account as an individual or an organisation is his decision, and this guideline is the reason to think about it before paying Apple.

## Third-party licences

**GPL v2 FlightGear jets.** The GLBs are served by the website and credited in the simulator and the terms, with source on request. That is a web distribution and it can stay that way. Do not copy `dist/aircraft-models/` into the iOS target. The App Store terms restrict redistribution in a way that conflicts with the GPL’s requirement that recipients can modify and pass the work on. Apps have been pulled for shipping GPL inside the binary. This shell’s `webDir` is `native/www` only, so a `cap sync` cannot accidentally bundle the models. If a later change sets `webDir` to `dist/`, stop and split the models out first.

**Cesium** is Apache-2.0. **MapLibre GL JS** is BSD-3-Clause. Both are loaded from public CDNs at runtime, not compiled into the app. Keep their notices if you later vendor the files onto `boplo.app`.

**Google Map Tiles.** The simulator requests Photorealistic 3D Tiles and, in the fast mode, Google’s 2D satellite tiles. The Maps Platform terms (read with the Map Tiles policies) forbid scraping tiles, tracing roads or buildings out of the imagery, and building a product that recreates Google Maps’ navigation. Runways in this app come from OurAirports and from OpenStreetMap via Overpass, not from tracing Google imagery. Attribution is drawn in the sim’s credit line. Google’s FAQ lists WKWebView as a supported place for the Maps JavaScript API. The tiles sit under the same Maps Platform agreement. Two practical checks on a device:

- The WebView must send a referrer of `https://boplo.app/…`, or a referrer-restricted key will refuse the tiles. `GET /flight/simkey` hands the key to any caller, so the referrer restriction is doing the real work.
- The credit line must stay visible. `onlyUsingWithGoogleGeocoder: true` must stay. That flag is Cesium’s acknowledgement of Google’s condition.

This is a terms question for Gianni to be comfortable with, not a code change. A flight simulator draped on Google’s 3D city is a long way from a navigation app, and the product is explicitly not a cockpit navigator. If Google or a lawyer disagrees, the sim already has an EOX Sentinel-2 fallback when the key is missing.

**OurAirports** is public domain. **EOX Sentinel-2 cloudless 2016/2017** is credited as CC BY 4.0 in the sim. Later EOX years are non-commercial and are not what the code requests. **AWS terrain tiles** are credited in the same line.

## Cookies, CORS and the WebView

This is the constraint that picked `server.url`.

| Piece | What the code does | What a bundled origin would do |
|---|---|---|
| Cookie | Host-only, `Secure`, `HttpOnly`, `SameSite=Lax`. The server session lasts 30 days. | Not stored for `boplo.app` by a page on `capacitor://localhost`, and not sent on a cross-site `fetch` |
| `POST /flight/*` | 403 unless `Origin` is the function’s origin | 403 |
| `GET /flight/workspace` | Needs the cookie | 401 |
| Stripe.js and 3-D Secure | Loaded and confirmed in the page | Iframes may work, but a bank redirect that leaves the WebView drops the user in Safari |
| School Checkout and the billing portal | `location.href` to Stripe, return URL back to `/flight-app.html` | Return URL opens Safari unless a universal link brings it back |
| Service worker | Registered on `https:` only | Not registered for `capacitor://` |
| Google OAuth | Top-level navigation to Google | Blocked in a WebView even when the origin is `boplo.app` |

`allowNavigation` in `capacitor.config.json` lets Google, Stripe, the CDNs and AWS stay inside the WebView instead of being kicked out to Safari. That is necessary for the Stripe sheet and for a future OAuth attempt. It does not make Google accept the WebView.

`dist/flight-native.js` is the only website change. It runs only when `Capacitor.isNativePlatform()` is true. In Safari, Chrome and the installed PWA the bridge is absent, so the file returns. It does not touch fetch, cookies, prices or the sign-in form. After a deploy, browsers download a few hundred bytes and nothing else changes.

Merging this branch to the branch Cloudflare publishes will deploy that script. It will not submit an app, and it will not change a browser session.

## Checklist Gianni does himself

Apple will not accept these steps from a cloud agent, and this repo must not collect the passwords or the `.p8` key.

1. Enrol in the Apple Developer Program as an **Individual**, with his own Apple ID. The seller name on the store will be his personal name. There is no D-U-N-S step. Cost is Apple’s annual fee. Guideline 5.1.1(ix) still mentions air travel and individual developers. The app is a training logbook, not an operator. If Review rejects it on that point, the remedy is an organisation account later.
2. On a Mac, install Xcode, clone this branch, and follow `ios/README.md` until the simulator shows the desk.
3. In the Apple Developer account, register the App ID `app.boplo.flight`. Turn on Sign in with Apple and Push Notifications. The send path and the sign-in route are already in this branch. Associated Domains can wait until the Team ID exists and the magic link should open the app.
4. Create the iOS distribution certificate and a provisioning profile. Xcode’s automatic signing can do this once the Team is selected. Store the results in Keychain on that Mac, not in git.
5. Create the app in App Store Connect. Name: **Boplo Flight**. Bundle id: `app.boplo.flight`. Primary language English. Privacy policy URL `https://boplo.app/privacy.html`. Support URL a page on boplo.app, or `mailto:support@boplo.app` if Connect still accepts a mail link. The support address itself still needs a mailbox. Category: Education is the closest fit. Do not pick Navigation.
6. Age rating questionnaire, from the real community features. Export compliance is already answered in the plist (`ITSAppUsesNonExemptEncryption` false).
7. Fill the nutrition labels from the table above.
8. Screenshots on the required iPhone sizes (6.7-inch and 6.5-inch at the time of writing; confirm the current set in Connect). Use the real example desk, `flight-app.html?preview=1`, not mockups. The target is iPhone only, so no iPad screenshots.
9. App Review notes: a demo account email and password, the steps to open the logbook, the recorder and the simulator, and a sentence that the app is a training logbook, not a flight-planning or navigation tool, and not an approved training device. Mention `?preview=1` only as a backup. Reviewers prefer a real account.
10. Host the Apple App Site Association file once the Team ID exists, then turn on Associated Domains and try a magic link on a device. The link must open the app, not Safari.
11. Create the subscription group in App Store Connect. Yearly product `app.boplo.flight.advanced.yearly` at US $99.99. Monthly product `app.boplo.flight.advanced.monthly` at US $11.99. Put yearly first. Add a sandbox tester. Point Server Notifications V2 at `https://boplo.app/flight/billing/apple/notifications`. On Cloudflare, set `nodejs_compat` and the APNs secrets from the table above. The app is sold worldwide. Stripe stays on the website.
12. Archive in Xcode, upload to TestFlight, install on his own iPhone, and only then submit. Test on that phone, with the screen locked, the things this plan says are untested: the recorder, the simulator frame rate, the microphone, Google or Apple sign-in, the Stripe sheet or the IAP, and a failed network.

Rotate the Cloudflare deploy hook if it was ever pasted into a chat. That is independent of Apple, and the brief already flagged it. Do not paste a new hook into a chat.

## Decisions

Recorded at the top of this file, on 3 November 2026. They are no longer open. What is still missing is the accounts and keys in that table, not a product choice.

## What this branch deliberately does not do

- No App Store Connect record, no certificate, no TestFlight, no production deploy triggered from here.
- No change to website prices, the Stripe Payment Element, trials, promo codes, or school Checkout on the website.
- No change to Google sign-in or the email magic link for browsers.
- No RevenueCat. Receipts are checked in Pages Functions.
- No copy of the GPL models into the app binary.
- No deletion of Scout, Darts, Wingman or Move.
- Merging deploys the website changes (the iOS-only gates, the Apple sign-in route, the receipt route). It does not submit an app. The simulator keeps loading production until that deploy, so the new buttons appear in the app only after boplo.app is serving this branch.
