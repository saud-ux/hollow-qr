import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order, OrderLine } from "../../src/shared/ordering";
import {
  buildReceipt,
  LoyverseClient,
  loyverseSettings,
  nameKey,
  pushOrderToLoyverse,
  resetLoyverseCache,
  type Catalog,
  type LoyverseItem,
} from "../../src/server/pos/loyverse";

const items: LoyverseItem[] = [
  { id: "i1", item_name: "لاتيه", variants: [{ variant_id: "v-latte" }] },
  {
    id: "i2",
    item_name: "قهوة مقطرة",
    variants: [
      { variant_id: "v-drip-eth", option1_value: "إثيوبي" },
      { variant_id: "v-drip-col", option1_value: "كولومبي" },
    ],
  },
  { id: "i3", item_name: "كوكيز", variants: [{ variant_id: "v-cookie" }] },
  { id: "i9", item_name: "طلب تطبيق", variants: [{ variant_id: "v-other" }] },
];

function catalog(fallback = true): Catalog {
  return {
    storeId: "store",
    paymentTypeId: "pt-app",
    walletPaymentTypeId: "pt-app",
    fallbackVariantId: fallback ? "v-other" : null,
    byName: new Map(items.map((i) => [nameKey(i.item_name), i])),
  };
}

function line(nameAr: string, unit: number, quantity = 1, option: string | null = null): OrderLine {
  return {
    menuItemId: nameAr,
    nameAr,
    category: "drink",
    unitPriceHalalas: unit,
    listPriceHalalas: null,
    quantity,
    note: null,
    optionId: option,
    optionNameAr: option,
  };
}

function order(lines: OrderLine[], extra: Partial<Order> = {}): Order {
  const subtotal = lines.reduce((s, l) => s + l.unitPriceHalalas * l.quantity, 0);
  const fee = extra.deliveryFeeHalalas ?? 0;
  const discount = extra.discountHalalas ?? 0;
  return {
    id: "o1",
    orderNumber: 12,
    customerName: "سعود",
    customerPhone: "0500000000",
    memberId: null,
    fulfillment: "pickup",
    carDescription: null,
    deliveryAddress: null,
    deliveryLat: null,
    deliveryLng: null,
    note: null,
    subtotalHalalas: subtotal,
    deliveryFeeHalalas: fee,
    discountHalalas: discount,
    totalHalalas: subtotal + fee - discount,
    paymentMethod: "on_pickup",
    useReward: false,
    status: "completed",
    cancelReason: null,
    cancelledBy: null,
    customerArrivedAt: null,
    acceptedAt: null,
    readyAt: null,
    outForDeliveryAt: null,
    completedAt: "2026-11-28T16:00:00.000Z",
    cancelledAt: null,
    loyaltyResult: null,
    createdAt: "2026-11-28T15:50:00.000Z",
    items: lines,
    rating: null,
    ratingComment: null,
    ratedAt: null,
    promoPercent: null,
    promoSavingsHalalas: 0,
    ...extra,
  };
}

const lineTotal = (b: { line_items: { price: number; quantity: number }[] }) =>
  Math.round(b.line_items.reduce((s, l) => s + l.price * l.quantity * 100, 0));
const paid = (b: { payments: { money_amount: number }[] }) => Math.round(b.payments.reduce((s, p) => s + p.money_amount * 100, 0));

describe("Loyverse receipt", () => {
  it("matches names loosely (hamza, taa marbuta, spaces, diacritics)", () => {
    expect(nameKey("  قَهوة   مقطّرة ")).toBe(nameKey("قهوه مقطره"));
    expect(nameKey("إسبريسو")).toBe(nameKey("اسبريسو"));
  });

  it("maps items and options to variants, with exact totals and the app payment type", () => {
    const r = buildReceipt(order([line("لاتيه", 1400, 2), line("قهوه مقطره", 1800, 1, "كولومبي")]), catalog());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.store_id).toBe("store");
    expect(r.body.line_items).toEqual([
      { variant_id: "v-latte", quantity: 2, price: 14 },
      { variant_id: "v-drip-col", quantity: 1, price: 18, line_note: "كولومبي" },
    ]);
    expect(r.body.payments).toEqual([{ payment_type_id: "pt-app", money_amount: 46 }]);
    expect(r.body.receipt_date).toBe("2026-11-28T16:00:00.000Z");
  });

  it("takes the free drink / coupon off the dearest units so totals still match", () => {
    const o = order([line("لاتيه", 1400, 2), line("كوكيز", 900)], { discountHalalas: 1500 });
    const r = buildReceipt(o, catalog());
    if (!r.ok) throw new Error("unmatched");
    expect(lineTotal(r.body)).toBe(o.totalHalalas);
    expect(paid(r.body)).toBe(o.totalHalalas);
    expect(r.body.line_items).toContainEqual({ variant_id: "v-latte", quantity: 1, price: 0 });
  });

  it("puts unknown items and the delivery fee on the fallback item with a note", () => {
    const o = order([line("ماتشا", 2000)], { deliveryFeeHalalas: 1000, fulfillment: "delivery" });
    const r = buildReceipt(o, catalog());
    if (!r.ok) throw new Error("unmatched");
    expect(r.body.line_items).toEqual([
      { variant_id: "v-other", quantity: 1, price: 20, line_note: "ماتشا" },
      { variant_id: "v-other", quantity: 1, price: 10, line_note: "رسوم التوصيل" },
    ]);
    expect(paid(r.body)).toBe(3000);
  });

  it("refuses rather than send a wrong total when an item can't be placed", () => {
    expect(buildReceipt(order([line("ماتشا", 2000)]), catalog(false))).toEqual({ ok: false, unmatched: ["ماتشا"] });
  });

  it("splits the in-app balance onto its own payment type when one is set", () => {
    const c = { ...catalog(), walletPaymentTypeId: "pt-wallet" };
    const r = buildReceipt(order([line("لاتيه", 1400)], { walletHalalas: 500 }), c);
    if (!r.ok) throw new Error("unmatched");
    expect(r.body.payments).toEqual([
      { payment_type_id: "pt-wallet", money_amount: 5 },
      { payment_type_id: "pt-app", money_amount: 9 },
    ]);
  });
});

describe("Loyverse sending", () => {
  beforeEach(() => resetLoyverseCache());
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

  function transport(receiptStatus = 200) {
    const calls: { url: string; body: unknown }[] = [];
    const fn = vi.fn((url: string, init?: RequestInit) => {
      const u = url;
      calls.push({ url: u, body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined });
      const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }));
      if (u.endsWith("/stores")) return json({ stores: [{ id: "store", name: "HOLLOW" }] });
      if (u.endsWith("/payment_types")) return json({ payment_types: [{ id: "pt-cash", name: "نقدي" }, { id: "pt-app", name: "تطبيق" }] });
      if (u.includes("/items")) return json({ items, cursor: null });
      if (u.endsWith("/receipts")) return json({ receipt_number: "1-1001" }, receiptStatus);
      return json({}, 404);
    });
    return { fn: fn as unknown as typeof fetch, calls };
  }

  it("is off without a token", () => {
    expect(loyverseSettings({})).toBeNull();
    expect(loyverseSettings({ LOYVERSE_ACCESS_TOKEN: "t" })?.paymentTypeName).toBe("تطبيق");
  });

  it("finds the store and payment type by name and posts one receipt", async () => {
    const t = transport();
    const settings = loyverseSettings({ LOYVERSE_ACCESS_TOKEN: "t" })!;
    const r = await pushOrderToLoyverse({ logger, settings, client: new LoyverseClient("t", t.fn) }, order([line("لاتيه", 1400)]));
    expect(r).toEqual({ ok: true, receiptNumber: "1-1001" });
    const posts = t.calls.filter((c) => c.url.endsWith("/receipts"));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({ store_id: "store", payments: [{ payment_type_id: "pt-app", money_amount: 14 }] });
  });

  it("does not send orders that aren't completed, and does not retry a rejected receipt", async () => {
    const t = transport(400);
    const settings = loyverseSettings({ LOYVERSE_ACCESS_TOKEN: "t" })!;
    const client = new LoyverseClient("t", t.fn);
    expect((await pushOrderToLoyverse({ logger, settings, client }, order([line("لاتيه", 1400)], { status: "ready" }))).ok).toBe(false);
    const r = await pushOrderToLoyverse({ logger, settings, client, retryDelayMs: 0 }, order([line("لاتيه", 1400)]));
    expect(r.ok).toBe(false);
    expect(t.calls.filter((c) => c.url.endsWith("/receipts"))).toHaveLength(1);
  });
});
