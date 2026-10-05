/**
 * Repository backed by PGlite running the real migrations. Mirrors
 * SupabaseRepository query-for-query so API tests exercise the real SQL.
 */
import type { PGlite } from "@electric-sql/pglite";
import { mapAccount, mapProfile, mapSearchRow, mapTransaction, totalFrom } from "../../src/server/data/mappers";
import type {
  ApplyActionParams,
  ApplyActionResult,
  CreateStaffParams,
  CreateStaffResult,
  DashboardStatsRow,
  RemoveStaffResult,
  Repository,
} from "../../src/server/data/repository";

type Raw = Record<string, unknown>;

const ACCOUNT_SQL = `select a.*, p.display_name, p.email from public.loyalty_accounts a join public.profiles p on p.id = a.user_id`;

export class PgliteRepository implements Repository {
  constructor(private readonly db: PGlite) {}

  private async one(sql: string, params: unknown[]): Promise<Raw | undefined> {
    const res = await this.db.query<Raw>(sql, params);
    return res.rows[0];
  }

  async getProfile(userId: string) {
    const r = await this.one("select * from public.profiles where id = $1", [userId]);
    return r ? mapProfile(r) : null;
  }
  async ensureLoyaltyAccount(userId: string) {
    await this.db.query("select public.ensure_loyalty_account($1)", [userId]);
  }
  private async accountWhere(column: string, value: string) {
    const r = await this.one(`${ACCOUNT_SQL} where a.${column} = $1`, [value]);
    return r ? mapAccount(r) : null;
  }
  getAccountByUserId(id: string) {
    return this.accountWhere("user_id", id);
  }
  getAccountById(id: string) {
    return this.accountWhere("id", id);
  }
  getAccountByMemberId(id: string) {
    return this.accountWhere("member_id", id);
  }
  getAccountByQrTokenId(id: string) {
    return this.accountWhere("qr_token_id", id);
  }
  getAccountBySerial(id: string) {
    return this.accountWhere("pass_serial", id);
  }

  async applyLoyaltyAction(p: ApplyActionParams): Promise<ApplyActionResult> {
    const r = await this.one(
      "select public.apply_loyalty_action($1, $2, $3::public.loyalty_action, $4, $5, $6, $7, $8, $9) as r",
      [
        p.actorId,
        p.accountId,
        p.action,
        p.quantity ?? null,
        p.targetStampCount ?? null,
        p.idempotencyKey ?? null,
        p.confirmRecent ?? false,
        p.recentWindowSeconds,
        p.source ?? "dashboard",
      ],
    );
    return r!.r as ApplyActionResult;
  }

  async searchCustomers(query: string, limit: number, offset: number, includeEmail: boolean) {
    const res = await this.db.query<Raw>("select * from public.search_customers($1, $2, $3, $4)", [query, limit, offset, includeEmail]);
    return { rows: res.rows.map(mapSearchRow), total: totalFrom(res.rows) };
  }
  async listTransactions(accountId: string | null, limit: number, offset: number) {
    const res = await this.db.query<Raw>("select * from public.list_loyalty_transactions($1, $2, $3)", [accountId, limit, offset]);
    return { rows: res.rows.map(mapTransaction), total: totalFrom(res.rows) };
  }
  async getDashboardStats(tz: string) {
    const r = await this.one("select public.admin_dashboard_stats($1) as s", [tz]);
    return r!.s as DashboardStatsRow;
  }
  async listStaff() {
    const res = await this.db.query<Raw>("select * from public.profiles where role in ('staff','admin') order by created_at");
    return res.rows.map(mapProfile);
  }
  async createStaffUser(p: CreateStaffParams): Promise<CreateStaffResult> {
    const exists = await this.one("select 1 from auth.users where lower(email) = lower($1)", [p.email]);
    if (exists) return { ok: false, code: "EMAIL_EXISTS" };
    const r = await this.one(
      `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
       values ($1, jsonb_build_object('display_name', $2::text), '{"hollow_role":"staff"}', now()) returning id`,
      [p.email, p.displayName],
    );
    return { ok: true, userId: String(r!.id) };
  }
  async removeStaffUser(userId: string): Promise<RemoveStaffResult> {
    const r = await this.one("update public.profiles set role = 'customer' where id = $1 and role = 'staff' returning id", [userId]);
    if (!r) return { ok: false, code: "STAFF_NOT_FOUND" };
    await this.db.query(
      "update auth.users set banned_until = 'infinity', raw_app_meta_data = raw_app_meta_data || '{\"hollow_role\":null}' where id = $1",
      [userId],
    );
    return { ok: true };
  }

  async walletRegisterDevice(device: string, pushToken: string, passType: string, serial: string) {
    const r = await this.one("select public.wallet_register_device($1, $2, $3, $4) as r", [device, pushToken, passType, serial]);
    return r!.r as "created" | "exists" | "unknown_pass";
  }
  async walletUnregisterDevice(device: string, passType: string, serial: string) {
    await this.db.query("select public.wallet_unregister_device($1, $2, $3)", [device, passType, serial]);
  }
  async walletUpdatedSerials(device: string, passType: string, since: bigint | null) {
    const res = await this.db.query<Raw>("select * from public.wallet_updated_serials($1, $2, $3)", [
      device,
      passType,
      since === null ? null : since.toString(),
    ]);
    return res.rows.map((r) => ({ serial: String(r.pass_serial), tag: BigInt(String(r.update_tag)) }));
  }
  async walletPushTargets(serial: string) {
    const res = await this.db.query<Raw>(
      `select r.device_library_identifier, d.push_token from public.wallet_registrations r
       join public.wallet_devices d using (device_library_identifier) where r.pass_serial = $1`,
      [serial],
    );
    return res.rows.map((r) => ({ deviceLibraryIdentifier: String(r.device_library_identifier), pushToken: String(r.push_token) }));
  }
  async walletDeleteDevice(device: string) {
    await this.db.query("delete from public.wallet_devices where device_library_identifier = $1", [device]);
  }
  async walletDeviceCount(serial: string) {
    const r = await this.one("select count(*)::int as n from public.wallet_registrations where pass_serial = $1", [serial]);
    return Number(r!.n);
  }
}
