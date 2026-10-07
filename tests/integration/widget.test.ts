import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MenuResponse, Order, WidgetData } from "../../src/shared/ordering";
import type { MockAppPushSender } from "../../src/server/push/app-push";
import { liveActivityUpdate } from "../../src/server/push/order-notifications";
import { createWidgetToken, verifyWidgetToken } from "../../src/server/security/tokens";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));
const SECRET = "x".repeat(40);

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let appPush: MockAppPushSender;
let staffId: string;
let adminId: string;
let drinkId: string;

const hex = (seed: number, bytes = 40) => (seed + 0x10).toString(16).padStart(2, "0").repeat(bytes);

function send(method: string, path: string, body: unknown, userId: string) {
  return app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });
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

const move = (orderId: string, status: string) => send("POST", `/api/staff/orders/${orderId}/status`, { status }, staffId);

beforeAll(async () => {
  db = await createTestDb();
  const built = buildTestApp(db);
  app = built.app;
  appPush = built.appPush as MockAppPushSender;
  staffId = (await createAuthUser(db, { email: "staff@widget.test", name: "Staff", role: "staff" })).id;
  adminId = (await createAuthUser(db, { email: "admin@widget.test", name: "Admin", role: "admin" })).id;
  expect((await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, adminId)).status).toBe(200);
  const menu = (await (await app.request("/api/menu")).json()) as MenuResponse;
  drinkId = menu.items.find((i) => i.category === "drink" && i.options.length === 0)!.id;
});

describe("widget token", () => {
  it("is tied to the user and expires", async () => {
    const user = randomUUID();
    const token = await createWidgetToken(SECRET, user, 2_000);
    expect(await verifyWidgetToken(SECRET, token, 1_000)).toBe(user);
    expect(await verifyWidgetToken(SECRET, token, 3_000)).toBeNull();
    expect(await verifyWidgetToken("y".repeat(40), token, 1_000)).toBeNull();
    const [, exp, sig] = token.split(".");
    expect(await verifyWidgetToken(SECRET, `${randomUUID()}.${exp}.${sig}`, 1_000)).toBeNull();
    expect(await verifyWidgetToken(SECRET, "nonsense", 1_000)).toBeNull();
  });
});

describe("home-screen widget data", () => {
  it("gives the app a token the widget then refreshes with", async () => {
    const customer = (await createAuthUser(db, { email: "w1@widget.test", name: "Widget One" })).id;
    const first = await app.request("/api/me/widget", { headers: bearer(customer) });
    expect(first.status).toBe(200);
    const { token, data } = (await first.json()) as { token: string; data: WidgetData };
    expect(data.card).toMatchObject({ name: "Widget One", stamps: 0, max: 5, reward: false, active: true });
    expect(data.card!.qr).toMatch(/\/c\//);
    expect(data.order).toBeNull();

    const order = await placeOrder(customer);
    const refreshed = await app.request("/api/widget", { headers: { authorization: `Widget ${token}` } });
    expect(refreshed.status).toBe(200);
    expect(((await refreshed.json()) as WidgetData).order).toEqual({ id: order.id, number: order.orderNumber, status: "new", fulfillment: "pickup" });

    // A finished order drops off the widget.
    for (const status of ["preparing", "ready", "completed"]) expect((await move(order.id, status)).status).toBe(200);
    const after = (await (await app.request("/api/widget", { headers: { authorization: `Widget ${token}` } })).json()) as WidgetData;
    expect(after.order).toBeNull();
    expect(after.card!.stamps).toBe(1);
  });

  it("refuses a missing or forged token", async () => {
    expect((await app.request("/api/widget")).status).toBe(401);
    expect((await app.request("/api/widget", { headers: { authorization: `Widget ${randomUUID()}.9999999999.${"a".repeat(43)}` } })).status).toBe(401);
    expect((await app.request("/api/me/widget")).status).toBe(401);
  });
});

describe("lock-screen order tracker (Live Activity)", () => {
  it("keeps the activity token, pushes each step, and ends it when the order is done", async () => {
    const customer = (await createAuthUser(db, { email: "w2@widget.test", name: "Widget Two" })).id;
    const order = await placeOrder(customer);
    const token = hex(1);
    const res = await send("POST", `/api/orders/${order.id}/live-activity`, { token, lang: "en" }, customer);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });

    expect((await move(order.id, "preparing")).status).toBe(200);
    await vi.waitFor(() => expect(appPush.liveSent.filter((p) => p.token === token)).toHaveLength(1));
    expect(appPush.liveSent.at(-1)!.update).toMatchObject({ event: "update", state: { status: "preparing", label: "Preparing your order", step: 1, steps: 4 } });

    expect((await move(order.id, "ready")).status).toBe(200);
    expect((await move(order.id, "completed")).status).toBe(200);
    await vi.waitFor(() => expect(appPush.liveSent.filter((p) => p.token === token)).toHaveLength(3));
    const end = appPush.liveSent.filter((p) => p.token === token).at(-1)!.update;
    expect(end).toMatchObject({ event: "end", state: { status: "completed", step: 3 } });
    expect(end.dismissAt).toBeInstanceOf(Date);

    // Done orders forget their trackers and don't take new ones.
    const rows = await db.query("select 1 from public.live_activities where order_id = $1", [order.id]);
    expect(rows.rows).toHaveLength(0);
    expect(await (await send("POST", `/api/orders/${order.id}/live-activity`, { token }, customer)).json()).toEqual({ saved: false });
  });

  it("only takes the customer's own order and a well-formed token", async () => {
    const owner = (await createAuthUser(db, { email: "w3@widget.test", name: "Owner" })).id;
    const other = (await createAuthUser(db, { email: "w4@widget.test", name: "Other" })).id;
    const order = await placeOrder(owner);
    expect((await send("POST", `/api/orders/${order.id}/live-activity`, { token: hex(2) }, other)).status).toBe(404);
    expect((await send("POST", `/api/orders/${order.id}/live-activity`, { token: "zz" }, owner)).status).toBe(400);
  });

  it("words the tracker for the customer, in their language", () => {
    const base = { id: "o", orderNumber: 7, fulfillment: "curbside", status: "ready" } as unknown as Order;
    const now = new Date("2026-10-10T10:00:00Z");
    expect(liveActivityUpdate(base, "ar", now)).toEqual({ event: "update", state: { status: "ready", label: "جاهز، نطلّعه لك", step: 2, steps: 4 } });
    const delivery = { ...base, fulfillment: "delivery", status: "out_for_delivery" } as Order;
    expect(liveActivityUpdate(delivery, "en", now).state).toEqual({ status: "out_for_delivery", label: "On its way", step: 3, steps: 5 });
    const cancelled = liveActivityUpdate({ ...base, status: "cancelled" }, "ar", now);
    expect(cancelled).toMatchObject({ event: "end", state: { label: "تم إلغاء الطلب" } });
    expect(cancelled.dismissAt!.getTime()).toBe(now.getTime() + 60_000);
  });
});
