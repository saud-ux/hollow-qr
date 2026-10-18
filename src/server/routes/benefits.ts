import { Hono } from "hono";
import { z } from "zod";
import { repoOf, type HonoEnv } from "../http/context";
import { requireUser, rateLimit } from "../http/middleware";
import { parseJsonBody } from "../http/validation";
import { ApiError } from "../http/errors";

const request = z.object({
  action: z.enum([
    "account",
    "quote",
    "coupons",
    "save_coupon",
    "adjust",
    "spend",
    "gift_items",
    "save_gift_items",
  ]),
  data: z.record(z.string(), z.unknown()).optional().default({}),
});
export const benefitRoutes = new Hono<HonoEnv>().post(
  "/benefits",
  requireUser,
  rateLimit("api", "user"),
  async (c) => {
    const body = await parseJsonBody(c, request);
    const user = c.get("user");
    const adminActions = [
      "coupons",
      "save_coupon",
      "adjust",
      "save_gift_items",
    ];
    if (adminActions.includes(body.action) && user.role !== "admin")
      throw new ApiError(403, "FORBIDDEN");
    if (body.action === "spend" && user.role === "customer")
      throw new ApiError(403, "FORBIDDEN");
    // Actor identity always comes from the verified JWT, never the request body.
    const result = (await repoOf(c).benefits(
      body.action,
      user.id,
      body.data,
    )) as { ok?: boolean; code?: string };
    if (result.ok === false)
      throw new ApiError(
        result.code === "FORBIDDEN" ? 403 : 409,
        result.code ?? "INVALID_REQUEST",
      );
    return c.json(result);
  },
);
