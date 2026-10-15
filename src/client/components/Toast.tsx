import { useEffect, useRef, useState } from "react";
import { motionOn } from "../lib/motion";
import { warnFeedback } from "../lib/native";

export interface ToastOptions {
  /** A button in the toast, e.g. «تراجع» after deleting something. */
  action?: { label: string; onClick: () => void };
  /** Shows the toast just above this element (e.g. the order button) while it is on screen. */
  above?: Element | null;
}

interface Shown {
  text: string;
  id: number;
  action?: ToastOptions["action"];
  /** Distance from the bottom of the screen, when placed above an element. */
  bottom?: number;
  leaving: boolean;
}

type Listener = (text: string, options: ToastOptions) => void;
const listeners = new Set<Listener>();

const SHOW_MS = 2600;
/** Long enough to reach the button. */
const ACTION_MS = 4500;
const LEAVE_MS = 220;

/**
 * A short message at the bottom of the screen, e.g. «باقي حبة وحدة بس».
 * Warnings like that buzz; a toast with a button confirms something the
 * customer just did, so it doesn't.
 */
export function showToast(text: string, options: ToastOptions = {}) {
  if (!options.action) warnFeedback();
  for (const l of listeners) l(text, options);
}

function bottomAbove(el: Element | null | undefined): number | undefined {
  const r = el?.getBoundingClientRect();
  if (!r?.height || r.top < 80 || r.top > window.innerHeight) return undefined;
  return Math.round(window.innerHeight - r.top + 12);
}

export function Toaster() {
  const [toast, setToast] = useState<Shown | null>(null);
  const hideRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    let timer: number | undefined;
    // It leaves the way it came in: fading and dropping a little.
    const hide = () => {
      window.clearTimeout(timer);
      if (!motionOn()) {
        setToast(null);
        return;
      }
      setToast((t) => (t ? { ...t, leaving: true } : t));
      timer = window.setTimeout(() => setToast(null), LEAVE_MS);
    };
    hideRef.current = hide;
    const listener: Listener = (text, { action, above }) => {
      setToast({ text, id: Date.now(), action, bottom: bottomAbove(above), leaving: false });
      window.clearTimeout(timer);
      timer = window.setTimeout(hide, action ? ACTION_MS : SHOW_MS);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      window.clearTimeout(timer);
    };
  }, []);
  if (!toast) return null;
  const { action } = toast;
  return (
    <div
      key={toast.id}
      className={`toast ${action ? "toast--action" : ""} ${toast.leaving ? "is-leaving" : ""}`}
      style={toast.bottom === undefined ? undefined : { bottom: toast.bottom }}
      role="status"
      aria-live="polite"
    >
      <span>{toast.text}</span>
      {action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            action.onClick();
            hideRef.current();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
