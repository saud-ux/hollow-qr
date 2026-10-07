import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MockPushNotifier } from "../../src/server/wallet/apns";
import type { MeResponse, SavedPlace } from "../../src/shared/types";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let notifier: MockPushNotifier;

const home = { kind: "home", address: "حي الملك فهد، شارع 12", details: "باب أسود", lat: 26.3, lng: 44.8 };

function send(method: string, path: string, body: unknown, userId: string) {
  return app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function places(userId: string): Promise<SavedPlace[]> {
  const res = await app.request("/api/me/places", { headers: bearer(userId) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { places: SavedPlace[] }).places;
}

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

beforeAll(async () => {
  db = await createTestDb();
  const built = buildTestApp(db);
  app = built.app;
  notifier = built.notifier as MockPushNotifier;
});

describe("saved places", () => {
  it("saves home, work and named places, home and work first", async () => {
    const user = (await createAuthUser(db, { email: "p1@account.test", name: "One" })).id;
    expect(await places(user)).toEqual([]);

    const named = await send("POST", "/api/me/places", { kind: "other", label: "بيت أهلي", address: "حي الريان", lat: 26.31, lng: 44.81 }, user);
    expect(named.status).toBe(201);
    expect(((await named.json()) as { place: SavedPlace }).place).toMatchObject({ kind: "other", label: "بيت أهلي", details: null });
    expect((await send("POST", "/api/me/places", { ...home, kind: "work", details: "  " }, user)).status).toBe(201);
    expect((await send("POST", "/api/me/places", home, user)).status).toBe(201);

    const list = await places(user);
    expect(list.map((p) => p.kind)).toEqual(["home", "work", "other"]);
    expect(list[0]).toMatchObject({ address: home.address, details: "باب أسود", label: null, lat: 26.3, lng: 44.8 });
    expect(list[1]!.details).toBeNull();
  });

  it("replaces home when a new one is saved, and edits and deletes places", async () => {
    const user = (await createAuthUser(db, { email: "p2@account.test", name: "Two" })).id;
    await send("POST", "/api/me/places", home, user);
    await send("POST", "/api/me/places", { ...home, address: "بيتي الجديد" }, user);
    let list = await places(user);
    expect(list).toHaveLength(1);
    expect(list[0]!.address).toBe("بيتي الجديد");

    // Edit it into a named place, then a second home can't take over the first one's id.
    const id = list[0]!.id;
    const edited = await send("PUT", `/api/me/places/${id}`, { ...home, kind: "other", label: "الاستراحة" }, user);
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { place: SavedPlace }).place).toMatchObject({ id, kind: "other", label: "الاستراحة" });
    await send("POST", "/api/me/places", { ...home, kind: "work" }, user);
    const work = (await places(user)).find((p) => p.kind === "work")!;
    const clash = await send("PUT", `/api/me/places/${id}`, { ...home, kind: "work" }, user);
    expect(clash.status).toBe(409);
    expect(await errorCode(clash)).toBe("PLACE_KIND_TAKEN");

    expect((await send("DELETE", `/api/me/places/${work.id}`, undefined, user)).status).toBe(200);
    expect((await send("DELETE", `/api/me/places/${work.id}`, undefined, user)).status).toBe(404);
    list = await places(user);
    expect(list.map((p) => p.id)).toEqual([id]);
  });

  it("keeps at most 5 places and checks what is sent", async () => {
    const user = (await createAuthUser(db, { email: "p3@account.test", name: "Three" })).id;
    for (let i = 1; i <= 5; i++) {
      expect((await send("POST", "/api/me/places", { ...home, kind: "other", label: `مكان ${i}` }, user)).status).toBe(201);
    }
    const sixth = await send("POST", "/api/me/places", home, user);
    expect(sixth.status).toBe(409);
    expect(await errorCode(sixth)).toBe("PLACES_LIMIT");

    expect((await send("POST", "/api/me/places", { ...home, kind: "other" }, user)).status).toBe(400);
    expect((await send("POST", "/api/me/places", { ...home, address: "" }, user)).status).toBe(400);
    expect((await send("POST", "/api/me/places", { ...home, lat: 120 }, user)).status).toBe(400);
    expect((await send("POST", "/api/me/places", { ...home, kind: "office" }, user)).status).toBe(400);
  });

  it("are private to their owner", async () => {
    const owner = (await createAuthUser(db, { email: "p4@account.test", name: "Owner" })).id;
    const other = (await createAuthUser(db, { email: "p5@account.test", name: "Other" })).id;
    await send("POST", "/api/me/places", home, owner);
    const [place] = await places(owner);
    expect(await places(other)).toEqual([]);
    expect((await send("PUT", `/api/me/places/${place!.id}`, home, other)).status).toBe(404);
    expect((await send("DELETE", `/api/me/places/${place!.id}`, undefined, other)).status).toBe(404);
    expect((await app.request("/api/me/places")).status).toBe(401);
    expect(await places(owner)).toHaveLength(1);
  });

  it("are forgotten when the account is deleted", async () => {
    const user = (await createAuthUser(db, { email: "p6@account.test", name: "Gone" })).id;
    await send("POST", "/api/me/places", home, user);
    expect((await send("POST", "/api/me/delete", { confirm: "DELETE" }, user)).status).toBe(200);
    const rows = await db.query("select 1 from public.customer_places where user_id = $1", [user]);
    expect(rows.rows).toHaveLength(0);
  });
});

describe("changing one's name", () => {
  it("renames the user and refreshes their Wallet pass", async () => {
    const user = (await createAuthUser(db, { email: "n1@account.test", name: "Old Name" })).id;
    const me = (await (await app.request("/api/me", { headers: bearer(user) })).json()) as MeResponse;
    const serial = (await db.query<{ pass_serial: string }>("select pass_serial from public.loyalty_accounts where user_id = $1", [user])).rows[0]!.pass_serial;
    await db.query("insert into public.wallet_devices (device_library_identifier, push_token) values ('dev-n1', $1)", ["ab".repeat(32)]);
    await db.query("insert into public.wallet_registrations (device_library_identifier, pass_type_identifier, pass_serial) values ('dev-n1', 'pass.test', $1)", [serial]);
    const before = (await db.query<{ t: string }>("select wallet_updated_at::text as t from public.loyalty_accounts where user_id = $1", [user])).rows[0]!.t;

    const res = await send("PUT", "/api/me/profile", { displayName: "  سعود  " }, user);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ displayName: "سعود" });
    const after = (await (await app.request("/api/me", { headers: bearer(user) })).json()) as MeResponse;
    expect(after.user.displayName).toBe("سعود");
    expect(after.card!.displayName).toBe("سعود");
    expect(me.card!.memberId).toBe(after.card!.memberId);
    const bumped = (await db.query<{ t: string }>("select wallet_updated_at::text as t from public.loyalty_accounts where user_id = $1", [user])).rows[0]!.t;
    expect(bumped > before).toBe(true);
    await vi.waitFor(() => expect(notifier.sent).toContain("ab".repeat(32)));
  });

  it("refuses an empty or too long name", async () => {
    const user = (await createAuthUser(db, { email: "n2@account.test", name: "Keep" })).id;
    expect((await send("PUT", "/api/me/profile", { displayName: "   " }, user)).status).toBe(400);
    expect((await send("PUT", "/api/me/profile", { displayName: "x".repeat(81) }, user)).status).toBe(400);
    const me = (await (await app.request("/api/me", { headers: bearer(user) })).json()) as MeResponse;
    expect(me.user.displayName).toBe("Keep");
  });
});
