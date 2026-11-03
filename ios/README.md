# Boplo Flight on iOS

This folder is a Capacitor 8 shell. It does not contain a second copy of the flight desk. The Xcode app opens `https://boplo.app/flight-app.html#overview` inside a WebView. Why that is the right first step, and why it is not yet an App Store submission, is in `APP_STORE_PLAN.md` at the repo root.

Nothing here talks to Apple. There is no certificate, no provisioning profile and no upload.

## What you need

- A Mac with a current Xcode. Capacitor 8.6 is tested against the iOS 26 simulator. An old Xcode will fail when it resolves the Swift package.
- This repo, on the branch that contains `capacitor.config.json`.
- Node 22 (the version this project already uses) and npm.
- The Apple Developer Program is **not** required to run in the simulator. It is required for a device build you can send to TestFlight or the App Store.

## Build and run

In the repo root, on the Mac:

```bash
npm install
npm run ios:sync
npx cap open ios
```

`npm run ios:sync` copies `native/www` into the Xcode project and writes `ios/App/App/capacitor.config.json`. Those generated files are gitignored. Xcode uses Swift Package Manager (there is no CocoaPods install). The first open downloads `capacitor-swift-pm` from GitHub, so the Mac needs a network.

In Xcode:

1. Open the project at `ios/App/App.xcodeproj` if `cap open` did not.
2. Select the **App** target. Signing & Capabilities: choose your Team when you have one. Until then, run on a simulator and leave signing automatic.
3. Pick an iPhone simulator.
4. Press Run.

The simulator should show the night-navy splash, then the live flight desk. The home-screen name is **Boplo**. The bundle id is `app.boplo.flight`.

The shell appends `BoploFlightiOS` to the WebView user agent. Safari on the same Mac does not. If a provider ever blocks that token, remove `appendUserAgent` from `capacitor.config.json` and sync again.

## If the desk does not load

- The WebView is pointed at production. Simulator network must be allowed.
- A failed load shows `native/www/error.html` (navy page, “Can’t reach Boplo”).
- To point the shell at another origin while debugging, change `server.url` in the root `capacitor.config.json`, run `npm run ios:sync`, and run again. Do not commit a non-production URL.
- Removing `server.url` makes the app show only the local fallback page. It will not load the flight desk from disk. The desk is not bundled, on purpose. See the plan.

## What is already set

- App icon: 1024×1024, scaled from `dist/icons/icon-maskable-512.png` (full-bleed navy, glossy blue “b”). iOS applies its own rounded mask, so the pre-rounded `icon-512.png` is not used.
- Splash and launch screen: `#020611`, the same night token as the PWA `theme_color`.
- Permission strings in `Info.plist` for the features the website already uses: location while the app is open, camera, photo library, microphone, speech recognition, and motion. There is no background-location mode. Adding one before a native recorder exists is a good way to be rejected.
- `PrivacyInfo.xcprivacy` is in the app target. The App Store nutrition labels still have to be filled in by hand. The plan lists them.
- `ITSAppUsesNonExemptEncryption` is false. The app uses HTTPS only.
- A `boplo://` URL scheme is registered. Nothing sends those links yet.

## What this Mac project does not do yet

These need the paid developer account and are described in the plan. Do not flip them on just to see if the project still builds.

- Sign in with Apple
- Associated Domains and the `apple-app-site-association` file (magic links currently open in Safari, not in the app)
- Push Notifications (APNs)
- Background location for the flight recorder
- In-app purchase

Google sign-in and the email link are the same pages as the website. Both are likely to fail inside the WebView until the plan’s sign-in work is done. That is expected on the first simulator run. The rest of the desk, including `?preview=1` if you paste it on the URL, does not need an account.
