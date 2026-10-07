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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import hbReady from "harfbuzzjs";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "reference-assets");
const FONTS = join(REF, "fonts");
const PUBLIC_BRAND = join(ROOT, "public", "brand");
const PUBLIC_WALLET = join(ROOT, "public", "wallet-preview");
const GENERATED_TS = join(ROOT, "src", "server", "wallet", "generated", "pass-images.ts");
const WIDGET_ASSETS = join(ROOT, "ios", "App", "HollowWidgets", "Assets.xcassets");

export const COLORS = {
  cream: [244, 237, 224],
  paper: [251, 248, 242],
  beige: [230, 217, 195],
  espresso: [43, 30, 22],
  espressoLight: [70, 52, 40],
  cupInk: [122, 78, 45],
  gold: [201, 162, 39],
  grey: [140, 134, 128],
  coffee: [92, 58, 34],
  crema: [196, 150, 98],
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
 * `open` leaves the lid off, shows the coffee and is a little shorter (the
 * app's "ready" cup).
 */
function cupSvg({ state, wordmark, tent, open = false }) {
  const body = open
    ? "M9 15 L51 15 L47.2 65 Q46.9 68 43.7 68 L16.3 68 Q13.1 68 12.8 65 Z"
    : "M9 15 L51 15 L46.5 74 Q46.2 77 43 77 L17 77 Q13.8 77 13.5 74 Z";
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
      <rect x="0" y="${open ? 60 : 66}" width="60" height="12" fill="${rgb(COLORS.beige, 0.65)}"/>
      <image href="${wordmark.uri}" x="15" y="24" width="30" height="${(30 * wordmark.h) / wordmark.w}" preserveAspectRatio="xMidYMid meet"/>
      <image href="${tent.uri}" x="11" y="38" width="38" height="${(38 * tent.h) / tent.w}" preserveAspectRatio="xMidYMid meet"/>
    </g>
    ${
      open
        ? `<ellipse cx="30" cy="15.4" rx="21.4" ry="3.6" fill="${paper}" stroke="${rgb(COLORS.cupInk, 0.55 * ink)}" stroke-width="0.8"/>
    <ellipse cx="30" cy="15.7" rx="19" ry="2.6" fill="${rgb(COLORS.coffee)}"/>
    <ellipse cx="27" cy="15.2" rx="9" ry="0.9" fill="${rgb(COLORS.crema, 0.55)}"/>`
        : `<rect x="6" y="8" width="48" height="8" rx="3" fill="${lid}" stroke="${rgb(COLORS.cupInk, 0.45 * ink)}" stroke-width="0.8"/>
    <rect x="8.5" y="5" width="43" height="4.5" rx="2" fill="${lid}" stroke="${rgb(COLORS.cupInk, 0.35 * ink)}" stroke-width="0.6"/>`
    }`;
}

/** An empty cup for a light or dark widget: a dashed outline in `color`. */
function outlineCupSvg(color) {
  return `
    <path d="M9 15 L51 15 L46.5 74 Q46.2 77 43 77 L17 77 Q13.8 77 13.5 74 Z" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="3 2.4" stroke-linejoin="round"/>
    <rect x="6" y="8" width="48" height="8" rx="3" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="3 2.4"/>`;
}

/**
 * Images for the iOS widget extension's asset catalog. Each image set gets
 * one @3x PNG, plus a dark-mode variant where the look differs.
 */
async function writeWidgetAssets({ cupWordmark, cupTent }) {
  const sets = {
    CupFilled: { light: cupSvg({ state: "filled", wordmark: cupWordmark, tent: cupTent }) },
    CupOpen: { light: cupSvg({ state: "filled", wordmark: cupWordmark, tent: cupTent, open: true }) },
    CupEmpty: { light: outlineCupSvg(rgb(COLORS.cupInk, 0.45)), dark: outlineCupSvg(rgb(COLORS.cream, 0.5)) },
  };
  const write = async (name, files) => {
    const dir = join(WIDGET_ASSETS, `${name}.imageset`);
    await mkdir(dir, { recursive: true });
    const images = [];
    for (const [variant, buf] of Object.entries(files)) {
      const filename = `${name}${variant === "dark" ? "-dark" : ""}.png`;
      await writeFile(join(dir, filename), buf);
      images.push({
        ...(variant === "dark" ? { appearances: [{ appearance: "luminosity", value: "dark" }] } : {}),
        filename,
        idiom: "universal",
        scale: "3x",
      });
    }
    await writeFile(join(dir, "Contents.json"), `${JSON.stringify({ images, info: { author: "xcode", version: 1 } }, null, 2)}\n`);
  };
  for (const [name, variants] of Object.entries(sets)) {
    const files = {};
    for (const [variant, body] of Object.entries(variants)) {
      files[variant] = await png(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="240" viewBox="0 0 60 80">${body}</svg>`);
    }
    await write(name, files);
  }
  const espresso = await sharp(join(PUBLIC_BRAND, "wordmark-espresso.png")).resize({ width: 450 }).png().toBuffer();
  const cream = await sharp(join(PUBLIC_BRAND, "wordmark-cream.png")).resize({ width: 450 }).png().toBuffer();
  await write("Wordmark", { light: espresso, dark: cream });
  await write("WordmarkCream", { light: cream });
  await mkdir(WIDGET_ASSETS, { recursive: true });
  await writeFile(join(WIDGET_ASSETS, "Contents.json"), `${JSON.stringify({ info: { author: "xcode", version: 1 } }, null, 2)}\n`);
}

/**
 * Turns text into SVG outlines (HarfBuzz shaping, IBM Plex Sans Arabic from
 * reference-assets/fonts), so text drawn into the Wallet strip looks the same
 * whichever machine runs this script; no system fonts are involved.
 */
async function textOutliner() {
  const hb = await hbReady;
  const fonts = {};
  for (const [weight, file] of Object.entries({ semibold: "IBMPlexSansArabic-SemiBold.ttf", bold: "IBMPlexSansArabic-Bold.ttf" })) {
    const face = hb.createFace(hb.createBlob(await readFile(join(FONTS, file))), 0);
    fonts[weight] = { font: hb.createFont(face), upem: face.upem };
  }
  /** Returns the outlines (origin on the baseline, at the left edge) and the width in points. */
  return (text, { size, weight = "bold", tracking = 0 }) => {
    // HarfBuzz shapes one direction run; a multi-digit number inside Arabic would come out reversed.
    if (/[\u0600-\u06ff]/.test(text) && /\d{2,}/.test(text)) throw new Error(`mixed-direction text not supported: ${text}`);
    const { font, upem } = fonts[weight];
    const buffer = hb.createBuffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    const glyphs = buffer.json();
    buffer.destroy();
    const k = size / upem;
    let x = 0;
    let paths = "";
    for (const g of glyphs) {
      const d = font.glyphToPath(g.g);
      if (d) paths += `<path transform="translate(${((x + g.dx) * k).toFixed(2)} ${(-g.dy * k).toFixed(2)}) scale(${k.toFixed(5)} ${(-k).toFixed(5)})" d="${d}"/>`;
      x += g.ax + tracking * upem;
    }
    return { paths, width: (x - tracking * upem) * k };
  };
}

/**
 * The words drawn into the Wallet strip for each state. They match
 * cupsLabel() and rewardText() (src/shared/format.ts, src/server/wallet/pass-content.ts).
 */
function stripCaption(filled, variant) {
  if (variant === "cancelled") return { reward: "العضوية غير نشطة" };
  const left = 5 - filled;
  const reward =
    left === 0 ? "لك مشروب مجاني" : left === 1 ? "باقي كوب واحد للمشروب المجاني" : `باقي ${left} أكواب للمشروب المجاني`;
  return { progress: `${filled} / 5 Cups`, reward, gold: left === 0 };
}

/** The progress line under the cups of the Wallet strip, like the in-app card. */
function captionSvg({ caption, text, W, x0, muted }) {
  const label = muted ? rgb(COLORS.grey) : "rgb(201,164,110)";
  const value = muted ? rgb(COLORS.grey) : rgb(COLORS.cream);
  const at = (t, x, y, fill) => `<g transform="translate(${x.toFixed(2)} ${y})" fill="${fill}">${t.paths}</g>`;
  const right = W - x0;
  let out = "";
  const rewardLabel = text("المكافأة", { size: 12.5, weight: "semibold" });
  out += at(rewardLabel, right - rewardLabel.width, 104, label);
  let progressWidth = 0;
  if (caption.progress) {
    out += at(text("HOLLOW REWARDS", { size: 11.5, weight: "semibold", tracking: 0.06 }), x0, 104, label);
    const progress = text(caption.progress, { size: 20 });
    progressWidth = progress.width;
    out += at(progress, x0, 131, value);
  }
  // Shrink the reward line if it would run into the progress value.
  const room = right - x0 - progressWidth - (progressWidth ? 18 : 0);
  let reward = text(caption.reward, { size: 16 });
  if (reward.width > room) reward = text(caption.reward, { size: (16 * room) / reward.width });
  out += at(reward, right - reward.width, 130, caption.gold ? rgb([217, 181, 74]) : value);
  return out;
}

/**
 * Store-card strip: five cups showing progress (375x144 pt).
 * With `text` (the Wallet pass) the cups move up, the tent sits in the middle
 * and the progress line is drawn under the cups; without it (the in-app card,
 * which cuts its cups out of these strips) the layout stays as it was.
 */
function stripSvg({ filled, variant, wordmark, tent, tentBg, scale, text }) {
  const W = 375;
  const H = 144;
  // The Wallet strip uses bigger cups, closer together, to fill its fixed height.
  const cupW = text ? 57 : 54;
  const cupH = text ? 76 : 72;
  const gap = text ? 10 : 13;
  const total = 5 * cupW + 4 * gap;
  const x0 = (W - total) / 2;
  const y0 = text ? 6 : (H - cupH) / 2 + 4;
  const reward = variant === "reward";
  const cancelled = variant === "cancelled";
  let cups = "";
  for (let i = 0; i < 5; i++) {
    const state = cancelled ? (i < filled ? "cancelled" : "empty") : i < filled ? "filled" : "empty";
    const x = x0 + i * (cupW + gap);
    cups += `<g transform="translate(${x} ${y0}) scale(${cupW / 60} ${cupH / 80})">${cupSvg({ state, wordmark, tent })}</g>`;
    // The gold shadows under the cups are left off the Wallet strip.
    if (reward && !text) {
      cups += `<ellipse cx="${x + cupW / 2}" cy="${y0 + cupH + 3}" rx="${cupW / 2.6}" ry="3" fill="${rgb(COLORS.gold, 0.55)}"/>`;
    }
  }
  const glow = reward
    ? `<radialGradient id="g" cx="50%" cy="${text ? 35 : 55}%" r="65%"><stop offset="0" stop-color="${rgb(COLORS.gold, 0.45)}"/><stop offset="1" stop-color="${rgb(COLORS.gold, 0)}"/></radialGradient>
       <rect width="${W}" height="${H}" fill="url(#g)"/>`
    : "";
  const sparkles = reward
    ? (text
        ? [
            [x0 - 12, 22],
            [W - x0 + 10, 30],
          ]
        : [
            [x0 - 4, 26],
            [W - x0 + 2, 30],
            [W / 2, 18],
          ]
      )
        .map(([x, y]) => `<path transform="translate(${x} ${y})" d="M0 -6 L1.6 -1.6 L6 0 L1.6 1.6 L0 6 L-1.6 1.6 L-6 0 L-1.6 -1.6 Z" fill="${rgb(COLORS.gold)}"/>`)
        .join("")
    : "";
  const bg = cancelled ? rgb([60, 56, 52]) : rgb(COLORS.espresso);
  const tentW = 300;
  const tentH = (tentW * tentBg.h) / tentBg.w;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${bg}"/>
    ${text ? `<image href="${tentBg.uri}" x="${(W - tentW) / 2}" y="${(H - tentH) / 2}" width="${tentW}" height="${tentH}" opacity="0.08"/>` : `<image href="${tentBg.uri}" x="${W - 210}" y="${H - 104}" width="230" height="${(230 * tentBg.h) / tentBg.w}" opacity="0.06"/>`}
    ${glow}
    ${cups}
    ${sparkles}
    ${text ? captionSvg({ caption: stripCaption(filled, variant), text, W, x0, muted: cancelled }) : ""}
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
  const text = await textOutliner();
  const passImages = {};
  const previewStrips = {};
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
      const strip = { filled, variant, wordmark: cupWordmark, tent: cupTent, tentBg: tentCream, scale };
      passImages[`strip-${filled}${suffix}.png`] = await png(stripSvg({ ...strip, text }));
      if (scale === 2) previewStrips[`strip-${filled}.png`] = await png(stripSvg(strip));
    }
    const cancelled = { filled: 5, variant: "cancelled", wordmark: cupWordmark, tent: cupTent, tentBg: tentCream, scale };
    passImages[`strip-cancelled${suffix}.png`] = await png(stripSvg({ ...cancelled, text }));
    if (scale === 2) previewStrips["strip-cancelled.png"] = await png(stripSvg(cancelled));
  }

  // The in-app card draws its own text, so it gets the same cups without the words.
  for (const [name, buf] of Object.entries(previewStrips)) await writeFile(join(PUBLIC_WALLET, name), buf);
  // The app cuts each cup out of a strip and stamps it in. They come from this
  // plain strip (five cups, no reward glow) so no glow is cut out with the cup;
  // the full reward strip then fades in over them.
  await writeFile(
    join(PUBLIC_WALLET, "strip-5-plain.png"),
    await png(stripSvg({ filled: 5, variant: "progress", wordmark: cupWordmark, tent: cupTent, tentBg: tentCream, scale: 2 })),
  );
  await writeFile(join(PUBLIC_WALLET, "logo.png"), passImages["logo@2x.png"]);
  await writeFile(join(PUBLIC_WALLET, "icon.png"), passImages["icon@2x.png"]);

  // Single cup indicators for the web UI.
  for (const state of ["filled", "empty"]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="240" viewBox="0 0 60 80">${cupSvg({ state, wordmark: cupWordmark, tent: cupTent })}</svg>`;
    await writeFile(join(PUBLIC_WALLET, `cup-${state}.png`), await png(svg));
  }
  await writeWidgetAssets({ cupWordmark, cupTent });

  // The open cup (no lid) that steams on a ready order, drawn larger for the order screen.
  await writeFile(
    join(PUBLIC_WALLET, "cup-open.png"),
    await png(
      `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="284" viewBox="0 0 60 71">${cupSvg({ state: "filled", wordmark: cupWordmark, tent: cupTent, open: true })}</svg>`,
    ),
  );

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
