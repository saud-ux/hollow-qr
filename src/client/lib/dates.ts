import { BUSINESS_TIME_ZONE } from "../../shared/constants";
import { currentLang, tr } from "./i18n";

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

const none = () => tr("لا يوجد", "None");

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return none();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return none();
  return (currentLang() === "en" ? dateTimeEn : dateTimeAr).format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return none();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return none();
  return (currentLang() === "en" ? dateOnlyEn : dateOnlyAr).format(d);
}
