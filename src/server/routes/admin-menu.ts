import { Hono } from "hono";
import { z } from "zod";
import { BUSINESS_TIME_ZONE } from "../../shared/constants";
import { isValidHhMm, MAX_MENU_OPTIONS, MENU_IMAGE_MAX_BYTES } from "../../shared/ordering";
import { ApiError } from "../http/errors";
import { repoOf, type HonoEnv } from "../http/context";
import { rateLimit, requireRole, requireUser } from "../http/middleware";
import { parseJsonBody, parseWith } from "../http/validation";
import { toMenuItem } from "./orders";

const uuid = z.uuid();
const halalas = z.number().int().min(0).max(100_000);

const itemFields = {
  nameAr: z.string().trim().min(1).max(60),
  nameEn: z
    .string()
    .trim()
    .max(60)
    .nullable()
    .transform((v) => (v ? v : null)),
  descriptionAr: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .transform((v) => (v ? v : null)),
  category: z.enum(["drink", "dessert"]),
  priceHalalas: halalas,
  isAvailable: z.boolean(),
  isArchived: z.boolean(),
  sortOrder: z.number().int().min(0).max(100_000),
  optionLabel: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .transform((v) => (v ? v : null)),
  options: z
    .array(
      z.object({
        id: z
          .string()
          .trim()
          .regex(/^[a-z0-9-]{1,40}$/),
        nameAr: z.string().trim().min(1).max(40),
        noteAr: z
          .string()
          .trim()
          .max(80)
          .nullable()
          .transform((v) => (v ? v : null)),
        isAvailable: z.boolean(),
      }),
    )
    .max(MAX_MENU_OPTIONS)
    .refine((list) => new Set(list.map((o) => o.id)).size === list.length, "option ids must be unique"),
};

const createItemSchema = z.object({
  ...itemFields,
  nameEn: itemFields.nameEn.optional().default(null),
  descriptionAr: itemFields.descriptionAr.optional().default(null),
  isAvailable: itemFields.isAvailable.optional().default(true),
  isArchived: itemFields.isArchived.optional().default(false),
  sortOrder: itemFields.sortOrder.optional().default(500),
  optionLabel: itemFields.optionLabel.optional().default(null),
  options: itemFields.options.optional().default([]),
});
const updateItemSchema = z.object(itemFields).partial();

const hhmm = z.string().refine(isValidHhMm, "HH:MM");
const settingsSchema = z
  .object({
    orderingPaused: z.boolean(),
    pickupEnabled: z.boolean(),
    curbsideEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    deliveryFeeHalalas: halalas,
    deliveryMinOrderHalalas: z.number().int().min(0).max(1_000_000),
    weeklyHours: z.array(z.object({ closed: z.boolean(), open: hhmm, close: hhmm })).length(7),
  })
  .partial();

const IMAGE_TYPES: Record<string, { ext: string; matches: (b: Uint8Array) => boolean }> = {
  "image/jpeg": { ext: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/webp": {
    ext: "webp",
    matches: (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
};

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Menu, images and shop settings: admins only. */
export const adminMenuRoutes = new Hono<HonoEnv>()
  .use("*", requireUser, requireRole("admin"), rateLimit("api", "user"))

  .get("/menu", async (c) => {
    const { config } = c.get("deps");
    const rows = await repoOf(c).listMenuItems(true);
    return c.json({ items: rows.map((r) => toMenuItem(config, r)) });
  })

  .post("/menu", async (c) => {
    const body = await parseJsonBody(c, createItemSchema);
    const row = await repoOf(c).createMenuItem(body);
    c.get("deps").logger.info("menu.created", { itemId: row.id, actor: c.get("user").id });
    return c.json({ item: toMenuItem(c.get("deps").config, row) }, 201);
  })

  .patch("/menu/:id", async (c) => {
    const id = parseWith(uuid, c.req.param("id"));
    const body = await parseJsonBody(c, updateItemSchema);
    const row = await repoOf(c).updateMenuItem(id, body);
    if (!row) throw new ApiError(404, "NOT_FOUND");
    c.get("deps").logger.info("menu.updated", { itemId: id, actor: c.get("user").id });
    return c.json({ item: toMenuItem(c.get("deps").config, row) });
  })

  // Raw image bytes (the dashboard resizes before upload).
  .put("/menu/:id/image", async (c) => {
    const id = parseWith(uuid, c.req.param("id"));
    const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const kind = IMAGE_TYPES[contentType];
    if (!kind) throw new ApiError(400, "IMAGE_INVALID");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) throw new ApiError(400, "IMAGE_INVALID");
    if (bytes.byteLength > MENU_IMAGE_MAX_BYTES) throw new ApiError(413, "IMAGE_TOO_LARGE");
    if (!kind.matches(bytes)) throw new ApiError(400, "IMAGE_INVALID");

    const repo = repoOf(c);
    const item = await repo.getMenuItem(id);
    if (!item) throw new ApiError(404, "NOT_FOUND");
    // A new path per upload, so browsers and CDNs never show a stale image.
    const path = `items/${id}/${randomSuffix()}.${kind.ext}`;
    await repo.uploadMenuImage(path, bytes, contentType);
    const row = await repo.updateMenuItem(id, { imagePath: path });
    if (item.imagePath) {
      await repo.deleteMenuImage(item.imagePath).catch(() => undefined);
    }
    c.get("deps").logger.info("menu.image_uploaded", { itemId: id, bytes: bytes.byteLength });
    return c.json({ item: toMenuItem(c.get("deps").config, row!) });
  })

  .delete("/menu/:id/image", async (c) => {
    const id = parseWith(uuid, c.req.param("id"));
    const repo = repoOf(c);
    const item = await repo.getMenuItem(id);
    if (!item) throw new ApiError(404, "NOT_FOUND");
    const row = await repo.updateMenuItem(id, { imagePath: null });
    if (item.imagePath) await repo.deleteMenuImage(item.imagePath).catch(() => undefined);
    return c.json({ item: toMenuItem(c.get("deps").config, row!) });
  })

  .get("/settings", async (c) => {
    const repo = repoOf(c);
    const [settings, isOpen] = await Promise.all([repo.getShopSettings(), repo.isShopOpen(BUSINESS_TIME_ZONE)]);
    return c.json({ settings, isOpen });
  })

  .put("/settings", async (c) => {
    const body = await parseJsonBody(c, settingsSchema);
    const repo = repoOf(c);
    const settings = await repo.updateShopSettings(body);
    c.get("deps").logger.info("shop.settings_updated", { actor: c.get("user").id, keys: Object.keys(body) });
    return c.json({ settings, isOpen: await repo.isShopOpen(BUSINESS_TIME_ZONE) });
  });
