import { useLayoutEffect, useRef } from "react";
import { motionOn } from "../lib/motion";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * A price that rolls like a counter: each digit spins to its new value on its
 * own, the ones nearest the decimal point first. Digits keep their place by
 * their distance from the decimal point, so «62» becomes «49.60» digit by
 * digit; a digit that wasn't there before spins up from 0. Text around the
 * number (the riyal sign) stays put, in the same reading order as plain text.
 */
export function Odometer({ text, className = "" }: { text: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const seen = useRef(new WeakSet<Element>());
  const first = useRef(true);

  // A digit column that just appeared starts at 0, then spins to its value.
  useLayoutEffect(() => {
    const strips = box.current?.querySelectorAll<HTMLElement>(".odometer__strip") ?? [];
    const fresh = [...strips].filter((s) => !seen.current.has(s));
    fresh.forEach((s) => seen.current.add(s));
    if (first.current || !motionOn()) {
      first.current = false;
      return;
    }
    for (const s of fresh) {
      const target = s.style.transform;
      s.style.transition = "none";
      s.style.transform = "translateY(0)";
      void s.offsetHeight;
      s.style.transition = "";
      s.style.transform = target;
    }
  });

  const match = /\d+(?:\.\d+)?/.exec(text);
  if (!match) return <span className={className}>{text}</span>;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const [whole, fraction = ""] = match[0].split(".");
  const column = (d: string, key: string, order: number) => (
    <span key={key} className="odometer__digit">
      <span className="odometer__strip" style={{ transform: `translateY(${-Number(d) * 10}%)`, transitionDelay: `${order * 70}ms` }}>
        {DIGITS.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
    </span>
  );

  return (
    <span className={`odometer ${className}`}>
      <span className="visually-hidden">{text}</span>
      <span aria-hidden="true">
        {before}
        <span ref={box} className="odometer__num" dir="ltr">
          {Array.from(whole!).map((d, i, all) => column(d, `w${all.length - 1 - i}`, all.length - 1 - i))}
          {fraction && <span key="dot">.</span>}
          {Array.from(fraction).map((d, i) => column(d, `f${i}`, i))}
        </span>
        {after}
      </span>
    </span>
  );
}
