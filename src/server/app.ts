import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { ConfigError } from "./config";
import type { AppDeps, HonoEnv } from "./http/context";
import { ApiError } from "./http/errors";
import { apiSecurityHeaders, sameOriginWrites } from "./http/middleware";
import { adminRoutes } from "./routes/admin";
import { meRoutes } from "./routes/me";
import { publicRoutes } from "./routes/public";
import { staffRoutes } from "./routes/staff";
import { walletServiceRoutes } from "./routes/wallet-service";

/**
 * Builds the HTTP application. Dependencies are injected so tests can run the
 * real routing/authorization against a PGlite database and fake auth.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<HonoEnv>({ strict: false });

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  app.use("*", apiSecurityHeaders);

  // Request size limits: JSON APIs are tiny; Wallet logs slightly larger.
  app.use("/api/*", bodyLimit({ maxSize: 16 * 1024, onError: () => { throw new ApiError(413, "PAYLOAD_TOO_LARGE"); } }));
  app.use("/v1/*", bodyLimit({ maxSize: 64 * 1024, onError: () => { throw new ApiError(413, "PAYLOAD_TOO_LARGE"); } }));
  app.use("/api/*", sameOriginWrites);

  app.route("/api", publicRoutes);
  app.route("/api", meRoutes);
  app.route("/api/staff", staffRoutes);
  app.route("/api/admin", adminRoutes);
  app.route("/v1", walletServiceRoutes);

  app.notFound((c) => c.json(new ApiError(404, "NOT_FOUND").toBody(), 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.toBody(), err.status);
    if (err instanceof HTTPException) {
      const status = err.status === 413 ? 413 : 400;
      return c.json(new ApiError(status, status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST").toBody(), status);
    }
    if (err instanceof ConfigError) {
      deps.logger.error("config.error", { message: err.message });
      return c.json(new ApiError(503, "CONFIG_ERROR").toBody(), 503);
    }
    // Never leak stack traces or internal messages to clients.
    deps.logger.error("request.failed", {
      path: new URL(c.req.url).pathname,
      error: err instanceof Error ? `${err.name}: ${err.message}` : "unknown",
    });
    return c.json(new ApiError(500, "INTERNAL").toBody(), 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
