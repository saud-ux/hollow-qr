import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { MenuItem, MenuResponse, Order } from "../../src/shared/ordering";
import { findInMenu } from "../../src/shared/menu-search";
import { bearer, buildTestApp } from "../helpers/app";
import { accountFor, createAuthUser, createTestDb } from "../helpers/db";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let adminId: string;
let staffId: string;

function send(method: string, path: string, body: unknown, userId: string) {
  return app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });
}

beforeAll(async () => {
  db = await createTestDb();
  app = buildTestApp(db).app;
  adminId = (await createAuthUser(db, { email: "owner@box.test", name: "Owner", role: "admin" })).id;
  staffId = (await createAuthUser(db, { email: "barista@box.test", name: "Barista", role: "staff" })).id;
  expect((await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, adminId)).status).toBe(200);
});

describe("boxes on the menu", () => {
  let box: MenuItem;

  it("lets the owner put an item in «البوكسات», after the drinks and desserts", async () => {
    const res = await send("POST", "/api/admin/menu", { nameAr: "بوكس وافل كبير", nameEn: "Large Waffle Box", category: "box", priceHalalas: 6500 }, adminId);
    expect(res.status).toBe(201);
    box = ((await res.json()) as { item: MenuItem }).item;
    expect(box).toMatchObject({ category: "box", sortOrder: 1 });

    const menu = ((await (await app.request("/api/menu")).json()) as MenuResponse).items;
    expect(menu.at(-1)).toMatchObject({ id: box.id, category: "box" });
    expect(findInMenu(menu, "بوكسات").items.map((i) => i.id)).toEqual([box.id]);
    expect((await send("POST", "/api/admin/menu", { nameAr: "x", category: "breakfast", priceHalalas: 100 }, adminId)).status).toBe(400);
  });

  it("can be ordered, and like a dessert earns no loyalty cup", async () => {
    const customer = await createAuthUser(db, { email: "box@example.com", name: "Customer" });
    const placed = await send(
      "POST",
      "/api/orders",
      { items: [{ menuItemId: box.id, quantity: 1 }], fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID() },
      customer.id,
    );
    expect(placed.status).toBe(201);
    const order = ((await placed.json()) as { order: Order }).order;
    expect(order.items[0]).toMatchObject({ category: "box", unitPriceHalalas: 6500 });

    let done: Order | undefined;
    for (const status of ["preparing", "ready", "completed"]) {
      const res = await send("POST", `/api/staff/orders/${order.id}/status`, { status }, staffId);
      expect(res.status).toBe(200);
      done = ((await res.json()) as { order: Order }).order;
    }
    expect(done!.loyaltyResult).toMatchObject({ cupsAdded: 0 });
    expect((await accountFor(db, customer.id))!.stamp_count).toBe(0);
  });
});
