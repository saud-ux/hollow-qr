import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accountFor, applyAction, createAuthUser, createTestDb } from "../helpers/db";

let db: PGlite;
let staffId: string;
let adminId: string;
let counter = 0;

async function newCustomer(name = "Abdulaziz") {
  counter += 1;
  const user = await createAuthUser(db, { email: `Customer${counter}@Example.com`, name });
  const account = await accountFor(db, user.id);
  if (!account) throw new Error("account not provisioned");
  return { user, account };
}

beforeAll(async () => {
  db = await createTestDb();
  staffId = (await createAuthUser(db, { email: "staff@hollow.test", name: "Barista", role: "staff" })).id;
  adminId = (await createAuthUser(db, { email: "admin@hollow.test", name: "Owner", role: "admin" })).id;
});

describe("account provisioning", () => {
  it("creates a profile and exactly one loyalty account for a new customer", async () => {
    const { user, account } = await newCustomer("  Abdulaziz  ");
    const profile = await db.query<{ display_name: string; email: string; role: string }>(
      "select display_name, email, role from public.profiles where id = $1",
      [user.id],
    );
    expect(profile.rows[0]).toEqual({
      display_name: "Abdulaziz",
      email: user.email.toLowerCase(),
      role: "customer",
    });
    expect(account.member_id).toMatch(/^HLW-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    expect(account.qr_token_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(account.stamp_count).toBe(0);
    expect(account.reward_available).toBe(false);
    expect(account.membership_status).toBe("active");
  });

  it("never creates a second loyalty account for the same customer", async () => {
    const { user, account } = await newCustomer();
    const again = await db.query<{ id: string }>("select (public.ensure_loyalty_account($1)).id", [user.id]);
    expect(again.rows[0]!.id).toBe(account.id);
    const count = await db.query<{ n: number }>(
      "select count(*)::int as n from public.loyalty_accounts where user_id = $1",
      [user.id],
    );
    expect(count.rows[0]!.n).toBe(1);
    await expect(
      db.query(
        "insert into public.loyalty_accounts (user_id, member_id, qr_token_id) values ($1, 'HLW-ABCDEF', 'AAAAAAAAAAAAAAAAAAAAAA')",
        [user.id],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("does not create a duplicate auth identity for the same email", async () => {
    // Supabase enforces unique emails in auth; the loyalty mapping is 1:1 by user_id.
    const { user } = await newCustomer();
    const memberships = await db.query<{ n: number }>(
      "select count(*)::int as n from public.loyalty_accounts a join public.profiles p on p.id = a.user_id where p.email = $1",
      [user.email.toLowerCase()],
    );
    expect(memberships.rows[0]!.n).toBe(1);
  });

  it("only grants privileged roles via app_metadata and gives staff no loyalty account", async () => {
    const staff = await accountFor(db, staffId);
    expect(staff).toBeUndefined();
    const sneaky = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ('sneaky@x.test', '{"display_name":"x","hollow_role":"admin","role":"admin"}') returning id`,
    );
    const role = await db.query<{ role: string }>("select role from public.profiles where id = $1", [
      sneaky.rows[0]!.id,
    ]);
    expect(role.rows[0]!.role).toBe("customer");
  });

  it("syncs email confirmation from auth.users", async () => {
    const u = await createAuthUser(db, { email: "late@x.test", confirmed: false });
    let p = await db.query<{ email_confirmed_at: string | null }>(
      "select email_confirmed_at from public.profiles where id = $1",
      [u.id],
    );
    expect(p.rows[0]!.email_confirmed_at).toBeNull();
    await db.query("update auth.users set email_confirmed_at = now() where id = $1", [u.id]);
    p = await db.query("select email_confirmed_at from public.profiles where id = $1", [u.id]);
    expect(p.rows[0]!.email_confirmed_at).not.toBeNull();
  });
});

describe("loyalty rules", () => {
  let accountId: string;
  let userId: string;

  beforeEach(async () => {
    const c = await newCustomer();
    accountId = c.account.id;
    userId = c.user.id;
  });

  it("adds one cup", async () => {
    const r = await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 1 });
    expect(r.ok).toBe(true);
    expect(r.previous_stamp_count).toBe(0);
    expect(r.new_stamp_count).toBe(1);
    expect((await accountFor(db, userId))!.stamp_count).toBe(1);
  });

  it("adds multiple cups in a single operation (quantity 5 from zero creates the reward)", async () => {
    const r = await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 5 });
    expect(r.ok).toBe(true);
    expect(r.new_stamp_count).toBe(5);
    expect(r.new_reward_available).toBe(true);
    const tx = await db.query<{ n: number }>(
      "select count(*)::int as n from public.loyalty_transactions where loyalty_account_id = $1",
      [accountId],
    );
    expect(tx.rows[0]!.n).toBe(1);
  });

  it("never exceeds 5 and reports the remaining capacity instead of clamping", async () => {
    await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 3 });
    const r = await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 3 });
    expect(r).toMatchObject({ ok: false, code: "EXCEEDS_CAPACITY", remaining: 2 });
    expect((await accountFor(db, userId))!.stamp_count).toBe(3);
  });

  it("rejects invalid quantities", async () => {
    for (const quantity of [0, 6, -1]) {
      const r = await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity });
      expect(r).toMatchObject({ ok: false, code: "INVALID_QUANTITY" });
    }
  });

  it("creates the reward exactly when reaching 5 and blocks further stamps", async () => {
    await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 4 });
    let acct = await accountFor(db, userId);
    expect(acct!.reward_available).toBe(false);
    await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 1 });
    acct = await accountFor(db, userId);
    expect(acct!.stamp_count).toBe(5);
    expect(acct!.reward_available).toBe(true);

    const blocked = await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 1 });
    expect(blocked).toMatchObject({ ok: false, code: "REWARD_PENDING" });
  });

  it("database constraints make an inconsistent reward state impossible", async () => {
    await expect(
      db.query("update public.loyalty_accounts set stamp_count = 6 where id = $1", [accountId]),
    ).rejects.toThrow(/loyalty_accounts_stamp_range/);
    await expect(
      db.query("update public.loyalty_accounts set reward_available = true where id = $1", [accountId]),
    ).rejects.toThrow(/loyalty_accounts_reward_matches_stamps/);
  });

  it("redeems the reward and resets to 0 / 5", async () => {
    await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 5 });
    const r = await applyAction(db, { actorId: staffId, accountId, action: "REDEEM_REWARD" });
    expect(r.ok).toBe(true);
    const acct = await accountFor(db, userId);
    expect(acct!.stamp_count).toBe(0);
    expect(acct!.reward_available).toBe(false);
  });

  it("only redeems when a reward is available", async () => {
    await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 4 });
    const r = await applyAction(db, { actorId: staffId, accountId, action: "REDEEM_REWARD" });
    expect(r).toMatchObject({ ok: false, code: "NO_REWARD" });
  });

  it("removes a cup but never goes below zero", async () => {
    const zero = await applyAction(db, { actorId: staffId, accountId, action: "REMOVE_CUPS" });
    expect(zero).toMatchObject({ ok: false, code: "ALREADY_ZERO" });

    await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 2 });
    const r = await applyAction(db, { actorId: staffId, accountId, action: "REMOVE_CUPS" });
    expect(r).toMatchObject({ ok: true, new_stamp_count: 1 });

    const below = await applyAction(db, { actorId: staffId, accountId, action: "REMOVE_CUPS", quantity: 2 });
    expect(below).toMatchObject({ ok: false, code: "BELOW_ZERO" });
  });

  it("removing a cup from 5 / 5 withdraws the pending reward", async () => {
    await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 5 });
    await applyAction(db, { actorId: staffId, accountId, action: "REMOVE_CUPS" });
    const acct = await accountFor(db, userId);
    expect(acct).toMatchObject({ stamp_count: 4, reward_available: false });
  });

  it("undo creates a linked reversal transaction and restores the previous state", async () => {
    await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 2 });
    const add = await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 3 });
    expect((await accountFor(db, userId))!.reward_available).toBe(true);

    const undo = await applyAction(db, { actorId: staffId, accountId, action: "UNDO" });
    expect(undo).toMatchObject({ ok: true, reversal_of: add.transaction_id, new_stamp_count: 2 });
    expect((await accountFor(db, userId))!).toMatchObject({ stamp_count: 2, reward_available: false });

    const rows = await db.query<{ id: string; action: string; reversed_by: string | null; reversal_of: string | null }>(
      "select id, action, reversed_by, reversal_of from public.loyalty_transactions where loyalty_account_id = $1 order by seq",
      [accountId],
    );
    expect(rows.rows).toHaveLength(3); // history preserved, nothing deleted
    expect(rows.rows[1]!.reversed_by).toBe(undo.transaction_id);
    expect(rows.rows[2]).toMatchObject({ action: "UNDO", reversal_of: add.transaction_id });

    // Undo again reverses the earlier ADD (chained undo in order).
    const undo2 = await applyAction(db, { actorId: staffId, accountId, action: "UNDO" });
    expect(undo2).toMatchObject({ ok: true, new_stamp_count: 0 });
    const nothing = await applyAction(db, { actorId: staffId, accountId, action: "UNDO" });
    expect(nothing).toMatchObject({ ok: false, code: "NOTHING_TO_UNDO" });
  });

  it("undo of a redemption restores the reward", async () => {
    await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 5 });
    await applyAction(db, { actorId: staffId, accountId, action: "REDEEM_REWARD" });
    const undo = await applyAction(db, { actorId: staffId, accountId, action: "UNDO" });
    expect(undo.ok).toBe(true);
    expect(await accountFor(db, userId)).toMatchObject({ stamp_count: 5, reward_available: true });
  });

  it("audit rows cannot be deleted or rewritten", async () => {
    const r = await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 1 });
    await expect(
      db.query("delete from public.loyalty_transactions where id = $1", [r.transaction_id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query("update public.loyalty_transactions set quantity = 5 where id = $1", [r.transaction_id]),
    ).rejects.toThrow(/immutable/);
  });

  it("records who changed what and when", async () => {
    const r = await applyAction(db, { actorId: staffId, accountId, action: "ADD_CUPS", quantity: 2 });
    const row = await db.query(
      "select actor_user_id, actor_role, action, quantity, delta, previous_stamp_count, new_stamp_count, previous_reward_available, new_reward_available, created_at from public.loyalty_transactions where id = $1",
      [r.transaction_id],
    );
    expect(row.rows[0]).toMatchObject({
      actor_user_id: staffId,
      actor_role: "staff",
      action: "ADD_CUPS",
      quantity: 2,
      delta: 2,
      previous_stamp_count: 0,
      new_stamp_count: 2,
      previous_reward_available: false,
      new_reward_available: false,
    });
  });
});

describe("authorization inside the database", () => {
  it("rejects customers as actors", async () => {
    const a = await newCustomer();
    const b = await newCustomer();
    const r = await applyAction(db, { actorId: a.user.id, accountId: b.account.id, action: "ADD_CUPS", quantity: 1 });
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const self = await applyAction(db, { actorId: a.user.id, accountId: a.account.id, action: "ADD_CUPS", quantity: 1 });
    expect(self).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("reserves cancellation and adjustments for admins", async () => {
    const c = await newCustomer();
    for (const action of ["CANCEL_MEMBERSHIP", "ADMIN_ADJUSTMENT", "REACTIVATE_MEMBERSHIP"]) {
      const r = await applyAction(db, { actorId: staffId, accountId: c.account.id, action, target: 3 });
      expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const adj = await applyAction(db, { actorId: adminId, accountId: c.account.id, action: "ADMIN_ADJUSTMENT", target: 5 });
    expect(adj).toMatchObject({ ok: true, new_stamp_count: 5, new_reward_available: true });
  });

  it("staff cannot undo an admin adjustment", async () => {
    const c = await newCustomer();
    await applyAction(db, { actorId: adminId, accountId: c.account.id, action: "ADMIN_ADJUSTMENT", target: 3 });
    const r = await applyAction(db, { actorId: staffId, accountId: c.account.id, action: "UNDO" });
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const ok = await applyAction(db, { actorId: adminId, accountId: c.account.id, action: "UNDO" });
    expect(ok.ok).toBe(true);
  });

  it("cancelled memberships reject every loyalty operation and can be reactivated by admin", async () => {
    const c = await newCustomer();
    await applyAction(db, { actorId: staffId, accountId: c.account.id, action: "ADD_CUPS", quantity: 2 });
    const cancel = await applyAction(db, { actorId: adminId, accountId: c.account.id, action: "CANCEL_MEMBERSHIP" });
    expect(cancel.ok).toBe(true);
    for (const action of ["ADD_CUPS", "REMOVE_CUPS", "REDEEM_REWARD", "UNDO", "CANCEL_MEMBERSHIP"]) {
      const r = await applyAction(db, { actorId: adminId, accountId: c.account.id, action, quantity: 1 });
      expect(r).toMatchObject({ ok: false, code: "MEMBERSHIP_CANCELLED" });
    }
    const acct = await accountFor(db, c.user.id);
    expect(acct).toMatchObject({ membership_status: "cancelled", stamp_count: 2 });
    const re = await applyAction(db, { actorId: adminId, accountId: c.account.id, action: "REACTIVATE_MEMBERSHIP" });
    expect(re.ok).toBe(true);
  });

  it("browser roles cannot mutate loyalty data even on their own rows (RLS + grants)", async () => {
    const c = await newCustomer();
    await db.exec("begin");
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [c.user.id]);
      await db.exec("set local role authenticated");
      const own = await db.query("select stamp_count from public.loyalty_accounts");
      expect(own.rows).toHaveLength(1); // can read only their own account
      await expect(
        db.query("update public.loyalty_accounts set stamp_count = 5, reward_available = true"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("rollback");
    }

    for (const sql of [
      "insert into public.loyalty_transactions (loyalty_account_id) values (gen_random_uuid())",
      "update public.profiles set role = 'admin'",
      "select * from public.wallet_registrations",
    ]) {
      await db.exec("begin");
      try {
        await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [c.user.id]);
        await db.exec("set local role authenticated");
        await expect(db.query(sql)).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("rollback");
      }
    }

    await db.exec("begin");
    try {
      await db.exec("set local role authenticated");
      await expect(
        db.query("select public.apply_loyalty_action($1, $2, 'ADD_CUPS', 5)", [c.user.id, c.account.id]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("rollback");
    }
  });

  it("anonymous users cannot read anything", async () => {
    for (const table of ["loyalty_accounts", "profiles", "loyalty_transactions", "wallet_devices"]) {
      await db.exec("begin");
      try {
        await db.exec("set local role anon");
        await expect(db.query(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("rollback");
      }
    }
  });
});

describe("duplicate protection and idempotency", () => {
  it("warns about a recent mutation and requires explicit confirmation", async () => {
    const c = await newCustomer();
    const first = await applyAction(db, {
      actorId: staffId, accountId: c.account.id, action: "ADD_CUPS", quantity: 1, windowSeconds: 60,
    });
    expect(first.ok).toBe(true);
    const warned = await applyAction(db, {
      actorId: staffId, accountId: c.account.id, action: "ADD_CUPS", quantity: 1, windowSeconds: 60,
    });
    expect(warned).toMatchObject({ ok: false, code: "RECENT_ACTIVITY" });
    expect((await accountFor(db, c.user.id))!.stamp_count).toBe(1);

    const confirmed = await applyAction(db, {
      actorId: staffId, accountId: c.account.id, action: "ADD_CUPS", quantity: 1, windowSeconds: 60, confirmRecent: true,
    });
    expect(confirmed).toMatchObject({ ok: true, new_stamp_count: 2 });
  });

  it("never blocks a legitimate multi-cup purchase in a single operation", async () => {
    const c = await newCustomer();
    const r = await applyAction(db, {
      actorId: staffId, accountId: c.account.id, action: "ADD_CUPS", quantity: 5, windowSeconds: 60,
    });
    expect(r).toMatchObject({ ok: true, new_stamp_count: 5 });
  });

  it("allows UNDO immediately after an accidental operation", async () => {
    const c = await newCustomer();
    await applyAction(db, { actorId: staffId, accountId: c.account.id, action: "ADD_CUPS", quantity: 2, windowSeconds: 60 });
    const undo = await applyAction(db, { actorId: staffId, accountId: c.account.id, action: "UNDO", windowSeconds: 60 });
    expect(undo.ok).toBe(true);
  });

  it("replays an idempotency key instead of applying twice", async () => {
    const c = await newCustomer();
    const key = randomUUID();
    const a = await applyAction(db, { actorId: staffId, accountId: c.account.id, action: "ADD_CUPS", quantity: 2, idempotencyKey: key });
    const b = await applyAction(db, { actorId: staffId, accountId: c.account.id, action: "ADD_CUPS", quantity: 2, idempotencyKey: key });
    expect(b).toMatchObject({ ok: true, replayed: true, transaction_id: a.transaction_id });
    expect((await accountFor(db, c.user.id))!.stamp_count).toBe(2);

    const other = await newCustomer();
    const conflict = await applyAction(db, { actorId: staffId, accountId: other.account.id, action: "ADD_CUPS", quantity: 1, idempotencyKey: key });
    expect(conflict).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("bumps the Wallet update tag on every change", async () => {
    const c = await newCustomer();
    const before = (await accountFor(db, c.user.id))!.wallet_updated_at;
    await applyAction(db, { actorId: staffId, accountId: c.account.id, action: "ADD_CUPS", quantity: 1 });
    const after = (await accountFor(db, c.user.id))!.wallet_updated_at;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    expect(after).not.toEqual(before);
  });
});

describe("dashboard read models", () => {
  it("searches by name, member ID and (admin only) email with LIKE escaping", async () => {
    const c = await newCustomer("Noura Test");
    const byName = await db.query<{ member_id: string }>("select * from public.search_customers('noura', 10, 0, false)");
    expect(byName.rows.map((r) => r.member_id)).toContain(c.account.member_id);

    const byMember = await db.query<{ member_id: string }>("select * from public.search_customers($1, 10, 0, false)", [
      c.account.member_id.toLowerCase().replace("-", " - "),
    ]);
    expect(byMember.rows.map((r) => r.member_id)).toContain(c.account.member_id);

    const emailStaff = await db.query("select * from public.search_customers($1, 10, 0, false)", [c.user.email]);
    expect(emailStaff.rows).toHaveLength(0);
    const emailAdmin = await db.query("select * from public.search_customers($1, 10, 0, true)", [c.user.email]);
    expect(emailAdmin.rows).toHaveLength(1);

    const wildcard = await db.query("select * from public.search_customers('%', 10, 0, true)");
    expect(wildcard.rows).toHaveLength(0);
  });

  it("computes admin stats", async () => {
    const c = await newCustomer();
    await applyAction(db, { actorId: staffId, accountId: c.account.id, action: "ADD_CUPS", quantity: 5 });
    await applyAction(db, { actorId: staffId, accountId: c.account.id, action: "REDEEM_REWARD" });
    const res = await db.query<{ s: Record<string, number> }>("select public.admin_dashboard_stats('Asia/Riyadh') as s");
    const s = res.rows[0]!.s;
    expect(s.total_customers).toBeGreaterThan(0);
    expect(s.new_today).toBeGreaterThan(0);
    expect(s.cups_added_today).toBeGreaterThanOrEqual(5);
    expect(s.rewards_redeemed_today).toBeGreaterThanOrEqual(1);
  });

  it("lists transactions with names", async () => {
    const c = await newCustomer("History Person");
    await applyAction(db, { actorId: staffId, accountId: c.account.id, action: "ADD_CUPS", quantity: 1 });
    const res = await db.query<{ customer_name: string; actor_name: string; total_count: number }>(
      "select * from public.list_loyalty_transactions($1, 10, 0)",
      [c.account.id],
    );
    expect(res.rows[0]).toMatchObject({ customer_name: "History Person", actor_name: "Barista" });
  });
});

describe("wallet registrations", () => {
  it("registers, lists updated serials by tag and unregisters", async () => {
    const c = await newCustomer();
    const serial = c.account.pass_serial;
    const reg = await db.query<{ r: string }>(
      "select public.wallet_register_device('device-1', 'token-1', 'pass.test', $1) as r",
      [serial],
    );
    expect(reg.rows[0]!.r).toBe("created");
    const again = await db.query<{ r: string }>(
      "select public.wallet_register_device('device-1', 'token-2', 'pass.test', $1) as r",
      [serial],
    );
    expect(again.rows[0]!.r).toBe("exists");
    const unknown = await db.query<{ r: string }>(
      "select public.wallet_register_device('device-1', 'token-2', 'pass.test', gen_random_uuid()) as r",
    );
    expect(unknown.rows[0]!.r).toBe("unknown_pass");

    const all = await db.query<{ pass_serial: string; update_tag: string }>(
      "select * from public.wallet_updated_serials('device-1', 'pass.test', null)",
    );
    expect(all.rows).toHaveLength(1);
    const tag = BigInt(all.rows[0]!.update_tag);
    const none = await db.query("select * from public.wallet_updated_serials('device-1', 'pass.test', $1)", [tag.toString()]);
    expect(none.rows).toHaveLength(0);

    await applyAction(db, { actorId: staffId, accountId: c.account.id, action: "ADD_CUPS", quantity: 1 });
    const updated = await db.query("select * from public.wallet_updated_serials('device-1', 'pass.test', $1)", [tag.toString()]);
    expect(updated.rows).toHaveLength(1);

    await db.query("select public.wallet_unregister_device('device-1', 'pass.test', $1)", [serial]);
    const devices = await db.query("select * from public.wallet_devices where device_library_identifier = 'device-1'");
    expect(devices.rows).toHaveLength(0);
  });
});
