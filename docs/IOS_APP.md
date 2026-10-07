# HOLLOW Coffee iOS app

A Capacitor app that ships the same React build as the website. It adds iPhone features on top:
order-status push notifications, a native "Add to Apple Wallet" sheet, and haptics.
It is for customers only. Staff keep using the web board.

- App Store name **HOLLOW Coffee**, home-screen name **HOLLOW**, bundle id `com.hollowzulfi.coffee`, team `N2KXQ7MVY3`.
- iPhone only, iOS 15+, portrait, Arabic first (English listing too).
- Built and uploaded to TestFlight by GitHub Actions on a macOS runner. No Mac is needed.

## How it fits together

| Piece | Where |
| --- | --- |
| Capacitor config | `capacitor.config.ts` (web build `dist/client` is copied into the app by `cap sync`) |
| Xcode project | `ios/App` (Swift Package Manager, no CocoaPods) |
| Native Wallet plugin | `HollowWalletPlugin` in `ios/App/App/SceneDelegate.swift`: downloads the signed `.pkpass` and presents `PKAddPassesViewController` |
| Push hooks | `ios/App/App/AppDelegate.swift` + `App.entitlements` (`aps-environment = production`) |
| App mode in the web code | `src/client/lib/native.ts`, `src/client/components/NativeBridge.tsx` |
| API calls from the app | `https://hollow-rewards.hollowzulfi.workers.dev` (override with the `VITE_API_BASE` Actions variable). The Worker allows CORS for `capacitor://localhost` only |
| App push sender | `src/server/push/app-push.ts` (APNs token auth, ES256 JWT) |
| Status messages | `src/server/push/order-notifications.ts` |
| Device tokens + account deletion | `supabase/migrations/20261007000000_app_push_and_account_deletion.sql` |
| Icons and splash | `pnpm app:icons` (placeholder wordmark) or `pnpm app:icons --icon path/to/1024.png` |

In the app:

- The app opens on the menu. `/` and staff routes redirect to `/menu`.
- After the first order the app asks for notification permission.
  Each staff status change (preparing, ready, out for delivery, completed with cups added, cancelled by staff with the reason)
  sends one notification per device. Notifications for the same order replace each other (`apns-collapse-id`).
  Tapping one opens the order.
- Signing out unlinks the device. A device token moves to whoever signed in last on that phone.
- **Delete account** (Account tab, App Store guideline 5.1.1(v)): `POST /api/me/delete` with `{"confirm":"DELETE"}`.
  - It cancels orders that are still `new` and anonymizes all orders (name, phone, car, address, notes).
  - It cancels the loyalty card; the Wallet pass refreshes into its voided state.
  - It removes device tokens and disables the profile.
  - It changes the sign-in email to `deleted-<id>@deleted.invalid` and bans the auth user, so the same email can sign up again.
  - It is refused (`ACTIVE_ORDER`) while an order is being prepared or delivered.
  - Sales records stay, without personal data.
- `/privacy` and `/support` (Arabic + English) are the App Store privacy policy and support URLs.

## Server configuration

| Name | Kind | Value |
| --- | --- | --- |
| `APNS_KEY_ID` | secret (or var) | the 10-character key id of the APNs `.p8` key |
| `APNS_AUTH_KEY` | secret | the full contents of `AuthKey_XXXXXXXXXX.p8` (or base64 of it) |
| `APPLE_APP_BUNDLE_ID` | var, optional | defaults to `com.hollowzulfi.coffee` |

The Team ID comes from `APPLE_TEAM_IDENTIFIER`, already set for Wallet.
Without the key, ordering works and the app simply gets no notifications.
Use `wrangler secret put` for both APNs values: dashboard vars are wiped by `wrangler deploy`.

## GitHub Actions secrets

| Secret | What |
| --- | --- |
| `ASC_KEY_ID`, `ASC_ISSUER_ID` | App Store Connect API key (Users and Access → Integrations → App Store Connect API, role **Admin**) |
| `ASC_KEY_P8` | the contents of that key's `.p8` file |
| `GH_ADMIN_TOKEN` | only for the one-time setup: a fine-grained token for this repo with *Secrets: Read and write*. Delete it afterwards |
| `IOS_SIGNING` | written by the **iOS setup (one time)** workflow. Never create or paste it by hand |

Workflows:

1. **iOS setup (one time)** (`ios-setup.yml`, Ubuntu):
   - registers the App ID and enables Push Notifications;
   - creates an Apple Distribution certificate and the "HOLLOW Coffee App Store" profile;
   - saves the certificate and key into `IOS_SIGNING`.

   Run it again only if the certificate is revoked or expires (yearly).
2. **iOS TestFlight** (`ios-testflight.yml`, macOS):
   - builds the web app and runs `cap sync`;
   - installs the certificate, downloads the profile, archives and uploads to App Store Connect;
   - uses the run number as the build number. Raise `MARKETING_VERSION` in `project.pbxproj` for a new App Store version.

The Release configuration signs manually with "Apple Distribution" + that profile (`project.pbxproj`).
Debug keeps automatic signing for anyone who opens the project in Xcode later.

## Notes

- **APNs from Cloudflare.** APNs requires HTTP/2. App pushes go through the Worker's normal `fetch`, the same way Wallet pass updates go through the mTLS binding.
  If Wallet updates arrive on phones, app pushes will too. If they ever fail with a protocol error, the sender is behind the `AppPushSender` interface, so a relay can replace it.
- The App Store review needs a working demo customer account and the shop open (or hours set wide) during review. See `docs/APP_STORE.md`.
