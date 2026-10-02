import { Hono } from "hono";
import { z } from "zod";
import { MAX_STAMPS } from "../../shared/constants";
import { normalizeMemberId } from "../../shared/format";
import type { Paginated, StaffActionResponse, StaffCustomerView, TransactionItem, CustomerSearchItem } from "../../shared/types";
import type { AccountRow } from "../data/repository";
import { ApiError, statusForLoyaltyCode } from "../http/errors";
import { repoOf, runInBackground, walletOf, type AppContext, type HonoEnv } from "../http/context";
import { rateLimit, requireRole, requireUser } from "../http/middleware";
import { parseJsonBody, parseWith } from "../http/validation";
import { toSearchItem, toStaffCustomerView, toTransactionItem } from "../loyalty/presenters";
import { extractQrToken, verifyQrToken } from "../security/tokens";

const uuid = z.uuid();
const pageQuery = z.object({
  q: z.string().trim().max(80).optional().default(""),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const base = { idempotencyKey: uuid, confirmRecent: z.boolean().optional().default(false) };
export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ADD_CUPS"), quantity: z.number().int().min(1).max(MAX_STAMPS), ...base }),
  z.object({ action: z.literal("REMOVE_CUPS"), quantity: z.number().int().min(1).max(MAX_STAMPS).optional().default(1), ...base }),
  z.object({ action: z.literal("REDEEM_REWARD"), ...base }),
  z.object({ action: z.literal("UNDO"), ...base }),
  z.object({ action: z.literal("CANCEL_MEMBERSHIP"), ...base }),
  z.object({ action: z.literal("REACTIVATE_MEMBERSHIP"), ...base }),
  z.object({ action: z.literal("ADMIN_ADJUSTMENT"), targetStampCount: z.number().int().min(0).max(MAX_STAMPS), ...base }),
]);

const ADMIN_ONLY = new Set(["CANCEL_MEMBERSHIP", "REACTIVATE_MEMBERSHIP", "ADMIN_ADJUSTMENT"]);

export async function buildCustomerView(c: AppContext, account: AccountRow): Promise<StaffCustomerView> {
  const user = c.get("user");
  const repo = repoOf(c);
  const [recent, devices] = await Promise.all([
    repo.listTransactions(account.id, 10, 0),
    user.role === "admin" ? repo.walletDeviceCount(account.passSerial) : Promise.resolve(null),
  ]);
  return toStaffCustomerView(account, user.role, recent.rows, devices);
}

/** Resolves scanned QR text or a typed member ID to an account. */
async function resolveCode(c: AppContext, code: string): Promise<AccountRow | null> {
  const repo = repoOf(c);
  const memberId = normalizeMemberId(code);
  if (memberId) return repo.getAccountByMemberId(memberId);
  const token = extractQrToken(code);
  if (!token) return null;
  const qrTokenId = await verifyQrToken(c.get("deps").config.qrTokenSecret, token);
  if (!qrTokenId) return null; // forged / malformed: rejected before any DB lookup
  return repo.getAccountByQrTokenId(qrTokenId);
}

export const staffRoutes = new Hono<HonoEnv>()
  .use("*", requireUser, requireRole("staff", "admin"), rateLimit("api", "user"))

  .post("/resolve", async (c) => {
    const { code } = await parseJsonBody(c, z.object({ code: z.string().min(1).max(512) }));
    const account = await resolveCode(c, code);
    if (!account) throw new ApiError(404, "INVALID_CODE");
    return c.json({ customer: await buildCustomerView(c, account) });
  })

  .get("/customers", async (c) => {
    const { q, page, pageSize } = parseWith(pageQuery, c.req.query());
    const user = c.get("user");
    const { rows, total } = await repoOf(c).searchCustomers(q, pageSize, (page - 1) * pageSize, user.role === "admin");
    const body: Paginated<CustomerSearchItem> = {
      items: rows.map((r) => toSearchItem(r, user.role)),
      total,
      page,
      pageSize,
    };
    return c.json(body);
  })

  .get("/customers/:id", async (c) => {
    const id = parseWith(uuid, c.req.param("id"));
    const account = await repoOf(c).getAccountById(id);
    if (!account) throw new ApiError(404, "NOT_FOUND");
    return c.json({ customer: await buildCustomerView(c, account) });
  })

  .post("/customers/:id/actions", async (c) => {
    const id = parseWith(uuid, c.req.param("id"));
    const body = await parseJsonBody(c, actionSchema);
    const user = c.get("user");
    const { config, logger } = c.get("deps");
    if (ADMIN_ONLY.has(body.action) && user.role !== "admin") throw new ApiError(403, "FORBIDDEN");

    const repo = repoOf(c);
    const result = await repo.applyLoyaltyAction({
      actorId: user.id,
      accountId: id,
      action: body.action,
      quantity: "quantity" in body ? body.quantity : null,
      targetStampCount: "targetStampCount" in body ? body.targetStampCount : null,
      idempotencyKey: body.idempotencyKey,
      confirmRecent: body.confirmRecent,
      recentWindowSeconds: config.duplicateWindowSeconds,
      source: "dashboard",
    });

    if (!result.ok) {
      const code = result.code ?? "INTERNAL";
      const details: Record<string, unknown> = {};
      if (result.remaining !== undefined) details.remaining = result.remaining;
      if (result.current !== undefined) details.current = result.current;
      if (result.seconds_ago !== undefined) details.secondsAgo = result.seconds_ago;
      if (result.last_action) details.lastAction = result.last_action;
      if (result.last_quantity !== undefined && result.last_quantity !== null) details.lastQuantity = result.last_quantity;
      throw new ApiError(statusForLoyaltyCode(code), code, Object.keys(details).length ? details : undefined);
    }

    const account = await repo.getAccountById(id);
    if (!account) throw new ApiError(404, "NOT_FOUND");

    if (!result.replayed) {
      logger.info("loyalty.mutation", {
        action: body.action,
        actorRole: user.role,
        transactionId: result.transaction_id,
      });
      // Update the Wallet pass on every registered device (after response).
      runInBackground(c, walletOf(c).passChanged(account.passSerial));
    }

    const response: StaffActionResponse = {
      transactionId: result.transaction_id ?? "",
      replayed: Boolean(result.replayed),
      action: body.action,
      previousStampCount: result.previous_stamp_count ?? account.stampCount,
      newStampCount: account.stampCount,
      rewardAvailable: account.rewardAvailable,
      customer: await buildCustomerView(c, account),
    };
    return c.json(response);
  })

  .get("/activity", async (c) => {
    const { page, pageSize } = parseWith(pageQuery, c.req.query());
    const { rows, total } = await repoOf(c).listTransactions(null, pageSize, (page - 1) * pageSize);
    const body: Paginated<TransactionItem> = { items: rows.map(toTransactionItem), total, page, pageSize };
    return c.json(body);
  });
