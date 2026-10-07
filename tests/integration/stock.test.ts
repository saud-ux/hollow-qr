import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { MenuItem, MenuResponse, Order } from "../../src/shared/ordering";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let staffId: string;
let customerId: string;
let waffleId: string;
let drinkId: string;

function send(method: string, path: string, body: unknown, userId: string) {
  return app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });
}

const setStock = (id: string, quantity: number | null, userId = staffId) => send("POST", `/api/staff/menu/${id}/stock`, { quantity }, userId);

function order(lines: { menuItemId: string; quantity: number }[]) {
  return send("POST", "/api/orders", { items: lines, fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID() }, customerId);
}

async function publicItem(id: string): Promise<MenuItem> {
  const menu = (await (await app.request("/api/menu")).json()) as MenuResponse;
  return menu.items.find((i) => i.id === id)!;
}

async function stockOf(id: string): Promise<number | null> {
  const r = await db.query<{ stock_quantity: number | null }>("select stock_quantity from public.menu_items where id = $1", [id]);
  return r.rows[0]!.stock_quantity;
}

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string; details?: Record<string, unknown> } }).error;
}

beforeAll(async () => {
  db = await createTestDb();
  app = buildTestApp(db).app;
  staffId = (await createAuthUser(db, { email: "staff@stock.test", name: "Staff", role: "staff" })).id;
  const adminId = (await createAuthUser(db, { email: "admin@stock.test", name: "Admin", role: "admin" })).id;
  customerId = (await createAuthUser(db, { email: "c@stock.test", name: "Customer" })).id;
  expect((await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, adminId)).status).toBe(200);
  const menu = (await (await app.request("/api/menu")).json()) as MenuResponse;
  waffleId = menu.items.find((i) => i.category === "dessert")!.id;
  drinkId = menu.items.find((i) => i.category === "drink" && i.options.length === 0)!.id;
});

describe("stock counts", () => {
  it("are set by staff and shown to customers only when low", async () => {
    const res = await setStock(waffleId, 10);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { item: MenuItem }).item.stockQuantity).toBe(10);
    expect((await publicItem(waffleId)).stockQuantity).toBeNull();

    await setStock(waffleId, 3);
    expect(await publicItem(waffleId)).toMatchObject({ stockQuantity: 3, isAvailable: true });
    const staffMenu = (await (await app.request("/api/staff/menu", { headers: bearer(staffId) })).json()) as { items: MenuItem[] };
    expect(staffMenu.items.find((i) => i.id === waffleId)!.stockQuantity).toBe(3);

    // Items nobody counts stay unlimited.
    expect((await publicItem(drinkId)).stockQuantity).toBeNull();
  });

  it("only takes a whole number from staff or admins", async () => {
    expect((await setStock(waffleId, -1)).status).toBe(400);
    expect((await setStock(waffleId, 1.5)).status).toBe(400);
    expect((await setStock(waffleId, 3, customerId)).status).toBe(403);
    expect((await setStock(randomUUID(), 3)).status).toBe(404);
    expect(await stockOf(waffleId)).toBe(3);
  });

  it("refuses more than is left, counting every line of the item", async () => {
    await setStock(waffleId, 1);
    const tooMany = await order([{ menuItemId: waffleId, quantity: 2 }]);
    expect(tooMany.status).toBe(409);
    expect(await errorOf(tooMany)).toMatchObject({ code: "NOT_ENOUGH_STOCK", details: { menuItemId: waffleId, remaining: 1 } });

    const split = await order([
      { menuItemId: waffleId, quantity: 1 },
      { menuItemId: drinkId, quantity: 1 },
      { menuItemId: waffleId, quantity: 1 },
    ]);
    expect(split.status).toBe(409);
    expect(await stockOf(waffleId)).toBe(1);
  });

  it("takes the order's quantity, sells out at 0, and gives it back when cancelled", async () => {
    await setStock(waffleId, 2);
    const first = await order([{ menuItemId: waffleId, quantity: 1 }, { menuItemId: drinkId, quantity: 1 }]);
    expect(first.status).toBe(201);
    expect(await stockOf(waffleId)).toBe(1);
    const second = await order([{ menuItemId: waffleId, quantity: 1 }]);
    expect(second.status).toBe(201);
    const secondOrder = ((await second.json()) as { order: Order }).order;
    expect(await stockOf(waffleId)).toBe(0);

    expect(await publicItem(waffleId)).toMatchObject({ isAvailable: false, stockQuantity: 0 });
    const soldOut = await order([{ menuItemId: waffleId, quantity: 1 }]);
    expect(await errorOf(soldOut)).toMatchObject({ code: "NOT_ENOUGH_STOCK", details: { remaining: 0 } });

    // The customer cancels: the waffle is back on the menu.
    expect((await send("POST", `/api/orders/${secondOrder.id}/cancel`, {}, customerId)).status).toBe(200);
    expect(await stockOf(waffleId)).toBe(1);
    expect(await publicItem(waffleId)).toMatchObject({ isAvailable: true, stockQuantity: 1 });
  });

  it("gives back only what an order took", async () => {
    // Ordered while the drink was not counted; counting starts afterwards.
    const placed = await order([{ menuItemId: drinkId, quantity: 2 }]);
    const o = ((await placed.json()) as { order: Order }).order;
    await setStock(drinkId, 5);
    expect((await send("POST", `/api/staff/orders/${o.id}/status`, { status: "cancelled", cancelReason: "test" }, staffId)).status).toBe(200);
    expect(await stockOf(drinkId)).toBe(5);

    // Staff stop counting it: unlimited again.
    await setStock(drinkId, null);
    expect(await publicItem(drinkId)).toMatchObject({ isAvailable: true, stockQuantity: null });
  });
});
