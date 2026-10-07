/**
 * Push notifications to the HOLLOW iOS app (order status updates).
 *
 * Unlike Wallet pass updates (certificate auth over the mTLS binding), app
 * pushes use APNs token auth: a short ES256 JWT signed with an APNs .p8 key
 * (APNS_AUTH_KEY secret, APNS_KEY_ID var) and the Team ID. The topic is the
 * app's bundle id. App Store / TestFlight builds use the production APNs host.
 */
import type { Logger } from "../lib/logger";
import { base64ToBytes, bytesToBase64Url, utf8 } from "../security/encoding";
import { APNS_PRODUCTION_HOST, type PushOutcome } from "../wallet/apns";
import { asPem } from "../wallet/pem";

export interface AppPushMessage {
  title: string;
  body: string;
  /** Replaces an earlier notification with the same id (e.g. one per order). */
  collapseId?: string;
  /** Custom keys delivered next to `aps` (strings only). */
  data?: Record<string, string>;
}

/** What the lock-screen order tracker shows; must match ContentState in OrderActivity.swift. */
export interface LiveActivityState {
  status: string;
  label: string;
  /** 0-based position of `status` in the order's steps. */
  step: number;
  steps: number;
}

export interface LiveActivityUpdate {
  event: "update" | "end";
  state: LiveActivityState;
  /** For "end": when iOS removes it from the lock screen. */
  dismissAt?: Date;
  /** Lights the screen and shows the update expanded, like a notification. */
  alert?: { title: string; body: string };
}

export interface AppPushSender {
  readonly kind: "apns" | "mock" | "disabled";
  send(deviceToken: string, message: AppPushMessage): Promise<PushOutcome>;
  /** Updates or ends a Live Activity through its own push token. */
  sendLiveActivity(activityToken: string, update: LiveActivityUpdate): Promise<PushOutcome>;
}

export class AppPushKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppPushKeyError";
  }
}

/** Accepts the .p8 file contents as-is, or base64 of the file. */
export function apnsKeyDer(secret: string): Uint8Array<ArrayBuffer> {
  const value = secret.trim();
  let bytes: Uint8Array<ArrayBuffer>;
  if (value.includes("-----BEGIN")) bytes = utf8(value);
  else {
    try {
      bytes = base64ToBytes(value.replace(/\s+/g, ""));
    } catch {
      throw new AppPushKeyError("APNS_AUTH_KEY is neither PEM nor base64");
    }
  }
  const pem = asPem(bytes);
  if (!pem) return bytes;
  const block = pem.find((b) => b.label === "PRIVATE KEY");
  if (!block) throw new AppPushKeyError("APNS_AUTH_KEY must contain a 'BEGIN PRIVATE KEY' block (the .p8 file)");
  return block.der;
}

/** APNs accepts a provider token for up to an hour; refresh well before. */
const TOKEN_TTL_MS = 45 * 60 * 1000;

export class ApnsTokenSender implements AppPushSender {
  readonly kind = "apns" as const;
  private key: Promise<CryptoKey> | null = null;
  private token: { value: string; issuedAt: number } | null = null;

  constructor(
    private readonly options: { authKey: string; keyId: string; teamId: string; bundleId: string; host?: string },
    private readonly logger: Logger,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = () => Date.now(),
  ) {}

  private signingKey(): Promise<CryptoKey> {
    this.key ??= crypto.subtle
      .importKey("pkcs8", apnsKeyDer(this.options.authKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
      .catch((err: unknown) => {
        this.key = null;
        if (err instanceof AppPushKeyError) throw err;
        throw new AppPushKeyError("APNS_AUTH_KEY could not be imported (expected the P-256 .p8 key from Apple)");
      });
    return this.key;
  }

  /** The bearer JWT; reused across requests in this isolate. */
  async providerToken(): Promise<string> {
    const now = this.now();
    if (this.token && now - this.token.issuedAt < TOKEN_TTL_MS) return this.token.value;
    const header = bytesToBase64Url(utf8(JSON.stringify({ alg: "ES256", kid: this.options.keyId })));
    const claims = bytesToBase64Url(utf8(JSON.stringify({ iss: this.options.teamId, iat: Math.floor(now / 1000) })));
    const input = `${header}.${claims}`;
    // WebCrypto returns the raw r||s signature JWS expects for ES256.
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await this.signingKey(), utf8(input));
    const value = `${input}.${bytesToBase64Url(new Uint8Array(sig))}`;
    this.token = { value, issuedAt: now };
    return value;
  }

  send(deviceToken: string, message: AppPushMessage): Promise<PushOutcome> {
    if (!/^[0-9a-f]{64,200}$/.test(deviceToken)) return Promise.resolve("invalid-token");
    const headers: Record<string, string> = { "apns-topic": this.options.bundleId, "apns-push-type": "alert" };
    if (message.collapseId) headers["apns-collapse-id"] = message.collapseId.slice(0, 64);
    const payload = {
      aps: { alert: { title: message.title, body: message.body }, sound: "default" },
      ...message.data,
    };
    return this.post(deviceToken, headers, payload);
  }

  sendLiveActivity(activityToken: string, update: LiveActivityUpdate): Promise<PushOutcome> {
    if (!/^[0-9a-f]{32,400}$/.test(activityToken)) return Promise.resolve("invalid-token");
    const aps: Record<string, unknown> = {
      timestamp: Math.floor(this.now() / 1000),
      event: update.event,
      "content-state": update.state,
    };
    if (update.dismissAt) aps["dismissal-date"] = Math.floor(update.dismissAt.getTime() / 1000);
    if (update.alert) aps.alert = { title: update.alert.title, body: update.alert.body, sound: "default" };
    const headers = { "apns-topic": `${this.options.bundleId}.push-type.liveactivity`, "apns-push-type": "liveactivity" };
    return this.post(activityToken, headers, { aps });
  }

  private async post(token: string, extraHeaders: Record<string, string>, payload: unknown): Promise<PushOutcome> {
    try {
      const headers: Record<string, string> = {
        authorization: `bearer ${await this.providerToken()}`,
        "apns-priority": "10",
        "content-type": "application/json",
        ...extraHeaders,
      };
      const host = this.options.host ?? APNS_PRODUCTION_HOST;
      const res = await this.fetcher(`${host}/3/device/${token}`, { method: "POST", headers, body: JSON.stringify(payload) });
      if (res.status === 200) return "sent";
      let reason = "";
      try {
        reason = ((await res.json()) as { reason?: string }).reason ?? "";
      } catch {
        // body is optional
      }
      if (res.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic") {
        return "invalid-token";
      }
      // ExpiredProviderToken / InvalidProviderToken: mint a fresh token next time.
      if (res.status === 403) this.token = null;
      this.logger.warn("app_push.failed", { status: res.status, reason });
      return "failed";
    } catch (err) {
      this.logger.error("app_push.error", { error: err instanceof Error ? `${err.name}: ${err.message}` : "unknown" });
      return "failed";
    }
  }
}

/** Development and tests: records what would have been sent. */
export class MockAppPushSender implements AppPushSender {
  readonly kind = "mock" as const;
  readonly sent: { token: string; message: AppPushMessage }[] = [];
  readonly liveSent: { token: string; update: LiveActivityUpdate }[] = [];

  constructor(private readonly logger: Logger) {}

  send(token: string, message: AppPushMessage): Promise<PushOutcome> {
    this.sent.push({ token, message });
    this.logger.info("app_push.mock", { title: message.title });
    return Promise.resolve("sent");
  }

  sendLiveActivity(token: string, update: LiveActivityUpdate): Promise<PushOutcome> {
    this.liveSent.push({ token, update });
    return Promise.resolve("sent");
  }
}

/** Production without an APNs key: ordering works, the app just isn't notified. */
export class DisabledAppPushSender implements AppPushSender {
  readonly kind = "disabled" as const;
  send(): Promise<PushOutcome> {
    return Promise.resolve("skipped");
  }
  sendLiveActivity(): Promise<PushOutcome> {
    return Promise.resolve("skipped");
  }
}
