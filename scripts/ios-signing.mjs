#!/usr/bin/env node
/**
 * iOS signing through the App Store Connect API, so no Mac is ever needed.
 * Used by .github/workflows/ios-setup.yml and ios-testflight.yml.
 *
 *   node scripts/ios-signing.mjs setup <outDir>
 *     One-time: registers the App ID (with Push Notifications), creates an
 *     Apple Distribution certificate and the App Store provisioning profile.
 *     Writes <outDir>/IOS_SIGNING.txt: the certificate + private key (PEM),
 *     which the workflow saves as the IOS_SIGNING repository secret.
 *
 *   node scripts/ios-signing.mjs profile <file> [<widgetsFile>]
 *     Downloads the active App Store profile to <file> (re-creating it if
 *     it has expired or no longer matches the certificate), and the widget
 *     extension's profile to <widgetsFile>, registering its App ID if needed.
 *
 * Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 (the .p8 contents or base64 of it),
 *      IOS_SIGNING (profile command: to find the matching certificate).
 */
import { createPrivateKey, createSign, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Profile names match PROVISIONING_PROFILE_SPECIFIER in project.pbxproj.
const APP = { bundleId: "com.hollowzulfi.coffee", name: "HOLLOW Coffee", profile: "HOLLOW Coffee App Store", push: true };
const WIDGETS = { bundleId: "com.hollowzulfi.coffee.widgets", name: "HOLLOW Coffee Widgets", profile: "HOLLOW Coffee Widgets App Store", push: false };
const API = "https://api.appstoreconnect.apple.com";

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set (add it under Settings → Secrets and variables → Actions)`);
  return value;
}

function ascKey() {
  const raw = env("ASC_KEY_P8");
  const pem = raw.includes("-----BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return createPrivateKey(pem);
}

function b64url(data) {
  return Buffer.from(data).toString("base64url");
}

function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: env("ASC_KEY_ID"), typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: env("ASC_ISSUER_ID"), iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }));
  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  const sig = signer.sign({ key: ascKey(), dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64url(sig)}`;
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = (json.errors ?? []).map((e) => `${e.title}: ${e.detail}`).join("; ");
    const error = new Error(`${method} ${path} → ${res.status} ${detail}`);
    error.status = res.status;
    throw error;
  }
  return json;
}

async function ensureBundleId(target = APP) {
  const found = await api("GET", `/v1/bundleIds?filter[identifier]=${target.bundleId}&limit=200`);
  let bundle = found.data.find((b) => b.attributes.identifier === target.bundleId);
  if (!bundle) {
    bundle = (
      await api("POST", "/v1/bundleIds", {
        data: { type: "bundleIds", attributes: { identifier: target.bundleId, name: target.name, platform: "IOS" } },
      })
    ).data;
    console.log(`Registered App ID ${target.bundleId}`);
  } else console.log(`App ID ${target.bundleId} already registered`);
  if (!target.push) return bundle;

  try {
    await api("POST", "/v1/bundleIdCapabilities", {
      data: {
        type: "bundleIdCapabilities",
        attributes: { capabilityType: "PUSH_NOTIFICATIONS" },
        relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } } },
      },
    });
    console.log("Enabled Push Notifications");
  } catch (err) {
    if (err.status !== 409) throw err;
    console.log("Push Notifications already enabled");
  }
  return bundle;
}

async function findCertificate(certPem) {
  const serial = new X509Certificate(certPem).serialNumber.toUpperCase().replace(/^0+/, "");
  const certs = await api("GET", "/v1/certificates?limit=200");
  return certs.data.find((c) => c.attributes.serialNumber.toUpperCase().replace(/^0+/, "") === serial) ?? null;
}

async function createProfile(bundleId, certificateId, profileName = APP.profile) {
  const existing = await api("GET", `/v1/profiles?filter[name]=${encodeURIComponent(profileName)}&limit=200`);
  for (const p of existing.data) await api("DELETE", `/v1/profiles/${p.id}`);
  const created = await api("POST", "/v1/profiles", {
    data: {
      type: "profiles",
      attributes: { name: profileName, profileType: "IOS_APP_STORE" },
      relationships: {
        bundleId: { data: { type: "bundleIds", id: bundleId } },
        certificates: { data: [{ type: "certificates", id: certificateId }] },
      },
    },
  });
  console.log(`Created provisioning profile "${profileName}"`);
  return created.data;
}

async function setup(outDir) {
  mkdirSync(outDir, { recursive: true });
  const bundle = await ensureBundleId();

  const keyPath = join(outDir, "key.pem");
  const csrPath = join(outDir, "csr.pem");
  execFileSync("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", csrPath, "-subj", "/CN=HOLLOW Coffee CI/C=SA"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let cert;
  try {
    cert = (
      await api("POST", "/v1/certificates", {
        data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent: readFileSync(csrPath, "utf8") } },
      })
    ).data;
  } catch (err) {
    if (err.status === 409) {
      throw new Error(
        "Apple allows only a few distribution certificates. Revoke an unused one at developer.apple.com → Certificates, then run this again.\n" + err.message,
        { cause: err },
      );
    }
    throw err;
  }
  const certPem = `-----BEGIN CERTIFICATE-----\n${cert.attributes.certificateContent.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
  console.log(`Created Apple Distribution certificate (expires ${cert.attributes.expirationDate})`);

  await createProfile(bundle.id, cert.id);
  writeFileSync(join(outDir, "IOS_SIGNING.txt"), certPem + readFileSync(keyPath, "utf8"));
  console.log("Wrote IOS_SIGNING.txt");
}

async function profileFor(target, cert, file) {
  const bundle = await ensureBundleId(target);
  const found = await api("GET", `/v1/profiles?filter[name]=${encodeURIComponent(target.profile)}&filter[profileState]=ACTIVE&include=certificates&limit=20`);
  let current = found.data.find((p) => (p.relationships?.certificates?.data ?? []).some((c) => c.id === cert.id));
  if (!current) current = await createProfile(bundle.id, cert.id, target.profile);
  writeFileSync(file, Buffer.from(current.attributes.profileContent, "base64"));
  console.log(`Profile "${target.profile}" saved (expires ${current.attributes.expirationDate})`);
}

async function profile(file, widgetsFile) {
  const signing = env("IOS_SIGNING");
  const certPem = signing.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
  if (!certPem) throw new Error("IOS_SIGNING does not contain a certificate: run the iOS setup workflow again");
  const cert = await findCertificate(certPem);
  if (!cert) throw new Error("The IOS_SIGNING certificate was revoked or expired: run the iOS setup workflow again");

  await profileFor(APP, cert, file);
  if (widgetsFile) await profileFor(WIDGETS, cert, widgetsFile);
}

const [command, arg, arg2] = process.argv.slice(2);
try {
  if (command === "setup" && arg) await setup(arg);
  else if (command === "profile" && arg) await profile(arg, arg2);
  else {
    console.error("usage: ios-signing.mjs setup <outDir> | profile <file> [<widgetsFile>]");
    process.exit(2);
  }
} catch (err) {
  console.error(`::error::${err.message}`);
  process.exit(1);
}
