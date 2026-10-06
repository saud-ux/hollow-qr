/**
 * Minimal structural types for the Cloudflare bindings we use. Declaring them
 * locally keeps the server code type-checkable under both the Workers runtime
 * and Node (tests) without pulling conflicting global type packages.
 */

/** An object with a fetch() — e.g. an mTLS certificate binding or ASSETS. */
export interface FetcherLike {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

/** Workers Rate Limiting binding. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

/**
 * Worker environment. Plain vars live in wrangler.jsonc; anything secret is
 * set with `wrangler secret put` (or .dev.vars locally) and never committed.
 */
export interface Bindings {
  // --- vars ---------------------------------------------------------------
  APP_ENV?: string;
  APP_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  REQUIRE_EMAIL_CONFIRMATION?: string;
  TURNSTILE_ENABLED?: string;
  TURNSTILE_SITE_KEY?: string;
  APPLE_WALLET_MODE?: string;
  APPLE_TEAM_IDENTIFIER?: string;
  APPLE_PASS_TYPE_IDENTIFIER?: string;
  DUPLICATE_WINDOW_SECONDS?: string;
  /** iOS app: bundle id (APNs topic) and the APNs auth key's 10-character id. */
  APPLE_APP_BUNDLE_ID?: string;
  APNS_KEY_ID?: string;

  // --- secrets ------------------------------------------------------------
  SUPABASE_SERVICE_ROLE_KEY?: string;
  PASS_AUTH_SECRET?: string;
  QR_TOKEN_SECRET?: string;
  APPLE_PASS_CERTIFICATE_BASE64?: string;
  APPLE_PASS_PRIVATE_KEY_BASE64?: string;
  APPLE_PASS_PRIVATE_KEY_PASSPHRASE?: string;
  APPLE_WWDR_CERTIFICATE_BASE64?: string;
  /** Contents of the APNs AuthKey_XXXXXXXXXX.p8 file (PEM, or base64 of it). */
  APNS_AUTH_KEY?: string;

  // --- bindings -----------------------------------------------------------
  ASSETS?: FetcherLike;
  /** mTLS certificate binding presenting the Pass Type ID certificate to APNs. */
  APPLE_APNS_MTLS?: FetcherLike;
  API_RATE_LIMITER?: RateLimitBinding;
  WALLET_RATE_LIMITER?: RateLimitBinding;
}
