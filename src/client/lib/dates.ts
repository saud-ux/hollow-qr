import { BUSINESS_TIME_ZONE } from "../../shared/constants";
import { currentLang, tr } from "./i18n";

const shopDayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE });
/** YYYY-MM-DD on the shop's clock, `back` days ago. */
export const shopDay = (back = 0) => shopDayFormat.format(new Date(Date.now() - back * 864e5));

const dateTimeAr = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dateOnlyAr = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
});

const dateTimeEn = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dateOnlyEn = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
});


/** The same without the year, for dates in the current year. */
const dateTimeShortAr = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
  timeZone: BUSINESS_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dateTimeShortEn = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const yearOf = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, year: "numeric" });
const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE });

const timeAr = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { timeZone: BUSINESS_TIME_ZONE, hour: "numeric", minute: "2-digit" });
const timeEn = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true });
const dayMonthAr = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { timeZone: BUSINESS_TIME_ZONE, month: "long", day: "numeric" });
const dayMonthEn = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, month: "long", day: "numeric" });

const none = () => tr("لا يوجد", "None");

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return none();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return none();
  return (currentLang() === "en" ? dateTimeEn : dateTimeAr).format(d);
}

/** Like formatDateTime, but leaves out the year when it's this year. */
export function formatDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return none();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return none();
  if (yearOf.format(d) !== yearOf.format(new Date())) return formatDateTime(iso);
  return (currentLang() === "en" ? dateTimeShortEn : dateTimeShortAr).format(d);
}

/** For tight spaces: today's time ("اليوم 7:36 م"), or just the day of another date. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return none();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return none();
  const en = currentLang() === "en";
  if (dayOf.format(d) === dayOf.format(new Date())) return en ? `Today ${timeEn.format(d)}` : `اليوم ${timeAr.format(d)}`;
  if (yearOf.format(d) !== yearOf.format(new Date())) return formatDate(iso);
  return (en ? dayMonthEn : dayMonthAr).format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return none();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return none();
  return (currentLang() === "en" ? dateOnlyEn : dateOnlyAr).format(d);
}
