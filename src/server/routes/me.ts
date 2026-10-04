import { Hono } from "hono";
import type { CustomerCard, MeResponse } from "../../shared/types";
import { assertCoreSecrets } from "../config";
import type { AccountRow } from "../data/repository";
import { ApiError } from "../http/errors";
import { repoOf, walletOf, type AppContext, type HonoEnv } from "../http/context";
import { rateLimit, requireUser } from "../http/middleware";
import { signPassDownload, verifyPassDownload } from "../security/tokens";
import { PKPASS_MIME } from "../wallet/pkpass";
import { WalletUnavailableError } from "../wallet/service";

const DOWNLOAD_TTL_SECONDS = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownAccount(c: AppContext): Promise<AccountRow> {
  const user = c.get("user");
  const { config } = c.get("deps");
  if (config.requireEmailConfirmation && !user.emailConfirmed) throw new ApiError(403, "EMAIL_NOT_CONFIRMED");
  const repo = repoOf(c);
  let account = await repo.getAccountByUserId(user.id);
  if (!account && user.role === "customer") {
    // Self-heal for users created before the provisioning trigger existed.
    await repo.ensureLoyaltyAccount(user.id);
    account = await repo.getAccountByUserId(user.id);
  }
  if (!account) throw new ApiError(404, "NOT_FOUND");
  return account;
}

async function toCard(c: AppContext, account: AccountRow): Promise<CustomerCard> {
  const { config } = c.get("deps");
  assertCoreSecrets(config);
  return {
    displayName: account.displayName,
    memberId: account.memberId,
    stampCount: account.stampCount,
    rewardAvailable: account.rewardAvailable,
    membershipStatus: account.membershipStatus,
    qrPayload: await walletOf(c).qrPayload(account),
    createdAt: account.createdAt,
    walletMode: config.wallet.mode,
    walletReady: config.wallet.ready,
  };
}

export const meRoutes = new Hono<HonoEnv>()
  .get("/me", requireUser, rateLimit("api", "user"), async (c) => {
    const user = c.get("user");
    const { config } = c.get("deps");
    let card: CustomerCard | null = null;
    const mayHaveCard = !(config.requireEmailConfirmation && !user.emailConfirmed);
    if (mayHaveCard && user.role === "customer") {
      card = await toCard(c, await ownAccount(c));
    } else if (mayHaveCard) {
      const account = await repoOf(c).getAccountByUserId(user.id);
      card = account ? await toCard(c, account) : null;
    }
    const body: MeResponse = {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        emailConfirmed: user.emailConfirmed,
      },
      card,
    };
    return c.json(body);
  })

  // Issues a short-lived signed URL so Safari can navigate straight to the
  // .pkpass (iOS hands application/vnd.apple.pkpass responses to Wallet).
  .post("/wallet/pass-link", requireUser, rateLimit("api", "user"), async (c) => {
    const { config, now } = c.get("deps");
    const account = await ownAccount(c);
    if (config.wallet.mode !== "production") throw new ApiError(409, "WALLET_MOCK_MODE");
    if (!config.wallet.ready) throw new ApiError(503, "WALLET_NOT_CONFIGURED");
    const exp = Math.floor(now().getTime() / 1000) + DOWNLOAD_TTL_SECONDS;
    const sig = await signPassDownload(config.passAuthSecret, account.passSerial, exp);
    const url = `${config.appUrl}/api/wallet/pass/${account.passSerial}?exp=${exp}&sig=${sig}`;
    return c.json({ url, expiresAt: new Date(exp * 1000).toISOString() });
  })

  .get("/wallet/pass/:serial", rateLimit("wallet"), async (c) => {
    const { config, now } = c.get("deps");
    const serial = c.req.param("serial");
    const exp = Number(c.req.query("exp"));
    const sig = c.req.query("sig") ?? "";
    if (!UUID_RE.test(serial) || !/^[A-Za-z0-9_-]{20,64}$/.test(sig)) throw new ApiError(404, "NOT_FOUND");
    const verdict = await verifyPassDownload(config.passAuthSecret, serial, exp, sig, Math.floor(now().getTime() / 1000));
    if (verdict === "invalid") throw new ApiError(404, "NOT_FOUND");
    if (verdict === "expired") throw new ApiError(410, "LINK_EXPIRED");
    const account = await repoOf(c).getAccountBySerial(serial.toLowerCase());
    if (!account) throw new ApiError(404, "NOT_FOUND");
    let pkpass: Uint8Array;
    try {
      pkpass = await walletOf(c).buildPkpass(account);
    } catch (err) {
      if (err instanceof WalletUnavailableError) throw new ApiError(503, err.code);
      throw err;
    }
    return new Response(pkpass.slice().buffer, {
      status: 200,
      headers: {
        "Content-Type": PKPASS_MIME,
        "Content-Disposition": 'attachment; filename="hollow-rewards.pkpass"',
        "Cache-Control": "no-store",
        "Last-Modified": new Date(account.walletUpdatedAt).toUTCString(),
      },
    });
  })

  // Development aid: inspect the pass.json that WOULD be signed. Disabled in
  // production deployments; never includes certificates.
  .get("/wallet/pass-json", requireUser, async (c) => {
    const { config } = c.get("deps");
    if (config.isProduction) throw new ApiError(404, "NOT_FOUND");
    const account = await ownAccount(c);
    return c.json(await walletOf(c).passJson(account));
  });
