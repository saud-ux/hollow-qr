import type { PGlite } from "@electric-sql/pglite";
import { createApp } from "../../src/server/app";
import type { AuthVerifier } from "../../src/server/auth/verifier";
import { loadConfig } from "../../src/server/config";
import type { AppDeps } from "../../src/server/http/context";
import { allowAll } from "../../src/server/http/rate-limit";
import { silentLogger } from "../../src/server/lib/logger";
import type { Bindings } from "../../src/server/platform";
import { MockPushNotifier, type WalletPushNotifier } from "../../src/server/wallet/apns";
import { WalletService, WebCryptoPassGenerator } from "../../src/server/wallet/service";
import { PgliteRepository } from "./pglite-repository";

export const APP_URL = "https://rewards.hollow.test";

/** Fake verifier: the bearer token "tok-<userId>" authenticates <userId>. */
export const fakeAuth: AuthVerifier = {
  verify: (token) => Promise.resolve(token.startsWith("tok-") ? { userId: token.slice(4), email: null } : null),
};

export const bearer = (userId: string) => ({ authorization: `Bearer tok-${userId}` });

export function testEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    APP_ENV: "test",
    APP_URL,
    SUPABASE_URL: "https://project.supabase.test",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    PASS_AUTH_SECRET: "pass-auth-secret-for-tests-only-0123456789",
    QR_TOKEN_SECRET: "qr-token-secret-for-tests-only-0123456789",
    APPLE_WALLET_MODE: "mock",
    REQUIRE_EMAIL_CONFIRMATION: "false",
    DUPLICATE_WINDOW_SECONDS: "60",
    ...overrides,
  };
}

export function buildTestApp(db: PGlite, env: Bindings = testEnv(), notifier?: WalletPushNotifier) {
  const config = loadConfig(env);
  const repo = new PgliteRepository(db);
  const push = notifier ?? new MockPushNotifier(silentLogger);
  const generator =
    config.wallet.ready && config.wallet.passTypeIdentifier && config.wallet.teamIdentifier
      ? new WebCryptoPassGenerator(env, {
          passTypeIdentifier: config.wallet.passTypeIdentifier,
          teamIdentifier: config.wallet.teamIdentifier,
        })
      : null;
  const deps: AppDeps = {
    config,
    repo,
    auth: fakeAuth,
    wallet: new WalletService(config, repo, push, silentLogger, generator),
    rateLimiter: allowAll,
    logger: silentLogger,
    now: () => new Date(),
  };
  const app = createApp(deps);
  return { app, deps, repo, notifier: push };
}
