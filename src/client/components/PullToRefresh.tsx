import { useEffect, useRef, type RefObject } from "react";
import { motionOn } from "../lib/motion";
import { isNative, tapFeedback } from "../lib/native";

/** How far the page moves before letting go refreshes it. */
const THRESHOLD = 64;
/** Where the page rests while it refreshes. */
const HOLD = 52;
/** The spinner stays at least this long, so a fast refresh doesn't flash. */
const MIN_SPIN_MS = 600;

/**
 * iOS app only: pull the page down from the top to refresh it. A HOLLOW cup
 * fills as you pull; let go once it's full and it steams while the page
 * reloads. `target` is the element that moves (the page's <main>), and the
 * cup sits in the space it uncovers under the header.
 */
export function PullToRefresh({ onRefresh, target }: { onRefresh: () => Promise<unknown>; target: RefObject<HTMLElement | null> }) {
  const cupRef = useRef<HTMLDivElement>(null);
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const page = target.current;
    if (!isNative) return;
    let startY: number | null = null;
    let pull = 0;
    let armed = false;
    let busy = false;

    const paint = (distance: number, animate: boolean) => {
      const cup = cupRef.current;
      const smooth = animate && motionOn();
      if (page) {
        page.style.transition = smooth ? "transform 380ms cubic-bezier(.2,.8,.2,1)" : "none";
        page.style.transform = distance > 0 ? `translateY(${distance}px)` : "";
      }
      if (cup) {
        const p = Math.min(distance / THRESHOLD, 1);
        cup.style.transition = smooth ? "opacity 300ms, transform 380ms cubic-bezier(.2,.8,.2,1)" : "none";
        cup.style.opacity = String(p);
        cup.style.transform = `translateX(-50%) scale(${0.6 + 0.4 * p})`;
        cup.style.setProperty("--fill", `${Math.round((1 - p) * 100)}%`);
      }
    };

    const onStart = (e: TouchEvent) => {
      const inside = e.target instanceof Element && e.target.closest("dialog, [role='dialog']");
      startY = !busy && window.scrollY <= 0 && e.touches.length === 1 && !inside ? e.touches[0]!.clientY : null;
      pull = 0;
      armed = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0]!.clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        if (pull > 0) paint(0, false);
        pull = 0;
        return;
      }
      // Rubber band: the page follows the finger less the further it goes.
      pull = Math.min(dy * 0.5, THRESHOLD * 1.6);
      if (!armed && pull >= THRESHOLD) {
        armed = true;
        tapFeedback();
      } else if (armed && pull < THRESHOLD) armed = false;
      paint(pull, false);
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      if (pull < THRESHOLD) {
        paint(0, true);
        return;
      }
      busy = true;
      paint(HOLD, true);
      cupRef.current?.classList.add("ptr__cup--busy");
      const minimum = new Promise((r) => setTimeout(r, MIN_SPIN_MS));
      void Promise.allSettled([refreshRef.current(), minimum]).then(() => {
        busy = false;
        cupRef.current?.classList.remove("ptr__cup--busy");
        paint(0, true);
      });
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      if (page) page.style.transform = "";
    };
  }, [target]);

  if (!isNative) return null;
  return (
    <div className="ptr" aria-hidden="true">
      <div ref={cupRef} className="ptr__cup">
        <img src="/wallet-preview/cup-empty.png" alt="" />
        <img src="/wallet-preview/cup-filled.png" alt="" className="ptr__fill" />
      </div>
    </div>
  );
}
