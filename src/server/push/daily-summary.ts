/**
 * End-of-day summary for admins. A cron trigger runs `runDailySummary` every
 * hour; it sends once per business day, shortly after the shop closes.
 */
import { formatSar, type DayHours } from "../../shared/ordering";
import type { OrderSummary, Repository } from "../data/repository";
import type { Logger } from "../lib/logger";
import type { AppPushMessage, AppPushSender } from "./app-push";
import { sendToTokens } from "./order-notifications";

/** How far back a closing time still counts (the cron runs hourly). */
const LOOKBACK_MS = 65 * 60 * 1000;

/** Year, month, day, weekday and minutes of `at` on the wall clock of `timeZone`. */
function zoned(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** The UTC instant of a wall-clock date and "HH:MM" in `timeZone`. */
function zonedInstant(year: number, month: number, day: number, hhmm: string, timeZone: string): Date {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(year, month - 1, day, h, m);
  const seen = zoned(new Date(guess), timeZone);
  const offset = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute) - guess;
  return new Date(guess - offset);
}

export interface BusinessWindow {
  /** Local date the shift opened on (YYYY-MM-DD). */
  businessDate: string;
  from: Date;
  to: Date;
}

/**
 * The shift that closed within the last hour, if any. A close time at or
 * before the open time means the shift runs past midnight (like shop_is_open).
 */
export function justClosedShift(now: Date, weeklyHours: DayHours[], timeZone: string): BusinessWindow | null {
  const today = zoned(now, timeZone);
  for (const back of [0, 1]) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day - back));
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    const day = weeklyHours[date.getUTCDay()];
    if (!day || day.closed) continue;
    const from = zonedInstant(y, m, d, day.open, timeZone);
    let to = zonedInstant(y, m, d, day.close, timeZone);
    if (to.getTime() <= from.getTime()) to = new Date(to.getTime() + 24 * 60 * 60 * 1000);
    if (to.getTime() <= now.getTime() && now.getTime() - to.getTime() < LOOKBACK_MS) {
      const businessDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      return { businessDate, from, to };
    }
  }
  return null;
}

export function dailySummaryMessage(s: OrderSummary): AppPushMessage {
  const parts: string[] = [];
  if (s.completed === 0) parts.push("ما فيه طلبات مكتملة اليوم");
  else {
    parts.push(`${s.completed} ${s.completed === 1 ? "طلب مكتمل" : "طلبات مكتملة"}`);
    parts.push(`${formatSar(s.revenueHalalas)} ر.س`);
    if (s.topItem) parts.push(`الأكثر طلبًا: ${s.topItem.nameAr} (${s.topItem.quantity})`);
  }
  if (s.cancelled > 0) parts.push(`${s.cancelled} ملغي`);
  if (s.open > 0) parts.push(`${s.open} لم يُغلق بعد`);
  return { title: "ملخص اليوم", body: parts.join(" · "), data: { link: "staff-orders" } };
}

/** Called by the cron trigger. Safe to run any number of times. */
export async function runDailySummary(
  deps: { repo: Repository; appPush: AppPushSender; logger: Logger },
  now: Date,
  timeZone: string,
): Promise<"sent" | "not-yet" | "already-sent" | "disabled"> {
  if (deps.appPush.kind === "disabled") return "disabled";
  const settings = await deps.repo.getShopSettings();
  const shift = justClosedShift(now, settings.weeklyHours, timeZone);
  if (!shift) return "not-yet";
  if (!(await deps.repo.claimDailySummary(shift.businessDate))) return "already-sent";
  const summary = await deps.repo.orderSummary(shift.from, shift.to);
  const tokens = await deps.repo.staffPushTokens("daily_summary");
  const sent = await sendToTokens(deps, tokens, dailySummaryMessage(summary));
  deps.logger.info("daily_summary.sent", { businessDate: shift.businessDate, devices: tokens.length, sent });
  return "sent";
}
