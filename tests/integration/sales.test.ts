import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { MenuItem, MenuResponse, Order, SalesReport } from "../../src/shared/ordering";
import { startOfLocalDay } from "../../src/server/push/daily-summary";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let staffId: string;
let adminId: string;
let customerId: string;
let drink: MenuItem;
let v60: MenuItem;

function send(method: string, path: string, body: unknown, userId: string) {
  return app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });
}
const get = (path: string, userId: string) => app.request(path, { headers: bearer(userId) });
const menu = async () => ((await (await app.request("/api/menu")).json()) as MenuResponse).items;

async function placeOrder(items: { menuItemId: string; quantity: number; optionId?: string }[]): Promise<Order> {
  const res = await send("POST", "/api/orders", { items, fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID() }, customerId);
  expect(res.status).toBe(201);
  return ((await res.json()) as { order: Order }).order;
}

async function moveTo(orderId: string, statuses: string[]) {
  for (const status of statuses) expect((await send("POST", `/api/staff/orders/${orderId}/status`, { status }, staffId)).status).toBe(200);
}

beforeAll(async () => {
  db = await createTestDb();
  app = buildTestApp(db).app;
  staffId = (await createAuthUser(db, { email: "staff@sales.test", name: "Staff", role: "staff" })).id;
  adminId = (await createAuthUser(db, { email: "admin@sales.test", name: "Admin", role: "admin" })).id;
  customerId = (await createAuthUser(db, { email: "c@sales.test", name: "C" })).id;
  expect((await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, adminId)).status).toBe(200);
  const items = await menu();
  drink = items.find((i) => i.category === "drink" && i.options.length === 0)!;
  v60 = items.find((i) => i.options.length > 0)!;
});

describe("sales dashboard", () => {
  it("adds up completed orders, compares with the period before and lists best sellers", async () => {
    const a = await placeOrder([{ menuItemId: drink.id, quantity: 2 }]);
    const b = await placeOrder([
      { menuItemId: drink.id, quantity: 1 },
      { menuItemId: v60.id, quantity: 1, optionId: v60.options[0]!.id },
    ]);
    const cancelled = await placeOrder([{ menuItemId: drink.id, quantity: 1 }]);
    const old = await placeOrder([{ menuItemId: drink.id, quantity: 1 }]);
    await moveTo(a.id, ["preparing", "ready", "completed"]);
    await moveTo(b.id, ["preparing", "ready", "completed"]);
    await moveTo(cancelled.id, ["cancelled"]);
    await moveTo(old.id, ["preparing", "ready", "completed"]);
    await placeOrder([{ menuItemId: drink.id, quantity: 1 }]); // still open: not counted
    // Last week's order belongs to the previous 7 days.
    await db.query("update public.orders set created_at = now() - interval '8 days' where id = $1", [old.id]);

    const res = await get("/api/admin/sales?range=7d", adminId);
    expect(res.status).toBe(200);
    const report = (await res.json()) as SalesReport;
    expect(report).toMatchObject({ range: "7d", orders: 2, cancelled: 1, revenueHalalas: a.totalHalalas + b.totalHalalas });
    expect(report.previous).toEqual({ orders: 1, revenueHalalas: old.totalHalalas });
    expect(report.days).toHaveLength(7);
    expect(report.days.at(-1)).toMatchObject({ orders: 2, revenueHalalas: a.totalHalalas + b.totalHalalas });
    expect(report.days.slice(0, -1).every((d) => d.orders === 0)).toBe(true);
    expect(report.hours.reduce((s, h) => s + h.orders, 0)).toBe(2);
    expect(report.topItems[0]).toEqual({ nameAr: drink.nameAr, optionNameAr: null, quantity: 3, revenueHalalas: 3 * drink.priceHalalas });
    expect(report.topItems[1]).toMatchObject({ nameAr: v60.nameAr, optionNameAr: v60.options[0]!.nameAr, quantity: 1 });

    const today = (await (await get("/api/admin/sales?range=today", adminId)).json()) as SalesReport;
    expect(today).toMatchObject({ orders: 2, previous: { orders: 0, revenueHalalas: 0 } });
    expect(today.days).toHaveLength(1);
  });

  it("is for admins only and checks the range", async () => {
    expect((await get("/api/admin/sales?range=7d", staffId)).status).toBe(403);
    expect((await get("/api/admin/sales?range=year", adminId)).status).toBe(400);
  });

  it("starts each day at midnight shop time", () => {
    // 01:30 in Riyadh on 10 Oct is 22:30 UTC on 9 Oct.
    const now = new Date("2026-10-09T22:30:00Z");
    expect(startOfLocalDay(now, "Asia/Riyadh").toISOString()).toBe("2026-10-09T21:00:00.000Z");
    expect(startOfLocalDay(now, "Asia/Riyadh", 6).toISOString()).toBe("2026-10-03T21:00:00.000Z");
  });
});

describe("sold out from the order board", () => {
  it("lets staff switch an item or a single origin off and on", async () => {
    const list = (await (await get("/api/staff/menu", staffId)).json()) as { items: MenuItem[] };
    expect(list.items.some((i) => i.id === drink.id)).toBe(true);

    expect((await send("POST", `/api/staff/menu/${drink.id}/availability`, { isAvailable: false }, staffId)).status).toBe(200);
    expect((await menu()).find((i) => i.id === drink.id)!.isAvailable).toBe(false);

    const origin = v60.options[0]!.id;
    const res = await send("POST", `/api/staff/menu/${v60.id}/availability`, { isAvailable: false, optionId: origin }, staffId);
    expect(res.status).toBe(200);
    const saved = (await menu()).find((i) => i.id === v60.id)!;
    expect(saved.isAvailable).toBe(true);
    expect(saved.options.find((o) => o.id === origin)!.isAvailable).toBe(false);
    expect(saved.options.filter((o) => o.id !== origin).every((o) => o.isAvailable)).toBe(true);

    expect((await send("POST", `/api/staff/menu/${drink.id}/availability`, { isAvailable: true }, staffId)).status).toBe(200);
    expect((await menu()).find((i) => i.id === drink.id)!.isAvailable).toBe(true);
  });

  it("refuses customers, unknown origins and bad bodies", async () => {
    expect((await send("POST", `/api/staff/menu/${drink.id}/availability`, { isAvailable: false }, customerId)).status).toBe(403);
    expect((await send("POST", `/api/staff/menu/${v60.id}/availability`, { isAvailable: false, optionId: "nowhere" }, staffId)).status).toBe(404);
    expect((await send("POST", `/api/staff/menu/${drink.id}/availability`, { isAvailable: "no" }, staffId)).status).toBe(400);
  });
});
