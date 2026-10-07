import { useLayoutEffect, useRef, useState } from "react";
import { CALM, motionOn, play } from "../lib/motion";

const amount = (text: string) => Number(text.replace(/[^\d.]/g, "")) || 0;

/**
 * Text (usually a price) that rolls to its new value: the old one slides out
 * and the new one slides in, up when it grows and down when it shrinks.
 */
export function Rolling({ text, className = "" }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text);
  const [old, setOld] = useState<string | null>(null);
  const oldRef = useRef<HTMLSpanElement>(null);
  const newRef = useRef<HTMLSpanElement>(null);

  // Adjust while rendering, so the new value never shows without its motion.
  if (shown !== text) {
    setOld(motionOn() ? shown : null);
    setShown(text);
  }

  useLayoutEffect(() => {
    if (old === null) return;
    const up = amount(shown) >= amount(old) ? 1 : -1;
    void play(oldRef.current, [{ transform: "none", opacity: 1 }, { transform: `translateY(${-60 * up}%)`, opacity: 0 }], { duration: 280, easing: CALM.easing, fill: "forwards" });
    void play(newRef.current, [{ transform: `translateY(${60 * up}%)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 320, easing: CALM.easing }).then(() => setOld(null));
  }, [old, shown]);

  return (
    <span className={`rolling ${className}`}>
      {old !== null && (
        <span ref={oldRef} className="rolling__old" aria-hidden="true">
          {old}
        </span>
      )}
      <span ref={newRef}>{shown}</span>
    </span>
  );
}
