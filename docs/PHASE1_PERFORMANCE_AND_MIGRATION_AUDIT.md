# Phase 1 follow-up — performance and migration-history reconciliation

**Scope:** read-only metadata from `hollow-rewards` production on **2026-11-01** plus the `saud-ux/hollow-qr` repository.
**Safety:** no production customer rows, sales details, secrets, writes, deployed code changes, or database migrations were used.

## 1. Hosted migration history vs. committed SQL

The repository contains **28** SQL migrations; Supabase's hosted migration-history table reports **27** entries.

| Comparison class | Count | Details |
| --- | ---: | --- |
| Exact version and name | 25 | Records match by identifier, *not* verified function/schema content |
| Same migration name, different version | 2 | `customer_cars`: repo `20261028000000`, hosted `20261027093823`; `coupon_by_item`: repo `20261029000000`, hosted `20261028115232` |
| Local file without matching hosted history | 1 | `20261028010000_explicit_where_on_deletes.sql` |
| Hosted entries with no local match | 0 | As of this snapshot |
| Version/name conflicts | 0 | As of this snapshot |

Read-only production function inspection found that `cars_list`, `car_save`, `car_delete` exist, `benefit_quote` contains `coupon_by_item`, and `reset_shop_data` and `benefits_v1` include the explicit `where true` fix. **This is not proof of byte-for-byte equality**, so do not mark these migrations applied or reapply them without a complete schema-only diff and reviewed mapping.

### Reproducible offline audit

The historical, non-sensitive version/name snapshot is stored in
`docs/audits/supabase-migration-history-2026-11-01.json`.

```bash
node scripts/audit-production-migrations.mjs --history docs/audits/supabase-migration-history-2026-11-01.json
node --test tests/scripts/audit-production-migrations.test.mjs
```

The script only reads local files and the supplied JSON. It **does not access Supabase**. A new export of the hosted migration history can be supplied as `--history <fresh-file.json>` after obtaining it through an approved *read-only* process. Do not place customer records, URLs with tokens, or credentials in the JSON. The script classifies matching names/versions, **not schema equivalence**.

Optional `--strict` returns a nonzero exit code on *any* deviation, including the **known** renumbered entries and unrecorded patch; the default mode prints a warning and exits normally. CI uses the historical snapshot as a documented fixture, **not a live production comparison**.

### Before any schema deployment

1. Take a restorable backup and obtain an authorized maintenance window.
2. Generate a **schema-only** snapshot of production; rebuild a disposable database from all 28 migrations.
3. Compare tables, columns, constraints, indexes, views, RLS, grants, triggers, and function bodies, then explicitly review differences.
4. Reconcile historical migration identifiers in an approved recovery plan; treat renumbered/out-of-band SQL as applied only after semantic inspection, not by filename.
5. Apply only genuinely missing, forward-only changes in staging and rerun the full test suite; then decide separately whether production needs work.

**Do not run `supabase db push`, `supabase db reset`, or attempt migration-repair commands on production based only on this report.**

## 2. Index advisor findings: not an emergency

Hosted metadata shows **65 public-schema indexes**. The performance advisor flagged **8 unindexed foreign keys**, **9 no-primary-key notices** (in archival `reset_backup_20261021` tables), and **4 unused-index notices**.

### The eight foreign keys flagged

| Table | Foreign key | Assessment |
| --- | --- | --- |
| `benefit_movements` | `benefit_movements_actor_id_fkey` | Low priority until actor-based joins or deletes are demonstrably slow |
| `benefit_movements` | `benefit_movements_order_id_fkey` | Reassess if order cancellation/settlement joins slow down |
| `coupon_uses` | `coupon_uses_customer_id_fkey` | Candidate when querying customer coupon history or deleting accounts |
| `data_resets` | `data_resets_reset_by_fkey` | Administrative/rare operations: lower priority |
| `order_items` | `order_items_menu_item_id_fkey` | Candidate during product retirement and sales reporting |
| `orders` | `orders_completed_by_fkey` | Reassess if employee-level reporting becomes frequent |
| `push_broadcasts` | `push_broadcasts_sent_by_fkey` | Administrative/rare operations: lower priority |
| `wallet_topups` | `wallet_topups_customer_id_fkey` | Candidate before activating customer wallet top-ups at scale |

The advisor only means that those FKs lack covering indexes; **it does not prove a customer-visible performance problem**. Current table statistics were small (approximate live tuples: `orders` ~8 and `order_items` ~13, with some tables ~0). Estimates are approximate and may lag.

**Decision for Phase 1:** do **not** create 8 additional indexes automatically. They consume storage and introduce write overhead; adding them to live tables also has locking considerations. First record real query patterns and `EXPLAIN` plans in staging. Then prioritize only the needed indexes, review deployment/rollback in a dedicated PR, and apply in an approved window. Never drop `unused` indexes from one advisor snapshot.

### Backup schema

The archival schema `reset_backup_20261021` contains **9 tables** without primary keys and was **not** directly readable by `anon` or `authenticated` roles at the time of inspection. Retention/cleanup must be treated as an explicit business and privacy decision, not an automatic performance fix.

## 3. Transfer-readiness and next acceptance steps

- Capture third-party packages/assets and copyright ownership, Apple Store/Wallet signing dependencies, Cloudflare/Supabase resource ownership, and backup/restore instructions.
- Do not promise buyer-exclusive control while the source repository is public without reviewing public exposure and any existing license grants; no `LICENSE` file was present in the repository audit.
- Carry out authorized tests with disposable user identities on a **separate staging project** for signup/login, paid-at-collection checkout, staff/admin actions, Apple Wallet push, account deletion, and network retries. Green PGlite/Maestro runs do not guarantee these production integrations.
- The optional Moyasar/Apple Pay online payment activation and Loyverse POS integration are **outside this phase**. Existing order/payment behavior remains unchanged.

## 4. Outcomes and limitations

This work creates an auditable **offline** mismatch detector and safe documentation. It does not repair migration history, alter authorization, improve database execution plans, or certify full live readiness. Any such work requires separate evaluation, staging, and approved deployment.

Related: [Phase 1 security and handoff audit](PHASE1_SECURITY_AND_HANDOFF.md).
