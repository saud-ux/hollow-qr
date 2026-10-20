import { parseEmailLink, type EmailLink } from "../../shared/email-links";

let callback: EmailLink | null = null;

/** Run before Supabase initialization. Keep credentials in memory only and
 * remove them from browser history; let the customer choose app or website.
 */
export function captureEmailCallback(appUrl: string): boolean {
  callback = parseEmailLink(window.location.href, appUrl);
  if (!callback) return false;
  window.history.replaceState(window.history.state, "", "/auth/callback");
  return true;
}

export function capturedEmailCallback(): EmailLink | null { return callback; }
export function forgetEmailCallback(): void { callback = null; }
