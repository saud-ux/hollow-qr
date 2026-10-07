import { useEffect, useState } from "react";
import { warnFeedback } from "../lib/native";

type Listener = (text: string) => void;
const listeners = new Set<Listener>();

/** A short message at the bottom of the screen, e.g. «باقي حبة وحدة بس». */
export function showToast(text: string) {
  warnFeedback();
  for (const l of listeners) l(text);
}

export function Toaster() {
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const listener: Listener = (text) => {
      setToast({ text, id: Date.now() });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), 2600);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      window.clearTimeout(timer);
    };
  }, []);
  if (!toast) return null;
  return (
    <div key={toast.id} className="toast" role="status" aria-live="polite">
      {toast.text}
    </div>
  );
}
