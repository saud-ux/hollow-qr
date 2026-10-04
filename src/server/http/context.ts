import type { Context } from "hono";
import type { AppConfig } from "../config";
import type { AuthVerifier } from "../auth/verifier";
import type { Repository } from "../data/repository";
import type { Logger } from "../lib/logger";
import type { WalletService } from "../wallet/service";
import type { AppRole } from "../../shared/types";
import type { Bindings } from "../platform";
import { ApiError } from "./errors";
import type { RateLimiter } from "./rate-limit";

export interface AppDeps {
  config: AppConfig;
  /** null when SUPABASE_SERVICE_ROLE_KEY is missing; data routes then return 503. */
  repo: Repository | null;
  auth: AuthVerifier | null;
  wallet: WalletService | null;
  rateLimiter: RateLimiter;
  logger: Logger;
  now: () => Date;
}

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
  role: AppRole;
  emailConfirmed: boolean;
}

export interface HonoEnv {
  Bindings: Bindings;
  Variables: {
    deps: AppDeps;
    user: AuthedUser;
  };
}

export type AppContext = Context<HonoEnv>;

export function repoOf(c: AppContext): Repository {
  const repo = c.get("deps").repo;
  if (!repo) throw new ApiError(503, "CONFIG_ERROR");
  return repo;
}

export function walletOf(c: AppContext): WalletService {
  const wallet = c.get("deps").wallet;
  if (!wallet) throw new ApiError(503, "CONFIG_ERROR");
  return wallet;
}

/** Runs work after the response (waitUntil) when available. */
export function runInBackground(c: AppContext, promise: Promise<unknown>): void {
  const safe = promise.catch((err: unknown) => {
    c.get("deps").logger.error("background.failed", { error: err instanceof Error ? err.message : "unknown" });
  });
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    // No ExecutionContext (tests / non-Workers runtime): let it run detached.
    void safe;
  }
}

export function clientIp(c: AppContext): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
