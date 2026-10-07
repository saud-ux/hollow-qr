import { Hono } from "hono";
import { z } from "zod";
import { BUSINESS_TIME_ZONE } from "../../shared/constants";
import {
  LOW_STOCK,
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  MAX_RATING_COMMENT,
  MENU_IMAGE_BUCKET,
  normalizeSaudiPhone,
  type MenuItem,
  type MenuResponse,
  type Order,
} from "../../shared/ordering";
import type { AppConfig } from "../config";
import type { MenuItemRow, OrderRpcResult } from "../data/repository";
import { ApiError, type ErrorStatus } from "../http/errors";
import { repoOf, runInBackground, type AppContext, type HonoEnv } from "../http/context";
import { rateLimit, requireUser } from "../http/middleware";
import { parseJsonBody, parseWith } from "../http/validation";
import { notifyOrderStatus, notifyStaffNewOrder } from "../push/order-notifications";

const rateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(MAX_RATING_COMMENT)
    .optional()
    .transform((v) => v || undefined),
});

export function menuImageUrl(config: Pick<AppConfig, "supabaseUrl">, path: string | null): string | null {
  if (!path || !config.supabaseUrl) return null;
  return `${config.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${MENU_IMAGE_BUCKET}/${path}`;
}

export function toMenuItem(config: Pick<AppConfig, "supabaseUrl">, row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    descriptionAr: row.descriptionAr,
    descriptionEn: row.descriptionEn,
    category: row.category,
    priceHalalas: row.priceHalalas,
    imageUrl: menuImageUrl(config, row.imagePath),
    isAvailable: row.isAvailable,
    isArchived: row.isArchived,
    sortOrder: row.sortOrder,
    optionLabel: row.optionLabel,
    optionLabelEn: row.optionLabelEn,
    options: row.options,
    calories: row.calories,
    isBestSeller: row.isBestSeller,
    stockQuantity: row.stockQuantity,
  };
}

/** The menu as customers get it: a counted item at 0 is sold out, and the count shows only when it runs low. */
export function forCustomers(item: MenuItem): MenuItem {
  const stock = item.stockQuantity;
  return {
    ...item,
    isAvailable: item.isAvailable && stock !== 0,
    stockQuantity: stock !== null && stock <= LOW_STOCK ? stock : null,
  };
}

/** HTTP status for business-rule codes returned by the ordering SQL functions. */
export function statusForOrderCode(code: string): ErrorStatus {
  switch (code) {
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "EMPTY_ORDER":
    case "OPTION_REQUIRED":
    case "TOO_MANY_ITEMS":
      return 400;
    default:
      return 409;
  }
}

export function throwOrderError(result: OrderRpcResult): never {
  const code = result.code ?? "INTERNAL";
  const details: Record<string, unknown> = {};
  if (result.current) details.current = result.current;
  if (result.minimum !== undefined) details.minimum = result.minimum;
  if (result.menu_item_id) details.menuItemId = result.menu_item_id;
  if (result.remaining !== undefined) details.remaining = result.remaining;
  throw new ApiError(
    statusForOrderCode(code),
    code === "NOT_FOUND" ? "ORDER_NOT_FOUND" : code,
    Object.keys(details).length ? details : undefined,
  );
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const placeOrderSchema = z
  .object({
    items: z
      .array(
        z.object({
          menuItemId: z.uuid(),
          quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
          note: optionalText(120),
          optionId: z.string().trim().max(40).optional(),
        }),
      )
      .min(1)
      .max(MAX_ORDER_LINES),
    fulfillment: z.enum(["pickup", "curbside", "delivery"]),
    phone: z.string().max(30),
    carDescription: optionalText(80),
    deliveryAddress: optionalText(300),
    deliveryLat: z.number().min(-90).max(90).optional(),
    deliveryLng: z.number().min(-180).max(180).optional(),
    note: optionalText(300),
    useReward: z.boolean().optional().default(false),
    idempotencyKey: z.uuid(),
  })
  .superRefine((v, ctx) => {
    if (v.fulfillment === "curbside" && !v.carDescription) {
      ctx.addIssue({ code: "custom", path: ["carDescription"], message: "required for curbside" });
    }
    if (v.fulfillment === "delivery" && !v.deliveryAddress) {
      ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "required for delivery" });
    }
    if ((v.deliveryLat === undefined) !== (v.deliveryLng === undefined)) {
      ctx.addIssue({ code: "custom", path: ["deliveryLat"], message: "lat and lng go together" });
    }
  });

async function ownOrder(c: AppContext, id: string): Promise<Order> {
  const [order] = await repoOf(c).listOrders({ customerId: c.get("user").id, orderId: id, scope: "all", limit: 1 });
  if (!order) throw new ApiError(404, "ORDER_NOT_FOUND");
  return order;
}

const uuid = z.uuid();

export const orderRoutes = new Hono<HonoEnv>()
  // Public menu: anyone can browse before signing in.
  .get("/menu", rateLimit("api"), async (c) => {
    const { config } = c.get("deps");
    const repo = repoOf(c);
    const [rows, settings, isOpen] = await Promise.all([
      repo.listMenuItems(false),
      repo.getShopSettings(),
      repo.isShopOpen(BUSINESS_TIME_ZONE),
    ]);
    const body: MenuResponse = { items: rows.map((r) => forCustomers(toMenuItem(config, r))), shop: { isOpen, settings } };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  })

  .post("/orders", requireUser, rateLimit("api", "user"), async (c) => {
    const user = c.get("user");
    const { config, logger } = c.get("deps");
    if (config.requireEmailConfirmation && !user.emailConfirmed) throw new ApiError(403, "EMAIL_NOT_CONFIRMED");
    const body = await parseJsonBody(c, placeOrderSchema);
    const phone = normalizeSaudiPhone(body.phone);
    if (!phone) throw new ApiError(400, "INVALID_PHONE");

    const repo = repoOf(c);
    const result = await repo.placeOrder({
      customerId: user.id,
      items: body.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity, note: i.note ?? null, optionId: i.optionId || null })),
      fulfillment: body.fulfillment,
      phone,
      carDescription: body.carDescription ?? null,
      deliveryAddress: body.deliveryAddress ?? null,
      deliveryLat: body.deliveryLat ?? null,
      deliveryLng: body.deliveryLng ?? null,
      note: body.note ?? null,
      useReward: body.useReward,
      idempotencyKey: body.idempotencyKey,
      timeZone: BUSINESS_TIME_ZONE,
    });
    if (!result.ok || !result.order_id) throwOrderError(result);
    const order = await ownOrder(c, result.order_id);
    if (!result.replayed) {
      logger.info("order.placed", { orderId: result.order_id, fulfillment: body.fulfillment });
      // The customer's phone confirms the order was received; staff phones ring.
      const push = { repo, appPush: c.get("deps").appPush, logger };
      runInBackground(c, notifyOrderStatus(push, order).then(() => notifyStaffNewOrder(push, order)));
    }
    return c.json({ order }, result.replayed ? 200 : 201);
  })

  .get("/orders", requireUser, rateLimit("api", "user"), async (c) => {
    const orders = await repoOf(c).listOrders({ customerId: c.get("user").id, scope: "all", limit: 30 });
    return c.json({ items: orders });
  })

  .get("/orders/:id", requireUser, rateLimit("api", "user"), async (c) => {
    const id = parseWith(uuid, c.req.param("id"));
    return c.json({ order: await ownOrder(c, id) });
  })

  .post("/orders/:id/:action{cancel|arrived}", requireUser, rateLimit("api", "user"), async (c) => {
    const id = parseWith(uuid, c.req.param("id"));
    const action = c.req.param("action") as "cancel" | "arrived";
    const result = await repoOf(c).customerOrderAction(c.get("user").id, id, action);
    if (!result.ok) throwOrderError(result);
    c.get("deps").logger.info(`order.customer_${action}`, { orderId: id });
    return c.json({ order: await ownOrder(c, id) });
  })

  // The customer rates a completed order once (1–5 stars, optional comment).
  .post("/orders/:id/rate", requireUser, rateLimit("api", "user"), async (c) => {
    const id = parseWith(uuid, c.req.param("id"));
    const body = await parseJsonBody(c, rateSchema);
    const result = await repoOf(c).rateOrder(c.get("user").id, id, body.rating, body.comment ?? null);
    if (result === "NOT_FOUND") throw new ApiError(404, "ORDER_NOT_FOUND");
    if (result !== "ok") throw new ApiError(409, result);
    c.get("deps").logger.info("order.rated", { orderId: id, rating: body.rating });
    return c.json({ order: await ownOrder(c, id) });
  });
