import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MenuResponse, Order } from "../../src/shared/ordering";
import type { MockAppPushSender } from "../../src/server/push/app-push";
import { bearer, buildTestApp } from "../helpers/app";
import { accountFor, createAuthUser, createTestDb } from "../helpers/db";

const NATIVE = "capacitor://localhost";
const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let appPush: MockAppPushSender;
let staffId: string;
let adminId: string;
let drinkId: string;
let n = 0;

const token = (seed: number) => seed.toString(16).padStart(2, "0").repeat(32);

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function newCustomer() {
  n += 1;
  return createAuthUser(db, { email: `native${n}@example.com`, name: `Native ${n}` });
}

async function placeOrder(customerId: string, extra: Record<string, unknown> = {}): Promise<Order> {
  const res = await post(
    "/api/orders",
    { items: [{ menuItemId: drinkId, quantity: 2 }], fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID(), ...extra },
    bearer(customerId),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { order: Order }).order;
}

async function setStatus(orderId: string, status: string, extra: Record<string, unknown> = {}) {
  const res = await post(`/api/staff/orders/${orderId}/status`, { status, ...extra }, bearer(staffId));
  expect(res.status, status).toBe(200);
}

const pushesFor = (orderId: string) => appPush.sent.filter((p) => p.message.data?.orderId === orderId);

beforeAll(async () => {
  db = await createTestDb();
  const built = buildTestApp(db);
  app = built.app;
  appPush = built.appPush as MockAppPushSender;
  staffId = (await createAuthUser(db, { email: "staff@native.test", name: "Staff", role: "staff" })).id;
  adminId = (await createAuthUser(db, { email: "admin@native.test", name: "Admin", role: "admin" })).id;
  const settings = await app.request("/api/admin/settings", {
    method: "PUT",
    headers: { "content-type": "application/json", ...bearer(adminId) },
    body: JSON.stringify({ orderingPaused: false, weeklyHours: ALL_DAY }),
  });
  expect(settings.status).toBe(200);
  const menu = (await (await app.request("/api/menu")).json()) as MenuResponse;
  drinkId = menu.items.find((i) => i.category === "drink" && i.options.length === 0)!.id;
});

describe("CORS for the iOS app", () => {
  it("answers preflight only for the app origin", async () => {
    const ok = await app.request("/api/orders", {
      method: "OPTIONS",
      headers: { origin: NATIVE, "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(NATIVE);
    expect(ok.headers.get("access-control-allow-headers")).toContain("authorization");

    const other = await app.request("/api/orders", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows writes from the app origin and still blocks other origins", async () => {
    const customer = await newCustomer();
    const fromApp = await post("/api/me/push-devices", { token: token(1) }, { ...bearer(customer.id), origin: NATIVE });
    expect(fromApp.status).toBe(200);
    expect(fromApp.headers.get("access-control-allow-origin")).toBe(NATIVE);

    const fromElsewhere = await post("/api/me/push-devices", { token: token(2) }, { ...bearer(customer.id), origin: "https://evil.example" });
    expect(fromElsewhere.status).toBe(403);
    expect(fromElsewhere.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("push devices", () => {
  it("validates tokens and needs a signed-in user", async () => {
    const customer = await newCustomer();
    expect((await post("/api/me/push-devices", { token: token(3) })).status).toBe(401);
    expect((await post("/api/me/push-devices", { token: "not-hex" }, bearer(customer.id))).status).toBe(400);
    expect((await post("/api/me/push-devices", { token: "ab" }, bearer(customer.id))).status).toBe(400);
    // Upper-case tokens are normalized.
    const res = await post("/api/me/push-devices", { token: token(0xab).toUpperCase() }, bearer(customer.id));
    expect(res.status).toBe(200);
    const rows = await db.query("select user_id from public.push_devices where token = $1", [token(0xab)]);
    expect(rows.rows).toHaveLength(1);
  });

  it("moves a device to the last user who signed in on it, and removes it on sign-out", async () => {
    const first = await newCustomer();
    const second = await newCustomer();
    await post("/api/me/push-devices", { token: token(4) }, bearer(first.id));
    await post("/api/me/push-devices", { token: token(4) }, bearer(second.id));
    let rows = await db.query<{ user_id: string }>("select user_id from public.push_devices where token = $1", [token(4)]);
    expect(rows.rows.map((r) => r.user_id)).toEqual([second.id]);

    // Another user cannot remove it.
    await post("/api/me/push-devices/remove", { token: token(4) }, bearer(first.id));
    rows = await db.query("select user_id from public.push_devices where token = $1", [token(4)]);
    expect(rows.rows).toHaveLength(1);

    await post("/api/me/push-devices/remove", { token: token(4) }, bearer(second.id));
    rows = await db.query("select user_id from public.push_devices where token = $1", [token(4)]);
    expect(rows.rows).toHaveLength(0);
  });
});

describe("order status notifications", () => {
  it("notifies the customer's devices at each step, one notification per order", async () => {
    const customer = await newCustomer();
    await post("/api/me/push-devices", { token: token(5) }, bearer(customer.id));
    await post("/api/me/push-devices", { token: token(6) }, bearer(customer.id));
    const order = await placeOrder(customer.id);
    // Received: confirmed with the order number and total.
    await vi.waitFor(() => expect(pushesFor(order.id)).toHaveLength(2));
    expect(pushesFor(order.id)[0]!.message).toMatchObject({ title: "استلمنا طلبك! 🤩", collapseId: order.id });
    expect(pushesFor(order.id)[0]!.message.body).toContain(`طلبك رقم ${order.orderNumber}`);
    expect(pushesFor(order.id)[0]!.message.body).toContain(`${order.totalHalalas / 100} ر.س`);

    await setStatus(order.id, "preparing");
    await vi.waitFor(() => expect(pushesFor(order.id)).toHaveLength(4));
    expect(pushesFor(order.id)[2]!.message.body).toContain(`طلبك رقم ${order.orderNumber}`);

    await setStatus(order.id, "ready");
    await vi.waitFor(() => expect(pushesFor(order.id)).toHaveLength(6));
    expect(pushesFor(order.id)[4]!.message.body).toContain("الكاشير");

    await setStatus(order.id, "completed");
    await vi.waitFor(() => expect(pushesFor(order.id)).toHaveLength(8));
    expect(pushesFor(order.id)[6]!.message.body).toContain("2 أكواب");
    expect(new Set(pushesFor(order.id).map((p) => p.token))).toEqual(new Set([token(5), token(6)]));
  });

  it("confirms a received order once, even when the app retries it", async () => {
    const customer = await newCustomer();
    await post("/api/me/push-devices", { token: token(10) }, bearer(customer.id));
    const idempotencyKey = randomUUID();
    const first = await placeOrder(customer.id, { idempotencyKey });
    const retry = await post(
      "/api/orders",
      { items: [{ menuItemId: drinkId, quantity: 2 }], fulfillment: "pickup", phone: "0512345678", idempotencyKey },
      bearer(customer.id),
    );
    expect(retry.status).toBe(200);
    await vi.waitFor(() => expect(pushesFor(first.id)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(pushesFor(first.id)).toHaveLength(1);
    expect(pushesFor(first.id)[0]!.message.body).toContain("دفع عند الاستلام");
  });

  it("explains staff cancellations and stays quiet for the customer's own", async () => {
    const customer = await newCustomer();
    await post("/api/me/push-devices", { token: token(7) }, bearer(customer.id));
    const byStaff = await placeOrder(customer.id);
    await vi.waitFor(() => expect(pushesFor(byStaff.id)).toHaveLength(1));
    await setStatus(byStaff.id, "cancelled", { cancelReason: "نفد الحليب" });
    await vi.waitFor(() => expect(pushesFor(byStaff.id)).toHaveLength(2));
    expect(pushesFor(byStaff.id)[1]!.message.body).toContain("نفد الحليب");

    const byCustomer = await placeOrder(customer.id);
    await vi.waitFor(() => expect(pushesFor(byCustomer.id)).toHaveLength(1));
    expect((await post(`/api/orders/${byCustomer.id}/cancel`, {}, bearer(customer.id))).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(pushesFor(byCustomer.id)).toHaveLength(1);
  });

  it("drops tokens APNs reports as invalid", async () => {
    const customer = await newCustomer();
    await post("/api/me/push-devices", { token: token(8) }, bearer(customer.id));
    const order = await placeOrder(customer.id);
    await vi.waitFor(() => expect(pushesFor(order.id)).toHaveLength(1));
    const spy = vi.spyOn(appPush, "send").mockResolvedValueOnce("invalid-token");
    await setStatus(order.id, "preparing");
    await vi.waitFor(async () => {
      const rows = await db.query("select 1 from public.push_devices where token = $1", [token(8)]);
      expect(rows.rows).toHaveLength(0);
    });
    spy.mockRestore();
  });
});

describe("account deletion", () => {
  it("anonymizes the customer, voids the card and blocks the account", async () => {
    const customer = await newCustomer();
    await post("/api/me/push-devices", { token: token(9) }, bearer(customer.id));
    const done = await placeOrder(customer.id, { fulfillment: "curbside", carDescription: "كامري بيضاء", note: "بدون سكر" });
    await setStatus(done.id, "preparing");
    await setStatus(done.id, "ready");
    await setStatus(done.id, "completed");
    const pending = await placeOrder(customer.id);

    expect((await post("/api/me/delete", {}, bearer(customer.id))).status).toBe(400);
    const res = await post("/api/me/delete", { confirm: "DELETE" }, bearer(customer.id));
    expect(res.status).toBe(200);

    // Signed out everywhere: the API no longer accepts this user.
    expect((await app.request("/api/me", { headers: bearer(customer.id) })).status).toBe(401);

    const profile = await db.query<{ display_name: string; email: string; disabled_at: string | null }>(
      "select display_name, email, disabled_at from public.profiles where id = $1",
      [customer.id],
    );
    expect(profile.rows[0]).toMatchObject({ display_name: "حساب محذوف" });
    expect(profile.rows[0]!.email).not.toContain("native");
    expect(profile.rows[0]!.disabled_at).not.toBeNull();

    const auth = await db.query<{ email: string }>("select email from auth.users where id = $1", [customer.id]);
    expect(auth.rows[0]!.email).toBe(`deleted-${customer.id}@deleted.invalid`);

    const orders = await db.query<{ id: string; status: string; customer_name: string; customer_phone: string; car_description: string; note: string | null }>(
      "select id, status, customer_name, customer_phone, car_description, note from public.orders where customer_id = $1",
      [customer.id],
    );
    for (const o of orders.rows) {
      expect(o).toMatchObject({ customer_name: "حساب محذوف", customer_phone: "0500000000", note: null });
    }
    expect(orders.rows.find((o) => o.id === done.id)).toMatchObject({ status: "completed", car_description: "-" });
    expect(orders.rows.find((o) => o.id === pending.id)).toMatchObject({ status: "cancelled" });

    const account = await accountFor(db, customer.id);
    expect(account!.membership_status).toBe("cancelled");
    const devices = await db.query("select 1 from public.push_devices where user_id = $1", [customer.id]);
    expect(devices.rows).toHaveLength(0);

    // The email can be used for a brand-new account.
    const again = await createAuthUser(db, { email: `native${n}@example.com`, name: "Back again" });
    expect(again.id).not.toBe(customer.id);
  });

  it("waits while an order is being prepared", async () => {
    const customer = await newCustomer();
    const order = await placeOrder(customer.id);
    await setStatus(order.id, "preparing");
    const res = await post("/api/me/delete", { confirm: "DELETE" }, bearer(customer.id));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "ACTIVE_ORDER" } });
    expect((await app.request("/api/me", { headers: bearer(customer.id) })).status).toBe(200);
  });

  it("is for customers only", async () => {
    const res = await post("/api/me/delete", { confirm: "DELETE" }, bearer(staffId));
    expect(res.status).toBe(403);
    expect((await app.request("/api/me", { headers: bearer(staffId) })).status).toBe(200);
  });
});
