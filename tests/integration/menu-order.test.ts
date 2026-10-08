import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { MenuItem } from "../../src/shared/ordering";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let adminId: string;

function send(method: string, path: string, body: unknown) {
  return app.request(path, { method, headers: { "content-type": "application/json", ...bearer(adminId) }, body: JSON.stringify(body) });
}
const menu = async () => ((await (await app.request("/api/admin/menu", { headers: bearer(adminId) })).json()) as { items: MenuItem[] }).items;
const section = async (category: string) =>
  (await menu())
    .filter((i) => i.category === category && !i.isArchived)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => [i.nameAr, i.sortOrder]);

async function create(nameAr: string, extra: Record<string, unknown> = {}) {
  const res = await send("POST", "/api/admin/menu", { nameAr, category: "dessert", priceHalalas: 1000, ...extra });
  expect(res.status).toBe(201);
  return ((await res.json()) as { item: MenuItem }).item;
}

beforeAll(async () => {
  db = await createTestDb();
  app = buildTestApp(db).app;
  adminId = (await createAuthUser(db, { email: "admin@order.test", name: "Admin", role: "admin" })).id;
  // Start from an empty dessert section.
  await db.query("update public.menu_items set is_archived = true where category = 'dessert'");
});

describe("menu positions", () => {
  it("numbers each section 1, 2, 3 and puts a new item last", async () => {
    await create("أ");
    await create("ب");
    const c = await create("ج");
    expect(c.sortOrder).toBe(3);
    expect(await section("dessert")).toEqual([["أ", 1], ["ب", 2], ["ج", 3]]);
  });

  it("moving an item to a position shifts the others", async () => {
    const c = (await menu()).find((i) => i.nameAr === "ج")!;
    expect((await send("PATCH", `/api/admin/menu/${c.id}`, { sortOrder: 1 })).status).toBe(200);
    expect(await section("dessert")).toEqual([["ج", 1], ["أ", 2], ["ب", 3]]);
    await create("د", { sortOrder: 2 });
    expect(await section("dessert")).toEqual([["ج", 1], ["د", 2], ["أ", 3], ["ب", 4]]);
  });

  it("hiding or moving an item to another section closes the gap", async () => {
    const d = (await menu()).find((i) => i.nameAr === "د")!;
    expect((await send("PATCH", `/api/admin/menu/${d.id}`, { isArchived: true })).status).toBe(200);
    expect(await section("dessert")).toEqual([["ج", 1], ["أ", 2], ["ب", 3]]);
    const a = (await menu()).find((i) => i.nameAr === "أ")!;
    const drinks = (await section("drink")).length;
    expect((await send("PATCH", `/api/admin/menu/${a.id}`, { category: "drink", sortOrder: 1 })).status).toBe(200);
    expect(await section("dessert")).toEqual([["ج", 1], ["ب", 2]]);
    const drinkList = await section("drink");
    expect(drinkList[0]).toEqual(["أ", 1]);
    expect(drinkList).toHaveLength(drinks + 1);
    expect(drinkList.map(([, n]) => n)).toEqual(drinkList.map((_, i) => i + 1));
  });
});
