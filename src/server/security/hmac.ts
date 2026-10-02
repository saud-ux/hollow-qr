import { bytesToBase64Url, utf8 } from "./encoding";

// Imported HMAC keys are cached per isolate so we do not re-import on every call.
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keyCache.set(secret, key);
  }
  return key;
}

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(message)));
}

/** HMAC-SHA256 as base64url, optionally truncated to `bytes` bytes. */
export async function hmacBase64Url(secret: string, message: string, bytes?: number): Promise<string> {
  const mac = await hmacSha256(secret, message);
  return bytesToBase64Url(bytes ? mac.subarray(0, bytes) : mac);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(input)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
