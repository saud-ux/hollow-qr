import { Hono } from "hono";
import { toPublicConfig } from "../config";
import type { HonoEnv } from "../http/context";

export const publicRoutes = new Hono<HonoEnv>()
  .get("/health", (c) => {
    const { config } = c.get("deps");
    return c.json({ ok: true, env: config.appEnv, walletMode: config.wallet.mode, walletReady: config.wallet.ready });
  })
  .get("/public-config", (c) => {
    c.header("Cache-Control", "public, max-age=60");
    return c.json(toPublicConfig(c.get("deps").config));
  });
