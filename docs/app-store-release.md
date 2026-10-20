# HOLLOW — App Store release checklist

Code preparation is not an App Review approval or a device-test result.
Apple Pay and other online order-payment methods marked **قريبًا** remain disabled.

## Deployment order (required)

1. Back up production Supabase. Apply all outstanding migrations in filename order,
   including `supabase/migrations/20261024000000_app_store_account_deletion.sql`,
   using the normal Supabase migration workflow. Do not deploy the new API before
   this migration. It separates the Auth identity from the anonymized accounting
   profile and creates a durable deletion queue; it does not delete sales/balances.
2. Deploy the Worker/web bundle from this commit. Keep the existing hourly cron
   enabled: it retries pending Auth deletions, at most 20 per invocation. Monitor
   `account.deletions_pending` / `account.deletions_failed` and investigate persistent
   failures promptly. The queue includes previously explicitly deleted customers,
   not accounts merely disabled by staff. Do not roll back the database by
   recreating the original cascading Auth/profile FK.
3. Verify production `/privacy`, `/support` and `/terms` are publicly reachable.
   Confirm support email delivery and update the policy if actual providers change.
4. Run the **iOS TestFlight** workflow on `main`. Verify `VITE_API_BASE` points to
   production, not a preview. The workflow now requires Xcode 26+/iOS SDK 26+,
   rejects failed archives, and checks the app's archived privacy manifest.
5. Test the resulting build on a physical iPhone, then submit through App Store Connect.

## Device acceptance tests

- Guest menu/cart; signup, email confirmation, login, password reset and logout.
- Complete pickup, curbside and delivery orders, including permission-denied/manual
  address entry, maps, offline/retry and duplicate submission. Verify staff receives
  exactly one order and status updates reach the correct customer.
- Loyalty stamps/reward, gifted cups, balance redemption/refund and coupons.
  Verify disabled Apple Pay remains visibly **قريبًا**, never a working payment button.
- Nearby alerts: opt-in only; deny permissions without blocking ordering; enable
  and disable from Account → Notifications both signed in and as a guest.
  Nearby monitoring is local, alerts at most once per 12 hours, and does not need background
  location mode. Do not promise alerts when iOS permissions/settings prevent them.
- App push opt-in/out; Wallet pass, widget and Live Activity on supported iOS.
  Sign out and verify shared widget credentials are cleared. The native keyboard
  accessory toolbar is now system-provided; no private WebKit runtime patch remains.
- Delete a disposable customer with saved addresses, completed/new orders, push
  registrations, balance/gifts and a Wallet pass. Verify the warning, cancellation
  refunds, removed personal fields, cancelled pass, stopped nearby alerts, cleared
  local contact/cart, removed Auth user and inability to reuse the old session.
  Sales and financial balances remain in anonymized records for accounting/claims;
  no automatic payout or transfer to a newly created account is implemented.
- If Auth deletion fails transiently, verify the request persists, access is blocked
  immediately and the hourly retry completes it. Do not disable the cleanup cron.
- A preparing/ready/out-for-delivery order prevents deletion until completed or
  cancelled. A new order is cancelled/refunded once. Staff accounts cannot use
  customer self-deletion. Re-registering the same email creates a new account.
- Light/dark mode, Arabic RTL, larger text, safe areas, reduced motion, keyboard
  dismissal and transitions on the smallest supported iPhone.

## App Store Connect (manual, not configured by a code push)

- Privacy Policy URL, Support URL, working contact details, category, age rating,
  screenshots of the actual current build, export-compliance answers and version notes.
- Complete App Privacy disclosures from actual collection/use: account identifiers,
  contact information, order/purchase history, optional delivery location and device
  notification identifiers. Do not mark all data as uncollected just because nearby
  monitoring is local. Confirm provider collection, retention and purpose against
  production configuration. No tracking permission prompt is added: this app does
  not intentionally implement cross-company tracking.
- Supply a usable customer review account and clear review notes for ordering,
  physical-goods payment at pickup/delivery, optional location, nearby opt-in/out,
  self-service deletion, rewards, and disabled upcoming payment methods.
- Review the privacy report of the final Xcode archive, including bundled SDK
  manifests, signature/entitlements, app icon and extension provisioning. The app
  manifest declares UserDefaults reason CA92.1; this is not a substitute for Store
  privacy answers or reviewing third-party SDK manifests.

This change does not activate online payments, modify pricing/earning rules, or
submit a build for review. Apple may still request changes during review.
