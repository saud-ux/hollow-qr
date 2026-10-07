/**
 * Data-access boundary. The production implementation talks to Supabase
 * (PostgREST + RPC) with the service-role key; tests use a PGlite-backed
 * implementation that runs the very same SQL migrations.
 */
import type {
  Broadcast,
  FulfillmentType,
  MenuCategory,
  MenuOption,
  NotificationPrefs,
  Order,
  OrderHistoryFilter,
  OrderHistoryPage,
  OrderStatus,
  RatingOverview,
  SalesRange,
  SalesReport,
  ShopSettings,
} from "../../shared/ordering";
import type { AppRole, LoyaltyAction, MembershipStatus, PlaceKind, SavedPlace } from "../../shared/types";

export interface ProfileRow {
  id: string;
  displayName: string;
  email: string;
  role: AppRole;
  emailConfirmedAt: string | null;
  disabledAt: string | null;
  createdAt: string;
}

export interface AccountRow {
  id: string;
  userId: string;
  memberId: string;
  stampCount: number;
  rewardAvailable: boolean;
  membershipStatus: MembershipStatus;
  passSerial: string;
  qrTokenId: string;
  walletUpdatedAt: string;
  lastMutationAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  displayName: string;
  email: string;
}

export interface ApplyActionParams {
  actorId: string;
  accountId: string;
  action: LoyaltyAction;
  quantity?: number | null;
  targetStampCount?: number | null;
  idempotencyKey?: string | null;
  confirmRecent?: boolean;
  recentWindowSeconds: number;
  source?: string;
}

/** Raw jsonb result of public.apply_loyalty_action(). */
export interface ApplyActionResult {
  ok: boolean;
  code?: string;
  replayed?: boolean;
  transaction_id?: string;
  action?: LoyaltyAction;
  previous_stamp_count?: number;
  new_stamp_count?: number;
  new_reward_available?: boolean;
  remaining?: number;
  current?: number;
  seconds_ago?: number;
  last_action?: LoyaltyAction | null;
  last_quantity?: number | null;
  account?: { id: string; pass_serial: string; stamp_count: number; reward_available: boolean; membership_status: MembershipStatus };
}

export interface TransactionRow {
  id: string;
  seq: number;
  loyaltyAccountId: string;
  memberId: string;
  customerName: string;
  customerEmail: string;
  actorUserId: string;
  actorName: string;
  actorRole: AppRole;
  action: LoyaltyAction;
  quantity: number;
  delta: number;
  previousStampCount: number;
  newStampCount: number;
  previousRewardAvailable: boolean;
  newRewardAvailable: boolean;
  previousMembershipStatus: MembershipStatus;
  newMembershipStatus: MembershipStatus;
  reversalOf: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
  createdAt: string;
}

export interface SearchRow {
  accountId: string;
  memberId: string;
  displayName: string;
  email: string;
  stampCount: number;
  rewardAvailable: boolean;
  membershipStatus: MembershipStatus;
  lastMutationAt: string | null;
  createdAt: string;
}

export interface DashboardStatsRow {
  total_customers: number;
  active_customers: number;
  cancelled_customers: number;
  new_today: number;
  new_this_week: number;
  cups_added_today: number;
  rewards_available: number;
  rewards_redeemed_today: number;
  rewards_redeemed_total: number;
  time_zone: string;
}

export interface PushTarget {
  deviceLibraryIdentifier: string;
  pushToken: string;
}

export interface CreateStaffParams {
  displayName: string;
  email: string;
  password: string;
}

export type CreateStaffResult = { ok: true; userId: string } | { ok: false; code: "EMAIL_EXISTS" | "WEAK_PASSWORD" };
export type RemoveStaffResult = { ok: true } | { ok: false; code: "NOT_FOUND" | "NOT_STAFF" | "ALREADY_REMOVED" };
export type DeleteAccountResult = { ok: true } | { ok: false; code: "NOT_FOUND" | "NOT_A_CUSTOMER" | "ACTIVE_ORDER" };

export interface PlaceInput {
  kind: PlaceKind;
  label: string | null;
  address: string;
  details: string | null;
  lat: number;
  lng: number;
}
export type SavePlaceResult = { ok: true; place: SavedPlace } | { ok: false; code: "NOT_FOUND" | "KIND_TAKEN" | "PLACES_LIMIT" };

export function savePlaceResult(raw: unknown): SavePlaceResult {
  const r = raw as { ok: boolean; code?: string; place?: SavedPlace };
  if (r.ok && r.place) return { ok: true, place: r.place };
  return { ok: false, code: r.code === "KIND_TAKEN" || r.code === "PLACES_LIMIT" ? r.code : "NOT_FOUND" };
}

export function deleteAccountCode(code: string | undefined): "NOT_FOUND" | "NOT_A_CUSTOMER" | "ACTIVE_ORDER" {
  return code === "NOT_A_CUSTOMER" || code === "ACTIVE_ORDER" ? code : "NOT_FOUND";
}

export interface MenuItemRow {
  id: string;
  nameAr: string;
  nameEn: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  category: MenuCategory;
  priceHalalas: number;
  imagePath: string | null;
  isAvailable: boolean;
  isArchived: boolean;
  sortOrder: number;
  optionLabel: string | null;
  optionLabelEn: string | null;
  options: MenuOption[];
  calories: number | null;
  /** Marked by the owner; shown at the top of the menu. */
  isBestSeller: boolean;
  /** How many are left, taken by each order; null when the item isn't counted. */
  stockQuantity: number | null;
}

/** What the admin menu editor sends; the stock count is set on its own. */
export type MenuItemInput = Omit<MenuItemRow, "id" | "imagePath" | "stockQuantity">;

export interface PlaceOrderParams {
  customerId: string;
  items: { menuItemId: string; quantity: number; note: string | null; optionId: string | null }[];
  fulfillment: FulfillmentType;
  phone: string;
  carDescription: string | null;
  deliveryAddress: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  note: string | null;
  useReward: boolean;
  idempotencyKey: string;
  timeZone: string;
}

/** Raw jsonb results of the ordering SQL functions. */
export interface OrderRpcResult {
  ok: boolean;
  code?: string;
  replayed?: boolean;
  order_id?: string;
  status?: OrderStatus;
  current?: OrderStatus;
  minimum?: number;
  menu_item_id?: string;
  /** NOT_ENOUGH_STOCK: how many of the item are left. */
  remaining?: number;
  loyalty_changed?: boolean;
  pass_serial?: string | null;
}

export type PushLang = "ar" | "en";

export type StaffAlertKind = "new_orders" | "daily_summary";

export type RateOrderResult = "ok" | "NOT_FOUND" | "NOT_COMPLETED" | "ALREADY_RATED";

export interface OrderSummary {
  completed: number;
  cancelled: number;
  open: number;
  revenueHalalas: number;
  topItem: { nameAr: string; quantity: number } | null;
}

export interface ListOrdersParams {
  customerId?: string | null;
  orderId?: string | null;
  scope: "active" | "all";
  recentMinutes?: number;
  limit?: number;
}

export interface OrderHistoryParams {
  /** Created in [from, to); null = no bound. */
  from: Date | null;
  to: Date | null;
  status: OrderHistoryFilter;
  /** Order number, customer name, phone or member ID. */
  search: string | null;
  limit: number;
  offset: number;
}

export interface Repository {
  getProfile(userId: string): Promise<ProfileRow | null>;
  ensureLoyaltyAccount(userId: string): Promise<void>;
  getAccountByUserId(userId: string): Promise<AccountRow | null>;
  getAccountById(accountId: string): Promise<AccountRow | null>;
  getAccountByMemberId(memberId: string): Promise<AccountRow | null>;
  getAccountByQrTokenId(qrTokenId: string): Promise<AccountRow | null>;
  getAccountBySerial(passSerial: string): Promise<AccountRow | null>;

  applyLoyaltyAction(params: ApplyActionParams): Promise<ApplyActionResult>;

  searchCustomers(query: string, limit: number, offset: number, includeEmail: boolean): Promise<{ rows: SearchRow[]; total: number }>;
  listTransactions(accountId: string | null, limit: number, offset: number): Promise<{ rows: TransactionRow[]; total: number }>;
  getDashboardStats(timeZone: string): Promise<DashboardStatsRow>;

  listStaff(): Promise<ProfileRow[]>;
  createStaffUser(params: CreateStaffParams): Promise<CreateStaffResult>;
  removeStaffUser(userId: string): Promise<RemoveStaffResult>;

  listMenuItems(includeArchived: boolean): Promise<MenuItemRow[]>;
  getMenuItem(id: string): Promise<MenuItemRow | null>;
  createMenuItem(input: MenuItemInput): Promise<MenuItemRow>;
  updateMenuItem(id: string, patch: Partial<MenuItemInput> & { imagePath?: string | null; stockQuantity?: number | null }): Promise<MenuItemRow | null>;
  /** Stores an image in the public menu bucket. */
  uploadMenuImage(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  deleteMenuImage(path: string): Promise<void>;

  getShopSettings(): Promise<ShopSettings>;
  updateShopSettings(patch: Partial<ShopSettings>): Promise<ShopSettings>;
  isShopOpen(timeZone: string): Promise<boolean>;

  placeOrder(params: PlaceOrderParams): Promise<OrderRpcResult>;
  setOrderStatus(actorId: string, orderId: string, status: OrderStatus, cancelReason: string | null): Promise<OrderRpcResult>;
  customerOrderAction(customerId: string, orderId: string, action: "cancel" | "arrived"): Promise<OrderRpcResult>;
  listOrders(params: ListOrdersParams): Promise<Order[]>;
  /** Admin history: every order in a period, one page at a time. */
  orderHistory(params: OrderHistoryParams): Promise<Omit<OrderHistoryPage, "page" | "pageSize">>;

  /** iOS app push tokens. A token moves to whoever signed in last on that device. */
  registerPushDevice(userId: string, token: string, lang: PushLang): Promise<void>;
  unregisterPushDevice(userId: string, token: string): Promise<void>;
  /** The order customer's devices, each with the language its app is in. */
  pushTokensForOrder(orderId: string): Promise<{ token: string; lang: PushLang }[]>;
  deletePushToken(token: string): Promise<void>;
  /** Lock-screen order trackers (iOS Live Activities), one push token each. */
  saveLiveActivity(orderId: string, token: string, lang: PushLang): Promise<void>;
  liveActivitiesForOrder(orderId: string): Promise<{ token: string; lang: PushLang }[]>;
  /** Drops one token, or every token of an order when `token` is omitted. */
  deleteLiveActivities(orderId: string, token?: string): Promise<void>;
  /** Devices of staff/admins who want new-order alerts, or of admins who want the daily summary. */
  staffPushTokens(kind: StaffAlertKind): Promise<string[]>;
  /** Devices that opted in to offers, in token order (`after` is the last token of the previous batch). */
  offerPushTokens(after: string | null, limit: number): Promise<string[]>;
  offerPushCount(): Promise<number>;

  getNotificationPrefs(userId: string): Promise<NotificationPrefs>;
  setNotificationPrefs(userId: string, patch: Partial<NotificationPrefs>): Promise<NotificationPrefs>;

  createBroadcast(input: { title: string; body: string; sentBy: string; recipients: number }): Promise<Broadcast>;
  getBroadcast(id: string): Promise<Broadcast | null>;
  setBroadcastSent(id: string, sent: number): Promise<void>;
  listBroadcasts(limit: number): Promise<Broadcast[]>;

  rateOrder(customerId: string, orderId: string, rating: number, comment: string | null): Promise<RateOrderResult>;
  ratingOverview(limit: number): Promise<RatingOverview>;

  /** Completed orders in [from, to) against [prevFrom, prevTo), grouped on the wall clock of `timeZone`. */
  salesReport(range: SalesRange, from: Date, to: Date, prevFrom: Date, prevTo: Date, timeZone: string): Promise<SalesReport>;

  /** Orders created in [from, to), for the end-of-day summary. */
  orderSummary(from: Date, to: Date): Promise<OrderSummary>;
  /** True the first time it is called for a business day (YYYY-MM-DD). */
  claimDailySummary(businessDate: string): Promise<boolean>;

  /**
   * App Store account deletion: anonymizes the customer's data
   * (delete_customer_account), then frees the email and blocks sign-in.
   */
  deleteCustomerAccount(userId: string): Promise<DeleteAccountResult>;

  /** The customer's saved delivery places: home, work, then named ones. */
  listPlaces(userId: string): Promise<SavedPlace[]>;
  /** Adds (id null) or edits a place; a new home or work replaces the old one. */
  savePlace(userId: string, id: string | null, input: PlaceInput): Promise<SavePlaceResult>;
  deletePlace(userId: string, id: string): Promise<boolean>;
  /** Renames the user; returns their pass serial (to refresh Wallet) or null, or false if not found. */
  setDisplayName(userId: string, name: string): Promise<{ passSerial: string | null } | false>;

  walletRegisterDevice(device: string, pushToken: string, passTypeIdentifier: string, serial: string): Promise<"created" | "exists" | "unknown_pass">;
  walletUnregisterDevice(device: string, passTypeIdentifier: string, serial: string): Promise<void>;
  walletUpdatedSerials(device: string, passTypeIdentifier: string, sinceMicros: bigint | null): Promise<{ serial: string; tag: bigint }[]>;
  walletPushTargets(serial: string): Promise<PushTarget[]>;
  walletDeleteDevice(device: string): Promise<void>;
  walletDeviceCount(serial: string): Promise<number>;
}
