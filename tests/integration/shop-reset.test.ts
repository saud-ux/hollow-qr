import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RESET_CONFIRM_WORD } from "../../src/shared/constants";
import type { Order } from "../../src/shared/ordering";
import type { MockPushNotifier } from "../../src/server/wallet/apns";
import { bearer, buildTestApp } from "../helpers/app";
import { accountFor, createAuthUser, createTestDb } from "../helpers/db";

const ALL_DAY = Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }));
const PUSH_TOKEN = "cd".repeat(32);

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let notifier: MockPushNotifier;
let adminId: string;
let staffId: string;
let customerId: string;
let drinkId: string;

function send(method: string, path: string, body: unknown, userId: string) {
  return app.request(path, { method, headers: { "content-type": "application/json", ...bearer(userId) }, body: JSON.stringify(body) });
}
const reset = (userId = adminId, confirm: string = RESET_CONFIRM_WORD) => send("POST", "/api/admin/reset", { confirm }, userId);
const benefits = (userId: string, action: string, data: Record<string, unknown>) => send("POST", "/api/benefits", { action, data }, userId);

async function placeOrder(extra: Record<string, unknown> = {}) {
  const res = await send(
    "POST",
    "/api/orders",
    { items: [{ menuItemId: drinkId, quantity: 2 }], fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID(), ...extra },
    customerId,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { order: Order }).order;
}
async function complete(order: Order) {
  for (const status of ["preparing", "ready", "completed"]) {
    expect((await send("POST", `/api/staff/orders/${order.id}/status`, { status }, staffId)).status).toBe(200);
  }
}
const count = async (table: string) => Number((await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0]!.n);

beforeAll(async () => {
  db = await createTestDb();
  const built = buildTestApp(db);
  app = built.app;
  notifier = built.notifier as MockPushNotifier;
  adminId = (await createAuthUser(db, { email: "owner@reset.test", name: "سعود", role: "admin" })).id;
  staffId = (await createAuthUser(db, { email: "barista@reset.test", name: "Barista", role: "staff" })).id;
  customerId = (await createAuthUser(db, { email: "regular@reset.test", name: "Regular" })).id;
  expect((await send("PUT", "/api/admin/settings", { orderingPaused: false, weeklyHours: ALL_DAY }, adminId)).status).toBe(200);
  drinkId = (await db.query<{ id: string }>("insert into public.menu_items (name_ar, category, price_halalas) values ('قهوة مقطرة', 'drink', 1400) returning id")).rows[0]!.id;

  // A customer with cups, a balance, gift cups, a used coupon and a card in Wallet.
  const account = (await db.query<{ id: string; pass_serial: string }>("select id, pass_serial from public.loyalty_accounts where user_id = $1", [customerId])).rows[0]!;
  await db.query("insert into public.wallet_devices (device_library_identifier, push_token) values ('dev-reset', $1)", [PUSH_TOKEN]);
  await db.query("insert into public.wallet_registrations (device_library_identifier, pass_type_identifier, pass_serial) values ('dev-reset', 'pass.test', $1)", [account.pass_serial]);
  expect((await benefits(adminId, "save_gift_items", { items: [drinkId] })).status).toBe(200);
  expect((await benefits(adminId, "save_coupon", { code: "هولو", kind: "percent", value: 20, item_ids: [], per_customer_limit: 5 })).status).toBe(200);
  expect((await benefits(adminId, "adjust", { accountId: account.id, amountHalalas: 5000, cups: 3, reason: "ضيافة", idempotencyKey: randomUUID() })).status).toBe(200);
  await complete(await placeOrder({ couponCode: "هولو", giftCups: 1, useBalance: true }));
  await complete(await placeOrder());
});

describe("starting over («البدء من جديد»)", () => {
  it("is only for the owner, and only with the confirm word", async () => {
    expect((await reset(staffId)).status).toBe(403);
    expect((await reset(customerId)).status).toBe(403);
    expect((await reset(adminId, "حذف")).status).toBe(400);
    expect(await count("orders")).toBe(2);
  });

  it("waits until no order is open", async () => {
    const open = await placeOrder();
    const res = await reset();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("طلبات مفتوحة");
    expect((await send("POST", `/api/staff/orders/${open.id}/status`, { status: "cancelled", reason: "اختبار" }, staffId)).status).toBe(200);
  });

  it("deletes every order and zeroes the cards, keeping the accounts", async () => {
    expect((await accountFor(db, customerId))!.stamp_count).toBeGreaterThan(0);
    const before = { orders: await count("orders"), cups: await count("loyalty_transactions"), profiles: await count("profiles"), menu: await count("menu_items") };

    const res = await reset();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orders: before.orders, cards: 1 });

    for (const table of ["orders", "order_items", "coupon_uses", "benefit_movements", "loyalty_transactions"]) {
      expect(await count(table)).toBe(0);
    }
    expect(await accountFor(db, customerId)).toMatchObject({ stamp_count: 0, reward_available: false });
    expect((await db.query("select balance_halalas, gift_cups from public.benefit_accounts where customer_id = $1", [customerId])).rows[0]).toEqual({ balance_halalas: 0, gift_cups: 0 });
    expect(await count("profiles")).toBe(before.profiles);
    expect(await count("coupons")).toBe(1);
    expect(await count("menu_items")).toBe(before.menu);

    // Everything cleared is kept in the snapshot.
    const saved = (await db.query<{ reset_by: string; orders: number; snapshot: Record<string, unknown[]> }>("select reset_by, orders, snapshot from public.data_resets")).rows;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ reset_by: adminId, orders: before.orders });
    expect(saved[0]!.snapshot.orders).toHaveLength(before.orders);
    expect(saved[0]!.snapshot.loyalty_transactions).toHaveLength(before.cups);
    expect(saved[0]!.snapshot.coupon_uses).toHaveLength(1);

    await vi.waitFor(() => expect(notifier.sent).toContain(PUSH_TOKEN));
  });

  it("numbers the next order 1 and keeps counting cups", async () => {
    const next = await placeOrder();
    expect(next.orderNumber).toBe(1);
    await complete(next);
    expect((await accountFor(db, customerId))!.stamp_count).toBe(2);
    // The cup history is append-only again.
    await expect(db.query("delete from public.loyalty_transactions")).rejects.toThrow(/append-only/);
  });

  it("never wipes a balance a customer paid for", async () => {
    await db.query("insert into public.wallet_topups (id, customer_id, amount_halalas, invoice_id, credited_at) values ($1, $2, 2000, $3, now())", [randomUUID(), customerId, randomUUID()]);
    const res = await reset();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("شحنوا رصيد");
    expect(await count("orders")).toBe(1);
  });
});
