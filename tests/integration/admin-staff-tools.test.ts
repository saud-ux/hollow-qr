import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  orderUrgency,
  type Broadcast,
  type MenuResponse,
  type NotificationPrefs,
  type Order,
  type SalesDashboard,
} from "../../src/shared/ordering";
import type { StaffMember } from "../../src/shared/types";
import { silentLogger } from "../../src/server/lib/logger";
import type { MockAppPushSender } from "../../src/server/push/app-push";
import { webPushPayload } from "../../src/server/push/web-push";
import { runScheduledBroadcasts, SCHEDULED_BATCH } from "../../src/server/push/scheduled-broadcasts";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));
const token = (seed: number) => (seed + 0x40).toString(16).padStart(2, "0").repeat(32);

let db: PGlite;
let built: ReturnType<typeof buildTestApp>;
let appPush: MockAppPushSender;
let adminId: string;
let staffId: string;
let drinkId: string;
let n = 0;

function send(method: string, path: string, body: unknown, userId: string) {
  return built.app.request(path, {
    method,
    headers: { "content-type": "application/json", ...bearer(userId) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const get = (path: string, userId: string) => built.app.request(path, { headers: bearer(userId) });

async function newUser(role?: "staff" | "admin") {
  n += 1;
  return (await createAuthUser(db, { email: `tools${n}@example.com`, name: `User ${n}`, role })).id;
}

async function placeOrder(customerId: string): Promise<Order> {
  const res = await send(
    "POST",
    "/api/orders",
    { items: [{ menuItemId: drinkId, quantity: 1 }], fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID() },
    customerId,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { order: Order }).order;
}

async function moveTo(orderId: string, statuses: string[], reason?: string) {
  for (const status of statuses) {
    expect((await send("POST", `/api/staff/orders/${orderId}/status`, { status, cancelReason: reason }, staffId)).status).toBe(200);
  }
}

beforeAll(async () => {
  db = await createTestDb();
  built = buildTestApp(db);
  appPush = built.appPush as MockAppPushSender;
  adminId = await newUser("admin");
  staffId = await newUser("staff");
  expect((await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, adminId)).status).toBe(200);
  const menu = (await (await built.app.request("/api/menu")).json()) as MenuResponse;
  drinkId = menu.items.find((i) => i.category === "drink" && i.options.length === 0)!.id;
});

describe("order board urgency", () => {
  it("turns a ticket yellow at 5 minutes and red at 10", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    const ago = (m: number) => new Date(now - m * 60_000).toISOString();
    expect(orderUrgency(ago(0), now)).toBe("ok");
    expect(orderUrgency(ago(4.9), now)).toBe("ok");
    expect(orderUrgency(ago(5), now)).toBe("warn");
    expect(orderUrgency(ago(9.9), now)).toBe("warn");
    expect(orderUrgency(ago(10), now)).toBe("late");
  });
});

describe("staff accounts", () => {
  const list = async () => ((await (await get("/api/admin/staff", adminId)).json()) as { items: StaffMember[] }).items;

  it("can be paused and resumed; a paused account is locked out but stays listed", async () => {
    const barista = await newUser("staff");
    expect((await get("/api/staff/orders", barista)).status).toBe(200);
    await send("POST", "/api/me/push-devices", { token: token(70) }, barista);
    expect((await built.repo.staffPushDevices("new_orders")).map((d) => d.token)).toContain(token(70));

    expect((await send("POST", `/api/admin/staff/${barista}/pause`, undefined, staffId)).status).toBe(403);
    expect((await send("POST", `/api/admin/staff/${barista}/pause`, undefined, adminId)).status).toBe(200);
    expect((await get("/api/staff/orders", barista)).status).toBe(401);
    expect((await list()).find((s) => s.id === barista)).toMatchObject({ paused: true });

    const again = await send("POST", `/api/admin/staff/${barista}/pause`, undefined, adminId);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { message: "حساب الموظف موقوف مسبقًا" } });

    // A paused barista gets no new-order alerts.
    expect((await built.repo.staffPushDevices("new_orders")).map((d) => d.token)).not.toContain(token(70));

    expect((await send("POST", `/api/admin/staff/${barista}/resume`, undefined, adminId)).status).toBe(200);
    expect((await get("/api/staff/orders", barista)).status).toBe(200);
    expect((await list()).find((s) => s.id === barista)).toMatchObject({ paused: false });
    expect((await built.repo.staffPushDevices("new_orders")).map((d) => d.token)).toContain(token(70));
    expect((await send("POST", `/api/admin/staff/${barista}/resume`, undefined, adminId)).status).toBe(409);
  });

  it("removing a paused account takes it off the list for good", async () => {
    const barista = await newUser("staff");
    expect((await send("POST", `/api/admin/staff/${barista}/pause`, undefined, adminId)).status).toBe(200);
    expect((await send("POST", `/api/admin/staff/${barista}/remove`, undefined, adminId)).status).toBe(200);
    expect((await list()).map((s) => s.id)).not.toContain(barista);
    expect((await get("/api/staff/orders", barista)).status).toBe(401);
    expect((await send("POST", `/api/admin/staff/${barista}/resume`, undefined, adminId)).status).toBe(409);
    expect((await send("POST", `/api/admin/staff/${barista}/remove`, undefined, adminId)).status).toBe(409);
  });

  it("only staff accounts can be paused", async () => {
    expect((await send("POST", `/api/admin/staff/${adminId}/pause`, undefined, adminId)).status).toBe(400);
    expect((await send("POST", `/api/admin/staff/${randomUUID()}/pause`, undefined, adminId)).status).toBe(404);
  });

  it("gets a new password from the admin", async () => {
    const barista = await newUser("staff");
    expect((await send("POST", `/api/admin/staff/${barista}/password`, { password: "short" }, adminId)).status).toBe(400);
    expect((await send("POST", `/api/admin/staff/${barista}/password`, { password: "NewPass123" }, staffId)).status).toBe(403);
    expect((await send("POST", `/api/admin/staff/${barista}/password`, { password: "NewPass123" }, adminId)).status).toBe(200);
    expect(built.repo.staffPasswords.get(barista)).toBe("NewPass123");
    expect((await send("POST", `/api/admin/staff/${adminId}/password`, { password: "NewPass123" }, adminId)).status).toBe(400);
  });
});

describe("scheduled offers", () => {
  it("are sent by the cron in batches, not by the page, and can be cancelled before they start", async () => {
    const fresh = await createTestDb();
    const local = buildTestApp(fresh);
    const localPush = local.appPush as MockAppPushSender;
    const admin = (await createAuthUser(fresh, { email: "a@later.test", name: "Admin", role: "admin" })).id;
    const req = (method: string, path: string, body: unknown, userId = admin) =>
      local.app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body ?? {}) });
    const deps = { repo: local.repo, appPush: localPush, webPush: local.webPush, logger: silentLogger };
    const now = Date.now();
    const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

    // Scheduling is allowed before anyone opted in; the audience is counted when it goes out.
    const early = await req("POST", "/api/admin/broadcasts", { title: "HOLLOW", body: "عرض الجمعة", scheduledAt: at(60) });
    expect(early.status).toBe(201);
    const { broadcast } = (await early.json()) as { broadcast: Broadcast };
    expect(broadcast).toMatchObject({ scheduledAt: new Date(at(60)).toISOString(), startedAt: null, cancelledAt: null });

    expect((await req("POST", "/api/admin/broadcasts", { title: "HOLLOW", body: "x", scheduledAt: at(-10) })).status).toBe(400);
    expect((await req("POST", "/api/admin/broadcasts", { title: "HOLLOW", body: "x", scheduledAt: at(31 * 24 * 60) })).status).toBe(400);
    expect((await req("POST", "/api/admin/broadcasts", { title: "HOLLOW", body: "x", scheduledAt: "tomorrow" })).status).toBe(400);

    const optedIn: string[] = [];
    for (let i = 0; i < SCHEDULED_BATCH + 5; i++) {
      const id = (await createAuthUser(fresh, { email: `c${i}@later.test`, name: `C${i}` })).id;
      await req("POST", "/api/me/push-devices", { token: token(i) }, id);
      await req("PUT", "/api/me/notification-prefs", { offers: true }, id);
      optedIn.push(token(i));
    }

    // The page can't send a scheduled offer itself.
    expect((await req("POST", `/api/admin/broadcasts/${broadcast.id}/send`, { after: null })).status).toBe(409);

    // Not due yet.
    expect(await runScheduledBroadcasts(deps, new Date(now + 30 * 60_000))).toBe("idle");

    // Due: one batch per run, then the rest.
    const due = new Date(now + 61 * 60_000);
    expect(await runScheduledBroadcasts(deps, due)).toEqual({ id: broadcast.id, sent: SCHEDULED_BATCH, finished: false });
    // Another run inside the lease does nothing; the lease ends with the batch.
    const mid = (await local.repo.getBroadcast(broadcast.id))!;
    expect(mid).toMatchObject({ recipients: SCHEDULED_BATCH + 5, sent: SCHEDULED_BATCH, finishedAt: null });
    expect(mid.startedAt).not.toBeNull();
    expect((await req("POST", `/api/admin/broadcasts/${broadcast.id}/cancel`, {})).status).toBe(409);

    expect(await runScheduledBroadcasts(deps, new Date(due.getTime() + 60_000))).toEqual({ id: broadcast.id, sent: SCHEDULED_BATCH + 5, finished: true });
    expect(await runScheduledBroadcasts(deps, new Date(due.getTime() + 120_000))).toBe("idle");

    const delivered = localPush.sent.filter((p) => p.message.collapseId === `offer-${broadcast.id}`);
    expect(delivered.map((p) => p.token).sort()).toEqual(optedIn.sort());
    expect(delivered[0]!.message).toMatchObject({ title: "HOLLOW", body: "عرض الجمعة", data: { link: "menu" } });
    expect((await local.repo.getBroadcast(broadcast.id))!.finishedAt).not.toBeNull();

    // Cancelled before its time: never sent.
    const later = (await (await req("POST", "/api/admin/broadcasts", { title: "HOLLOW", body: "ملغي", scheduledAt: at(120) })).json()) as {
      broadcast: Broadcast;
    };
    const customer = (await createAuthUser(fresh, { email: "x@later.test", name: "X" })).id;
    expect((await req("POST", `/api/admin/broadcasts/${later.broadcast.id}/cancel`, {}, customer)).status).toBe(403);
    expect((await req("POST", `/api/admin/broadcasts/${later.broadcast.id}/cancel`, {})).status).toBe(200);
    expect(await runScheduledBroadcasts(deps, new Date(now + 125 * 60_000))).toBe("idle");
    expect(localPush.sent.filter((p) => p.message.collapseId === `offer-${later.broadcast.id}`)).toHaveLength(0);
    expect((await req("POST", `/api/admin/broadcasts/${randomUUID()}/cancel`, {})).status).toBe(404);

    // An offer sent right away can't be "cancelled" either.
    const now2 = (await (await req("POST", "/api/admin/broadcasts", { title: "HOLLOW", body: "الحين" })).json()) as { broadcast: Broadcast };
    expect(now2.broadcast.scheduledAt).toBeNull();
    expect((await req("POST", `/api/admin/broadcasts/${now2.broadcast.id}/cancel`, {})).status).toBe(409);

    const listed = (await (await local.app.request("/api/admin/broadcasts", { headers: bearer(admin) })).json()) as { items: Broadcast[] };
    expect(listed.items.find((b) => b.id === later.broadcast.id)!.cancelledAt).not.toBeNull();
  });

  it("two runs at once never send the same batch", async () => {
    const fresh = await createTestDb();
    const local = buildTestApp(fresh);
    const localPush = local.appPush as MockAppPushSender;
    const admin = (await createAuthUser(fresh, { email: "a@race.test", name: "Admin", role: "admin" })).id;
    const id = (await createAuthUser(fresh, { email: "c@race.test", name: "C" })).id;
    const req = (method: string, path: string, body: unknown, userId: string) =>
      local.app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });
    await req("POST", "/api/me/push-devices", { token: token(1) }, id);
    await req("PUT", "/api/me/notification-prefs", { offers: true }, id);
    const created = await req("POST", "/api/admin/broadcasts", { title: "HOLLOW", body: "مرة وحدة", scheduledAt: new Date(Date.now() + 60_000).toISOString() }, admin);
    const { broadcast } = (await created.json()) as { broadcast: Broadcast };
    const deps = { repo: local.repo, appPush: localPush, webPush: local.webPush, logger: silentLogger };
    const due = new Date(Date.now() + 5 * 60_000);
    const first = await local.repo.claimDueBroadcast(due);
    expect(first?.id).toBe(broadcast.id);
    expect(await local.repo.claimDueBroadcast(due)).toBeNull();
    // Once the lease runs out (a run that died), another run picks it up.
    expect(await runScheduledBroadcasts(deps, new Date(due.getTime() + 51_000))).toEqual({ id: broadcast.id, sent: 1, finished: true });
    expect(localPush.sent.filter((p) => p.message.collapseId === `offer-${broadcast.id}`)).toHaveLength(1);
  });
});

describe("low-rating alerts", () => {
  it("ring admins for one or two stars, unless they switched it off", async () => {
    await send("POST", "/api/me/push-devices", { token: token(90) }, adminId);
    await send("POST", "/api/me/push-devices", { token: token(91) }, staffId);
    const customer = await newUser();
    const alerts = (orderId: string) => appPush.sent.filter((p) => p.message.collapseId === `rating-${orderId}`);

    const bad = await placeOrder(customer);
    await moveTo(bad.id, ["preparing", "ready", "completed"]);
    expect((await send("POST", `/api/orders/${bad.id}/rate`, { rating: 2, comment: "القهوة باردة" }, customer)).status).toBe(200);
    await vi.waitFor(() => expect(alerts(bad.id)).toHaveLength(1));
    expect(alerts(bad.id)[0]!.token).toBe(token(90));
    expect(alerts(bad.id)[0]!.message).toMatchObject({
      title: `تقييم 2 نجوم · طلب #${bad.orderNumber}`,
      body: `User ${n} · «القهوة باردة»`,
      data: { link: "staff-ratings" },
    });

    const good = await placeOrder(customer);
    await moveTo(good.id, ["preparing", "ready", "completed"]);
    expect((await send("POST", `/api/orders/${good.id}/rate`, { rating: 4 }, customer)).status).toBe(200);

    const put = await send("PUT", "/api/me/notification-prefs", { lowRatings: false }, adminId);
    expect(((await put.json()) as { prefs: NotificationPrefs }).prefs.lowRatings).toBe(false);
    const quiet = await placeOrder(customer);
    await moveTo(quiet.id, ["preparing", "ready", "completed"]);
    expect((await send("POST", `/api/orders/${quiet.id}/rate`, { rating: 1 }, customer)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    expect(alerts(good.id)).toHaveLength(0);
    expect(alerts(quiet.id)).toHaveLength(0);
    await send("PUT", "/api/me/notification-prefs", { lowRatings: true }, adminId);
  });

  it("open the ratings page", () => {
    expect(webPushPayload({ title: "t", body: "b", data: { link: "staff-ratings" } }).url).toBe("/staff/admin/engage?tab=ratings");
  });
});

describe("service speed on the sales dashboard", () => {
  it("averages preparation and waiting times and lists cancellation reasons", async () => {
    const fresh = await createTestDb();
    const local = buildTestApp(fresh);
    const admin = (await createAuthUser(fresh, { email: "a@speed.test", name: "Admin", role: "admin" })).id;
    const staff = (await createAuthUser(fresh, { email: "s@speed.test", name: "Staff", role: "staff" })).id;
    const customer = (await createAuthUser(fresh, { email: "c@speed.test", name: "C" })).id;
    const req = (method: string, path: string, body: unknown, userId: string) =>
      local.app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });
    await req("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, admin);
    const menu = (await (await local.app.request("/api/menu")).json()) as MenuResponse;
    const item = menu.items.find((i) => i.category === "drink" && i.options.length === 0)!;
    const order = async () => {
      const res = await req("POST", "/api/orders", { items: [{ menuItemId: item.id, quantity: 1 }], fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID() }, customer);
      return ((await res.json()) as { order: Order }).order;
    };
    const move = async (id: string, statuses: string[], cancelReason?: string) => {
      for (const status of statuses) expect((await req("POST", `/api/staff/orders/${id}/status`, { status, cancelReason }, staff)).status).toBe(200);
    };
    // Sets the order's clock: placed `ago` minutes back, accepted after `accept`, ready after `prep` more.
    const clock = (id: string, ago: number, accept: number, prep: number) =>
      fresh.query(
        `update public.orders set created_at = now() - make_interval(mins => $2),
           accepted_at = now() - make_interval(mins => $2) + make_interval(mins => $3),
           ready_at = now() - make_interval(mins => $2) + make_interval(mins => $3 + $4)
         where id = $1`,
        [id, ago, accept, prep],
      );

    const a = await order();
    const b = await order();
    const slow = await order();
    await move(a.id, ["preparing", "ready", "completed"]);
    await move(b.id, ["preparing", "ready", "completed"]);
    await move(slow.id, ["preparing", "ready", "completed"]);
    await clock(a.id, 60, 1, 4);
    await clock(b.id, 50, 2, 6);
    await clock(slow.id, 40, 3, 17);
    for (const reason of ["نفد الحليب", "نفد الحليب", undefined]) await move((await order()).id, ["cancelled"], reason);
    // Last week: slower.
    const old = await order();
    await move(old.id, ["preparing", "ready", "completed"]);
    await clock(old.id, 8 * 24 * 60, 4, 10);

    const res = await req("GET", "/api/admin/sales?range=7d", undefined, admin);
    expect(res.status).toBe(200);
    const { service } = (await res.json()) as SalesDashboard;
    expect(service.current).toEqual({ completed: 3, cancelled: 3, acceptMinutes: 2, prepMinutes: 9, waitMinutes: 11, slow: 1 });
    expect(service.previous).toMatchObject({ completed: 1, cancelled: 0, acceptMinutes: 4, prepMinutes: 10, waitMinutes: 14 });
    expect(service.reasons).toEqual([
      { by: "staff", reason: "نفد الحليب", count: 2 },
      { by: "staff", reason: null, count: 1 },
    ]);
    expect((await req("GET", "/api/admin/sales?range=7d", undefined, staff)).status).toBe(403);
  });
});
