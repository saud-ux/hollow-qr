/**
 * Motion for the iOS app. The website never animates; inside the app every
 * effect also switches off when iPhone's Reduce Motion setting is on.
 *
 * Styles (chosen per moment):
 *   - page transitions and the order tracker: cinematic (slow, depth + blur)
 *   - everything else: calm (short, soft, no bounce), with a light haptic
 */
import { isNative, successFeedback, tapFeedback } from "./native";

const reduceQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

export function motionOn(): boolean {
  return isNative && !reduceQuery?.matches;
}

/** Adds `.motion` to <html> so CSS-only effects follow the same switch. */
export function initMotion(): void {
  if (!isNative) return;
  const apply = () => document.documentElement.classList.toggle("motion", motionOn());
  apply();
  reduceQuery?.addEventListener("change", apply);
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
// Page transitions (cinematic). RTL: a new page pushes in from the left.
// ---------------------------------------------------------------------------

export type TransitionKind = "push" | "back" | "pop";

function revealContent(page: Element, delay: number): void {
  const rows = [...page.querySelectorAll(".shop__main > *, .customer__main > *")].slice(0, 6);
  rows.forEach((row, i) =>
    void play(
      row,
      [
        { opacity: 0, transform: "translateY(22px)", filter: "blur(6px)" },
        { opacity: 1, transform: "none", filter: "blur(0px)" },
      ],
      { duration: CINEMATIC.duration * 0.9, easing: CINEMATIC.easing, delay: delay + i * 120 },
    ),
  );
}

export function runPageTransition(outgoing: HTMLElement, incoming: HTMLElement, kind: TransitionKind): Promise<void> {
  const sign = kind === "back" ? -1 : 1;
  const rest = { transform: "translateX(0) scale(1)", filter: "blur(0px)", opacity: 1 };
  const behind = { transform: `translateX(${12 * sign}%) scale(.9)`, filter: "blur(5px)", opacity: 0.35 };
  const timing = { duration: CINEMATIC.duration, easing: CINEMATIC.easing };
  if (kind === "pop") {
    return Promise.all([
      play(outgoing, [{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }], { ...timing, fill: "forwards" }),
      play(incoming, [behind, rest], timing),
    ]).then(done);
  }
  revealContent(incoming, CINEMATIC.duration * 0.35);
  return Promise.all([
    play(outgoing, [rest, behind], { ...timing, fill: "forwards" }),
    play(incoming, [{ transform: `translateX(${-100 * sign}%)` }, { transform: "translateX(0)" }], timing),
  ]).then(done);
}

// ---------------------------------------------------------------------------
// Add to cart (calm): the item's photo flies into the cart tab.
// ---------------------------------------------------------------------------

export function flyToCart(source: Element | null): void {
  if (!source || !motionOn()) return;
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
// Loyalty cups (calm): each new cup settles onto the card with a light tap;
// a full card gets a gold sheen and a success haptic.
// ---------------------------------------------------------------------------

/** `haptics`: only for cups that are new to this phone, not every time the card opens. */
export function stampCups(root: Element | null, from: number, to: number, haptics = true): void {
  if (!root || !motionOn() || to <= from) return;
  const cups = root.querySelectorAll(".cup-strip__cup");
  const step = 340;
  for (let i = from; i < to; i++) {
    const delay = 250 + (i - from) * step;
    void play(cups[i], [{ opacity: 0, transform: "scale(1.22)" }, { opacity: 1, transform: "scale(1)" }], { duration: 380, easing: CALM.easing, delay });
    if (haptics) window.setTimeout(tapFeedback, delay + 200);
  }
  // A full card: once the last cup lands, the gold glow fades in and light sweeps across.
  const reward = root.querySelector(".cup-strip__reward");
  if (reward) {
    const after = 250 + (to - from - 1) * step + 380;
    void play(reward, [{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: CALM.easing, delay: after });
    void play(root.querySelector(".cup-strip__sheen"), [{ transform: "translateX(120%)" }, { transform: "translateX(-120%)" }], {
      duration: 1200,
      easing: "ease-in-out",
      delay: after + 200,
    });
    if (haptics) window.setTimeout(successFeedback, after + 200);
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

/** The product photo grows from where it sat on the menu card into the sheet. */
export function openFromCard(origin: DOMRect | null, target: HTMLElement | null, rest: Element[]): void {
  if (!origin || !target || !motionOn() || origin.width === 0) return;
  const to = target.getBoundingClientRect();
  if (to.width === 0) return;
  const ghost = target.cloneNode(true) as HTMLElement;
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${origin.left}px`,
    top: `${origin.top}px`,
    width: `${origin.width}px`,
    height: `${origin.height}px`,
    margin: "0",
    zIndex: "80",
    pointerEvents: "none",
    overflow: "hidden",
    borderRadius: "14px",
  });
  document.body.appendChild(ghost);
  target.style.visibility = "hidden";
  const timing = { duration: 420, easing: CALM.easing, fill: "forwards" as const };
  ghost
    .animate(
      [
        { left: `${origin.left}px`, top: `${origin.top}px`, width: `${origin.width}px`, height: `${origin.height}px`, borderRadius: "14px" },
        { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: getComputedStyle(target).borderRadius || "0px" },
      ],
      timing,
    )
    .finished.then(done, done)
    .finally(() => {
      target.style.visibility = "";
      ghost.remove();
    });
  rest.forEach((el, i) => void play(el, [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: CALM.easing, delay: 160 + i * 50 }));
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
