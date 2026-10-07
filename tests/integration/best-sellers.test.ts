import { beforeAll, describe, expect, it } from "vitest";
import type { MenuItem, MenuResponse } from "../../src/shared/ordering";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

let app: ReturnType<typeof buildTestApp>["app"];
let adminId: string;
let staffId: string;

const menu = async () => ((await (await app.request("/api/menu")).json()) as MenuResponse).items;
const patch = (id: string, body: unknown, userId: string) =>
  app.request(`/api/admin/menu/${id}`, { method: "PATCH", headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });

beforeAll(async () => {
  const db = await createTestDb();
  app = buildTestApp(db).app;
  adminId = (await createAuthUser(db, { email: "admin@best.test", name: "Admin", role: "admin" })).id;
  staffId = (await createAuthUser(db, { email: "staff@best.test", name: "Staff", role: "staff" })).id;
});

describe("best sellers", () => {
  it("are none until the admin marks some, then show on the public menu", async () => {
    const items = await menu();
    expect(items.every((i) => i.isBestSeller === false)).toBe(true);

    const [first, second] = items as [MenuItem, MenuItem];
    expect((await patch(first.id, { isBestSeller: true }, adminId)).status).toBe(200);
    expect((await patch(second.id, { isBestSeller: true }, adminId)).status).toBe(200);
    expect((await menu()).filter((i) => i.isBestSeller).map((i) => i.id)).toEqual([first.id, second.id]);

    expect((await patch(first.id, { isBestSeller: false }, adminId)).status).toBe(200);
    expect((await menu()).filter((i) => i.isBestSeller).map((i) => i.id)).toEqual([second.id]);
  });

  it("can only be changed by an admin", async () => {
    const [item] = (await menu()) as [MenuItem];
    expect((await patch(item.id, { isBestSeller: true }, staffId)).status).toBe(403);
    expect((await patch(item.id, { isBestSeller: "yes" }, adminId)).status).toBe(400);
  });
});
