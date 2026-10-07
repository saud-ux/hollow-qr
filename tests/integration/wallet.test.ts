import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { unzipSync } from "fflate";
import * as pkijs from "pkijs";
import { beforeAll, describe, expect, it } from "vitest";
import type { MeResponse } from "../../src/shared/types";
import { silentLogger } from "../../src/server/lib/logger";
import { passAuthToken } from "../../src/server/security/tokens";
import { MtlsApnsNotifier } from "../../src/server/wallet/apns";
import { importPassPrivateKey } from "../../src/server/wallet/private-key";
import { loadSigningMaterial } from "../../src/server/wallet/signer";
import { APP_URL, bearer, buildTestApp, testEnv } from "../helpers/app";
import { b64, testCerts } from "../helpers/certs";
import { accountFor, createAuthUser, createTestDb } from "../helpers/db";

const PASS_TYPE = "pass.test.hollow";
const TEAM = "TEAM123456";

let db: PGlite;
let app: ReturnType<typeof buildTestApp>["app"];
let env: ReturnType<typeof testEnv>;
let staffId: string;

function hasOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function customer() {
  const user = await createAuthUser(db, { email: `w${randomUUID().slice(0, 8)}@example.com`, name: "عبدالعزيز" });
  const account = (await accountFor(db, user.id))!;
  const token = await passAuthToken(env.PASS_AUTH_SECRET!, account.pass_serial);
  return { user, account, auth: { authorization: `ApplePass ${token}` } };
}

beforeAll(async () => {
  const certs = testCerts(PASS_TYPE, TEAM);
  env = testEnv({
    APPLE_WALLET_MODE: "production",
    APPLE_TEAM_IDENTIFIER: TEAM,
    APPLE_PASS_TYPE_IDENTIFIER: PASS_TYPE,
    APPLE_PASS_CERTIFICATE_BASE64: b64(certs.signerCertPem),
    APPLE_PASS_PRIVATE_KEY_BASE64: b64(certs.signerKeyPkcs8Pem),
    APPLE_WWDR_CERTIFICATE_BASE64: b64(certs.wwdrPem),
  });
  db = await createTestDb();
  app = buildTestApp(db, env).app;
  staffId = (await createAuthUser(db, { email: "wallet-staff@hollow.test", role: "staff" })).id;
});

describe("signed .pkpass generation", () => {
  it("produces a valid, signed Apple Wallet bundle through the download link", async () => {
    const { user, account } = await customer();
    const link = await app.request("/api/wallet/pass-link", { method: "POST", headers: bearer(user.id) });
    expect(link.status).toBe(200);
    const { url } = (await link.json()) as { url: string };
    expect(url.startsWith(`${APP_URL}/api/wallet/pass/${account.pass_serial}?exp=`)).toBe(true);

    const res = await app.request(url.replace(APP_URL, ""));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.apple.pkpass");
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(zip).sort();
    for (const required of ["pass.json", "manifest.json", "signature", "icon.png", "icon@2x.png", "logo.png", "strip.png", "strip@3x.png"]) {
      expect(names).toContain(required);
    }

    const pass = JSON.parse(new TextDecoder().decode(zip["pass.json"])) as Record<string, any>;
    expect(pass).toMatchObject({
      formatVersion: 1,
      passTypeIdentifier: PASS_TYPE,
      teamIdentifier: TEAM,
      serialNumber: account.pass_serial,
      organizationName: "HOLLOW",
      webServiceURL: APP_URL,
      voided: false,
    });
    expect(pass.authenticationToken).toBe(await passAuthToken(env.PASS_AUTH_SECRET!, account.pass_serial));
    // The name and member number sit under the QR, in Wallet's small caption type.
    expect(pass.barcodes[0]).toMatchObject({ format: "PKBarcodeFormatQR", altText: `عبدالعزيز · ${account.member_id}` });
    expect(pass.barcodes[0].message).toMatch(new RegExp(`^${APP_URL}/c/[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{22}$`));
    // Nothing on the front besides the logo, the strip and the QR.
    for (const row of ["headerFields", "primaryFields", "secondaryFields", "auxiliaryFields"]) expect(pass.storeCard[row]).toBeUndefined();
    // Progress and reward are drawn into the strip image; their fields move to the back.
    expect(pass.storeCard.backFields[1]).toMatchObject({ key: "progress", value: "0 / 5 Cups" });

    // Manifest hashes match the files.
    const manifest = JSON.parse(new TextDecoder().decode(zip["manifest.json"])) as Record<string, string>;
    for (const [name, sha1] of Object.entries(manifest)) {
      const digest = Buffer.from(await crypto.subtle.digest("SHA-1", zip[name]!)).toString("hex");
      expect(digest).toBe(sha1);
    }
    expect(Object.keys(manifest)).not.toContain("signature");

    // PKCS#7 detached signature verifies against the (test) WWDR chain.
    const contentInfo = pkijs.ContentInfo.fromBER(zip["signature"]!.slice().buffer);
    const signed = new pkijs.SignedData({ schema: contentInfo.content });
    const verified = await signed.verify({
      signer: 0,
      data: zip["manifest.json"]!.slice().buffer,
      trustedCerts: [pkijs.Certificate.fromBER(Buffer.from(testCerts().wwdrPem.replace(/-----[^-]+-----|\s/g, ""), "base64"))],
      checkChain: true,
    });
    expect(verified).toBe(true);

    if (hasOpenssl()) {
      const dir = mkdtempSync(join(tmpdir(), "pkpass-"));
      writeFileSync(join(dir, "manifest.json"), zip["manifest.json"]!);
      writeFileSync(join(dir, "signature"), zip["signature"]!);
      writeFileSync(join(dir, "ca.pem"), testCerts().wwdrPem);
      execFileSync("openssl", [
        "smime", "-verify", "-binary", "-inform", "DER",
        "-in", join(dir, "signature"), "-content", join(dir, "manifest.json"),
        "-CAfile", join(dir, "ca.pem"), "-purpose", "any", "-out", "/dev/null",
      ], { stdio: "ignore" });
    }
  });

  it("reflects the reward and cancelled states", async () => {
    const { account, auth } = await customer();
    const adminId = (await createAuthUser(db, { email: `adm${randomUUID().slice(0, 6)}@hollow.test`, role: "admin" })).id;
    await db.query("select public.apply_loyalty_action($1, $2, 'ADD_CUPS', 5)", [staffId, account.id]);
    let res = await app.request(`/v1/passes/${PASS_TYPE}/${account.pass_serial}`, { headers: auth });
    let pass = JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(await res.arrayBuffer()))["pass.json"])) as Record<string, any>;
    expect(pass.storeCard.backFields[1].value).toBe("5 / 5 Cups");
    expect(pass.storeCard.backFields[0]).toMatchObject({ key: "reward", value: "لك مشروب مجاني", changeMessage: "%@" });

    await db.query("select public.apply_loyalty_action($1, $2, 'CANCEL_MEMBERSHIP', null, null, null, true)", [adminId, account.id]);
    res = await app.request(`/v1/passes/${PASS_TYPE}/${account.pass_serial}`, { headers: auth });
    pass = JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(await res.arrayBuffer()))["pass.json"])) as Record<string, any>;
    expect(pass.voided).toBe(true);
    // serial + auth token are preserved across updates
    expect(pass.serialNumber).toBe(account.pass_serial);
    expect(pass.authenticationToken).toBe(await passAuthToken(env.PASS_AUTH_SECRET!, account.pass_serial));
  });

  it("rejects tampered or expired download links", async () => {
    const { user } = await customer();
    const { url } = (await (await app.request("/api/wallet/pass-link", { method: "POST", headers: bearer(user.id) })).json()) as { url: string };
    const tampered = url.replace(/sig=.{4}/, "sig=AAAA");
    expect((await app.request(tampered.replace(APP_URL, ""))).status).toBe(404);
    const expired = url.replace(/exp=\d+/, "exp=1000");
    expect((await app.request(expired.replace(APP_URL, ""))).status).toBe(404);
  });

  it("does not leak certificate details when signing material is broken", async () => {
    const brokenEnv = { ...env, APPLE_PASS_PRIVATE_KEY_BASE64: b64("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----") };
    const broken = buildTestApp(db, brokenEnv).app;
    const { account, auth } = await customer();
    const res = await broken.request(`/v1/passes/${PASS_TYPE}/${account.pass_serial}`, { headers: auth });
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain("WALLET_SIGNING_FAILED");
    expect(text).not.toMatch(/BEGIN|PRIVATE|AAAA/);
  });
});

describe("private key formats", () => {
  it("imports PKCS#8, PKCS#1 and PBES2-encrypted keys", async () => {
    const certs = testCerts();
    const enc = (s: string) => new TextEncoder().encode(s);
    await expect(importPassPrivateKey(enc(certs.signerKeyPkcs8Pem))).resolves.toBeTruthy();
    await expect(importPassPrivateKey(enc(certs.signerKeyPkcs1Pem))).resolves.toBeTruthy();
    await expect(importPassPrivateKey(enc(certs.signerKeyEncryptedPem), certs.passphrase)).resolves.toBeTruthy();
    await expect(importPassPrivateKey(enc(certs.signerKeyEncryptedPem), "wrong")).rejects.toThrow(/PASSPHRASE/);
    await expect(importPassPrivateKey(enc(certs.signerKeyEncryptedPem))).rejects.toThrow(/PASSPHRASE is required/);
  });

  it("detects a certificate that does not match the pass type identifier", async () => {
    const certs = testCerts();
    await expect(
      loadSigningMaterial(
        {
          APPLE_PASS_CERTIFICATE_BASE64: b64(certs.signerCertPem),
          APPLE_PASS_PRIVATE_KEY_BASE64: b64(certs.signerKeyPkcs8Pem),
          APPLE_WWDR_CERTIFICATE_BASE64: b64(certs.wwdrPem),
        },
        { passTypeIdentifier: "pass.other.id", teamIdentifier: TEAM },
      ),
    ).rejects.toThrow(/does not match APPLE_PASS_TYPE_IDENTIFIER/);
  });
});

describe("Apple Wallet web service", () => {
  const device = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  const pushToken = "f".repeat(64);

  it("registers, lists updates, serves the pass and unregisters", async () => {
    const { account, auth } = await customer();
    const regPath = `/v1/devices/${device}/registrations/${PASS_TYPE}/${account.pass_serial}`;
    const reg = (headers: Record<string, string>) =>
      app.request(regPath, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ pushToken }) });

    expect((await reg({})).status).toBe(401);
    expect((await reg({ authorization: "ApplePass wrong-token-value" })).status).toBe(401);
    expect((await reg(auth)).status).toBe(201);
    expect((await reg(auth)).status).toBe(200);

    const list = await app.request(`/v1/devices/${device}/registrations/${PASS_TYPE}`);
    expect(list.status).toBe(200);
    const { serialNumbers, lastUpdated } = (await list.json()) as { serialNumbers: string[]; lastUpdated: string };
    expect(serialNumbers).toContain(account.pass_serial);
    expect(lastUpdated).toMatch(/^\d+$/);

    const noChange = await app.request(`/v1/devices/${device}/registrations/${PASS_TYPE}?passesUpdatedSince=${lastUpdated}`);
    expect(noChange.status).toBe(204);

    await db.query("select public.apply_loyalty_action($1, $2, 'ADD_CUPS', 2)", [staffId, account.id]);
    const changed = await app.request(`/v1/devices/${device}/registrations/${PASS_TYPE}?passesUpdatedSince=${lastUpdated}`);
    expect(changed.status).toBe(200);

    const pass = await app.request(`/v1/passes/${PASS_TYPE}/${account.pass_serial}`, { headers: auth });
    expect(pass.status).toBe(200);
    expect(pass.headers.get("content-type")).toBe("application/vnd.apple.pkpass");
    const lastModified = pass.headers.get("last-modified")!;
    const notModified = await app.request(`/v1/passes/${PASS_TYPE}/${account.pass_serial}`, {
      headers: { ...auth, "if-modified-since": lastModified },
    });
    expect(notModified.status).toBe(304);

    expect((await app.request(`/v1/passes/${PASS_TYPE}/${account.pass_serial}`)).status).toBe(401);
    expect((await app.request(`/v1/passes/pass.other/${account.pass_serial}`, { headers: auth })).status).toBe(401);

    const del = await app.request(regPath, { method: "DELETE", headers: auth });
    expect(del.status).toBe(200);
    expect((await app.request(`/v1/devices/${device}/registrations/${PASS_TYPE}`)).status).toBe(204);
  });

  it("a pass's token cannot authorize another pass", async () => {
    const a = await customer();
    const b = await customer();
    const res = await app.request(`/v1/passes/${PASS_TYPE}/${b.account.pass_serial}`, { headers: a.auth });
    expect(res.status).toBe(401);
  });

  it("tolerates a double slash between webServiceURL and v1", async () => {
    const worker = (await import("../../src/server/index")).default;
    const res = await worker.fetch(new Request(`${APP_URL}//v1/log`, { method: "POST", body: JSON.stringify({ logs: ["x"] }) }), {
      APP_ENV: "test",
      APP_URL,
    }, { waitUntil() {} });
    expect(res.status).toBe(200);
  });

  it("accepts device logs", async () => {
    const res = await app.request("/v1/log", { method: "POST", body: JSON.stringify({ logs: ["hello"] }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(200);
  });
});

describe("APNs adapter", () => {
  it("sends an empty JSON payload with the pass type as topic via the mTLS binding", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = {
      fetch: (url: Request | string | URL, init?: RequestInit) => {
        calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init! });
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    };
    const notifier = new MtlsApnsNotifier(fetcher, PASS_TYPE, silentLogger);
    expect(await notifier.notify("ab".repeat(32))).toBe("sent");
    expect(calls[0]!.url).toBe(`https://api.push.apple.com/3/device/${"ab".repeat(32)}`);
    expect(calls[0]!.init.body).toBe("{}");
    expect((calls[0]!.init.headers as Record<string, string>)["apns-topic"]).toBe(PASS_TYPE);
  });

  it("flags invalid tokens so the device is removed", async () => {
    const gone = { fetch: () => Promise.resolve(new Response(JSON.stringify({ reason: "Unregistered" }), { status: 410 })) };
    expect(await new MtlsApnsNotifier(gone, PASS_TYPE, silentLogger).notify("ab".repeat(32))).toBe("invalid-token");
    const bad = { fetch: () => Promise.resolve(new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 })) };
    expect(await new MtlsApnsNotifier(bad, PASS_TYPE, silentLogger).notify("ab".repeat(32))).toBe("invalid-token");
    const down = { fetch: () => Promise.reject(new Error("network")) };
    expect(await new MtlsApnsNotifier(down, PASS_TYPE, silentLogger).notify("ab".repeat(32))).toBe("failed");
  });

  it("removes devices with invalid push tokens after a mutation", async () => {
    const { account, user } = await customer();
    await db.query("insert into public.wallet_devices values ('dead-device', $1, now(), now())", ["cd".repeat(32)]);
    await db.query("insert into public.wallet_registrations values ('dead-device', $1, $2, now())", [PASS_TYPE, account.pass_serial]);
    const gone = { fetch: () => Promise.resolve(new Response(JSON.stringify({ reason: "Unregistered" }), { status: 410 })) };
    const built = buildTestApp(db, env, new MtlsApnsNotifier(gone, PASS_TYPE, silentLogger));
    const stats = await built.deps.wallet!.passChanged(account.pass_serial);
    expect(stats).toMatchObject({ attempted: 1, removed: 1 });
    const left = await db.query("select * from public.wallet_devices where device_library_identifier = 'dead-device'");
    expect(left.rows).toHaveLength(0);
    // and the customer still sees their card
    const me = (await (await built.app.request("/api/me", { headers: bearer(user.id) })).json()) as MeResponse;
    expect(me.card?.walletReady).toBe(true);
  });
});
