/** Hosted checkout keeps card data off HOLLOW. Always verify with the secret key. */
export interface MoyasarInvoice {
  id: string;
  status: string;
  amount: number;
  currency: string;
  url: string;
  payments?: {
    id: string;
    status: string;
    amount: number;
    currency: string;
    refunded: number;
  }[];
}
export class Moyasar {
  constructor(
    private readonly key: string,
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async request(
    path: string,
    body?: Record<string, unknown>,
    key?: string,
  ): Promise<MoyasarInvoice> {
    const response = await this.transport(
      `https://api.moyasar.com/v1/${path}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Basic ${btoa(`${this.key}:`)}`,
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error("MOYASAR_UNAVAILABLE");
    return (await response.json()) as MoyasarInvoice;
  }
  createTopup(amount: number, id: string, origin: string) {
    return this.request(
      "invoices",
      {
        amount,
        currency: "SAR",
        description: "HOLLOW balance top-up",
        success_url: `${origin}/account?topup=${id}`,
        back_url: `${origin}/account`,
        callback_url: `${origin}/api/topups/notify/${id}`,
        expired_at: new Date(Date.now() + 30 * 60000).toISOString(),
        metadata: { hollow_topup: id },
      },
      id,
    );
  }
  invoice(id: string) {
    return this.request(`invoices/${encodeURIComponent(id)}`);
  }
}
export function paidInvoice(
  invoice: MoyasarInvoice,
  expectedId: string,
  amount: number,
): boolean {
  return (
    invoice.id === expectedId &&
    invoice.status === "paid" &&
    invoice.currency === "SAR" &&
    invoice.amount === amount &&
    !!invoice.payments?.some(
      (p) =>
        ["paid", "captured"].includes(p.status) &&
        p.currency === "SAR" &&
        p.amount === amount &&
        p.refunded === 0,
    )
  );
}
export function checkoutUrl(url: string): string {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== "checkout.moyasar.com")
    throw new Error("MOYASAR_UNAVAILABLE");
  return u.href;
}
