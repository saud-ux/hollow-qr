import type { RateLimitBinding } from "../platform";

export type RateBucket = "api" | "wallet";

export interface RateLimiter {
  /** Returns true if the request may proceed. */
  allow(bucket: RateBucket, key: string): Promise<boolean>;
}

const FALLBACK_LIMITS: Record<RateBucket, { limit: number; windowMs: number }> = {
  api: { limit: 120, windowMs: 60_000 },
  wallet: { limit: 60, windowMs: 60_000 },
};

/**
 * Uses Cloudflare's Rate Limiting bindings when configured (global-ish,
 * per-location counters). Falls back to a best-effort per-isolate fixed
 * window so local development and tests still exercise the code path.
 */
export class WorkersRateLimiter implements RateLimiter {
  private static memory = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly bindings: Partial<Record<RateBucket, RateLimitBinding | undefined>>,
    private readonly now: () => number = Date.now,
  ) {}

  async allow(bucket: RateBucket, key: string): Promise<boolean> {
    const binding = this.bindings[bucket];
    if (binding) {
      try {
        const { success } = await binding.limit({ key: `${bucket}:${key}` });
        return success;
      } catch {
        // Never fail closed on limiter infrastructure errors.
        return true;
      }
    }
    const { limit, windowMs } = FALLBACK_LIMITS[bucket];
    const k = `${bucket}:${key}`;
    const t = this.now();
    const entry = WorkersRateLimiter.memory.get(k);
    if (!entry || entry.resetAt <= t) {
      WorkersRateLimiter.memory.set(k, { count: 1, resetAt: t + windowMs });
      if (WorkersRateLimiter.memory.size > 10_000) WorkersRateLimiter.memory.clear();
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }
}

export const allowAll: RateLimiter = { allow: () => Promise.resolve(true) };
