import { describe, expect, it } from "vitest";
import {
  createQrToken,
  extractQrToken,
  passAuthToken,
  qrPayloadUrl,
  signPassDownload,
  verifyApplePassAuthorization,
  verifyPassDownload,
  verifyQrToken,
} from "../../src/server/security/tokens";

const QR_SECRET = "qr-secret-0123456789-0123456789-abcdef";
const PASS_SECRET = "pass-secret-0123456789-0123456789-abcdef";
const ID = "AbCdEfGhIjKlMnOpQrStUv";

describe("static QR token", () => {
  it("is stable, opaque and verifiable", async () => {
    const a = await createQrToken(QR_SECRET, ID);
    const b = await createQrToken(QR_SECRET, ID);
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/);
    expect(await verifyQrToken(QR_SECRET, a)).toBe(ID);
  });

  it("contains no personal data or database UUIDs", async () => {
    const token = await createQrToken(QR_SECRET, ID);
    const url = qrPayloadUrl("https://rewards.example", token);
    expect(url).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it("rejects forged, tampered and malformed tokens", async () => {
    const token = await createQrToken(QR_SECRET, ID);
    expect(await verifyQrToken("another-secret-0123456789-0123456789", token)).toBeNull();
    const tampered = `${ID.slice(0, -1)}w.${token.split(".")[1]}`;
    expect(await verifyQrToken(QR_SECRET, tampered)).toBeNull();
    for (const bad of ["", "abc", `${ID}.`, `${ID}.short`, `${token}x`, "' or 1=1 --", `${ID}.${"A".repeat(22)}`]) {
      expect(await verifyQrToken(QR_SECRET, bad)).toBeNull();
    }
  });

  it("extracts tokens from our URL or raw text only", async () => {
    const token = await createQrToken(QR_SECRET, ID);
    expect(extractQrToken(`https://rewards.example/c/${token}`)).toBe(token);
    expect(extractQrToken(`  ${token}  `)).toBe(token);
    expect(extractQrToken(`https://rewards.example/x/${token}`)).toBeNull();
    expect(extractQrToken(`javascript:alert(1)/c/${token}`)).toBeNull();
    expect(extractQrToken("not a token")).toBeNull();
    expect(extractQrToken("x".repeat(1000))).toBeNull();
  });
});

describe("Apple pass authentication token", () => {
  it("is deterministic per serial and independent from the QR", async () => {
    const serial = "8b7f2a52-1d9b-4a59-9d1b-5b2f4d1c2e3f";
    const t1 = await passAuthToken(PASS_SECRET, serial);
    expect(t1).toBe(await passAuthToken(PASS_SECRET, serial));
    expect(t1.length).toBeGreaterThanOrEqual(16);
    expect(t1).not.toBe(await passAuthToken(PASS_SECRET, "8b7f2a52-1d9b-4a59-9d1b-5b2f4d1c2e30"));
    expect(t1).not.toContain(serial);
  });

  it("validates the ApplePass Authorization header", async () => {
    const serial = "8b7f2a52-1d9b-4a59-9d1b-5b2f4d1c2e3f";
    const token = await passAuthToken(PASS_SECRET, serial);
    expect(await verifyApplePassAuthorization(PASS_SECRET, serial, `ApplePass ${token}`)).toBe(true);
    expect(await verifyApplePassAuthorization(PASS_SECRET, serial, `Bearer ${token}`)).toBe(false);
    expect(await verifyApplePassAuthorization(PASS_SECRET, serial, `ApplePass ${token}x`)).toBe(false);
    expect(await verifyApplePassAuthorization(PASS_SECRET, serial, undefined)).toBe(false);
    expect(await verifyApplePassAuthorization(PASS_SECRET, "other", `ApplePass ${token}`)).toBe(false);
  });
});

describe("signed pass download links", () => {
  it("expire and cannot be reused for another serial", async () => {
    const serial = "8b7f2a52-1d9b-4a59-9d1b-5b2f4d1c2e3f";
    const sig = await signPassDownload(PASS_SECRET, serial, 1000);
    expect(await verifyPassDownload(PASS_SECRET, serial, 1000, sig, 999)).toBe("ok");
    expect(await verifyPassDownload(PASS_SECRET, serial, 1000, sig, 1001)).toBe("expired");
    expect(await verifyPassDownload(PASS_SECRET, "other", 1000, sig, 999)).toBe("invalid");
    expect(await verifyPassDownload(PASS_SECRET, serial, 2000, sig, 999)).toBe("invalid");
    // The download signature is domain-separated from the auth token.
    expect(sig).not.toBe(await passAuthToken(PASS_SECRET, serial));
  });
});
