import { BUSINESS_TIME_ZONE } from "../../../shared/constants";
import { WEEKDAY_LABELS_AR, type ShopSettings } from "../../../shared/ordering";

/** "07:00" -> "7:00 ص", "23:30" -> "11:30 م". */
export function formatHhMm(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "ص" : "م";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function riyadhNow(date = new Date()): { weekday: number; hhmm: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? ""),
    hhmm: `${parts.hour}:${parts.minute}`,
  };
}

/** Why ordering is closed, in one line. */
export function closedNote(settings: ShopSettings): string {
  if (settings.orderingPaused) return "الطلبات متوقفة مؤقتًا، جرّب بعد قليل";
  const now = riyadhNow();
  for (let offset = 0; offset < 7; offset++) {
    const day = (now.weekday + offset) % 7;
    const hours = settings.weeklyHours[day];
    // Today's shift that already ended does not count.
    const endedToday = offset === 0 && hours !== undefined && hours.close > hours.open && now.hhmm >= hours.close;
    if (hours && !hours.closed && !endedToday) {
      const when = offset === 0 ? "اليوم" : offset === 1 ? "غدًا" : `يوم ${WEEKDAY_LABELS_AR[day]}`;
      return `نستقبل الطلبات ${when} من ${formatHhMm(hours.open)} إلى ${formatHhMm(hours.close)}`;
    }
  }
  return "الطلبات مغلقة حاليًا";
}
