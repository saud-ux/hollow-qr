/**
 * Converts Apple Wallet certificates into the secret format the Worker expects.
 *
 * Mac (Keychain export):
 *   pnpm secrets:encode --p12 Certificates.p12 --wwdr AppleWWDRCAG4.cer
 *   (prompts for the .p12 export password)
 *
 * Windows / any OS (key created with `pnpm secrets:csr`):
 *   pnpm secrets:encode --cert pass.cer --key .secrets/pass-key.pem --wwdr AppleWWDRCAG4.cer
 *
 * Inputs:
 *   --p12          Pass Type ID certificate + private key exported from Keychain
 *   --cert/--key   Pass Type ID certificate downloaded from Apple (.cer, DER or PEM)
 *                  and the private key PEM that created the CSR
 *   --wwdr         Apple WWDR intermediate certificate (.cer, DER or PEM) — use the
 *                  generation that issued your Pass Type ID certificate (currently G4)
 *
 * Output (written to ./.secrets/, which is git-ignored):
 *   pass-cert.pem / pass-key.pem   -> also used for the APNs mTLS upload
 *   *.b64                          -> values for `wrangler secret put`
 * Nothing secret is printed to the terminal.
 */
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";
import { arg, promptHidden } from "./lib/env.mjs";

const p12Path = arg("p12");
const certPath = arg("cert");
const keyPath = arg("key");
const wwdrPath = arg("wwdr");
if (!wwdrPath || (!p12Path && !(certPath && keyPath))) {
  console.error("Usage:");
  console.error("  pnpm secrets:encode --p12 <PassTypeID.p12> --wwdr <AppleWWDRCAG4.cer>");
  console.error("  pnpm secrets:encode --cert <pass.cer> --key <pass-key.pem> --wwdr <AppleWWDRCAG4.cer>");
  process.exit(1);
}

/** Reads a certificate file that may be DER (.cer from Apple) or PEM. */
function readCertificate(path) {
  const raw = readFileSync(path);
  const text = raw.toString("utf8");
  return text.includes("-----BEGIN CERTIFICATE-----")
    ? forge.pki.certificateFromPem(text)
    : forge.pki.certificateFromAsn1(forge.asn1.fromDer(raw.toString("binary")));
}

let cert;
let key;
if (p12Path) {
  const password = process.env.P12_PASSWORD ?? (await promptHidden(".p12 export password: "));
  let p12;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(readFileSync(p12Path).toString("binary")), password);
  } catch {
    console.error("Could not open the .p12 (wrong password or unsupported file).");
    process.exit(1);
  }
  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0];
  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  if (!certBag?.cert || !keyBag?.key) {
    console.error("The .p12 must contain the Pass Type ID certificate and its private key.");
    process.exit(1);
  }
  cert = certBag.cert;
  key = keyBag.key;
} else {
  cert = readCertificate(certPath);
  try {
    key = forge.pki.privateKeyFromPem(readFileSync(keyPath, "utf8"));
  } catch {
    console.error("Could not read the private key (expected an unencrypted PEM, e.g. from `pnpm secrets:csr`).");
    process.exit(1);
  }
  if (cert.publicKey.n.compareTo(key.n) !== 0) {
    console.error("The certificate does not belong to this private key. Use the key that created the CSR you uploaded.");
    process.exit(1);
  }
}

const certPem = forge.pki.certificateToPem(cert);
const keyPem = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key)));
const wwdrPem = forge.pki.certificateToPem(readCertificate(wwdrPath));

const uid = cert.subject.getField({ type: "0.9.2342.19200300.100.1.1" })?.value;
const team = cert.subject.getField("OU")?.value;

const out = join(process.cwd(), ".secrets");
mkdirSync(out, { recursive: true, mode: 0o700 });
const files = {
  "pass-cert.pem": certPem,
  "pass-key.pem": keyPem,
  "wwdr.pem": wwdrPem,
  "APPLE_PASS_CERTIFICATE_BASE64.b64": Buffer.from(certPem).toString("base64"),
  "APPLE_PASS_PRIVATE_KEY_BASE64.b64": Buffer.from(keyPem).toString("base64"),
  "APPLE_WWDR_CERTIFICATE_BASE64.b64": Buffer.from(wwdrPem).toString("base64"),
};
for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(out, name), content);
  chmodSync(join(out, name), 0o600);
}

console.log(`Wrote ${Object.keys(files).length} files to .secrets/ (git-ignored).`);
console.log(`Certificate pass type ID: ${uid ?? "(not found)"}   team: ${team ?? "(not found)"}`);
console.log(`Expires: ${cert.validity.notAfter.toISOString()}`);
console.log("\nNext steps (PowerShell, cmd and bash):");
for (const name of ["APPLE_PASS_CERTIFICATE_BASE64", "APPLE_PASS_PRIVATE_KEY_BASE64", "APPLE_WWDR_CERTIFICATE_BASE64"]) {
  console.log(`  node -e "process.stdout.write(require('fs').readFileSync('.secrets/${name}.b64','utf8'))" | npx wrangler secret put ${name}`);
}
console.log("  npx wrangler mtls-certificate upload --cert .secrets/pass-cert.pem --key .secrets/pass-key.pem --name hollow-apns");
console.log("Then delete .secrets/ once uploaded.");
