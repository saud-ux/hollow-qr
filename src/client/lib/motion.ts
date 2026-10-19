/**
 * Motion for the iOS app and the customer website. Every effect switches off
 * when the device's Reduce Motion setting is on.
 *
 * Styles (chosen per moment):
 *   - page transitions and the order tracker: cinematic (slow, depth + blur)
 *   - everything else: calm (short, soft, no bounce), with a light haptic
 */
import { successFeedback } from "./native";

const reduceQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

export function motionOn(): boolean {
  return !reduceQuery?.matches;
}

let motionReady = false;

/** Adds `.motion` to <html> so CSS-only effects follow the same switch. */
export function initMotion(): void {
  if (motionReady) return;
  motionReady = true;
  const apply = () => document.documentElement.classList.toggle("motion", motionOn());
  apply();
  reduceQuery?.addEventListener("change", apply);
  watchTaps();
}

export const CINEMATIC = { duration: 850, easing: "cubic-bezier(.16,1,.3,1)" } as const;
export const CALM = { duration: 300, easing: "cubic-bezier(.2,.8,.2,1)" } as const;
const STAMP_EASE = "cubic-bezier(.3,1.4,.6,1)";

/** Staff pages are on the website: they move too, unless Reduce Motion is on. */
export function staffMotionOn(): boolean {
  return !reduceQuery?.matches;
}

const done = () => undefined;

/** Runs a Web Animation when motion is on. Defaults to `fill: "backwards"` so CSS owns the end state. */
export function play(el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (!el || !motionOn() || typeof el.animate !== "function") return Promise.resolve();
  return el.animate(keyframes, { fill: "backwards", ...options }).finished.then(done, done);
}

// ---------------------------------------------------------------------------
// Page transitions. Opening something: the thing you tapped grows into the
// new page, and going back shrinks the page into it again. With nothing to
// grow from, the page slides in from the trailing side (the right in English,
// the left in Arabic), like iOS. Tabs cross-fade.
// ---------------------------------------------------------------------------

/** 1 when pages push in from the right (English), -1 when they push in from the left (Arabic). */
export function pushSide(): 1 | -1 {
  return document.documentElement.dir === "rtl" ? -1 : 1;
}

/** How far the page underneath sits to the side while another covers it. */
export const PARALLAX = 0.28;

let edgeSwiping = false;

/** Set while the back swipe follows a finger, so other touch gestures stand down. */
export function setEdgeSwiping(on: boolean): void {
  edgeSwiping = on;
}

export function isEdgeSwiping(): boolean {
  return edgeSwiping;
}

export type TransitionKind = "push" | "pop" | "tab";

/** A box on screen, in viewport pixels. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const GROW = { duration: 560, easing: "cubic-bezier(.3,.7,.1,1)" } as const;
const SLIDE = { duration: 420, easing: "cubic-bezier(.32,.72,0,1)" } as const;

let lastTap: { el: Element; at: number } | null = null;
let inAppBackAt = -Infinity;

/** The page's own Back button was tapped (the browser's back has its own animation). */
export function markInAppBack(): void {
  inAppBackAt = performance.now();
}

export function wasInAppBack(): boolean {
  return performance.now() - inAppBackAt < 1000;
}

/** Remembers what was tapped last, so the page it opens can grow out of it. */
function watchTaps(): void {
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target instanceof Element ? e.target.closest("a, button, [role='button'], [role='link'], .menu-card, .order-row") : null;
      // The tab bar switches sections; nothing grows from it.
      lastTap = el && !el.closest(".tabbar") ? { el, at: performance.now() } : null;
    },
    true,
  );
}

/** Where the page that is opening now should grow from (taken once). */
export function takeTapOrigin(): ScreenRect | null {
  const tap = lastTap;
  lastTap = null;
  // Allows for a short wait (placing an order) between the tap and the page.
  if (!tap || !tap.el.isConnected || performance.now() - tap.at > 1500) return null;
  const r = tap.el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8 || r.width * r.height > innerWidth * innerHeight * 0.6) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

const insetOf = (r: ScreenRect) =>
  `inset(${r.top}px ${innerWidth - r.left - r.width}px ${innerHeight - r.top - r.height}px ${r.left}px round 16px)`;
const FULL = "inset(0px 0px 0px 0px round 0px)";

/** The new page's first blocks rise in while it opens. */
function riseIn(page: Element, delay: number): void {
  [...page.querySelectorAll(".shop__main > *, .customer__main > *")].slice(0, 6).forEach((row, i) =>
    void play(row, [{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: CALM.easing, delay: delay + i * 50 }),
  );
}

export function runPageTransition(outgoing: HTMLElement, incoming: HTMLElement, kind: TransitionKind, origin: ScreenRect | null): Promise<void> {
  if (kind === "tab") {
    return Promise.all([
      play(incoming, [{ opacity: 0, transform: "scale(.985)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" }),
      play(outgoing, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-out", fill: "forwards" }),
    ]).then(done);
  }
  if (kind === "push" && origin) {
    riseIn(incoming, GROW.duration * 0.3);
    return Promise.all([
      play(incoming, [{ clipPath: insetOf(origin) }, { clipPath: FULL }], GROW),
      play(outgoing, [{ filter: "brightness(1)" }, { filter: "brightness(.88)" }], { ...GROW, fill: "forwards" }),
    ]).then(done);
  }
  if (kind === "pop" && origin) {
    // The page folds back into what was tapped, then fades into it.
    return Promise.all([
      play(outgoing, [{ clipPath: FULL, opacity: 1 }, { clipPath: insetOf(origin), opacity: 1, offset: 0.85 }, { clipPath: insetOf(origin), opacity: 0 }], { ...GROW, duration: 480, fill: "forwards" }),
      play(incoming, [{ filter: "brightness(.88)" }, { filter: "brightness(1)" }], { ...GROW, duration: 480 }),
    ]).then(done);
  }
  const side = pushSide();
  const away = `translateX(${side * 100}%)`;
  const under = `translateX(${-side * PARALLAX * 100}%)`;
  if (kind === "push") {
    riseIn(incoming, SLIDE.duration * 0.25);
    return Promise.all([
      play(incoming, [{ transform: away }, { transform: "none" }], SLIDE),
      play(outgoing, [{ transform: "none", filter: "brightness(1)" }, { transform: under, filter: "brightness(.82)" }], { ...SLIDE, fill: "forwards" }),
    ]).then(done);
  }
  return Promise.all([
    play(outgoing, [{ transform: "none" }, { transform: away }], { ...SLIDE, fill: "forwards" }),
    play(incoming, [{ transform: under, filter: "brightness(.82)" }, { transform: "none", filter: "brightness(1)" }], SLIDE),
  ]).then(done);
}

// ---------------------------------------------------------------------------
// Add to cart (calm): the item's photo flies into the cart tab.
// ---------------------------------------------------------------------------

export function flyToCart(source: Element | null): void {
  // Over the search page the cart is out of sight: the + turning into the stepper says it.
  if (!source || !motionOn() || document.documentElement.classList.contains("search-open")) return;
  const target = document.querySelector('.rt-tabdock a[href="/cart"] svg') ?? document.querySelector('.tabbar a[href="/cart"] svg');
  if (!target) return;
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (from.width === 0 || to.width === 0) return;
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.classList.add("fly-ghost");
  ghost.removeAttribute("loading");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: "0",
    zIndex: "60",
    pointerEvents: "none",
  });
  document.body.appendChild(ghost);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const end = Math.max(0.08, (to.width * 1.1) / from.width);
  ghost
    .animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1, borderRadius: "14px" },
        { transform: `translate(${dx * 0.42}px, ${dy * 0.42 - 50}px) scale(${Math.max(end, 0.55)})`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(${end})`, opacity: 0.85, borderRadius: "50%" },
      ],
      { duration: 560, easing: "cubic-bezier(.45,0,.25,1)", fill: "forwards" },
    )
    .finished.then(
      () => {
        ghost.remove();
        void play(document.querySelector(".rt-tabdock .tabbar__badge"), [{ transform: "scale(1)" }, { transform: "scale(1.18)", offset: 0.4 }, { transform: "scale(1)" }], CALM);
      },
      () => ghost.remove(),
    );
}

// ---------------------------------------------------------------------------
// Order tracker (cinematic).
// ---------------------------------------------------------------------------

/**
 * Animates the tracker from step `from` to step `to` (indexes into the
 * steps list). The DOM already shows the new state; this only plays it in.
 * `from = -1` draws the whole tracker when the order first opens.
 */
export function animateTracker(root: Element | null, from: number, to: number): void {
  if (!root || !motionOn()) return;
  const items = [...root.querySelectorAll(".steps__item")];
  const first = Math.max(from, 0);
  const lineDuration = from < 0 ? 420 : CINEMATIC.duration;
  let delay = 0;
  for (let k = first; k < to; k++) {
    void play(items[k]?.querySelector(".steps__line i"), [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], {
      duration: lineDuration,
      easing: CINEMATIC.easing,
      delay,
    });
    delay += lineDuration * 0.75;
    const next = items[k + 1];
    void play(next?.querySelector(".steps__dot"), [{ transform: "scale(.4)" }, { transform: "scale(1.25)", offset: 0.55 }, { transform: "scale(1)" }], {
      duration: CINEMATIC.duration,
      easing: CINEMATIC.easing,
      delay,
    });
    void play(next?.querySelector(".steps__label"), [{ opacity: 0.3, filter: "blur(4px)" }, { opacity: 1, filter: "blur(0px)" }], {
      duration: CINEMATIC.duration,
      easing: CINEMATIC.easing,
      delay,
    });
  }
  if (from < 0) return;
  // A status change: the new status sharpens in and light sweeps the ticket.
  for (const el of root.querySelectorAll(".ticket__status, .ticket__headline")) {
    void play(
      el,
      [
        { opacity: 0, filter: "blur(6px)", transform: "translateY(8px)" },
        { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" },
      ],
      { duration: CINEMATIC.duration * 0.8, easing: CINEMATIC.easing },
    );
  }
  void play(root.querySelector(".ticket__sheen"), [{ transform: "translateX(-120%)" }, { transform: "translateX(120%)" }], {
    duration: 1100,
    easing: "ease-in-out",
  });
}

/**
 * Ready: the HOLLOW cup rises onto the ticket, steam starts to rise from it
 * (CSS loops it from there), then a gold check badge stamps onto the cup.
 */
export function serveCup(root: Element | null): void {
  const cup = root?.querySelector(".ready-cup");
  if (!cup || !motionOn()) return;
  void play(cup.querySelector(".ready-cup__img"), [{ opacity: 0, transform: "translateY(14px) scale(.85)" }, { opacity: 1, transform: "none" }], {
    duration: 600,
    easing: CINEMATIC.easing,
    delay: 250,
  });
  void play(cup.querySelector(".ready-cup__steam"), [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 700 });
  void play(cup.querySelector(".ready-cup__badge"), [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, transform: "scale(1)" }], {
    duration: 380,
    easing: STAMP_EASE,
    delay: 1700,
  });
  void play(cup.querySelector(".ready-cup__badge path"), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
    duration: 420,
    easing: CINEMATIC.easing,
    delay: 2050,
  });
}

// ---------------------------------------------------------------------------
// Loyalty cups: coffee pours into each cup and rises, then the rim and the
// printed body fade in over it and it becomes the HOLLOW cup. A full card then
// turns its tent gold, with a success haptic. (CupStrip draws the stream, the
// coffee, the body and the rim.)
// ---------------------------------------------------------------------------

/** The next cup starts pouring while this one is still filling. */
const POUR_STEP = 620;
/** One cup: the stream (0–1120ms), the coffee rising (140–960), the rim (1020–1280), the body over the coffee (1110–1370). */
const POUR = { stream: 1120, rise: [140, 820], rim: 1020, body: 1110 } as const;
const POUR_DONE = 1400;

/** `celebrate`: buzz when the card is full, only when that's new to this phone. */
export function pourCups(root: Element | null, from: number, to: number, celebrate = true): void {
  if (!root || !motionOn() || to <= from) return;
  const pours = root.querySelectorAll(".cup-strip__pour");
  const bodies = root.querySelectorAll(".cup-strip__body");
  const rims = root.querySelectorAll(".cup-strip__rim");
  for (let i = from; i < to; i++) {
    const delay = 250 + (i - from) * POUR_STEP;
    const pour = pours[i];
    const level = pour?.querySelector<HTMLElement>(".cup-strip__level");
    // The stream reaches down into the cup, then its tail falls in after it.
    void play(
      pour?.querySelector(".cup-strip__stream"),
      [
        { clipPath: "inset(0% 0% 100% 0%)", easing: "ease-in" },
        { clipPath: "inset(0% 0% 0% 0%)", offset: 0.18 },
        { clipPath: "inset(0% 0% 0% 0%)", offset: 0.8, easing: "ease-in" },
        { clipPath: "inset(100% 0% 0% 0%)" },
      ],
      { duration: POUR.stream, easing: "linear", delay },
    );
    // The coffee stays full until the cup's body has covered it.
    const rising = level?.animate([{ transform: level.style.transform }, { transform: `translateY(${level.dataset.full})` }], {
      duration: POUR.rise[1],
      delay: delay + POUR.rise[0],
      easing: "cubic-bezier(.35,.05,.35,1)",
      fill: "both",
    });
    pour?.classList.add("is-pouring");
    void play(rims[i], [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: delay + POUR.rim, easing: "ease-out" });
    void play(bodies[i], [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: delay + POUR.body, easing: "ease-out" }).then(() => {
      rising?.cancel();
      pour?.classList.remove("is-pouring");
    });
  }
  // A full card: once the last cup shows, the gold tent fades in.
  const reward = root.querySelector(".cup-strip__reward");
  if (reward) {
    const after = 250 + (to - from - 1) * POUR_STEP + POUR_DONE;
    void play(reward, [{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: CALM.easing, delay: after });
    if (celebrate) window.setTimeout(successFeedback, after + 200);
  }
}

// ---------------------------------------------------------------------------
// Calm extras: + becoming a stepper, the photo opening into the product
// sheet, and the order button turning into a check.
// ---------------------------------------------------------------------------

/** The + button grows into the quantity stepper. */
export function growStepper(stepper: Element | null, fromWidth: number): void {
  if (!stepper || !motionOn()) return;
  const to = stepper.getBoundingClientRect().width;
  if (!to || to <= fromWidth) return;
  void play(stepper, [{ width: `${fromWidth}px`, opacity: 0.6 }, { width: `${to}px`, opacity: 1 }], { duration: 300, easing: CALM.easing });
  for (const child of stepper.children) void play(child, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 120 });
}

/**
 * The tapped menu card grows into the product sheet: the sheet opens out of
 * the card's box while the photo, name and price travel to their places.
 * `forward: false` folds the sheet back into the card.
 */
export function morphCardSheet(card: Element | null, sheet: HTMLElement | null, forward: boolean): Promise<void> {
  if (!card || !sheet || !motionOn() || !card.isConnected) return Promise.resolve();
  const c = card.getBoundingClientRect();
  const sh = sheet.getBoundingClientRect();
  if (!c.width || !sh.width) return Promise.resolve();
  const t: KeyframeAnimationOptions = { ...GROW, duration: forward ? GROW.duration : 440, fill: "both", direction: forward ? "normal" : "reverse" };
  const runs: Animation[] = [];
  const add = (el: Element | null | undefined, frames: Keyframe[], o = t) => {
    if (el && typeof el.animate === "function") runs.push(el.animate(frames, o));
  };
  // Measure every shared piece before anything moves.
  const rtl = getComputedStyle(sheet).direction === "rtl";
  const pairs: [string, string, boolean][] = [
    [":is(.menu-card__img, .search-row__img)", ".product-sheet__photo", false],
    [":is(.menu-card__name, .search-row__name)", ".product-sheet__name", true],
    [":is(.menu-card__price, .search-row__price) .price-now", ".product-sheet__price .price-now", true],
  ];
  const shared = pairs.flatMap(([from, to, text]) => {
    const src = card.querySelector(from);
    const dst = sheet.querySelector(to);
    if (!src || !dst) return [];
    const a = src.getBoundingClientRect();
    const b = dst.getBoundingClientRect();
    return a.height && b.height ? [{ dst, a, b, text }] : [];
  });
  // The sheet starts lifted up to the card's top edge and cut down to the card's
  // box, then drops into place as it opens out to full size.
  const lift = c.top - sh.top;
  const clipFrom = `inset(0px ${sh.right - c.right}px ${Math.max(sh.height - c.height, 0)}px ${c.left - sh.left}px round 16px)`;
  add(sheet, [
    { transform: `translateY(${lift}px)`, clipPath: clipFrom },
    { transform: "none", clipPath: "inset(0px 0px 0px 0px round 24px 24px 0px 0px)" },
  ]);
  // Shared pieces start where they sit on the card. Text keeps its reading edge.
  for (const { dst, a, b, text } of shared) {
    const origin = text ? (rtl ? "top right" : "top left") : "top left";
    const dx = text ? (rtl ? a.right - b.right : a.left - b.left) : a.left - b.left;
    const scale = text ? `scale(${a.height / b.height})` : `scale(${a.width / b.width}, ${a.height / b.height})`;
    add(dst, [{ transformOrigin: origin, transform: `translate(${dx}px, ${a.top - b.top - lift}px) ${scale}` }, { transformOrigin: origin, transform: "none" }]);
  }
  // Everything else on the sheet rises in once the card has opened up.
  const rest = [...sheet.querySelectorAll(".product-sheet__body > *:not(.product-sheet__head), .product-sheet__close, .product-sheet__head .pass-label, .product-sheet__price .price-was, .product-sheet__price .kcal")];
  rest.forEach((el, i) => add(el, [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 0, transform: "translateY(12px)", offset: Math.min(0.35 + i * 0.05, 0.6) }, { opacity: 1, transform: "none" }]));
  // The card's own content steps aside while its sheet opens out of it.
  const cardParts = [...card.children].filter((el) => !el.contains(sheet));
  for (const part of cardParts) add(part, [{ opacity: 1 }, { opacity: 0, offset: 0.02 }, { opacity: 0 }]);
  if (!forward) add(sheet.parentElement, [{ backgroundColor: "rgb(20 12 8 / 45%)" }, { backgroundColor: "rgb(20 12 8 / 0%)" }], { duration: 440, easing: "ease-in", fill: "forwards" });
  return Promise.all(runs.map((r) => r.finished.then(done, done))).then(() => {
    // The card shows again; the sheet keeps its end state only while closing.
    for (const r of runs) {
      const target = (r.effect as KeyframeEffect | null)?.target ?? null;
      if (forward || (target && cardParts.includes(target))) r.cancel();
    }
  });
}

/**
 * The product sheet drops away and its dimming clears together. `from` is
 * where a drag left the sheet: from there it carries on at the finger's pace;
 * from rest (added to the cart) it speeds up as it goes.
 */
/**
 * The search page grows out of the «بحث» button (and folds back into it):
 * its clip opens from the button's box to the whole screen while its
 * content rises in. Closing, the content fades first and the page fades as
 * it lands on the button, which shows again under it.
 */
export function growSearch(screen: HTMLElement | null, content: Element | null, button: DOMRect | null, opening: boolean): Promise<void> {
  if (!screen || !button || !motionOn() || !button.width) return Promise.resolve();
  const box = screen.getBoundingClientRect();
  const r = button.height / 2;
  const pill = `inset(${button.top - box.top}px ${box.right - button.right}px ${box.bottom - button.bottom}px ${button.left - box.left}px round ${r}px)`;
  const open = "inset(0px 0px 0px 0px round 0px)";
  if (opening) {
    void play(content, [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 280, delay: 170, easing: CALM.easing });
    return play(screen, [{ clipPath: pill }, { clipPath: open }], { duration: 460, easing: GROW.easing });
  }
  void play(content, [{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: "forwards" });
  return play(
    screen,
    [
      { clipPath: open, opacity: 1 },
      { clipPath: pill, opacity: 1, offset: 0.8 },
      { clipPath: pill, opacity: 0 },
    ],
    { duration: 420, delay: 60, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
  );
}

export function dropSheet(sheet: HTMLElement | null, from = 0): Promise<void> {
  if (!sheet || !motionOn()) return Promise.resolve();
  const t: KeyframeAnimationOptions = from > 0 ? { duration: 260, easing: CALM.easing, fill: "forwards" } : { duration: 320, easing: "cubic-bezier(.4,0,.8,.3)", fill: "forwards" };
  const runs = [sheet.animate([{ transform: `translateY(${from}px)` }, { transform: "translateY(100%)" }], t)];
  const backdrop = sheet.parentElement;
  if (backdrop) runs.push(backdrop.animate([{ backgroundColor: getComputedStyle(backdrop).backgroundColor }, { backgroundColor: "rgb(20 12 8 / 0%)" }], t));
  return Promise.all(runs.map((r) => r.finished.then(done, done))).then(done);
}

/**
 * The sheet's photo opens into the full-screen viewer, and closes back into
 * it: the viewer's image starts cropped to the photo's box and opens out
 * while the black fades in behind it.
 */
export function zoomPhoto(photo: Element | null, viewer: HTMLElement | null, opening: boolean): Promise<void> {
  if (!viewer || !motionOn()) return Promise.resolve();
  const img = viewer.querySelector("img");
  const t: KeyframeAnimationOptions = { duration: opening ? 460 : 380, easing: GROW.easing, fill: "forwards", direction: opening ? "normal" : "reverse" };
  const runs = [viewer.animate([{ backgroundColor: "rgb(0 0 0 / 0%)" }, { backgroundColor: "rgb(0 0 0 / 100%)" }], { ...t, duration: opening ? 320 : 300 })];
  const hint = viewer.querySelector(".photo-viewer__hint");
  if (hint) runs.push(hint.animate([{ opacity: 0 }, { opacity: 1 }], { ...t, duration: opening ? 300 : 120, delay: opening ? 250 : 0 }));
  const a = photo?.getBoundingClientRect();
  const b = img?.getBoundingClientRect();
  if (img && a?.width && b?.width) {
    // Scaled so the whole image covers the photo's box, then cut to that box.
    const k = Math.max(a.width / b.width, a.height / b.height);
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const cutX = Math.max((b.width - a.width / k) / 2, 0);
    const cutY = Math.max((b.height - a.height / k) / 2, 0);
    runs.push(
      img.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${k})`, clipPath: `inset(${cutY}px ${cutX}px)` },
          { transform: "none", clipPath: "inset(0px 0px)" },
        ],
        t,
      ),
    );
  } else if (img) {
    runs.push(img.animate([{ opacity: 0 }, { opacity: 1 }], { ...t, duration: 260 }));
  }
  return Promise.all(runs.map((r) => r.finished.then(done, done))).then(done);
}

// ---------------------------------------------------------------------------
// Content arriving: photos that took a moment fade in, and whatever replaces
// a loading placeholder rises in instead of popping in.
// ---------------------------------------------------------------------------

/** `shownAt`: when the image was put on the page. Photos that were already cached just show. */
export function fadeInPhoto(img: HTMLImageElement, shownAt: number): void {
  if (performance.now() - shownAt < 120) return;
  void play(img, [{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: "ease-out" });
}

/**
 * Rises in the children of `parent` that weren't there `before` (the first few, one after another).
 * A child marked `data-own-entrance` plays its own entrance instead.
 */
export function riseInNew(parent: Element, before: ReadonlySet<Element>): void {
  if (!parent.isConnected) return;
  [...parent.children]
    .filter((el) => !before.has(el) && !(el instanceof HTMLElement && "ownEntrance" in el.dataset))
    .slice(0, 6)
    .forEach((el, i) => void play(el, [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 360, easing: CALM.easing, delay: i * 60 }));
}

// ---------------------------------------------------------------------------
// My orders: each past order opens out of its photo. The photo pops in, the
// card opens from it across the row, then the words and the status follow,
// one order after another.
// ---------------------------------------------------------------------------

export function openOrdersFromPhotos(rows: Iterable<Element>): void {
  if (!motionOn()) return;
  const rtl = pushSide() === -1;
  [...rows].slice(0, 8).forEach((row, i) => {
    const thumbs = row.querySelector(".order-thumbs");
    if (!thumbs) return;
    const r = row.getBoundingClientRect();
    const t = thumbs.getBoundingClientRect();
    // At first only the photo shows: everything past it is cut away.
    const rest = Math.max(0, rtl ? t.left - r.left - 6 : r.right - t.right - 6);
    const photoOnly = rtl ? `inset(0 0 0 ${rest}px round 14px)` : `inset(0 ${rest}px 0 0 round 14px)`;
    const delay = i * 80;
    void play(row, [{ clipPath: photoOnly, opacity: 0 }, { clipPath: photoOnly, opacity: 1, offset: 0.25 }, { clipPath: "inset(0 0 0 0 round 14px)", opacity: 1 }], {
      duration: 640,
      easing: CALM.easing,
      delay,
    });
    void play(thumbs, [{ transform: "scale(0.6)" }, { transform: "none" }], { duration: 360, easing: STAMP_EASE, delay });
    void play(row.querySelector(".order-row__main"), [{ opacity: 0, transform: `translateX(${rtl ? 12 : -12}px)` }, { opacity: 1, transform: "none" }], {
      duration: 380,
      easing: CALM.easing,
      delay: delay + 200,
    });
    void play(row.querySelector(".order-row__side"), [{ opacity: 0, transform: "scale(0.7)" }, { opacity: 1, transform: "none" }], {
      duration: 320,
      easing: STAMP_EASE,
      delay: delay + 420,
    });
  });
}

// ---------------------------------------------------------------------------
// Account: the avatar grows out of a point while its gold ring draws round
// it, the name and email follow, and the sections under it rise in. The
// balance and the hospitality cups count up from 0 (countUp).
// ---------------------------------------------------------------------------

/** `hero` is the account's top card; the sections after it rise in too. */
export function enterAccount(hero: Element | null): void {
  if (!hero || !motionOn()) return;
  void play(hero.querySelector(".acct-hero__avatar"), [{ opacity: 0, transform: "translateX(-50%) scale(0.3)" }, { opacity: 1, transform: "translateX(-50%)" }], {
    duration: 480,
    easing: STAMP_EASE,
  });
  void play(hero.querySelector(".acct-hero__ring circle"), [{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: 800, easing: CALM.easing, delay: 150 });
  void play(hero.querySelector(".acct-hero__name"), [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: CALM.easing, delay: 250 });
  void play(hero.querySelector(".acct-hero__meta"), [{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: CALM.easing, delay: 330 });
  const siblings = hero.parentElement ? [...hero.parentElement.children] : [];
  riseInTurn(siblings.slice(siblings.indexOf(hero) + 1).filter((el) => el.matches(".benefits-account, .benefits-gift, .acct-sec")), 200);
}

/** Rises in `els` one after another, the first after `delay`. */
export function riseInTurn(els: Element[], delay = 0): void {
  els.slice(0, 6).forEach((el, i) => {
    void play(el, [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 400, easing: CALM.easing, delay: delay + i * 80 });
  });
}

/**
 * Counts the text of `el` from `from` to `to`, written by `format`, easing out
 * as it nears the end. Returns a function that stops counting (the page then
 * shows whatever it renders next).
 */
export function countUp(el: Element | null, from: number, to: number, format: (n: number) => string, { duration = 900, delay = 0 } = {}): () => void {
  if (!el) return done;
  if (!motionOn() || from === to) {
    el.textContent = format(to);
    return done;
  }
  const start = performance.now() + delay;
  let frame = 0;
  const tick = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    el.textContent = format(t < 1 ? Math.round(from + (to - from) * (1 - (1 - t) ** 3)) : to);
    if (t < 1) frame = requestAnimationFrame(tick);
  };
  el.textContent = format(from);
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// My card tilts a few degrees with the phone (or under a finger), with a soft
// gloss that follows the light. It drifts back to flat when the phone rests.
// ---------------------------------------------------------------------------

type OrientationEventWithPermission = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };

const MAX_TILT = 6;
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/** Returns a cleanup function. */
export function tiltCard(card: HTMLElement | null): () => void {
  if (!card || !motionOn()) return done;
  let target = { x: 0, y: 0 };
  const now = { x: 0, y: 0 };
  let base: { beta: number; gamma: number } | null = null;
  let touching = false;
  let frame = 0;

  const render = () => {
    now.x += (target.x - now.x) * 0.12;
    now.y += (target.y - now.y) * 0.12;
    card.style.setProperty("--tilt-x", `${now.x.toFixed(2)}deg`);
    card.style.setProperty("--tilt-y", `${now.y.toFixed(2)}deg`);
    card.style.setProperty("--gloss-x", `${(50 + now.y * 7).toFixed(1)}%`);
    card.style.setProperty("--gloss-y", `${(30 - now.x * 7).toFixed(1)}%`);
    frame = Math.abs(target.x - now.x) + Math.abs(target.y - now.y) > 0.02 ? requestAnimationFrame(render) : 0;
  };
  const aim = (x: number, y: number) => {
    target = { x: clamp(x, MAX_TILT), y: clamp(y, MAX_TILT) };
    if (!frame) frame = requestAnimationFrame(render);
  };

  const onOrientation = (e: DeviceOrientationEvent) => {
    if (touching || e.beta === null || e.gamma === null) return;
    // "Flat" is however the phone is being held; it slowly follows the hand.
    base ??= { beta: e.beta, gamma: e.gamma };
    base.beta += (e.beta - base.beta) * 0.03;
    base.gamma += (e.gamma - base.gamma) * 0.03;
    aim(-(e.beta - base.beta) * 0.4, (e.gamma - base.gamma) * 0.4);
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touching = true;
    onMove(e);
  };
  const onMove = (e: PointerEvent) => {
    if (!touching) return;
    const r = card.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = ((e.clientY - r.top) / r.height) * 2 - 1;
    aim(-py * MAX_TILT, px * MAX_TILT);
  };
  const onUp = () => {
    touching = false;
    aim(0, 0);
  };

  // iOS asks the page to request motion access from a tap; the app grants it
  // without a prompt, so the first touch anywhere turns it on.
  const Orientation = window.DeviceOrientationEvent as OrientationEventWithPermission | undefined;
  const ask = () => void Orientation?.requestPermission?.().catch(() => undefined);
  if (typeof Orientation?.requestPermission === "function") window.addEventListener("pointerup", ask, { once: true });
  window.addEventListener("deviceorientation", onOrientation);
  card.addEventListener("pointerdown", onDown);
  card.addEventListener("pointermove", onMove);
  card.addEventListener("pointerup", onUp);
  card.addEventListener("pointercancel", onUp);
  card.classList.add("is-tilting");

  return () => {
    window.removeEventListener("pointerup", ask);
    window.removeEventListener("deviceorientation", onOrientation);
    card.removeEventListener("pointerdown", onDown);
    card.removeEventListener("pointermove", onMove);
    card.removeEventListener("pointerup", onUp);
    card.removeEventListener("pointercancel", onUp);
    card.classList.remove("is-tilting");
    cancelAnimationFrame(frame);
  };
}

// ---------------------------------------------------------------------------
// Staff order board (website; still with Reduce Motion): a new order slides in
// at the top of its column, and an accepted order glides to the next column
// while the tickets around it close the gap.
// ---------------------------------------------------------------------------

export interface BoardMemory {
  /** Where each visible ticket sat after the last update, relative to the board. */
  spots: Map<string, { x: number; y: number }>;
  /** Every order the board has shown; null until the first load. */
  known: Set<string> | null;
  running: WeakMap<Element, Animation>;
}

export function newBoardMemory(): BoardMemory {
  return { spots: new Map(), known: null, running: new WeakMap() };
}

/** Call after every board update; `still` only re-measures (resize, tab switch). */
export function animateBoard(board: HTMLElement | null, memory: BoardMemory, still = false): void {
  if (!board) return;
  const animate = !still && memory.known !== null && staffMotionOn() && typeof board.animate === "function";
  const tickets = [...board.querySelectorAll<HTMLElement>("[data-ticket]")];
  // Measure where tickets really sit, not where an unfinished glide has them.
  for (const el of tickets) memory.running.get(el)?.cancel();
  const origin = board.getBoundingClientRect();
  const spots = new Map<string, { x: number; y: number }>();
  for (const el of tickets) {
    const id = el.dataset.ticket ?? "";
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue; // in a hidden tab on the phone
    const spot = { x: r.left - origin.left, y: r.top - origin.top };
    spots.set(id, spot);
    if (!animate) continue;
    const before = memory.spots.get(id);
    let animation: Animation | null = null;
    if (!memory.known?.has(id)) {
      animation = el.animate([{ opacity: 0, transform: "translateY(-16px) scale(0.98)" }, { opacity: 1, transform: "none" }], {
        duration: 480,
        easing: CALM.easing,
        fill: "backwards",
      });
    } else if (before) {
      const dx = before.x - spot.x;
      const dy = before.y - spot.y;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      el.style.zIndex = "1";
      animation = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: Math.abs(dx) > 40 ? 560 : 380,
        easing: CALM.easing,
      });
    }
    if (!animation) continue;
    memory.running.set(el, animation);
    const running = animation;
    void running.finished.then(done, done).finally(() => {
      if (memory.running.get(el) === running) el.style.zIndex = "";
    });
  }
  memory.spots = spots;
  memory.known = new Set([...(memory.known ?? []), ...tickets.map((el) => el.dataset.ticket ?? "")]);
}
