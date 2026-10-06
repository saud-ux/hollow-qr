import { Hono } from "hono";
import { z } from "zod";
import { BUSINESS_TIME_ZONE } from "../../shared/constants";
import { ApiError } from "../http/errors";
import { repoOf, runInBackground, walletOf, type HonoEnv } from "../http/context";
import { rateLimit, requireRole, requireUser } from "../http/middleware";
import { parseJsonBody, parseWith } from "../http/validation";
import { notifyOrderStatus } from "../push/order-notifications";
import { throwOrderError } from "./orders";

const uuid = z.uuid();

const statusSchema = z.object({
  status: z.enum(["preparing", "ready", "out_for_delivery", "completed", "cancelled"]),
  cancelReason: z.string().trim().max(200).optional(),
});

/** The order board: every staff member and admin. */
export const staffOrderRoutes = new Hono<HonoEnv>()
  .use("*", requireUser, requireRole("staff", "admin"), rateLimit("api", "user"))

  .get("/orders", async (c) => {
    const repo = repoOf(c);
    const [items, settings, isOpen] = await Promise.all([
      repo.listOrders({ scope: "active", recentMinutes: 180, limit: 100 }),
      repo.getShopSettings(),
      repo.isShopOpen(BUSINESS_TIME_ZONE),
    ]);
    c.header("Cache-Control", "no-store");
    return c.json({ items, shop: { isOpen, settings } });
  })

  .post("/orders/:id/status", async (c) => {
    const id = parseWith(uuid, c.req.param("id"));
    const body = await parseJsonBody(c, statusSchema);
    const user = c.get("user");
    const repo = repoOf(c);
    const result = await repo.setOrderStatus(user.id, id, body.status, body.cancelReason ?? null);
    if (!result.ok) throwOrderError(result);

    c.get("deps").logger.info("order.status", { orderId: id, status: body.status, actorRole: user.role });
    // Completing an order can add cups or redeem the reward: refresh the pass.
    if (result.loyalty_changed && result.pass_serial) {
      runInBackground(c, walletOf(c).passChanged(result.pass_serial));
    }
    const [order] = await repo.listOrders({ orderId: id, scope: "all", limit: 1 });
    if (!order) throw new ApiError(404, "ORDER_NOT_FOUND");
    const { appPush, logger } = c.get("deps");
    runInBackground(c, notifyOrderStatus({ repo, appPush, logger }, order));
    return c.json({ order });
  })

  // Busy-hour switch: pausing stops new orders immediately.
  .post("/shop/pause", async (c) => {
    const { paused } = await parseJsonBody(c, z.object({ paused: z.boolean() }));
    const repo = repoOf(c);
    const settings = await repo.updateShopSettings({ orderingPaused: paused });
    c.get("deps").logger.info("shop.pause", { paused, actor: c.get("user").id });
    return c.json({ isOpen: await repo.isShopOpen(BUSINESS_TIME_ZONE), settings });
  });
