import { Hono } from "hono";
import { z } from "zod";
import { BUSINESS_TIME_ZONE, DISPLAY_NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../shared/constants";
import { formatRiyadh, normalizeEmail } from "../../shared/format";
import { BROADCAST_BODY_MAX, BROADCAST_TITLE_MAX, type AdminOrder, type OrderHistoryPage } from "../../shared/ordering";
import type { Paginated, TransactionItem } from "../../shared/types";
import { ApiError } from "../http/errors";
import { repoOf, type HonoEnv } from "../http/context";
import { rateLimit, requireRole, requireUser } from "../http/middleware";
import { parseJsonBody, parseWith } from "../http/validation";
import { toCsv } from "../lib/csv";
import { toDashboardStats, toStaffMember, toTransactionItem } from "../loyalty/presenters";
import type { OrderHistoryParams } from "../data/repository";
import { startOfDate, startOfLocalDay } from "../push/daily-summary";
import { sendToTokens } from "../push/order-notifications";

const EXPORT_PAGE = 1000;
const BROADCAST_BATCH = 35;
const BROADCAST_COOLDOWN_MS = 10 * 60 * 1000;

const broadcastSchema = z.object({
  title: z.string().trim().min(1).max(BROADCAST_TITLE_MAX),
  body: z.string().trim().min(1).max(BROADCAST_BODY_MAX),
});
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

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Order history filters: state, a period of local days (both ends included) and a search. */
const historyQuery = z.object({
  status: z.enum(["all", "active", "ended", "completed", "cancelled"]).optional().default("all"),
  from: localDate.optional(),
  to: localDate.optional(),
  q: z.string().trim().max(80).optional(),
});

function historyFilter(query: z.infer<typeof historyQuery>): Omit<OrderHistoryParams, "limit" | "offset"> {
  return {
    from: query.from ? startOfDate(query.from, BUSINESS_TIME_ZONE) : null,
    to: query.to ? startOfDate(query.to, BUSINESS_TIME_ZONE, 1) : null,
    status: query.status,
    search: query.q || null,
  };
}

const HISTORY_EXPORT_PAGE = 200;
const HISTORY_EXPORT_MAX_PAGES = 50; // 10k orders

const riyals = (halalas: number) => (halalas / 100).toFixed(2);
const riyadh = (iso: string | null) => (iso ? formatRiyadh(iso) : "");

function orderCsvRow(o: AdminOrder): unknown[] {
  const lr = o.loyaltyResult;
  return [
    o.orderNumber,
    o.id,
    o.createdAt,
    riyadh(o.createdAt),
    o.status,
    o.fulfillment,
    o.customerName,
    o.customerPhone,
    o.memberId ?? "",
    o.items
      .map((l) => `${l.quantity}× ${l.nameAr}${l.optionNameAr ? ` (${l.optionNameAr})` : ""}${l.note ? ` [${l.note}]` : ""}`)
      .join(" | "),
    o.items.reduce((n, l) => n + l.quantity, 0),
    o.note ?? "",
    o.carDescription ?? "",
    o.deliveryAddress ?? "",
    o.deliveryLat ?? "",
    o.deliveryLng ?? "",
    riyals(o.subtotalHalalas),
    riyals(o.deliveryFeeHalalas),
    riyals(o.discountHalalas),
    riyals(o.totalHalalas),
    o.paymentMethod,
    o.useReward ? "yes" : "no",
    lr && !lr.skipped ? lr.cupsAdded : "",
    lr?.redeem ?? "",
    riyadh(o.acceptedAt),
    riyadh(o.readyAt),
    riyadh(o.outForDeliveryAt),
    riyadh(o.customerArrivedAt),
    riyadh(o.completedAt),
    o.completedByName ?? "",
    riyadh(o.cancelledAt),
    o.cancelledBy ?? "",
    o.cancelReason ?? "",
    o.rating ?? "",
    o.ratingComment ?? "",
  ];
}

const ORDER_CSV_HEADER = [
  "order_number",
  "order_id",
  "created_at_utc",
  "created_at_riyadh",
  "status",
  "fulfillment",
  "customer_name",
  "customer_phone",
  "member_id",
  "items",
  "item_count",
  "order_note",
  "car",
  "delivery_address",
  "delivery_lat",
  "delivery_lng",
  "subtotal_sar",
  "delivery_fee_sar",
  "discount_sar",
  "total_sar",
  "payment_method",
  "used_free_drink",
  "cups_added",
  "free_drink_result",
  "accepted_at_riyadh",
  "ready_at_riyadh",
  "out_for_delivery_at_riyadh",
  "customer_arrived_at_riyadh",
  "completed_at_riyadh",
  "completed_by",
  "cancelled_at_riyadh",
  "cancelled_by",
  "cancel_reason",
  "rating",
  "rating_comment",
];

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

  .post("/staff/:id/remove", async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const result = await repoOf(c).removeStaffUser(id);
    if (!result.ok) {
      if (result.code === "NOT_FOUND") throw new ApiError(404, "NOT_FOUND");
      if (result.code === "ALREADY_REMOVED") throw new ApiError(409, "INVALID_REQUEST", undefined, "تم حذف هذا الموظف مسبقًا");
      throw new ApiError(400, "INVALID_REQUEST", undefined, "يمكن حذف حسابات الموظفين فقط");
    }
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
  })

  // Order history: every order, open or finished, with all its details.
  .get("/orders", async (c) => {
    const query = parseWith(historyQuery, c.req.query());
    const { page, pageSize } = parseWith(pageQuery, c.req.query());
    const result = await repoOf(c).orderHistory({ ...historyFilter(query), limit: pageSize, offset: (page - 1) * pageSize });
    const body: OrderHistoryPage = { ...result, page, pageSize };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  })

  .get("/export/orders.csv", async (c) => {
    const filter = historyFilter(parseWith(historyQuery, c.req.query()));
    const repo = repoOf(c);
    const rows: unknown[][] = [];
    for (let p = 0; p < HISTORY_EXPORT_MAX_PAGES; p++) {
      const { items } = await repo.orderHistory({ ...filter, limit: HISTORY_EXPORT_PAGE, offset: p * HISTORY_EXPORT_PAGE });
      rows.push(...items.map(orderCsvRow));
      if (items.length < HISTORY_EXPORT_PAGE) break;
    }
    return csvResponse(`hollow-orders-${stamp(c.get("deps").now())}.csv`, toCsv(ORDER_CSV_HEADER, rows));
  })

  // Sales dashboard. "today" compares with yesterday up to the same time;
  // 7d / 30d compare with the 7 / 30 days before.
  .get("/sales", async (c) => {
    const range = parseWith(z.enum(["today", "7d", "30d"]).default("7d"), c.req.query("range"));
    const now = c.get("deps").now();
    const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
    const from = startOfLocalDay(now, BUSINESS_TIME_ZONE, days - 1);
    const span = days * 24 * 60 * 60 * 1000;
    const prevFrom = new Date(from.getTime() - span);
    const prevTo = new Date(now.getTime() - span);
    c.header("Cache-Control", "no-store");
    return c.json(await repoOf(c).salesReport(range, from, now, prevFrom, prevTo, BUSINESS_TIME_ZONE));
  })

  .get("/ratings", async (c) => {
    return c.json(await repoOf(c).ratingOverview(30));
  })

  // Offers: the admin writes a message, then the page sends it in batches
  // (one request per batch keeps each Worker call under the subrequest limit).
  .get("/broadcasts", async (c) => {
    const repo = repoOf(c);
    const [items, recipients] = await Promise.all([repo.listBroadcasts(5), repo.offerPushCount()]);
    return c.json({ items, recipients });
  })

  .post("/broadcasts", async (c) => {
    const { title, body } = await parseJsonBody(c, broadcastSchema);
    const repo = repoOf(c);
    const { now } = c.get("deps");
    const [last] = await repo.listBroadcasts(1);
    if (last && now().getTime() - new Date(last.createdAt).getTime() < BROADCAST_COOLDOWN_MS) {
      throw new ApiError(429, "BROADCAST_TOO_SOON");
    }
    const recipients = await repo.offerPushCount();
    if (recipients === 0) throw new ApiError(409, "NO_RECIPIENTS");
    const broadcast = await repo.createBroadcast({ title, body, sentBy: c.get("user").id, recipients });
    c.get("deps").logger.info("broadcast.created", { id: broadcast.id, recipients });
    return c.json({ broadcast }, 201);
  })

  .post("/broadcasts/:id/send", async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const { after } = await parseJsonBody(c, z.object({ after: z.string().regex(/^[0-9a-f]{64,200}$/).nullable() }));
    const deps = c.get("deps");
    const repo = repoOf(c);
    const broadcast = await repo.getBroadcast(id);
    if (!broadcast) throw new ApiError(404, "NOT_FOUND");
    if (deps.appPush.kind === "disabled") throw new ApiError(503, "CONFIG_ERROR");
    const tokens = await repo.offerPushTokens(after, BROADCAST_BATCH);
    const delivered = await sendToTokens({ repo, appPush: deps.appPush, logger: deps.logger }, tokens, {
      title: broadcast.title,
      body: broadcast.body,
      collapseId: `offer-${broadcast.id}`,
      data: { link: "menu" },
    });
    const sent = broadcast.sent + delivered;
    await repo.setBroadcastSent(id, sent);
    const next = tokens.length === BROADCAST_BATCH ? tokens[tokens.length - 1]! : null;
    if (!next) deps.logger.info("broadcast.sent", { id, sent, recipients: broadcast.recipients });
    return c.json({ sent, next });
  });
