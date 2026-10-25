/**
 * Exceptional orders against the real SQL (PGlite): a million iced coffees,
 * the 40-cup cap, prices and stock at their limits, a rush of orders today and
 * an export of more than 10,000 orders.
 *
 * `it.fails` marks a known bug: the test states the right behavior and fails
 * today. Once the bug is fixed it starts passing, so vitest reports it and the
 * `.fails` can be dropped.
 */
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discountedPrice, type MenuItem, type MenuResponse, type Order, type SalesReport } from "../../src/shared/ordering";
import { bearer, buildTestApp } from "../helpers/app";
import { accountFor, createAuthUser, createTestDb } from "../helpers/db";
import type { PgliteRepository } from "../helpers/pglite-repository";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let repo: PgliteRepository;
let staffId: string;
let adminId: string;
let iced: MenuItem;
let hot: MenuItem;
let babka: MenuItem;
let n = 0;

function send(method: string, path: string, body: unknown, userId: string): Promise<Response> {
  return Promise.resolve(app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) }));
}
const get = (path: string, userId: string) => app.request(path, { headers: bearer(userId) });

async function newCustomer() {
  n += 1;
  return (await createAuthUser(db, { email: `rush${n}@example.com`, name: `Customer ${n}` })).id;
}

type Line = { menuItemId: string; quantity: number };
const cups = (item: MenuItem, quantity: number): Line => ({ menuItemId: item.id, quantity });

function checkout(customerId: string, items: Line[], extra: Record<string, unknown> = {}) {
  return send("POST", "/api/orders", { items, fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID(), ...extra }, customerId);
}

async function placed(customerId: string, items: Line[], extra: Record<string, unknown> = {}): Promise<Order> {
  const res = await checkout(customerId, items, extra);
  expect(res.status).toBe(201);
  return ((await res.json()) as { order: Order }).order;
}

async function errorOf(res: Response) {
  return { status: res.status, code: ((await res.json()) as { error: { code: string } }).error.code };
}

async function complete(orderId: string) {
  let order: Order | undefined;
  for (const status of ["preparing", "ready", "completed"]) {
    const res = await send("POST", `/api/staff/orders/${orderId}/status`, { status }, staffId);
    expect(res.status, status).toBe(200);
    order = ((await res.json()) as { order: Order }).order;
  }
  return order!;
}

async function orderCount() {
  return (await db.query<{ n: number }>("select count(*)::int as n from public.orders")).rows[0]!.n;
}

async function setStock(item: MenuItem, quantity: number | null) {
  return send("POST", `/api/staff/menu/${item.id}/stock`, { quantity }, staffId);
}

beforeAll(async () => {
  db = await createTestDb();
  const built = buildTestApp(db);
  app = built.app;
  repo = built.repo;
  staffId = (await createAuthUser(db, { email: "barista@rush.test", name: "Barista", role: "staff" })).id;
  adminId = (await createAuthUser(db, { email: "owner@rush.test", name: "Owner", role: "admin" })).id;
  expect((await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, adminId)).status).toBe(200);
  const menu = ((await (await app.request("/api/menu")).json()) as MenuResponse).items;
  iced = menu.find((m) => m.nameEn === "Ice Coffee Day")!;
  hot = menu.find((m) => m.nameEn === "Hot Coffee Day")!;
  babka = menu.find((m) => m.nameEn === "Babka")!;
  expect(iced.priceHalalas).toBe(800);
  const coupon = { code: "rush10", kind: "percent", value: 10, item_ids: [] };
  expect((await send("POST", "/api/benefits", { action: "save_coupon", data: coupon }, adminId)).status).toBe(200);
});

describe("a million iced coffees today", () => {
  it("refuses a million on one line, and writes nothing", async () => {
    const customer = await newCustomer();
    const before = await orderCount();
    expect(await errorOf(await checkout(customer, [cups(iced, 1_000_000)]))).toEqual({ status: 400, code: "INVALID_REQUEST" });
    expect(await orderCount()).toBe(before);
  });

  it("refuses 600 spread over 30 lines of 20 (the 40-cup cap), and writes nothing", async () => {
    const customer = await newCustomer();
    const before = await orderCount();
    const lines = Array.from({ length: 30 }, () => cups(iced, 20));
    expect(await errorOf(await checkout(customer, lines))).toEqual({ status: 400, code: "TOO_MANY_ITEMS" });
    expect(await orderCount()).toBe(before);
  });

  it("refuses the 41st item", async () => {
    const customer = await newCustomer();
    expect(await errorOf(await checkout(customer, [cups(iced, 20), cups(hot, 20), cups(babka, 1)]))).toEqual({ status: 400, code: "TOO_MANY_ITEMS" });
  });

  it("takes exactly 40, and the card stops at 5/5 when they are handed over", async () => {
    const customer = await newCustomer();
    const order = await placed(customer, [cups(iced, 20), cups(iced, 20)]);
    expect(order).toMatchObject({ subtotalHalalas: 40 * 800, totalHalalas: 40 * 800, discountHalalas: 0 });
    const done = await complete(order.id);
    expect(done.loyaltyResult).toMatchObject({ cupsAdded: 5, cupsNotAdded: 35 });
    expect(await accountFor(db, customer)).toMatchObject({ stamp_count: 5, reward_available: true });
  });

  // BUG (see the report): with a coupon, gift cups or "use my balance", the
  // order is priced by benefit_quote(), which answers ITEM_UNAVAILABLE for
  // more than 40 items. The customer is told an item is unavailable (or the
  // coupon is invalid) instead of "too many items".
  it.fails("answers TOO_MANY_ITEMS for 41 items when the balance is used too", async () => {
    const customer = await newCustomer();
    const res = await checkout(customer, [cups(iced, 20), cups(hot, 20), cups(babka, 1)], { useBalance: true });
    expect(await errorOf(res)).toEqual({ status: 400, code: "TOO_MANY_ITEMS" });
  });

  it.fails("checks a coupon on a 41-item cart as too many items, not as an unavailable item", async () => {
    const customer = await newCustomer();
    const res = await send(
      "POST",
      "/api/benefits",
      { action: "quote", data: { items: [cups(iced, 20), cups(hot, 20), cups(babka, 1)], fulfillment: "pickup", couponCode: "rush10" } },
      customer,
    );
    expect(await errorOf(res)).toMatchObject({ code: "TOO_MANY_ITEMS" });
  });

  it.fails("checks a 31-line cart as too many items, not as an empty order", async () => {
    const customer = await newCustomer();
    const lines = Array.from({ length: 31 }, () => cups(iced, 1));
    const res = await send("POST", "/api/benefits", { action: "quote", data: { items: lines, fulfillment: "pickup", couponCode: "rush10" } }, customer);
    expect(await errorOf(res)).toMatchObject({ code: "TOO_MANY_ITEMS" });
  });
});

describe("prices and stock at their limits", () => {
  afterAll(async () => {
    await db.query("update public.menu_items set price_halalas = 800, stock_quantity = null where id = $1", [iced.id]);
  });

  it("prices 40 cups at the highest menu price (1000 SAR each) without overflowing", async () => {
    expect((await send("PATCH", `/api/admin/menu/${iced.id}`, { priceHalalas: 100_000 }, adminId)).status).toBe(200);
    expect((await send("PATCH", `/api/admin/menu/${iced.id}`, { priceHalalas: 100_001 }, adminId)).status).toBe(400);
    const order = await placed(await newCustomer(), [cups(iced, 20), cups(iced, 20)], {
      fulfillment: "delivery",
      deliveryAddress: "الزلفي",
    });
    expect(order).toMatchObject({ subtotalHalalas: 4_000_000, deliveryFeeHalalas: 1500, totalHalalas: 4_001_500 });
    expect((await send("PATCH", `/api/admin/menu/${iced.id}`, { priceHalalas: 800 }, adminId)).status).toBe(200);
  });

  it("charges the same sale price the menu shows, for every price up to 10 SAR and every percent", async () => {
    const { rows } = await db.query<{ p: number; pct: number; unit: number }>(
      `select p, pct, round(p * (100 - pct) / 100.0)::int as unit
         from generate_series(0, 1000) p, generate_series(1, 90) pct`,
    );
    expect(rows).toHaveLength(1001 * 90);
    const mismatches = rows.filter((r) => discountedPrice(r.p, r.pct) !== r.unit);
    expect(mismatches).toEqual([]);
  });

  it("never sells more than is left, even when the item is split over several lines", async () => {
    expect((await setStock(iced, 5)).status).toBe(200);
    const customer = await newCustomer();
    const short = await checkout(customer, [cups(iced, 3), cups(iced, 3)]);
    expect(short.status).toBe(409);
    expect(await short.json()).toMatchObject({ error: { code: "NOT_ENOUGH_STOCK", details: { menuItemId: iced.id, remaining: 5 } } });

    const order = await placed(customer, [cups(iced, 5)]);
    expect(await errorOf(await checkout(await newCustomer(), [cups(iced, 1)]))).toEqual({ status: 409, code: "NOT_ENOUGH_STOCK" });
    // Cancelling puts the cups back.
    expect((await send("POST", `/api/staff/orders/${order.id}/status`, { status: "cancelled" }, staffId)).status).toBe(200);
    expect((await repo.getMenuItem(iced.id))!.stockQuantity).toBe(5);
  });

  it("takes 40 from the largest stock count (9999), and refuses a count above it", async () => {
    expect((await setStock(iced, 10_000)).status).toBe(400);
    expect((await setStock(iced, 9999)).status).toBe(200);
    await placed(await newCustomer(), [cups(iced, 20), cups(iced, 20)]);
    expect((await repo.getMenuItem(iced.id))!.stockQuantity).toBe(9959);
    expect((await setStock(iced, null)).status).toBe(200);
  });
});

describe("a rush of orders today", () => {
  afterAll(async () => {
    await db.exec("update public.shop_settings set max_open_orders = null");
  });

  it("lets one customer hold at most two open orders, and still answers a retry", async () => {
    await db.exec("update public.shop_settings set max_open_orders = 2");
    const customer = await newCustomer();
    const key = randomUUID();
    const first = await placed(customer, [cups(iced, 1)], { idempotencyKey: key });
    await placed(customer, [cups(iced, 1)]);
    expect(await errorOf(await checkout(customer, [cups(iced, 1)]))).toEqual({ status: 409, code: "TOO_MANY_OPEN_ORDERS" });

    const retry = await checkout(customer, [cups(iced, 1)], { idempotencyKey: key });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { order: Order }).order.id).toBe(first.id);

    await complete(first.id);
    await placed(customer, [cups(iced, 1)]);
  });

  it("answers a retry with the first order even if the cart changed, and refuses another customer's key", async () => {
    const customer = await newCustomer();
    const key = randomUUID();
    const first = await placed(customer, [cups(iced, 1)], { idempotencyKey: key });
    const retry = await checkout(customer, [cups(iced, 20)], { idempotencyKey: key });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { order: Order }).order).toMatchObject({ id: first.id, subtotalHalalas: 800 });
    expect(await errorOf(await checkout(await newCustomer(), [cups(iced, 1)], { idempotencyKey: key }))).toEqual({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("gives 200 orders placed at once 200 different numbers, and today's sales add up", async () => {
    const before = ((await (await get("/api/admin/sales?range=today", adminId)).json()) as SalesReport);
    const customers = await Promise.all(Array.from({ length: 200 }, () => newCustomer()));
    const responses = await Promise.all(customers.map((c, i) => checkout(c, [cups(iced, (i % 20) + 1)])));
    expect(responses.map((r) => r.status)).toEqual(customers.map(() => 201));
    const orders = await Promise.all(responses.map(async (r) => ((await r.json()) as { order: Order }).order));
    expect(new Set(orders.map((o) => o.orderNumber)).size).toBe(200);

    for (const o of orders) await complete(o.id);
    const after = ((await (await get("/api/admin/sales?range=today", adminId)).json()) as SalesReport);
    const cupsOrdered = orders.reduce((sum, o) => sum + o.items[0]!.quantity, 0);
    expect(after.orders - before.orders).toBe(200);
    expect(after.revenueHalalas - before.revenueHalalas).toBe(cupsOrdered * 800);
  });
});

describe("exporting more than 10,000 orders", () => {
  let bulkCustomer: string;

  beforeAll(async () => {
    bulkCustomer = await newCustomer();
    // A year of a busy café: 10,050 completed orders, one iced coffee each.
    await db.query(
      `insert into public.orders (customer_id, customer_name, customer_phone, fulfillment, subtotal_halalas, total_halalas, status, completed_at, created_at)
       select $1, 'Bulk', '0512345678', 'pickup', 800, 800, 'completed', now() - g * interval '1 minute', now() - g * interval '1 minute'
         from generate_series(1, 10050) g`,
      [bulkCustomer],
    );
  });

  const csvOrderNumbers = (csv: string) =>
    csv
      .trim()
      .split("\r\n")
      .slice(1)
      .map((row) => row.split(",")[0]!);

  // BUG (see the report): the exports stop after 50 pages of 200 without a
  // word, so the oldest orders (and their sales) are missing from the file.
  it.fails("puts every order in the CSV export", async () => {
    const res = await get("/api/admin/export/orders.csv", adminId);
    expect(res.status).toBe(200);
    expect(csvOrderNumbers(await res.text())).toHaveLength(await orderCount());
  });

  // BUG (see the report): the export pages with OFFSET over a list sorted
  // newest first. An order placed between two pages pushes every row down by
  // one, so the last row of a page comes back as the first row of the next.
  it.fails("lists each order once when a new order arrives during the export", async () => {
    const orderHistory = repo.orderHistory.bind(repo);
    let pages = 0;
    repo.orderHistory = async (p) => {
      const page = await orderHistory(p);
      if (++pages === 1) await placed(await newCustomer(), [cups(iced, 1)]);
      return page;
    };
    try {
      const res = await get("/api/admin/export/orders.csv", adminId);
      const numbers = csvOrderNumbers(await res.text());
      expect(numbers.length).toBe(new Set(numbers).size);
    } finally {
      repo.orderHistory = orderHistory;
    }
  });
});
