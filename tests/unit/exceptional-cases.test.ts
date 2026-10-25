/**
 * Exceptional inputs for the pure ordering helpers: absurd quantities, money at
 * its limits, odd phone formats and a flooded rate limiter.
 *
 * `it.fails` marks a known bug: the test states the right behavior and fails
 * today. Once the bug is fixed it starts passing, so vitest reports it and the
 * `.fails` can be dropped.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WorkersRateLimiter } from "../../src/server/http/rate-limit";
import { placeOrderSchema } from "../../src/server/routes/orders";
import {
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  amountDue,
  discountedPrice,
  formatSar,
  isValidHhMm,
  nextStatus,
  normalizeSaudiPhone,
  orderFlow,
  rewardDiscount,
  type FulfillmentType,
  type OrderStatus,
} from "../../src/shared/ordering";

const ICED_COFFEE = randomUUID();

function order(items: unknown, overrides: Record<string, unknown> = {}) {
  return { items, fulfillment: "pickup", phone: "0512345678", idempotencyKey: randomUUID(), ...overrides };
}
const line = (quantity: unknown, menuItemId = ICED_COFFEE) => ({ menuItemId, quantity });

describe("one line with an absurd quantity (a million iced coffees)", () => {
  it("rejects a million, and every quantity that is not a whole number from 1 to 20", () => {
    for (const quantity of [1_000_000, 21, 0, -1, -1_000_000, 1.5, 19.999, Number.MAX_SAFE_INTEGER, 1e21, "20", null, true, [], {}]) {
      const parsed = placeOrderSchema.safeParse(order([line(quantity)]));
      expect(parsed.success, `quantity ${JSON.stringify(quantity)}`).toBe(false);
    }
  });

  it("rejects Infinity and NaN (JSON turns them into null)", () => {
    for (const quantity of [Infinity, -Infinity, NaN]) {
      const body = JSON.parse(JSON.stringify(order([line(quantity)]))) as unknown;
      expect(placeOrderSchema.safeParse(body).success).toBe(false);
    }
  });

  it("accepts the edges, 1 and 20", () => {
    expect(placeOrderSchema.safeParse(order([line(1)])).success).toBe(true);
    expect(placeOrderSchema.safeParse(order([line(MAX_LINE_QUANTITY)])).success).toBe(true);
  });

  it("caps the lines at 30, but lets 30 x 20 = 600 cups through (the 40-cup cap only lives in SQL)", () => {
    const full = Array.from({ length: MAX_ORDER_LINES }, () => line(MAX_LINE_QUANTITY));
    expect(placeOrderSchema.safeParse(order(full)).success).toBe(true);
    expect(placeOrderSchema.safeParse(order([...full, line(1)])).success).toBe(false);
    expect(placeOrderSchema.safeParse(order([])).success).toBe(false);
  });

  it("rejects a non-array, a huge note and a bad idempotency key", () => {
    expect(placeOrderSchema.safeParse(order({ 0: line(1) })).success).toBe(false);
    expect(placeOrderSchema.safeParse(order([{ ...line(1), note: "ق".repeat(121) }])).success).toBe(false);
    expect(placeOrderSchema.safeParse(order([line(1)], { idempotencyKey: "retry-1" })).success).toBe(false);
    expect(placeOrderSchema.safeParse(order([line(1)], { phone: "0".repeat(31) })).success).toBe(false);
  });

  it("checks the delivery pin range and that lat and lng come together", () => {
    const delivery = { fulfillment: "delivery", deliveryAddress: "الزلفي" };
    expect(placeOrderSchema.safeParse(order([line(1)], { ...delivery, deliveryLat: 90, deliveryLng: 180 })).success).toBe(true);
    expect(placeOrderSchema.safeParse(order([line(1)], { ...delivery, deliveryLat: 90.0001, deliveryLng: 0 })).success).toBe(false);
    expect(placeOrderSchema.safeParse(order([line(1)], { ...delivery, deliveryLat: 26.3 })).success).toBe(false);
  });
});

describe("money at its limits", () => {
  it("formats halalas, including the smallest and very large amounts", () => {
    expect(formatSar(0)).toBe("0");
    expect(formatSar(1)).toBe("0.01");
    expect(formatSar(5)).toBe("0.05");
    expect(formatSar(150)).toBe("1.50");
    // 40 cups at the highest menu price (1000 SAR).
    expect(formatSar(40 * 100_000)).toBe("40000");
    // A million iced coffees at 8 SAR, if one ever got through.
    expect(formatSar(1_000_000 * 800)).toBe("8000000");
    expect(formatSar(-150)).toBe("-1.50");
  });

  it("never prices a discounted item below zero or above its menu price", () => {
    for (const price of [0, 1, 2, 3, 99, 100, 799, 800, 100_000]) {
      for (let percent = 1; percent <= 90; percent++) {
        const sale = discountedPrice(price, percent);
        expect(Number.isInteger(sale)).toBe(true);
        expect(sale).toBeGreaterThanOrEqual(0);
        expect(sale).toBeLessThanOrEqual(price);
      }
    }
    // Half a halala rounds up, like SQL round().
    expect(discountedPrice(1, 50)).toBe(1);
    expect(discountedPrice(1, 90)).toBe(0);
    expect(discountedPrice(100_000, 90)).toBe(10_000);
  });

  it("never asks for a negative amount at pickup", () => {
    expect(amountDue({ totalHalalas: 800, walletHalalas: 1_000_000 })).toBe(0);
    expect(amountDue({ totalHalalas: 0, walletHalalas: 0 })).toBe(0);
    expect(amountDue({ totalHalalas: 4_000_000 })).toBe(4_000_000);
    expect(rewardDiscount({ discountHalalas: 100, giftHalalas: 5_000, couponHalalas: 5_000 })).toBe(0);
  });
});

describe("Saudi phone numbers typed or pasted every way", () => {
  it("accepts the usual spellings", () => {
    for (const input of [
      "0512345678",
      "512345678",
      "+966512345678",
      "00966512345678",
      "966512345678",
      "+966 51 234 5678",
      "051-234-5678",
      "(051) 234 5678",
      "٠٥١٢٣٤٥٦٧٨",
      "۰۵۱۲۳۴۵۶۷۸",
      "‏0512345678‎",
      " 0512345678 ",
    ]) {
      expect(normalizeSaudiPhone(input), JSON.stringify(input)).toBe("0512345678");
    }
  });

  it("rejects numbers that are not Saudi mobiles", () => {
    for (const input of ["", "05", "0412345678", "05123456789", "051234567", "+971512345678", "0512345678x", "٠٥١٢٣٤٥٦٧", "9".repeat(1_000)]) {
      expect(normalizeSaudiPhone(input), JSON.stringify(input)).toBeNull();
    }
  });

  // BUG (see the report): iOS wraps a number copied from Contacts in
  // directional formatting marks (U+202A..U+202E, U+2066..U+2069). Only
  // U+200E/U+200F are stripped, so a pasted number is rejected at checkout.
  it.fails("accepts a number pasted from iPhone Contacts (wrapped in directional marks)", () => {
    expect(normalizeSaudiPhone("‭+966 51 234 5678‬")).toBe("0512345678");
    expect(normalizeSaudiPhone("⁨051 234 5678⁩")).toBe("0512345678");
  });
});

describe("order statuses", () => {
  it("every flow reaches completed in at most four steps and then stops", () => {
    for (const fulfillment of ["pickup", "curbside", "delivery"] as FulfillmentType[]) {
      let status: OrderStatus | null = "new";
      const seen: OrderStatus[] = [];
      while (status) {
        seen.push(status);
        expect(seen.length).toBeLessThanOrEqual(5);
        status = nextStatus({ status, fulfillment });
      }
      expect(seen.at(-1)).toBe("completed");
      expect(orderFlow(fulfillment).at(-1)).toBe("completed");
    }
    expect(nextStatus({ status: "cancelled", fulfillment: "pickup" })).toBeNull();
  });

  it("validates opening times at the edges of the day", () => {
    for (const ok of ["00:00", "23:59", "12:30"]) expect(isValidHhMm(ok)).toBe(true);
    for (const bad of ["24:00", "7:00", "12:60", "12:5", "", "12:00 ", "١٢:٠٠"]) expect(isValidHhMm(bad)).toBe(false);
  });
});

describe("rate limiter under a flood", () => {
  it("blocks the 121st call in a minute and lets the next minute through", async () => {
    let now = 0;
    const limiter = new WorkersRateLimiter({}, () => now);
    const key = `user-${randomUUID()}`;
    for (let i = 0; i < 120; i++) expect(await limiter.allow("api", key)).toBe(true);
    expect(await limiter.allow("api", key)).toBe(false);
    now += 60_000;
    expect(await limiter.allow("api", key)).toBe(true);
  });

  it("fails open when the Cloudflare binding throws", async () => {
    const limiter = new WorkersRateLimiter({ api: { limit: () => Promise.reject(new Error("down")) } });
    expect(await limiter.allow("api", "anyone")).toBe(true);
  });

  // BUG (see the report): past 10,000 keys the fallback clears its whole map,
  // so 10,000 requests from new keys (IPs) unblock everyone already limited.
  it.fails("keeps a blocked caller blocked while 10,000 other callers arrive", async () => {
    const now = 0;
    const limiter = new WorkersRateLimiter({}, () => now);
    const spammer = `spammer-${randomUUID()}`;
    for (let i = 0; i < 121; i++) await limiter.allow("api", spammer);
    expect(await limiter.allow("api", spammer)).toBe(false);
    for (let i = 0; i < 10_001; i++) await limiter.allow("api", `ip-${i}-${randomUUID()}`);
    expect(await limiter.allow("api", spammer)).toBe(false);
  });
});
