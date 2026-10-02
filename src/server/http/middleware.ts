import type { MiddlewareHandler } from "hono";
import type { AppRole } from "../../shared/types";
import { ApiError } from "./errors";
import { clientIp, repoOf, type HonoEnv } from "./context";
import type { RateBucket } from "./rate-limit";

/** Security headers for API / Wallet responses (static assets use public/_headers). */
export const apiSecurityHeaders: MiddlewareHandler<HonoEnv> = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  if (c.get("deps").config.isProduction) {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
};

/**
 * Same-origin enforcement for state-changing browser requests. The API uses
 * bearer tokens (not cookies) so classic CSRF does not apply; this is defense
 * in depth. No CORS headers are ever emitted, so other origins cannot read
 * API responses.
 */
export const sameOriginWrites: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD") {
    const origin = c.req.header("origin");
    const { appUrl } = c.get("deps").config;
    if (origin && appUrl && origin !== appUrl) {
      throw new ApiError(403, "FORBIDDEN");
    }
  }
  await next();
};

export function rateLimit(bucket: RateBucket, by: "ip" | "user" = "ip"): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const key = by === "user" ? (c.get("user")?.id ?? clientIp(c)) : clientIp(c);
    const ok = await c.get("deps").rateLimiter.allow(bucket, key);
    if (!ok) {
      c.header("Retry-After", "60");
      throw new ApiError(429, "RATE_LIMITED");
    }
    await next();
  };
}

/** Verifies the Supabase JWT and loads the role from the database. */
export const requireUser: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(header);
  if (!match) throw new ApiError(401, "UNAUTHENTICATED");
  const deps = c.get("deps");
  if (!deps.auth) throw new ApiError(503, "CONFIG_ERROR");
  const identity = await deps.auth.verify(match[1]!);
  if (!identity) throw new ApiError(401, "UNAUTHENTICATED");
  const profile = await repoOf(c).getProfile(identity.userId);
  if (!profile) throw new ApiError(401, "UNAUTHENTICATED");
  c.set("user", {
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName,
    role: profile.role,
    emailConfirmed: profile.emailConfirmedAt !== null,
  });
  await next();
};

export function requireRole(...roles: AppRole[]): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user || !roles.includes(user.role)) throw new ApiError(403, "FORBIDDEN");
    await next();
  };
}
