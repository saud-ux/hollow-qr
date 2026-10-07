import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigationType, type Location } from "react-router";
import { motionOn, runPageTransition, type TransitionKind } from "../lib/motion";
import { TabBar } from "./Shop";

const TABS = ["/menu", "/cart", "/orders", "/account"];
// The card page opens from Account, so it belongs to that tab.
const tabIndex = (path: string) => TABS.findIndex((t) => path === t || path.startsWith(`${t}/`) || (t === "/account" && path === "/wallet"));

/** push: deeper or a tab further left (RTL). back: a tab to the right. pop: back up a level. */
function transitionKind(from: string, to: string, navigationType: string): TransitionKind | null {
  if (from === to) return null;
  if (to.startsWith(`${from}/`)) return "push";
  if (from.startsWith(`${to}/`) || navigationType === "POP") return "pop";
  const i = tabIndex(from);
  const j = tabIndex(to);
  return i >= 0 && j >= 0 && j < i ? "back" : "push";
}

interface Leaving {
  location: Location;
  scrollY: number;
  kind: TransitionKind;
}

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
    setShown(location);
    setLeaving(kind ? { location: shown, scrollY: window.scrollY, kind } : null);
  }

  useLayoutEffect(() => {
    const outgoing = leavingRef.current;
    const incoming = currentRef.current;
    if (!leaving || !outgoing || !incoming) return;
    outgoing.scrollTop = leaving.scrollY;
    window.scrollTo(0, 0);
    let alive = true;
    void runPageTransition(outgoing, incoming, leaving.kind).then(() => {
      if (alive) setLeaving(null);
    });
    return () => {
      alive = false;
    };
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
