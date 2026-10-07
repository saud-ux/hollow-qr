import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Discount, MenuItem, MenuResponse, Order, OrderHistoryPage } from "../../src/shared/ordering";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let staffId: string;
let adminId: string;
let customerId: string;
let drink: MenuItem;
let dessert: MenuItem;
let v60: MenuItem;

function send(method: string, path: string, body: unknown, userId: string) {
  return app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });
}
const get = (path: string, userId: string) => app.request(path, { headers: bearer(userId) });
const menu = async () => ((await (await app.request("/api/menu")).json()) as MenuResponse).items;
const byId = (items: MenuItem[], id: string) => items.find((i) => i.id === id)!;
const setDiscount = (body: unknown) => send("PUT", "/api/admin/discount", body, adminId);

async function placeOrder(items: { menuItemId: string; quantity: number; optionId?: string }[], extra = {}): Promise<Order> {
  const res = await send("POST", "/api/orders", { items, fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID(), ...extra }, customerId);
  expect(res.status).toBe(201);
  return ((await res.json()) as { order: Order }).order;
}

beforeAll(async () => {
  db = await createTestDb();
  app = buildTestApp(db).app;
  staffId = (await createAuthUser(db, { email: "staff@disc.test", name: "Staff", role: "staff" })).id;
  adminId = (await createAuthUser(db, { email: "admin@disc.test", name: "Admin", role: "admin" })).id;
  customerId = (await createAuthUser(db, { email: "c@disc.test", name: "C" })).id;
  expect((await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, adminId)).status).toBe(200);
  const items = await menu();
  drink = items.find((i) => i.category === "drink" && i.options.length === 0)!;
  dessert = items.find((i) => i.category === "dessert")!;
  v60 = items.find((i) => i.options.length > 0)!;
});

beforeEach(async () => {
  expect((await send("DELETE", "/api/admin/discount", {}, adminId)).status).toBe(200);
});

describe("discounts", () => {
  it("takes the percentage off the whole menu and charges it on the order", async () => {
    const res = await setDiscount({ percent: 15, scope: "all" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ live: true, discount: { percent: 15, scope: "all", itemIds: [], endsAt: null } });

    const items = await menu();
    const d = byId(items, drink.id);
    expect(d.discountPercent).toBe(15);
    expect(d.salePriceHalalas).toBe(Math.round((drink.priceHalalas * 85) / 100));
    expect(byId(items, dessert.id).salePriceHalalas).toBe(Math.round((dessert.priceHalalas * 85) / 100));

    const order = await placeOrder([
      { menuItemId: drink.id, quantity: 2 },
      { menuItemId: v60.id, quantity: 1, optionId: v60.options[0]!.id },
    ]);
    const drinkUnit = Math.round((drink.priceHalalas * 85) / 100);
    const v60Unit = Math.round((v60.priceHalalas * 85) / 100);
    expect(order.subtotalHalalas).toBe(drinkUnit * 2 + v60Unit);
    expect(order.totalHalalas).toBe(order.subtotalHalalas);
    expect(order.promoPercent).toBe(15);
    expect(order.promoSavingsHalalas).toBe((drink.priceHalalas - drinkUnit) * 2 + (v60.priceHalalas - v60Unit));
    expect(order.items[0]).toMatchObject({ unitPriceHalalas: drinkUnit, listPriceHalalas: drink.priceHalalas });
  });

  it("covers only the chosen items", async () => {
    expect((await setDiscount({ percent: 20, scope: "items", itemIds: [dessert.id] })).status).toBe(200);
    const items = await menu();
    expect(byId(items, dessert.id)).toMatchObject({ discountPercent: 20, salePriceHalalas: Math.round((dessert.priceHalalas * 80) / 100) });
    expect(byId(items, drink.id)).toMatchObject({ discountPercent: null, salePriceHalalas: null });

    const order = await placeOrder([
      { menuItemId: drink.id, quantity: 1 },
      { menuItemId: dessert.id, quantity: 1 },
    ]);
    expect(order.subtotalHalalas).toBe(drink.priceHalalas + Math.round((dessert.priceHalalas * 80) / 100));
    expect(order.items.find((l) => l.menuItemId === drink.id)!.listPriceHalalas).toBeNull();
    expect(order.promoPercent).toBe(20);
  });

  it("orders without a covered item carry no discount", async () => {
    expect((await setDiscount({ percent: 20, scope: "items", itemIds: [dessert.id] })).status).toBe(200);
    const order = await placeOrder([{ menuItemId: drink.id, quantity: 1 }]);
    expect(order).toMatchObject({ subtotalHalalas: drink.priceHalalas, promoPercent: null, promoSavingsHalalas: 0 });
  });

  it("stops by itself at its end time", async () => {
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    expect((await setDiscount({ percent: 10, scope: "all", endsAt: soon })).status).toBe(200);
    expect(byId(await menu(), drink.id).discountPercent).toBe(10);
    await db.query("update public.shop_settings set discount_ends_at = now() - interval '1 minute'");
    expect(byId(await menu(), drink.id).discountPercent).toBeNull();
    const order = await placeOrder([{ menuItemId: drink.id, quantity: 1 }]);
    expect(order).toMatchObject({ subtotalHalalas: drink.priceHalalas, promoPercent: null });
    expect(await (await get("/api/admin/discount", adminId)).json()).toMatchObject({ live: false, discount: { percent: 10 } });
  });

  it("the free drink is the discounted drink", async () => {
    await db.query("update public.loyalty_accounts set stamp_count = 5, reward_available = true where user_id = $1", [customerId]);
    expect((await setDiscount({ percent: 50, scope: "all" })).status).toBe(200);
    const order = await placeOrder([{ menuItemId: drink.id, quantity: 1 }, { menuItemId: dessert.id, quantity: 1 }], { useReward: true });
    const drinkUnit = Math.round(drink.priceHalalas / 2);
    expect(order.discountHalalas).toBe(drinkUnit);
    expect(order.totalHalalas).toBe(Math.round(dessert.priceHalalas / 2));
    await send("POST", `/api/staff/orders/${order.id}/status`, { status: "cancelled" }, staffId);
  });

  it("switching off brings the menu prices back", async () => {
    expect((await setDiscount({ percent: 30, scope: "all" })).status).toBe(200);
    expect((await send("DELETE", "/api/admin/discount", {}, adminId)).status).toBe(200);
    expect(byId(await menu(), drink.id).salePriceHalalas).toBeNull();
    expect(await (await get("/api/admin/discount", adminId)).json()).toEqual({ discount: null, live: false });
  });

  it("keeps the start time while edited, and shows in the order history", async () => {
    const first = ((await (await setDiscount({ percent: 10, scope: "all" })).json()) as { discount: Discount }).discount;
    const second = ((await (await setDiscount({ percent: 25, scope: "all" })).json()) as { discount: Discount }).discount;
    expect(second.percent).toBe(25);
    expect(second.startedAt).toBe(first.startedAt);
    const order = await placeOrder([{ menuItemId: dessert.id, quantity: 1 }]);
    const history = (await (await get(`/api/admin/orders?q=${order.orderNumber}`, adminId)).json()) as OrderHistoryPage;
    expect(history.items[0]).toMatchObject({ promoPercent: 25, promoSavingsHalalas: dessert.priceHalalas - Math.round((dessert.priceHalalas * 75) / 100) });
    const csv = await (await get(`/api/admin/export/orders.csv?q=${order.orderNumber}`, adminId)).text();
    expect(csv.split("\r\n")[0]).toContain("promo_percent,promo_savings_sar");
  });

  it("validates and is for admins only", async () => {
    expect((await setDiscount({ percent: 0, scope: "all" })).status).toBe(400);
    expect((await setDiscount({ percent: 91, scope: "all" })).status).toBe(400);
    expect((await setDiscount({ percent: 10, scope: "items", itemIds: [] })).status).toBe(400);
    expect((await setDiscount({ percent: 10, scope: "items", itemIds: [randomUUID()] })).status).toBe(400);
    expect((await setDiscount({ percent: 10, scope: "all", endsAt: new Date(Date.now() - 60_000).toISOString() })).status).toBe(400);
    expect((await send("PUT", "/api/admin/discount", { percent: 10, scope: "all" }, staffId)).status).toBe(403);
    expect((await get("/api/admin/discount", customerId)).status).toBe(403);
  });
});
