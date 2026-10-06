import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Order, OrderStatus, ShopSettings } from "../../shared/ordering";
import { MENU_IMAGE_BUCKET } from "../../shared/ordering";
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
} from "./mappers";
import type {
  AccountRow,
  ApplyActionParams,
  ApplyActionResult,
  CreateStaffParams,
  CreateStaffResult,
  DashboardStatsRow,
  DeleteAccountResult,
  ListOrdersParams,
  MenuItemInput,
  MenuItemRow,
  OrderRpcResult,
  PlaceOrderParams,
  ProfileRow,
  PushTarget,
  RemoveStaffResult,
  Repository,
} from "./repository";
import { deleteAccountCode } from "./repository";

type Raw = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;
/** supabase-js returns `any` data for an untyped schema; narrow it explicitly. */
type DbResult = { data: unknown; error: DbError; count?: number | null };

const MENU_SELECT = "id, name_ar, name_en, description_ar, category, price_halalas, image_path, is_available, is_archived, sort_order";
const SETTINGS_SELECT =
  "ordering_paused, pickup_enabled, curbside_enabled, delivery_enabled, delivery_fee_halalas, delivery_min_order_halalas, weekly_hours";

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

  async listMenuItems(includeArchived: boolean): Promise<MenuItemRow[]> {
    let query = this.db.from("menu_items").select(MENU_SELECT);
    if (!includeArchived) query = query.eq("is_archived", false);
    const { data, error } = (await query
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name_ar", { ascending: true })
      .limit(500)) as DbResult;
    if (error) throw new RepositoryError("listMenuItems", error);
    return ((data ?? []) as Raw[]).map(mapMenuItem);
  }

  async getMenuItem(id: string): Promise<MenuItemRow | null> {
    const { data, error } = (await this.db.from("menu_items").select(MENU_SELECT).eq("id", id).maybeSingle()) as DbResult;
    if (error) throw new RepositoryError("getMenuItem", error);
    return data ? mapMenuItem(data as Raw) : null;
  }

  async createMenuItem(input: MenuItemInput): Promise<MenuItemRow> {
    const { data, error } = (await this.db.from("menu_items").insert(menuItemColumns(input)).select(MENU_SELECT).single()) as DbResult;
    if (error) throw new RepositoryError("createMenuItem", error);
    return mapMenuItem(data as Raw);
  }

  async updateMenuItem(id: string, patch: Partial<MenuItemInput> & { imagePath?: string | null }): Promise<MenuItemRow | null> {
    const { data, error } = (await this.db
      .from("menu_items")
      .update(menuItemColumns(patch))
      .eq("id", id)
      .select(MENU_SELECT)
      .maybeSingle()) as DbResult;
    if (error) throw new RepositoryError("updateMenuItem", error);
    return data ? mapMenuItem(data as Raw) : null;
  }

  async uploadMenuImage(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { error } = await this.db.storage.from(MENU_IMAGE_BUCKET).upload(path, bytes, {
      contentType,
      upsert: false,
      cacheControl: "31536000",
    });
    if (error) throw new RepositoryError("uploadMenuImage", { code: (error as { statusCode?: string }).statusCode });
  }

  async deleteMenuImage(path: string): Promise<void> {
    const { error } = await this.db.storage.from(MENU_IMAGE_BUCKET).remove([path]);
    if (error) throw new RepositoryError("deleteMenuImage", { code: (error as { statusCode?: string }).statusCode });
  }

  async getShopSettings(): Promise<ShopSettings> {
    const { data, error } = (await this.db.from("shop_settings").select(SETTINGS_SELECT).eq("id", 1).single()) as DbResult;
    if (error) throw new RepositoryError("getShopSettings", error);
    return mapShopSettings(data as Raw);
  }

  async updateShopSettings(patch: Partial<ShopSettings>): Promise<ShopSettings> {
    const { data, error } = (await this.db
      .from("shop_settings")
      .update(shopSettingsColumns(patch))
      .eq("id", 1)
      .select(SETTINGS_SELECT)
      .single()) as DbResult;
    if (error) throw new RepositoryError("updateShopSettings", error);
    return mapShopSettings(data as Raw);
  }

  async isShopOpen(timeZone: string): Promise<boolean> {
    return Boolean(await this.rpc("shop_is_open", { p_at: new Date().toISOString(), p_time_zone: timeZone }));
  }

  async placeOrder(p: PlaceOrderParams): Promise<OrderRpcResult> {
    const data = await this.rpc("place_order", {
      p_customer_id: p.customerId,
      p_items: p.items.map((i) => ({ menu_item_id: i.menuItemId, quantity: i.quantity, note: i.note })),
      p_fulfillment: p.fulfillment,
      p_phone: p.phone,
      p_car_description: p.carDescription,
      p_delivery_address: p.deliveryAddress,
      p_delivery_lat: p.deliveryLat,
      p_delivery_lng: p.deliveryLng,
      p_note: p.note,
      p_use_reward: p.useReward,
      p_idempotency_key: p.idempotencyKey,
      p_time_zone: p.timeZone,
    });
    return data as OrderRpcResult;
  }

  async setOrderStatus(actorId: string, orderId: string, status: OrderStatus, cancelReason: string | null): Promise<OrderRpcResult> {
    const data = await this.rpc("set_order_status", {
      p_actor_id: actorId,
      p_order_id: orderId,
      p_status: status,
      p_cancel_reason: cancelReason,
    });
    return data as OrderRpcResult;
  }

  async customerOrderAction(customerId: string, orderId: string, action: "cancel" | "arrived"): Promise<OrderRpcResult> {
    const data = await this.rpc("customer_order_action", { p_customer_id: customerId, p_order_id: orderId, p_action: action });
    return data as OrderRpcResult;
  }

  async listOrders(p: ListOrdersParams): Promise<Order[]> {
    const data = await this.rpc("list_orders", {
      p_customer_id: p.customerId ?? null,
      p_order_id: p.orderId ?? null,
      p_scope: p.scope,
      p_recent_minutes: p.recentMinutes ?? 120,
      p_limit: p.limit ?? 50,
    });
    return ((data ?? []) as Raw[]).map(mapOrder);
  }

  async registerPushDevice(userId: string, token: string): Promise<void> {
    const { error } = (await this.db
      .from("push_devices")
      .upsert({ token, user_id: userId, platform: "ios" }, { onConflict: "token" })) as DbResult;
    if (error) throw new RepositoryError("registerPushDevice", error);
  }

  async unregisterPushDevice(userId: string, token: string): Promise<void> {
    const { error } = (await this.db.from("push_devices").delete().eq("token", token).eq("user_id", userId)) as DbResult;
    if (error) throw new RepositoryError("unregisterPushDevice", error);
  }

  async pushTokensForOrder(orderId: string): Promise<string[]> {
    const { data, error } = (await this.db.from("orders").select("customer_id").eq("id", orderId).maybeSingle()) as DbResult;
    if (error) throw new RepositoryError("pushTokensForOrder:order", error);
    const customerId = (data as Raw | null)?.customer_id;
    if (typeof customerId !== "string") return [];
    const res = (await this.db.from("push_devices").select("token").eq("user_id", customerId).limit(20)) as DbResult;
    if (res.error) throw new RepositoryError("pushTokensForOrder", res.error);
    return ((res.data ?? []) as Raw[]).map((r) => String(r.token));
  }

  async deletePushToken(token: string): Promise<void> {
    const { error } = (await this.db.from("push_devices").delete().eq("token", token)) as DbResult;
    if (error) throw new RepositoryError("deletePushToken", error);
  }

  async deleteCustomerAccount(userId: string): Promise<DeleteAccountResult> {
    const result = (await this.rpc("delete_customer_account", { p_user_id: userId })) as { ok: boolean; code?: string };
    if (!result.ok) return { ok: false, code: deleteAccountCode(result.code) };
    // Free the email for a future sign-up and block sign-in for good. The
    // profile is already disabled, so the API refuses this user either way.
    const { error } = await this.db.auth.admin.updateUserById(userId, {
      email: `deleted-${userId}@deleted.invalid`,
      email_confirm: true,
      ban_duration: "876000h",
      user_metadata: { display_name: "deleted", name: null, full_name: null },
    });
    if (error) throw new RepositoryError("deleteCustomerAccount:auth", { code: (error as { code?: string }).code });
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
