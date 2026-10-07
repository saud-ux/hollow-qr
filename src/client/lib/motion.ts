/**
 * Motion for the iOS app. The website never animates; inside the app every
 * effect also switches off when iPhone's Reduce Motion setting is on.
 *
 * Styles (chosen per moment):
 *   - page transitions and the order tracker: cinematic (slow, depth + blur)
 *   - add to cart: calm (quick, no bounce)
 *   - loyalty cups: lively (cups stamp onto the card)
 */
import { isNative } from "./native";

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

// ---------------------------------------------------------------------------
// Loyalty cups (lively): each new cup stamps onto the card.
// ---------------------------------------------------------------------------

export function stampCups(root: Element | null, from: number, to: number): void {
  if (!root || !motionOn() || to <= from) return;
  const cups = root.querySelectorAll(".cup-strip__cup");
  const card = root.closest(".pass, .band") ?? root;
  // A full card: once the last cup lands, the gold glow and sparkles fade in.
  const reward = root.querySelector(".cup-strip__reward");
  if (reward) {
    const after = 250 + (to - from - 1) * 380 + 420;
    void play(reward, [{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: "cubic-bezier(.2,.8,.2,1)", delay: after });
  }
  for (let i = from; i < to; i++) {
    const delay = 250 + (i - from) * 380;
    void play(
      cups[i],
      [
        { opacity: 0, transform: "scale(1.9) rotate(-18deg)" },
        { opacity: 1, transform: "scale(.9) rotate(4deg)", offset: 0.7 },
        { opacity: 1, transform: "scale(1) rotate(0deg)" },
      ],
      { duration: 420, easing: STAMP_EASE, delay },
    );
    void play(card, [{ transform: "translateY(0)" }, { transform: "translateY(2px)", offset: 0.85 }, { transform: "translateY(0)" }], {
      duration: 420,
      easing: "ease-out",
      delay,
    });
  }
}
