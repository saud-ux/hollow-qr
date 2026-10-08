import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigationType, type Location } from "react-router";
import { isNative } from "../lib/native";
import { motionOn, PARALLAX, pushSide, runPageTransition, setEdgeSwiping, takeTapOrigin, type ScreenRect, type TransitionKind } from "../lib/motion";
import { TabBar } from "./Shop";

const TABS = ["/menu", "/cart", "/orders", "/account"];
// The card page opens from Account, so it belongs to that tab.
const tabIndex = (path: string) => TABS.findIndex((t) => path === t || path.startsWith(`${t}/`) || (t === "/account" && path === "/wallet"));

/** push: opening something. pop: going back. tab: switching between the tab bar's sections. */
function transitionKind(from: string, to: string, navigationType: string): TransitionKind | null {
  if (from === to) return null;
  if (to.startsWith(`${from}/`)) return "push";
  if (from.startsWith(`${to}/`) || navigationType === "POP") return "pop";
  const i = tabIndex(from);
  const j = tabIndex(to);
  if (TABS.includes(from) && TABS.includes(to) && i !== j) return "tab";
  return "push";
}

interface Leaving {
  location: Location;
  scrollY: number;
  kind: TransitionKind;
  /** What the new page grows from (push), or folds back into (pop). */
  origin: ScreenRect | null;
  /** Going back: where the page we return to was scrolled. */
  restoreY: number;
}

// Per history entry: where it was scrolled when we left it, and what was
// tapped to open it (so going back can fold the page into it again).
const scrolls = new Map<string, number>();
const origins = new Map<string, ScreenRect>();
// The page shown at each step of the app's history (React Router keeps the step in history.state).
const entries = new Map<number, Location>();
const historyIdx = () => (window.history.state as { idx?: number } | null)?.idx ?? 0;

/** A back swipe can start this close to the leading edge (the right in Arabic, the left in English). */
const EDGE = 28;
/** Let go past this share of the screen (or with a flick) and the swipe goes back. */
const COMMIT = 0.35;
const FLICK = 0.4; // px per ms
const SETTLE_EASE = "cubic-bezier(.2,.8,.2,1)";

interface Swipe {
  phase: "idle" | "maybe" | "drag" | "settling";
  startX: number;
  startY: number;
  /** 1 when the finger moves right to go back (English), -1 when it moves left (Arabic). */
  side: 1 | -1;
  /** 0 = page in place, 1 = page fully off screen. */
  progress: number;
  lastX: number;
  lastT: number;
  velocity: number;
  savedY: number;
}

// Set when a swipe has already slid the page away, so going back swaps the pages without another animation.
let swipedBack: { restoreY: number } | null = null;

const swipeLayers = (side: 1 | -1, progress: number) => ({
  top: `translateX(${side * progress * 100}%)`,
  under: `translateX(${-side * PARALLAX * (1 - progress) * 100}%)`,
  dim: `brightness(${0.82 + 0.18 * progress})`,
});

/** Places the page and the one under it for a back swipe `progress` of 0..1. */
function placeLayers(top: HTMLElement | null, under: HTMLElement | null, side: 1 | -1, progress: number): void {
  const at = swipeLayers(side, progress);
  if (top) top.style.transform = at.top;
  if (under) {
    under.style.transform = at.under;
    under.style.filter = at.dim;
  }
}

/**
 * iOS app only: keeps the previous page on screen while the next one pushes
 * in, then drops it. Both pages render from the same route table, keyed by
 * location, so the leaving page keeps its state during the animation.
 * The tab bar lives outside the pages so it stays still.
 *
 * On a page opened from another one, swiping in from the leading edge drags
 * the page away and shows the previous one underneath, like iOS: right to
 * left in Arabic, left to right in English.
 */
export function RouteTransitions({ render }: { render: (location: Location) => ReactNode }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [shown, setShown] = useState(location);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  // The previous page, shown underneath while a back swipe follows the finger.
  const [peek, setPeek] = useState<Location | null>(null);
  const leavingRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);

  // Adjust state while rendering (not in an effect) so the old page never disappears for a frame.
  if (shown.key !== location.key) {
    const swiped = swipedBack !== null;
    const kind = !swiped && motionOn() ? transitionKind(shown.pathname, location.pathname, navigationType) : null;
    scrolls.set(shown.key, window.scrollY);
    let origin: ScreenRect | null = null;
    if (kind === "push") {
      origin = takeTapOrigin();
      if (origin) origins.set(location.key, origin);
    } else if (kind === "pop") {
      origin = origins.get(shown.key) ?? null;
    }
    const restoreY = kind === "pop" ? (scrolls.get(location.key) ?? 0) : 0;
    setShown(location);
    setLeaving(kind ? { location: shown, scrollY: window.scrollY, kind, origin, restoreY } : null);
    if (swiped) setPeek(null);
  }
  // Going back lands where the page was scrolled; set before the layers are dropped.
  const pendingScroll = useRef<number | null>(null);

  useLayoutEffect(() => {
    entries.set(historyIdx(), location);
  }, [location]);

  useLayoutEffect(() => {
    const outgoing = leavingRef.current;
    const incoming = currentRef.current;
    if (!leaving || !outgoing || !incoming) return;
    outgoing.scrollTop = leaving.scrollY;
    incoming.scrollTop = leaving.restoreY;
    window.scrollTo(0, 0);
    let alive = true;
    void runPageTransition(outgoing, incoming, leaving.kind, leaving.origin).then(() => {
      if (!alive) return;
      pendingScroll.current = leaving.restoreY;
      setLeaving(null);
    });
    return () => {
      alive = false;
    };
  }, [leaving]);

  useLayoutEffect(() => {
    if (leaving || pendingScroll.current === null) return;
    window.scrollTo(0, pendingScroll.current);
    pendingScroll.current = null;
  }, [leaving]);

  // ---- Back swipe ----
  const swipe = useRef<Swipe>({ phase: "idle", startX: 0, startY: 0, side: 1, progress: 0, lastX: 0, lastT: 0, velocity: 0, savedY: 0 });
  const live = useRef({ location, leaving, peek });
  useLayoutEffect(() => {
    live.current = { location, leaving, peek };
  });

  // The previous page is now under the current one: freeze both where they are scrolled.
  useLayoutEffect(() => {
    const s = swipe.current;
    if (peek) {
      if (currentRef.current) currentRef.current.scrollTop = s.savedY;
      if (peekRef.current) peekRef.current.scrollTop = scrolls.get(peek.key) ?? 0;
      window.scrollTo(0, 0);
      placeLayers(currentRef.current, peekRef.current, s.side, s.progress);
    } else if (s.phase === "settling" && !swipedBack) {
      // The swipe was let go too early: the page is back in place.
      if (currentRef.current) currentRef.current.style.transform = "";
      window.scrollTo(0, s.savedY);
      s.phase = "idle";
    }
  }, [peek]);

  // The swipe went back: the page that was underneath is now the page.
  useLayoutEffect(() => {
    if (!swipedBack) return;
    const el = currentRef.current;
    if (el) {
      el.style.transform = "";
      el.style.filter = "";
    }
    window.scrollTo(0, swipedBack.restoreY);
    swipedBack = null;
    swipe.current.phase = "idle";
  }, [location.key]);

  useEffect(() => {
    if (!isNative) return;
    const s = swipe.current;

    const previous = (): Location | null => {
      const { location: here, leaving: busy, peek: open } = live.current;
      if (busy || open || TABS.includes(here.pathname)) return null;
      const idx = historyIdx();
      return idx > 0 ? (entries.get(idx - 1) ?? null) : null;
    };

    const settle = (back: boolean) => {
      s.phase = "settling";
      setEdgeSwiping(false);
      const from = s.progress;
      const to = back ? 1 : 0;
      const duration = Math.max(120, Math.min(320, Math.abs(to - from) * 420));
      const top = currentRef.current;
      const under = peekRef.current;
      const finish = () => {
        s.progress = to;
        placeLayers(top, under, s.side, to);
        if (back) {
          swipedBack = { restoreY: under?.scrollTop ?? 0 };
          window.history.back();
        } else {
          setPeek(null);
        }
      };
      if (!top || typeof top.animate !== "function") {
        finish();
        return;
      }
      const opts = { duration, easing: SETTLE_EASE };
      const a = swipeLayers(s.side, from);
      const b = swipeLayers(s.side, to);
      const animations = [top.animate([{ transform: a.top }, { transform: b.top }], opts)];
      if (under) animations.push(under.animate([{ transform: a.under, filter: a.dim }, { transform: b.under, filter: b.dim }], opts));
      // Inline styles hold the end state, so the animations can go once they finish.
      placeLayers(top, under, s.side, to);
      void Promise.all(animations.map((anim) => anim.finished)).then(
        () => {
          animations.forEach((anim) => anim.cancel());
          finish();
        },
        () => finish(),
      );
    };

    const onStart = (e: TouchEvent) => {
      if (s.phase !== "idle" || e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const side = pushSide();
      const fromEdge = side === 1 ? t.clientX : window.innerWidth - t.clientX;
      const inDialog = e.target instanceof Element && e.target.closest("dialog, [role='dialog']");
      if (fromEdge > EDGE || inDialog || !previous()) return;
      Object.assign(s, { phase: "maybe", startX: t.clientX, startY: t.clientY, side, progress: 0, lastX: t.clientX, lastT: e.timeStamp, velocity: 0 });
    };

    const onMove = (e: TouchEvent) => {
      if (s.phase !== "maybe" && s.phase !== "drag") return;
      const t = e.touches[0]!;
      const dx = (t.clientX - s.startX) * s.side;
      const dy = t.clientY - s.startY;
      if (s.phase === "maybe") {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          s.phase = "idle";
          return;
        }
        if (dx < 10 || dx < Math.abs(dy)) return;
        const prev = previous();
        if (!prev) {
          s.phase = "idle";
          return;
        }
        s.phase = "drag";
        s.savedY = window.scrollY;
        setEdgeSwiping(true);
        setPeek(prev);
      }
      e.preventDefault();
      const dt = e.timeStamp - s.lastT;
      if (dt > 0) s.velocity = ((t.clientX - s.lastX) * s.side) / dt;
      s.lastX = t.clientX;
      s.lastT = e.timeStamp;
      s.progress = Math.min(Math.max(dx / window.innerWidth, 0), 1);
      placeLayers(currentRef.current, peekRef.current, s.side, s.progress);
    };

    const onEnd = (e: TouchEvent) => {
      if (s.phase === "maybe") s.phase = "idle";
      if (s.phase !== "drag") return;
      // A finger that stopped before letting go isn't a flick.
      const flick = e.timeStamp - s.lastT < 80 && s.velocity > FLICK;
      settle(s.progress > COMMIT || (flick && s.progress > 0.05));
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const hasDock = tabIndex(location.pathname) >= 0;
  const active = leaving ? `rt--active rt--${leaving.kind}` : peek ? "rt--active rt--swipe" : "";
  return (
    <>
      <div className={`rt ${active} ${hasDock ? "" : "rt--nodock"}`}>
        {leaving && (
          <div key={leaving.location.key} ref={leavingRef} className="rt-layer rt-layer--leaving" inert>
            {render(leaving.location)}
          </div>
        )}
        {peek && !leaving && (
          <div key={peek.key} ref={peekRef} className="rt-layer rt-layer--peek" inert>
            {render(peek)}
          </div>
        )}
        <div key={location.key} ref={currentRef} className="rt-layer rt-layer--current">
          {render(location)}
        </div>
      </div>
      {hasDock && (
        <div className="shop__dock rt-tabdock">
          <TabBar />
        </div>
      )}
    </>
  );
}
