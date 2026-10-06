import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Broadcast, MenuResponse, NotificationPrefs, Order, RatingOverview } from "../../src/shared/ordering";
import type { MockAppPushSender } from "../../src/server/push/app-push";
import { justClosedShift, runDailySummary } from "../../src/server/push/daily-summary";
import { silentLogger } from "../../src/server/lib/logger";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));
const TZ = "Asia/Riyadh";

let db: PGlite;
let built: ReturnType<typeof buildTestApp>;
let app: ReturnType<typeof buildTestApp>["app"];
let appPush: MockAppPushSender;
let staffId: string;
let adminId: string;
let drinkId: string;
let n = 0;

const token = (seed: number) => (seed + 0x40).toString(16).padStart(2, "0").repeat(32);

function send(method: string, path: string, body: unknown, userId: string) {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json", ...bearer(userId) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const get = (path: string, userId: string) => app.request(path, { headers: bearer(userId) });

async function newCustomer() {
  n += 1;
  return (await createAuthUser(db, { email: `owner${n}@example.com`, name: `عميل ${n}` })).id;
}

async function placeOrder(customerId: string): Promise<Order> {
  const res = await send(
    "POST",
    "/api/orders",
    { items: [{ menuItemId: drinkId, quantity: 2 }], fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID() },
    customerId,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { order: Order }).order;
}

async function complete(orderId: string) {
  for (const status of ["preparing", "ready", "completed"]) {
    expect((await send("POST", `/api/staff/orders/${orderId}/status`, { status }, staffId)).status).toBe(200);
  }
}

beforeAll(async () => {
  db = await createTestDb();
  built = buildTestApp(db);
  app = built.app;
  appPush = built.appPush as MockAppPushSender;
  staffId = (await createAuthUser(db, { email: "staff@owner.test", name: "Staff", role: "staff" })).id;
  adminId = (await createAuthUser(db, { email: "admin@owner.test", name: "Admin", role: "admin" })).id;
  expect((await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, adminId)).status).toBe(200);
  const menu = (await (await app.request("/api/menu")).json()) as MenuResponse;
  drinkId = menu.items.find((i) => i.category === "drink" && i.options.length === 0)!.id;
});

describe("calories", () => {
  it("are set by the admin and shown on the menu", async () => {
    expect((await send("PATCH", `/api/admin/menu/${drinkId}`, { calories: 120 }, adminId)).status).toBe(200);
    expect((await send("PATCH", `/api/admin/menu/${drinkId}`, { calories: -5 }, adminId)).status).toBe(400);
    const menu = (await (await app.request("/api/menu")).json()) as MenuResponse;
    expect(menu.items.find((i) => i.id === drinkId)!.calories).toBe(120);
    expect(menu.items.find((i) => i.id !== drinkId)!.calories).toBeNull();
  });
});

describe("order ratings", () => {
  it("lets the customer rate a completed order once and shows it to the admin", async () => {
    const customer = await newCustomer();
    const order = await placeOrder(customer);
    const early = await send("POST", `/api/orders/${order.id}/rate`, { rating: 5 }, customer);
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: { code: "NOT_COMPLETED" } });

    await complete(order.id);
    expect((await send("POST", `/api/orders/${order.id}/rate`, { rating: 6 }, customer)).status).toBe(400);
    const stranger = await newCustomer();
    expect((await send("POST", `/api/orders/${order.id}/rate`, { rating: 5 }, stranger)).status).toBe(404);

    const ok = await send("POST", `/api/orders/${order.id}/rate`, { rating: 4, comment: "  القهوة ممتازة  " }, customer);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { order: Order }).order).toMatchObject({ rating: 4, ratingComment: "القهوة ممتازة" });
    const again = await send("POST", `/api/orders/${order.id}/rate`, { rating: 1 }, customer);
    expect(await again.json()).toMatchObject({ error: { code: "ALREADY_RATED" } });

    expect((await get("/api/admin/ratings", staffId)).status).toBe(403);
    const overview = (await (await get("/api/admin/ratings", adminId)).json()) as RatingOverview;
    expect(overview).toMatchObject({ count: 1, average: 4 });
    expect(overview.items[0]).toMatchObject({ orderNumber: order.orderNumber, rating: 4, comment: "القهوة ممتازة" });

    // Deleting the account drops the comment, keeps the stars.
    expect((await send("POST", "/api/me/delete", { confirm: "DELETE" }, customer)).status).toBe(200);
    const after = (await (await get("/api/admin/ratings", adminId)).json()) as RatingOverview;
    expect(after.items[0]).toMatchObject({ rating: 4, comment: null });
  });
});

describe("notification preferences", () => {
  it("default to offers off and staff alerts on, and can be changed", async () => {
    const customer = await newCustomer();
    const res = await get("/api/me/notification-prefs", customer);
    expect(((await res.json()) as { prefs: NotificationPrefs }).prefs).toEqual({ offers: false, newOrders: true, dailySummary: true });
    const put = await send("PUT", "/api/me/notification-prefs", { offers: true }, customer);
    expect(((await put.json()) as { prefs: NotificationPrefs }).prefs).toEqual({ offers: true, newOrders: true, dailySummary: true });
    expect((await send("PUT", "/api/me/notification-prefs", {}, customer)).status).toBe(400);
  });
});

describe("new-order alerts", () => {
  it("ring staff and admin phones that keep alerts on", async () => {
    await send("POST", "/api/me/push-devices", { token: token(1) }, staffId);
    await send("POST", "/api/me/push-devices", { token: token(2) }, adminId);
    const customer = await newCustomer();
    await send("POST", "/api/me/push-devices", { token: token(3) }, customer);

    const order = await placeOrder(customer);
    const staffPushes = () => appPush.sent.filter((p) => p.message.collapseId === `staff-${order.id}`);
    await vi.waitFor(() => expect(staffPushes()).toHaveLength(2));
    expect(new Set(staffPushes().map((p) => p.token))).toEqual(new Set([token(1), token(2)]));
    expect(staffPushes()[0]!.message.title).toBe(`طلب جديد #${order.orderNumber}`);
    expect(staffPushes()[0]!.message.body).toContain("استلام من الكاشير");
    expect(staffPushes()[0]!.message.data).toEqual({ link: "staff-orders" });

    // The admin turns alerts off: only the staff phone rings.
    await send("PUT", "/api/me/notification-prefs", { newOrders: false }, adminId);
    const second = await placeOrder(customer);
    await vi.waitFor(() => expect(appPush.sent.filter((p) => p.message.collapseId === `staff-${second.id}`)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(appPush.sent.filter((p) => p.message.collapseId === `staff-${second.id}`).map((p) => p.token)).toEqual([token(1)]);
    await send("PUT", "/api/me/notification-prefs", { newOrders: true }, adminId);
  });
});

describe("offer broadcasts", () => {
  it("reach only people who opted in, in batches, with a cooldown", async () => {
    const fresh = await createTestDb();
    const local = buildTestApp(fresh);
    const localPush = local.appPush as MockAppPushSender;
    const admin = (await createAuthUser(fresh, { email: "a@offers.test", name: "Admin", role: "admin" })).id;
    const req = (method: string, path: string, body: unknown, userId: string) =>
      local.app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });

    expect((await req("POST", "/api/admin/broadcasts", { title: "HOLLOW", body: "عرض اليوم" }, admin)).status).toBe(409);

    // 40 opted-in customers (more than one batch) and one who did not opt in.
    const optedIn: string[] = [];
    for (let i = 0; i < 40; i++) {
      const id = (await createAuthUser(fresh, { email: `c${i}@offers.test`, name: `C${i}` })).id;
      await req("POST", "/api/me/push-devices", { token: token(10 + i) }, id);
      await req("PUT", "/api/me/notification-prefs", { offers: true }, id);
      optedIn.push(token(10 + i));
    }
    const quiet = (await createAuthUser(fresh, { email: "quiet@offers.test", name: "Quiet" })).id;
    await req("POST", "/api/me/push-devices", { token: token(99) }, quiet);

    const list = (await (await local.app.request("/api/admin/broadcasts", { headers: bearer(admin) })).json()) as { recipients: number };
    expect(list.recipients).toBe(40);
    expect((await req("POST", "/api/admin/broadcasts", { title: "HOLLOW", body: "" }, admin)).status).toBe(400);

    const created = await req("POST", "/api/admin/broadcasts", { title: "HOLLOW", body: "وافل بيكان بـ 12 ريال اليوم" }, admin);
    expect(created.status).toBe(201);
    const { broadcast } = (await created.json()) as { broadcast: Broadcast };
    expect(broadcast.recipients).toBe(40);

    let after: string | null = null;
    let rounds = 0;
    let sent: number;
    do {
      const res = await req("POST", `/api/admin/broadcasts/${broadcast.id}/send`, { after }, admin);
      expect(res.status).toBe(200);
      ({ sent, next: after } = (await res.json()) as { sent: number; next: string | null });
      rounds++;
    } while (after && rounds < 5);
    expect(rounds).toBe(2);
    expect(sent).toBe(40);
    const delivered = localPush.sent.filter((p) => p.message.collapseId === `offer-${broadcast.id}`);
    expect(delivered.map((p) => p.token).sort()).toEqual(optedIn.sort());
    expect(delivered[0]!.message).toMatchObject({ title: "HOLLOW", body: "وافل بيكان بـ 12 ريال اليوم", data: { link: "menu" } });

    const tooSoon = await req("POST", "/api/admin/broadcasts", { title: "HOLLOW", body: "عرض ثاني" }, admin);
    expect(tooSoon.status).toBe(429);
    const customer = (await createAuthUser(fresh, { email: "x@offers.test", name: "X" })).id;
    expect((await req("POST", "/api/admin/broadcasts", { title: "HOLLOW", body: "x" }, customer)).status).toBe(403);
  });
});

describe("daily summary", () => {
  const hours = (open: string, close: string, closedDay?: number) =>
    Array.from({ length: 7 }, (_, i) => ({ closed: i === closedDay, open, close }));

  it("finds the shift that closed within the last hour", () => {
    // 2026-10-06 is a Tuesday. Riyadh is UTC+3.
    const shift = justClosedShift(new Date("2026-10-06T20:05:00Z"), hours("07:00", "23:00"), TZ);
    expect(shift).toEqual({
      businessDate: "2026-10-06",
      from: new Date("2026-10-06T04:00:00Z"),
      to: new Date("2026-10-06T20:00:00Z"),
    });
    expect(justClosedShift(new Date("2026-10-06T19:55:00Z"), hours("07:00", "23:00"), TZ)).toBeNull();
    expect(justClosedShift(new Date("2026-10-06T21:30:00Z"), hours("07:00", "23:00"), TZ)).toBeNull();
    // Closing at midnight belongs to the day the shift opened.
    expect(justClosedShift(new Date("2026-10-06T21:05:00Z"), hours("07:00", "00:00"), TZ)?.businessDate).toBe("2026-10-06");
    // Past midnight: 18:00 → 02:00 closes on Wednesday morning, local.
    expect(justClosedShift(new Date("2026-10-06T23:05:00Z"), hours("18:00", "02:00"), TZ)?.businessDate).toBe("2026-10-06");
    // A closed day sends nothing (Tuesday = 2).
    expect(justClosedShift(new Date("2026-10-06T20:05:00Z"), hours("07:00", "23:00", 2), TZ)).toBeNull();
  });

  it("sends admins one summary per day with the completed orders", async () => {
    const fresh = await createTestDb();
    const local = buildTestApp(fresh);
    const localPush = local.appPush as MockAppPushSender;
    const admin = (await createAuthUser(fresh, { email: "a@summary.test", name: "Admin", role: "admin" })).id;
    const staff = (await createAuthUser(fresh, { email: "s@summary.test", name: "Staff", role: "staff" })).id;
    const req = (method: string, path: string, body: unknown, userId: string) =>
      local.app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });
    await req("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, admin);
    await req("POST", "/api/me/push-devices", { token: token(1) }, admin);
    await req("POST", "/api/me/push-devices", { token: token(2) }, staff);
    const menu = (await (await local.app.request("/api/menu")).json()) as MenuResponse;
    const item = menu.items.find((i) => i.category === "drink" && i.options.length === 0)!;

    const customer = (await createAuthUser(fresh, { email: "c@summary.test", name: "C" })).id;
    for (let i = 0; i < 2; i++) {
      const res = await req(
        "POST",
        "/api/orders",
        { items: [{ menuItemId: item.id, quantity: 3 }], fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID() },
        customer,
      );
      const { order } = (await res.json()) as { order: Order };
      if (i === 0) for (const status of ["preparing", "ready", "completed"]) await req("POST", `/api/staff/orders/${order.id}/status`, { status }, staff);
      else await req("POST", `/api/staff/orders/${order.id}/status`, { status: "cancelled", cancelReason: "نفد" }, staff);
    }

    // Open until 23:00 Riyadh today; run 5 minutes after closing.
    const now = new Date();
    const riyadh = new Date(now.getTime() + 3 * 3600_000);
    const day = riyadh.getUTCDay();
    const weeklyHours = Array.from({ length: 7 }, () => ({ closed: true, open: "00:00", close: "00:00" }));
    weeklyHours[day] = { closed: false, open: "00:00", close: "23:59" };
    await req("PUT", "/api/admin/settings", { weeklyHours }, admin);
    const close = new Date(Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), riyadh.getUTCDate(), 23, 59) - 3 * 3600_000);
    const at = new Date(close.getTime() + 5 * 60_000);

    const deps = { repo: local.repo, appPush: localPush, logger: silentLogger };
    expect(await runDailySummary(deps, new Date(close.getTime() - 60_000), TZ)).toBe("not-yet");
    expect(await runDailySummary(deps, at, TZ)).toBe("sent");
    expect(await runDailySummary(deps, at, TZ)).toBe("already-sent");

    const summaries = localPush.sent.filter((p) => p.message.title === "ملخص اليوم");
    expect(summaries.map((p) => p.token)).toEqual([token(1)]);
    expect(summaries[0]!.message.body).toContain("1 طلب مكتمل");
    expect(summaries[0]!.message.body).toContain(`الأكثر طلبًا: ${item.nameAr} (3)`);
    expect(summaries[0]!.message.body).toContain("1 ملغي");
  });
});
