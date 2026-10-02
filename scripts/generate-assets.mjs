#!/usr/bin/env node
/**
 * Generates every derived brand / Apple Wallet image from /reference-assets.
 *
 *   pnpm assets:generate
 *
 * Runs in Node with `sharp` (a dev dependency). The Worker never processes
 * images at runtime: all Wallet images for states 0..5 (+ reward + cancelled)
 * are pre-rendered here, written to public/ for the web preview and embedded
 * into src/server/wallet/generated/pass-images.ts for pass signing.
 *
 * Replace files in /reference-assets and re-run to update the artwork.
 *
 * Apple Wallet image sizes (points; @2x/@3x are 2x/3x pixels):
 *   icon  38 x 38      logo  <= 160 x 50      strip (store card) 375 x 144
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "reference-assets");
const PUBLIC_BRAND = join(ROOT, "public", "brand");
const PUBLIC_WALLET = join(ROOT, "public", "wallet-preview");
const GENERATED_TS = join(ROOT, "src", "server", "wallet", "generated", "pass-images.ts");

export const COLORS = {
  cream: [244, 237, 224],
  paper: [251, 248, 242],
  beige: [230, 217, 195],
  espresso: [43, 30, 22],
  espressoLight: [70, 52, 40],
  cupInk: [122, 78, 45],
  gold: [201, 162, 39],
  grey: [140, 134, 128],
};
const rgb = (c, a = 1) => (a === 1 ? `rgb(${c.join(",")})` : `rgba(${c.join(",")},${a})`);

/** Recolors a dark-on-transparent PNG to a solid color, keeping its alpha. */
async function recolor(file, color, { width } = {}) {
  let img = sharp(join(REF, file)).trim().ensureAlpha();
  if (width) img = img.resize({ width, withoutEnlargement: true });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

const dataUri = (buf) => `data:image/png;base64,${buf.toString("base64")}`;

async function size(buf) {
  const m = await sharp(buf).metadata();
  return { width: m.width, height: m.height };
}

/**
 * One HOLLOW paper cup, inspired by the real cup: cream paper body, white lid,
 * HOLLOW wordmark and tent line-art printed in brown. Drawn in a 60x80 box.
 */
function cupSvg({ state, wordmark, tent }) {
  const body = "M9 15 L51 15 L46.5 74 Q46.2 77 43 77 L17 77 Q13.8 77 13.5 74 Z";
  const id = Math.random().toString(36).slice(2, 8);
  if (state === "empty") {
    return `
      <g opacity="0.55">
        <path d="${body}" fill="${rgb(COLORS.espresso, 0.85)}" stroke="${rgb(COLORS.cream, 0.7)}" stroke-width="1.4" stroke-dasharray="3 2.4" stroke-linejoin="round"/>
        <rect x="6" y="8" width="48" height="8" rx="3" fill="none" stroke="${rgb(COLORS.cream, 0.7)}" stroke-width="1.4" stroke-dasharray="3 2.4"/>
      </g>`;
  }
  const muted = state === "cancelled";
  const paper = muted ? rgb(COLORS.grey, 0.55) : rgb(COLORS.paper);
  const lid = muted ? rgb(COLORS.grey, 0.7) : "#ffffff";
  const ink = muted ? 0.35 : 1;
  return `
    <defs><clipPath id="c${id}"><path d="${body}"/></clipPath></defs>
    <path d="${body}" fill="${paper}" stroke="${rgb(COLORS.cupInk, 0.55 * ink)}" stroke-width="0.8" stroke-linejoin="round"/>
    <g clip-path="url(#c${id})" opacity="${ink}">
      <rect x="0" y="66" width="60" height="12" fill="${rgb(COLORS.beige, 0.65)}"/>
      <image href="${wordmark.uri}" x="15" y="24" width="30" height="${(30 * wordmark.h) / wordmark.w}" preserveAspectRatio="xMidYMid meet"/>
      <image href="${tent.uri}" x="11" y="38" width="38" height="${(38 * tent.h) / tent.w}" preserveAspectRatio="xMidYMid meet"/>
    </g>
    <rect x="6" y="8" width="48" height="8" rx="3" fill="${lid}" stroke="${rgb(COLORS.cupInk, 0.45 * ink)}" stroke-width="0.8"/>
    <rect x="8.5" y="5" width="43" height="4.5" rx="2" fill="${lid}" stroke="${rgb(COLORS.cupInk, 0.35 * ink)}" stroke-width="0.6"/>`;
}

/** Store-card strip: five cups showing progress (375x144 pt). */
function stripSvg({ filled, variant, wordmark, tent, tentBg, scale }) {
  const W = 375;
  const H = 144;
  const cupW = 54;
  const cupH = 72;
  const gap = 13;
  const total = 5 * cupW + 4 * gap;
  const x0 = (W - total) / 2;
  const y0 = (H - cupH) / 2 + 4;
  const reward = variant === "reward";
  const cancelled = variant === "cancelled";
  let cups = "";
  for (let i = 0; i < 5; i++) {
    const state = cancelled ? (i < filled ? "cancelled" : "empty") : i < filled ? "filled" : "empty";
    const x = x0 + i * (cupW + gap);
    cups += `<g transform="translate(${x} ${y0}) scale(${cupW / 60} ${cupH / 80})">${cupSvg({ state, wordmark, tent })}</g>`;
    if (reward) {
      cups += `<ellipse cx="${x + cupW / 2}" cy="${y0 + cupH + 3}" rx="${cupW / 2.6}" ry="3" fill="${rgb(COLORS.gold, 0.55)}"/>`;
    }
  }
  const glow = reward
    ? `<radialGradient id="g" cx="50%" cy="55%" r="65%"><stop offset="0" stop-color="${rgb(COLORS.gold, 0.45)}"/><stop offset="1" stop-color="${rgb(COLORS.gold, 0)}"/></radialGradient>
       <rect width="${W}" height="${H}" fill="url(#g)"/>`
    : "";
  const sparkles = reward
    ? [
        [x0 - 4, 26],
        [W - x0 + 2, 30],
        [W / 2, 18],
      ]
        .map(([x, y]) => `<path transform="translate(${x} ${y})" d="M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6 Z" fill="${rgb(COLORS.gold)}"/>`)
        .join("")
    : "";
  const bg = cancelled ? rgb([60, 56, 52]) : rgb(COLORS.espresso);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${bg}"/>
    <image href="${tentBg.uri}" x="${W - 210}" y="${H - 104}" width="230" height="${(230 * tentBg.h) / tentBg.w}" opacity="0.06"/>
    ${glow}
    ${cups}
    ${sparkles}
  </svg>`;
}

function iconSvg({ tentCream, scale }) {
  const S = 38;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S * scale}" height="${S * scale}" viewBox="0 0 ${S} ${S}">
    <rect width="${S}" height="${S}" fill="${rgb(COLORS.espresso)}"/>
    <image href="${tentCream.uri}" x="3" y="${(S - (32 * tentCream.h) / tentCream.w) / 2}" width="32" height="${(32 * tentCream.h) / tentCream.w}"/>
  </svg>`;
}

async function png(svg) {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true, quality: 95, effort: 10 }).toBuffer();
}

async function asset(file, color, width) {
  const buf = await recolor(file, color, { width });
  const { width: w, height: h } = await size(buf);
  return { buf, uri: dataUri(buf), w, h };
}

async function main() {
  await mkdir(PUBLIC_BRAND, { recursive: true });
  await mkdir(PUBLIC_WALLET, { recursive: true });
  await mkdir(dirname(GENERATED_TS), { recursive: true });

  // Artwork used inside cups / strips (rendered at high res, scaled by SVG).
  const cupWordmark = await asset("hollow-wallet-logo.png", COLORS.cupInk, 600);
  const cupTent = await asset("hollow-tent-art.png", COLORS.cupInk, 700);
  const tentCream = await asset("hollow-tent-art.png", COLORS.cream, 900);

  // ---- Web brand derivatives (aspect ratio preserved, never distorted) ----
  const web = {
    "wordmark-espresso.png": await recolor("hollow-wallet-logo.png", COLORS.espresso, { width: 900 }),
    "wordmark-cream.png": await recolor("hollow-wallet-logo.png", COLORS.cream, { width: 900 }),
    "tent-espresso.png": await recolor("hollow-tent-art.png", COLORS.espresso, { width: 1100 }),
    "lockup-espresso.png": await recolor("hollow-brand-lockup.png", COLORS.espresso, { width: 900 }),
  };
  for (const [name, buf] of Object.entries(web)) {
    await writeFile(join(PUBLIC_BRAND, name), buf);
    await writeFile(join(PUBLIC_BRAND, name.replace(/\.png$/, ".webp")), await sharp(buf).webp({ quality: 90 }).toBuffer());
  }
  await writeFile(join(PUBLIC_BRAND, "apple-touch-icon.png"), await png(iconSvg({ tentCream, scale: 180 / 38 })));
  await writeFile(join(PUBLIC_BRAND, "favicon-64.png"), await png(iconSvg({ tentCream, scale: 64 / 38 })));
  await writeFile(join(PUBLIC_BRAND, "icon-512.png"), await png(iconSvg({ tentCream, scale: 512 / 38 })));

  // ---- Wallet images ----
  const passImages = {};
  for (const scale of [1, 2, 3]) {
    const suffix = scale === 1 ? "" : `@${scale}x`;
    passImages[`icon${suffix}.png`] = await png(iconSvg({ tentCream, scale }));

    // Logo: wordmark fitted in 40pt height (within Apple's 160x50 allowance).
    const logoH = 40 * scale;
    passImages[`logo${suffix}.png`] = await sharp(await recolor("hollow-wallet-logo.png", COLORS.espresso))
      .resize({ height: logoH, width: 150 * scale, fit: "inside" })
      .png({ compressionLevel: 9 })
      .toBuffer();

    for (let filled = 0; filled <= 5; filled++) {
      const variant = filled === 5 ? "reward" : "progress";
      passImages[`strip-${filled}${suffix}.png`] = await png(
        stripSvg({ filled, variant, wordmark: cupWordmark, tent: cupTent, tentBg: tentCream, scale }),
      );
    }
    passImages[`strip-cancelled${suffix}.png`] = await png(
      stripSvg({ filled: 5, variant: "cancelled", wordmark: cupWordmark, tent: cupTent, tentBg: tentCream, scale }),
    );
  }

  // Web preview uses the very same strip images as the real pass.
  for (const [name, buf] of Object.entries(passImages)) {
    if (name.startsWith("strip-") && name.includes("@2x")) {
      await writeFile(join(PUBLIC_WALLET, name.replace("@2x", "")), buf);
    }
  }
  await writeFile(join(PUBLIC_WALLET, "logo.png"), passImages["logo@2x.png"]);
  await writeFile(join(PUBLIC_WALLET, "icon.png"), passImages["icon@2x.png"]);

  // Single cup indicators for the web UI.
  for (const state of ["filled", "empty"]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="240" viewBox="0 0 60 80">${cupSvg({ state, wordmark: cupWordmark, tent: cupTent })}</svg>`;
    await writeFile(join(PUBLIC_WALLET, `cup-${state}.png`), await png(svg));
  }

  let total = 0;
  const lines = Object.entries(passImages)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, buf]) => {
      total += buf.length;
      return `  ${JSON.stringify(name)}: ${JSON.stringify(buf.toString("base64"))},`;
    });
  const ts = `/* eslint-disable */
// AUTO-GENERATED by scripts/generate-assets.mjs — do not edit by hand.
// Pre-rendered Apple Wallet images (base64 PNG) so the Worker never processes
// images at runtime. Total ${Math.round(total / 1024)} KiB.
export const PASS_IMAGES_BASE64: Record<string, string> = {
${lines.join("\n")}
};
`;
  await writeFile(GENERATED_TS, ts);
  console.log(`Generated ${Object.keys(passImages).length} Wallet images (${Math.round(total / 1024)} KiB) and web assets.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
