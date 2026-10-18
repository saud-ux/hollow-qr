# HOLLOW coupons, balance and coffee gifts

## Included

- Checkout-only coupon entry. No customer coupon catalog or exposed codes. Owner creates/edits/pauses percentage or fixed-SAR coupons in **العروض والتقييمات** with product scope, per-customer limit, optional dates, minimum payable merchandise subtotal and discount ceiling. Empty product selection means all merchandise. Shipping is excluded. Gifts and the existing loyalty free drink are allocated first; coupons apply only to remaining payable products. Each unit receives the greater of the menu discount and the proportional coupon discount, never both.
- Separate monetary balance and gifted-cup ledger, with reason, actor, time and idempotency key. Owner grants credit/compensation, grants individually chosen cup quantities, or makes signed corrections from the customer detail page. Corrections cannot make balances negative. No seeded recipients, money or active coupons are added by the migration.
- Gifts cover **قهوة اليوم حارة، قهوة اليوم باردة، قهوة مقطرة، قهوة مقطرة باردة** only. Explicit item IDs are seeded by these exact menu names. Owner must verify the selected products in the coffee-gift settings if production names differ. They never expire. Recipients choose the number of cups, automatically allocated to the most expensive eligible coffee first. Gifts are shown only when the current customer has a positive remaining quantity; there is no public gifts menu. The owner can configure the initial ten recipients without a recurring program.
- Customer account: balance/history, conditional gift card and top-up choices 20/50/100 SAR or a custom amount. Credit has no expiry and is not transferable or withdrawable.
- Cashier: existing QR resolves the same customer detail page. Cashier may spend monetary balance or selected eligible gifted coffee with a reason/invoice reference, without a customer confirmation. Different coffee types can be recorded in separate operations. Grants and corrections require admin role. Existing manual paid-coffee loyalty controls remain in place; the cashier should add loyalty only for paid coffee.
- Checkout: balance can pay all or part of the amount; the currently supported remainder is paid on pickup. Staff ticket and customer receipt distinguish total from the amount remaining to collect. Gift/coupon discounts are not incorrectly treated as wallet payment.
- Both customer-before-acceptance and café cancellations restore the exact wallet debit and gift quantity once, and release the coupon use. The existing server-side ban on customer cancellation after acceptance is retained.
- Online order completion awards loyalty only to payable drinks, including discounted/credit-paid drinks. Gift cups and fully free units do not earn loyalty.

## Deploying this change

Apply these two migrations to the intended Supabase project **before deploying the Worker/client build**:

1. `supabase/migrations/20261021000000_customer_benefits.sql`
2. `supabase/migrations/20261022000000_wallet_topups.sql`

Production and security-staging have different project IDs. Never apply a staging connection string to production, or copy production customer data to staging. The hosted project uses a different historical migration numbering scheme; follow `docs/ORDERING.md` and apply these specific SQL files through the project's SQL editor/migration tooling, rather than blindly pushing the full historical directory.

Then deploy the normal website build and build a new iOS/TestFlight version. This change does not update an already-installed bundled iOS build automatically. No production deploy workflow or database credentials are included in the commit.

## Moyasar activation and current limits

Moyasar account setup is still incomplete. Top-ups fail closed until BOTH runtime settings are present:

- Secret `MOYASAR_SECRET_KEY` (start with a **test** key; never commit it).
- `MOYASAR_TOPUPS_ENABLED=true` (disabled by default).

The implemented top-up integration creates a server-bound hosted invoice and accepts credit only after fetching that exact invoice from Moyasar using the secret key, checking SAR/exact amount/paid status/a paid or captured unrefunded payment. Provider callbacks ignore their body and fetch the invoice again. Callback repeats and customer return verification cannot double-credit. Hosted checkout URLs must be HTTPS on `checkout.moyasar.com`. The customer can return to Account to reconcile their pending top-up. Test hosted checkout and app return behavior on real iOS before enabling live money.

**Direct card/Apple Pay payments for orders and their bank-refund processing remain disabled and are not implemented by this change.** Existing order payment choices remain “قريبًا”. Do not turn `ONLINE_PAYMENTS_READY` on: this is not a sufficient integration. That subsequent integration must reserve the unpaid order, verify payment server-side before staff can accept it, store the payment allocation, refund externally paid portions to the same payment for either cancellation case, and retry failed refunds through an outbox without duplicate refunds. Wallet portions are already restored by this migration. Uncollected pickup amounts are never refunded as money.

## Validation

The SQL migrations run in PGlite with the existing repository's integration suite. Additional tests cover admin/cashier/customer permissions, row-level access, price tampering, gift eligibility and allocation, stacking, coupon limits/expiry/scope, retry idempotency, cancellation restoration, wallet partial payment, corrections and paid-only loyalty. Separate top-up tests cover exact provider verification, wrong invoice/owner/amount, duplicate credit, disabled configuration and rejection of client attempts to call internal credit operations. Live database application and live Moyasar payment/refund tests are separate deployment steps.
