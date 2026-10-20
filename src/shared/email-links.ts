export interface EmailLinkSession {
  kind: "session";
  type: "signup" | "recovery";
  access_token: string;
  refresh_token: string;
  path: string;
}
export type EmailLink = EmailLinkSession | { kind: "error"; path: string };

/** Email links may only return to customer screens, never an external URL. */
export function emailReturnPath(value: string | null): string {
  if (value === "/cart" || value === "/menu" || value === "/wallet" || value === "/wallet?welcome=1" || value === "/reset-password") return value;
  return "/wallet";
}

/** Keep normal browser email links unchanged; native requests use an HTTPS
 * Universal Link which still works on a phone without the app installed.
 */
export function emailRedirectUrl(appUrl: string, next: string, native: boolean): string {
  if (!native) return new URL(next, appUrl).href;
  const url = new URL("/auth/callback", appUrl);
  url.searchParams.set("next", emailReturnPath(next));
  return url.href;
}

/** Accept only our exact HTTPS origin or the registered auth scheme/path.
 * Credentials must be in the fragment, not a query that servers could log.
 */
export function parseEmailLink(raw: string, appUrl: string): EmailLink | null {
  let url: URL;
  try {
    url = new URL(raw);
    const web = url.protocol === "https:" && url.origin === new URL(appUrl).origin && url.pathname === "/auth/callback";
    const app = url.protocol === "hollowcoffee:" && url.hostname === "auth" && url.pathname === "/callback" && !url.port;
    if ((!web && !app) || url.username || url.password) return null;
  } catch { return null; }
  const hash = new URLSearchParams(url.hash.slice(1));
  const type = hash.get("type");
  const path = type === "recovery" ? "/reset-password" : emailReturnPath(url.searchParams.get("next"));
  const access = hash.get("access_token");
  const refresh = hash.get("refresh_token");
  if (hash.has("error") || hash.has("error_code") || hash.has("error_description") ||
      (type !== "signup" && type !== "recovery") ||
      !access || !refresh || !/^[A-Za-z0-9._-]{20,8192}$/.test(access) || !/^[A-Za-z0-9._-]{8,8192}$/.test(refresh)) {
    return { kind: "error", path };
  }
  // A confirmation link must never masquerade as a password-recovery link.
  return { kind: "session", type, access_token: access, refresh_token: refresh,
    path: type === "recovery" ? "/reset-password" : path === "/reset-password" ? "/wallet" : path };
}

/** Explicit fallback button when iOS/mail does not follow a Universal Link. */
export function emailAppUrl(link: EmailLinkSession): string {
  const url = new URL("hollowcoffee://auth/callback");
  url.searchParams.set("next", link.path);
  url.hash = new URLSearchParams({ access_token: link.access_token, refresh_token: link.refresh_token, type: link.type }).toString();
  return url.href;
}
