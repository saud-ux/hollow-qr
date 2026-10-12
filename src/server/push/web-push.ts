/**
 * Browser notifications for the website (Web Push: RFC 8030, 8291, 8292).
 *
 * The browser gives us a subscription: an endpoint at its push service
 * (Apple, Google, Mozilla, Microsoft) and two keys. Each message is encrypted
 * for that one browser (aes128gcm) and the request is signed with our VAPID
 * key, so only this server can push to it. The VAPID key pair is made on first
 * use and kept in the database: there is nothing to configure.
 */
import type { Logger } from "../lib/logger";
import { base64UrlToBytes, bytesToBase64Url, bytesToHex, utf8 } from "../security/encoding";
import type { PushOutcome } from "../wallet/apns";
import type { AppPushMessage } from "./app-push";

export interface WebPushSubscription {
  endpoint: string;
  /** The browser's P-256 public key (base64url, 65 bytes uncompressed). */
  p256dh: string;
  /** The browser's auth secret (base64url, 16 bytes). */
  auth: string;
}

export interface VapidKeys {
  /** base64url of the uncompressed P-256 point: the browser subscribes with it. */
  publicKey: string;
  privateJwk: JsonWebKey;
}

export interface WebPushSender {
  readonly kind: "web" | "mock" | "disabled";
  /** The key the browser subscribes with. */
  publicKey(): Promise<string>;
  send(sub: WebPushSubscription, message: AppPushMessage): Promise<PushOutcome>;
}

// Only real push services: the endpoint comes from the browser, and we POST to it.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && url.port === "" && url.username === "" && PUSH_HOSTS.test(url.hostname);
  } catch {
    return false;
  }
}

/** The push_devices key for a browser: the SHA-256 of its endpoint, in hex. */
export async function webPushToken(endpoint: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(endpoint))));
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  return { publicKey, privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey) };
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** The P-256 point as a JWK (for importing a private key from its parts). */
export function p256Jwk(publicRaw: Uint8Array, d?: string): JsonWebKey {
  return {
    kty: "EC",
    crv: "P-256",
    x: bytesToBase64Url(publicRaw.subarray(1, 33)),
    y: bytesToBase64Url(publicRaw.subarray(33, 65)),
    ...(d ? { d } : {}),
  };
}

const RECORD_SIZE = 4096;

/**
 * Encrypts one message for one browser (RFC 8291, aes128gcm, a single record).
 * `fixed` pins the random parts, for the RFC's worked example in the tests.
 */
export async function encryptForBrowser(
  sub: Pick<WebPushSubscription, "p256dh" | "auth">,
  plaintext: Uint8Array,
  fixed?: { salt: Uint8Array<ArrayBuffer>; serverPrivateJwk: JsonWebKey; serverPublic: Uint8Array<ArrayBuffer> },
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = base64UrlToBytes(sub.p256dh);
  const authSecret = base64UrlToBytes(sub.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error("invalid subscription keys");

  let asPrivate: CryptoKey;
  let asPublic: Uint8Array<ArrayBuffer>;
  if (fixed) {
    asPrivate = await crypto.subtle.importKey("jwk", fixed.serverPrivateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    asPublic = fixed.serverPublic;
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

  const ikm = await hkdf(authSecret, shared, concat(utf8("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  // One record: the message, then the 0x02 "last record" delimiter, no padding.
  const record = concat(plaintext, new Uint8Array([2]));
  if (record.length + 16 > RECORD_SIZE) throw new Error("message too large");
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, record));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, sealed);
}

/** What the service worker (public/sw.js) shows, and where a tap leads. */
export function webPushPayload(message: AppPushMessage): { title: string; body: string; tag?: string; url: string } {
  const data = message.data ?? {};
  let url = "/menu";
  if (data.orderId && /^[0-9a-f-]{36}$/i.test(data.orderId)) url = `/orders/${data.orderId}`;
  else if (data.link === "staff-orders") url = "/staff/orders";
  return { title: message.title.slice(0, 120), body: message.body.slice(0, 400), ...(message.collapseId ? { tag: message.collapseId } : {}), url };
}

/** The Topic header (replaces an undelivered message): at most 32 URL-safe characters. */
async function topicFor(collapseId: string): Promise<string> {
  if (/^[A-Za-z0-9_-]{1,32}$/.test(collapseId)) return collapseId;
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(collapseId)))).slice(0, 32);
}

/** A VAPID token is good for up to 24 hours; one per push service, refreshed well before. */
const VAPID_TTL_S = 12 * 60 * 60;

export class VapidWebPushSender implements WebPushSender {
  readonly kind = "web" as const;
  private signer: Promise<{ keys: VapidKeys; key: CryptoKey }> | null = null;
  private tokens = new Map<string, { value: string; expires: number }>();

  constructor(
    private readonly loadKeys: () => Promise<VapidKeys>,
    /** Who runs this server (VAPID "sub"): the website's https URL. */
    private readonly subject: string,
    private readonly logger: Logger,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = () => Date.now(),
  ) {}

  private signing() {
    this.signer ??= this.loadKeys()
      .then(async (keys) => ({
        keys,
        key: await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]),
      }))
      .catch((err: unknown) => {
        this.signer = null;
        throw err;
      });
    return this.signer;
  }

  async publicKey(): Promise<string> {
    return (await this.signing()).keys.publicKey;
  }

  private async authorization(endpoint: string): Promise<string> {
    const { keys, key } = await this.signing();
    const aud = new URL(endpoint).origin;
    const nowS = Math.floor(this.now() / 1000);
    let token = this.tokens.get(aud);
    if (!token || token.expires - nowS < 60 * 60) {
      const expires = nowS + VAPID_TTL_S;
      const header = bytesToBase64Url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
      const claims = bytesToBase64Url(utf8(JSON.stringify({ aud, exp: expires, sub: this.subject })));
      const input = `${header}.${claims}`;
      const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(input));
      token = { value: `${input}.${bytesToBase64Url(new Uint8Array(sig))}`, expires };
      this.tokens.set(aud, token);
    }
    return `vapid t=${token.value}, k=${keys.publicKey}`;
  }

  async send(sub: WebPushSubscription, message: AppPushMessage): Promise<PushOutcome> {
    if (!isPushEndpoint(sub.endpoint)) return "invalid-token";
    try {
      const body = await encryptForBrowser(sub, utf8(JSON.stringify(webPushPayload(message))));
      const headers: Record<string, string> = {
        authorization: await this.authorization(sub.endpoint),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(24 * 60 * 60),
        urgency: "high",
      };
      if (message.collapseId) headers.topic = await topicFor(message.collapseId);
      const res = await this.fetcher(sub.endpoint, { method: "POST", headers, body });
      if (res.status >= 200 && res.status < 300) return "sent";
      // Gone: the customer turned notifications off or cleared the site's data.
      if (res.status === 404 || res.status === 410) return "invalid-token";
      this.logger.warn("web_push.failed", { status: res.status, host: new URL(sub.endpoint).hostname });
      return "failed";
    } catch (err) {
      if (err instanceof Error && err.message === "invalid subscription keys") return "invalid-token";
      this.logger.error("web_push.error", { error: err instanceof Error ? `${err.name}: ${err.message}` : "unknown" });
      return "failed";
    }
  }
}

/** Development and tests: records what would have been sent. */
export class MockWebPushSender implements WebPushSender {
  readonly kind = "mock" as const;
  readonly sent: { endpoint: string; message: AppPushMessage }[] = [];
  private key: Promise<string> | null = null;

  constructor(private readonly logger: Logger) {}

  publicKey(): Promise<string> {
    this.key ??= generateVapidKeys().then((k) => k.publicKey);
    return this.key;
  }

  send(sub: WebPushSubscription, message: AppPushMessage): Promise<PushOutcome> {
    this.sent.push({ endpoint: sub.endpoint, message });
    this.logger.info("web_push.mock", { title: message.title });
    return Promise.resolve("sent");
  }
}

/** No database to keep the keys in: the website just isn't notified. */
export class DisabledWebPushSender implements WebPushSender {
  readonly kind = "disabled" as const;
  publicKey(): Promise<string> {
    return Promise.reject(new Error("web push disabled"));
  }
  send(): Promise<PushOutcome> {
    return Promise.resolve("skipped");
  }
}
