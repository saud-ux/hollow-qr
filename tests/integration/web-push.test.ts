import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MenuResponse, Order } from "../../src/shared/ordering";
import { generateVapidKeys, type MockWebPushSender } from "../../src/server/push/web-push";
import { base64UrlToBytes, bytesToBase64Url } from "../../src/server/security/encoding";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));

let db: PGlite;
let built: ReturnType<typeof buildTestApp>;
let webPush: MockWebPushSender;
let staffId: string;
let adminId: string;
let drinkId: string;
let n = 0;

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return built.app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

async function newCustomer() {
  n += 1;
  return createAuthUser(db, { email: `web${n}@example.com`, name: `Web ${n}` });
}

/** A subscription like PushSubscription.toJSON() gives, with a real P-256 key. */
async function subscription(host = "fcm.googleapis.com") {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return {
    endpoint: `https://${host}/fcm/send/${randomUUID()}`,
    keys: {
      p256dh: bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
      auth: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
}

async function placeOrder(customerId: string): Promise<Order> {
  const res = await post(
    "/api/orders",
    { items: [{ menuItemId: drinkId, quantity: 1 }], fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID() },
    bearer(customerId),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { order: Order }).order;
}

const sentTo = (endpoint: string) => webPush.sent.filter((p) => p.endpoint === endpoint);

beforeAll(async () => {
  db = await createTestDb();
  built = buildTestApp(db);
  webPush = built.webPush;
  staffId = (await createAuthUser(db, { email: "staff@web.test", name: "Staff", role: "staff" })).id;
  adminId = (await createAuthUser(db, { email: "admin@web.test", name: "Admin", role: "admin" })).id;
  const settings = await built.app.request("/api/admin/settings", {
    method: "PUT",
    headers: { "content-type": "application/json", ...bearer(adminId) },
    body: JSON.stringify({ orderingPaused: false, weeklyHours: ALL_DAY }),
  });
  expect(settings.status).toBe(200);
  const menu = (await (await built.app.request("/api/menu")).json()) as MenuResponse;
  drinkId = menu.items.find((i) => i.category === "drink" && i.options.length === 0)!.id;
});

describe("website notifications", () => {
  it("hands out the key browsers subscribe with", async () => {
    const res = await built.app.request("/api/web-push/key");
    expect(res.status).toBe(200);
    const { publicKey } = (await res.json()) as { publicKey: string };
    const raw = base64UrlToBytes(publicKey);
    expect(raw).toHaveLength(65);
    expect(raw[0]).toBe(4);
  });

  it("only accepts subscriptions from real push services, for a signed-in user", async () => {
    const customer = await newCustomer();
    const sub = await subscription();
    expect((await post("/api/me/web-push", sub)).status).toBe(401);
    expect((await post("/api/me/web-push", { ...sub, endpoint: "https://evil.example/push" }, bearer(customer.id))).status).toBe(400);
    expect((await post("/api/me/web-push", { ...sub, endpoint: "http://fcm.googleapis.com/x" }, bearer(customer.id))).status).toBe(400);
    expect((await post("/api/me/web-push", { ...sub, keys: { ...sub.keys, auth: "short" } }, bearer(customer.id))).status).toBe(400);
    expect((await post("/api/me/web-push", sub, bearer(customer.id))).status).toBe(200);
    const rows = await db.query<{ platform: string; web_endpoint: string }>("select platform, web_endpoint from public.push_devices where user_id = $1", [
      customer.id,
    ]);
    expect(rows.rows).toEqual([{ platform: "web", web_endpoint: sub.endpoint }]);
  });

  it("tells the browser when the order moves on, in Arabic whatever the browser's language", async () => {
    const customer = await newCustomer();
    const ar = await subscription("web.push.apple.com");
    const en = await subscription();
    await post("/api/me/web-push", { ...ar, lang: "ar" }, bearer(customer.id));
    await post("/api/me/web-push", { ...en, lang: "en" }, bearer(customer.id));
    const order = await placeOrder(customer.id);
    await vi.waitFor(() => expect(sentTo(ar.endpoint)).toHaveLength(1));
    await vi.waitFor(() => expect(sentTo(en.endpoint)).toHaveLength(1));
    expect(sentTo(ar.endpoint)[0]!.message).toMatchObject({ title: "استلمنا طلبك! 🤩", data: { orderId: order.id } });
    expect(sentTo(en.endpoint)[0]!.message.title).toBe("استلمنا طلبك! 🤩");

    const res = await post(`/api/staff/orders/${order.id}/status`, { status: "preparing" }, bearer(staffId));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(sentTo(ar.endpoint)).toHaveLength(2));
    expect(sentTo(ar.endpoint)[1]!.message.title).toBe("شغّالين على طلبك! ☕");
  });

  it("stops after sign-out, and a browser moves to whoever signs in next", async () => {
    const first = await newCustomer();
    const second = await newCustomer();
    const sub = await subscription();
    await post("/api/me/web-push", sub, bearer(first.id));
    await post("/api/me/web-push", sub, bearer(second.id));
    const rows = await db.query<{ user_id: string }>("select user_id from public.push_devices where web_endpoint = $1", [sub.endpoint]);
    expect(rows.rows.map((r) => r.user_id)).toEqual([second.id]);

    // Someone else can't remove it; its owner can.
    await post("/api/me/web-push/remove", { endpoint: sub.endpoint }, bearer(first.id));
    expect((await db.query("select 1 from public.push_devices where web_endpoint = $1", [sub.endpoint])).rows).toHaveLength(1);
    expect((await post("/api/me/web-push/remove", { endpoint: sub.endpoint }, bearer(second.id))).status).toBe(200);
    expect((await db.query("select 1 from public.push_devices where web_endpoint = $1", [sub.endpoint])).rows).toHaveLength(0);

    const before = webPush.sent.length;
    await placeOrder(second.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(webPush.sent.slice(before).filter((p) => p.endpoint === sub.endpoint)).toHaveLength(0);
  });

  it("drops a browser its push service says is gone", async () => {
    const customer = await newCustomer();
    const sub = await subscription();
    await post("/api/me/web-push", sub, bearer(customer.id));
    const spy = vi.spyOn(webPush, "send").mockResolvedValueOnce("invalid-token");
    await placeOrder(customer.id);
    await vi.waitFor(async () => expect((await db.query("select 1 from public.push_devices where web_endpoint = $1", [sub.endpoint])).rows).toHaveLength(0));
    spy.mockRestore();
  });

  it("reaches browsers in offers and staff alerts", async () => {
    const fan = await newCustomer();
    const fanSub = await subscription();
    await post("/api/me/web-push", fanSub, bearer(fan.id));
    const prefs = await built.app.request("/api/me/notification-prefs", {
      method: "PUT",
      headers: { "content-type": "application/json", ...bearer(fan.id) },
      body: JSON.stringify({ offers: true }),
    });
    expect(prefs.status).toBe(200);

    const created = await post("/api/admin/broadcasts", { title: "عرض", body: "خصم اليوم" }, bearer(adminId));
    expect(created.status).toBe(201);
    const { broadcast } = (await created.json()) as { broadcast: { id: string } };
    const sent = await post(`/api/admin/broadcasts/${broadcast.id}/send`, { after: null }, bearer(adminId));
    expect(sent.status).toBe(200);
    expect(sentTo(fanSub.endpoint).map((p) => p.message.title)).toEqual(["عرض"]);

    const staffSub = await subscription();
    await post("/api/me/web-push", staffSub, bearer(staffId));
    await placeOrder((await newCustomer()).id);
    await vi.waitFor(() => expect(sentTo(staffSub.endpoint).some((p) => p.message.title.startsWith("طلب جديد"))).toBe(true));
  });

  it("keeps one key pair even when two requests make one at once", async () => {
    const [a, b] = [await generateVapidKeys(), await generateVapidKeys()];
    const [kept1, kept2] = await Promise.all([built.repo.saveWebPushKeys(a), built.repo.saveWebPushKeys(b)]);
    expect(kept1.publicKey).toBe(kept2.publicKey);
    expect((await built.repo.getWebPushKeys())!.publicKey).toBe(kept1.publicKey);
    // Nobody but the server can read it.
    const grants = await db.query("select grantee from information_schema.role_table_grants where table_name = 'web_push_keys' and grantee in ('anon', 'authenticated')");
    expect(grants.rows).toHaveLength(0);
  });

  it("refuses a browser row without its keys", async () => {
    const customer = await newCustomer();
    await expect(
      db.query("insert into public.push_devices (token, user_id, platform) values ($1, $2, 'web')", ["ab".repeat(32), customer.id]),
    ).rejects.toThrow();
  });
});
