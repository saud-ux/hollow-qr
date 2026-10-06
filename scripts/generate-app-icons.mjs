#!/usr/bin/env node
/**
 * Generates the iOS app icon and launch images. The launch image matches the
 * app: the tent and wordmark on cream, or on dark brown in dark mode, so
 * opening the app never flashes a different color.
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
const CREAM = { r: 244, g: 237, b: 224 };
const NIGHT = { r: 23, g: 17, b: 13 };
const WORDMARK = join(ROOT, "public", "brand", "wordmark-cream.png");
const WORDMARK_DARK_INK = join(ROOT, "public", "brand", "wordmark-espresso.png");
const TENT = join(ROOT, "public", "brand", "tent-espresso.png");

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

/** Tent above the wordmark, centred in the strip a portrait iPhone shows of the square image. */
async function launchImage(background, light) {
  const size = 2732;
  const tent = await sharp(TENT).resize({ width: 820 }).toBuffer();
  const tentInk = light ? tent : await sharp(tent).negate({ alpha: false }).tint("#f1e8da").toBuffer();
  const mark = await sharp(light ? WORDMARK_DARK_INK : WORDMARK).resize({ width: 980 }).toBuffer();
  const tentMeta = await sharp(tentInk).metadata();
  const markMeta = await sharp(mark).metadata();
  const gap = 70;
  const top = Math.round((size - (tentMeta.height + gap + markMeta.height)) / 2);
  const composed = await sharp({ create: { width: size, height: size, channels: 3, background } })
    .composite([
      { input: tentInk, top, left: Math.round((size - tentMeta.width) / 2) },
      { input: mark, top: top + tentMeta.height + gap, left: Math.round((size - markMeta.width) / 2) },
    ])
    .png()
    .toBuffer();
  return sharp(composed).removeAlpha().png().toBuffer();
}

const lightSplash = await launchImage(CREAM, true);
const darkSplash = await launchImage(NIGHT, false);
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  await sharp(lightSplash).toFile(join(ASSETS, "Splash.imageset", name));
  await sharp(darkSplash).toFile(join(ASSETS, "Splash.imageset", name.replace("splash-", "splash-dark-")));
}
console.log(`App icon ${custom ? `from ${custom}` : "(wordmark)"} and launch images written.`);
