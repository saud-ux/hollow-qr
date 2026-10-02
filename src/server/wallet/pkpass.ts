/**
 * Apple Wallet bundle assembly: manifest.json (SHA-1 of every file),
 * detached PKCS#7 signature, zipped as .pkpass.
 */
import { zipSync, type Zippable } from "fflate";
import { bytesToHex } from "../security/encoding";

export const PKPASS_MIME = "application/vnd.apple.pkpass";

export type PassFiles = Record<string, Uint8Array>;

/** Pluggable pass generator so the signing implementation can be replaced. */
export interface PassGenerator {
  generate(files: PassFiles): Promise<Uint8Array>;
}

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-1", copy)));
}

export async function buildManifest(files: PassFiles): Promise<Uint8Array> {
  const manifest: Record<string, string> = {};
  for (const name of Object.keys(files).sort()) {
    if (name === "manifest.json" || name === "signature") continue;
    manifest[name] = await sha1Hex(files[name]!);
  }
  return new TextEncoder().encode(JSON.stringify(manifest));
}

export async function assemblePkpass(
  files: PassFiles,
  sign: (manifest: Uint8Array) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  if (!files["pass.json"]) throw new Error("pass.json is required");
  if (!files["icon.png"]) throw new Error("icon.png is required");
  const manifest = await buildManifest(files);
  const signature = await sign(manifest);
  const zippable: Zippable = {};
  for (const [name, bytes] of Object.entries(files)) {
    // PNGs are already compressed; store them to save CPU.
    zippable[name] = [bytes, { level: name.endsWith(".png") ? 0 : 6 }];
  }
  zippable["manifest.json"] = [manifest, { level: 6 }];
  zippable["signature"] = [signature, { level: 0 }];
  return zipSync(zippable);
}
