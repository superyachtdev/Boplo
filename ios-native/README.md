# Boplo for iPhone (native)

SwiftUI app for iOS 17+. Sign-in, desk, logbook, GPS flight recording, lesson prep and
subscriptions are native; the 3D simulator opens the web simulator full screen.
It talks to the same server as boplo.app, so accounts and logbooks are shared.

## Run it

1. Open `ios-native/BoploFlight.xcodeproj` in Xcode 16 or later.
2. Select the **BoploFlight** target › **Signing & Capabilities**, pick your Team.
   Bundle id is `app.boplo.flight`. Sign in with Apple and Background Modes › Location
   are already declared; if Xcode shows them as missing, add them there.
3. Choose an iPhone simulator and press Run (⌘R).

Purchases in the simulator use `Products.storekit` (no real money). If the plans don't load,
go to Product › Scheme › Edit Scheme › Run › Options and set **StoreKit Configuration** to
`Products.storekit`.

To sign in on the simulator, use **Email me a sign-in code** and type the 6-digit code from the email.

## Before App Store submission

- App Store Connect: create the app with bundle id `app.boplo.flight`, and the subscription
  group "Boplo Advanced" with `app.boplo.flight.advanced.yearly` ($99.99) and
  `app.boplo.flight.advanced.monthly` ($11.99).
- Cloudflare: the Apple keys and `REVIEW_EMAIL` / `REVIEW_CODE` must be set (see `APP_STORE_PLAN.md`).
- Give App Review the review email and code in the review notes.

## Layout

- `API/` networking (cookie session, same endpoints as the web app) and models
- `App/` app state and root navigation
- `Auth/` sign-in and first-run setup
- `Desk/`, `Logbook/`, `Fly/`, `You/` the four tabs
