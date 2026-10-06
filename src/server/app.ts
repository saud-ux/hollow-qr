import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { ConfigError } from "./config";
import type { AppDeps, HonoEnv } from "./http/context";
import { ApiError } from "./http/errors";
import { apiSecurityHeaders, sameOriginWrites } from "./http/middleware";
import { MENU_IMAGE_MAX_BYTES } from "../shared/ordering";
import { adminRoutes } from "./routes/admin";
import { adminMenuRoutes } from "./routes/admin-menu";
import { meRoutes } from "./routes/me";
import { orderRoutes } from "./routes/orders";
import { publicRoutes } from "./routes/public";
import { staffRoutes } from "./routes/staff";
import { staffOrderRoutes } from "./routes/staff-orders";
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

  // Request size limits: JSON APIs are tiny; menu images and Wallet logs larger.
  const tooLarge = () => {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE");
  };
  const jsonLimit: MiddlewareHandler<HonoEnv> = bodyLimit({ maxSize: 16 * 1024, onError: tooLarge });
  const imageLimit: MiddlewareHandler<HonoEnv> = bodyLimit({ maxSize: MENU_IMAGE_MAX_BYTES, onError: tooLarge });
  const IMAGE_UPLOAD = /^\/api\/admin\/menu\/[^/]+\/image$/;
  const apiBodyLimit: MiddlewareHandler<HonoEnv> = (c, next) =>
    IMAGE_UPLOAD.test(c.req.path) ? imageLimit(c, next) : jsonLimit(c, next);
  app.use("/api/*", apiBodyLimit);
  app.use("/v1/*", bodyLimit({ maxSize: 64 * 1024, onError: () => { throw new ApiError(413, "PAYLOAD_TOO_LARGE"); } }));
  app.use("/api/*", sameOriginWrites);

  app.route("/api", publicRoutes);
  app.route("/api", meRoutes);
  app.route("/api", orderRoutes);
  app.route("/api/staff", staffRoutes);
  app.route("/api/staff", staffOrderRoutes);
  app.route("/api/admin", adminRoutes);
  app.route("/api/admin", adminMenuRoutes);
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
