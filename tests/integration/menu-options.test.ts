import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { MenuItem, MenuResponse, Order } from "../../src/shared/ordering";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let adminId: string;
let customerId: string;
let menu: MenuItem[];

function send(method: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const item = (name: string) => menu.find((m) => m.nameAr === name)!;
const reloadMenu = async () => {
  menu = ((await (await app.request("/api/menu")).json()) as MenuResponse).items;
};
const order = (items: unknown[]) =>
  send("POST", "/api/orders", { items, fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID() }, bearer(customerId));

beforeAll(async () => {
  db = await createTestDb();
  app = buildTestApp(db).app;
  adminId = (await createAuthUser(db, { email: "admin@options.test", name: "Admin", role: "admin" })).id;
  customerId = (await createAuthUser(db, { email: "c@options.test", name: "Customer" })).id;
  const res = await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, bearer(adminId));
  expect(res.status).toBe(200);
  await reloadMenu();
});

describe("coffee origins", () => {
  it("lists the three origins on hot and iced V60 only", () => {
    for (const name of ["قهوة مقطرة", "قهوة مقطرة باردة"]) {
      expect(item(name)).toMatchObject({ optionLabel: "المحصول" });
      expect(item(name).options.map((o) => o.nameAr)).toEqual(["إثيوبي", "برازيلي", "كوستاريكي"]);
    }
    expect(item("ماتشا باردة").options).toEqual([]);
  });

  it("requires an origin and keeps the chosen one on the order", async () => {
    const v60 = item("قهوة مقطرة").id;
    const missing = await order([{ menuItemId: v60, quantity: 1 }]);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: "OPTION_REQUIRED" } });

    const bogus = await order([{ menuItemId: v60, quantity: 1, optionId: "kenya" }]);
    expect(await bogus.json()).toMatchObject({ error: { code: "OPTION_UNAVAILABLE" } });

    const notApplicable = await order([{ menuItemId: item("ماتشا باردة").id, quantity: 1, optionId: "ethiopia" }]);
    expect(await notApplicable.json()).toMatchObject({ error: { code: "OPTION_UNAVAILABLE" } });

    // Same item, two origins: two lines, same price.
    const ok = await order([
      { menuItemId: v60, quantity: 1, optionId: "ethiopia" },
      { menuItemId: v60, quantity: 2, optionId: "costa-rica" },
    ]);
    expect(ok.status).toBe(201);
    const placed = ((await ok.json()) as { order: Order }).order;
    expect(placed.items.map((l) => [l.optionNameAr, l.quantity, l.unitPriceHalalas])).toEqual([
      ["إثيوبي", 1, 1500],
      ["كوستاريكي", 2, 1500],
    ]);
    expect(placed.subtotalHalalas).toBe(4500);
  });

  it("lets the admin mark one origin out of stock and write tasting notes", async () => {
    const v60 = item("قهوة مقطرة باردة");
    const options = v60.options.map((o) =>
      o.id === "ethiopia" ? { ...o, isAvailable: false } : o.id === "brazil" ? { ...o, noteAr: "شوكولاتة ومكسرات" } : o,
    );
    const res = await send("PATCH", `/api/admin/menu/${v60.id}`, { options }, bearer(adminId));
    expect(res.status).toBe(200);
    await reloadMenu();
    expect(item("قهوة مقطرة باردة").options.find((o) => o.id === "brazil")!.noteAr).toBe("شوكولاتة ومكسرات");

    const soldOut = await order([{ menuItemId: v60.id, quantity: 1, optionId: "ethiopia" }]);
    expect(soldOut.status).toBe(409);
    expect(await soldOut.json()).toMatchObject({ error: { code: "OPTION_UNAVAILABLE" } });
    expect((await order([{ menuItemId: v60.id, quantity: 1, optionId: "brazil" }])).status).toBe(201);
  });

  it("validates the admin's options", async () => {
    const v60 = item("قهوة مقطرة");
    const dup = [
      { id: "brazil", nameAr: "برازيلي", noteAr: null, isAvailable: true },
      { id: "brazil", nameAr: "برازيلي ٢", noteAr: null, isAvailable: true },
    ];
    expect((await send("PATCH", `/api/admin/menu/${v60.id}`, { options: dup }, bearer(adminId))).status).toBe(400);
    const badId = [{ id: "Brazil Beans!", nameAr: "برازيلي", noteAr: null, isAvailable: true }];
    expect((await send("PATCH", `/api/admin/menu/${v60.id}`, { options: badId }, bearer(adminId))).status).toBe(400);
    // Removing every option turns the choice off again.
    const cleared = await send("PATCH", `/api/admin/menu/${v60.id}`, { options: [], optionLabel: null }, bearer(adminId));
    expect(cleared.status).toBe(200);
    expect((await order([{ menuItemId: v60.id, quantity: 1 }])).status).toBe(201);
  });
});
