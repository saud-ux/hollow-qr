# Phase 1 — security, migration reconciliation, and transfer readiness

**Audit date:** 2026-11-01 (Asia/Riyadh). **Scope:** Hollow Coffee / `saud-ux/hollow-qr`.
**Method:** read-only Supabase metadata/advisors and GitHub review. **No production records were queried or modified.**

## 1. What was actually verified

| Check | Observed result | Interpretation |
| --- | --- | --- |
| Hosted Supabase project | `hollow-rewards`, `ACTIVE_HEALTHY` | Availability is not proof of full functional correctness |
| `public` table RLS | 25/25 tables enabled | Good baseline; service-role Worker still requires secure API authorization |
| Browser table grants | `anon`: 0 readable, 0 writable; `authenticated`: 2 readable, 0 writable | Expected least-privilege model |
| Authenticated reads | `profiles` and `loyalty_accounts`, each with an `auth.uid()` own-row policy | Confirmed from `pg_policies` metadata |
| Privileged functions | 44 `public` `SECURITY DEFINER` functions; 0 directly executable by `anon` or `authenticated` | Good; verify again after each schema change |
| Repository tests | 329 Vitest tests, 8 isolated Maestro iPhone UI flows | They test mock/disposable systems, not actual live payments, logins or Apple Wallet |
| iOS | Simulator build and a prior TestFlight upload workflow succeeded | App Store approval and end-to-end physical-device validation remain separate |

### Security advisor findings (not all are vulnerabilities)

- **23 `rls_enabled_no_policy` INFO notices.** These are consistent with the current server-only, service-role access architecture: no direct browser grants on those tables. **Do not add public policies merely to silence them.**
- **1 `auth_leaked_password_protection` WARN.** This Supabase Auth option is disabled. Review whether the current account plan includes it; do not upgrade or change Auth settings without owner approval. The app's existing password-strength validation is not equivalent to breached-password screening.
- No public-schema SECURITY DEFINER function was executable by browser roles in the observed production snapshot.

**References:**
- [RLS enabled without a policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Supabase leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

## 2. Migration reconciliation — do NOT run db push against production blindly

**Current observation:** 28 local SQL files under `supabase/migrations/`, but 27 entries in the hosted `supabase_migrations.schema_migrations` history.

| Logical change | GitHub file/version | Hosted history | Evidence |
| --- | --- | --- | --- |
| Saved customer cars | `20261028000000_customer_cars.sql` | `20261027093823_customer_cars` | The relevant functions `cars_list`, `car_save` and `car_delete` exist in production |
| Coupon discount allocation by item | `20261029000000_coupon_by_item.sql` | `20261028115232_coupon_by_item` | Hosted `benefit_quote` definition contains `coupon_by_item` |
| Explicit WHERE on bulk update/delete | `20261028010000_explicit_where_on_deletes.sql` | No matching history entry | Hosted `reset_shop_data` and `benefits_v1` definitions include the explicit `where true` fix |

These findings suggest some changes were **applied outside the same migration filename/version history**. Presence of related functions is **not** a byte-for-byte comparison or proof of full schema equivalence.

**Safe reconciliation procedure:**

1. Take and verify a recoverable database backup in an approved maintenance window.
2. Export the latest migration history and schema-only definitions from production, without customer rows.
3. Compare function signatures/bodies, constraints, indexes, grants, triggers, and RLS against a disposable database rebuilt from all 28 committed SQL files.
4. Write a reviewed mapping of applied changes to hosted migration versions. Resolve any differences *in staging first*.
5. Only after a full diff and recovery plan, use the correct migration repair/forward-only workflow for the hosted project. **Do not replay `customer_cars`, `coupon_by_item`, or the bulk-delete fix simply to make the counts equal.**
6. Never `db reset`, delete backups, overwrite transactions, or run bulk modifications against the live café database as part of this audit.

## 3. Performance advisor findings and priorities

- **8 unindexed foreign keys:** inspect actual query plans and table sizes; prioritize indexes for joins used by orders, benefit movements and coupon usage. Any new index should be reviewed for locking/write amplification and tested off-production first.
- **9 backup-schema tables without primary keys:** they belong to `reset_backup_20261021`, not the active `public` schema. No anonymous or authenticated SELECT grants were observed there. **Do not remove the backup schema or add arbitrary primary keys just to silence notices.**
- **4 unused-index notices:** not sufficient to justify deleting indexes. A recently created or low-traffic project may not have accumulated representative index usage.

Reference: [Supabase database linter](https://supabase.com/docs/guides/database/database-linter).

## 4. Handoff checklist for a potential buyer

- [ ] Confirm who legally owns the code and included brand assets; agree in writing whether the deal transfers **source code only** or also brand, domains, Apple developer account, cloud resources and customer data.
- [ ] Review open-source dependency licenses and third-party assets. The GitHub repository is currently **public** and has no published `LICENSE` file; this needs an explicit ownership/rights review before promises of exclusivity.
- [ ] Record how to move the production deployment to buyer-owned Cloudflare, Supabase, GitHub, Apple Wallet signing and App Store Connect accounts. Plan secret rotation; **never hand over live tokens in the repository or documents.**
- [ ] Record current production and TestFlight versions and the deployment rollback steps.
- [ ] Prove user registration, login, staff/admin roles, pickup/curbside/delivery orders, cancel/refund, loyalty/Wallet, notifications and account deletion with **disposable accounts** on a separate staging environment or authorized controlled acceptance test.
- [ ] Verify local legal/privacy obligations around transfer of customer personal data separately from IP ownership.

## 5. Scope of this PR

- Adds automated **isolated** tests against the final migration security posture: RLS on all public tables, no unwanted browser grants, and no browser-executable privileged functions.
- Adds this audit and a production migration warning in the deployment docs.
- **Does not** add tables/indexes, modify Supabase Auth, read production customer rows, alter payment or POS behavior, change app screens, deploy a website, or upload a TestFlight build.
- Continue to run the existing isolated PGlite and Maestro workflows before any future production rollout.

Last evidence sources: GitHub Actions runs `41302602255` (8/8 Maestro), `41298855463` (329 tests), `41301242422` (iOS build); production Supabase MCP read-only advisor/privilege and migration queries on 2026-11-01.
