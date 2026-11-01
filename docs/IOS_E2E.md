# Isolated iOS UI smoke tests

This suite is intentionally an **isolated guest UI suite**, **not** full
end-to-end acceptance testing and **not** a test of the live Supabase schema.
It is safe to use even when the production database has drifted from the
`supabase/migrations` in this repository.

## How it works

- Manually run **Actions → iOS E2E (isolated Maestro) → Run workflow**, or review its automatic check when the Maestro flow files, fixture or workflow change in a pull request.
- A macOS runner starts `scripts/e2e/mock-api.mjs` bound to `127.0.0.1:8765`.
  It has a synthetic config/menu and returns **405 for all HTTP writes**.
- The CI-only app is built using `VITE_API_BASE=http://127.0.0.1:8765`.
  Its Supabase URL and anon key are also fake. No production credentials, app
  signing keys or cloud deployment credentials are passed into this workflow.
- An ATS local-network exception is added to the **disposable runner checkout**
  before compiling. **The production repository Info.plist is unchanged.**
- An unsigned iPhone Simulator app runs 8 Maestro flows: menu-to-login/recovery,
  cart item, registration screen, empty-cart navigation, protected order history,
  menu search, local registration validation and checkout input validation.
  The workflows never create users, pay for orders or submit valid checkout
  payloads. Invalid form submission is client-side validation only.
- A JUnit report, diagnostic artifacts and an optional failure screenshot are
  retained for 7 days. Tests do not include customer information.

## Limits and security

This suite checks basic UI behavior against mocked responses. It cannot prove
that real login, admin roles, Apple Wallet signing, inventory, online payment,
push notifications or order processing work in production. It does not inspect
the actual database and will **not detect Supabase schema drift**.

To assess the real deployment, first compare the actual Supabase schema to the
committed migrations with **read-only** permissions (no user rows or secrets).
Then create a distinct staging backend/database, apply the verified schema
and use disposable test accounts for write-based E2E tests. Never point this
workflow at the production Worker or Supabase.

This workflow triggers manually and on PRs changing its test flow, fixture or
workflow files only. It does **not** run on main push or schedule, deploy or
upload to TestFlight. See the existing `ios-build-check.yml` and
`ios-testflight.yml` for those separate processes.
