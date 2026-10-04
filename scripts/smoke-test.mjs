#!/usr/bin/env node
/**
 * End-to-end smoke test of the PRODUCTION BUILD running in the real Workers
 * runtime (workerd via `vite preview`). Run after `pnpm build`:
 *
 *   pnpm test:smoke
 */
import { spawn } from "node:child_process";

const PORT = 4789;
const BASE = `http://localhost:${PORT}`;
const server = spawn("pnpm", ["exec", "vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, CLOUDFLARE_ENV: "" },
});
let output = "";
server.stdout.on("data", (d) => (output += d));
server.stderr.on("data", (d) => (output += d));

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `  ${detail}`}`);
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`preview server did not start:\n${output}`);
}

try {
  await waitForServer();
  const health = await fetch(`${BASE}/api/health`);
  check("GET /api/health -> 200", health.status === 200);

  const config = await (await fetch(`${BASE}/api/public-config`)).text();
  check("public config has no secrets", !/SERVICE_ROLE|PRIVATE|SECRET/i.test(config));

  for (const path of ["/", "/register", "/wallet", "/staff", "/c/abc"]) {
    const res = await fetch(`${BASE}${path}`);
    const html = await res.text();
    check(`GET ${path} serves the SPA`, res.status === 200 && html.includes('id="root"') && html.includes('dir="rtl"'));
  }

  const me = await fetch(`${BASE}/api/me`);
  check("GET /api/me without session -> 401", me.status === 401);

  const staff = await fetch(`${BASE}/api/staff/resolve`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  check("staff API without session -> 401", staff.status === 401);

  const pass = await fetch(`${BASE}/v1/passes/pass.x/00000000-0000-4000-8000-000000000000`);
  check("Wallet pass without ApplePass auth -> 401", pass.status === 401);

  const log = await fetch(`${BASE}/v1/log`, { method: "POST", body: JSON.stringify({ logs: ["smoke"] }) });
  check("POST /v1/log -> 200", log.status === 200);

  const headers = (await fetch(`${BASE}/api/health`)).headers;
  check("API security headers", headers.get("x-content-type-options") === "nosniff" && headers.get("x-frame-options") === "DENY");
} catch (err) {
  check("smoke test run", false, err instanceof Error ? err.message : String(err));
} finally {
  server.kill("SIGTERM");
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} smoke checks passed`);
process.exit(failed ? 1 : 0);
