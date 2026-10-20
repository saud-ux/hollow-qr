/**
 * The admin's sales workbook (.xlsx): a summary, sales per day, items, busiest
 * hours, every order and every order line, in Arabic, right to left, in the
 * café's colors. Sums are Excel formulas over the order sheets, saved with
 * their values, so they follow any edit the owner makes and still show in
 * viewers that never calculate.
 */
import { formatRiyadh } from "../../shared/format";
import { FULFILLMENT_LABELS_AR, WEEKDAY_LABELS_AR, rewardDiscount, type AdminOrder, type FulfillmentType, type OrderStatus } from "../../shared/ordering";
import { columnName, excelDate, writeXlsx, type CellStyle, type Row, type Sheet, type StyledCell } from "../lib/xlsx";

export interface SalesWorkbookInput {
  /** The orders in the period, any status. */
  orders: AdminOrder[];
  /** The period asked for, YYYY-MM-DD on the shop's clock (null: open-ended). */
  from: string | null;
  to: string | null;
  /** Other filters applied, in words (shown under the title). */
  filters?: string;
  now: Date;
}

const SUMMARY = "الملخص";
const DAILY = "المبيعات اليومية";
const ITEMS = "الأصناف";
const PEAK = "أوقات الذروة";
const ORDERS = "الطلبات";
const LINES = "بنود الطلبات";

const STATUS: Record<OrderStatus, string> = {
  new: "جديد",
  preparing: "قيد التحضير",
  ready: "جاهز",
  out_for_delivery: "خرج للتوصيل",
  completed: "مكتمل",
  cancelled: "ملغي",
};
const DONE = STATUS.completed;
const NO_OPTION = "—";

const ESPRESSO = "2B1E16";
const CREAM = "F4EDE0";
const CARD = "FBF8F2";
const CHIP = "EFE4D1";
const ACCENT = "7A4E2D";
const GOLD = "C9A227";
const MUTED = "6F5F52";
const STRIPE = "F9F4EA";

const MONEY = '#,##0.00 "ر.س";-#,##0.00 "ر.س";"-"';
const COUNT = '#,##0;-#,##0;"-"';

const total = { bold: true, fill: CHIP, border: "all" } as const;
const kpi = { fill: CARD, border: "bottom" } as const;

const STYLES: Record<string, CellStyle> = {
  title: { bold: true, size: 18, color: CREAM, fill: ESPRESSO, indent: 1 },
  subtitle: { size: 10, color: MUTED, indent: 1 },
  section: { bold: true, size: 13, color: ACCENT, fill: CHIP, border: "bottom", borderColor: ACCENT, indent: 1 },
  header: { bold: true, color: "FFFFFF", fill: ACCENT, border: "all", borderColor: "5E3B21", align: "center", wrap: true },
  text: { border: "bottom" },
  center: { border: "bottom", align: "center" },
  id: { border: "bottom", align: "center", numFmt: "0", bold: true },
  count: { border: "bottom", align: "center", numFmt: COUNT },
  money: { border: "bottom", numFmt: MONEY },
  moneyBold: { border: "bottom", numFmt: MONEY, bold: true },
  date: { border: "bottom", align: "center", numFmt: "yyyy-mm-dd" },
  time: { border: "bottom", align: "center", numFmt: "hh:mm" },
  percent: { border: "bottom", align: "center", numFmt: "0.0%" },
  done: { border: "bottom", align: "center", bold: true, color: "2E7D4F", fill: "E3F1E8" },
  cancelled: { border: "bottom", align: "center", bold: true, color: "B3261E", fill: "FBE4E1" },
  open: { border: "bottom", align: "center", bold: true, color: "8A5A00", fill: "FFF3D6" },
  totalLabel: { ...total },
  totalCount: { ...total, align: "center", numFmt: COUNT },
  totalMoney: { ...total, numFmt: MONEY },
  totalPercent: { ...total, align: "center", numFmt: "0.0%" },
  kpiLabel: { ...kpi, indent: 1 },
  kpiCount: { ...kpi, bold: true, size: 13, align: "center", numFmt: "#,##0" },
  kpiMoney: { ...kpi, bold: true, size: 13, numFmt: MONEY },
  kpiHeadline: { ...kpi, bold: true, size: 16, color: ACCENT, numFmt: MONEY },
  kpiText: { ...kpi, bold: true, align: "center" },
  kpiDate: { ...kpi, bold: true, align: "center", numFmt: "yyyy-mm-dd" },
  kpiPercent: { ...kpi, bold: true, align: "center", numFmt: "0.0%" },
  kpiRating: { ...kpi, bold: true, align: "center", numFmt: '0.0" / 5"' },
  heat: { border: "all", align: "center", numFmt: COUNT },
  heatHead: { bold: true, size: 10, fill: CREAM, border: "all", align: "center" },
  note: { size: 9, color: MUTED, wrap: true, indent: 1 },
  empty: { color: MUTED, align: "center" },
};

const quoted = (sheet: string) => `'${sheet}'`;
const riyals = (halalas: number) => halalas / 100;
const c = (v: string | number | null, s: string, f?: string): StyledCell => (f === undefined ? { v, s } : { v, s, f });
const blank = (s: string): StyledCell => ({ s });
const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

/** "9 ص" / "3 م" on the shop's clock. */
function hourLabel(h: number): string {
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${h < 12 ? "ص" : "م"}`;
}

/** Date, time and weekday of an order on the shop's clock. */
function when(iso: string) {
  const [date = "", time = ""] = formatRiyadh(iso).split(" ");
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return { date, serial: excelDate(y, m, d), time: (hour * 60 + minute) / 1440, hour, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** Every day from `from` to `to`, both included (YYYY-MM-DD). */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

function serialOf(day: string): number {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  return excelDate(y, m, d);
}

function statusStyle(status: OrderStatus): string {
  return status === "completed" ? "done" : status === "cancelled" ? "cancelled" : "open";
}

/** A sheet's first rows: the title band, a subtitle line and a gap. */
function heading(title: string, subtitle: string, width: number): { rows: Row[]; merges: string[] } {
  const span = (r: number) => `A${r}:${columnName(width - 1)}${r}`;
  return {
    rows: [{ cells: [c(title, "title"), ...Array<StyledCell>(width - 1).fill(blank("title"))], height: 38 }, { cells: [c(subtitle, "subtitle")], height: 22 }, { cells: [] }],
    merges: [span(1), span(2)],
  };
}

const ORDER_COLUMNS = [
  { key: "number", title: "رقم الطلب", width: 10 },
  { key: "date", title: "التاريخ", width: 12 },
  { key: "time", title: "الوقت", width: 9 },
  { key: "weekday", title: "اليوم", width: 10 },
  { key: "hour", title: "الساعة", width: 8 },
  { key: "customer", title: "العميل", width: 20 },
  { key: "phone", title: "الجوال", width: 13 },
  { key: "member", title: "رقم العضوية", width: 13 },
  { key: "fulfillment", title: "طريقة الاستلام", width: 17 },
  { key: "status", title: "الحالة", width: 13 },
  { key: "items", title: "الأصناف", width: 44 },
  { key: "pieces", title: "عدد القطع", width: 10 },
  { key: "subtotal", title: "المجموع", width: 14 },
  { key: "fee", title: "رسوم التوصيل", width: 13 },
  { key: "reward", title: "المشروب المجاني", width: 14 },
  { key: "coupon", title: "الكوبون", width: 12 },
  { key: "gift", title: "أكواب الضيافة", width: 13 },
  { key: "total", title: "الإجمالي", width: 14 },
  { key: "balance", title: "من الرصيد", width: 13 },
  { key: "collected", title: "المحصّل", width: 14 },
  { key: "promo", title: "توفير العرض", width: 13 },
  { key: "rating", title: "التقييم", width: 9 },
  { key: "by", title: "سلّمه", width: 15 },
  { key: "reason", title: "سبب الإلغاء", width: 24 },
] as const;
type OrderColumn = (typeof ORDER_COLUMNS)[number]["key"];
const O = Object.fromEntries(ORDER_COLUMNS.map((col, i) => [col.key, columnName(i)])) as Record<OrderColumn, string>;
/** A whole column of the orders sheet, for SUMIFS / COUNTIFS. */
const ordersCol = (key: OrderColumn) => `${quoted(ORDERS)}!$${O[key]}:$${O[key]}`;
const doneIs = `${ordersCol("status")},"${DONE}"`;

const LINE_COLUMNS = [
  { key: "number", title: "رقم الطلب", width: 10 },
  { key: "date", title: "التاريخ", width: 12 },
  { key: "status", title: "الحالة", width: 13 },
  { key: "item", title: "الصنف", width: 26 },
  { key: "option", title: "الخيار", width: 16 },
  { key: "category", title: "الفئة", width: 10 },
  { key: "qty", title: "الكمية", width: 9 },
  { key: "unit", title: "سعر الوحدة", width: 14 },
  { key: "amount", title: "الإجمالي", width: 14 },
] as const;
type LineColumn = (typeof LINE_COLUMNS)[number]["key"];
const L = Object.fromEntries(LINE_COLUMNS.map((col, i) => [col.key, columnName(i)])) as Record<LineColumn, string>;
const linesCol = (key: LineColumn) => `${quoted(LINES)}!$${L[key]}:$${L[key]}`;

interface Placed {
  order: AdminOrder;
  at: ReturnType<typeof when>;
}

function ordersSheet(placed: Placed[]): Sheet {
  const header: Row = { cells: ORDER_COLUMNS.map((col) => c(col.title, "header")), height: 30 };
  const rows: Row[] = placed.map(({ order: o, at }, i) => {
    const r = i + 2;
    const wallet = o.walletHalalas ?? 0;
    const values: Record<OrderColumn, StyledCell> = {
      number: c(o.orderNumber, "id"),
      date: c(at.serial, "date"),
      time: c(at.time, "time"),
      weekday: c(WEEKDAY_LABELS_AR[at.weekday]!, "center"),
      hour: c(at.hour, "id"),
      customer: c(o.customerName, "text"),
      phone: c(o.customerPhone, "center"),
      member: c(o.memberId ?? "", "center"),
      fulfillment: c(FULFILLMENT_LABELS_AR[o.fulfillment], "text"),
      status: c(STATUS[o.status], statusStyle(o.status)),
      items: c(o.items.map((l) => `${l.quantity}× ${l.nameAr}${l.optionNameAr ? ` (${l.optionNameAr})` : ""}`).join("، "), "text"),
      pieces: c(sum(o.items.map((l) => l.quantity)), "count"),
      subtotal: c(riyals(o.subtotalHalalas), "money"),
      fee: c(riyals(o.deliveryFeeHalalas), "money"),
      reward: c(riyals(rewardDiscount(o)), "money"),
      coupon: c(riyals(o.couponHalalas ?? 0), "money"),
      gift: c(riyals(o.giftHalalas ?? 0), "money"),
      total: c(riyals(o.totalHalalas), "moneyBold"),
      balance: c(riyals(wallet), "money"),
      collected: c(riyals(o.totalHalalas - wallet), "moneyBold", `${O.total}${r}-${O.balance}${r}`),
      promo: c(riyals(o.promoSavingsHalalas), "money"),
      rating: c(o.rating, "center"),
      by: c(o.completedByName ?? "", "text"),
      reason: c(o.cancelReason ?? "", "text"),
    };
    return { cells: ORDER_COLUMNS.map((col) => values[col.key]) };
  });

  const last = rows.length + 1;
  const end = columnName(ORDER_COLUMNS.length - 1);
  const merges: string[] = [];
  if (rows.length > 0) {
    const t = last + 1;
    const subtotal = (key: OrderColumn, style: string, halalas: number) => c(riyals(halalas), style, `SUBTOTAL(109,${O[key]}2:${O[key]}${last})`);
    const orders = placed.map((p) => p.order);
    const totals: Partial<Record<OrderColumn, StyledCell>> = {
      number: c("المجموع (يتبع الفلتر)", "totalLabel"),
      pieces: c(sum(orders.flatMap((o) => o.items.map((l) => l.quantity))), "totalCount", `SUBTOTAL(109,${O.pieces}2:${O.pieces}${last})`),
      subtotal: subtotal("subtotal", "totalMoney", sum(orders.map((o) => o.subtotalHalalas))),
      fee: subtotal("fee", "totalMoney", sum(orders.map((o) => o.deliveryFeeHalalas))),
      reward: subtotal("reward", "totalMoney", sum(orders.map(rewardDiscount))),
      coupon: subtotal("coupon", "totalMoney", sum(orders.map((o) => o.couponHalalas ?? 0))),
      gift: subtotal("gift", "totalMoney", sum(orders.map((o) => o.giftHalalas ?? 0))),
      total: subtotal("total", "totalMoney", sum(orders.map((o) => o.totalHalalas))),
      balance: subtotal("balance", "totalMoney", sum(orders.map((o) => o.walletHalalas ?? 0))),
      collected: subtotal("collected", "totalMoney", sum(orders.map((o) => o.totalHalalas - (o.walletHalalas ?? 0)))),
      promo: subtotal("promo", "totalMoney", sum(orders.map((o) => o.promoSavingsHalalas))),
    };
    rows.push({ cells: ORDER_COLUMNS.map((col) => totals[col.key] ?? blank("totalLabel")), height: 26 });
    merges.push(`A${t}:${O.items}${t}`);
  }
  return {
    name: ORDERS,
    tabColor: MUTED,
    widths: ORDER_COLUMNS.map((col) => col.width),
    rows: [header, ...rows],
    merges,
    frozenRows: 1,
    filter: `A1:${end}${last}`,
    highlights: rows.length ? [{ type: "stripes", ref: `A2:${columnName(ORDER_COLUMNS.findIndex((col) => col.key === "status") - 1)}${last} ${O.items}2:${end}${last}`, fill: STRIPE }] : [],
  };
}

function linesSheet(placed: Placed[]): Sheet {
  const header: Row = { cells: LINE_COLUMNS.map((col) => c(col.title, "header")), height: 30 };
  const rows: Row[] = [];
  for (const { order: o, at } of placed) {
    for (const line of o.items) {
      const r = rows.length + 2;
      const values: Record<LineColumn, StyledCell> = {
        number: c(o.orderNumber, "id"),
        date: c(at.serial, "date"),
        status: c(STATUS[o.status], statusStyle(o.status)),
        item: c(line.nameAr, "text"),
        option: c(line.optionNameAr ?? NO_OPTION, "center"),
        category: c(line.category === "drink" ? "مشروب" : "حلى", "center"),
        qty: c(line.quantity, "count"),
        unit: c(riyals(line.unitPriceHalalas), "money"),
        amount: c(riyals(line.unitPriceHalalas * line.quantity), "moneyBold", `${L.qty}${r}*${L.unit}${r}`),
      };
      rows.push({ cells: LINE_COLUMNS.map((col) => values[col.key]) });
    }
  }
  const last = rows.length + 1;
  const end = columnName(LINE_COLUMNS.length - 1);
  const merges: string[] = [];
  if (rows.length > 0) {
    const lines = placed.flatMap((p) => p.order.items);
    const totals: Partial<Record<LineColumn, StyledCell>> = {
      number: c("المجموع (يتبع الفلتر)", "totalLabel"),
      qty: c(sum(lines.map((l) => l.quantity)), "totalCount", `SUBTOTAL(109,${L.qty}2:${L.qty}${last})`),
      amount: c(riyals(sum(lines.map((l) => l.unitPriceHalalas * l.quantity))), "totalMoney", `SUBTOTAL(109,${L.amount}2:${L.amount}${last})`),
    };
    rows.push({ cells: LINE_COLUMNS.map((col) => totals[col.key] ?? blank("totalLabel")), height: 26 });
    merges.push(`A${last + 1}:${L.category}${last + 1}`);
  }
  return {
    name: LINES,
    tabColor: MUTED,
    widths: LINE_COLUMNS.map((col) => col.width),
    rows: [header, ...rows],
    merges,
    frozenRows: 1,
    filter: `A1:${end}${last}`,
    highlights: rows.length ? [{ type: "stripes", ref: `A2:${L.date}${last} ${L.item}2:${end}${last}`, fill: STRIPE }] : [],
  };
}

interface ItemTotal {
  name: string;
  option: string;
  category: string;
  qty: number;
  halalas: number;
}

/** Items sold in completed orders, most ordered first. */
function itemTotals(done: AdminOrder[]): ItemTotal[] {
  const map = new Map<string, ItemTotal>();
  for (const line of done.flatMap((o) => o.items)) {
    const option = line.optionNameAr ?? NO_OPTION;
    const key = `${line.nameAr}|${option}`;
    const entry = map.get(key) ?? { name: line.nameAr, option, category: line.category === "drink" ? "مشروب" : "حلى", qty: 0, halalas: 0 };
    entry.qty += line.quantity;
    entry.halalas += line.unitPriceHalalas * line.quantity;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || b.halalas - a.halalas || a.name.localeCompare(b.name, "ar"));
}

const FIRST = 5; // first data row under a heading and a header row

function itemsSheet(items: ItemTotal[], subtitle: string): Sheet {
  const width = 7;
  const head = heading("الأصناف الأكثر مبيعًا", subtitle, width);
  const rows: Row[] = [
    ...head.rows,
    { cells: ["#", "الصنف", "الخيار", "الفئة", "الكمية", "المبيعات*", "النسبة من المبيعات"].map((t) => c(t, "header")), height: 30 },
  ];
  const merges = [...head.merges];
  const tot = FIRST + items.length;
  const all = sum(items.map((i) => i.halalas));
  items.forEach((item, i) => {
    const r = FIRST + i;
    const match = `${linesCol("item")},$B${r},${linesCol("option")},$C${r},${linesCol("status")},"${DONE}"`;
    rows.push({
      cells: [
        c(i + 1, "id"),
        c(item.name, "text"),
        c(item.option, "center"),
        c(item.category, "center"),
        c(item.qty, "count", `SUMIFS(${linesCol("qty")},${match})`),
        c(riyals(item.halalas), "moneyBold", `SUMIFS(${linesCol("amount")},${match})`),
        c(all ? item.halalas / all : 0, "percent", `IF($F$${tot}=0,0,F${r}/$F$${tot})`),
      ],
    });
  });
  const highlights: Sheet["highlights"] = [];
  if (items.length === 0) {
    rows.push({ cells: [c("لا توجد مبيعات مكتملة في هذه الفترة", "empty")], height: 28 });
    merges.push(`A${FIRST}:G${FIRST}`);
  } else {
    const end = tot - 1;
    rows.push({
      cells: [
        c("المجموع", "totalLabel"),
        blank("totalLabel"),
        blank("totalLabel"),
        blank("totalLabel"),
        c(sum(items.map((i) => i.qty)), "totalCount", `SUM(E${FIRST}:E${end})`),
        c(riyals(all), "totalMoney", `SUM(F${FIRST}:F${end})`),
        c(all ? 1 : 0, "totalPercent", `SUM(G${FIRST}:G${end})`),
      ],
      height: 26,
    });
    merges.push(`A${tot}:D${tot}`);
    highlights.push({ type: "dataBar", ref: `E${FIRST}:E${end}`, color: GOLD });
    rows.push({ cells: [] }, { cells: [c("* بسعر البيع بعد خصم العروض، وقبل المشروب المجاني والكوبونات وأكواب الضيافة.", "note")], height: 30 });
    merges.push(`A${tot + 2}:G${tot + 2}`);
  }
  return { name: ITEMS, tabColor: GOLD, widths: [6, 26, 16, 10, 11, 16, 14], rows, merges, frozenRows: 4, highlights };
}

interface DayTotal {
  day: string;
  orders: number;
  sales: number;
  collected: number;
  balance: number;
  discounts: number;
  cancelled: number;
}

function dailySheet(days: DayTotal[], subtitle: string): Sheet {
  const width = 9;
  const head = heading("المبيعات اليومية", subtitle, width);
  const rows: Row[] = [
    ...head.rows,
    { cells: ["التاريخ", "اليوم", "الطلبات", "المبيعات", "المحصّل في المحل", "من الرصيد", "الخصومات", "متوسط الطلب", "الملغاة"].map((t) => c(t, "header")), height: 30 },
  ];
  const merges = [...head.merges];
  days.forEach((d, i) => {
    const r = FIRST + i;
    const on = `${ordersCol("date")},$A${r}`;
    const sumOf = (key: OrderColumn) => `SUMIFS(${ordersCol(key)},${on},${doneIs})`;
    rows.push({
      cells: [
        c(serialOf(d.day), "date"),
        c(WEEKDAY_LABELS_AR[new Date(`${d.day}T12:00:00Z`).getUTCDay()]!, "center"),
        c(d.orders, "count", `COUNTIFS(${on},${doneIs})`),
        c(riyals(d.sales), "moneyBold", sumOf("total")),
        c(riyals(d.collected), "money", sumOf("collected")),
        c(riyals(d.balance), "money", sumOf("balance")),
        c(riyals(d.discounts), "money", `${sumOf("reward")}+${sumOf("coupon")}+${sumOf("gift")}`),
        c(d.orders ? riyals(d.sales) / d.orders : 0, "money", `IF(C${r}=0,0,D${r}/C${r})`),
        c(d.cancelled, "count", `COUNTIFS(${on},${ordersCol("status")},"${STATUS.cancelled}")`),
      ],
    });
  });
  const highlights: Sheet["highlights"] = [];
  if (days.length === 0) {
    rows.push({ cells: [c("لا توجد طلبات في هذه الفترة", "empty")], height: 28 });
    merges.push(`A${FIRST}:I${FIRST}`);
  } else {
    const t = FIRST + days.length;
    const end = t - 1;
    const orders = sum(days.map((d) => d.orders));
    const sales = sum(days.map((d) => d.sales));
    const totalOf = (col: string, value: number, style: string) => c(value, style, `SUM(${col}${FIRST}:${col}${end})`);
    rows.push({
      cells: [
        c("المجموع", "totalLabel"),
        blank("totalLabel"),
        totalOf("C", orders, "totalCount"),
        totalOf("D", riyals(sales), "totalMoney"),
        totalOf("E", riyals(sum(days.map((d) => d.collected))), "totalMoney"),
        totalOf("F", riyals(sum(days.map((d) => d.balance))), "totalMoney"),
        totalOf("G", riyals(sum(days.map((d) => d.discounts))), "totalMoney"),
        c(orders ? riyals(sales) / orders : 0, "totalMoney", `IF(C${t}=0,0,D${t}/C${t})`),
        totalOf("I", sum(days.map((d) => d.cancelled)), "totalCount"),
      ],
      height: 26,
    });
    merges.push(`A${t}:B${t}`);
    highlights.push({ type: "colorScale", ref: `D${FIRST}:D${end}`, low: CARD, high: GOLD });
  }
  return { name: DAILY, tabColor: ACCENT, widths: [13, 11, 10, 15, 16, 13, 13, 14, 10], rows, merges, frozenRows: 4, highlights };
}

function peakSheet(done: Placed[], subtitle: string): Sheet {
  const seen = done.map((p) => p.at.hour);
  const first = Math.min(7, ...seen);
  const lastHour = Math.max(23, ...seen);
  const hours = Array.from({ length: lastHour - first + 1 }, (_, i) => first + i);
  const width = hours.length + 2;
  const totalCol = columnName(width - 1);
  const head = heading("أوقات الذروة", subtitle, width);
  const rows: Row[] = [...head.rows, { cells: [c("اليوم", "header"), ...hours.map((h) => c(hourLabel(h), "heatHead")), c("المجموع", "header")], height: 26 }];
  const count = (weekday: number, hour: number) => done.filter((p) => p.at.weekday === weekday && p.at.hour === hour).length;
  WEEKDAY_LABELS_AR.forEach((day, weekday) => {
    const r = FIRST + weekday;
    rows.push({
      cells: [
        c(day, "heatHead"),
        ...hours.map((h) => c(count(weekday, h), "heat", `COUNTIFS(${ordersCol("weekday")},$A${r},${ordersCol("hour")},${h},${doneIs})`)),
        c(done.filter((p) => p.at.weekday === weekday).length, "totalCount", `SUM(B${r}:${columnName(width - 2)}${r})`),
      ],
      height: 24,
    });
  });
  const t = FIRST + 7;
  rows.push({
    cells: [
      c("المجموع", "totalLabel"),
      ...hours.map((h, i) => c(done.filter((p) => p.at.hour === h).length, "totalCount", `SUM(${columnName(i + 1)}${FIRST}:${columnName(i + 1)}${t - 1})`)),
      c(done.length, "totalCount", `SUM(${totalCol}${FIRST}:${totalCol}${t - 1})`),
    ],
    height: 26,
  });
  rows.push({ cells: [] }, { cells: [c("عدد الطلبات المكتملة في كل ساعة. كلما غمق اللون زاد الإقبال.", "note")], height: 22 });
  return {
    name: PEAK,
    tabColor: GOLD,
    widths: [11, ...hours.map(() => 6.5), 10],
    rows,
    merges: [...head.merges, `A${t + 2}:${totalCol}${t + 2}`],
    frozenRows: 4,
    highlights: [{ type: "colorScale", ref: `B${FIRST}:${columnName(width - 2)}${t - 1}`, low: CARD, high: GOLD }],
  };
}

function summarySheet(input: { orders: AdminOrder[]; done: AdminOrder[]; days: DayTotal[]; items: ItemTotal[]; period: string; stamp: string }): Sheet {
  const { orders, done, days, items } = input;
  const width = 4;
  const head = heading("HOLLOW · تقرير المبيعات", input.period, width);
  const rows: Row[] = head.rows.slice(0, 2);
  rows.push({ cells: [c(input.stamp, "subtitle")], height: 20 }, { cells: [] });
  const merges = [...head.merges, "A3:D3"];
  const section = (title: string) => {
    rows.push({ cells: [c(title, "section"), blank("section")], height: 26 });
    merges.push(`A${rows.length}:B${rows.length}`);
  };
  /** Adds a label and its value; returns the row number. */
  const line = (label: string, value: StyledCell) => {
    rows.push({ cells: [c(label, "kpiLabel"), value], height: 24 });
    return rows.length;
  };
  const sumDone = (key: OrderColumn) => `SUMIFS(${ordersCol(key)},${doneIs})`;
  const halalas = (pick: (o: AdminOrder) => number) => sum(done.map(pick));

  const sales = halalas((o) => o.totalHalalas);
  section("المبيعات");
  const completedRow = line("الطلبات المكتملة", c(done.length, "kpiCount", `COUNTIF(${doneIs})`));
  const salesRow = line("إجمالي المبيعات", c(riyals(sales), "kpiHeadline", sumDone("total")));
  line("المحصّل في المحل", c(riyals(halalas((o) => o.totalHalalas - (o.walletHalalas ?? 0))), "kpiMoney", sumDone("collected")));
  line("المدفوع من رصيد العملاء", c(riyals(halalas((o) => o.walletHalalas ?? 0)), "kpiMoney", sumDone("balance")));
  line("متوسط قيمة الطلب", c(done.length ? riyals(sales) / done.length : 0, "kpiMoney", `IF(B${completedRow}=0,0,B${salesRow}/B${completedRow})`));
  line("رسوم التوصيل", c(riyals(halalas((o) => o.deliveryFeeHalalas)), "kpiMoney", sumDone("fee")));
  // A one-day report has no best day to name.
  if (days.length > 1) {
    const range = (col: string) => `${quoted(DAILY)}!$${col}$${FIRST}:$${col}$${FIRST + days.length - 1}`;
    const best = days.reduce((a, b) => (b.sales > a.sales ? b : a));
    line(
      "أفضل يوم مبيعات",
      c(best.sales > 0 ? serialOf(best.day) : "-", "kpiDate", `IF(MAX(${range("D")})=0,"-",INDEX(${range("A")},MATCH(MAX(${range("D")}),${range("D")},0)))`),
    );
  }
  const top = items[0];
  const topCell = (col: string) => `${quoted(ITEMS)}!$${col}$${FIRST}`;
  line(
    "الصنف الأكثر طلبًا",
    c(
      top ? top.name + (top.option !== NO_OPTION ? ` (${top.option})` : "") : "-",
      "kpiText",
      `IF(N(${topCell("E")})>0,${topCell("B")}&IF(${topCell("C")}="${NO_OPTION}",""," ("&${topCell("C")}&")"),"-")`,
    ),
  );
  rows.push({ cells: [] });

  section("الخصومات");
  const rewardRow = line("المشروب المجاني", c(riyals(halalas(rewardDiscount)), "kpiMoney", sumDone("reward")));
  line("الكوبونات", c(riyals(halalas((o) => o.couponHalalas ?? 0)), "kpiMoney", sumDone("coupon")));
  const giftRow = line("أكواب الضيافة", c(riyals(halalas((o) => o.giftHalalas ?? 0)), "kpiMoney", sumDone("gift")));
  line(
    "إجمالي الخصومات",
    c(riyals(halalas((o) => rewardDiscount(o) + (o.couponHalalas ?? 0) + (o.giftHalalas ?? 0))), "kpiHeadline", `SUM(B${rewardRow}:B${giftRow})`),
  );
  line("توفير العروض (محسوب ضمن المبيعات)", c(riyals(halalas((o) => o.promoSavingsHalalas)), "kpiMoney", sumDone("promo")));
  rows.push({ cells: [] });

  section("الطلبات");
  const cancelled = orders.filter((o) => o.status === "cancelled").length;
  const allRow = line("كل الطلبات في الفترة", c(orders.length, "kpiCount", `COUNTA(${ordersCol("status")})-1`));
  const doneRow = line("المكتملة", c(done.length, "kpiCount", `B${completedRow}`));
  const cancelledRow = line("الملغاة", c(cancelled, "kpiCount", `COUNTIF(${ordersCol("status")},"${STATUS.cancelled}")`));
  line("قيد التنفيذ", c(orders.length - done.length - cancelled, "kpiCount", `B${allRow}-B${doneRow}-B${cancelledRow}`));
  line("نسبة الإلغاء", c(orders.length ? cancelled / orders.length : 0, "kpiPercent", `IF(B${allRow}=0,0,B${cancelledRow}/B${allRow})`));
  rows.push({ cells: [] });

  section("رضا العملاء");
  const rated = orders.map((o) => o.rating ?? 0).filter((r) => r > 0);
  line(
    "متوسط التقييم",
    c(rated.length ? sum(rated) / rated.length : "-", "kpiRating", `IFERROR(AVERAGEIF(${ordersCol("rating")},">0"),"-")`),
  );
  line("عدد التقييمات", c(rated.length, "kpiCount", `COUNTIF(${ordersCol("rating")},">0")`));
  rows.push({ cells: [] });

  rows.push({ cells: [c("حسب طريقة الاستلام", "section"), blank("section"), blank("section"), blank("section")], height: 26 });
  merges.push(`A${rows.length}:D${rows.length}`);
  rows.push({ cells: ["الطريقة", "الطلبات", "المبيعات", "النسبة من المبيعات"].map((t) => c(t, "header")), height: 28 });
  const firstWay = rows.length + 1;
  (["pickup", "curbside", "delivery"] as FulfillmentType[]).forEach((way) => {
    const r = rows.length + 1;
    const mine = done.filter((o) => o.fulfillment === way);
    const waySales = sum(mine.map((o) => o.totalHalalas));
    const match = `${ordersCol("fulfillment")},$A${r},${doneIs}`;
    rows.push({
      cells: [
        c(FULFILLMENT_LABELS_AR[way], "text"),
        c(mine.length, "count", `COUNTIFS(${match})`),
        c(riyals(waySales), "moneyBold", `SUMIFS(${ordersCol("total")},${match})`),
        c(sales ? waySales / sales : 0, "percent", `IF($B$${salesRow}=0,0,C${r}/$B$${salesRow})`),
      ],
      height: 24,
    });
  });
  const lastWay = rows.length;
  rows.push({
    cells: [
      c("المجموع", "totalLabel"),
      c(done.length, "totalCount", `SUM(B${firstWay}:B${lastWay})`),
      c(riyals(sales), "totalMoney", `SUM(C${firstWay}:C${lastWay})`),
      c(sales ? 1 : 0, "totalPercent", `SUM(D${firstWay}:D${lastWay})`),
    ],
    height: 26,
  });
  rows.push({ cells: [] });
  rows.push({
    cells: [c("أرقام المبيعات من الطلبات المكتملة فقط. «المحصّل في المحل» هو الإجمالي ناقص ما دفعه العميل من رصيده في التطبيق. تفاصيل كل طلب في ورقة «الطلبات».", "note")],
    height: 44,
  });
  merges.push(`A${rows.length}:D${rows.length}`);

  return {
    name: SUMMARY,
    tabColor: ESPRESSO,
    widths: [36, 22, 18, 18],
    rows,
    merges,
    highlights: [{ type: "dataBar", ref: `C${firstWay}:C${lastWay}`, color: GOLD }],
  };
}

function periodText(from: string | null, to: string | null): string {
  if (from && to) return from === to ? `يوم ${WEEKDAY_LABELS_AR[new Date(`${from}T12:00:00Z`).getUTCDay()]} ${from}` : `من ${from} إلى ${to}`;
  if (from) return `من ${from}`;
  if (to) return `حتى ${to}`;
  return "كل الفترات";
}

/** The sales workbook as .xlsx bytes. */
export function salesWorkbook(input: SalesWorkbookInput): Uint8Array {
  const placed: Placed[] = input.orders
    .map((order) => ({ order, at: when(order.createdAt) }))
    .sort((a, b) => a.order.createdAt.localeCompare(b.order.createdAt) || a.order.orderNumber - b.order.orderNumber);
  const done = placed.filter((p) => p.order.status === "completed");
  const doneOrders = done.map((p) => p.order);

  const today = formatRiyadh(input.now.toISOString()).slice(0, 10);
  const firstDay = input.from ?? placed[0]?.at.date ?? null;
  const lastDay = input.to ?? (input.from ? today : (placed[placed.length - 1]?.at.date ?? null));
  const days: DayTotal[] = (firstDay && lastDay && firstDay <= lastDay ? daysBetween(firstDay, lastDay) : []).map((day) => {
    const mine = doneOrders.filter((o) => formatRiyadh(o.createdAt).startsWith(day));
    return {
      day,
      orders: mine.length,
      sales: sum(mine.map((o) => o.totalHalalas)),
      collected: sum(mine.map((o) => o.totalHalalas - (o.walletHalalas ?? 0))),
      balance: sum(mine.map((o) => o.walletHalalas ?? 0)),
      discounts: sum(mine.map((o) => rewardDiscount(o) + (o.couponHalalas ?? 0) + (o.giftHalalas ?? 0))),
      cancelled: placed.filter((p) => p.order.status === "cancelled" && p.at.date === day).length,
    };
  });
  const items = itemTotals(doneOrders);

  const period = `الفترة: ${periodText(input.from, input.to)}${input.filters ? ` · ${input.filters}` : ""}`;
  const stamp = `أُصدر في ${formatRiyadh(input.now.toISOString()).slice(0, 16)} بتوقيت الرياض`;
  const sheetSubtitle = `${period} · الطلبات المكتملة`;

  return writeXlsx({
    styles: STYLES,
    sheets: [
      summarySheet({ orders: input.orders, done: doneOrders, days, items, period, stamp }),
      dailySheet(days, period),
      itemsSheet(items, sheetSubtitle),
      peakSheet(done, sheetSubtitle),
      ordersSheet(placed),
      linesSheet(placed),
    ],
  });
}
