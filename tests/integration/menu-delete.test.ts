import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { MenuItem, MenuResponse, Order } from "../../src/shared/ordering";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";
import type { PgliteRepository } from "../helpers/pglite-repository";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let repo: PgliteRepository;
let adminId: string;
let staffId: string;
let customerId: string;

function send(method: string, path: string, body: unknown, userId: string) {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json", ...bearer(userId) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const adminMenu = async () => ((await (await app.request("/api/admin/menu", { headers: bearer(adminId) })).json()) as { items: MenuItem[] }).items;
const publicMenu = async () => ((await (await app.request("/api/menu")).json()) as MenuResponse).items;

async function newItem(nameAr: string): Promise<MenuItem> {
  const res = await send("POST", "/api/admin/menu", { nameAr, category: "dessert", priceHalalas: 1200 }, adminId);
  expect(res.status).toBe(201);
  return ((await res.json()) as { item: MenuItem }).item;
}

beforeAll(async () => {
  db = await createTestDb();
  const built = buildTestApp(db);
  app = built.app;
  repo = built.repo;
  adminId = (await createAuthUser(db, { email: "admin@delete.test", name: "Admin", role: "admin" })).id;
  staffId = (await createAuthUser(db, { email: "staff@delete.test", name: "Staff", role: "staff" })).id;
  customerId = (await createAuthUser(db, { email: "customer@delete.test", name: "عميل" })).id;
  expect((await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, adminId)).status).toBe(200);
});

describe("deleting a menu item", () => {
  it("removes an item never ordered for good, with its photo, and closes up the section", async () => {
    const first = await newItem("صنف أول");
    const doomed = await newItem("صنف للحذف");
    const last = await newItem("صنف أخير");
    const upload = await app.request(`/api/admin/menu/${doomed.id}/image`, {
      method: "PUT",
      headers: { "content-type": "image/png", ...bearer(adminId) },
      body: new Blob([PNG]),
    });
    expect(upload.status).toBe(200);
    const photos = repo.images.size;

    const res = await send("DELETE", `/api/admin/menu/${doomed.id}`, undefined, adminId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, kept: false });
    expect(repo.images.size).toBe(photos - 1);
    expect((await db.query("select 1 from public.menu_items where id = $1", [doomed.id])).rows).toHaveLength(0);

    const items = await adminMenu();
    expect(items.map((i) => i.id)).not.toContain(doomed.id);
    const positions = Object.fromEntries(items.map((i) => [i.id, i.sortOrder]));
    expect(positions[last.id]).toBe(positions[first.id]! + 1);
    expect((await send("DELETE", `/api/admin/menu/${doomed.id}`, undefined, adminId)).status).toBe(404);
  });

  it("keeps an item with past orders for them, but takes it off the menu and the dashboard", async () => {
    const ordered = await newItem("صنف عليه طلب");
    const placed = await send(
      "POST",
      "/api/orders",
      { items: [{ menuItemId: ordered.id, quantity: 1 }], fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID() },
      customerId,
    );
    expect(placed.status).toBe(201);
    const { order } = (await placed.json()) as { order: Order };

    const res = await send("DELETE", `/api/admin/menu/${ordered.id}`, undefined, adminId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, kept: true });

    // Gone from the menu, the dashboard and its hidden items…
    expect((await adminMenu()).map((i) => i.id)).not.toContain(ordered.id);
    expect((await publicMenu()).map((i) => i.id)).not.toContain(ordered.id);
    // …and it can't be ordered again.
    const again = await send(
      "POST",
      "/api/orders",
      { items: [{ menuItemId: ordered.id, quantity: 1 }], fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID() },
      customerId,
    );
    expect(again.status).toBe(409);
    // The past order still shows it.
    const past = (await (await app.request(`/api/orders/${order.id}`, { headers: bearer(customerId) })).json()) as { order: Order };
    expect(past.order.items.map((i) => i.nameAr)).toContain("صنف عليه طلب");
  });

  it("is for admins only", async () => {
    const item = await newItem("صنف محمي");
    expect((await send("DELETE", `/api/admin/menu/${item.id}`, undefined, staffId)).status).toBe(403);
    expect((await send("DELETE", `/api/admin/menu/${item.id}`, undefined, customerId)).status).toBe(403);
    expect((await adminMenu()).map((i) => i.id)).toContain(item.id);
  });
});
