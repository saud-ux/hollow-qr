#!/usr/bin/env node
/**
 * A deliberately conservative preflight for zero-secret, disposable test runs.
 * Fails closed when the workflow has access to any live database/deployment key.
 *
 * This does not sandbox arbitrary code at the OS level. Combined with no
 * repository secrets in the workflow and fake PGlite dependencies, it prevents
 * accidental reuse of production configuration in this specific CI job.
 */
const expected = { HOLLOW_TEST_ISOLATED: "true", APP_ENV: "test" };
const forbidden = [
  "SUPABASE_URL", "SUPABASE_DB_URL", "DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY",
  "SUPABASE_ANON_KEY", "VITE_SUPABASE_URL", "VITE_API_BASE",
  "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID",
  "MOYASAR_SECRET_KEY", "MOYASAR_TOPUPS_ENABLED",
  "ASC_KEY_P8", "IOS_SIGNING", "APNS_AUTH_KEY",
  "APPLE_WALLET_PRIVATE_KEY", "PASS_AUTH_SECRET", "QR_TOKEN_SECRET",
];
const issues = [];
for (const [key, value] of Object.entries(expected)) {
  if (process.env[key] !== value) issues.push(`${key} must equal ${value}`);
}
for (const key of forbidden) {
  if (process.env[key] !== undefined && process.env[key] !== "") {
    issues.push(`unexpected environment value: ${key}`);
  }
}
if (issues.length) {
  for (const issue of issues) console.error(`ISOLATION FAILURE: ${issue}`);
  process.exitCode = 1;
} else {
  console.log("PASS: isolated test mode; no production or external service configuration supplied");
}
