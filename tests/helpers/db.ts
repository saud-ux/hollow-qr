/**
 * Spins up an in-process PostgreSQL (PGlite, real Postgres compiled to WASM)
 * and applies the real Supabase migrations on top of a minimal stub of the
 * Supabase `auth` schema and roles. This lets us test the actual SQL —
 * constraints, triggers, RLS and the atomic loyalty RPC — without Docker.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(import.meta.dirname, "../../supabase/migrations");

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

export interface CreatedUser {
  id: string;
  email: string;
}

export async function createAuthUser(
  db: PGlite,
  opts: { email: string; name?: string; role?: "staff" | "admin"; confirmed?: boolean },
): Promise<CreatedUser> {
  const res = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
     values ($1, $2::jsonb, $3::jsonb, $4) returning id`,
    [
      opts.email,
      JSON.stringify(opts.name ? { display_name: opts.name } : {}),
      JSON.stringify(opts.role ? { hollow_role: opts.role } : {}),
      opts.confirmed === false ? null : new Date().toISOString(),
    ],
  );
  return { id: res.rows[0]!.id, email: opts.email };
}

export interface ActionResult {
  ok: boolean;
  code?: string;
  replayed?: boolean;
  transaction_id?: string;
  remaining?: number;
  seconds_ago?: number;
  new_stamp_count?: number;
  previous_stamp_count?: number;
  new_reward_available?: boolean;
  reversal_of?: string;
  account?: { stamp_count: number; reward_available: boolean; membership_status: string };
}

export async function applyAction(
  db: PGlite,
  args: {
    actorId: string;
    accountId: string;
    action: string;
    quantity?: number | null;
    target?: number | null;
    idempotencyKey?: string | null;
    confirmRecent?: boolean;
    windowSeconds?: number;
  },
): Promise<ActionResult> {
  const res = await db.query<{ r: ActionResult }>(
    `select public.apply_loyalty_action($1, $2, $3::public.loyalty_action, $4, $5, $6, $7, $8) as r`,
    [
      args.actorId,
      args.accountId,
      args.action,
      args.quantity ?? null,
      args.target ?? null,
      args.idempotencyKey ?? null,
      args.confirmRecent ?? false,
      args.windowSeconds ?? 0,
    ],
  );
  return res.rows[0]!.r;
}

export async function accountFor(db: PGlite, userId: string) {
  const res = await db.query<{
    id: string;
    member_id: string;
    stamp_count: number;
    reward_available: boolean;
    membership_status: string;
    pass_serial: string;
    qr_token_id: string;
    wallet_updated_at: string;
  }>(`select * from public.loyalty_accounts where user_id = $1`, [userId]);
  return res.rows[0];
}
