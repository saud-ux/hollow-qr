import { useLayoutEffect, useRef, type ReactNode } from "react";
import { CALM, motionOn } from "../lib/motion";
import { tapFeedback } from "../lib/native";
import { tr } from "../lib/i18n";

const THRESHOLD = 90;

/**
 * A cart line the customer can swipe sideways (either way) to delete. Only
 * touch starts it, and only a mostly sideways move, so the page still scrolls.
 * `onDelete` gets the side it went (1 = right, -1 = left); a line put back
 * (Undo) passes that side as `appear` to slide back in from it.
 */
export function SwipeToDelete({
  onDelete,
  appear,
  className,
  children,
}: {
  onDelete: (side: 1 | -1) => void;
  appear?: 1 | -1;
  className?: string;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const fgRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; dx: number; on: boolean; past: boolean } | null>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const fg = fgRef.current;
    if (!appear || !row || !fg || !motionOn()) return;
    const h = row.getBoundingClientRect().height;
    row.animate([{ height: "0px", opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: 260, easing: CALM.easing });
    fg.animate([{ transform: `translateX(${appear * 110}%)` }, { transform: "none" }], { duration: 340, easing: CALM.easing, delay: 120, fill: "backwards" });
    // Only as it first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setX = (x: number) => {
    if (fgRef.current) fgRef.current.style.transform = x ? `translateX(${x}px)` : "";
  };

  async function remove(dx: number) {
    const row = rowRef.current;
    const fg = fgRef.current;
    if (row && fg && motionOn()) {
      await fg.animate([{ transform: `translateX(${dx}px)` }, { transform: `translateX(${Math.sign(dx) * 110}%)` }], { duration: 200, easing: "ease-in", fill: "forwards" }).finished.catch(() => undefined);
      const h = row.getBoundingClientRect().height;
      await row.animate([{ height: `${h}px`, opacity: 1 }, { height: "0px", opacity: 0, marginBottom: "0px" }], { duration: 260, easing: CALM.easing, fill: "forwards" }).finished.catch(() => undefined);
    }
    onDelete(dx > 0 ? 1 : -1);
  }

  return (
    <li ref={rowRef} className={`swipe ${className ?? ""}`}>
      {/* The line can go either way, so the word waits on both sides. */}
      <div className="swipe__under" aria-hidden="true">
        <span>{tr("حذف", "Delete")}</span>
        <span>{tr("حذف", "Delete")}</span>
      </div>
      <div
        ref={fgRef}
        className="swipe__fg"
        onPointerDown={(e) => {
          if (e.pointerType !== "touch" || (e.target as Element).closest("button, input, a, select, textarea")) return;
          drag.current = { x: e.clientX, y: e.clientY, dx: 0, on: false, past: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.on) {
            if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
              drag.current = null;
              return;
            }
            if (Math.abs(dx) < 10) return;
            d.on = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          d.dx = dx;
          setX(dx);
          const past = Math.abs(dx) > THRESHOLD;
          if (past !== d.past) {
            d.past = past;
            if (past) tapFeedback();
          }
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d?.on) return;
          if (Math.abs(d.dx) > THRESHOLD) {
            void remove(d.dx);
            return;
          }
          setX(0);
          if (motionOn()) fgRef.current?.animate([{ transform: `translateX(${d.dx}px)` }, { transform: "none" }], { duration: 260, easing: CALM.easing });
        }}
        onPointerCancel={() => {
          drag.current = null;
          setX(0);
        }}
      >
        {children}
      </div>
    </li>
  );
}
