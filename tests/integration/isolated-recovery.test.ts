/**
 * An actual backup -> restore exercise on a disposable PGlite database.
 *
 * Nothing in this test can reach Supabase production. The source database
 * is generated from committed migrations and contains synthetic identities.
 * PGlite's data-directory archive is NOT a Supabase production backup.
 */
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { accountFor, applyAction, createAuthUser, createTestDb } from "../helpers/db";

describe("isolated backup and recovery drill", () => {
  it("restores synthetic customers, loyalty history, schema constraints, and least-privilege grants", async () => {
    const original = await createTestDb();
    let restored: PGlite | undefined;
    try {
      const staff = await createAuthUser(original, {
        email: "restore-staff@example.invalid",
        name: "Restore Test Staff",
        role: "staff",
      });
      const customer = await createAuthUser(original, {
        email: "restore-customer@example.invalid",
        name: "Restore Test Customer",
      });
      const before = await accountFor(original, customer.id);
      expect(before).toBeDefined();

      const mutation = await applyAction(original, {
        actorId: staff.id,
        accountId: before!.id,
        action: "ADD_CUPS",
        quantity: 3,
      });
      expect(mutation.ok).toBe(true);

      // This archive contains ONLY the temporary test database, not live data.
      const archive = await original.dumpDataDir("none");
      expect(archive.size).toBeGreaterThan(0);

      restored = await PGlite.create({ loadDataDir: archive });
      const after = await accountFor(restored, customer.id);
      expect(after).toMatchObject({
        id: before!.id,
        stamp_count: 3,
        reward_available: false,
      });

      const audit = await restored.query<{ actor_user_id: string; quantity: number }>(
        "select actor_user_id, quantity from public.loyalty_transactions where loyalty_account_id = $1",
        [before!.id],
      );
      expect(audit.rows).toEqual([{ actor_user_id: staff.id, quantity: 3 }]);

      const security = await restored.query<{
        rls: boolean;
        anon_write: boolean;
        user_write: boolean;
      }>(`
        select c.relrowsecurity as rls,
          (has_table_privilege('anon', c.oid, 'INSERT') or
           has_table_privilege('anon', c.oid, 'UPDATE') or
           has_table_privilege('anon', c.oid, 'DELETE')) as anon_write,
          (has_table_privilege('authenticated', c.oid, 'INSERT') or
           has_table_privilege('authenticated', c.oid, 'UPDATE') or
           has_table_privilege('authenticated', c.oid, 'DELETE')) as user_write
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'loyalty_accounts'
      `);
      expect(security.rows).toEqual([{ rls: true, anon_write: false, user_write: false }]);

      const redeemed = await applyAction(restored, {
        actorId: staff.id,
        accountId: after!.id,
        action: "ADD_CUPS",
        quantity: 2,
      });
      expect(redeemed).toMatchObject({ ok: true, new_stamp_count: 5, new_reward_available: true });
      // Restored snapshot and original must not share mutable state.
      expect(await accountFor(original, customer.id)).toMatchObject({
        stamp_count: 3, reward_available: false,
      });
    } finally {
      if (restored) await restored.close();
      await original.close();
    }
  });
});
