/**
 * Loyverse POS: a completed app order becomes a sale receipt in Loyverse, so
 * the shop's sales reports and the card terminal's settlement line up without
 * anyone typing the order into the till.
 *
 * Only the access token is required. The store, the payment type ("تطبيق")
 * and the fallback item ("طلب تطبيق") are found by name in Loyverse.
 */
import { MENU_CATEGORIES, type Order } from "../../shared/ordering";
import type { Logger } from "../lib/logger";
import type { Bindings } from "../platform";

const API = "https://api.loyverse.com/v1.0";
export const DEFAULT_PAYMENT_TYPE_NAME = "تطبيق";
export const DEFAULT_FALLBACK_ITEM_NAME = "طلب تطبيق";
const CATALOG_TTL_MS = 5 * 60 * 1000;
const MAX_PAGES = 20;

export interface LoyverseSettings {
  token: string;
  storeId: string | null;
  paymentTypeName: string;
  /** In-app balance (wallet) part of an order; same type as the rest when null. */
  walletPaymentTypeName: string | null;
  fallbackItemName: string;
}

export function loyverseSettings(env: Bindings | undefined): LoyverseSettings | null {
  const token = env?.LOYVERSE_ACCESS_TOKEN?.trim();
  if (!token) return null;
  const opt = (v: string | undefined) => v?.trim() || null;
  return {
    token,
    storeId: opt(env?.LOYVERSE_STORE_ID),
    paymentTypeName: opt(env?.LOYVERSE_PAYMENT_TYPE_NAME) ?? DEFAULT_PAYMENT_TYPE_NAME,
    walletPaymentTypeName: opt(env?.LOYVERSE_WALLET_PAYMENT_TYPE_NAME),
    fallbackItemName: opt(env?.LOYVERSE_FALLBACK_ITEM_NAME) ?? DEFAULT_FALLBACK_ITEM_NAME,
  };
}

// --- Loyverse shapes (only the fields used) -----------------------------------

export interface LoyverseVariant {
  variant_id: string;
  sku?: string | null;
  option1_value?: string | null;
  option2_value?: string | null;
  option3_value?: string | null;
}
export interface LoyverseItem {
  id: string;
  item_name: string;
  variants: LoyverseVariant[];
}
export interface LoyversePaymentType {
  id: string;
  name: string;
}
export interface LoyverseStore {
  id: string;
  name: string;
}
export interface ReceiptLine {
  variant_id: string;
  quantity: number;
  /** SAR, two decimals. */
  price: number;
  line_note?: string;
}
export interface ReceiptPayment {
  payment_type_id: string;
  money_amount: number;
}
export interface ReceiptBody {
  store_id: string;
  order: string;
  source: string;
  receipt_date: string;
  note?: string;
  line_items: ReceiptLine[];
  payments: ReceiptPayment[];
}

export class LoyverseError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LoyverseError";
  }
}

// --- client ---------------------------------------------------------------------

export class LoyverseClient {
  constructor(
    private readonly token: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(`${API}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      // No answer: a POST may or may not have landed, so it is not retried.
      throw new LoyverseError("LOYVERSE_UNREACHABLE", null, body === undefined);
    }
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      const retryable = response.status === 429 || response.status >= 500;
      throw new LoyverseError(`LOYVERSE_HTTP_${response.status}${detail ? `: ${detail}` : ""}`, response.status, retryable);
    }
    return (await response.json()) as T;
  }

  async stores(): Promise<LoyverseStore[]> {
    return (await this.request<{ stores: LoyverseStore[] }>("/stores")).stores ?? [];
  }

  async paymentTypes(): Promise<LoyversePaymentType[]> {
    return (await this.request<{ payment_types: LoyversePaymentType[] }>("/payment_types")).payment_types ?? [];
  }

  async items(): Promise<LoyverseItem[]> {
    const all: LoyverseItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q: string = `/items?limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res: { items?: LoyverseItem[]; cursor?: string | null } = await this.request(q);
      all.push(...(res.items ?? []));
      cursor = res.cursor ?? null;
      if (!cursor) break;
    }
    return all;
  }

  createReceipt(body: ReceiptBody): Promise<{ receipt_number: string }> {
    return this.request("/receipts", body);
  }
}

// --- matching -------------------------------------------------------------------

/** Arabic-tolerant name key: no diacritics or tatweel, one alef/yaa/taa form, single spaces, lower case. */
export function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s‌-‏]+/g, " ")
    .trim()
    .toLowerCase();
}

export interface Catalog {
  storeId: string;
  paymentTypeId: string;
  walletPaymentTypeId: string;
  fallbackVariantId: string | null;
  byName: Map<string, LoyverseItem>;
}

export function findVariant(catalog: Catalog, nameAr: string, optionNameAr: string | null): string | null {
  const item = catalog.byName.get(nameKey(nameAr));
  if (!item || item.variants.length === 0) return null;
  if (optionNameAr) {
    const want = nameKey(optionNameAr);
    const hit = item.variants.find((v) =>
      [v.option1_value, v.option2_value, v.option3_value].some((o) => o && nameKey(o) === want),
    );
    if (hit) return hit.variant_id;
    // The option may be its own Loyverse item, e.g. "V60 إثيوبي".
    const combined = catalog.byName.get(nameKey(`${nameAr} ${optionNameAr}`));
    if (combined?.variants[0]) return combined.variants[0].variant_id;
  }
  return item.variants[0]!.variant_id;
}

export async function loadCatalog(client: LoyverseClient, s: LoyverseSettings): Promise<Catalog> {
  const [stores, paymentTypes, items] = await Promise.all([client.stores(), client.paymentTypes(), client.items()]);

  let storeId = s.storeId;
  if (!storeId) {
    if (stores.length !== 1) throw new LoyverseError(stores.length === 0 ? "LOYVERSE_NO_STORE" : "LOYVERSE_SET_STORE_ID");
    storeId = stores[0]!.id;
  }
  const typeByName = (name: string) => paymentTypes.find((p) => nameKey(p.name) === nameKey(name))?.id ?? null;
  const paymentTypeId = typeByName(s.paymentTypeName);
  if (!paymentTypeId) throw new LoyverseError("LOYVERSE_PAYMENT_TYPE_MISSING");
  const walletPaymentTypeId = s.walletPaymentTypeName ? typeByName(s.walletPaymentTypeName) : paymentTypeId;
  if (!walletPaymentTypeId) throw new LoyverseError("LOYVERSE_WALLET_PAYMENT_TYPE_MISSING");

  const byName = new Map<string, LoyverseItem>();
  for (const item of items) {
    const key = nameKey(item.item_name ?? "");
    if (key && !byName.has(key)) byName.set(key, item);
  }
  const fallbackVariantId = byName.get(nameKey(s.fallbackItemName))?.variants[0]?.variant_id ?? null;
  return { storeId, paymentTypeId, walletPaymentTypeId, fallbackVariantId, byName };
}

let cached: { token: string; at: number; catalog: Catalog } | null = null;
async function catalogFor(client: LoyverseClient, s: LoyverseSettings, now: number, fresh = false): Promise<Catalog> {
  if (!fresh && cached && cached.token === s.token && now - cached.at < CATALOG_TTL_MS) return cached.catalog;
  const catalog = await loadCatalog(client, s);
  cached = { token: s.token, at: now, catalog };
  return catalog;
}
export function resetLoyverseCache(): void {
  cached = null;
}

// --- receipt --------------------------------------------------------------------

const sar = (halalas: number) => Math.round(halalas) / 100;

interface Unit {
  variantId: string;
  priceHalalas: number;
  note: string | undefined;
}

export type BuildResult = { ok: true; body: ReceiptBody } | { ok: false; unmatched: string[] };

/**
 * The receipt for a completed order. Totals match the app to the halala:
 * order-level discounts (free drink, gift cups, coupon) come off the dearest
 * units first, so a free drink shows as one drink at 0.
 */
export function buildReceipt(order: Order, catalog: Catalog, opts: { source?: string } = {}): BuildResult {
  const units: Unit[] = [];
  const unmatched: string[] = [];

  for (const line of order.items) {
    const label = line.optionNameAr ? `${line.nameAr} (${line.optionNameAr})` : line.nameAr;
    let variantId = findVariant(catalog, line.nameAr, line.optionNameAr);
    let note = line.note ?? undefined;
    if (!variantId) {
      if (!catalog.fallbackVariantId) {
        unmatched.push(label);
        continue;
      }
      variantId = catalog.fallbackVariantId;
      note = [label, line.note].filter(Boolean).join(" — ");
    } else if (line.optionNameAr && !note?.includes(line.optionNameAr)) {
      note = [line.optionNameAr, line.note].filter(Boolean).join(" — ");
    }
    for (let i = 0; i < line.quantity; i++) units.push({ variantId, priceHalalas: line.unitPriceHalalas, note });
  }
  if (order.deliveryFeeHalalas > 0) {
    if (catalog.fallbackVariantId) {
      units.push({ variantId: catalog.fallbackVariantId, priceHalalas: order.deliveryFeeHalalas, note: "رسوم التوصيل" });
    } else {
      unmatched.push("رسوم التوصيل");
    }
  }
  if (unmatched.length > 0) return { ok: false, unmatched };

  // Order-level discount, dearest units first (items before the delivery fee).
  let discount = Math.max(order.discountHalalas, 0);
  const byPrice = units.map((_, i) => i).sort((a, b) => units[b]!.priceHalalas - units[a]!.priceHalalas);
  for (const i of byPrice) {
    if (discount <= 0) break;
    const take = Math.min(discount, units[i]!.priceHalalas);
    units[i]!.priceHalalas -= take;
    discount -= take;
  }

  // Back to lines: identical units merge.
  const lines = new Map<string, ReceiptLine>();
  for (const u of units) {
    const key = `${u.variantId}|${u.priceHalalas}|${u.note ?? ""}`;
    const line = lines.get(key);
    if (line) line.quantity += 1;
    else
      lines.set(key, {
        variant_id: u.variantId,
        quantity: 1,
        price: sar(u.priceHalalas),
        ...(u.note ? { line_note: u.note.slice(0, 250) } : {}),
      });
  }

  const total = Math.max(order.totalHalalas, 0);
  const wallet = Math.min(Math.max(order.walletHalalas ?? 0, 0), total);
  const payments: ReceiptPayment[] = [];
  if (wallet > 0 && catalog.walletPaymentTypeId !== catalog.paymentTypeId) {
    payments.push({ payment_type_id: catalog.walletPaymentTypeId, money_amount: sar(wallet) });
    payments.push({ payment_type_id: catalog.paymentTypeId, money_amount: sar(total - wallet) });
  } else {
    payments.push({ payment_type_id: catalog.paymentTypeId, money_amount: sar(total) });
  }

  const kind = { pickup: "استلام", curbside: "عند السيارة", delivery: "توصيل" }[order.fulfillment];
  return {
    ok: true,
    body: {
      store_id: catalog.storeId,
      order: `تطبيق #${order.orderNumber}`,
      source: opts.source ?? "HOLLOW App",
      receipt_date: order.completedAt ?? new Date().toISOString(),
      note: `طلب تطبيق #${order.orderNumber} — ${kind} — ${order.customerName}`.slice(0, 250),
      line_items: [...lines.values()],
      payments: payments.filter((p) => p.money_amount > 0 || payments.length === 1),
    },
  };
}

// --- send -----------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends a completed order to Loyverse. Never throws: the outcome is logged. */
export async function pushOrderToLoyverse(
  deps: { logger: Logger; settings: LoyverseSettings; client?: LoyverseClient; now?: () => number; retryDelayMs?: number },
  order: Order,
): Promise<{ ok: boolean; receiptNumber?: string; error?: string }> {
  const { logger, settings } = deps;
  const client = deps.client ?? new LoyverseClient(settings.token);
  const now = deps.now ?? Date.now;
  const delay = deps.retryDelayMs ?? 2000;
  if (order.status !== "completed") return { ok: false, error: "NOT_COMPLETED" };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // A miss may mean the menu changed in Loyverse: reload the catalog once.
      let catalog = await catalogFor(client, settings, now());
      let built = buildReceipt(order, catalog);
      if (!built.ok) {
        catalog = await catalogFor(client, settings, now(), true);
        built = buildReceipt(order, catalog);
      }
      if (!built.ok) {
        logger.error("loyverse.unmatched", { orderId: order.id, orderNumber: order.orderNumber, items: built.unmatched });
        return { ok: false, error: "UNMATCHED_ITEMS" };
      }
      const receipt = await client.createReceipt(built.body);
      logger.info("loyverse.receipt", { orderId: order.id, orderNumber: order.orderNumber, receipt: receipt.receipt_number });
      return { ok: true, receiptNumber: receipt.receipt_number };
    } catch (err) {
      const e = err instanceof LoyverseError ? err : new LoyverseError(err instanceof Error ? err.message : "unknown");
      logger.error("loyverse.failed", { orderId: order.id, orderNumber: order.orderNumber, attempt, error: e.message });
      if (!e.retryable || attempt === 3) return { ok: false, error: e.message };
      await sleep(delay * attempt);
    }
  }
  return { ok: false, error: "UNKNOWN" };
}

/** For the admin check page: how each menu item maps, before going live. */
export async function checkLoyverse(
  settings: LoyverseSettings,
  menu: { nameAr: string; category: string; isArchived: boolean; options: { nameAr: string }[] }[],
  client: LoyverseClient = new LoyverseClient(settings.token),
) {
  resetLoyverseCache();
  const catalog = await loadCatalog(client, settings);
  const rows = menu
    .filter((m) => !m.isArchived)
    .sort((a, b) => MENU_CATEGORIES.indexOf(a.category as never) - MENU_CATEGORIES.indexOf(b.category as never))
    .map((m) => {
      const item = catalog.byName.get(nameKey(m.nameAr));
      return {
        name: m.nameAr,
        matched: Boolean(item),
        options: m.options.map((o) => ({
          name: o.nameAr,
          ownVariant:
            !!item &&
            item.variants.some((v) =>
              [v.option1_value, v.option2_value, v.option3_value].some((x) => x && nameKey(x) === nameKey(o.nameAr)),
            ),
        })),
      };
    });
  return {
    storeId: catalog.storeId,
    paymentTypeFound: true,
    fallbackItemFound: catalog.fallbackVariantId !== null,
    fallbackItemName: settings.fallbackItemName,
    items: rows,
    unmatchedCount: rows.filter((r) => !r.matched).length,
  };
}
