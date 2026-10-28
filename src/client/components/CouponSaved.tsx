import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { tr } from "../lib/i18n";
import { riyals } from "../lib/menu";
import { motionOn, play } from "../lib/motion";

const BURST = 10;

/**
 * «وفّرت 12.40 مع الكوبون», under the total once a coupon takes money off. When
 * it appears it pops in, counts up from 0 and throws a few gold beans.
 */
export function CouponSaved({ halalas }: { halalas: number }) {
  const pill = useRef<HTMLParagraphElement>(null);
  const beans = useRef<HTMLSpanElement>(null);
  // While it counts up, the amount on the way; after that, the amount itself.
  const [counting, setCounting] = useState<number | null>(() => (motionOn() ? 0 : null));
  const shown = counting ?? halalas;
  const amount = useRef(halalas);
  amount.current = halalas;

  // Counts up once, when it first appears; later changes just show the new amount.
  useEffect(() => {
    if (!motionOn()) return;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const p = Math.min(1, (now - start) / 700);
      setCounting(p < 1 ? Math.round(amount.current * (1 - (1 - p) ** 3)) : null);
      if (p < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    void play(pill.current, [{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "scale(1.08)", offset: 0.6 }, { opacity: 1, transform: "none" }], {
      duration: 460,
      easing: "cubic-bezier(.3,.7,.1,1)",
    });
    beans.current?.querySelectorAll("i").forEach((bean, k) => {
      const angle = (k / BURST) * Math.PI * 2 + Math.random() * 0.4;
      const reach = 46 + Math.random() * 26;
      void play(
        bean,
        [
          { opacity: 1, transform: `translate(-50%, -50%) scale(${0.6 + Math.random() * 0.7})` },
          { opacity: 0, transform: `translate(calc(-50% + ${Math.cos(angle) * reach * 1.6}px), calc(-50% + ${Math.sin(angle) * reach * 0.7}px)) scale(.2)` },
        ],
        { duration: 700 + Math.random() * 250, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" },
      );
    });
  }, []);

  return (
    <div className="coupon-saved">
      <p ref={pill} className="coupon-saved__pill">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
        </svg>
        {tr(`وفّرت ${riyals(shown)} مع الكوبون`, `You saved ${riyals(shown)} with the coupon`)}
      </p>
      <span ref={beans} className="coupon-saved__beans" aria-hidden="true">
        {Array.from({ length: BURST }, (_, k) => (
          <i key={k} />
        ))}
      </span>
    </div>
  );
}
