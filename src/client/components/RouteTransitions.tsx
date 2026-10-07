import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigationType, type Location } from "react-router";
import { motionOn, runPageTransition, takeTapOrigin, type ScreenRect, type TransitionKind } from "../lib/motion";
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

/**
 * iOS app only: keeps the previous page on screen while the next one pushes
 * in, then drops it. Both pages render from the same route table, keyed by
 * location, so the leaving page keeps its state during the animation.
 * The tab bar lives outside the pages so it stays still.
 */
export function RouteTransitions({ render }: { render: (location: Location) => ReactNode }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [shown, setShown] = useState(location);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const leavingRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);

  // Adjust state while rendering (not in an effect) so the old page never disappears for a frame.
  if (shown.key !== location.key) {
    const kind = motionOn() ? transitionKind(shown.pathname, location.pathname, navigationType) : null;
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
  }
  // Going back lands where the page was scrolled; set before the layers are dropped.
  const pendingScroll = useRef<number | null>(null);

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

  const hasDock = tabIndex(location.pathname) >= 0;
  return (
    <>
      <div className={`rt ${leaving ? `rt--active rt--${leaving.kind}` : ""} ${hasDock ? "" : "rt--nodock"}`}>
        {leaving && (
          <div key={leaving.location.key} ref={leavingRef} className="rt-layer rt-layer--leaving" inert>
            {render(leaving.location)}
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
