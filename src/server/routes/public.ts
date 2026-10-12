import { Hono } from "hono";
import { toPublicConfig } from "../config";
import type { HonoEnv } from "../http/context";
import { ApiError } from "../http/errors";
import { rateLimit } from "../http/middleware";

export const publicRoutes = new Hono<HonoEnv>()
  .get("/health", (c) => {
    const { config } = c.get("deps");
    return c.json({ ok: true, env: config.appEnv, walletMode: config.wallet.mode, walletReady: config.wallet.ready });
  })
  .get("/public-config", (c) => {
    c.header("Cache-Control", "public, max-age=60");
    return c.json(toPublicConfig(c.get("deps").config));
  })
  // Website notifications: the key a browser subscribes with (VAPID public key).
  .get("/web-push/key", rateLimit("api"), async (c) => {
    const { webPush, logger } = c.get("deps");
    if (webPush.kind === "disabled") throw new ApiError(503, "CONFIG_ERROR");
    try {
      return c.json({ publicKey: await webPush.publicKey() });
    } catch (err) {
      logger.error("web_push.key_failed", { error: err instanceof Error ? err.message : "unknown" });
      throw new ApiError(503, "CONFIG_ERROR");
    }
  });
