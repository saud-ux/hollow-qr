import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { MenuItem, MenuResponse, Order, ShopSettings } from "../../src/shared/ordering";
import { bearer, buildTestApp } from "../helpers/app";
import { accountFor, createAuthUser, createTestDb } from "../helpers/db";
import type { PgliteRepository } from "../helpers/pglite-repository";

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let repo: PgliteRepository;
let staffId: string;
let adminId: string;
let menu: MenuItem[];
let n = 0;

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));

function send(method: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => send("POST", path, body, headers);

async function newCustomer() {
  n += 1;
  const user = await createAuthUser(db, { email: `order${n}@example.com`, name: `Customer ${n}` });
  return { id: user.id, account: (await accountFor(db, user.id))! };
}

const item = (name: string) => menu.find((m) => m.nameAr === name)!;

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    items: [{ menuItemId: item("قهوة مقطرة").id, quantity: 1, optionId: "ethiopia" }],
    fulfillment: "pickup",
    phone: "0512345678",
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

async function placeOrder(customerId: string, overrides: Record<string, unknown> = {}) {
  return post("/api/orders", orderBody(overrides), bearer(customerId));
}

async function placed(customerId: string, overrides: Record<string, unknown> = {}): Promise<Order> {
  const res = await placeOrder(customerId, overrides);
  expect(res.status).toBe(201);
  return ((await res.json()) as { order: Order }).order;
}

async function setStatus(orderId: string, status: string, actor = staffId, extra: Record<string, unknown> = {}) {
  return post(`/api/staff/orders/${orderId}/status`, { status, ...extra }, bearer(actor));
}

async function advance(orderId: string, statuses: string[]) {
  let order: Order | undefined;
  for (const s of statuses) {
    const res = await setStatus(orderId, s);
    expect(res.status, `status ${s}`).toBe(200);
    order = ((await res.json()) as { order: Order }).order;
  }
  return order!;
}

async function settings(patch: Partial<ShopSettings>) {
  const res = await send("PUT", "/api/admin/settings", patch, bearer(adminId));
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  db = await createTestDb();
  const built = buildTestApp(db);
  app = built.app;
  repo = built.repo;
  staffId = (await createAuthUser(db, { email: "barista@hollow.test", name: "Barista", role: "staff" })).id;
  adminId = (await createAuthUser(db, { email: "owner@hollow.test", name: "Owner", role: "admin" })).id;
  menu = ((await (await app.request("/api/menu")).json()) as MenuResponse).items;
});

describe("menu and opening hours", () => {
  it("serves the seeded menu publicly and starts paused", async () => {
    const res = await app.request("/api/menu");
    const body = (await res.json()) as MenuResponse;
    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(12);
    expect(item("ماتشا باردة")).toMatchObject({ category: "drink", priceHalalas: 2100, imageUrl: null });
    expect(item("بابكا")).toMatchObject({ category: "dessert", priceHalalas: 1200 });
    expect(body.shop).toMatchObject({ isOpen: false, settings: { orderingPaused: true, deliveryFeeHalalas: 1500 } });

    const customer = await newCustomer();
    const closed = await placeOrder(customer.id);
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ error: { code: "SHOP_CLOSED" } });
  });

  it("lets only admins change settings, and validates hours", async () => {
    expect((await send("PUT", "/api/admin/settings", { orderingPaused: false }, bearer(staffId))).status).toBe(403);
    const bad = await send("PUT", "/api/admin/settings", { weeklyHours: [{ closed: false, open: "25:00", close: "10:00" }] }, bearer(adminId));
    expect(bad.status).toBe(400);
    await settings({ orderingPaused: false, weeklyHours: ALL_DAY });
    const body = (await (await app.request("/api/menu")).json()) as MenuResponse;
    expect(body.shop.isOpen).toBe(true);
  });

  it("handles shifts that run past midnight", async () => {
    // Sunday 18:00 -> 02:00, every other day closed. 2026-10-04 is a Sunday.
    const hours = Array.from({ length: 7 }, (_, i) => (i === 0 ? { closed: false, open: "18:00", close: "02:00" } : { closed: true, open: "00:00", close: "00:00" }));
    await settings({ weeklyHours: hours });
    const at = async (local: string) =>
      (await db.query<{ open: boolean }>("select public.shop_is_open(($1::timestamp at time zone 'Asia/Riyadh'), 'Asia/Riyadh') as open", [local])).rows[0]!.open;
    expect(await at("2026-10-04 17:59")).toBe(false);
    expect(await at("2026-10-04 18:00")).toBe(true);
    expect(await at("2026-10-05 01:30")).toBe(true); // Monday, still Sunday's shift
    expect(await at("2026-10-05 02:00")).toBe(false);
    expect(await at("2026-10-05 19:00")).toBe(false); // Monday closed
    await settings({ weeklyHours: ALL_DAY });
  });

  it("lets staff pause and resume ordering", async () => {
    const paused = await post("/api/staff/shop/pause", { paused: true }, bearer(staffId));
    expect(await paused.json()).toMatchObject({ isOpen: false });
    const customer = await newCustomer();
    expect((await placeOrder(customer.id)).status).toBe(409);
    const resumed = await post("/api/staff/shop/pause", { paused: false }, bearer(staffId));
    expect(await resumed.json()).toMatchObject({ isOpen: true });
  });
});

describe("placing orders", () => {
  it("prices every line on the server and ignores client prices", async () => {
    const customer = await newCustomer();
    const order = await placed(customer.id, {
      items: [
        { menuItemId: item("ماتشا باردة").id, quantity: 2, note: "ثلج قليل", priceHalalas: 1 },
        { menuItemId: item("بابكا").id, quantity: 1 },
      ],
      totalHalalas: 1,
      note: "  ",
    });
    expect(order).toMatchObject({
      status: "new",
      fulfillment: "pickup",
      subtotalHalalas: 2 * 2100 + 1200,
      deliveryFeeHalalas: 0,
      discountHalalas: 0,
      totalHalalas: 5400,
      customerPhone: "0512345678",
      memberId: customer.account.member_id,
      note: null,
      paymentMethod: "on_pickup",
    });
    expect(order.orderNumber).toBeGreaterThanOrEqual(1);
    expect(order.items).toEqual([
      expect.objectContaining({ nameAr: "ماتشا باردة", quantity: 2, unitPriceHalalas: 2100, note: "ثلج قليل", category: "drink" }),
      expect.objectContaining({ nameAr: "بابكا", quantity: 1, unitPriceHalalas: 1200, note: null, category: "dessert" }),
    ]);
  });

  it("normalizes phone numbers and rejects invalid ones", async () => {
    const customer = await newCustomer();
    const order = await placed(customer.id, { phone: "+966 ٥٥ ١٢٣ ٤٥٦٧" });
    expect(order.customerPhone).toBe("0551234567");
    const bad = await placeOrder(customer.id, { phone: "12345" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "INVALID_PHONE" } });
  });

  it("requires a car for curbside and an address for delivery, and adds the delivery fee", async () => {
    const customer = await newCustomer();
    expect((await placeOrder(customer.id, { fulfillment: "curbside" })).status).toBe(400);
    expect((await placeOrder(customer.id, { fulfillment: "delivery" })).status).toBe(400);

    const curbside = await placed(customer.id, { fulfillment: "curbside", carDescription: "كامري بيضاء", deliveryAddress: "ignored" });
    expect(curbside).toMatchObject({ carDescription: "كامري بيضاء", deliveryAddress: null });

    const delivery = await placed(customer.id, {
      fulfillment: "delivery",
      deliveryAddress: "الزلفي، حي الملك فهد",
      deliveryLat: 26.29,
      deliveryLng: 44.81,
    });
    expect(delivery).toMatchObject({ deliveryFeeHalalas: 1500, totalHalalas: 1500 + 1500, deliveryLat: 26.29, deliveryLng: 44.81 });

    await settings({ deliveryMinOrderHalalas: 3000 });
    const small = await placeOrder(customer.id, { fulfillment: "delivery", deliveryAddress: "الزلفي" });
    expect(small.status).toBe(409);
    expect(await small.json()).toMatchObject({ error: { code: "BELOW_MINIMUM", details: { minimum: 3000 } } });
    await settings({ deliveryMinOrderHalalas: 0, deliveryEnabled: false });
    const off = await placeOrder(customer.id, { fulfillment: "delivery", deliveryAddress: "الزلفي" });
    expect(await off.json()).toMatchObject({ error: { code: "FULFILLMENT_UNAVAILABLE" } });
    await settings({ deliveryEnabled: true });
  });

  it("rejects unavailable or unknown items", async () => {
    const customer = await newCustomer();
    const babka = item("بابكا");
    expect((await send("PATCH", `/api/admin/menu/${babka.id}`, { isAvailable: false }, bearer(adminId))).status).toBe(200);
    const res = await placeOrder(customer.id, { items: [{ menuItemId: babka.id, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "ITEM_UNAVAILABLE", details: { menuItemId: babka.id } } });
    expect((await placeOrder(customer.id, { items: [{ menuItemId: randomUUID(), quantity: 1 }] })).status).toBe(409);
    await send("PATCH", `/api/admin/menu/${babka.id}`, { isAvailable: true }, bearer(adminId));
    expect((await placeOrder(customer.id, { items: [] })).status).toBe(400);
    expect((await placeOrder(customer.id, { items: [{ menuItemId: babka.id, quantity: 21 }] })).status).toBe(400);
  });

  it("replays a retried submission instead of creating a second order", async () => {
    const customer = await newCustomer();
    const body = orderBody();
    const first = await post("/api/orders", body, bearer(customer.id));
    const second = await post("/api/orders", body, bearer(customer.id));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const a = ((await first.json()) as { order: Order }).order;
    const b = ((await second.json()) as { order: Order }).order;
    expect(b.id).toBe(a.id);
    const other = await newCustomer();
    expect((await post("/api/orders", body, bearer(other.id))).status).toBe(409);
  });

  it("keeps orders private to their customer", async () => {
    const owner = await newCustomer();
    const other = await newCustomer();
    const order = await placed(owner.id);
    expect((await app.request(`/api/orders/${order.id}`, { headers: bearer(other.id) })).status).toBe(404);
    expect((await app.request(`/api/orders/${order.id}`, { headers: bearer(owner.id) })).status).toBe(200);
    const list = (await (await app.request("/api/orders", { headers: bearer(other.id) })).json()) as { items: Order[] };
    expect(list.items.map((o) => o.id)).not.toContain(order.id);
    expect((await app.request("/api/orders")).status).toBe(401);
    expect((await post(`/api/orders/${order.id}/cancel`, {}, bearer(other.id))).status).toBe(404);
  });
});

describe("the order board", () => {
  it("is staff only", async () => {
    const customer = await newCustomer();
    expect((await app.request("/api/staff/orders", { headers: bearer(customer.id) })).status).toBe(403);
    expect((await app.request("/api/admin/menu", { headers: bearer(staffId) })).status).toBe(403);
    const order = await placed(customer.id);
    expect((await setStatus(order.id, "preparing", customer.id)).status).toBe(403);
    const board = (await (await app.request("/api/staff/orders", { headers: bearer(staffId) })).json()) as { items: Order[] };
    expect(board.items.map((o) => o.id)).toContain(order.id);
  });

  it("moves orders through the allowed steps only", async () => {
    const customer = await newCustomer();
    const order = await placed(customer.id);
    const skip = await setStatus(order.id, "ready");
    expect(skip.status).toBe(409);
    expect(await skip.json()).toMatchObject({ error: { code: "INVALID_TRANSITION", details: { current: "new" } } });
    expect((await setStatus(order.id, "out_for_delivery")).status).toBe(409);
    const done = await advance(order.id, ["preparing", "ready", "completed"]);
    expect(done.status).toBe("completed");
    expect(done.acceptedAt && done.readyAt && done.completedAt).toBeTruthy();
    expect((await setStatus(order.id, "cancelled")).status).toBe(409);

    const delivery = await placed(customer.id, { fulfillment: "delivery", deliveryAddress: "الزلفي" });
    await advance(delivery.id, ["preparing", "ready"]);
    expect((await setStatus(delivery.id, "completed")).status).toBe(409);
    expect((await advance(delivery.id, ["out_for_delivery", "completed"])).status).toBe("completed");
  });

  it("adds a cup per drink when the order is completed (desserts do not count)", async () => {
    const customer = await newCustomer();
    const order = await placed(customer.id, {
      items: [
        { menuItemId: item("قهوة مقطرة").id, quantity: 2, optionId: "ethiopia" },
        { menuItemId: item("كيكة تشوكلت").id, quantity: 3 },
      ],
    });
    await advance(order.id, ["preparing", "ready"]);
    expect((await accountFor(db, customer.id))!.stamp_count).toBe(0);
    const done = await advance(order.id, ["completed"]);
    expect(done.loyaltyResult).toEqual({ redeem: null, cupsAdded: 2, cupsNotAdded: 0, skipped: false });
    const account = (await accountFor(db, customer.id))!;
    expect(account.stamp_count).toBe(2);
    const tx = await db.query<{ action: string; quantity: number; source: string }>(
      "select action, quantity, source from public.loyalty_transactions where loyalty_account_id = $1",
      [account.id],
    );
    expect(tx.rows).toEqual([{ action: "ADD_CUPS", quantity: 2, source: "app_order" }]);
  });

  it("caps cups at the card's capacity and never adds them while a reward is pending", async () => {
    const customer = await newCustomer();
    await adjust(customer.account.id, 4);
    const order = await placed(customer.id, { items: [{ menuItemId: item("قهوة اليوم حارة").id, quantity: 3 }] });
    const done = await advance(order.id, ["preparing", "ready", "completed"]);
    expect(done.loyaltyResult).toMatchObject({ cupsAdded: 1, cupsNotAdded: 2 });
    expect((await accountFor(db, customer.id))!).toMatchObject({ stamp_count: 5, reward_available: true });

    const next = await placed(customer.id);
    const after = await advance(next.id, ["preparing", "ready", "completed"]);
    expect(after.loyaltyResult).toMatchObject({ cupsAdded: 0, cupsNotAdded: 1 });
  });

  it("uses the free drink: discounts the priciest drink, redeems on completion, then counts the rest", async () => {
    const customer = await newCustomer();
    const noReward = await placeOrder(customer.id, { useReward: true });
    expect(await noReward.json()).toMatchObject({ error: { code: "NO_REWARD" } });

    await adjust(customer.account.id, 5);
    const dessertOnly = await placeOrder(customer.id, { useReward: true, items: [{ menuItemId: item("بابكا").id, quantity: 1 }] });
    expect(await dessertOnly.json()).toMatchObject({ error: { code: "REWARD_NEEDS_DRINK" } });

    const order = await placed(customer.id, {
      useReward: true,
      items: [
        { menuItemId: item("قهوة اليوم باردة").id, quantity: 1 },
        { menuItemId: item("ماتشا باردة").id, quantity: 1 },
        { menuItemId: item("قهوة مقطرة").id, quantity: 1, optionId: "ethiopia" },
      ],
    });
    expect(order).toMatchObject({ useReward: true, subtotalHalalas: 800 + 2100 + 1500, discountHalalas: 2100, totalHalalas: 2300 });

    const second = await placeOrder(customer.id, { useReward: true });
    expect(await second.json()).toMatchObject({ error: { code: "REWARD_IN_USE" } });

    const done = await advance(order.id, ["preparing", "ready", "completed"]);
    expect(done.loyaltyResult).toEqual({ redeem: "REDEEMED", cupsAdded: 2, cupsNotAdded: 0, skipped: false });
    expect((await accountFor(db, customer.id))!).toMatchObject({ stamp_count: 2, reward_available: false });
  });

  it("tells staff when the reward was already used in store", async () => {
    const customer = await newCustomer();
    await adjust(customer.account.id, 5);
    const order = await placed(customer.id, { useReward: true });
    const redeem = await post(
      `/api/staff/customers/${customer.account.id}/actions`,
      { action: "REDEEM_REWARD", idempotencyKey: randomUUID(), confirmRecent: true },
      bearer(staffId),
    );
    expect(redeem.status).toBe(200);
    const done = await advance(order.id, ["preparing", "ready", "completed"]);
    expect(done.loyaltyResult).toMatchObject({ redeem: "NO_REWARD", cupsAdded: 0 });
  });

  it("does not touch cancelled memberships", async () => {
    const customer = await newCustomer();
    const order = await placed(customer.id);
    await post(
      `/api/staff/customers/${customer.account.id}/actions`,
      { action: "CANCEL_MEMBERSHIP", idempotencyKey: randomUUID(), confirmRecent: true },
      bearer(adminId),
    );
    const done = await advance(order.id, ["preparing", "ready", "completed"]);
    expect(done.loyaltyResult).toMatchObject({ skipped: true, cupsAdded: 0 });
  });

  it("lets staff cancel with a reason", async () => {
    const customer = await newCustomer();
    const order = await placed(customer.id);
    const res = await setStatus(order.id, "cancelled", staffId, { cancelReason: "الصنف نفد" });
    expect(((await res.json()) as { order: Order }).order).toMatchObject({ status: "cancelled", cancelledBy: "staff", cancelReason: "الصنف نفد" });
  });
});

describe("customer actions", () => {
  it("cancels only before preparation starts", async () => {
    const customer = await newCustomer();
    const order = await placed(customer.id);
    const res = await post(`/api/orders/${order.id}/cancel`, {}, bearer(customer.id));
    expect(((await res.json()) as { order: Order }).order).toMatchObject({ status: "cancelled", cancelledBy: "customer" });

    const started = await placed(customer.id);
    await advance(started.id, ["preparing"]);
    expect((await post(`/api/orders/${started.id}/cancel`, {}, bearer(customer.id))).status).toBe(409);
  });

  it("marks curbside customers as arrived", async () => {
    const customer = await newCustomer();
    const pickup = await placed(customer.id);
    expect((await post(`/api/orders/${pickup.id}/arrived`, {}, bearer(customer.id))).status).toBe(409);
    const curbside = await placed(customer.id, { fulfillment: "curbside", carDescription: "يوكن أسود" });
    const res = await post(`/api/orders/${curbside.id}/arrived`, {}, bearer(customer.id));
    expect(((await res.json()) as { order: Order }).order.customerArrivedAt).toBeTruthy();
  });
});

describe("menu management", () => {
  it("creates, edits and archives items", async () => {
    const created = await post("/api/admin/menu", { nameAr: "لاتيه", category: "drink", priceHalalas: 1700 }, bearer(adminId));
    expect(created.status).toBe(201);
    const latte = ((await created.json()) as { item: MenuItem }).item;
    expect(latte).toMatchObject({ nameAr: "لاتيه", isAvailable: true, isArchived: false, nameEn: null });

    const edited = await send("PATCH", `/api/admin/menu/${latte.id}`, { priceHalalas: 1800, nameEn: "Latte" }, bearer(adminId));
    expect(((await edited.json()) as { item: MenuItem }).item).toMatchObject({ priceHalalas: 1800, nameEn: "Latte" });
    expect((await send("PATCH", `/api/admin/menu/${latte.id}`, { priceHalalas: -5 }, bearer(adminId))).status).toBe(400);

    await send("PATCH", `/api/admin/menu/${latte.id}`, { isArchived: true }, bearer(adminId));
    const publicMenu = (await (await app.request("/api/menu")).json()) as MenuResponse;
    expect(publicMenu.items.map((i) => i.id)).not.toContain(latte.id);
    const adminMenu = (await (await app.request("/api/admin/menu", { headers: bearer(adminId) })).json()) as { items: MenuItem[] };
    expect(adminMenu.items.map((i) => i.id)).toContain(latte.id);
  });

  it("uploads images after checking their bytes", async () => {
    const matcha = item("ماتشا باردة");
    const upload = (bytes: Uint8Array<ArrayBuffer>, type: string) =>
      app.request(`/api/admin/menu/${matcha.id}/image`, { method: "PUT", headers: { "content-type": type, ...bearer(adminId) }, body: new Blob([bytes]) });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

    expect((await upload(new TextEncoder().encode("<svg/>"), "image/png")).status).toBe(400);
    expect((await upload(png, "image/svg+xml")).status).toBe(400);
    expect((await upload(new Uint8Array(3 * 1024 * 1024), "image/png")).status).toBe(413);

    const first = ((await (await upload(png, "image/png")).json()) as { item: MenuItem }).item;
    expect(first.imageUrl).toMatch(/^https:\/\/project\.supabase\.test\/storage\/v1\/object\/public\/menu-images\/items\/.+\.png$/);
    const second = ((await (await upload(png, "image/png")).json()) as { item: MenuItem }).item;
    expect(second.imageUrl).not.toBe(first.imageUrl);
    expect([...repo.images.keys()]).toHaveLength(1);

    const cleared = await app.request(`/api/admin/menu/${matcha.id}/image`, { method: "DELETE", headers: bearer(adminId) });
    expect(((await cleared.json()) as { item: MenuItem }).item.imageUrl).toBeNull();
    expect(repo.images.size).toBe(0);
    const byStaff = await app.request(`/api/admin/menu/${matcha.id}/image`, {
      method: "PUT",
      headers: { "content-type": "image/png", ...bearer(staffId) },
      body: new Blob([png]),
    });
    expect(byStaff.status).toBe(403);
  });
});

async function adjust(accountId: string, target: number) {
  const res = await post(
    `/api/staff/customers/${accountId}/actions`,
    { action: "ADMIN_ADJUSTMENT", targetStampCount: target, idempotencyKey: randomUUID(), confirmRecent: true },
    bearer(adminId),
  );
  expect(res.status).toBe(200);
}
