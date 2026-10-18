import { randomUUID } from "node:crypto";
import { beforeAll, describe, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createAuthUser } from "../helpers/db";
import { buildTestApp, bearer } from "../helpers/app";
let db: PGlite;
let owner: string;
let other: string;
async function rpc(action: string, who: string, data: Record<string, unknown>) {
  const r = await db.query<{ r: Record<string, unknown> }>(
    "select public.benefits($1,$2::uuid,$3::jsonb) r",
    [action, who, JSON.stringify(data)],
  );
  return r.rows[0]!.r;
}
beforeAll(async () => {
  db = await createTestDb();
  owner = (await createAuthUser(db, { email: "topup@t.test" })).id;
  other = (await createAuthUser(db, { email: "other@t.test" })).id;
});
describe("wallet top-up ledger", () => {
  it("does not credit on intent creation; rejects wrong owner, amount and invoice", async () => {
    const id = randomUUID();
    const invoice = randomUUID();
    expect(
      await rpc("topup_create", owner, { id, amount: 2000 }),
    ).toMatchObject({ amount_halalas: 2000, credited_at: null });
    expect(await rpc("topup_status", other, { id })).toMatchObject({
      ok: false,
    });
    expect(
      await rpc("topup_create", owner, { id, amount: 1000 }),
    ).toMatchObject({ ok: false });
    await rpc("topup_attach", owner, {
      id,
      invoiceId: invoice,
      url: "https://checkout.moyasar.com/invoices/test",
    });
    expect(
      await rpc("topup_credit", owner, {
        id,
        invoiceId: randomUUID(),
        amount: 2000,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await rpc("topup_credit", owner, {
        id,
        invoiceId: invoice,
        amount: 1000,
      }),
    ).toMatchObject({ ok: false });
    await rpc("topup_credit", owner, { id, invoiceId: invoice, amount: 2000 });
    await rpc("topup_credit", owner, { id, invoiceId: invoice, amount: 2000 });
    expect(await rpc("account", owner, {})).toMatchObject({
      balance_halalas: 2000,
    });
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.benefit_movements where idempotency_key=$1",
          [id],
        )
      ).rows[0]!.n,
    ).toBe(1);
  });
  it("payment is disabled without configuration and customers cannot call internal credit operations", async () => {
    const app = buildTestApp(db).app;
    const config = await app.request("/api/topups/config", {
      headers: bearer(owner),
    });
    expect(await config.json()).toEqual({ ready: false });
    const request = await app.request("/api/topups", {
      method: "POST",
      headers: { ...bearer(owner), "content-type": "application/json" },
      body: JSON.stringify({ id: randomUUID(), amountHalalas: 2000 }),
    });
    expect(request.status).toBe(503);
    const attack = await app.request("/api/benefits", {
      method: "POST",
      headers: { ...bearer(owner), "content-type": "application/json" },
      body: JSON.stringify({
        action: "topup_credit",
        data: { amount: 100000 },
      }),
    });
    expect(attack.status).toBe(400);
  });
});
