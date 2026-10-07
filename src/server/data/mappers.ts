/** Row mappers shared by every Repository implementation (snake_case -> camelCase). */
import type {
  Broadcast,
  DayHours,
  LoyaltyResult,
  MenuOption,
  NotificationPrefs,
  Order,
  OrderLine,
  RatingOverview,
  ShopSettings,
} from "../../shared/ordering";
import type { AccountRow, MenuItemRow, OrderSummary, ProfileRow, RateOrderResult, SearchRow, TransactionRow } from "./repository";

type Raw = Record<string, unknown>;

function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  return v === null || v === undefined ? "" : JSON.stringify(v);
}
const str = (v: unknown): string => asText(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : asText(v));
const num = (v: unknown): number => Number(v ?? 0);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : str(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

export function mapProfile(r: Raw): ProfileRow {
  return {
    id: str(r.id),
    displayName: str(r.display_name),
    email: str(r.email),
    role: str(r.role) as ProfileRow["role"],
    emailConfirmedAt: isoOrNull(r.email_confirmed_at),
    disabledAt: isoOrNull(r.disabled_at),
    createdAt: iso(r.created_at),
  };
}

/** Accepts a loyalty_accounts row with either flattened or embedded profile columns. */
export function mapAccount(r: Raw): AccountRow {
  const profile = (r.profiles ?? {}) as Raw;
  return {
    id: str(r.id),
    userId: str(r.user_id),
    memberId: str(r.member_id),
    stampCount: num(r.stamp_count),
    rewardAvailable: Boolean(r.reward_available),
    membershipStatus: str(r.membership_status) as AccountRow["membershipStatus"],
    passSerial: str(r.pass_serial),
    qrTokenId: str(r.qr_token_id),
    walletUpdatedAt: iso(r.wallet_updated_at),
    lastMutationAt: isoOrNull(r.last_mutation_at),
    cancelledAt: isoOrNull(r.cancelled_at),
    createdAt: iso(r.created_at),
    displayName: str(r.display_name ?? profile.display_name),
    email: str(r.email ?? profile.email),
  };
}

export function mapSearchRow(r: Raw): SearchRow {
  return {
    accountId: str(r.account_id),
    memberId: str(r.member_id),
    displayName: str(r.display_name),
    email: str(r.email),
    stampCount: num(r.stamp_count),
    rewardAvailable: Boolean(r.reward_available),
    membershipStatus: str(r.membership_status) as SearchRow["membershipStatus"],
    lastMutationAt: isoOrNull(r.last_mutation_at),
    createdAt: iso(r.created_at),
  };
}

export function mapTransaction(r: Raw): TransactionRow {
  return {
    id: str(r.id),
    seq: num(r.seq),
    loyaltyAccountId: str(r.loyalty_account_id),
    memberId: str(r.member_id),
    customerName: str(r.customer_name),
    customerEmail: str(r.customer_email),
    actorUserId: str(r.actor_user_id),
    actorName: str(r.actor_name),
    actorRole: str(r.actor_role) as TransactionRow["actorRole"],
    action: str(r.action) as TransactionRow["action"],
    quantity: num(r.quantity),
    delta: num(r.delta),
    previousStampCount: num(r.previous_stamp_count),
    newStampCount: num(r.new_stamp_count),
    previousRewardAvailable: Boolean(r.previous_reward_available),
    newRewardAvailable: Boolean(r.new_reward_available),
    previousMembershipStatus: str(r.previous_membership_status) as TransactionRow["previousMembershipStatus"],
    newMembershipStatus: str(r.new_membership_status) as TransactionRow["newMembershipStatus"],
    reversalOf: strOrNull(r.reversal_of),
    reversedBy: strOrNull(r.reversed_by),
    reversedAt: isoOrNull(r.reversed_at),
    createdAt: iso(r.created_at),
  };
}

export function totalFrom(rows: Raw[]): number {
  return rows.length > 0 ? num(rows[0]!.total_count) : 0;
}

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function mapOptions(v: unknown): MenuOption[] {
  const list = Array.isArray(v) ? (v as Raw[]) : (JSON.parse(str(v) || "[]") as Raw[]);
  return list.map((o) => ({
    id: str(o.id),
    nameAr: str(o.name_ar),
    nameEn: strOrNull(o.name_en),
    noteAr: strOrNull(o.note_ar),
    noteEn: strOrNull(o.note_en),
    isAvailable: o.is_available === undefined ? true : Boolean(o.is_available),
  }));
}

export function optionsColumn(options: MenuOption[]): Raw[] {
  return options.map((o) => ({
    id: o.id,
    name_ar: o.nameAr,
    name_en: o.nameEn,
    note_ar: o.noteAr,
    note_en: o.noteEn,
    is_available: o.isAvailable,
  }));
}

export function mapMenuItem(r: Raw): MenuItemRow {
  return {
    id: str(r.id),
    nameAr: str(r.name_ar),
    nameEn: strOrNull(r.name_en),
    descriptionAr: strOrNull(r.description_ar),
    descriptionEn: strOrNull(r.description_en),
    category: str(r.category) as MenuItemRow["category"],
    priceHalalas: num(r.price_halalas),
    imagePath: strOrNull(r.image_path),
    isAvailable: Boolean(r.is_available),
    isArchived: Boolean(r.is_archived),
    sortOrder: num(r.sort_order),
    optionLabel: strOrNull(r.option_label),
    optionLabelEn: strOrNull(r.option_label_en),
    options: mapOptions(r.options),
    calories: numOrNull(r.calories),
  };
}

/** camelCase patch -> snake_case columns (only the keys present). */
export function menuItemColumns(patch: Partial<MenuItemRow>): Raw {
  const out: Raw = {};
  if (patch.nameAr !== undefined) out.name_ar = patch.nameAr;
  if (patch.nameEn !== undefined) out.name_en = patch.nameEn;
  if (patch.descriptionAr !== undefined) out.description_ar = patch.descriptionAr;
  if (patch.descriptionEn !== undefined) out.description_en = patch.descriptionEn;
  if (patch.category !== undefined) out.category = patch.category;
  if (patch.priceHalalas !== undefined) out.price_halalas = patch.priceHalalas;
  if (patch.imagePath !== undefined) out.image_path = patch.imagePath;
  if (patch.isAvailable !== undefined) out.is_available = patch.isAvailable;
  if (patch.isArchived !== undefined) out.is_archived = patch.isArchived;
  if (patch.sortOrder !== undefined) out.sort_order = patch.sortOrder;
  if (patch.optionLabel !== undefined) out.option_label = patch.optionLabel;
  if (patch.optionLabelEn !== undefined) out.option_label_en = patch.optionLabelEn;
  if (patch.options !== undefined) out.options = optionsColumn(patch.options);
  if (patch.calories !== undefined) out.calories = patch.calories;
  return out;
}

function mapHours(v: unknown): DayHours[] {
  const list = Array.isArray(v) ? (v as Raw[]) : (JSON.parse(str(v) || "[]") as Raw[]);
  return list.map((d) => ({ closed: Boolean(d.closed), open: str(d.open), close: str(d.close) }));
}

export function mapShopSettings(r: Raw): ShopSettings {
  return {
    orderingPaused: Boolean(r.ordering_paused),
    pickupEnabled: Boolean(r.pickup_enabled),
    curbsideEnabled: Boolean(r.curbside_enabled),
    deliveryEnabled: Boolean(r.delivery_enabled),
    deliveryFeeHalalas: num(r.delivery_fee_halalas),
    deliveryMinOrderHalalas: num(r.delivery_min_order_halalas),
    weeklyHours: mapHours(r.weekly_hours),
  };
}

export function shopSettingsColumns(patch: Partial<ShopSettings>): Raw {
  const out: Raw = {};
  if (patch.orderingPaused !== undefined) out.ordering_paused = patch.orderingPaused;
  if (patch.pickupEnabled !== undefined) out.pickup_enabled = patch.pickupEnabled;
  if (patch.curbsideEnabled !== undefined) out.curbside_enabled = patch.curbsideEnabled;
  if (patch.deliveryEnabled !== undefined) out.delivery_enabled = patch.deliveryEnabled;
  if (patch.deliveryFeeHalalas !== undefined) out.delivery_fee_halalas = patch.deliveryFeeHalalas;
  if (patch.deliveryMinOrderHalalas !== undefined) out.delivery_min_order_halalas = patch.deliveryMinOrderHalalas;
  if (patch.weeklyHours !== undefined) out.weekly_hours = patch.weeklyHours;
  return out;
}

function mapOrderLine(r: Raw): OrderLine {
  return {
    menuItemId: str(r.menu_item_id),
    nameAr: str(r.name_ar),
    category: str(r.category) as OrderLine["category"],
    unitPriceHalalas: num(r.unit_price_halalas),
    quantity: num(r.quantity),
    note: strOrNull(r.note),
    optionId: strOrNull(r.option_id),
    optionNameAr: strOrNull(r.option_name_ar),
  };
}

function mapLoyaltyResult(v: unknown): LoyaltyResult | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Raw;
  return {
    redeem: strOrNull(r.redeem),
    cupsAdded: num(r.cups_added),
    cupsNotAdded: num(r.cups_not_added),
    skipped: Boolean(r.skipped),
  };
}

/** Maps one element of list_orders() (jsonb) to the API shape. */
export function mapOrder(r: Raw): Order {
  return {
    id: str(r.id),
    orderNumber: num(r.order_number),
    customerName: str(r.customer_name),
    customerPhone: str(r.customer_phone),
    memberId: strOrNull(r.member_id),
    fulfillment: str(r.fulfillment) as Order["fulfillment"],
    carDescription: strOrNull(r.car_description),
    deliveryAddress: strOrNull(r.delivery_address),
    deliveryLat: numOrNull(r.delivery_lat),
    deliveryLng: numOrNull(r.delivery_lng),
    note: strOrNull(r.note),
    subtotalHalalas: num(r.subtotal_halalas),
    deliveryFeeHalalas: num(r.delivery_fee_halalas),
    discountHalalas: num(r.discount_halalas),
    totalHalalas: num(r.total_halalas),
    paymentMethod: "on_pickup",
    useReward: Boolean(r.use_reward),
    status: str(r.status) as Order["status"],
    cancelReason: strOrNull(r.cancel_reason),
    cancelledBy: strOrNull(r.cancelled_by) as Order["cancelledBy"],
    customerArrivedAt: isoOrNull(r.customer_arrived_at),
    acceptedAt: isoOrNull(r.accepted_at),
    readyAt: isoOrNull(r.ready_at),
    outForDeliveryAt: isoOrNull(r.out_for_delivery_at),
    completedAt: isoOrNull(r.completed_at),
    cancelledAt: isoOrNull(r.cancelled_at),
    loyaltyResult: mapLoyaltyResult(r.loyalty_result),
    createdAt: iso(r.created_at),
    items: (Array.isArray(r.items) ? (r.items as Raw[]) : []).map(mapOrderLine),
    rating: numOrNull(r.rating),
    ratingComment: strOrNull(r.rating_comment),
    ratedAt: isoOrNull(r.rated_at),
  };
}

export function mapBroadcast(r: Raw): Broadcast {
  return {
    id: str(r.id),
    title: str(r.title),
    body: str(r.body),
    recipients: num(r.recipients),
    sent: num(r.sent),
    createdAt: iso(r.created_at),
  };
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { offers: false, newOrders: true, dailySummary: true };

export function mapNotificationPrefs(r: Raw | null | undefined): NotificationPrefs {
  if (!r) return { ...DEFAULT_NOTIFICATION_PREFS };
  return { offers: Boolean(r.offers), newOrders: Boolean(r.new_orders), dailySummary: Boolean(r.daily_summary) };
}

export function notificationPrefsColumns(patch: Partial<NotificationPrefs>): Raw {
  const out: Raw = {};
  if (patch.offers !== undefined) out.offers = patch.offers;
  if (patch.newOrders !== undefined) out.new_orders = patch.newOrders;
  if (patch.dailySummary !== undefined) out.daily_summary = patch.dailySummary;
  return out;
}

export function mapRatingOverview(r: Raw): RatingOverview {
  return {
    count: num(r.count),
    average: numOrNull(r.average),
    items: (Array.isArray(r.items) ? (r.items as Raw[]) : []).map((i) => ({
      orderNumber: num(i.order_number),
      customerName: str(i.customer_name),
      rating: num(i.rating),
      comment: strOrNull(i.rating_comment),
      ratedAt: iso(i.rated_at),
    })),
  };
}

export function mapOrderSummary(r: Raw): OrderSummary {
  const top = r.top_item as Raw | null | undefined;
  return {
    completed: num(r.completed),
    cancelled: num(r.cancelled),
    open: num(r.open),
    revenueHalalas: num(r.revenue_halalas),
    topItem: top ? { nameAr: str(top.name_ar), quantity: num(top.quantity) } : null,
  };
}

export const RATE_ORDER_CODES = ["NOT_FOUND", "NOT_COMPLETED", "ALREADY_RATED"] as const;

export function rateOrderResult(r: { ok: boolean; code?: string }): RateOrderResult {
  if (r.ok) return "ok";
  return (RATE_ORDER_CODES as readonly string[]).includes(r.code ?? "") ? (r.code as RateOrderResult) : "NOT_FOUND";
}
