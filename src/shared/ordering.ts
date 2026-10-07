/** Online ordering contracts and helpers shared by the Worker and the web app. */

export type MenuCategory = "drink" | "dessert";
export type OrderStatus = "new" | "preparing" | "ready" | "out_for_delivery" | "completed" | "cancelled";
export type FulfillmentType = "pickup" | "curbside" | "delivery";

export const MENU_IMAGE_BUCKET = "menu-images";
export const MENU_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_ORDER_LINES = 30;
export const MAX_LINE_QUANTITY = 20;

/** One choice on an item, e.g. a coffee origin. Same price as the item. */
export interface MenuOption {
  id: string;
  nameAr: string;
  /** English name; the Arabic one is shown when empty. */
  nameEn: string | null;
  /** Short tasting note shown under the name. */
  noteAr: string | null;
  noteEn: string | null;
  isAvailable: boolean;
}

export interface MenuItem {
  id: string;
  nameAr: string;
  nameEn: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  category: MenuCategory;
  priceHalalas: number;
  imageUrl: string | null;
  isAvailable: boolean;
  isArchived: boolean;
  sortOrder: number;
  /** Heading for the choice, e.g. "المحصول" / "origin". */
  optionLabel: string | null;
  optionLabelEn: string | null;
  /** Empty when the item has no choice. */
  options: MenuOption[];
  /** Kcal per serving, shown on the menu. */
  calories: number | null;
  /** Picked by the owner: listed under «الأفضل مبيعًا» and badged in its category. */
  isBestSeller: boolean;
  /**
   * How many are left (null: not counted). Staff and admins get the exact
   * count; customers only when LOW_STOCK or fewer are left.
   */
  stockQuantity: number | null;
}

/** At or below this many left, customers see «باقي 2 فقط». */
export const LOW_STOCK = 3;
export const MAX_STOCK = 9999;

export const MAX_MENU_OPTIONS = 12;

/** The customer can order it: the item is on, and if it has options at least one is in stock. */
export function isOrderable(item: Pick<MenuItem, "isAvailable" | "options" | "stockQuantity">): boolean {
  return item.isAvailable && item.stockQuantity !== 0 && (item.options.length === 0 || item.options.some((o) => o.isAvailable));
}

export interface DayHours {
  closed: boolean;
  /** "HH:MM" (24h, Asia/Riyadh). A close time <= open time runs past midnight. */
  open: string;
  close: string;
}

export interface ShopSettings {
  orderingPaused: boolean;
  pickupEnabled: boolean;
  curbsideEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryFeeHalalas: number;
  deliveryMinOrderHalalas: number;
  /** Seven entries, index 0 = Sunday. */
  weeklyHours: DayHours[];
}

export interface MenuResponse {
  items: MenuItem[];
  shop: { isOpen: boolean; settings: ShopSettings };
}

export interface OrderLine {
  menuItemId: string;
  nameAr: string;
  category: MenuCategory;
  unitPriceHalalas: number;
  quantity: number;
  note: string | null;
  /** The chosen option, e.g. "إثيوبي". */
  optionId: string | null;
  optionNameAr: string | null;
}

export interface LoyaltyResult {
  redeem: string | null;
  cupsAdded: number;
  cupsNotAdded: number;
  skipped: boolean;
}

export interface Order {
  id: string;
  orderNumber: number;
  customerName: string;
  customerPhone: string;
  memberId: string | null;
  fulfillment: FulfillmentType;
  carDescription: string | null;
  deliveryAddress: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  note: string | null;
  subtotalHalalas: number;
  deliveryFeeHalalas: number;
  discountHalalas: number;
  totalHalalas: number;
  paymentMethod: "on_pickup";
  useReward: boolean;
  status: OrderStatus;
  cancelReason: string | null;
  cancelledBy: "customer" | "staff" | null;
  customerArrivedAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  outForDeliveryAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  loyaltyResult: LoyaltyResult | null;
  createdAt: string;
  items: OrderLine[];
  /** 1–5 stars, set by the customer once the order is completed. */
  rating: number | null;
  ratingComment: string | null;
  ratedAt: string | null;
}

export const MAX_RATING_COMMENT = 300;

export interface RatingOverview {
  count: number;
  average: number | null;
  items: { orderNumber: number; customerName: string; rating: number; comment: string | null; ratedAt: string }[];
}

/**
 * The steps the customer sees, in order (cancelled is outside the flow).
 * Delivery has no "ready" step of its own: the customer goes from preparing
 * straight to out for delivery.
 */
export function orderFlow(fulfillment: FulfillmentType): OrderStatus[] {
  return fulfillment === "delivery" ? ["new", "preparing", "out_for_delivery", "completed"] : ["new", "preparing", "ready", "completed"];
}

/** Where an order is in its customer flow; -1 when cancelled. A delivery waiting for the driver still shows as preparing. */
export function flowStep(order: Pick<Order, "status" | "fulfillment">): number {
  const status = order.fulfillment === "delivery" && order.status === "ready" ? "preparing" : order.status;
  return orderFlow(order.fulfillment).indexOf(status);
}

/** A status in the customer's words (staff screens use STATUS_LABELS_*). */
export function customerStatusLabel(order: Pick<Order, "status" | "fulfillment">, lang: "ar" | "en"): string {
  const en = lang === "en";
  switch (order.status) {
    case "new":
      return en ? "Order received" : "استلمنا طلبك";
    case "preparing":
      return en ? "Preparing" : "قيد التحضير";
    case "ready":
      if (order.fulfillment === "delivery") return en ? "Preparing" : "قيد التحضير";
      if (order.fulfillment === "curbside") return en ? "Ready, we'll bring it out" : "جاهز، نطلعه لك";
      return en ? "Ready for pickup" : "جاهز للاستلام";
    case "out_for_delivery":
      return en ? "Out for delivery" : "خرج للتوصيل";
    case "completed":
      return order.fulfillment === "delivery" ? (en ? "Delivered" : "تم التوصيل") : en ? "Picked up" : "تم الاستلام";
    case "cancelled":
      return en ? "Cancelled" : "ملغي";
  }
}

/** What the iOS home-screen widget shows; the widget refreshes it with its own token. */
export interface WidgetData {
  card: { name: string; stamps: number; max: number; reward: boolean; active: boolean; qr: string } | null;
  /** The customer's newest order still in progress. */
  order: { id: string; number: number; status: OrderStatus; fulfillment: FulfillmentType } | null;
}

export type SalesRange = "today" | "7d" | "30d";

/** Admin order history: which orders to list. "ended" = completed or cancelled. */
export type OrderHistoryFilter = "all" | "active" | "ended" | "completed" | "cancelled";

/** An order as the admin sees it in the history, with who handed it over. */
export interface AdminOrder extends Order {
  /** The customer's loyalty account, for the link to their page (null if deleted). */
  accountId: string | null;
  /** Staff member who marked it delivered. */
  completedByName: string | null;
}

export interface OrderHistoryPage {
  items: AdminOrder[];
  /** Orders matching the filter (all pages). */
  total: number;
  page: number;
  pageSize: number;
  /** Per state, for the period and search (ignoring the state filter). */
  counts: { all: number; active: number; completed: number; cancelled: number };
  /** Sales of the completed orders in the filter. */
  revenueHalalas: number;
}

/** Admin sales dashboard: completed orders in the range, and the same span just before it. */
export interface SalesReport {
  range: SalesRange;
  orders: number;
  revenueHalalas: number;
  cancelled: number;
  previous: { orders: number; revenueHalalas: number };
  /** One entry per day of the range (shop time), oldest first. */
  days: { date: string; orders: number; revenueHalalas: number }[];
  /** Orders per weekday (0 = Sunday) and hour (shop time); empty slots are left out. */
  hours: { weekday: number; hour: number; orders: number }[];
  topItems: { nameAr: string; optionNameAr: string | null; quantity: number; revenueHalalas: number }[];
}

/** Per-user push switches. Offers are opt-in; the staff ones only apply to staff/admin. */
export interface NotificationPrefs {
  offers: boolean;
  newOrders: boolean;
  dailySummary: boolean;
}

export interface Broadcast {
  id: string;
  title: string;
  body: string;
  recipients: number;
  sent: number;
  createdAt: string;
}

export const BROADCAST_TITLE_MAX = 40;
export const BROADCAST_BODY_MAX = 180;

export interface PlaceOrderRequest {
  items: { menuItemId: string; quantity: number; note?: string; optionId?: string }[];
  fulfillment: FulfillmentType;
  phone: string;
  carDescription?: string;
  deliveryAddress?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  note?: string;
  useReward?: boolean;
  idempotencyKey: string;
}

export const ACTIVE_STATUSES: readonly OrderStatus[] = ["new", "preparing", "ready", "out_for_delivery"];

export function isActiveStatus(status: OrderStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/** The next step staff take from a status, or null when the order is closed. */
export function nextStatus(order: Pick<Order, "status" | "fulfillment">): OrderStatus | null {
  switch (order.status) {
    case "new":
      return "preparing";
    case "preparing":
      return "ready";
    case "ready":
      return order.fulfillment === "delivery" ? "out_for_delivery" : "completed";
    case "out_for_delivery":
      return "completed";
    default:
      return null;
  }
}

export const STATUS_LABELS_AR: Record<OrderStatus, string> = {
  new: "طلب جديد",
  preparing: "قيد التحضير",
  ready: "جاهز",
  out_for_delivery: "في الطريق إليك",
  completed: "تم التسليم",
  cancelled: "ملغي",
};

export const FULFILLMENT_LABELS_AR: Record<FulfillmentType, string> = {
  pickup: "استلام من الكاشير",
  curbside: "استلام من السيارة",
  delivery: "توصيل",
};

export const CATEGORY_LABELS_AR: Record<MenuCategory, string> = {
  drink: "المشروبات",
  dessert: "الحلويات",
};

export const STATUS_LABELS_EN: Record<OrderStatus, string> = {
  new: "New order",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "On its way",
  completed: "Delivered",
  cancelled: "Cancelled",
};

export const FULFILLMENT_LABELS_EN: Record<FulfillmentType, string> = {
  pickup: "Pick up at the counter",
  curbside: "Curbside pickup",
  delivery: "Delivery",
};

export const CATEGORY_LABELS_EN: Record<MenuCategory, string> = {
  drink: "Drinks",
  dessert: "Desserts",
};

export const WEEKDAY_LABELS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const WEEKDAY_LABELS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** 1500 -> "15", 1550 -> "15.50" (Western digits, like the rest of the app). */
export function formatSar(halalas: number): string {
  const riyals = halalas / 100;
  return Number.isInteger(riyals) ? String(riyals) : riyals.toFixed(2);
}

/** Converts Arabic-Indic (٠-٩) and Persian (۰-۹) digits to Latin digits. */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
}

/**
 * Normalizes Saudi mobile numbers to "05XXXXXXXX".
 * Accepts Arabic-Indic digits, spaces, dashes, "+966", "00966" and "966".
 */
export function normalizeSaudiPhone(input: string): string | null {
  let digits = toLatinDigits(input).replace(/[\s\-()‎‏]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00966")) digits = digits.slice(5);
  else if (digits.startsWith("966")) digits = digits.slice(3);
  if (/^5\d{8}$/.test(digits)) digits = `0${digits}`;
  return /^05\d{8}$/.test(digits) ? digits : null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidHhMm(value: string): boolean {
  return HHMM.test(value);
}
