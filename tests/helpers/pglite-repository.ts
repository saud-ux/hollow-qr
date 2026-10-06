/**
 * Repository backed by PGlite running the real migrations. Mirrors
 * SupabaseRepository query-for-query so API tests exercise the real SQL.
 */
import type { PGlite } from "@electric-sql/pglite";
import {
  mapAccount,
  mapMenuItem,
  mapOrder,
  mapProfile,
  mapSearchRow,
  mapShopSettings,
  mapTransaction,
  menuItemColumns,
  shopSettingsColumns,
  totalFrom,
} from "../../src/server/data/mappers";
import type { OrderStatus, ShopSettings } from "../../src/shared/ordering";
import type {
  ApplyActionParams,
  ApplyActionResult,
  CreateStaffParams,
  CreateStaffResult,
  DashboardStatsRow,
  ListOrdersParams,
  MenuItemInput,
  OrderRpcResult,
  PlaceOrderParams,
  RemoveStaffResult,
  Repository,
} from "../../src/server/data/repository";

type Raw = Record<string, unknown>;

const ACCOUNT_SQL = `select a.*, p.display_name, p.email from public.loyalty_accounts a join public.profiles p on p.id = a.user_id`;

/** Builds "col = $n" assignments from a whitelisted column map. */
function assignments(cols: Raw, jsonCols: string[] = []): { sql: string; values: unknown[] } {
  const keys = Object.keys(cols);
  return {
    sql: keys.map((k, i) => `${k} = $${i + 1}${jsonCols.includes(k) ? "::jsonb" : ""}`).join(", "),
    values: keys.map((k) => (jsonCols.includes(k) ? JSON.stringify(cols[k]) : cols[k])),
  };
}

export class PgliteRepository implements Repository {
  /** Stand-in for the Storage bucket: path -> content type. */
  readonly images = new Map<string, string>();

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
      "select public.apply_loyalty_action($1::uuid, $2::uuid, $3::public.loyalty_action, $4::int, $5::int, $6::uuid, $7::boolean, $8::int, $9::text) as r",
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
    const res = await this.db.query<Raw>("select * from public.profiles where role in ('staff','admin') and disabled_at is null order by created_at");
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
    const profile = await this.getProfile(userId);
    if (!profile) return { ok: false, code: "NOT_FOUND" };
    if (profile.role !== "staff") return { ok: false, code: "NOT_STAFF" };
    if (profile.disabledAt !== null) return { ok: false, code: "ALREADY_REMOVED" };
    await this.db.query("update public.profiles set disabled_at = now() where id = $1 and role = 'staff' and disabled_at is null", [userId]);
    return { ok: true };
  }

  async listMenuItems(includeArchived: boolean) {
    const res = await this.db.query<Raw>(
      `select * from public.menu_items where $1 or not is_archived order by category, sort_order, name_ar`,
      [includeArchived],
    );
    return res.rows.map(mapMenuItem);
  }
  async getMenuItem(id: string) {
    const r = await this.one("select * from public.menu_items where id = $1", [id]);
    return r ? mapMenuItem(r) : null;
  }
  async createMenuItem(input: MenuItemInput) {
    const cols = menuItemColumns(input);
    const keys = Object.keys(cols);
    const r = await this.one(
      `insert into public.menu_items (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
      keys.map((k) => cols[k]),
    );
    return mapMenuItem(r!);
  }
  async updateMenuItem(id: string, patch: Partial<MenuItemInput> & { imagePath?: string | null }) {
    const { sql, values } = assignments(menuItemColumns(patch));
    if (!sql) return this.getMenuItem(id);
    const r = await this.one(`update public.menu_items set ${sql} where id = $${values.length + 1} returning *`, [...values, id]);
    return r ? mapMenuItem(r) : null;
  }
  uploadMenuImage(path: string, _bytes: Uint8Array, contentType: string) {
    this.images.set(path, contentType);
    return Promise.resolve();
  }
  deleteMenuImage(path: string) {
    this.images.delete(path);
    return Promise.resolve();
  }
  async getShopSettings() {
    return mapShopSettings((await this.one("select * from public.shop_settings where id = 1", []))!);
  }
  async updateShopSettings(patch: Partial<ShopSettings>) {
    const { sql, values } = assignments(shopSettingsColumns(patch), ["weekly_hours"]);
    if (sql) await this.db.query(`update public.shop_settings set ${sql} where id = 1`, values);
    return this.getShopSettings();
  }
  async isShopOpen(timeZone: string) {
    const r = await this.one("select public.shop_is_open(now(), $1) as open", [timeZone]);
    return Boolean(r!.open);
  }
  async placeOrder(p: PlaceOrderParams): Promise<OrderRpcResult> {
    const r = await this.one(
      "select public.place_order($1, $2::jsonb, $3::public.fulfillment_type, $4, $5, $6, $7, $8, $9, $10, $11, $12) as r",
      [
        p.customerId,
        JSON.stringify(p.items.map((i) => ({ menu_item_id: i.menuItemId, quantity: i.quantity, note: i.note }))),
        p.fulfillment,
        p.phone,
        p.carDescription,
        p.deliveryAddress,
        p.deliveryLat,
        p.deliveryLng,
        p.note,
        p.useReward,
        p.idempotencyKey,
        p.timeZone,
      ],
    );
    return r!.r as OrderRpcResult;
  }
  async setOrderStatus(actorId: string, orderId: string, status: OrderStatus, cancelReason: string | null) {
    const r = await this.one("select public.set_order_status($1, $2, $3::public.order_status, $4) as r", [actorId, orderId, status, cancelReason]);
    return r!.r as OrderRpcResult;
  }
  async customerOrderAction(customerId: string, orderId: string, action: "cancel" | "arrived") {
    const r = await this.one("select public.customer_order_action($1, $2, $3) as r", [customerId, orderId, action]);
    return r!.r as OrderRpcResult;
  }
  async listOrders(p: ListOrdersParams) {
    const r = await this.one("select public.list_orders($1, $2, $3, $4, $5) as r", [
      p.customerId ?? null,
      p.orderId ?? null,
      p.scope,
      p.recentMinutes ?? 120,
      p.limit ?? 50,
    ]);
    return (r!.r as Raw[]).map(mapOrder);
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
