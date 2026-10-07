import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { MenuItem, MenuResponse, Order, OrderHistoryPage } from "../../src/shared/ordering";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let staffId: string;
let adminId: string;
let customerId: string;
let otherId: string;
let drink: MenuItem;
let v60: MenuItem;

function send(method: string, path: string, body: unknown, userId: string) {
  return app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });
}
const get = (path: string, userId: string) => app.request(path, { headers: bearer(userId) });
const history = async (query = "") => {
  const res = await get(`/api/admin/orders${query}`, adminId);
  expect(res.status).toBe(200);
  return (await res.json()) as OrderHistoryPage;
};

async function placeOrder(userId: string, phone: string, items: { menuItemId: string; quantity: number; optionId?: string; note?: string }[], extra = {}): Promise<Order> {
  const res = await send("POST", "/api/orders", { items, fulfillment: "pickup", phone, idempotencyKey: randomUUID(), ...extra }, userId);
  expect(res.status).toBe(201);
  return ((await res.json()) as { order: Order }).order;
}

async function moveTo(orderId: string, statuses: string[], body: Record<string, unknown> = {}) {
  for (const status of statuses) expect((await send("POST", `/api/staff/orders/${orderId}/status`, { status, ...body }, staffId)).status).toBe(200);
}

let done: Order;
let cancelled: Order;
let open: Order;
let old: Order;

beforeAll(async () => {
  db = await createTestDb();
  app = buildTestApp(db).app;
  staffId = (await createAuthUser(db, { email: "staff@history.test", name: "Abdullah", role: "staff" })).id;
  adminId = (await createAuthUser(db, { email: "admin@history.test", name: "Admin", role: "admin" })).id;
  customerId = (await createAuthUser(db, { email: "c@history.test", name: "Saud" })).id;
  otherId = (await createAuthUser(db, { email: "n@history.test", name: "Noura" })).id;
  expect((await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, adminId)).status).toBe(200);
  const items = ((await (await app.request("/api/menu")).json()) as MenuResponse).items;
  drink = items.find((i) => i.category === "drink" && i.options.length === 0)!;
  v60 = items.find((i) => i.options.length > 0)!;

  done = await placeOrder(customerId, "0511111111", [
    { menuItemId: drink.id, quantity: 2, note: "سكر قليل" },
    { menuItemId: v60.id, quantity: 1, optionId: v60.options[0]!.id },
  ], { note: "بسرعة لو سمحت" });
  await moveTo(done.id, ["preparing", "ready", "completed"]);
  cancelled = await placeOrder(otherId, "0522222222", [{ menuItemId: drink.id, quantity: 1 }]);
  await moveTo(cancelled.id, ["cancelled"], { cancelReason: "نفد الحليب" });
  open = await placeOrder(otherId, "0522222222", [{ menuItemId: drink.id, quantity: 1 }]);
  await moveTo(open.id, ["preparing"]);
  old = await placeOrder(customerId, "0511111111", [{ menuItemId: drink.id, quantity: 1 }]);
  await moveTo(old.id, ["preparing", "ready", "completed"]);
  await db.query("update public.orders set created_at = now() - interval '40 days' where id = $1", [old.id]);
});

describe("admin order history", () => {
  it("lists every order, newest first, with all its details", async () => {
    const page = await history();
    expect(page).toMatchObject({ total: 4, page: 1, pageSize: 25, counts: { all: 4, active: 1, completed: 2, cancelled: 1 } });
    expect(page.revenueHalalas).toBe(done.totalHalalas + old.totalHalalas);
    expect(page.items.map((o) => o.id)).toEqual([open.id, cancelled.id, done.id, old.id]);

    const d = page.items.find((o) => o.id === done.id)!;
    expect(d).toMatchObject({ status: "completed", customerName: "Saud", customerPhone: "0511111111", note: "بسرعة لو سمحت", completedByName: "Abdullah" });
    expect(d.memberId).toMatch(/^HLW-/);
    expect(d.accountId).toEqual(expect.any(String));
    expect(d.acceptedAt && d.readyAt && d.completedAt).toBeTruthy();
    expect(d.items).toEqual([
      expect.objectContaining({ nameAr: drink.nameAr, quantity: 2, note: "سكر قليل" }),
      expect.objectContaining({ nameAr: v60.nameAr, optionNameAr: v60.options[0]!.nameAr }),
    ]);
    expect(d.loyaltyResult).toMatchObject({ cupsAdded: 3 });
    expect(page.items.find((o) => o.id === cancelled.id)).toMatchObject({ status: "cancelled", cancelReason: "نفد الحليب", cancelledBy: "staff", completedByName: null });
  });

  it("filters by state", async () => {
    expect((await history("?status=active")).items.map((o) => o.id)).toEqual([open.id]);
    expect((await history("?status=completed")).items.map((o) => o.id)).toEqual([done.id, old.id]);
    expect((await history("?status=cancelled")).items.map((o) => o.id)).toEqual([cancelled.id]);
    const ended = await history("?status=ended");
    expect(ended.items.map((o) => o.id)).toEqual([cancelled.id, done.id, old.id]);
    // The chips keep counting every state.
    expect(ended.counts).toEqual({ all: 4, active: 1, completed: 2, cancelled: 1 });
    expect(ended.revenueHalalas).toBe(done.totalHalalas + old.totalHalalas);
  });

  it("filters by period (local days, both ends included)", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
    const recent = await history(`?from=${today}&to=${today}`);
    expect(recent.total).toBe(3);
    expect(recent.items.some((o) => o.id === old.id)).toBe(false);
    expect((await history(`?to=${today}`)).total).toBe(4);
    const before = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date(Date.now() - 30 * 864e5));
    expect((await history(`?to=${before}`)).items.map((o) => o.id)).toEqual([old.id]);
  });

  it("searches by order number, name, phone and member ID", async () => {
    expect((await history(`?q=${done.orderNumber}`)).items.map((o) => o.id)).toContain(done.id);
    expect((await history(`?q=%23${cancelled.orderNumber}`)).items.map((o) => o.id)).toContain(cancelled.id);
    expect((await history("?q=noura")).items.map((o) => o.id)).toEqual([open.id, cancelled.id]);
    expect((await history("?q=0511111")).total).toBe(2);
    const memberId = (await history()).items.find((o) => o.id === done.id)!.memberId!;
    expect((await history(`?q=${memberId.toLowerCase()}`)).items.map((o) => o.id)).toEqual([done.id, old.id]);
    // LIKE wildcards are plain text.
    expect((await history("?q=%25")).total).toBe(0);
  });

  it("pages through the orders", async () => {
    const first = await history("?pageSize=3");
    const second = await history("?pageSize=3&page=2");
    expect(first.items).toHaveLength(3);
    expect(second.items.map((o) => o.id)).toEqual([old.id]);
    expect(second.total).toBe(4);
  });

  it("exports the filtered orders as CSV", async () => {
    const res = await get("/api/admin/export/orders.csv?status=completed", adminId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("order_number,order_id");
    expect(lines[1]).toContain(`${done.orderNumber},${done.id}`);
    expect(lines[1]).toContain(`2× ${drink.nameAr} [سكر قليل]`);
    expect(lines[1]).toContain("Abdullah");
  });

  it("is for admins only", async () => {
    expect((await get("/api/admin/orders", staffId)).status).toBe(403);
    expect((await get("/api/admin/orders", customerId)).status).toBe(403);
    expect((await get("/api/admin/orders?status=bogus", adminId)).status).toBe(400);
    expect((await get("/api/admin/orders?from=yesterday", adminId)).status).toBe(400);
  });
});
