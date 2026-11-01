import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../helpers/db";

/**
 * Regression checks for the *final* permission state after applying ALL repo
 * migrations to a disposable PGlite database. No live Supabase connection,
 * production credentials, or customer records are used.
 *
 * The Worker is the sole writer through its service-role credential. The
 * browser may only SELECT its own profile and loyalty account through RLS.
 */
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

describe("database least-privilege posture", () => {
  it("enables RLS on every public table", async () => {
    const tables = await db.query<{ name: string; rls: boolean }>(`
      select c.relname as name, c.relrowsecurity as rls
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
       order by c.relname
    `);
    expect(tables.rows.length).toBeGreaterThanOrEqual(20);
    expect(tables.rows.filter((t) => !t.rls).map((t) => t.name)).toEqual([]);
  });

  it("does not grant table writes to browser roles or anonymous table reads", async () => {
    const tables = await db.query<{
      name: string;
      anonRead: boolean;
      userRead: boolean;
      anonWrite: boolean;
      userWrite: boolean;
    }>(`
      select c.relname as name,
             has_table_privilege('anon', c.oid, 'SELECT') as "anonRead",
             has_table_privilege('authenticated', c.oid, 'SELECT') as "userRead",
             (
               has_table_privilege('anon', c.oid, 'INSERT') or
               has_table_privilege('anon', c.oid, 'UPDATE') or
               has_table_privilege('anon', c.oid, 'DELETE')
             ) as "anonWrite",
             (
               has_table_privilege('authenticated', c.oid, 'INSERT') or
               has_table_privilege('authenticated', c.oid, 'UPDATE') or
               has_table_privilege('authenticated', c.oid, 'DELETE')
             ) as "userWrite"
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
       order by c.relname
    `);
    expect(tables.rows.length).toBeGreaterThanOrEqual(20);
    expect(tables.rows.filter((t) => t.anonRead || t.anonWrite || t.userWrite)).toEqual([]);
    expect(tables.rows.filter((t) => t.userRead).map((t) => t.name)).toEqual([
      "loyalty_accounts",
      "profiles",
    ]);
  });

  it("does not expose SECURITY DEFINER functions to anon or authenticated", async () => {
    const functions = await db.query<{
      name: string;
      anonCanExecute: boolean;
      userCanExecute: boolean;
    }>(`
      select p.oid::regprocedure::text as name,
             has_function_privilege('anon', p.oid, 'EXECUTE') as "anonCanExecute",
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as "userCanExecute"
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
       order by p.proname
    `);
    expect(functions.rows.length).toBeGreaterThan(0);
    expect(
      functions.rows.filter((f) => f.anonCanExecute || f.userCanExecute).map((f) => f.name),
    ).toEqual([]);
  });

  it("keeps own-row SELECT RLS policies for profile and loyalty only", async () => {
    const result = await db.query<{
      tablename: string;
      policyname: string;
      cmd: string;
      qual: string | null;
    }>(`
      select tablename, policyname, cmd, qual
        from pg_policies
       where schemaname = 'public'
       order by tablename, policyname
    `);
    expect(result.rows.map((p) => p.tablename)).toEqual(["loyalty_accounts", "profiles"]);
    for (const policy of result.rows) {
      expect(policy.cmd).toBe("SELECT");
      expect(policy.qual).toMatch(/auth\.uid\(\)/i);
      expect(policy.qual).toMatch(policy.tablename === "profiles" ? /\bid\b/ : /\buser_id\b/);
    }
  });
});
