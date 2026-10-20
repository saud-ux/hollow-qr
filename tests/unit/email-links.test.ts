import { describe, expect, it } from "vitest";
import { emailAppUrl, emailRedirectUrl, parseEmailLink } from "../../src/shared/email-links";

const origin = "https://hollow-rewards.hollowzulfi.workers.dev";
const access = "a".repeat(100);
const refresh = "b".repeat(40);
const credentials = `access_token=${access}&refresh_token=${refresh}`;

describe("email confirmation and recovery links", () => {
  it("keeps website redirects unchanged", () => {
    expect(emailRedirectUrl(origin, "/reset-password", false)).toBe(`${origin}/reset-password`);
    expect(emailRedirectUrl(origin, "/wallet?welcome=1", false)).toBe(`${origin}/wallet?welcome=1`);
  });

  it("sends native requests to a web-compatible Universal Link", () => {
    const url = new URL(emailRedirectUrl(origin, "/cart", true));
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("next")).toBe("/cart");
  });

  it("opens recovery on the correct screen regardless of next", () => {
    expect(parseEmailLink(`${origin}/auth/callback?next=%2Fcart#${credentials}&type=recovery`, origin)).toEqual({ kind: "session", type: "recovery", path: "/reset-password", access_token: access, refresh_token: refresh });
  });

  it("supports the registered scheme as an explicit browser fallback", () => {
    const link = parseEmailLink(`${origin}/auth/callback?next=%2Fcart#${credentials}&type=signup`, origin)!;
    expect(link.kind).toBe("session");
    if (link.kind !== "session") throw new Error("expected session");
    const fallback = emailAppUrl(link);
    expect(new URL(fallback).searchParams.has("access_token")).toBe(false);
    expect(parseEmailLink(fallback, origin)).toEqual(link);
  });

  it.each([
    "https://evil.test/auth/callback", `${origin}.evil.test/auth/callback`,
    "http://hollow-rewards.hollowzulfi.workers.dev/auth/callback",
    "hollowcoffee://staff/callback", "hollowcoffee://auth/callback/other",
    "hollowcoffee://attacker@auth/callback", `${origin}/menu`,
  ])("rejects an unrelated origin/path: %s", (url) => {
    expect(parseEmailLink(`${url}#${credentials}&type=signup`, origin)).toBeNull();
  });

  it.each(["https://evil.test", "//evil.test", "/staff", "/\\evil.test", "/%2f%2fevil.test"]) ("rejects unsafe return path %s", (next) => {
    const link = parseEmailLink(`${origin}/auth/callback?next=${encodeURIComponent(next)}#${credentials}&type=signup`, origin);
    expect(link).toMatchObject({ kind: "session", path: "/wallet" });
  });

  it("does not treat signup as password recovery", () => {
    expect(parseEmailLink(`${origin}/auth/callback?next=%2Freset-password#${credentials}&type=signup`, origin)).toMatchObject({ kind: "session", path: "/wallet" });
  });

  it.each(["", "type=recovery", `${credentials}&type=magiclink`, `${credentials}&type=recovery&error=expired`, "access_token=short&refresh_token=short&type=recovery"]) ("handles expired or malformed links without accepting credentials", (hash) => {
    expect(parseEmailLink(`${origin}/auth/callback?next=%2Freset-password#${hash}`, origin)).toEqual({ kind: "error", path: "/reset-password" });
  });

  it("never accepts credentials in the query string", () => {
    expect(parseEmailLink(`${origin}/auth/callback?${credentials}&type=recovery&next=%2Freset-password`, origin)).toEqual({ kind: "error", path: "/reset-password" });
  });
});
