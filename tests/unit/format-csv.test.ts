import { describe, expect, it } from "vitest";
import { cupsLabel, formatRiyadh, maskEmail, normalizeMemberId } from "../../src/shared/format";
import { CSV_BOM, csvCell, toCsv } from "../../src/server/lib/csv";
import { loadConfig } from "../../src/server/config";
import { redact } from "../../src/server/lib/logger";

describe("formatting", () => {
  it("masks emails for staff", () => {
    expect(maskEmail("sara@gmail.com")).toBe("sa***@gmail.com");
    expect(maskEmail("a@x.com")).toBe("a***@x.com");
    expect(maskEmail("broken")).toBe("***");
  });

  it("normalizes manual member ID entry", () => {
    expect(normalizeMemberId("hlw-abc234")).toBe("HLW-ABC234");
    expect(normalizeMemberId("ABC 234")).toBe("HLW-ABC234");
    expect(normalizeMemberId("HLW-ABC2340")).toBeNull();
    expect(normalizeMemberId("HLW-ABCO01")).toBeNull(); // O, 0 and 1 are not in the alphabet
  });

  it("formats progress and Riyadh time", () => {
    expect(cupsLabel(3)).toBe("3 / 5 Cups");
    expect(formatRiyadh("2026-01-01T21:30:00Z")).toBe("2026-01-02 00:30:00");
    expect(formatRiyadh(null)).toBe("");
  });
});

describe("CSV", () => {
  it("prevents formula injection and escapes safely", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+966")).toBe("'+966");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell(-1)).toBe("-1");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("emits UTF-8 BOM for Arabic Excel compatibility", () => {
    const csv = toCsv(["name"], [["عبدالعزيز"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("عبدالعزيز");
  });
});

describe("configuration", () => {
  it("fails closed in production without HMAC secrets and never enables Wallet without certificates", () => {
    const config = loadConfig({ APP_ENV: "production", APP_URL: "https://x.example", APPLE_WALLET_MODE: "production" });
    expect(config.wallet.ready).toBe(false);
    expect(config.passAuthSecret).toBe("");
    expect(config.issues.join("\n")).toMatch(/PASS_AUTH_SECRET/);
    expect(config.issues.join("\n")).toMatch(/APPLE_PASS_CERTIFICATE_BASE64/);
  });

  it("uses ephemeral secrets only in development", () => {
    const config = loadConfig({ APP_ENV: "development" });
    expect(config.usingEphemeralSecrets).toBe(true);
    expect(config.passAuthSecret.length).toBeGreaterThan(30);
    expect(config.wallet.mode).toBe("mock");
  });

  it("redacts sensitive log keys", () => {
    expect(redact({ pushToken: "abc", serviceRoleKey: "x", event: "ok" })).toEqual({
      pushToken: "[redacted]",
      serviceRoleKey: "[redacted]",
      event: "ok",
    });
  });
});
