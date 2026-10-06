import { DEFAULT_DUPLICATE_WINDOW_SECONDS } from "../shared/constants";
import type { PublicConfig, WalletMode } from "../shared/types";
import type { Bindings } from "./platform";
import { bytesToBase64Url } from "./security/encoding";

export type AppEnv = "development" | "production" | "test";

export interface AppConfig {
  appEnv: AppEnv;
  isProduction: boolean;
  /** Origin without trailing slash, e.g. https://rewards.example.com */
  appUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  hasServiceRoleKey: boolean;
  requireEmailConfirmation: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  duplicateWindowSeconds: number;
  /** Resolved secrets (dev falls back to per-isolate random values). */
  passAuthSecret: string;
  qrTokenSecret: string;
  /** True when HMAC secrets were not configured (only allowed outside production). */
  usingEphemeralSecrets: boolean;
  wallet: {
    mode: WalletMode;
    teamIdentifier: string | null;
    passTypeIdentifier: string | null;
    /** Signing material present (values are never stored on this object). */
    hasSigningMaterial: boolean;
    /** Production mode with every identifier + certificate configured. */
    ready: boolean;
    /** APNs mTLS binding available for update pushes. */
    pushEnabled: boolean;
  };
  /** iOS app push notifications (APNs token auth). */
  appPush: {
    bundleId: string;
    keyId: string | null;
    teamId: string | null;
    /** Key id, Team ID and APNS_AUTH_KEY all present. */
    enabled: boolean;
  };
  /** Non-secret configuration problems, safe to log. */
  issues: string[];
}

const MIN_SECRET_LENGTH = 32;
export const DEFAULT_APP_BUNDLE_ID = "com.hollowzulfi.coffee";
/** Origin of the Capacitor iOS app's web view (allowed to call the API). */
export const NATIVE_APP_ORIGIN = "capacitor://localhost";

// Development fallback: random per isolate, so tokens are unstable across
// restarts. Never used in production (production fails closed instead).
let ephemeralSecrets: { pass: string; qr: string } | null = null;
function getEphemeralSecrets() {
  if (!ephemeralSecrets) {
    const rand = () => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    ephemeralSecrets = { pass: rand(), qr: rand() };
  }
  return ephemeralSecrets;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function trimmed(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Bindings): AppConfig {
  const issues: string[] = [];
  const rawEnv = (env.APP_ENV ?? "production").trim().toLowerCase();
  const appEnv: AppEnv = rawEnv === "development" || rawEnv === "test" ? rawEnv : "production";
  const isProduction = appEnv === "production";

  const appUrlRaw = trimmed(env.APP_URL) ?? (isProduction ? "" : "http://localhost:5173");
  let appUrl = "";
  try {
    const u = new URL(appUrlRaw);
    if (isProduction && u.protocol !== "https:") issues.push("APP_URL must use https in production");
    appUrl = u.origin;
  } catch {
    issues.push("APP_URL is missing or invalid");
  }

  const supabaseUrl = trimmed(env.SUPABASE_URL) ?? "";
  const supabaseAnonKey = trimmed(env.SUPABASE_ANON_KEY) ?? "";
  if (!supabaseUrl) issues.push("SUPABASE_URL is not set");
  if (!supabaseAnonKey) issues.push("SUPABASE_ANON_KEY is not set");
  const hasServiceRoleKey = Boolean(trimmed(env.SUPABASE_SERVICE_ROLE_KEY));
  if (!hasServiceRoleKey) issues.push("SUPABASE_SERVICE_ROLE_KEY secret is not set");

  let passAuthSecret = trimmed(env.PASS_AUTH_SECRET) ?? "";
  let qrTokenSecret = trimmed(env.QR_TOKEN_SECRET) ?? "";
  let usingEphemeralSecrets = false;
  for (const [name, value] of [
    ["PASS_AUTH_SECRET", passAuthSecret],
    ["QR_TOKEN_SECRET", qrTokenSecret],
  ] as const) {
    if (value && value.length < MIN_SECRET_LENGTH) {
      issues.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
    }
  }
  if (passAuthSecret && qrTokenSecret && passAuthSecret === qrTokenSecret) {
    issues.push("PASS_AUTH_SECRET and QR_TOKEN_SECRET must be different");
  }
  if (!passAuthSecret || !qrTokenSecret) {
    if (isProduction) {
      issues.push("PASS_AUTH_SECRET and QR_TOKEN_SECRET secrets are required in production");
    } else {
      const eph = getEphemeralSecrets();
      passAuthSecret ||= eph.pass;
      qrTokenSecret ||= eph.qr;
      usingEphemeralSecrets = true;
    }
  }

  const walletModeRaw = (env.APPLE_WALLET_MODE ?? "mock").trim().toLowerCase();
  const mode: WalletMode = walletModeRaw === "production" ? "production" : "mock";
  if (walletModeRaw !== "production" && walletModeRaw !== "mock") {
    issues.push("APPLE_WALLET_MODE must be 'mock' or 'production' (defaulting to mock)");
  }
  const teamIdentifier = trimmed(env.APPLE_TEAM_IDENTIFIER);
  const passTypeIdentifier = trimmed(env.APPLE_PASS_TYPE_IDENTIFIER);
  const hasSigningMaterial = Boolean(
    trimmed(env.APPLE_PASS_CERTIFICATE_BASE64) &&
      trimmed(env.APPLE_PASS_PRIVATE_KEY_BASE64) &&
      trimmed(env.APPLE_WWDR_CERTIFICATE_BASE64),
  );
  if (mode === "production") {
    if (!teamIdentifier) issues.push("APPLE_TEAM_IDENTIFIER is required for APPLE_WALLET_MODE=production");
    if (!passTypeIdentifier) issues.push("APPLE_PASS_TYPE_IDENTIFIER is required for APPLE_WALLET_MODE=production");
    if (!hasSigningMaterial) {
      issues.push(
        "APPLE_PASS_CERTIFICATE_BASE64, APPLE_PASS_PRIVATE_KEY_BASE64 and APPLE_WWDR_CERTIFICATE_BASE64 are required for APPLE_WALLET_MODE=production",
      );
    }
    if (!env.APPLE_APNS_MTLS) {
      issues.push("APPLE_APNS_MTLS binding missing: passes will not be pushed updates automatically");
    }
  }
  if (teamIdentifier && !/^[A-Z0-9]{10}$/.test(teamIdentifier)) {
    issues.push("APPLE_TEAM_IDENTIFIER should be a 10-character Apple Team ID");
  }
  if (passTypeIdentifier && !/^pass\.[A-Za-z0-9.-]+$/.test(passTypeIdentifier)) {
    issues.push("APPLE_PASS_TYPE_IDENTIFIER should look like pass.com.example.rewards");
  }

  const ready =
    mode === "production" &&
    Boolean(teamIdentifier && passTypeIdentifier && hasSigningMaterial) &&
    !usingEphemeralSecrets &&
    passAuthSecret.length >= MIN_SECRET_LENGTH;

  const bundleId = trimmed(env.APPLE_APP_BUNDLE_ID) ?? DEFAULT_APP_BUNDLE_ID;
  const apnsKeyId = trimmed(env.APNS_KEY_ID);
  const hasApnsKey = Boolean(trimmed(env.APNS_AUTH_KEY));
  if (apnsKeyId && !/^[A-Z0-9]{10}$/.test(apnsKeyId)) issues.push("APNS_KEY_ID should be the 10-character key id from the .p8 file name");
  if (apnsKeyId && !hasApnsKey) issues.push("APNS_KEY_ID is set but the APNS_AUTH_KEY secret is missing: app pushes are off");
  if (hasApnsKey && !apnsKeyId) issues.push("APNS_AUTH_KEY is set but APNS_KEY_ID is missing: app pushes are off");

  const windowRaw = Number.parseInt(env.DUPLICATE_WINDOW_SECONDS ?? "", 10);
  const duplicateWindowSeconds =
    Number.isFinite(windowRaw) && windowRaw >= 0 && windowRaw <= 3600 ? windowRaw : DEFAULT_DUPLICATE_WINDOW_SECONDS;

  return {
    appEnv,
    isProduction,
    appUrl,
    supabaseUrl,
    supabaseAnonKey,
    hasServiceRoleKey,
    requireEmailConfirmation: flag(env.REQUIRE_EMAIL_CONFIRMATION, isProduction),
    turnstileEnabled: flag(env.TURNSTILE_ENABLED, false) && Boolean(trimmed(env.TURNSTILE_SITE_KEY)),
    turnstileSiteKey: trimmed(env.TURNSTILE_SITE_KEY),
    duplicateWindowSeconds,
    passAuthSecret,
    qrTokenSecret,
    usingEphemeralSecrets,
    wallet: {
      mode,
      teamIdentifier,
      passTypeIdentifier,
      hasSigningMaterial,
      ready,
      pushEnabled: ready && Boolean(env.APPLE_APNS_MTLS),
    },
    appPush: {
      bundleId,
      keyId: apnsKeyId,
      teamId: teamIdentifier,
      enabled: Boolean(apnsKeyId && hasApnsKey && teamIdentifier),
    },
    issues,
  };
}

/** Secrets required for the core loyalty flow. Fails closed in production. */
export function assertCoreSecrets(config: AppConfig): void {
  const minLength = config.isProduction ? MIN_SECRET_LENGTH : 1;
  if (config.passAuthSecret.length < minLength || config.qrTokenSecret.length < minLength) {
    throw new ConfigError("HMAC secrets are not configured");
  }
}

export function toPublicConfig(config: AppConfig): PublicConfig {
  return {
    appEnv: config.appEnv,
    appUrl: config.appUrl,
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    requireEmailConfirmation: config.requireEmailConfirmation,
    turnstileEnabled: config.turnstileEnabled,
    turnstileSiteKey: config.turnstileEnabled ? config.turnstileSiteKey : null,
    walletMode: config.wallet.mode,
    walletReady: config.wallet.ready,
    duplicateWindowSeconds: config.duplicateWindowSeconds,
  };
}
