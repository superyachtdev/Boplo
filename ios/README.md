# Run Boplo Flight in the iOS simulator

The Xcode project is a Capacitor 8 shell. Bundle id `app.boplo.flight`. Home-screen name **Boplo**. It is iPhone only. Nothing here is submitted to Apple.

The WebView opens `https://boplo.app/flight-app.html`. That is the live site, so the session cookie and the flight API keep working. The iOS sign-in screen is in this branch’s website code. It shows up in the simulator after this branch is what boplo.app serves. Until then, the simulator shows today’s production desk. This repository does not deploy that.

## What you need

- A Mac.
- Xcode current enough for Capacitor 8.6. That release is tested against the iOS 26 simulator.
- Node 22 and npm.
- This branch: `cursor/ios-app-store-plan-771d`.

A paid Apple Developer account is not required for the simulator steps below. It is required before Sign in with Apple, push, and a device build will sign. Enrol as an Individual. The seller name will be your personal name.

## Steps

In Terminal, from the repo root:

```bash
git fetch origin
git checkout cursor/ios-app-store-plan-771d
npm install
npm run ios:sync
npx cap open ios
```

`npm run ios:sync` copies the small local fallback page into the Xcode project and links the native plugin. Those generated files are gitignored. The first open downloads Capacitor’s Swift package, so the Mac needs a network.

In Xcode:

1. If the project did not open, open `ios/App/App.xcodeproj`.
2. Select the **App** target. Set the destination to an **iPhone** simulator. There is no iPad target.
3. Signing & Capabilities: leave Team empty for a plain simulator run of the shell. If Xcode refuses to build because of Sign in with Apple or Push, choose your Apple ID as the Team. Those two capabilities need the paid program and the App ID `app.boplo.flight` before a signed build succeeds. The entitlements file is `ios/App/App/App.entitlements`.
4. Press Run.

You should see a night-navy splash (`#020611`) and the glossy blue “b”, then whatever boplo.app is currently serving. If boplo.app cannot be reached, the screen says “Can’t reach Boplo”.

A single console line `Frame load interrupted` is WebKit cancelling one provisional navigation. It showed up once on the first run and the desk still loaded. It is harmless. The start URL no longer includes `#overview`, which was one way to trip that cancellation.

Tapping Sign in with Apple before the Developer capability is on does not show a system error code. Cancel does nothing. Any other Apple sign-in failure shows “Apple sign-in isn’t available yet. Use email for now.” The ATC radio pill stays off that sign-in screen.

The splash stays until the first screen is painted, then the page calls `SplashScreen.hide()`. If that call never arrives, it still hides itself after 12 seconds. Rebuild after `npm run ios:sync` so the shell picks up that timing. The hide call itself is in the website, so it runs once this branch is deployed.

## What you should see once this branch is live on boplo.app

Not signed in: a navy sign-in screen with Sign in with Apple, Google, and email. No marketing page, no “back to boplo.app”.

New account, setup not finished: Boplo’s existing setup (name, country, licence, hours), then the desk.

Already signed in, setup finished: the desk, straight away.

## See the sign-in screen again

The session cookie lives in the simulator’s WebView.

- Sign out from the account menu. That returns to the sign-in screen.
- Or delete the app (long-press the icon on the home screen, Remove App) and run it again from Xcode. That clears the cookie.

## See the setup screens again

Those screens are the account’s saved setup, not a separate intro. They show while setup is unfinished.

- Sign in with an email that has never finished setup.
- Or, on a finished account, delete the account from Profile and sign up again.

There is no extra “reset onboarding” switch.

## After this branch is deployed

Sign in shows **Sign in with Apple**, Google, and the email link. Plan & billing shows **Subscribe** and **Restore purchases**, not the Stripe card form. School setup is only “join with a code”. Students nearby is gone. Record a flight, then lock the simulator (Device → Lock). The track keeps updating. Unlock and stop the recording.

Google’s button is still there. Google blocks that sign-in inside a WebView, so use Sign in with Apple. The email link opens in Mail and, until Associated Domains is set up, in Safari rather than in the app.

App Store products, once created in App Store Connect:

- `app.boplo.flight.advanced.yearly` — US $99.99
- `app.boplo.flight.advanced.monthly` — US $11.99

Until those products exist, Subscribe reports that the plan isn’t available yet. The receipt check also needs the Cloudflare flag `nodejs_compat`. The keys and the notification URL are listed in `APP_STORE_PLAN.md`.

## Do not leave a local URL in the committed config

To point the simulator at a Pages preview of this branch before production, change `server.url` in `capacitor.config.json`, run `npm run ios:sync`, and run again. Use an `https` preview URL. Do not commit that change, and do not turn on cleartext HTTP.
