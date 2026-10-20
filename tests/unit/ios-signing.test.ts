import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Exercise the actual signing helper without loading the CLI entry point or
// accessing Apple, real signing credentials, certificates or provisioning.
const source = readFileSync(new URL("../../scripts/ios-signing.mjs", import.meta.url), "utf8");
const start = source.indexOf("async function ensureBundleId(");
const end = source.indexOf("async function findCertificate(", start);
if (start < 0 || end < 0) throw new Error("Signing helper could not be located");
const code = new Script(`${source.slice(start, end)}; ensureBundleId(target);`);
const app = { bundleId: "com.hollowzulfi.coffee", name: "HOLLOW", push: true, associatedDomains: true };

function run(target = app, enabled = ["PUSH_NOTIFICATIONS", "ASSOCIATED_DOMAINS"]) {
  const api = vi.fn((method: string, path: string) => {
    if (method === "GET" && path.startsWith("/v1/bundleIds?")) {
      return Promise.resolve({ data: [{ id: "TEST_BUNDLE", attributes: { identifier: target.bundleId } }] });
    }
    if (method === "GET" && path === "/v1/bundleIds/TEST_BUNDLE/bundleIdCapabilities") {
      return Promise.resolve({ data: enabled.map((capabilityType) => ({ attributes: { capabilityType } })) });
    }
    if (method === "POST" && path === "/v1/bundleIdCapabilities") return Promise.resolve({ data: {} });
    // Reproduce Apple's actual response, rather than accepting unsupported parameters.
    throw new Error(`400 parameter not allowed: ${path}`);
  });
  const result = code.runInNewContext({ target, APP: app, api, console: { log: () => undefined } }) as Promise<unknown>;
  return { result, api };
}

describe("iOS capability discovery", () => {
  it("reads capabilities without the unsupported limit parameter", async () => {
    const { result, api } = run();
    await expect(result).resolves.toMatchObject({ id: "TEST_BUNDLE" });
    expect(api).toHaveBeenCalledWith("GET", "/v1/bundleIds/TEST_BUNDLE/bundleIdCapabilities");
    expect(api.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it("enables only the missing Associated Domains capability", async () => {
    const { result, api } = run(app, ["PUSH_NOTIFICATIONS"]);
    await result;
    expect(api.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
    expect(api).toHaveBeenCalledWith("POST", "/v1/bundleIdCapabilities", expect.objectContaining({
      data: expect.objectContaining({ attributes: { capabilityType: "ASSOCIATED_DOMAINS" } }),
    }));
  });

  it("does not change widget capabilities", async () => {
    const { result, api } = run({ ...app, bundleId: `${app.bundleId}.widgets`, push: false, associatedDomains: false });
    await result;
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("surfaces permission errors without bypassing them", async () => {
    const api = vi.fn().mockResolvedValueOnce({ data: [{ id: "TEST_BUNDLE", attributes: { identifier: app.bundleId } }] })
      .mockRejectedValueOnce(new Error("403 forbidden"));
    const result = code.runInNewContext({ target: app, APP: app, api, console: { log: () => undefined } }) as Promise<unknown>;
    await expect(result).rejects.toThrow("403 forbidden");
    expect(api).toHaveBeenCalledTimes(2);
  });
});
