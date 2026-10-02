# Deployment

One Cloudflare Worker serves the React app (static assets) and the API, on one domain.
Supabase provides Postgres and Auth.

## 1. Supabase

1. Create a project (Free plan is fine).
2. Apply the migrations:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   (Or paste `supabase/migrations/*.sql` into the SQL editor, in order.)
3. **Authentication → URL Configuration**
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/wallet`, `https://<your-domain>/reset-password`
     (plus `http://localhost:5173/*` for local development)
4. **Authentication → Providers → Email**: enable email/password and turn **Confirm email** on for production.
   Then set `REQUIRE_EMAIL_CONFIRMATION=true` in the Worker.
5. **Authentication → SMTP**: configure your own SMTP provider for production deliverability.
   Supabase's built-in mailer is heavily rate-limited and only meant for testing.
6. **Authentication → Password**: minimum length 8; require letters and digits (the app validates the same rule).
7. Optional, **Bot and Abuse Protection**: enable CAPTCHA with provider *Turnstile* and paste the Turnstile **secret** key there.
   Set `TURNSTILE_ENABLED=true` and `TURNSTILE_SITE_KEY` in the Worker.
8. Keys (**Project Settings → API**): the anon/publishable key goes in `SUPABASE_ANON_KEY` (public).
   The service-role/secret key goes in `SUPABASE_SERVICE_ROLE_KEY` and must stay a secret.

## 2. First admin

```bash
# .env (git-ignored) or shell: SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...
pnpm bootstrap:admin --email owner@example.com --name "Owner"
```

The script runs locally with the service-role key. It creates the account, or promotes an existing one, and sets `profiles.role = 'admin'`.
There is no public endpoint for this. The admin creates staff accounts from **/staff/admin**.

## 3. Cloudflare Worker

1. Edit the `vars` in `wrangler.jsonc`: `APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `REQUIRE_EMAIL_CONFIRMATION`, `TURNSTILE_*`, `APPLE_*` identifiers.
2. Set the secrets:
   ```bash
   npx wrangler login
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))" | npx wrangler secret put PASS_AUTH_SECRET
   node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))" | npx wrangler secret put QR_TOKEN_SECRET
   ```
   (These commands work in PowerShell, cmd and bash.)
   Keep `QR_TOKEN_SECRET` stable: rotating it changes every customer's QR code.
   Passes refresh automatically, but stale screenshots stop working.
3. Deploy:
   ```bash
   pnpm deploy          # = pnpm build && wrangler deploy
   ```
4. Attach your custom domain under **Workers & Pages → hollow-rewards → Settings → Domains & Routes**.
   It must match `APP_URL`.
5. If Supabase runs on a custom domain (not `*.supabase.co`), add that origin to `connect-src` in `public/_headers`.

Production-mode safety: with `APP_ENV=production` and the HMAC secrets missing, every endpoint that needs them returns `503 CONFIG_ERROR` instead of running insecurely.
With `APPLE_WALLET_MODE=production` and incomplete Apple configuration, only the Wallet download/update endpoints return 503. The rest of the app keeps working.

## 4. Rate limiting

`wrangler.jsonc` declares two Workers Rate Limiting bindings (`API_RATE_LIMITER`, `WALLET_RATE_LIMITER`).
If your account cannot use them, delete the `ratelimits` block. The Worker then falls back to a per-isolate limiter.
Sign-up, login and password-reset limits are enforced by Supabase Auth.

## 5. Checks before going live

```bash
pnpm check && pnpm test:smoke
```

- Open `/api/health`. It shows `walletMode` and `walletReady`.
- Worker logs (`observability` is enabled) print a `config.issues` warning listing anything missing. It never prints secret values.
