import { useEffect, useId, useRef, type RefObject } from "react";
import { isEdgeSwiping, motionOn } from "../lib/motion";
import { isNative, tapFeedback } from "../lib/native";

/** How far the page moves before letting go refreshes it. */
const THRESHOLD = 72;
/** Where the page rests while it refreshes. */
const HOLD = 66;
/** Coffee level in the cup drawing: empty at the bottom, full under the lid. */
const EMPTY_Y = 57;
const FULL_Y = 21;
/** The spinner stays at least this long, so a fast refresh doesn't flash. */
const MIN_SPIN_MS = 600;

/**
 * iOS app only: pull the page down from the top to refresh it. Coffee rises
 * in a HOLLOW cup as you pull; let go once it's full and it steams while the
 * page reloads. `target` is the element that moves (the page's <main>), and the
 * cup sits in the space it uncovers under the header.
 */
export function PullToRefresh({ onRefresh, target }: { onRefresh: () => Promise<unknown>; target: RefObject<HTMLElement | null> }) {
  const cupRef = useRef<HTMLDivElement>(null);
  const clipId = `ptr-cup-${useId().replace(/:/g, "")}`;
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
        cup.style.setProperty("--level", `${(EMPTY_Y - (EMPTY_Y - FULL_Y) * p).toFixed(1)}px`);
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
      if (dy <= 0 || window.scrollY > 0 || isEdgeSwiping()) {
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
  const body = "M9 17 H39 L35.6 53.5 Q35.2 57 31.8 57 H16.2 Q12.8 57 12.4 53.5 Z";
  return (
    <div className="ptr" aria-hidden="true">
      <div ref={cupRef} className="ptr__cup">
        <svg viewBox="0 0 48 60" width="40" height="50">
          <defs>
            <clipPath id={clipId}>
              <path d={body} />
            </clipPath>
          </defs>
          <g className="ptr__steam">
            <path d="M18 12 C15 8 21 6 18 2" />
            <path d="M24 12 C21 8 27 6 24 2" />
            <path d="M30 12 C27 8 33 6 30 2" />
          </g>
          <path d={body} className="ptr__body" />
          <g clipPath={`url(#${clipId})`}>
            <g className="ptr__coffee">
              <path className="ptr__wave" d="M-24 0 q6 -2.6 12 0 t12 0 t12 0 t12 0 t12 0 t12 0 t12 0 V60 H-24 Z" />
            </g>
          </g>
          <path d={body} className="ptr__outline" />
          <rect x="6.5" y="12" width="35" height="6" rx="2.5" className="ptr__lid" />
        </svg>
      </div>
    </div>
  );
}
