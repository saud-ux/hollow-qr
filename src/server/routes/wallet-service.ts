/**
 * Apple Wallet pass web service (Apple "Adding a Web Service to Update Passes").
 *
 *   POST   /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}
 *            Authorization: ApplePass <authenticationToken>   body {"pushToken": "..."}
 *            201 created | 200 already registered | 401
 *   DELETE /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}
 *            200 | 401
 *   GET    /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}?passesUpdatedSince={tag}
 *            200 {"serialNumbers": [...], "lastUpdated": "<tag>"} | 204
 *   GET    /v1/passes/{passTypeIdentifier}/{serialNumber}
 *            Authorization: ApplePass <token>; supports If-Modified-Since -> 304
 *            200 application/vnd.apple.pkpass | 401
 *   POST   /v1/log   {"logs": [...]} -> 200
 *
 * The authenticationToken is HMAC(PASS_AUTH_SECRET, serial): stable across
 * updates, never stored, verified in constant time.
 */
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../http/errors";
import { repoOf, walletOf, type AppContext, type HonoEnv } from "../http/context";
import { rateLimit } from "../http/middleware";
import { verifyApplePassAuthorization } from "../security/tokens";
import { PKPASS_MIME } from "../wallet/pkpass";
import { WalletUnavailableError } from "../wallet/service";

const DEVICE_RE = /^[A-Za-z0-9._-]{1,128}$/;
const SERIAL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pushTokenSchema = z.object({ pushToken: z.string().regex(/^[0-9a-fA-F]{32,200}$/) });
const logSchema = z.object({ logs: z.array(z.string().max(2000)).max(50) });

function unauthorized(): Response {
  return new Response(null, { status: 401 });
}

function checkPassType(c: AppContext, passTypeIdentifier: string): boolean {
  const configured = c.get("deps").config.wallet.passTypeIdentifier;
  return Boolean(configured) && configured === passTypeIdentifier;
}

async function authorized(c: AppContext, serial: string): Promise<boolean> {
  if (!SERIAL_RE.test(serial)) return false;
  return verifyApplePassAuthorization(c.get("deps").config.passAuthSecret, serial, c.req.header("authorization"));
}

export const walletServiceRoutes = new Hono<HonoEnv>()
  .use("*", rateLimit("wallet"))

  .post("/devices/:device/registrations/:passType/:serial", async (c) => {
    const { device, passType, serial } = c.req.param();
    if (!DEVICE_RE.test(device) || !checkPassType(c, passType)) return unauthorized();
    if (!(await authorized(c, serial))) return unauthorized();
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return new Response(null, { status: 400 });
    }
    const parsed = pushTokenSchema.safeParse(body);
    if (!parsed.success) return new Response(null, { status: 400 });
    const result = await repoOf(c).walletRegisterDevice(device, parsed.data.pushToken, passType, serial);
    if (result === "unknown_pass") return unauthorized();
    return new Response(null, { status: result === "created" ? 201 : 200 });
  })

  .delete("/devices/:device/registrations/:passType/:serial", async (c) => {
    const { device, passType, serial } = c.req.param();
    if (!DEVICE_RE.test(device) || !checkPassType(c, passType)) return unauthorized();
    if (!(await authorized(c, serial))) return unauthorized();
    await repoOf(c).walletUnregisterDevice(device, passType, serial);
    return new Response(null, { status: 200 });
  })

  .get("/devices/:device/registrations/:passType", async (c) => {
    const { device, passType } = c.req.param();
    if (!DEVICE_RE.test(device) || !checkPassType(c, passType)) return new Response(null, { status: 204 });
    const sinceRaw = c.req.query("passesUpdatedSince");
    const since = sinceRaw && /^\d{1,20}$/.test(sinceRaw) ? BigInt(sinceRaw) : null;
    const updated = await repoOf(c).walletUpdatedSerials(device, passType, since);
    if (updated.length === 0) return new Response(null, { status: 204 });
    const lastUpdated = updated.reduce((max, u) => (u.tag > max ? u.tag : max), 0n);
    return c.json({ serialNumbers: updated.map((u) => u.serial), lastUpdated: lastUpdated.toString() });
  })

  .get("/passes/:passType/:serial", async (c) => {
    const { passType, serial } = c.req.param();
    if (!checkPassType(c, passType)) return unauthorized();
    if (!(await authorized(c, serial))) return unauthorized();
    const account = await repoOf(c).getAccountBySerial(serial);
    if (!account) return unauthorized();

    const lastModified = new Date(account.walletUpdatedAt);
    // HTTP dates have 1-second resolution; compare at that resolution.
    const lastModifiedSec = Math.floor(lastModified.getTime() / 1000);
    const ims = c.req.header("if-modified-since");
    if (ims) {
      const imsMs = Date.parse(ims);
      if (!Number.isNaN(imsMs) && lastModifiedSec <= Math.floor(imsMs / 1000)) {
        return new Response(null, { status: 304 });
      }
    }

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
        "Last-Modified": new Date(lastModifiedSec * 1000).toUTCString(),
        "Cache-Control": "no-cache",
      },
    });
  })

  .post("/log", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return new Response(null, { status: 200 });
    }
    const parsed = logSchema.safeParse(body);
    if (parsed.success) {
      for (const message of parsed.data.logs.slice(0, 20)) {
        c.get("deps").logger.warn("wallet.device_log", { message: message.slice(0, 500) });
      }
    }
    return new Response(null, { status: 200 });
  });
