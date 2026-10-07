import { Hono } from "hono";
import { z } from "zod";
import { MAX_STAMPS } from "../../shared/constants";
import { isActiveStatus, type WidgetData } from "../../shared/ordering";
import { assertCoreSecrets } from "../config";
import { ApiError } from "../http/errors";
import { repoOf, walletOf, type AppContext, type HonoEnv } from "../http/context";
import { rateLimit, requireUser } from "../http/middleware";
import { parseJsonBody, parseWith } from "../http/validation";
import { createWidgetToken, verifyWidgetToken } from "../security/tokens";

/** The app renews the token every time it opens; this only covers a long gap. */
const WIDGET_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60;

const uuid = z.uuid();
const liveActivitySchema = z.object({
  token: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{32,400}$/),
  lang: z.enum(["ar", "en"]).optional().default("ar"),
});

/** The card and the newest order in progress, as the widget shows them. */
async function widgetData(c: AppContext, userId: string): Promise<WidgetData> {
  const repo = repoOf(c);
  const [account, orders] = await Promise.all([
    repo.getAccountByUserId(userId),
    repo.listOrders({ customerId: userId, scope: "active", limit: 10 }),
  ]);
  const order = orders.find((o) => isActiveStatus(o.status)) ?? null;
  return {
    card: account
      ? {
          name: account.displayName,
          stamps: account.stampCount,
          max: MAX_STAMPS,
          reward: account.rewardAvailable,
          active: account.membershipStatus === "active",
          qr: await walletOf(c).qrPayload(account),
        }
      : null,
    order: order ? { id: order.id, number: order.orderNumber, status: order.status, fulfillment: order.fulfillment } : null,
  };
}

/** iOS home-screen widget and lock-screen order tracker. */
export const widgetRoutes = new Hono<HonoEnv>()
  // The app hands the widget its data plus a token to refresh it later.
  .get("/me/widget", requireUser, rateLimit("api", "user"), async (c) => {
    const { config, now } = c.get("deps");
    assertCoreSecrets(config);
    const user = c.get("user");
    const exp = Math.floor(now().getTime() / 1000) + WIDGET_TOKEN_TTL_SECONDS;
    const token = await createWidgetToken(config.passAuthSecret, user.id, exp);
    c.header("Cache-Control", "no-store");
    return c.json({ token, expiresAt: new Date(exp * 1000).toISOString(), data: await widgetData(c, user.id) });
  })

  // The widget refreshing itself: `Authorization: Widget <token>`.
  .get("/widget", rateLimit("api", "ip"), async (c) => {
    const { config, now } = c.get("deps");
    assertCoreSecrets(config);
    const match = /^Widget\s+(\S+)$/.exec(c.req.header("authorization")?.trim() ?? "");
    const userId = match ? await verifyWidgetToken(config.passAuthSecret, match[1]!, Math.floor(now().getTime() / 1000)) : null;
    if (!userId) throw new ApiError(401, "UNAUTHENTICATED");
    const profile = await repoOf(c).getProfile(userId);
    if (!profile || profile.disabledAt !== null) throw new ApiError(401, "UNAUTHENTICATED");
    c.header("Cache-Control", "no-store");
    return c.json(await widgetData(c, userId));
  })

  // The app started a lock-screen tracker for an order: keep its push token.
  .post("/orders/:id/live-activity", requireUser, rateLimit("api", "user"), async (c) => {
    const id = parseWith(uuid, c.req.param("id"));
    const { token, lang } = await parseJsonBody(c, liveActivitySchema);
    const repo = repoOf(c);
    const [order] = await repo.listOrders({ orderId: id, customerId: c.get("user").id, scope: "all", limit: 1 });
    if (!order) throw new ApiError(404, "ORDER_NOT_FOUND");
    if (!isActiveStatus(order.status)) return c.json({ saved: false });
    await repo.saveLiveActivity(order.id, token, lang);
    return c.json({ saved: true });
  });
