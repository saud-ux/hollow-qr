# Free functional sandbox (no paid Supabase project)

The repository's `.github/workflows/free-functional-sandbox.yml` runs automatically on
relevant PRs/pushes to `main`, and can also be started manually from Actions.
It uses the standard Ubuntu runner on this **public** GitHub repository.

- **Free to run:** no new Supabase project or branch; no paid runner; no cloud
  database needed. Standard GitHub-hosted runners in public repositories are
  currently free (see GitHub's Actions billing documentation).
- **Database:** `tests/helpers/db.ts` creates a fresh **PGlite** PostgreSQL
  instance, applies every committed SQL migration and makes fake Auth users.
- **API/auth:** `tests/helpers/app.ts` exercises the real Hono API routing and
  SQL through a mock repository/auth verifier. No production API calls, real
  payments, real pushes, real email or real Wallet certificates.
- **Business journey:** `tests/integration/free-staging-journey.test.ts`
  verifies customer/staff/admin permissions; admin opening the shop; a
  customer's order; staff order board; protected access; duplicate submission
  handling; preparing → ready → completed; five earned loyalty cups; and
  redemption of a free drink.
- **Regression suite:** all existing Vitest tests run too, including
  dedicated tests for discounts, coupons, menu management, saved cars,
  order history and other server-side behaviors.
- **No secrets or external services** are required or requested. Nothing
  changes the real app deployment, live database or TestFlight process.

## Important limitations

These tests cannot prove that production Supabase still matches committed SQL
migrations, because migration history and schema can diverge. The live
`hollow-rewards` database was previously inspected read-only: production has
migration history/version differences from the repository. Do not automatically
apply repo migrations or reset production to address them.

This is **server/API integration testing**, not a replacement for iPhone
UI testing. Use the separate `ios-e2e-tests.yml` workflow for basic UI smoke
tests. Real end-to-end tests of signup, staff credentials, payment providers,
notifications and signed Apple Wallet passes would need a separately isolated
staging environment. Do not use production records for staging or put any
Supabase service-role key into a public workflow.

## Running the sandbox

1. Open GitHub → Actions → **Free functional sandbox (customer, staff, admin)**.
2. Click **Run workflow**, select `main`, then run.
3. Inspect the `Customer, employee and owner full journey` and
   `Complete regression suite` steps and the job summary.
4. Failures reflect either a code/migration regression or a mismatch in
   test expectations. They do **not** imply customer data changed.

**Cost caveat:** The workflow only uses a standard GitHub-hosted runner. If
the repository becomes private or billing policies change, check GitHub Actions
billing before continuing.
