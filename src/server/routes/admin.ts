import { Hono } from "hono";
import { z } from "zod";
import { BUSINESS_TIME_ZONE, DISPLAY_NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../shared/constants";
import { formatRiyadh, normalizeEmail } from "../../shared/format";
import type { Paginated, TransactionItem } from "../../shared/types";
import { ApiError } from "../http/errors";
import { repoOf, type HonoEnv } from "../http/context";
import { rateLimit, requireRole, requireUser } from "../http/middleware";
import { parseJsonBody, parseWith } from "../http/validation";
import { toCsv } from "../lib/csv";
import { toDashboardStats, toStaffMember, toTransactionItem } from "../loyalty/presenters";

const EXPORT_PAGE = 1000;
const EXPORT_MAX_PAGES = 40; // 40k rows; stays well under Workers subrequest limits

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "password must contain letters and digits");

const createStaffSchema = z.object({
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  email: z.email().max(254).transform(normalizeEmail),
  password: passwordSchema,
});

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function stamp(now: Date): string {
  return formatRiyadh(now.toISOString()).slice(0, 10);
}

export const adminRoutes = new Hono<HonoEnv>()
  .use("*", requireUser, requireRole("admin"), rateLimit("api", "user"))

  .get("/stats", async (c) => {
    const stats = await repoOf(c).getDashboardStats(BUSINESS_TIME_ZONE);
    return c.json(toDashboardStats(stats));
  })

  .get("/customers/:id/transactions", async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const { page, pageSize } = parseWith(pageQuery, c.req.query());
    const { rows, total } = await repoOf(c).listTransactions(id, pageSize, (page - 1) * pageSize);
    const body: Paginated<TransactionItem> = { items: rows.map(toTransactionItem), total, page, pageSize };
    return c.json(body);
  })

  .get("/staff", async (c) => {
    const staff = await repoOf(c).listStaff();
    return c.json({ items: staff.map(toStaffMember) });
  })

  .post("/staff", async (c) => {
    const body = await parseJsonBody(c, createStaffSchema);
    const result = await repoOf(c).createStaffUser(body);
    if (!result.ok) {
      throw new ApiError(result.code === "EMAIL_EXISTS" ? 409 : 400, result.code === "EMAIL_EXISTS" ? "EMAIL_EXISTS" : "INVALID_REQUEST");
    }
    c.get("deps").logger.info("admin.staff_created", { actor: c.get("user").id, staffUserId: result.userId });
    return c.json({ id: result.userId }, 201);
  })

  .delete("/staff/:id", async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const repo = repoOf(c);
    const target = await repo.getProfile(id);
    if (!target || target.role === "customer") throw new ApiError(404, "STAFF_NOT_FOUND");
    // Admins (including the caller) are never removed from the dashboard.
    if (target.role === "admin") throw new ApiError(403, "CANNOT_REMOVE_ADMIN");
    const result = await repo.removeStaffUser(id);
    if (!result.ok) throw new ApiError(404, "STAFF_NOT_FOUND");
    c.get("deps").logger.info("admin.staff_removed", { actor: c.get("user").id, staffUserId: id });
    return c.json({ ok: true });
  })

  .get("/export/customers.csv", async (c) => {
    const repo = repoOf(c);
    const rows: unknown[][] = [];
    for (let page = 0; page < EXPORT_MAX_PAGES; page++) {
      const { rows: batch } = await repo.searchCustomers("", EXPORT_PAGE, page * EXPORT_PAGE, true);
      for (const r of batch) {
        rows.push([
          r.memberId,
          r.displayName,
          r.email,
          r.stampCount,
          r.rewardAvailable ? "yes" : "no",
          r.membershipStatus,
          r.createdAt,
          formatRiyadh(r.createdAt),
          r.lastMutationAt ?? "",
          formatRiyadh(r.lastMutationAt),
        ]);
      }
      if (batch.length < EXPORT_PAGE) break;
    }
    const csv = toCsv(
      [
        "member_id",
        "name",
        "email",
        "stamp_count",
        "reward_available",
        "membership_status",
        "created_at_utc",
        "created_at_riyadh",
        "last_activity_utc",
        "last_activity_riyadh",
      ],
      rows,
    );
    return csvResponse(`hollow-customers-${stamp(c.get("deps").now())}.csv`, csv);
  })

  .get("/export/transactions.csv", async (c) => {
    const repo = repoOf(c);
    const rows: unknown[][] = [];
    for (let page = 0; page < EXPORT_MAX_PAGES; page++) {
      const { rows: batch } = await repo.listTransactions(null, EXPORT_PAGE, page * EXPORT_PAGE);
      for (const t of batch) {
        rows.push([
          t.id,
          t.createdAt,
          formatRiyadh(t.createdAt),
          t.memberId,
          t.customerName,
          t.action,
          t.quantity,
          t.delta,
          t.previousStampCount,
          t.newStampCount,
          t.previousRewardAvailable ? "yes" : "no",
          t.newRewardAvailable ? "yes" : "no",
          t.previousMembershipStatus,
          t.newMembershipStatus,
          t.actorName,
          t.actorRole,
          t.reversalOf ?? "",
          t.reversedBy ?? "",
        ]);
      }
      if (batch.length < EXPORT_PAGE) break;
    }
    const csv = toCsv(
      [
        "transaction_id",
        "created_at_utc",
        "created_at_riyadh",
        "member_id",
        "customer_name",
        "action",
        "quantity",
        "delta",
        "previous_stamp_count",
        "new_stamp_count",
        "previous_reward_available",
        "new_reward_available",
        "previous_membership_status",
        "new_membership_status",
        "actor_name",
        "actor_role",
        "reversal_of",
        "reversed_by",
      ],
      rows,
    );
    return csvResponse(`hollow-transactions-${stamp(c.get("deps").now())}.csv`, csv);
  });
