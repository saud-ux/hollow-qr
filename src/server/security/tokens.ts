/**
 * Token derivations. All tokens are HMACs over a domain-separated message so
 * the same secret can never produce a token valid in another context.
 *
 *  - QR token       "<qr_token_id>.<HMAC(QR_TOKEN_SECRET, 'hollow-qr:v1:'+id)[0..16]>"
 *                   Stable for the life of the pass, contains no personal data
 *                   or database primary keys, verified before any DB lookup.
 *  - Pass auth      HMAC(PASS_AUTH_SECRET, 'hollow-pass-auth:v1:'+serial)
 *                   Apple Wallet "authenticationToken". Independent of the QR,
 *                   stable across updates, never stored in plaintext.
 *  - Download link  HMAC(PASS_AUTH_SECRET, 'hollow-pass-download:v1:'+serial+':'+exp)
 *                   Short-lived signed URL so Safari can navigate directly to
 *                   the .pkpass (navigation cannot carry a Bearer header).
 */
import { QR_TOKEN_PATTERN } from "../../shared/constants";
import { timingSafeEqualStr } from "./encoding";
import { hmacBase64Url } from "./hmac";

const QR_SIG_BYTES = 16; // 128-bit truncated HMAC -> 22 base64url chars

export async function createQrToken(secret: string, qrTokenId: string): Promise<string> {
  const sig = await hmacBase64Url(secret, `hollow-qr:v1:${qrTokenId}`, QR_SIG_BYTES);
  return `${qrTokenId}.${sig}`;
}

/** Returns the qr_token_id if the token is well-formed and authentic, else null. */
export async function verifyQrToken(secret: string, token: string): Promise<string | null> {
  if (!QR_TOKEN_PATTERN.test(token)) return null;
  const [id, sig] = token.split(".") as [string, string];
  const expected = await hmacBase64Url(secret, `hollow-qr:v1:${id}`, QR_SIG_BYTES);
  return timingSafeEqualStr(sig, expected) ? id : null;
}

export function qrPayloadUrl(appUrl: string, token: string): string {
  return `${appUrl}/c/${token}`;
}

/**
 * Extracts a QR token from scanned text. Accepts our full URL
 * (https://host/c/<token>) or the bare token. Returns null otherwise.
 */
export function extractQrToken(scanned: string): string | null {
  const text = scanned.trim();
  if (text.length > 512) return null;
  if (QR_TOKEN_PATTERN.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const match = /^\/c\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return null;
    const token = decodeURIComponent(match[1]!);
    return QR_TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}

export async function passAuthToken(secret: string, serial: string): Promise<string> {
  return hmacBase64Url(secret, `hollow-pass-auth:v1:${serial}`);
}

/** Validates an `Authorization: ApplePass <token>` header for a serial. */
export async function verifyApplePassAuthorization(
  secret: string,
  serial: string,
  header: string | undefined | null,
): Promise<boolean> {
  if (!header) return false;
  const match = /^ApplePass\s+(\S+)$/.exec(header.trim());
  if (!match) return false;
  const expected = await passAuthToken(secret, serial);
  return timingSafeEqualStr(match[1]!, expected);
}

export async function signPassDownload(secret: string, serial: string, expiresAtSec: number): Promise<string> {
  return hmacBase64Url(secret, `hollow-pass-download:v1:${serial}:${expiresAtSec}`);
}

export async function verifyPassDownload(
  secret: string,
  serial: string,
  expiresAtSec: number,
  signature: string,
  nowSec: number,
): Promise<"ok" | "expired" | "invalid"> {
  if (!Number.isSafeInteger(expiresAtSec)) return "invalid";
  const expected = await signPassDownload(secret, serial, expiresAtSec);
  if (!timingSafeEqualStr(signature, expected)) return "invalid";
  return expiresAtSec < nowSec ? "expired" : "ok";
}
