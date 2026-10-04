import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mapAccount, mapProfile, mapSearchRow, mapTransaction, totalFrom } from "./mappers";
import type {
  AccountRow,
  ApplyActionParams,
  ApplyActionResult,
  CreateStaffParams,
  CreateStaffResult,
  DashboardStatsRow,
  ProfileRow,
  PushTarget,
  RemoveStaffResult,
  Repository,
} from "./repository";

type Raw = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;
/** supabase-js returns `any` data for an untyped schema; narrow it explicitly. */
type DbResult = { data: unknown; error: DbError; count?: number | null };

const ACCOUNT_SELECT =
  "id, user_id, member_id, stamp_count, reward_available, membership_status, pass_serial, qr_token_id, wallet_updated_at, last_mutation_at, cancelled_at, created_at, profiles!inner(display_name, email)";

export class RepositoryError extends Error {
  constructor(operation: string, cause: { message?: string; code?: string } | null) {
    // Only the operation name and a Postgres error code leave this class.
    super(`repository operation failed: ${operation}${cause?.code ? ` (${cause.code})` : ""}`);
    this.name = "RepositoryError";
  }
}

/**
 * Service-role Supabase access. Only ever instantiated inside the Worker; the
 * key never reaches the browser. Authorization is enforced by the HTTP layer
 * AND again inside the SQL functions (defense in depth).
 */
export class SupabaseRepository implements Repository {
  private readonly db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    // Untyped schema (no generated Database type): every result is narrowed
    // through DbResult + the mappers instead.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.db = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { "x-client-info": "hollow-rewards-worker" } },
    });
  }

  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = (await this.db.rpc(name, args)) as DbResult;
    if (error) throw new RepositoryError(name, error);
    return data;
  }

  async getProfile(userId: string): Promise<ProfileRow | null> {
    const { data, error } = (await this.db
      .from("profiles")
      .select("id, display_name, email, role, email_confirmed_at, disabled_at, created_at")
      .eq("id", userId)
      .maybeSingle()) as DbResult;
    if (error) throw new RepositoryError("getProfile", error);
    return data ? mapProfile(data as Raw) : null;
  }

  async ensureLoyaltyAccount(userId: string): Promise<void> {
    await this.rpc("ensure_loyalty_account", { p_user_id: userId });
  }

  private async accountBy(column: string, value: string): Promise<AccountRow | null> {
    const { data, error } = (await this.db.from("loyalty_accounts").select(ACCOUNT_SELECT).eq(column, value).maybeSingle()) as DbResult;
    if (error) throw new RepositoryError(`accountBy:${column}`, error);
    return data ? mapAccount(data as Raw) : null;
  }

  getAccountByUserId(userId: string) {
    return this.accountBy("user_id", userId);
  }
  getAccountById(accountId: string) {
    return this.accountBy("id", accountId);
  }
  getAccountByMemberId(memberId: string) {
    return this.accountBy("member_id", memberId);
  }
  getAccountByQrTokenId(qrTokenId: string) {
    return this.accountBy("qr_token_id", qrTokenId);
  }
  getAccountBySerial(passSerial: string) {
    return this.accountBy("pass_serial", passSerial);
  }

  async applyLoyaltyAction(p: ApplyActionParams): Promise<ApplyActionResult> {
    const data = await this.rpc("apply_loyalty_action", {
      p_actor_id: p.actorId,
      p_account_id: p.accountId,
      p_action: p.action,
      p_quantity: p.quantity ?? null,
      p_target_stamp_count: p.targetStampCount ?? null,
      p_idempotency_key: p.idempotencyKey ?? null,
      p_confirm_recent: p.confirmRecent ?? false,
      p_recent_window_seconds: p.recentWindowSeconds,
      p_source: p.source ?? "dashboard",
    });
    return data as ApplyActionResult;
  }

  async searchCustomers(query: string, limit: number, offset: number, includeEmail: boolean) {
    const data = await this.rpc("search_customers", {
      p_query: query,
      p_limit: limit,
      p_offset: offset,
      p_include_email: includeEmail,
    });
    const rows = (data ?? []) as Raw[];
    return { rows: rows.map(mapSearchRow), total: totalFrom(rows) };
  }

  async listTransactions(accountId: string | null, limit: number, offset: number) {
    const data = await this.rpc("list_loyalty_transactions", {
      p_account_id: accountId,
      p_limit: limit,
      p_offset: offset,
    });
    const rows = (data ?? []) as Raw[];
    return { rows: rows.map(mapTransaction), total: totalFrom(rows) };
  }

  async getDashboardStats(timeZone: string): Promise<DashboardStatsRow> {
    const data = await this.rpc("admin_dashboard_stats", { p_time_zone: timeZone });
    return data as DashboardStatsRow;
  }

  async listStaff(): Promise<ProfileRow[]> {
    const { data, error } = (await this.db
      .from("profiles")
      .select("id, display_name, email, role, email_confirmed_at, disabled_at, created_at")
      .in("role", ["staff", "admin"])
      .is("disabled_at", null)
      .order("created_at", { ascending: true })
      .limit(500)) as DbResult;
    if (error) throw new RepositoryError("listStaff", error);
    return ((data ?? []) as Raw[]).map(mapProfile);
  }

  async createStaffUser(p: CreateStaffParams): Promise<CreateStaffResult> {
    const { data, error } = await this.db.auth.admin.createUser({
      email: p.email,
      password: p.password,
      email_confirm: true,
      user_metadata: { display_name: p.displayName },
      // app_metadata is only writable with the service-role key; the
      // on_auth_user_created trigger reads it to assign the staff role.
      app_metadata: { hollow_role: "staff" },
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "email_exists" || /already (been )?registered/i.test(error.message)) {
        return { ok: false, code: "EMAIL_EXISTS" };
      }
      if (code === "weak_password") return { ok: false, code: "WEAK_PASSWORD" };
      throw new RepositoryError("createStaffUser", { code });
    }
    // Supabase writes app_metadata after the insert trigger runs; set the
    // role explicitly too (the role-sync trigger also handles it).
    const { error: roleError } = (await this.db.from("profiles").update({ role: "staff" }).eq("id", data.user.id)) as DbResult;
    if (roleError) throw new RepositoryError("createStaffUser:role", roleError);
    return { ok: true, userId: data.user.id };
  }

  async removeStaffUser(userId: string): Promise<RemoveStaffResult> {
    const profile = await this.getProfile(userId);
    if (!profile) return { ok: false, code: "NOT_FOUND" };
    if (profile.role !== "staff") return { ok: false, code: "NOT_STAFF" };
    if (profile.disabledAt !== null) return { ok: false, code: "ALREADY_REMOVED" };

    const { error } = (await this.db
      .from("profiles")
      .update({ disabled_at: new Date().toISOString() })
      .eq("id", userId)
      .eq("role", "staff")
      .is("disabled_at", null)) as DbResult;
    if (error) throw new RepositoryError("removeStaffUser", error);
    return { ok: true };
  }

  async walletRegisterDevice(device: string, pushToken: string, passTypeIdentifier: string, serial: string) {
    const data = await this.rpc("wallet_register_device", {
      p_device_library_identifier: device,
      p_push_token: pushToken,
      p_pass_type_identifier: passTypeIdentifier,
      p_pass_serial: serial,
    });
    return data as "created" | "exists" | "unknown_pass";
  }

  async walletUnregisterDevice(device: string, passTypeIdentifier: string, serial: string) {
    await this.rpc("wallet_unregister_device", {
      p_device_library_identifier: device,
      p_pass_type_identifier: passTypeIdentifier,
      p_pass_serial: serial,
    });
  }

  async walletUpdatedSerials(device: string, passTypeIdentifier: string, sinceMicros: bigint | null) {
    const data = await this.rpc("wallet_updated_serials", {
      p_device_library_identifier: device,
      p_pass_type_identifier: passTypeIdentifier,
      // Sent as a string so precision is never lost in JSON numbers.
      p_since_micros: sinceMicros === null ? null : sinceMicros.toString(),
    });
    return ((data ?? []) as Raw[]).map((r) => ({ serial: r.pass_serial as string, tag: BigInt(r.update_tag as string | number) }));
  }

  async walletPushTargets(serial: string): Promise<PushTarget[]> {
    const { data, error } = (await this.db
      .from("wallet_registrations")
      .select("device_library_identifier, wallet_devices!inner(push_token)")
      .eq("pass_serial", serial)
      .limit(50)) as DbResult;
    if (error) throw new RepositoryError("walletPushTargets", error);
    return ((data ?? []) as Raw[]).map((r) => ({
      deviceLibraryIdentifier: r.device_library_identifier as string,
      pushToken: String((r.wallet_devices as { push_token: string }).push_token),
    }));
  }

  async walletDeleteDevice(device: string) {
    const { error } = (await this.db.from("wallet_devices").delete().eq("device_library_identifier", device)) as DbResult;
    if (error) throw new RepositoryError("walletDeleteDevice", error);
  }

  async walletDeviceCount(serial: string) {
    const { count, error } = (await this.db
      .from("wallet_registrations")
      .select("device_library_identifier", { count: "exact", head: true })
      .eq("pass_serial", serial)) as DbResult;
    if (error) throw new RepositoryError("walletDeviceCount", error);
    return count ?? 0;
  }
}
