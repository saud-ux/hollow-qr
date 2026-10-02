import { BUSINESS_TIME_ZONE, MAX_STAMPS, MEMBER_ID_ALPHABET } from "./constants";

/**
 * Masks an email for staff: "sara@gmail.com" -> "sa***@gmail.com".
 * Admins see full emails; staff never do.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

/**
 * Normalizes manual member-ID entry. Accepts "hlw-abc234", "ABC234", "HLW ABC 234".
 * Returns null when the input cannot be a valid member ID.
 */
export function normalizeMemberId(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s‏‎]/g, "").replace(/^HLW-?/, "");
  if (compact.length !== 6) return null;
  for (const ch of compact) {
    if (!MEMBER_ID_ALPHABET.includes(ch)) return null;
  }
  return `HLW-${compact}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** "3 / 5 Cups" — the exact progress label used on the pass and in the UI. */
export function cupsLabel(stampCount: number): string {
  return `${stampCount} / ${MAX_STAMPS} Cups`;
}

export function remainingCups(stampCount: number): number {
  return Math.max(MAX_STAMPS - stampCount, 0);
}

const riyadhFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Formats an ISO/UTC timestamp as "YYYY-MM-DD HH:mm:ss" in Asia/Riyadh. */
export function formatRiyadh(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(riyadhFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`;
}
