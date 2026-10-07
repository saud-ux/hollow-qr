import { Hono } from "hono";
import { z } from "zod";
import type { CustomerCard, MeResponse } from "../../shared/types";
import { DISPLAY_NAME_MAX_LENGTH } from "../../shared/constants";
import { assertCoreSecrets } from "../config";
import type { AccountRow, PlaceInput, SavePlaceResult } from "../data/repository";
import { ApiError } from "../http/errors";
import { repoOf, runInBackground, walletOf, type AppContext, type HonoEnv } from "../http/context";
import { rateLimit, requireUser } from "../http/middleware";
import { parseJsonBody } from "../http/validation";
import { signPassDownload, verifyPassDownload } from "../security/tokens";
import { PKPASS_MIME } from "../wallet/pkpass";
import { WalletUnavailableError } from "../wallet/service";

const DOWNLOAD_TTL_SECONDS = 300;
const pushTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{64,200}$/),
});

const registerDeviceSchema = pushTokenSchema.extend({ lang: z.enum(["ar", "en"]).optional().default("ar") });

const prefsSchema = z
  .object({ offers: z.boolean(), newOrders: z.boolean(), dailySummary: z.boolean() })
  .partial()
  .refine((p) => Object.keys(p).length > 0, "nothing to update");

const placeSchema = z
  .object({
    kind: z.enum(["home", "work", "other"]),
    label: z.string().trim().max(30).nullish(),
    address: z.string().trim().min(1).max(300),
    details: z.string().trim().max(200).nullish(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .refine((p) => p.kind !== "other" || (p.label ?? "").length > 0, { message: "a named place needs a name", path: ["label"] });

const profileSchema = z.object({ displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH) });

function placeInput(body: z.infer<typeof placeSchema>): PlaceInput {
  return {
    kind: body.kind,
    label: body.kind === "other" ? (body.label ?? null) : null,
    address: body.address,
    details: body.details ? body.details : null,
    lat: body.lat,
    lng: body.lng,
  };
}

function savedOrThrow(result: SavePlaceResult) {
  if (result.ok) return result.place;
  if (result.code === "PLACES_LIMIT") throw new ApiError(409, "PLACES_LIMIT");
  if (result.code === "KIND_TAKEN") throw new ApiError(409, "PLACE_KIND_TAKEN");
  throw new ApiError(404, "NOT_FOUND");
}

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

  // iOS app: register this device for order-status notifications.
  .post("/me/push-devices", requireUser, rateLimit("api", "user"), async (c) => {
    const { token, lang } = await parseJsonBody(c, registerDeviceSchema);
    await repoOf(c).registerPushDevice(c.get("user").id, token, lang);
    return c.json({ ok: true });
  })

  // Push switches. Offers are opt-in; staff alerts only matter for staff/admin.
  .get("/me/notification-prefs", requireUser, rateLimit("api", "user"), async (c) => {
    return c.json({ prefs: await repoOf(c).getNotificationPrefs(c.get("user").id) });
  })

  .put("/me/notification-prefs", requireUser, rateLimit("api", "user"), async (c) => {
    const patch = await parseJsonBody(c, prefsSchema);
    const prefs = await repoOf(c).setNotificationPrefs(c.get("user").id, patch);
    return c.json({ prefs });
  })

  // Account page: the customer's own name (also shown on the Wallet pass).
  .put("/me/profile", requireUser, rateLimit("api", "user"), async (c) => {
    const { displayName } = await parseJsonBody(c, profileSchema);
    const result = await repoOf(c).setDisplayName(c.get("user").id, displayName);
    if (!result) throw new ApiError(404, "NOT_FOUND");
    if (result.passSerial) runInBackground(c, walletOf(c).passChanged(result.passSerial));
    return c.json({ displayName });
  })

  // Saved delivery places (home, work and named ones).
  .get("/me/places", requireUser, rateLimit("api", "user"), async (c) => {
    return c.json({ places: await repoOf(c).listPlaces(c.get("user").id) });
  })

  .post("/me/places", requireUser, rateLimit("api", "user"), async (c) => {
    const body = await parseJsonBody(c, placeSchema);
    const place = savedOrThrow(await repoOf(c).savePlace(c.get("user").id, null, placeInput(body)));
    return c.json({ place }, 201);
  })

  .put("/me/places/:id", requireUser, rateLimit("api", "user"), async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) throw new ApiError(404, "NOT_FOUND");
    const body = await parseJsonBody(c, placeSchema);
    return c.json({ place: savedOrThrow(await repoOf(c).savePlace(c.get("user").id, id, placeInput(body))) });
  })

  .delete("/me/places/:id", requireUser, rateLimit("api", "user"), async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id) || !(await repoOf(c).deletePlace(c.get("user").id, id))) throw new ApiError(404, "NOT_FOUND");
    return c.json({ ok: true });
  })

  // Called on sign-out so the device stops receiving this user's updates.
  .post("/me/push-devices/remove", requireUser, rateLimit("api", "user"), async (c) => {
    const { token } = await parseJsonBody(c, pushTokenSchema);
    await repoOf(c).unregisterPushDevice(c.get("user").id, token);
    return c.json({ ok: true });
  })

  // In-app account deletion (App Store guideline 5.1.1(v)). Customers only:
  // staff accounts are removed by an admin.
  .post("/me/delete", requireUser, rateLimit("api", "user"), async (c) => {
    await parseJsonBody(c, z.object({ confirm: z.literal("DELETE") }));
    const user = c.get("user");
    const repo = repoOf(c);
    if (user.role !== "customer") throw new ApiError(403, "FORBIDDEN");
    const account = await repo.getAccountByUserId(user.id);
    const result = await repo.deleteCustomerAccount(user.id);
    if (!result.ok) {
      if (result.code === "ACTIVE_ORDER") throw new ApiError(409, "ACTIVE_ORDER");
      throw new ApiError(result.code === "NOT_A_CUSTOMER" ? 403 : 404, result.code === "NOT_A_CUSTOMER" ? "FORBIDDEN" : "NOT_FOUND");
    }
    c.get("deps").logger.info("account.deleted", { userId: user.id });
    // A pass still in Wallet refreshes into its cancelled state.
    if (account) runInBackground(c, walletOf(c).passChanged(account.passSerial));
    return c.json({ ok: true });
  })

  // Development aid: inspect the pass.json that WOULD be signed. Disabled in
  // production deployments; never includes certificates.
  .get("/wallet/pass-json", requireUser, async (c) => {
    const { config } = c.get("deps");
    if (config.isProduction) throw new ApiError(404, "NOT_FOUND");
    const account = await ownAccount(c);
    return c.json(await walletOf(c).passJson(account));
  });
