# Phase 1: Staging, recovery and buyer handoff runbook

**Prepared:** 2026-11-01. **Repository:** `saud-ux/hollow-qr`.
**Safety boundary:** no writes to live HOLLOW Supabase, Cloudflare, Apple, Wallet or production user data.

## 1. Already available at zero additional subscription cost

- `.github/workflows/free-functional-sandbox.yml`: isolated PGlite API/business-regression tests (customer, staff, admin).
- `.github/workflows/ios-e2e-tests.yml`: eight local, read-only Maestro iOS UI flows, with no live logins or checkout writes.
- `.github/workflows/phase1-isolated-recovery.yml`: **new** isolated restoration drill. Generates fake users and ledger entries in fresh PGlite, dumps its data directory, imports into a second instance, verifies the restored data, ledger, grants and RLS, then proves the two databases are independent.
- `scripts/guard-isolated-ci.mjs`: fails the isolated workflow when production connection details or signing/payment secrets are accidentally provided. The GitHub job does not import repo secrets.

Run GitHub → Actions → **Phase 1 isolated recovery drill** → **Run workflow** → select `main`.
A green check verifies the synthetic restore only, **not** a restorable live Supabase backup.

## 2. Existing separate Supabase test project

An existing account-connected project named **`hollow-security-test`** was reported as **INACTIVE** on 2026-11-01. Do **not** confuse it with production **`hollow-rewards`**.

- The project was not resumed, created, wiped, migrated, seeded, or linked by this PR.
- Before reuse, the owner should inspect its plan/billing, contents and Auth configuration. An inactive project might have old test records: **never assume it is empty** and never run `db reset` until verified.
- If owner explicitly chooses to reactivate it, keep all test users disposable and all integrations in **test/mock mode**; confirm its project ref is different from production. Never copy customer rows or production service-role keys.
- Set up separate testing URLs, Auth redirect allowlists, service credentials and safe outbound push/email stubs. No real POS sync, live payments, wallet signing or staff order notifications should be enabled while using synthetic fixtures.
- The user may resume an inactive Free project using the Supabase dashboard; check billing and active project limits first. Resuming is not performed here.

Do not add a workflow that automatically connects GitHub pull requests to either real Supabase project using service-role secrets.

## 3. Realistic acceptance matrix (must be run ONLY in approved isolated staging)

| Test | Actors | Passing evidence |
| --- | --- | --- |
| Registration, email verification, login/reset and logout | Fake customer | New identity belongs to test project; old session rejected on logout |
| Role boundaries and staff account removal | Fake admin/staff/customer | Server denies staff/admin endpoints to customer; removed staff loses access |
| Menu and ordering | Fake customer and staff | Pickup, curbside, delivery; correct staff view and prices |
| Duplicate order submission and network retry | Fake customer | Exactly one order per idempotency key, no duplicate credit |
| Loyalty, coupon, gift, monetary credit and cancel | Fake accounts | Correct cup/balance totals, one refund of each entitlement |
| Push, Wallet passes, widget and Live Activity | Test-only Apple credentials and disposable device | Expected notifications/update, no cross-customer delivery |
| Account deletion | Disposable customer | Authentication revoked; profile anonymized as designed; ledger retained lawfully |
| Recovery simulation | Synthetic test DB only | Backup can be restored into separate instance and invariants hold |

For each: record tester, date, code SHA, environment, screenshot/log without secrets or PII, expected and actual result.
**Never test live deletion, resets, cancellation or payments against production accounts.**

## 4. Production backup and recovery: remaining manual approval gate

**Nothing in this PR proves a production backup can be restored.** Before sale or schema changes:

1. Identify who owns the Supabase organization and which backup capabilities the current plan includes.
2. Schedule an authorized maintenance window and establish restore/recovery objectives (RPO/RTO).
3. Verify a real backup exists, timestamp, coverage (database + relevant Storage files), access control and retention. Keep credentials out of the repository.
4. Restore to a newly isolated environment **after approval**. Do not restore over the café database, and do not export live customer details into public CI artifacts.
5. Verify record counts/checksums with a privacy-safe method, data integrity, roles, RLS, order/loyalty ledger, and a tested rollback path.
6. Finish schema-only diff against a database freshly migrated from the repository. Review the 28 vs 27 migration history mismatch documented in `docs/PHASE1_PERFORMANCE_AND_MIGRATION_AUDIT.md`.
7. Record recovery evidence in private controlled storage. Never publish raw backups, customer data or keys in GitHub.

## 5. Buyer handoff / ownership gates

- **Scope of sale:** source-code ownership only versus brand/logo, domain, customer data, Apple Developer and Cloudflare/Supabase accounts.
- **Licensing:** repository is public and lacks a top-level LICENSE; review third-party components and any pre-existing access/rights before promising exclusivity. Making it private later does not erase prior public distribution.
- **Operational transfer:** buyer-controlled GitHub, Cloudflare Worker + DNS, Supabase organization, App Store Connect, Apple Wallet signing, APNs/email integration, backup policy and billing.
- **Secrets:** rotate service-role keys, QR/pass secrets and Apple credentials under a planned cutover. Some rotations invalidate active QR/wallet tokens; test and communicate effects.
- **Proof:** archived passing GitHub checks, real separate-staging acceptance outcomes, live backup/restore evidence, versioned deployment instructions, failure/recovery playbook.
- **Future integrations:** Apple Pay/order payments and POS integration are **not** included in this readiness step.

### Completion status

- [x] Reproducible zero-secret isolated business/unit tests
- [x] Synthetic backup → restore regression implemented in repository (subject to CI success)
- [x] Isolation preflight to block supplied live credentials
- [x] Migration history drift documented without production modifications
- [ ] Real separate Supabase staging resumed and explicitly approved
- [ ] Full real integration test matrix completed
- [ ] Real production backup-restoration drill approved and executed safely
- [ ] Ownership, licenses and transfer contracts reviewed

**No production deployments or database changes are authorized by this runbook.**
