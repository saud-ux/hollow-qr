# HOLLOW security staging

This branch hosts an isolated security assessment copy. It is not a security fix or a production deployment.

- Worker: `hollow-rewards-staging`
- Application URL: `https://hollow-rewards-staging.hollowzulfi.workers.dev`
- Supabase project: `vmssjxiccoflnekvcdfr` (`hollow-security-test`)
- Synthetic data only. Do not copy production users, orders, notification subscriptions, signing keys, or certificates.

## Cloudflare Builds

Connect only the `security-staging` branch to the staging Worker.

Build command:

```sh
cp wrangler.staging.json wrangler.jsonc && pnpm run build
```

Deploy command:

```sh
pnpm exec wrangler deploy --config dist/hollow_rewards_staging/wrangler.json --name hollow-rewards-staging --keep-vars
```

Preview command:

```sh
pnpm exec wrangler preview --config dist/hollow_rewards_staging/wrangler.json
```

The copy runs in the temporary build checkout. It does not alter the repository's production configuration. Secrets belong in the staging Worker's runtime settings: `SUPABASE_SERVICE_ROLE_KEY`, `PASS_AUTH_SECRET`, and `QR_TOKEN_SECRET`. Never commit secret values.

The checked-in `wrangler.jsonc` and the existing `Deploy website` workflow still target production. Do not run that workflow for staging. The optional `deploy-staging.yml` has explicit target guards; workflow dispatch availability depends on GitHub default-branch registration. Cloudflare Builds is the configured deployment path for this branch.

## Isolation and coverage

The staging configuration uses production security mode and a mock Wallet implementation. No production APNs certificate binding or scheduled triggers are configured. Account-wide rate limiter bindings are omitted; the application uses its fallback limiter, so distributed rate-limit behavior requires separate assessment. Web push uses staging database keys and subscriptions only; do not import production subscriptions.

The fresh schema was initialized with synthetic menu items and ordering paused. Verify the deployed public configuration points to the test Supabase project before creating test accounts. Only enable and submit isolated test orders after confirming separation from production operations. Authentication dashboard settings are independent of the application's configuration flags.

Local validation: TypeScript and Vite build succeeded with staging configuration; generated Worker name, Supabase project, application URL, absence of scheduled triggers, and absence of mTLS bindings were checked. Deployment success and live isolation still require verification after the first Cloudflare build.
