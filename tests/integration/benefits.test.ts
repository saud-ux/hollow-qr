import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createAuthUser, createTestDb } from "../helpers/db";
import { bearer, buildTestApp } from "../helpers/app";
import type { BenefitAccount, BenefitQuote } from "../../src/shared/benefits";
import type { Order } from "../../src/shared/ordering";
let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let admin: string;
let staff: string;
let customer: string;
let other: string;
let accountId: string;
let cheap: string;
let expensive: string;
let dessert: string;
const send = (id: string, action: string, data: Record<string, unknown> = {}) =>
  app.request("/api/benefits", {
    method: "POST",
    headers: { "content-type": "application/json", ...bearer(id) },
    body: JSON.stringify({ action, data }),
  });
const call = async <T>(
  id: string,
  action: string,
  data: Record<string, unknown> = {},
) => (await (await send(id, action, data)).json()) as T;
const quote = (data = {}) =>
  call<BenefitQuote>(customer, "quote", {
    items: [
      { menuItemId: cheap, quantity: 1 },
      { menuItemId: expensive, quantity: 1 },
      { menuItemId: dessert, quantity: 1 },
    ],
    fulfillment: "pickup",
    ...data,
  });
async function coupon(code: string, more = {}) {
  const r = await send(admin, "save_coupon", {
    code,
    kind: "percent",
    value: 20,
    item_ids: [],
    per_customer_limit: 1,
    ...more,
  });
  expect(r.status).toBe(200);
}
async function adjust(money: number, cups: number) {
  const r = await send(admin, "adjust", {
    accountId,
    amountHalalas: money,
    cups,
    reason: "اختبار",
    idempotencyKey: randomUUID(),
  });
  expect(r.status).toBe(200);
}
async function order(extra = {}) {
  return app.request("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json", ...bearer(customer) },
    body: JSON.stringify({
      items: [
        { menuItemId: cheap, quantity: 1 },
        { menuItemId: expensive, quantity: 1 },
        { menuItemId: dessert, quantity: 1 },
      ],
      fulfillment: "pickup",
      phone: "0512345678",
      idempotencyKey: randomUUID(),
      ...extra,
    }),
  });
}
async function status(orderId: string, to: string) {
  const r = await db.query<{ r: { ok: boolean } }>(
    "select public.set_order_status($1,$2,$3::public.order_status) r",
    [staff, orderId, to],
  );
  return r.rows[0]!.r;
}
beforeAll(async () => {
  db = await createTestDb();
  app = buildTestApp(db).app;
  admin = (
    await createAuthUser(db, { email: "admin@benefit.test", role: "admin" })
  ).id;
  staff = (
    await createAuthUser(db, { email: "staff@benefit.test", role: "staff" })
  ).id;
  customer = (await createAuthUser(db, { email: "one@benefit.test" })).id;
  other = (await createAuthUser(db, { email: "two@benefit.test" })).id;
  accountId = (
    await db.query<{ id: string }>(
      "select id from public.loyalty_accounts where user_id=$1",
      [customer],
    )
  ).rows[0]!.id;
  const ids = await db.query<{ id: string }>(
    "insert into public.menu_items(name_ar,category,price_halalas) values ('قهوة اليوم حارة','drink',800),('قهوة مقطرة','drink',1400),('حلى اختبار','dessert',1800) returning id",
  );
  [cheap, expensive, dessert] = ids.rows.map((r) => r.id) as [
    string,
    string,
    string,
  ];
  await send(admin, "save_gift_items", { items: [cheap, expensive] });
  await db.query(
    "update public.shop_settings set ordering_paused=false,weekly_hours=$1::jsonb",
    [
      JSON.stringify(
        Array.from({ length: 7 }, () => ({
          closed: false,
          open: "00:00",
          close: "00:00",
        })),
      ),
    ],
  );
});
describe("customer benefits", () => {
  it("rejects customers and cashiers granting money, coupon edits and other-account reads", async () => {
    for (const who of [customer, staff])
      for (const action of [
        "adjust",
        "save_coupon",
        "save_gift_items",
        "coupons",
      ])
        expect((await send(who, action, {})).status).toBe(403);
    expect((await send(other, "account", { accountId })).status).toBe(403);
    expect((await send(customer, "spend", { accountId })).status).toBe(403);
  });
  it("lists, creates and updates coupons, including the full manager form payload", async () => {
    expect((await send(admin, "coupons")).status).toBe(200);
    await coupon("manager-form", { minimum_halalas: 0, maximum_halalas: null, starts_at: null, ends_at: null, active: true });
    const list = await call<{ items: { id: string; code: string }[] }>(admin, "coupons");
    const saved = list.items.find((c) => c.code === "manager-form")!;
    expect(saved.id).toBeTruthy();
    await coupon("manager-form", { id: saved.id, value: 25 });
    const duplicate = await send(admin, "save_coupon", { code: "manager-form", kind: "percent", value: 20 });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: { code: "COUPON_EXISTS" } });
  });
  it("manager grants separate credit and gifts and retries exactly once", async () => {
    const data = {
      accountId,
      amountHalalas: 5000,
      cups: 10,
      reason: "ضيافة",
      idempotencyKey: randomUUID(),
    };
    expect((await send(admin, "adjust", data)).status).toBe(200);
    expect((await send(admin, "adjust", data)).status).toBe(200);
    expect(await call<BenefitAccount>(customer, "account")).toMatchObject({
      balance_halalas: 5000,
      gift_cups: 10,
    });
    expect((await send(admin, "adjust", { ...data, cups: 11 })).status).toBe(
      409,
    );
    expect(await call<BenefitAccount>(other, "account")).toMatchObject({
      gift_cups: 0,
      balance_halalas: 0,
    });
  });
  it("gifts cover the most expensive coffee and never desserts", async () => {
    expect(await quote({ giftCups: 1 })).toMatchObject({
      gift_discount: 1400,
      total: 2600,
      paid_drinks: 1,
    });
    expect(await quote({ giftCups: 2 })).toMatchObject({
      gift_discount: 2200,
      total: 1800,
      paid_drinks: 0,
    });
    expect(
      (
        await send(customer, "quote", {
          items: [{ menuItemId: dessert, quantity: 1 }],
          giftCups: 1,
        })
      ).status,
    ).toBe(409);
  });
  it("coupon covers only remaining paid products", async () => {
    await coupon("هولو");
    expect(
      await quote({ giftCups: 1, couponCode: "هولو", useBalance: true }),
    ).toMatchObject({
      gift_discount: 1400,
      coupon_discount: 520,
      total: 2080,
      wallet_used: 2080,
      due: 0,
    });
  });
  it("charges authoritative prices, retries without another debit, restores once on cancellation and releases coupon", async () => {
    const k = randomUUID();
    const res = await order({
      idempotencyKey: k,
      giftCups: 1,
      couponCode: "هولو",
      useBalance: true,
      total: 1,
    });
    expect(res.status).toBe(201);
    const o = ((await res.json()) as { order: Order }).order;
    expect(o).toMatchObject({
      totalHalalas: 2080,
      walletHalalas: 2080,
      giftCups: 1,
      couponHalalas: 520,
    });
    expect(
      (
        await order({
          idempotencyKey: k,
          giftCups: 1,
          couponCode: "هولو",
          useBalance: true,
        })
      ).status,
    ).toBe(200);
    expect(await call<BenefitAccount>(customer, "account")).toMatchObject({
      balance_halalas: 2920,
      gift_cups: 9,
    });
    expect(
      (
        await send(customer, "quote", {
          items: [{ menuItemId: cheap, quantity: 1 }],
          couponCode: "هولو",
        })
      ).status,
    ).toBe(409);
    const cancel = () =>
      app.request(`/api/orders/${o.id}/cancel`, {
        method: "POST",
        headers: bearer(customer),
      });
    expect((await cancel()).status).toBe(200);
    expect((await cancel()).status).toBe(409);
    expect(await call<BenefitAccount>(customer, "account")).toMatchObject({
      balance_halalas: 5000,
      gift_cups: 10,
    });
    expect((await quote({ couponCode: "هولو" })).ok).toBe(true);
  });
  it("larger menu discount wins without stacking", async () => {
    await db.query(
      "update public.shop_settings set discount_percent=30,discount_scope='all',discount_ends_at=null",
    );
    expect(await quote({ couponCode: "هولو" })).toMatchObject({
      coupon_discount: 0,
      total: 2800,
    });
    await coupon("big", { value: 50, item_ids: [expensive] });
    expect(await quote({ couponCode: "big" })).toMatchObject({
      coupon_discount: 280,
      total: 2520,
    });
    await db.query("update public.shop_settings set discount_percent=null");
  });
  it("enforces item scope, starts/expiry, minimum and maximum", async () => {
    await coupon("scoped", { item_ids: [dessert], minimum_halalas: 5000 });
    expect(
      (
        await send(customer, "quote", {
          items: [{ menuItemId: dessert, quantity: 1 }],
          couponCode: "scoped",
        })
      ).status,
    ).toBe(409);
    await coupon("expired", { ends_at: "2000-01-01T00:00:00Z" });
    expect(
      (
        await send(customer, "quote", {
          items: [{ menuItemId: cheap, quantity: 1 }],
          couponCode: "expired",
        })
      ).status,
    ).toBe(409);
    await coupon("future", { starts_at: "2099-01-01T00:00:00Z" });
    expect(
      (
        await send(customer, "quote", {
          items: [{ menuItemId: cheap, quantity: 1 }],
          couponCode: "future",
        })
      ).status,
    ).toBe(409);
    await coupon("capped", { maximum_halalas: 200 });
    expect(await quote({ couponCode: "capped" })).toMatchObject({
      coupon_discount: 200,
    });
  });
  it("cashier spends only available funds/gifts with a reason and an eligible coffee", async () => {
    const k = randomUUID();
    const d = {
      accountId,
      amountHalalas: 100,
      cups: 1,
      menuItemId: cheap,
      reason: "فاتورة 1",
      idempotencyKey: k,
    };
    expect((await send(staff, "spend", d)).status).toBe(200);
    expect((await send(staff, "spend", d)).status).toBe(200);
    expect(await call<BenefitAccount>(customer, "account")).toMatchObject({
      balance_halalas: 4900,
      gift_cups: 9,
    });
    expect(
      (
        await send(staff, "spend", {
          ...d,
          idempotencyKey: randomUUID(),
          amountHalalas: 99999,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send(staff, "spend", {
          ...d,
          idempotencyKey: randomUUID(),
          menuItemId: dessert,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send(staff, "spend", {
          ...d,
          idempotencyKey: randomUUID(),
          amountHalalas: -1,
        })
      ).status,
    ).toBe(409);
  });
  it("customer cannot cancel after acceptance; café cancellation restores the original wallet/gifts", async () => {
    const res = await order({ giftCups: 1, useBalance: true });
    const o = ((await res.json()) as { order: Order }).order;
    expect(await status(o.id, "preparing")).toMatchObject({ ok: true });
    expect(
      (
        await app.request(`/api/orders/${o.id}/cancel`, {
          method: "POST",
          headers: bearer(customer),
        })
      ).status,
    ).toBe(409);
    expect(await status(o.id, "cancelled")).toMatchObject({ ok: true });
    expect(await call<BenefitAccount>(customer, "account")).toMatchObject({
      balance_halalas: 4900,
      gift_cups: 9,
    });
  });
  it("only paid coffee earns loyalty, including a discounted coffee", async () => {
    await coupon("paid", { value: 20 });
    const before = (
      await db.query<{ stamp_count: number }>(
        "select stamp_count from public.loyalty_accounts where user_id=$1",
        [customer],
      )
    ).rows[0]!.stamp_count;
    const res = await order({ giftCups: 1, couponCode: "paid" });
    expect(res.status).toBe(201);
    const o = ((await res.json()) as { order: Order }).order;
    for (const s of ["preparing", "ready", "completed"])
      expect(await status(o.id, s)).toMatchObject({ ok: true });
    expect(
      (
        await db.query<{ stamp_count: number }>(
          "select stamp_count from public.loyalty_accounts where user_id=$1",
          [customer],
        )
      ).rows[0]!.stamp_count,
    ).toBe(before + 1);
  });
  it("caps wallet debit at amount due and records manager corrections with reason", async () => {
    await adjust(-4800, -8);
    expect(await quote({ useBalance: true })).toMatchObject({
      wallet_used: 100,
      due: 3900,
    });
    expect(
      (
        await send(admin, "adjust", {
          accountId,
          amountHalalas: -200,
          cups: 0,
          reason: "تصحيح",
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(409);
  });
  it("100% coupon does not generate paid coffee loyalty", async () => {
    await coupon("free", { value: 100 });
    expect(await quote({ couponCode: "free" })).toMatchObject({
      coupon_discount: 4000,
      total: 0,
      paid_drinks: 0,
    });
  });
  it("direct table access and privileged RPCs are unavailable to authenticated clients", async () => {
    await db.exec("set role authenticated");
    try {
      await expect(
        db.query("select * from public.benefit_accounts"),
      ).rejects.toThrow();
      await expect(
        db.query("select public.benefits('adjust',$1,'{}')", [customer]),
      ).rejects.toThrow();
    } finally {
      await db.exec("reset role");
    }
  });
});
