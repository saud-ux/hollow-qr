import { describe, expect, it } from "vitest";
import {
  Moyasar,
  paidInvoice,
  checkoutUrl,
  type MoyasarInvoice,
} from "../../src/server/payments/moyasar";
const inv: MoyasarInvoice = {
  id: "i",
  status: "paid",
  amount: 2000,
  currency: "SAR",
  url: "https://checkout.moyasar.com/invoices/i",
  payments: [
    { id: "p", status: "paid", amount: 2000, currency: "SAR", refunded: 0 },
  ],
};
describe("Moyasar top-up verification", () => {
  it("requires bound invoice, paid status, exact amount/currency and a captured payment", () => {
    expect(paidInvoice(inv, "i", 2000)).toBe(true);
    for (const v of [
      { ...inv, id: "other" },
      { ...inv, amount: 100 },
      { ...inv, currency: "USD" },
      { ...inv, status: "authorized" },
      { ...inv, payments: [] },
      { ...inv, payments: [{ ...inv.payments![0]!, refunded: 100 }] },
      { ...inv, payments: [{ ...inv.payments![0]!, status: "initiated" }] },
    ])
      expect(paidInvoice(v, "i", 2000)).toBe(false);
  });
  it("accepts checkout only from the HTTPS provider host", () => {
    expect(checkoutUrl(inv.url)).toBe(inv.url);
    for (const url of [
      "https://evil.test",
      "http://checkout.moyasar.com/x",
      "https://checkout.moyasar.com.evil.test/x",
      "javascript:alert(1)",
    ])
      expect(() => checkoutUrl(url)).toThrow();
  });
  it("uses the secret key server-side and binds invoice callbacks to an intent", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const transport: typeof fetch = (input, init) => {
      calls.push({ url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init });
      return Promise.resolve(new Response(JSON.stringify(inv), { status: 201 }));
    };
    const client = new Moyasar("sk_test_fake", transport);
    await client.createTopup(2000, "intent", "https://hollow.test");
    expect(calls[0]!.url).toBe("https://api.moyasar.com/v1/invoices");
    const b = JSON.parse(calls[0]!.init!.body as string) as Record<
      string,
      unknown
    >;
    expect(b).toMatchObject({
      amount: 2000,
      currency: "SAR",
      callback_url: "https://hollow.test/api/topups/notify/intent",
    });
  });
});
