import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { dropSheet } from "../lib/motion";
import { useSheetDrag } from "./ProductSheet";

/**
 * A bottom sheet for one staff task (add cups, take from the balance, ...).
 * It slides up over the page; a tap outside, Esc, a drag down or its close
 * button drops it away.
 */
export function StaffSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  useSheetDrag(sheetRef, null, onClose);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    void dropSheet(sheetRef.current).then(onClose);
  };

  useEffect(() => {
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("dialog[open]") && close();
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("sheet-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("sheet-open");
    };
    // close() only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="sheet-backdrop" onClick={close}>
      <div ref={sheetRef} className="staff-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <span className="staff-sheet__grabber" aria-hidden="true" />
        <h2 className="staff-sheet__title">{title}</h2>
        {children}
        <button type="button" className="staff-sheet__close" onClick={close}>
          إغلاق
        </button>
      </div>
    </div>,
    document.body,
  );
}
