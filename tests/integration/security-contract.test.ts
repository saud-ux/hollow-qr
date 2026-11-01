/**
 * Security contract for the committed SQL migrations.
 *
 * Runs only against fresh, disposable PGlite data. This suite does NOT audit
 * the live Supabase project and must not be mistaken for a production scan.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/db";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

type TableAccess = {
  table_name: string;
  rls_enabled: boolean;
  anon_read: boolean;
  anon_insert: boolean;
  anon_update: boolean;
  anon_delete: boolean;
  user_read: boolean;
  user_insert: boolean;
  user_update: boolean;
  user_delete: boolean;
};

async function publicTableAccess(): Promise<TableAccess[]> {
  const { rows } = await db.query<TableAccess>(`
    select c.relname as table_name,
      c.relrowsecurity as rls_enabled,
      has_table_privilege('anon', c.oid, 'SELECT') as anon_read,
      has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
      has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
      has_table_privilege('anon', c.oid, 'DELETE') as anon_delete,
      has_table_privilege('authenticated', c.oid, 'SELECT') as user_read,
      has_table_privilege('authenticated', c.oid, 'INSERT') as user_insert,
      has_table_privilege('authenticated', c.oid, 'UPDATE') as user_update,
      has_table_privilege('authenticated', c.oid, 'DELETE') as user_delete
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname
  `);
  return rows;
}

describe("minimum release security contract (migration-built database)", () => {
  it("enables RLS on every public table, including new tables", async () => {
    const tables = await publicTableAccess();
    expect(tables.length).toBeGreaterThan(20);
    expect(tables.filter((table) => !table.rls_enabled).map((table) => table.table_name)).toEqual([]);
  });

  it("never grants anonymous database users direct table read or write access", async () => {
    const tables = await publicTableAccess();
    const exposed = tables
      .filter((table) => table.anon_read || table.anon_insert || table.anon_update || table.anon_delete)
      .map((table) => table.table_name);
    expect(exposed).toEqual([]);
  });

  it("limits direct authenticated access to the customer's own profile and loyalty read paths", async () => {
    const tables = await publicTableAccess();
    const writable = tables
      .filter((table) => table.user_insert || table.user_update || table.user_delete)
      .map((table) => table.table_name);
    expect(writable).toEqual([]);
    const readable = tables.filter((table) => table.user_read).map((table) => table.table_name);
    expect(readable).toEqual(["loyalty_accounts", "profiles"]);
  });

  it("keeps row ownership predicates on both permitted customer read policies", async () => {
    const { rows } = await db.query<{ tablename: string; qual: string | null }>(`
      select tablename, qual
      from pg_policies
      where schemaname = 'public'
        and tablename in ('profiles', 'loyalty_accounts')
        and cmd in ('SELECT', 'ALL')
      order by tablename
    `);
    expect(rows.map((row) => row.tablename)).toEqual(["loyalty_accounts", "profiles"]);
    for (const row of rows) {
      expect(row.qual).toMatch(/auth\.uid\(\)/);
      expect(row.qual).toContain(row.tablename === "profiles" ? "id" : "user_id");
    }
  });

  it("does not expose SECURITY DEFINER RPCs directly to anon/authenticated roles", async () => {
    const { rows } = await db.query<{ function_name: string }>(`
      select p.proname as function_name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and (
          has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE')
        )
      order by p.proname
    `);
    expect(rows.map((row) => row.function_name)).toEqual([]);
  });
});
