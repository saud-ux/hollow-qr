# Architecture & security

```
iPhone Safari / Wallet ──► Cloudflare Worker (one domain)
                           ├─ static assets: React SPA (customer + staff)
                           ├─ /api/*  Hono JSON API ──► Supabase (service-role, server only)
                           └─ /v1/*   Apple Wallet web service
                                      └─ APNs (mTLS binding) on loyalty changes
Browser ──► Supabase Auth (anon key): sign-up / login / reset, Turnstile token
```

## Loyalty rules (enforced in Postgres)

- `stamp_count` ∈ 0..5 and `reward_available = (stamp_count = 5)` are CHECK constraints. An impossible state cannot be stored.
- Every change goes through `public.apply_loyalty_action()`, which locks the account row with `SELECT … FOR UPDATE`, validates and writes the audit row in the same transaction.
  It was tested with real concurrent connections on PostgreSQL 16: six simultaneous "+3" requests produce exactly one success.
- **ADD_CUPS** takes a quantity from 1 to 5 in a single operation. It is rejected while a reward is pending (`REWARD_PENDING`).
  If the quantity would exceed 5 it is rejected with `EXCEEDS_CAPACITY` plus the remaining capacity; it is never clamped silently.
- **REDEEM_REWARD** works only at 5/5 and resets to 0/5. **REMOVE_CUPS** never goes below 0.
- **UNDO** reverses the latest non-reversed stamp mutation. It writes a new `UNDO` row and links the original (`reversal_of` / `reversed_by`).
  It refuses if the balance changed since (`UNDO_STATE_MISMATCH`). Staff cannot undo admin adjustments.
- **ADMIN_ADJUSTMENT**, **CANCEL_MEMBERSHIP** and **REACTIVATE_MEMBERSHIP** are admin only.
  A cancelled membership rejects all other operations. QR scans show it as inactive, and the pass becomes `voided`.
- **Duplicate protection**:
  - If the account changed less than `DUPLICATE_WINDOW_SECONDS` (60) ago, the RPC returns `RECENT_ACTIVITY` without changing anything. The dashboard asks *تم تحديث هذا العميل قبل أقل من دقيقة* and resends with `confirmRecent`.
  - A single "+5" is one operation and is never blocked. UNDO is exempt, because it is how staff fix an accidental duplicate.
  - Every submission carries an `idempotencyKey` (UUID). A retry or double-tap replays the stored result instead of applying twice. Buttons are also disabled while a request is pending.
- `loyalty_transactions` is append-only. Triggers reject DELETE and TRUNCATE, and any UPDATE other than setting the reversal link once.
  Each row records the actor, the actor's role, the action, quantity, delta, the before/after count, reward and membership status, and a UTC timestamp.

## Authentication & authorization

- Passwords are handled only by Supabase Auth.
- The Worker verifies the Bearer JWT with `supabase.auth.getClaims()`: JWKS verification for asymmetric keys, or an Auth server check for legacy HS256 keys.
  It then reads the **role from `public.profiles`**. Roles in the token or the request body are ignored.
- Privileged roles can only come from `app_metadata.hollow_role`, which only the service role can write (admin bootstrap and staff creation).
  User-editable `user_metadata` cannot grant a role.
- RLS is enabled on every table. Browser roles (`anon`, `authenticated`) may only read their **own** profile and loyalty account.
  They have no write grants at all, no access to transactions or Wallet tables, and no EXECUTE on any function.
- The admin-only checks happen in the API **and** inside the SQL function (defense in depth).
- The service-role key exists only as a Worker secret. The browser receives `/api/public-config`: URL, anon key, flags.

## API hardening

- Zod validation on every input, plus body limits (16 KiB for `/api`, 64 KiB for `/v1`).
- Structured errors `{ error: { code, message } }`, never stack traces.
- No CORS headers, and same-origin checks on non-GET requests. Bearer tokens (not cookies) make CSRF moot.
- Rate limiting: Workers Rate Limiting bindings, with an in-isolate fallback.
- Security headers on API responses, plus CSP and related headers for static assets in `public/_headers`.
- Logs are structured JSON with key-based redaction. Tokens, keys and certificates are never logged.

## Privacy

- Staff see masked emails (`sa***@gmail.com`); admins see full emails.
- The QR is `https://<domain>/c/<22-char random id>.<22-char HMAC>`. The HMAC is checked before any database lookup, so forged or malformed codes never reach the database.
  The QR itself grants nothing: resolving it requires a staff session.
- CSV exports contain no tokens or pass serials, are protected against formula injection, and are written as UTF-8 with a BOM for Arabic in Excel.

## Time

All timestamps are stored as UTC (`timestamptz`). Business-facing dates and the "today / this week" stats use **Asia/Riyadh**, with the week starting on Sunday.

## Extensibility

- `src/server/pos/provider.ts` defines `POSProvider` for a future Loyverse integration. A POS receipt ID would become the idempotency key.
- `PassGenerator` and `WalletPushNotifier` interfaces isolate the signing library and the APNs transport.

## Why not `passkit-generator`?

`passkit-generator@3.6.1` was verified to run on Workers (with `nodejs_compat`) and to produce valid signatures.
However, it signs with node-forge's pure-JS RSA, which measured about 40 ms of CPU per pass. That is above the Workers Free plan's 10 ms CPU budget.
The in-house generator signs with native WebCrypto RSA in about 5 ms, needs no `nodejs_compat`, and is covered by tests that verify the signature with PKI.js and OpenSSL.
