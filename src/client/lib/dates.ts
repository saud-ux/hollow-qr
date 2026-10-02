import { BUSINESS_TIME_ZONE } from "../../shared/constants";

const dateTime = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateOnly.format(d);
}
