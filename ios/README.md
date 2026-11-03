# Run Boplo Flight in the iOS simulator

The Xcode project is a Capacitor 8 shell. Bundle id `app.boplo.flight`. Home-screen name **Boplo**. It is iPhone only. Nothing here is submitted to Apple.

The WebView opens `https://boplo.app/flight-app.html#overview`. That is the live site, so the session cookie and the flight API keep working. The new iOS screens (Sign in with Apple, App Store subscribe, Restore purchases, hidden school checkout, hidden direct messages) are in this branch’s website code. They show up in the simulator after this branch is what boplo.app serves. Until then, the simulator shows today’s production desk inside the new shell. This repository does not deploy that.

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

You should see a night-navy splash (`#020611`) and the glossy blue “b”, then the flight desk. If boplo.app cannot be reached, the screen says “Can’t reach Boplo”.

## After this branch is deployed

Sign in shows **Sign in with Apple**, Google, and the email link. Plan & billing shows **Subscribe** and **Restore purchases**, not the Stripe card form. School setup is only “join with a code”. Students nearby is gone. Record a flight, then lock the simulator (Device → Lock). The track keeps updating. Unlock and stop the recording.

Google’s button is still there. Google blocks that sign-in inside a WebView, so use Sign in with Apple. The email link opens in Mail and, until Associated Domains is set up, in Safari rather than in the app.

App Store products, once created in App Store Connect:

- `app.boplo.flight.advanced.yearly` — US $99.99
- `app.boplo.flight.advanced.monthly` — US $11.99

Until those products exist, Subscribe reports that the plan isn’t available yet. The receipt check also needs the Cloudflare flag `nodejs_compat`. The keys and the notification URL are listed in `APP_STORE_PLAN.md`.

## Do not leave a local URL in the committed config

To point the simulator at a Pages preview of this branch before production, change `server.url` in `capacitor.config.json`, run `npm run ios:sync`, and run again. Use an `https` preview URL. Do not commit that change, and do not turn on cleartext HTTP.
