import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { MeResponse, StaffActionResponse, StaffCustomerView } from "../../src/shared/types";
import { APP_URL, bearer, buildTestApp } from "../helpers/app";
import { accountFor, createAuthUser, createTestDb } from "../helpers/db";

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let notifierSent: string[];
let staffId: string;
let adminId: string;
let n = 0;

async function newCustomer(name = "Abdulaziz") {
  n += 1;
  const user = await createAuthUser(db, { email: `api${n}@example.com`, name });
  const account = (await accountFor(db, user.id))!;
  return { user, account };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function act(accountId: string, actorId: string, body: Record<string, unknown>) {
  return post(`/api/staff/customers/${accountId}/actions`, { idempotencyKey: randomUUID(), ...body }, bearer(actorId));
}

beforeAll(async () => {
  db = await createTestDb();
  const built = buildTestApp(db);
  app = built.app;
  notifierSent = (built.notifier as unknown as { sent: string[] }).sent;
  staffId = (await createAuthUser(db, { email: "staff@hollow.test", name: "Barista", role: "staff" })).id;
  adminId = (await createAuthUser(db, { email: "admin@hollow.test", name: "Owner", role: "admin" })).id;
});

describe("public endpoints", () => {
  it("serves health and public config without secrets", async () => {
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    const res = await app.request("/api/public-config");
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toMatch(/service-role-key|pass-auth-secret|qr-token-secret/);
    expect(JSON.parse(text)).toMatchObject({ walletMode: "mock", walletReady: false });
  });

  it("returns structured 404s and security headers", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("customer flow", () => {
  it("provisions the card and exposes an opaque QR payload", async () => {
    const { user, account } = await newCustomer();
    const res = await app.request("/api/me", { headers: bearer(user.id) });
    expect(res.status).toBe(200);
    const me = (await res.json()) as MeResponse;
    expect(me.user.role).toBe("customer");
    expect(me.card).toMatchObject({ memberId: account.member_id, stampCount: 0, rewardAvailable: false });
    expect(me.card!.qrPayload.startsWith(`${APP_URL}/c/`)).toBe(true);
    expect(me.card!.qrPayload).not.toContain(user.id);
    expect(me.card!.qrPayload).not.toContain(account.id);
    expect(me.card!.qrPayload).not.toContain(user.email);
  });

  it("rejects requests without a valid session", async () => {
    expect((await app.request("/api/me")).status).toBe(401);
    expect((await app.request("/api/me", { headers: { authorization: "Bearer garbage-token-value-xxxxxx" } })).status).toBe(401);
  });

  it("customers cannot use staff or admin endpoints to mutate loyalty", async () => {
    const { user, account } = await newCustomer();
    const res = await act(account.id, user.id, { action: "ADD_CUPS", quantity: 5 });
    expect(res.status).toBe(403);
    expect((await app.request("/api/admin/stats", { headers: bearer(user.id) })).status).toBe(403);
    expect((await post("/api/staff/resolve", { code: account.member_id }, bearer(user.id))).status).toBe(403);
    expect((await accountFor(db, user.id))!.stamp_count).toBe(0);
  });

  it("mock mode never pretends to serve an Apple Wallet pass", async () => {
    const { user } = await newCustomer();
    const res = await post("/api/wallet/pass-link", {}, bearer(user.id));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "WALLET_MOCK_MODE" } });
  });
});

describe("staff authorization and loyalty actions", () => {
  it("resolves a scanned QR and a typed member ID", async () => {
    const { user, account } = await newCustomer();
    const me = (await (await app.request("/api/me", { headers: bearer(user.id) })).json()) as MeResponse;
    const byQr = await post("/api/staff/resolve", { code: me.card!.qrPayload }, bearer(staffId));
    expect(byQr.status).toBe(200);
    const view = ((await byQr.json()) as { customer: StaffCustomerView }).customer;
    expect(view.memberId).toBe(account.member_id);
    expect(view.email).toMatch(/^ap\*\*\*@example\.com$/); // staff sees masked email
    expect(view.emailMasked).toBe(true);
    expect(view.walletDevices).toBeNull();

    const byId = await post("/api/staff/resolve", { code: account.member_id.toLowerCase() }, bearer(staffId));
    expect(byId.status).toBe(200);

    const admin = await post("/api/staff/resolve", { code: account.member_id }, bearer(adminId));
    const adminView = ((await admin.json()) as { customer: StaffCustomerView }).customer;
    expect(adminView.email).toBe(user.email); // admin sees full email
  });

  it("malformed or forged QR codes cannot retrieve a customer", async () => {
    const { user } = await newCustomer();
    const me = (await (await app.request("/api/me", { headers: bearer(user.id) })).json()) as MeResponse;
    const token = me.card!.qrPayload.split("/c/")[1]!;
    const forged = `${token.split(".")[0]}.${"A".repeat(22)}`;
    for (const code of [`${APP_URL}/c/${forged}`, "hello", `${APP_URL}/c/../../etc`, "HLW-ZZZZZZ", "' OR 1=1 --"]) {
      const res = await post("/api/staff/resolve", { code }, bearer(staffId));
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "INVALID_CODE" } });
    }
  });

  it("runs the full cycle: add 3, add 2 (confirm), reward blocks, redeem, undo", async () => {
    const { account } = await newCustomer();
    let res = await act(account.id, staffId, { action: "ADD_CUPS", quantity: 3 });
    expect(res.status).toBe(200);
    let body = (await res.json()) as StaffActionResponse;
    expect(body).toMatchObject({ previousStampCount: 0, newStampCount: 3, rewardAvailable: false });
    expect(body.customer.undoCandidate).toMatchObject({ action: "ADD_CUPS", quantity: 3 });

    // Second operation inside 60 s -> warning, nothing applied.
    res = await act(account.id, staffId, { action: "ADD_CUPS", quantity: 2 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "RECENT_ACTIVITY", details: { lastAction: "ADD_CUPS" } } });

    res = await act(account.id, staffId, { action: "ADD_CUPS", quantity: 2, confirmRecent: true });
    body = (await res.json()) as StaffActionResponse;
    expect(body).toMatchObject({ newStampCount: 5, rewardAvailable: true });

    res = await act(account.id, staffId, { action: "ADD_CUPS", quantity: 1, confirmRecent: true });
    expect(await res.json()).toMatchObject({ error: { code: "REWARD_PENDING" } });

    res = await act(account.id, staffId, { action: "REDEEM_REWARD", confirmRecent: true });
    body = (await res.json()) as StaffActionResponse;
    expect(body).toMatchObject({ newStampCount: 0, rewardAvailable: false });

    res = await act(account.id, staffId, { action: "UNDO" });
    body = (await res.json()) as StaffActionResponse;
    expect(body).toMatchObject({ newStampCount: 5, rewardAvailable: true });
  });

  it("reports remaining capacity instead of over-filling", async () => {
    const { account } = await newCustomer();
    await act(account.id, staffId, { action: "ADD_CUPS", quantity: 4 });
    const res = await act(account.id, staffId, { action: "ADD_CUPS", quantity: 3, confirmRecent: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "EXCEEDS_CAPACITY", details: { remaining: 1 } } });
  });

  it("is idempotent for retried submissions", async () => {
    const { user, account } = await newCustomer();
    const key = randomUUID();
    const a = await post(`/api/staff/customers/${account.id}/actions`, { action: "ADD_CUPS", quantity: 2, idempotencyKey: key }, bearer(staffId));
    const b = await post(`/api/staff/customers/${account.id}/actions`, { action: "ADD_CUPS", quantity: 2, idempotencyKey: key }, bearer(staffId));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(((await b.json()) as StaffActionResponse).replayed).toBe(true);
    expect((await accountFor(db, user.id))!.stamp_count).toBe(2);
  });

  it("validates input strictly", async () => {
    const { account } = await newCustomer();
    for (const body of [
      { action: "ADD_CUPS", quantity: 6, idempotencyKey: randomUUID() },
      { action: "ADD_CUPS", quantity: 1 },
      { action: "SET_ROLE", idempotencyKey: randomUUID() },
      { action: "ADD_CUPS", quantity: "5", idempotencyKey: randomUUID() },
    ]) {
      const res = await post(`/api/staff/customers/${account.id}/actions`, body, bearer(staffId));
      expect(res.status).toBe(400);
    }
    const big = await post("/api/staff/resolve", { code: "x".repeat(20_000) }, bearer(staffId));
    expect(big.status).toBe(413);
  });

  it("blocks cross-origin writes", async () => {
    const { account } = await newCustomer();
    const res = await post(
      `/api/staff/customers/${account.id}/actions`,
      { action: "ADD_CUPS", quantity: 1, idempotencyKey: randomUUID() },
      { ...bearer(staffId), origin: "https://evil.example" },
    );
    expect(res.status).toBe(403);
  });

  it("restricts admin-only actions and endpoints to admins", async () => {
    const { user, account } = await newCustomer();
    expect((await act(account.id, staffId, { action: "CANCEL_MEMBERSHIP" })).status).toBe(403);
    expect((await act(account.id, staffId, { action: "ADMIN_ADJUSTMENT", targetStampCount: 5 })).status).toBe(403);
    for (const path of ["/api/admin/stats", "/api/admin/staff", "/api/admin/export/customers.csv"]) {
      expect((await app.request(path, { headers: bearer(staffId) })).status).toBe(403);
      expect((await app.request(path, { headers: bearer(adminId) })).status).toBe(200);
    }

    const cancel = await act(account.id, adminId, { action: "CANCEL_MEMBERSHIP" });
    expect(cancel.status).toBe(200);
    // Cancelled membership: scans show inactive, operations are rejected.
    const scan = await post("/api/staff/resolve", { code: account.member_id }, bearer(staffId));
    expect(((await scan.json()) as { customer: StaffCustomerView }).customer.membershipStatus).toBe("cancelled");
    const add = await act(account.id, staffId, { action: "ADD_CUPS", quantity: 1 });
    expect(await add.json()).toMatchObject({ error: { code: "MEMBERSHIP_CANCELLED" } });
    expect((await accountFor(db, user.id))!.membership_status).toBe("cancelled");
  });

  it("triggers a Wallet refresh after each mutation (mock mode logs it)", async () => {
    const { account } = await newCustomer();
    await db.query(
      "insert into public.wallet_devices (device_library_identifier, push_token) values ('dev-mock', 'aabbccddeeff00112233445566778899')",
    );
    await db.query(
      "insert into public.wallet_registrations (device_library_identifier, pass_type_identifier, pass_serial) values ('dev-mock', 'pass.test', $1)",
      [account.pass_serial],
    );
    const before = notifierSent.length;
    await act(account.id, staffId, { action: "ADD_CUPS", quantity: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(notifierSent.length).toBe(before + 1);
  });
});

describe("admin features", () => {
  it("creates staff accounts server-side and lists them", async () => {
    const res = await post("/api/admin/staff", { displayName: "New Barista", email: "New.Barista@Hollow.test", password: "Strong123pass" }, bearer(adminId));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const role = await db.query<{ role: string; email: string }>("select role, email from public.profiles where id = $1", [id]);
    expect(role.rows[0]).toEqual({ role: "staff", email: "new.barista@hollow.test" });
    const dup = await post("/api/admin/staff", { displayName: "Dup", email: "new.barista@hollow.test", password: "Strong123pass" }, bearer(adminId));
    expect(dup.status).toBe(409);
    const weak = await post("/api/admin/staff", { displayName: "Weak", email: "weak@hollow.test", password: "short" }, bearer(adminId));
    expect(weak.status).toBe(400);
    const staffCreate = await post("/api/admin/staff", { displayName: "X", email: "x@hollow.test", password: "Strong123pass" }, bearer(staffId));
    expect(staffCreate.status).toBe(403);
  });

  it("exports Excel-friendly CSV without tokens", async () => {
    await newCustomer("=cmd|' /C calc'!A0");
    const res = await app.request("/api/admin/export/customers.csv", { headers: bearer(adminId) });
    expect(res.headers.get("content-type")).toContain("text/csv");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("'=cmd");
    expect(text).not.toMatch(/qr_token|pass_serial|authentication/i);
    const tx = await app.request("/api/admin/export/transactions.csv", { headers: bearer(adminId) });
    expect((await tx.text()).split("\r\n")[0]).toContain("transaction_id");
  });

  it("returns dashboard stats", async () => {
    const res = await app.request("/api/admin/stats", { headers: bearer(adminId) });
    const stats = (await res.json()) as Record<string, number>;
    expect(stats.totalCustomers).toBeGreaterThan(0);
    expect(stats).toHaveProperty("rewardsRedeemedToday");
  });

  it("searches with pagination and masks emails for staff", async () => {
    await newCustomer("Searchable Person");
    const staff = await app.request("/api/staff/customers?q=searchable&page=1&pageSize=5", { headers: bearer(staffId) });
    const body = (await staff.json()) as { items: { email: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]!.email).toContain("***");
  });
});
