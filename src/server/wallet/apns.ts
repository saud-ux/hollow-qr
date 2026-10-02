/**
 * Apple Wallet pass-update push notifications.
 *
 * Apple: pass update pushes use the SAME Pass Type ID certificate that signs
 * the pass (certificate-based APNs auth), the device's push token, the
 * pass type identifier as the topic and an EMPTY JSON dictionary as payload.
 * They work only against the production APNs environment.
 *
 * On Cloudflare Workers, client certificates are presented through an mTLS
 * certificate binding (APPLE_APNS_MTLS): the certificate + key are uploaded
 * with `wrangler mtls-certificate upload` and never appear in Worker code or
 * env vars. Cloudflare's edge negotiates HTTP/2 with api.push.apple.com.
 *
 * Everything sits behind WalletPushNotifier so another transport (e.g. a
 * small relay) can be dropped in if ever required.
 */
import type { FetcherLike } from "../platform";
import type { Logger } from "../lib/logger";

export type PushOutcome = "sent" | "invalid-token" | "failed" | "skipped";

export interface WalletPushNotifier {
  readonly kind: "mock" | "apns-mtls" | "disabled";
  notify(pushToken: string): Promise<PushOutcome>;
}

export const APNS_PRODUCTION_HOST = "https://api.push.apple.com";

export class MtlsApnsNotifier implements WalletPushNotifier {
  readonly kind = "apns-mtls" as const;

  constructor(
    private readonly mtls: FetcherLike,
    private readonly passTypeIdentifier: string,
    private readonly logger: Logger,
  ) {}

  async notify(pushToken: string): Promise<PushOutcome> {
    if (!/^[0-9a-fA-F]{32,200}$/.test(pushToken)) return "invalid-token";
    try {
      const res = await this.mtls.fetch(`${APNS_PRODUCTION_HOST}/3/device/${pushToken}`, {
        method: "POST",
        headers: {
          "apns-topic": this.passTypeIdentifier,
          "content-type": "application/json",
        },
        body: "{}",
      });
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
      this.logger.warn("apns.push_failed", { status: res.status, reason });
      return "failed";
    } catch (err) {
      this.logger.error("apns.push_error", { error: err instanceof Error ? err.name : "unknown" });
      return "failed";
    }
  }
}

/** Development / mock mode: records what would have happened. */
export class MockPushNotifier implements WalletPushNotifier {
  readonly kind = "mock" as const;
  readonly sent: string[] = [];

  constructor(private readonly logger: Logger) {}

  notify(pushToken: string): Promise<PushOutcome> {
    this.sent.push(pushToken);
    this.logger.info("wallet.mock_push", { note: "Wallet refresh would have been triggered" });
    return Promise.resolve("sent");
  }
}

/** Production mode without the mTLS binding: passes still update on manual refresh. */
export class DisabledPushNotifier implements WalletPushNotifier {
  readonly kind = "disabled" as const;
  constructor(private readonly logger: Logger) {}
  notify(): Promise<PushOutcome> {
    this.logger.warn("wallet.push_disabled", { note: "APPLE_APNS_MTLS binding not configured" });
    return Promise.resolve("skipped");
  }
}
