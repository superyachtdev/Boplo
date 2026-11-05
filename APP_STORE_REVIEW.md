# Boplo Flight: App Store review check

Checked on 5 November 2026 against the current App Store Review Guidelines, for the native app in
`ios-native/`. Apple changes the guidelines a few times a year (the AI rule below arrived in November 2025),
so reread them on submission day. "Done" means it's in the code. "You" means a step in App Store Connect,
Cloudflare or another account that only Gianni can do.

## Status by guideline

| Guideline | What Apple checks | Status |
|---|---|---|
| 1.2 User-generated content | Filter, report, block, contact info, agreement to rules | **Done.** Q&A has a language filter, Report (three reports hide a post), and now **Block** on every question and answer. Students can also report a message from school staff; reports are emailed to the first address in `OWNER_EMAILS`. Posting shows the community rules, and the Terms have a "Community rules" section with zero tolerance and 24-hour handling. **You:** check reports daily (owner view) and actually act within 24 hours. |
| 1.4.1 Physical harm | Apps that could cause harm if wrong | **Done.** Recorder, weather, preflight and nav log each say they're training aids, not briefings or navigation. Ask refuses go/no-go decisions. |
| 2.1 Completeness | No crashes, placeholders or dead ends; demo account | **You:** set `REVIEW_EMAIL` and `REVIEW_CODE` in Cloudflare, give them in the review notes, and give that account Advanced through `OWNER_EMAILS` so the reviewer can see everything. Test the build on a real device from TestFlight first. |
| 2.3 Metadata | Screenshots of the real app, accurate description | **You:** screenshots from the native app (Desk with the sky hero, Logbook, Study, Fly, the milestone pass). No mention of web prices or other platforms. |
| 2.5.4 Background modes | Background location only for a real feature | **Done.** Location runs only while a flight the user started is recording, with the blue indicator. Explain it in the review notes (text below). |
| 3.1.1 In-App Purchase | Digital subscriptions bought in the app use IAP | **Done.** Advanced is StoreKit 2 only in the app; no Stripe, no web checkout links. The School screen no longer mentions where school plans are bought. |
| 3.1.2 Subscriptions | Price, period, auto-renew terms, Terms and Privacy links, Restore | **Done** on the plans screen. **You:** in App Store Connect add a Terms of Use (EULA) link (`https://boplo.app/terms.html`) in the description or the EULA field, and fill in both products' display names and descriptions. |
| 3.1.3(b), (c) | Web purchases and organisation plans | **Done.** People who paid on the web keep access (Advanced is also an IAP). School seats unlock through a school code with no purchase in the app. |
| 4.2 Minimum functionality | Not a website wrapper | **Done.** Everything is native except the 3D simulator, which is one feature among many. |
| 4.8 Sign in with Apple | Required when other third-party logins are offered | **Done.** Sign in with Apple plus Boplo's own email code; Google is not offered in the app. |
| 5.1.1(i) Privacy policy | Linked in the app and in App Store Connect | **Done.** Linked on sign-in, the plans screen and You. Updated today with an "In the iOS app" section, Apple and Sentry. |
| 5.1.1(ii) Permissions | Clear purpose strings, ask in context | **Done.** Location, microphone and speech strings describe the feature. Each is asked for only when the feature is used. |
| 5.1.1(v) Account deletion | Delete from inside the app; revoke Sign in with Apple tokens | **Done.** You → Delete account. People who signed in with Apple confirm with Apple once and the server revokes Boplo's tokens. **You:** add `APPLE_SIWA_KEY_ID` and `APPLE_SIWA_PRIVATE_KEY`, or deletion still works but skips the revocation. |
| **5.1.2(i) Third-party AI** | Disclose and get explicit permission before personal data goes to an external AI | **Done today.** The first time Ask Boplo, the checkride or an explanation is used, a full-screen sheet lists exactly what is sent and to whom (Anthropic, Google as fallback) with Allow / Not now. Nothing is sent before Allow. You → AI features switches it off. Enforced in the network layer, so no screen can skip it. |
| 5.1.1(ix) Regulated fields | Air travel apps from a legal entity | **Risk to know about.** Boplo is a study and logbook tool, not an air travel service, and says so. If a reviewer files it under air travel, reply explaining that it books nothing and clears no one to fly. |
| Privacy manifest | `PrivacyInfo.xcprivacy` with required-reason APIs | **Done today** for the app and the widget extension: no tracking, UserDefaults reasons `CA92.1` and `1C8F.1`, data types below. |
| Encryption export | `ITSAppUsesNonExemptEncryption` | **Done.** Set to NO (standard HTTPS only). |

## App Privacy answers (App Store Connect)

Data not used for tracking. All "linked to the user", all for App Functionality:

- **Contact info:** email address, name
- **Identifiers:** user ID
- **Location:** precise location (flight tracks you record)
- **User content:** other user content (logbook notes, debriefs, study progress, Q&A posts, messages with your school)
- **Purchases:** purchase history (subscription status only)

Not collected by the app: payment details (Apple handles them), contacts, photos, audio recordings
(speech becomes text on the phone), browsing history, diagnostics, advertising data.

## Age rating

Answer the questionnaire from the features: unrestricted user-generated content (Q&A) and messaging
with school staff, no age gate. The Terms say 16+. Pick the rating the questionnaire gives for user
content and messaging, and keep the Terms' minimum age consistent with it.

## App Review notes (paste into App Store Connect)

> Boplo Flight is a study companion and logbook for student pilots. It does not book flights, give
> official briefings or clear anyone to fly.
>
> **Sign-in for review:** tap "Continue with email", enter `<REVIEW_EMAIL>`, then enter the code
> `<REVIEW_CODE>`. No email is sent for this account. It has the Advanced plan so every feature is open.
> Sign in with Apple also works.
>
> **Background location:** Fly → Start recording records a GPS track of a training flight, the way a
> paper logbook records the route. It keeps recording with the screen locked until the pilot taps Stop,
> and iOS shows the blue location indicator throughout. Location is never used at any other time.
>
> **AI:** Ask Boplo, the mock checkride and question explanations use Anthropic's Claude (Google Gemini
> as a fallback). The app asks for permission, listing what is shared, before anything is sent
> (guideline 5.1.2(i)), and You → AI features turns it off.
>
> **Community:** Q&A posts can be reported and authors blocked from each post. Three reports hide a
> post automatically; reports are reviewed within 24 hours.
>
> **Subscriptions:** Advanced (monthly and yearly) is an auto-renewable In-App Purchase. Schools buy
> seats for their students outside the app (guideline 3.1.3(c)); students join with a school code.

## Before you press Submit

1. Cloudflare: `REVIEW_EMAIL`, `REVIEW_CODE`, `SENTRY_DSN`; add the review email to `OWNER_EMAILS`.
2. App Store Connect: both subscription products approved with display names, descriptions and a
   review screenshot; EULA link; privacy policy URL; App Privacy answers above; age rating;
   review notes above.
3. Xcode: archive with both targets signed by your team (App Groups `group.app.boplo.flight` on both).
   Bump the version and build number each upload.
4. TestFlight on your own phone: sign in with Apple and with the review account, buy and restore a
   subscription in the sandbox, record a short flight with the screen locked, add both widgets, use Ask
   (the permission sheet should appear once), post and block in Q&A, delete a test account.
