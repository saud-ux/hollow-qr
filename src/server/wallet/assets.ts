/**
 * Chooses the pre-rendered Wallet images for a loyalty state.
 *
 * Apple Wallet controls pass layout: we cannot place five arbitrary cup icons
 * on the card. The legitimate equivalent is the store-card strip image,
 * which we pre-render for every state (0..5 + cancelled) at build time with
 * scripts/generate-assets.mjs. Selecting a strip is a map lookup; nothing is
 * rendered at request time.
 */
import { MAX_STAMPS } from "../../shared/constants";
import { base64ToBytes } from "../security/encoding";
import { PASS_IMAGES_BASE64 } from "./generated/pass-images";
import type { PassFiles } from "./pkpass";

const decoded = new Map<string, Uint8Array>();
function image(name: string): Uint8Array {
  let bytes = decoded.get(name);
  if (!bytes) {
    const b64 = PASS_IMAGES_BASE64[name];
    if (!b64) throw new Error(`missing generated pass image ${name}`);
    bytes = base64ToBytes(b64);
    decoded.set(name, bytes);
  }
  return bytes;
}

export function stripKey(stampCount: number, cancelled: boolean): string {
  if (cancelled) return "strip-cancelled";
  const n = Math.min(Math.max(Math.trunc(stampCount), 0), MAX_STAMPS);
  return `strip-${n}`;
}

export function passImagesFor(stampCount: number, cancelled: boolean): PassFiles {
  const strip = stripKey(stampCount, cancelled);
  const files: PassFiles = {};
  for (const suffix of ["", "@2x", "@3x"]) {
    files[`icon${suffix}.png`] = image(`icon${suffix}.png`);
    files[`logo${suffix}.png`] = image(`logo${suffix}.png`);
    files[`strip${suffix}.png`] = image(`${strip}${suffix}.png`);
  }
  return files;
}
