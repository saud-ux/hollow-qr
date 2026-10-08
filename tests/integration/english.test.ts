import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MenuItem, MenuResponse, Order } from "../../src/shared/ordering";
import type { MockAppPushSender } from "../../src/server/push/app-push";
import { orderStatusMessage } from "../../src/server/push/order-notifications";
import { bearer, buildTestApp } from "../helpers/app";
import { createAuthUser, createTestDb } from "../helpers/db";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let appPush: MockAppPushSender;
let adminId: string;
let staffId: string;

const token = (seed: number) => (seed + 0x80).toString(16).padStart(2, "0").repeat(32);

function send(method: string, path: string, body: unknown, userId: string) {
  return app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });
}
const menu = async () => ((await (await app.request("/api/menu")).json()) as MenuResponse).items;

beforeAll(async () => {
  db = await createTestDb();
  const built = buildTestApp(db);
  app = built.app;
  appPush = built.appPush as MockAppPushSender;
  adminId = (await createAuthUser(db, { email: "admin@en.test", name: "Admin", role: "admin" })).id;
  staffId = (await createAuthUser(db, { email: "staff@en.test", name: "Staff", role: "staff" })).id;
  expect((await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, adminId)).status).toBe(200);
});

describe("English menu text", () => {
  it("is saved by the admin and returned with the menu, empty by default", async () => {
    const v60 = (await menu()).find((i) => i.nameEn === "V60")!;
    expect(v60).toMatchObject({ descriptionEn: null, optionLabelEn: null });
    expect(v60.options[0]).toMatchObject({ nameEn: null, noteEn: null });

    const options = v60.options.map((o) => (o.id === "ethiopia" ? { ...o, nameEn: "Ethiopian", noteEn: "  Berries, florals " } : o));
    const res = await send("PATCH", `/api/admin/menu/${v60.id}`, { descriptionEn: "Hand-poured filter coffee", optionLabelEn: "origin", options }, adminId);
    expect(res.status).toBe(200);
    const saved = (await menu()).find((i) => i.id === v60.id) as MenuItem;
    expect(saved).toMatchObject({ descriptionEn: "Hand-poured filter coffee", optionLabelEn: "origin" });
    expect(saved.options.find((o) => o.id === "ethiopia")).toMatchObject({ nameAr: "إثيوبي", nameEn: "Ethiopian", noteEn: "Berries, florals" });

    // Clearing it falls back to Arabic again.
    await send("PATCH", `/api/admin/menu/${v60.id}`, { descriptionEn: "" }, adminId);
    expect((await menu()).find((i) => i.id === v60.id)!.descriptionEn).toBeNull();
  });
});

describe("notifications in the app's language", () => {
  it("words each step in English for English devices", () => {
    const base = { id: "o1", orderNumber: 12, fulfillment: "pickup", totalHalalas: 1550, cancelledBy: null, cancelReason: null, loyaltyResult: null } as unknown as Order;
    expect(orderStatusMessage({ ...base, status: "new" }, "en")).toMatchObject({ title: "Got your order #12! 🤩", body: "Total SAR 15.50, pay on pickup. Loading up..." });
    expect(orderStatusMessage({ ...base, status: "ready" }, "en")).toMatchObject({ title: "Ready at the counter! 📣", body: "Order #12 is waiting for you at the counter." });
    expect(orderStatusMessage({ ...base, status: "ready", fulfillment: "curbside" }, "en")).toMatchObject({
      title: "Your order is ready! 🚗",
      body: 'Order #12 is ready. Tap "I\'m here" on arrival!',
    });
    expect(orderStatusMessage({ ...base, status: "out_for_delivery", fulfillment: "delivery" }, "en")).toMatchObject({
      title: "On its way!💨🚗",
      body: "Order #12 is with the driver, heading your way!",
    });
    expect(orderStatusMessage({ ...base, status: "cancelled", cancelledBy: "staff", cancelReason: "Out of milk" }, "en")!.body).toContain("cancelled: Out of milk");
    expect(orderStatusMessage({ ...base, status: "preparing" }, "en")).toMatchObject({
      title: "We're on it! ☕",
      body: "Your order #12 is being prepared. Ready soon!",
    });
    expect(orderStatusMessage({ ...base, status: "preparing" })).toMatchObject({
      title: "شغّالين على طلبك! ☕",
      body: "طلبك رقم 12 قيد التحضير، جهّز نفسك!",
    });
    expect(orderStatusMessage({ ...base, status: "completed" }, "en")!.title).toBe("HOLLOW");
  });

  it("sends each device the message in its own language", async () => {
    const customer = (await createAuthUser(db, { email: "c@en.test", name: "C" })).id;
    await send("POST", "/api/me/push-devices", { token: token(1), lang: "en" }, customer);
    await send("POST", "/api/me/push-devices", { token: token(2) }, customer);
    expect((await send("POST", "/api/me/push-devices", { token: token(3), lang: "fr" }, customer)).status).toBe(400);

    const drink = (await menu()).find((i) => i.category === "drink" && i.options.length === 0)!;
    const res = await send(
      "POST",
      "/api/orders",
      { items: [{ menuItemId: drink.id, quantity: 1 }], fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID() },
      customer,
    );
    const { order } = (await res.json()) as { order: Order };
    await vi.waitFor(() => expect(appPush.sent.filter((p) => p.message.data?.orderId === order.id)).toHaveLength(2));
    const byToken = new Map(appPush.sent.filter((p) => p.message.data?.orderId === order.id).map((p) => [p.token, p.message.title]));
    expect(byToken.get(token(1))).toContain("Got your order");
    expect(byToken.get(token(2))).toContain("استلمنا طلبك");

    // Switching the app to Arabic re-registers the same device.
    await send("POST", "/api/me/push-devices", { token: token(1), lang: "ar" }, customer);
    expect((await send("POST", `/api/staff/orders/${order.id}/status`, { status: "preparing" }, staffId)).status).toBe(200);
    await vi.waitFor(() => expect(appPush.sent.filter((p) => p.message.data?.orderId === order.id)).toHaveLength(4));
    const latest = appPush.sent.filter((p) => p.message.data?.orderId === order.id).slice(2);
    expect(latest.every((p) => p.message.body.includes("قيد التحضير"))).toBe(true);
  });
});
