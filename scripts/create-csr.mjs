#!/usr/bin/env node
/**
 * Creates the private key + Certificate Signing Request (CSR) for the Apple
 * Pass Type ID certificate — works on Windows, macOS and Linux (no OpenSSL or
 * Keychain needed).
 *
 *   pnpm secrets:csr --email you@example.com
 *
 * Writes (git-ignored):
 *   .secrets/pass-key.pem   private key — keep it safe, never share or commit it
 *   .secrets/pass.csr       upload this to Apple when creating the certificate
 */
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";
import { arg, hasFlag } from "./lib/env.mjs";

const email = (arg("email") ?? "").trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: pnpm secrets:csr --email you@example.com");
  process.exit(1);
}

const out = join(process.cwd(), ".secrets");
const keyPath = join(out, "pass-key.pem");
const csrPath = join(out, "pass.csr");
if (existsSync(keyPath) && !hasFlag("force")) {
  console.error(".secrets/pass-key.pem already exists. Refusing to overwrite (add --force only if you are sure).");
  process.exit(1);
}
mkdirSync(out, { recursive: true, mode: 0o700 });

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const csr = forge.pki.createCertificationRequest();
csr.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }).toString());
csr.setSubject([
  { name: "emailAddress", value: email },
  { name: "commonName", value: "HOLLOW Rewards Pass" },
  { name: "countryName", value: "SA" },
]);
csr.sign(forge.pki.privateKeyFromPem(keyPem), forge.md.sha256.create());

writeFileSync(keyPath, keyPem);
chmodSync(keyPath, 0o600);
writeFileSync(csrPath, forge.pki.certificationRequestToPem(csr));

console.log("Created .secrets/pass-key.pem (private key — back it up somewhere safe, never share it)");
console.log("Created .secrets/pass.csr      (upload this file to Apple)");
console.log("\nNext: Apple Developer → Certificates → + → Pass Type ID Certificate → choose your Pass Type ID → upload pass.csr");
console.log("Then: pnpm secrets:encode --cert pass.cer --key .secrets/pass-key.pem --wwdr AppleWWDRCAG4.cer");
