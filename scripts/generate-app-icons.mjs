#!/usr/bin/env node
/**
 * Generates the iOS app icon and launch image.
 *
 *   pnpm app:icons                      # cream HOLLOW wordmark on espresso
 *   pnpm app:icons --icon my-icon.png   # use your own square artwork
 *
 * Apple rejects icons with transparency, so the result is always flattened
 * onto the espresso background (#2b1e16) at 1024 x 1024.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "ios", "App", "App", "Assets.xcassets");
const ESPRESSO = { r: 43, g: 30, b: 22 };
const WORDMARK = join(ROOT, "public", "brand", "wordmark-cream.png");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function onEspresso(size, art, artWidth) {
  const logo = await sharp(art).resize({ width: artWidth }).toBuffer();
  const composed = await sharp({ create: { width: size, height: size, channels: 3, background: ESPRESSO } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();
  return sharp(composed).removeAlpha().png();
}

const custom = arg("icon");
const icon = custom
  ? sharp(custom).resize(1024, 1024, { fit: "cover" }).flatten({ background: ESPRESSO }).removeAlpha().png()
  : await onEspresso(1024, WORDMARK, 760);
await icon.toFile(join(ASSETS, "AppIcon.appiconset", "AppIcon-512@2x.png"));

const splash = await (await onEspresso(2732, WORDMARK, 1000)).toBuffer();
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  await sharp(splash).toFile(join(ASSETS, "Splash.imageset", name));
}
console.log(`App icon ${custom ? `from ${custom}` : "(wordmark)"} and launch images written.`);
