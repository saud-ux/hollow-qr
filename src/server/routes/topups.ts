import { Hono } from "hono";
import { z } from "zod";
import type { AppContext, HonoEnv } from "../http/context";
import { repoOf } from "../http/context";
import { requireUser, rateLimit } from "../http/middleware";
import { parseJsonBody, parseWith } from "../http/validation";
import { ApiError } from "../http/errors";
import { Moyasar, paidInvoice, checkoutUrl } from "../payments/moyasar";
interface Topup {
  id: string;
  customer_id: string;
  amount_halalas: number;
  invoice_id: string | null;
  checkout_url: string | null;
  credited_at: string | null;
  ok?: boolean;
  code?: string;
}
const uuid = z.uuid();
function ready(c: AppContext) {
  return (
    c.env?.MOYASAR_TOPUPS_ENABLED === "true" && !!c.env?.MOYASAR_SECRET_KEY
  );
}
function provider(c: AppContext) {
  if (!ready(c)) throw new ApiError(503, "PAYMENT_NOT_READY");
  return new Moyasar(c.env.MOYASAR_SECRET_KEY!);
}
async function lookup(
  c: AppContext,
  action: string,
  actor: string,
  data: Record<string, unknown>,
) {
  const t = (await repoOf(c).benefits(action, actor, data)) as Topup;
  if (t.ok === false)
    throw new ApiError(
      t.code === "NOT_FOUND" ? 404 : 409,
      t.code ?? "INVALID_REQUEST",
    );
  return t;
}
async function verify(c: AppContext, t: Topup) {
  if (t.credited_at) return t;
  if (!t.invoice_id) return t;
  const invoice = await provider(c).invoice(t.invoice_id);
  if (paidInvoice(invoice, t.invoice_id, t.amount_halalas))
    return lookup(c, "topup_credit", t.customer_id, {
      id: t.id,
      invoiceId: invoice.id,
      amount: invoice.amount,
    });
  return t;
}
export const topupRoutes = new Hono<HonoEnv>()
  .get("/topups/config", requireUser, rateLimit("api", "user"), (c) =>
    c.json({ ready: ready(c) }),
  )
  .post("/topups", requireUser, rateLimit("api", "user"), async (c) => {
    const payment = provider(c);
    const b = await parseJsonBody(
      c,
      z.object({
        id: uuid,
        amountHalalas: z.number().int().min(100).max(1000000),
      }),
    );
    let t = await lookup(c, "topup_create", c.get("user").id, {
      id: b.id,
      amount: b.amountHalalas,
    });
    if (!t.invoice_id) {
      const inv = await payment.createTopup(
        t.amount_halalas,
        t.id,
        c.get("deps").config.appUrl,
      );
      const url = checkoutUrl(inv.url);
      if (inv.amount !== t.amount_halalas || inv.currency !== "SAR")
        throw new ApiError(503, "PAYMENT_NOT_READY");
      t = await lookup(c, "topup_attach", t.customer_id, {
        id: t.id,
        invoiceId: inv.id,
        url,
      });
    }
    return c.json({ id: t.id, url: t.checkout_url });
  })
  .post(
    "/topups/:id/verify",
    requireUser,
    rateLimit("api", "user"),
    async (c) => {
      const id = parseWith(uuid, c.req.param("id"));
      const t = await lookup(c, "topup_status", c.get("user").id, { id });
      const v = await verify(c, t);
      return c.json({ credited: !!v.credited_at });
    },
  )
  .post("/topups/notify/:id", rateLimit("api"), async (c) => {
    provider(c);
    const id = parseWith(uuid, c.req.param("id"));
    // Ignore the callback body. A direct, authenticated fetch verifies the bound invoice.
    const t = await lookup(
      c,
      "topup_lookup",
      "00000000-0000-0000-0000-000000000000",
      { id },
    );
    await verify(c, t);
    return c.json({ ok: true });
  });
