/**
 * The coupon preview's per-item split (`coupon_by_item`, migration
 * 20261029000000). This is money, so it is checked several independent ways:
 *
 *  1. Old against new: the original function (copied from its migration as
 *     `benefit_quote_old`) and the new one price the same thousands of random
 *     carts, coupons, menu discounts, gifts, rewards and balances. Everything
 *     the old one returned must come back identical, errors included.
 *  2. The split itself: it adds up to the coupon discount exactly, is never
 *     zero or negative, never more than an item's own price, and only names
 *     items in the cart that the coupon covers.
 *  3. Worked examples with hand-computed amounts.
 *  4. Real orders through the API: what is charged equals the old preview.
 *
 * COUPON_FUZZ_CASES / COUPON_FUZZ_SEED run more cases or replay a failure.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createAuthUser, createTestDb } from "../helpers/db";
import { bearer, buildTestApp } from "../helpers/app";
import type { Order } from "../../src/shared/ordering";

type Quote = Record<string, unknown> & { ok: boolean; coupon_discount?: number; coupon_by_item?: Record<string, number> };

const CASES = Number(process.env.COUPON_FUZZ_CASES ?? 1500);
const SEED = Number(process.env.COUPON_FUZZ_SEED ?? 20261029);

/** Small, seeded PRNG (mulberry32): the same seed gives the same cases. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;
  const chance = (p: number) => next() < p;
  const subset = <T>(xs: readonly T[]) => xs.filter(() => chance(0.4));
  return { int, pick, chance, subset };
}

/** The pricing function exactly as it was before this change. */
function oldQuoteSql(): string {
  const src = readFileSync(join(import.meta.dirname, "../../supabase/migrations/20261021000000_customer_benefits.sql"), "utf8");
  const start = src.indexOf("create function public.benefit_quote(");
  const end = src.indexOf("end $$;", start) + "end $$;".length;
  return src.slice(start, end).replace("create function public.benefit_quote(", "create function public.benefit_quote_old(");
}

/** COUPON_FUZZ_REPORT=<file>: append each run's numbers there (the runner hides passing tests' output). */
function report(name: string, numbers: Record<string, unknown>) {
  console.log(name, JSON.stringify(numbers));
  if (process.env.COUPON_FUZZ_REPORT) appendFileSync(process.env.COUPON_FUZZ_REPORT, `${name} ${JSON.stringify(numbers)}\n`);
}

const withoutSplit = (q: Quote) => {
  const { coupon_by_item: _split, ...rest } = q;
  return rest;
};

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let customer: string;
const items: { id: string; price: number; drink: boolean }[] = [];
let giftIds: string[] = [];

const PRICES: [number, "drink" | "dessert"][] = [
  [99, "dessert"], [500, "drink"], [777, "drink"], [800, "drink"], [1050, "dessert"], [1199, "drink"], [1400, "drink"],
  [1650, "dessert"], [1800, "drink"], [2000, "drink"], [2350, "dessert"], [2999, "drink"], [3500, "dessert"], [4500, "drink"],
];

async function quotes(data: Record<string, unknown>): Promise<{ next: Quote; old: Quote }> {
  const r = await db.query<{ n: Quote; o: Quote }>("select public.benefit_quote($1,$2::jsonb) n, public.benefit_quote_old($1,$2::jsonb) o", [customer, JSON.stringify(data)]);
  return { next: r.rows[0]!.n, old: r.rows[0]!.o };
}

async function setMenuDiscount(percent: number | null, scope: "all" | "items" = "all", ids: string[] = [], endsAt: string | null = null) {
  await db.query("update public.shop_settings set discount_percent=$1, discount_scope=$2, discount_item_ids=$3::uuid[], discount_ends_at=$4 where id=1", [percent, scope, ids, endsAt]);
}

async function setCoupon(c: { code: string; kind: "percent" | "fixed"; value: number; item_ids?: string[]; minimum?: number; maximum?: number | null; starts?: string | null; ends?: string | null; active?: boolean }) {
  await db.query(
    `insert into public.coupons(code,kind,value,item_ids,minimum_halalas,maximum_halalas,per_customer_limit,starts_at,ends_at,active)
     values ($1,$2,$3,$4::uuid[],$5,$6,null,$7,$8,$9)
     on conflict (code) do update set kind=excluded.kind,value=excluded.value,item_ids=excluded.item_ids,minimum_halalas=excluded.minimum_halalas,
       maximum_halalas=excluded.maximum_halalas,per_customer_limit=null,starts_at=excluded.starts_at,ends_at=excluded.ends_at,active=excluded.active`,
    [c.code, c.kind, c.value, c.item_ids ?? [], c.minimum ?? 0, c.maximum ?? null, c.starts ?? null, c.ends ?? null, c.active ?? true],
  );
}

const byName = (price: number) => items.find((i) => i.price === price)!.id;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(oldQuoteSql());
  app = buildTestApp(db).app;
  customer = (await createAuthUser(db, { email: "one@split.test" })).id;
  for (const [price, category] of PRICES) {
    const r = await db.query<{ id: string }>("insert into public.menu_items(name_ar,category,price_halalas) values ($1,$2,$3) returning id", [`صنف ${price}`, category, price]);
    items.push({ id: r.rows[0]!.id, price, drink: category === "drink" });
  }
  giftIds = items.filter((i) => i.drink && i.price <= 1400).map((i) => i.id);
  for (const id of giftIds) await db.query("insert into public.gift_coffee_items(item_id) values ($1)", [id]);
  await db.query("insert into public.benefit_accounts(customer_id,balance_halalas,gift_cups) values ($1,50000,40) on conflict (customer_id) do update set balance_halalas=50000,gift_cups=40", [customer]);
  await db.query("update public.shop_settings set ordering_paused=false, pickup_enabled=true, curbside_enabled=true, delivery_enabled=true, delivery_min_order_halalas=0, max_open_orders=null, delivery_fee_halalas=700, weekly_hours=$1::jsonb", [
    JSON.stringify(Array.from({ length: 7 }, () => ({ closed: false, open: "00:00", close: "00:00" }))),
  ]);
}, 120_000);

describe("coupon split per item: worked examples", () => {
  it("20% on everything splits 1210 as 720 / 280 / 210", async () => {
    await setMenuDiscount(null);
    await setCoupon({ code: "twenty", kind: "percent", value: 20 });
    const data = { items: [{ menuItemId: byName(1800), quantity: 2 }, { menuItemId: byName(1400), quantity: 1 }, { menuItemId: byName(1050), quantity: 1 }], fulfillment: "pickup", couponCode: "TWENTY" };
    const { next, old } = await quotes(data);
    expect(withoutSplit(next)).toEqual(old);
    // 1800+1800+1400+1050 = 6050; 20% = 1210, shared in proportion to list price, dearest first.
    expect(next.coupon_discount).toBe(1210);
    expect(next.coupon_by_item).toEqual({ [byName(1800)]: 720, [byName(1400)]: 280, [byName(1050)]: 210 });
  });

  it("a coupon for one item only puts its whole discount on that item", async () => {
    await setCoupon({ code: "coffee", kind: "percent", value: 50, item_ids: [byName(1400)] });
    const { next, old } = await quotes({ items: [{ menuItemId: byName(1800), quantity: 1 }, { menuItemId: byName(1400), quantity: 2 }], fulfillment: "pickup", couponCode: "coffee" });
    expect(withoutSplit(next)).toEqual(old);
    expect(next.coupon_by_item).toEqual({ [byName(1400)]: 1400 });
  });

  it("a fixed coupon with a cap never splits more than the cap", async () => {
    await setCoupon({ code: "fixed", kind: "fixed", value: 5000, maximum: 333 });
    const { next, old } = await quotes({ items: [{ menuItemId: byName(777), quantity: 3 }, { menuItemId: byName(2999), quantity: 1 }], fulfillment: "delivery", couponCode: "fixed" });
    expect(withoutSplit(next)).toEqual(old);
    expect(next.coupon_discount).toBe(333);
    expect(Object.values(next.coupon_by_item!).reduce((a, b) => a + b, 0)).toBe(333);
  });

  it("a menu discount bigger than the coupon's share leaves that item out", async () => {
    await setMenuDiscount(60, "items", [byName(1800)]);
    await setCoupon({ code: "ten", kind: "percent", value: 10 });
    const { next, old } = await quotes({ items: [{ menuItemId: byName(1800), quantity: 1 }, { menuItemId: byName(2000), quantity: 1 }], fulfillment: "pickup", couponCode: "ten" });
    expect(withoutSplit(next)).toEqual(old);
    expect(next.coupon_by_item![byName(1800)]).toBeUndefined();
    expect(next.coupon_by_item![byName(2000)]).toBe(next.coupon_discount);
    await setMenuDiscount(null);
  });

  it("gifted cups and the free drink take no coupon share", async () => {
    await setCoupon({ code: "all", kind: "percent", value: 30 });
    const { next, old } = await quotes({
      items: [{ menuItemId: byName(1400), quantity: 2 }, { menuItemId: byName(2000), quantity: 1 }, { menuItemId: byName(1050), quantity: 1 }],
      fulfillment: "pickup", couponCode: "all", giftCups: 2, useReward: true,
    });
    expect(withoutSplit(next)).toEqual(old);
    // Both 1400s are gifted and the 2000 drink is the free one: only the dessert pays, so only it is discounted.
    expect(next.coupon_by_item).toEqual({ [byName(1050)]: next.coupon_discount });
  });

  it("no coupon, a wrong code, an expired one or a missed minimum: no split, same answer as before", async () => {
    await setCoupon({ code: "old", kind: "percent", value: 20, ends: "2020-01-01T00:00:00Z" });
    await setCoupon({ code: "big", kind: "percent", value: 20, minimum: 999_999 });
    const cart = [{ menuItemId: byName(1800), quantity: 1 }];
    const none = await quotes({ items: cart, fulfillment: "pickup" });
    expect(withoutSplit(none.next)).toEqual(none.old);
    expect(none.next.coupon_by_item).toEqual({});
    for (const couponCode of ["nope", "old", "big"]) {
      const { next, old } = await quotes({ items: cart, fulfillment: "pickup", couponCode });
      expect(next).toEqual(old);
      expect(next.ok).toBe(false);
    }
  });

  it("the API passes the split through to the checkout", async () => {
    const res = await app.request("/api/benefits", {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(customer) },
      body: JSON.stringify({ action: "quote", data: { items: [{ menuItemId: byName(2000), quantity: 2 }], fulfillment: "pickup", couponCode: "twenty" } }),
    });
    expect(res.status).toBe(200);
    const q = (await res.json()) as Quote;
    expect(q.coupon_by_item).toEqual({ [byName(2000)]: q.coupon_discount });
  });
});

describe("coupon split: old against new on random carts", () => {
  it(`${CASES} random cases (seed ${SEED}): same amounts as before, and a split that adds up`, async () => {
    const r = rng(SEED);
    const ids = items.map((i) => i.id);
    const stats = { ok: 0, withCoupon: 0, errors: {} as Record<string, number> };
    for (let n = 0; n < CASES; n++) {
      // A menu discount half the time: on everything, or on some items, sometimes already over.
      if (r.chance(0.5)) await setMenuDiscount(r.int(1, 90), r.chance(0.5) ? "all" : "items", r.subset(ids), r.chance(0.15) ? "2020-01-01T00:00:00Z" : null);
      else await setMenuDiscount(null);
      const scoped = r.chance(0.35);
      const percent = r.chance(0.6);
      await setCoupon({
        code: "fuzz",
        kind: percent ? "percent" : "fixed",
        value: percent ? r.int(1, 100) : r.int(1, 9000),
        item_ids: scoped ? r.subset(ids) : [],
        minimum: r.chance(0.2) ? r.int(0, 12000) : 0,
        maximum: r.chance(0.3) ? r.int(1, 4000) : null,
        ends: r.chance(0.05) ? "2020-01-01T00:00:00Z" : null,
        active: r.chance(0.97),
      });
      const lines = Array.from({ length: r.int(1, 6) }, () => ({ menuItemId: r.pick(ids), quantity: r.chance(0.1) ? r.int(6, 8) : r.int(1, 4) }));
      const units = lines.reduce((s, l) => s + l.quantity, 0);
      const data = {
        items: lines,
        fulfillment: r.pick(["pickup", "curbside", "delivery"]),
        couponCode: r.chance(0.85) ? r.pick(["fuzz", "FUZZ", " Fuzz "]) : r.chance(0.5) ? "" : "nope",
        giftCups: r.chance(0.3) ? r.int(0, Math.min(units, 6)) : 0,
        useReward: r.chance(0.3),
        useBalance: r.chance(0.3),
      };
      const { next, old } = await quotes(data);
      const where = `case ${n} (seed ${SEED}): ${JSON.stringify(data)}`;
      expect(withoutSplit(next), where).toEqual(old);
      if (!next.ok) {
        const code = String(next.code);
        stats.errors[code] = (stats.errors[code] ?? 0) + 1;
        expect(next.coupon_by_item, where).toBeUndefined();
        continue;
      }
      stats.ok++;
      const split = next.coupon_by_item!;
      const total = Object.values(split).reduce((a, b) => a + b, 0);
      expect(total, where).toBe(next.coupon_discount);
      if (total > 0) stats.withCoupon++;
      const coupon = (await db.query<{ item_ids: string[] }>("select item_ids from public.coupons where code='fuzz'")).rows[0]!;
      for (const [id, amount] of Object.entries(split)) {
        expect(Number.isInteger(amount) && amount > 0, where).toBe(true);
        expect(lines.some((l) => l.menuItemId === id), where).toBe(true);
        if (coupon.item_ids.length) expect(coupon.item_ids, where).toContain(id);
        // Never more than what the customer pays for that item before the coupon.
        const qty = lines.filter((l) => l.menuItemId === id).reduce((s, l) => s + l.quantity, 0);
        const price = items.find((i) => i.id === id)!.price;
        expect(amount, where).toBeLessThanOrEqual(price * qty);
      }
    }
    // The random cases really did exercise both paths.
    expect(stats.ok).toBeGreaterThan(CASES * 0.3);
    expect(stats.withCoupon).toBeGreaterThan(CASES * 0.2);
    report("coupon split fuzz", { cases: CASES, seed: SEED, ...stats });
  }, 900_000);
});

describe("coupon split: real orders charge what the old preview said", () => {
  it("random orders through the API: the saved total and discounts match the original pricing", async () => {
    const r = rng(SEED + 1);
    const ids = items.map((i) => i.id);
    const orders = Math.max(40, Math.round(CASES / 10));
    let placed = 0;
    for (let n = 0; n < orders; n++) {
      await setMenuDiscount(r.chance(0.4) ? r.int(5, 50) : null, "all");
      await setCoupon({ code: "order", kind: r.chance(0.6) ? "percent" : "fixed", value: r.int(1, 60), item_ids: r.chance(0.3) ? r.subset(ids) : [], maximum: r.chance(0.3) ? r.int(100, 3000) : null });
      await db.query("update public.benefit_accounts set balance_halalas=50000, gift_cups=40 where customer_id=$1", [customer]);
      const lines = Array.from({ length: r.int(1, 4) }, () => ({ menuItemId: r.pick(ids), quantity: r.int(1, 3) }));
      const units = lines.reduce((s, l) => s + l.quantity, 0);
      const data = { items: lines, fulfillment: r.pick(["pickup", "curbside", "delivery"] as const), couponCode: "order", giftCups: r.chance(0.3) ? r.int(0, Math.min(units, 3)) : 0, useReward: false, useBalance: r.chance(0.3) };
      const before = (await db.query<{ q: Quote }>("select public.benefit_quote_old($1,$2::jsonb) q", [customer, JSON.stringify(data)])).rows[0]!.q;
      const res = await app.request("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(customer) },
        body: JSON.stringify({
          ...data,
          phone: "0512345678",
          deliveryAddress: data.fulfillment === "delivery" ? "حي الروضة" : undefined,
          carDescription: data.fulfillment === "curbside" ? "كامري بيضاء" : undefined,
          idempotencyKey: randomUUID(),
        }),
      });
      const where = `order ${n}: ${JSON.stringify(data)}`;
      if (!before.ok) {
        expect(res.status, where).toBeGreaterThanOrEqual(400);
        continue;
      }
      expect(res.status, where).toBe(201);
      const { order } = (await res.json()) as { order: Order };
      placed++;
      expect(order.totalHalalas, where).toBe(before.total);
      expect(order.discountHalalas, where).toBe(Number(before.gift_discount) + Number(before.reward_discount) + Number(before.coupon_discount));
      expect(order.walletHalalas ?? 0, where).toBe(before.wallet_used);
      expect(order.deliveryFeeHalalas, where).toBe(before.fee);
    }
    expect(placed).toBeGreaterThan(orders * 0.5);
    report("coupon split orders", { seed: SEED, tried: orders, placed });
  }, 900_000);

  it("pricing is no slower than before", async () => {
    await setCoupon({ code: "speed", kind: "percent", value: 15 });
    const data = JSON.stringify({ items: items.slice(0, 6).map((i) => ({ menuItemId: i.id, quantity: 3 })), fulfillment: "pickup", couponCode: "speed" });
    const time = async (fn: string) => {
      const t = performance.now();
      for (let i = 0; i < 300; i++) await db.query(`select public.${fn}($1,$2::jsonb)`, [customer, data]);
      return performance.now() - t;
    };
    await time("benefit_quote_old");
    const oldMs = await time("benefit_quote_old");
    const newMs = await time("benefit_quote");
    report("coupon split speed", { calls: 300, oldMs: Math.round(oldMs), newMs: Math.round(newMs) });
    expect(newMs).toBeLessThan(oldMs * 1.5 + 50);
  }, 120_000);
});
