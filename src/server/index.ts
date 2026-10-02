/**
 * Cloudflare Worker entry point.
 *
 * Static assets (the React app) are served by Workers Static Assets; only
 * /api/* and /v1/* (Apple Wallet web service) reach this code — see
 * `run_worker_first` in wrangler.jsonc.
 */
import { createApp } from "./app";
import { SupabaseAuthVerifier } from "./auth/verifier";
import { loadConfig } from "./config";
import { SupabaseRepository } from "./data/supabase-repository";
import type { AppDeps } from "./http/context";
import { WorkersRateLimiter } from "./http/rate-limit";
import { createLogger } from "./lib/logger";
import type { Bindings, ExecutionContextLike } from "./platform";
import { DisabledPushNotifier, MockPushNotifier, MtlsApnsNotifier, type WalletPushNotifier } from "./wallet/apns";
import { WalletService, WebCryptoPassGenerator } from "./wallet/service";

const logger = createLogger();
let warnedFor: string | null = null;

// Reuse the Supabase client across requests in the same isolate.
let cachedRepo: { key: string; repo: SupabaseRepository } | null = null;
function repositoryFor(url: string, serviceRoleKey: string): SupabaseRepository {
  const key = `${url}|${serviceRoleKey.length}|${serviceRoleKey.slice(-12)}`;
  if (cachedRepo?.key !== key) cachedRepo = { key, repo: new SupabaseRepository(url, serviceRoleKey) };
  return cachedRepo.repo;
}

export function buildDeps(env: Bindings): AppDeps {
  const config = loadConfig(env);
  const issuesKey = config.issues.join("|");
  if (config.issues.length > 0 && warnedFor !== issuesKey) {
    warnedFor = issuesKey;
    logger.warn("config.issues", { issues: config.issues });
  }

  const repo = config.supabaseUrl && env.SUPABASE_SERVICE_ROLE_KEY ? repositoryFor(config.supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY) : null;
  const auth = config.supabaseUrl && config.supabaseAnonKey ? new SupabaseAuthVerifier(config.supabaseUrl, config.supabaseAnonKey) : null;

  let notifier: WalletPushNotifier;
  if (config.wallet.mode !== "production") notifier = new MockPushNotifier(logger);
  else if (config.wallet.pushEnabled && env.APPLE_APNS_MTLS && config.wallet.passTypeIdentifier) {
    notifier = new MtlsApnsNotifier(env.APPLE_APNS_MTLS, config.wallet.passTypeIdentifier, logger);
  } else notifier = new DisabledPushNotifier(logger);

  const generator =
    config.wallet.ready && config.wallet.passTypeIdentifier && config.wallet.teamIdentifier
      ? new WebCryptoPassGenerator(env, {
          passTypeIdentifier: config.wallet.passTypeIdentifier,
          teamIdentifier: config.wallet.teamIdentifier,
        })
      : null;

  return {
    config,
    repo,
    auth,
    wallet: repo ? new WalletService(config, repo, notifier, logger, generator) : null,
    rateLimiter: new WorkersRateLimiter({
      api: env.API_RATE_LIMITER,
      wallet: env.WALLET_RATE_LIMITER,
    }),
    logger,
    now: () => new Date(),
  };
}

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContextLike): Response | Promise<Response> {
    const url = new URL(request.url);
    // Wallet may join webServiceURL and "/v1/..." with a double slash.
    if (url.pathname.includes("//")) {
      url.pathname = url.pathname.replace(/\/{2,}/g, "/");
      request = new Request(url, request);
    }
    const app = createApp(buildDeps(env));
    return app.fetch(request, env, ctx as never);
  },
};
