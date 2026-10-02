/**
 * Orchestrates Apple Wallet: building signed passes and pushing updates.
 */
import type { AppConfig } from "../config";
import type { AccountRow, Repository } from "../data/repository";
import type { Logger } from "../lib/logger";
import { passAuthToken, createQrToken, qrPayloadUrl } from "../security/tokens";
import type { WalletPushNotifier } from "./apns";
import { passImagesFor } from "./assets";
import { buildPassJson } from "./pass-content";
import { assemblePkpass, type PassGenerator, type PassFiles } from "./pkpass";
import { SigningMaterialError } from "./pem";
import { loadSigningMaterial, signManifest, type SigningSecrets } from "./signer";

export class WalletUnavailableError extends Error {
  constructor(readonly code: "WALLET_MOCK_MODE" | "WALLET_NOT_CONFIGURED" | "WALLET_SIGNING_FAILED") {
    super(code);
    this.name = "WalletUnavailableError";
  }
}

/** Default generator: PKI.js CMS + WebCrypto RSA + fflate zip. */
export class WebCryptoPassGenerator implements PassGenerator {
  constructor(
    private readonly secrets: SigningSecrets,
    private readonly identity: { passTypeIdentifier: string; teamIdentifier: string },
  ) {}

  async generate(files: PassFiles): Promise<Uint8Array> {
    const material = await loadSigningMaterial(this.secrets, this.identity);
    return assemblePkpass(files, (manifest) => signManifest(manifest, material));
  }
}

export class WalletService {
  constructor(
    private readonly config: AppConfig,
    private readonly repo: Repository,
    private readonly notifier: WalletPushNotifier,
    private readonly logger: Logger,
    private readonly generator: PassGenerator | null,
  ) {}

  async qrPayload(account: Pick<AccountRow, "qrTokenId">): Promise<string> {
    const token = await createQrToken(this.config.qrTokenSecret, account.qrTokenId);
    return qrPayloadUrl(this.config.appUrl, token);
  }

  async passJson(account: AccountRow): Promise<Record<string, unknown>> {
    return buildPassJson(account, {
      passTypeIdentifier: this.config.wallet.passTypeIdentifier ?? "pass.example.unconfigured",
      teamIdentifier: this.config.wallet.teamIdentifier ?? "UNCONFIGURED",
      webServiceURL: this.config.appUrl,
      authenticationToken: await passAuthToken(this.config.passAuthSecret, account.passSerial),
      qrPayload: await this.qrPayload(account),
    });
  }

  /** Builds a signed .pkpass. Throws WalletUnavailableError when not possible. */
  async buildPkpass(account: AccountRow): Promise<Uint8Array> {
    if (this.config.wallet.mode !== "production") throw new WalletUnavailableError("WALLET_MOCK_MODE");
    if (!this.config.wallet.ready || !this.generator) throw new WalletUnavailableError("WALLET_NOT_CONFIGURED");
    const passJson = await this.passJson(account);
    const files: PassFiles = {
      "pass.json": new TextEncoder().encode(JSON.stringify(passJson)),
      ...passImagesFor(account.stampCount, account.membershipStatus === "cancelled"),
    };
    try {
      return await this.generator.generate(files);
    } catch (err) {
      // Log a safe, actionable reason; never certificate/key content.
      this.logger.error("wallet.signing_failed", {
        reason: err instanceof SigningMaterialError ? err.message : err instanceof Error ? err.name : "unknown",
      });
      throw new WalletUnavailableError("WALLET_SIGNING_FAILED");
    }
  }

  /**
   * Called after every loyalty mutation: signals each registered device to
   * fetch the updated pass. Invalid push tokens are removed per Apple's docs.
   */
  async passChanged(passSerial: string): Promise<{ attempted: number; sent: number; removed: number }> {
    const stats = { attempted: 0, sent: 0, removed: 0 };
    let targets;
    try {
      targets = await this.repo.walletPushTargets(passSerial);
    } catch (err) {
      this.logger.error("wallet.push_targets_failed", { error: err instanceof Error ? err.message : "unknown" });
      return stats;
    }
    if (targets.length === 0) {
      if (this.notifier.kind === "mock") {
        this.logger.info("wallet.mock_refresh", { note: "pass changed; no registered devices (mock mode)" });
      }
      return stats;
    }
    await Promise.all(
      targets.map(async (t) => {
        stats.attempted += 1;
        const outcome = await this.notifier.notify(t.pushToken);
        if (outcome === "sent") stats.sent += 1;
        if (outcome === "invalid-token") {
          stats.removed += 1;
          await this.repo.walletDeleteDevice(t.deviceLibraryIdentifier).catch(() => undefined);
        }
      }),
    );
    this.logger.info("wallet.push_summary", { ...stats, transport: this.notifier.kind });
    return stats;
  }
}
