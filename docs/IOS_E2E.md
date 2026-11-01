# Isolated iOS UI smoke tests

This suite is intentionally a **small read-only guest smoke test**, **not** full
end-to-end acceptance testing and **not** a test of the live Supabase schema.
It is safe to use even when the production database has drifted from the
`supabase/migrations` in this repository.

## How it works

- Manually run **Actions → iOS E2E (isolated Maestro) → Run workflow**.
- A macOS runner starts `scripts/e2e/mock-api.mjs` bound to `127.0.0.1:8765`.
  It has a synthetic config/menu and returns **405 for all HTTP writes**.
- The CI-only app is built using `VITE_API_BASE=http://127.0.0.1:8765`.
  Its Supabase URL and anon key are also fake. No production credentials, app
  signing keys or cloud deployment credentials are passed into this workflow.
- An ATS local-network exception is added to the **disposable runner checkout**
  before compiling. **The production repository Info.plist is unchanged.**
- An unsigned iPhone Simulator app runs Maestro's guest navigation, registration
  screen and cart tests. **They do not submit forms, create users or place orders.**
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

This workflow does not trigger on push, PR, or a schedule. It never deploys
or uploads to TestFlight. See the existing `ios-build-check.yml` and
`ios-testflight.yml` for those separate processes.
