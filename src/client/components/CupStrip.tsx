import { Fragment, useLayoutEffect, useRef } from "react";
import { MAX_STAMPS } from "../../shared/constants";
import { pourCups } from "../lib/motion";

/** Horizontal centre of each cup in the strip artwork (fraction of the width). */
const CUP_CENTERS = [0.1053, 0.3027, 0.5, 0.6973, 0.8947];
const HALF_WIDTH = 0.09;

/** The inside of a cup, in pixels of the 750 x 288 strip artwork: where the coffee rises. */
const ART = { width: 750, height: 288 };
const INSIDE = { top: 96, bottom: 215, topHalf: 47, bottomHalf: 33 };
const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;
/** The coffee's top edge when the cup is empty (low enough to hide its ripple too), and when it is full (% of the strip's height). */
const EMPTY = pct(INSIDE.bottom + 10, ART.height);
const FULL = pct(INSIDE.top, ART.height);

/** One cup's part of the plain five-cup strip, between `top` and `bottom` (% of its height, from each edge). */
const cut = (center: number, top: number, bottom: number) =>
  `inset(${top}% ${((1 - center - HALF_WIDTH) * 100).toFixed(2)}% ${bottom}% ${((center - HALF_WIDTH) * 100).toFixed(2)}%)`;

/** The cup's inside, a little higher than the coffee's full line so its surface can ripple. */
function insideShape(center: number): string {
  const x = center * ART.width;
  const { top, bottom, topHalf, bottomHalf } = INSIDE;
  const points: [number, number][] = [
    [x - topHalf, top - 6],
    [x + topHalf, top - 6],
    [x + bottomHalf, bottom],
    [x - bottomHalf, bottom],
  ];
  return `polygon(${points.map(([px, py]) => `${pct(px, ART.width)} ${pct(py, ART.height)}`).join(", ")})`;
}

const SEEN_KEY = "hollow.cups.seen";

function readSeen(memberId: string): number | null {
  try {
    const raw = localStorage.getItem(`${SEEN_KEY}.${memberId}`);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

function writeSeen(memberId: string, count: number) {
  try {
    localStorage.setItem(`${SEEN_KEY}.${memberId}`, String(count));
  } catch {
    // storage blocked: a card that becomes full just doesn't buzz
  }
}

/**
 * The Wallet strip with the customer's cups. Each filled cup is drawn as its
 * rim and its body (cut from a plain five-cup strip), over a stream and a
 * coffee level, so coffee can pour into it before the cup shows; a full
 * card then lights its tent gold as the reward strip fades in. Every time the strip
 * shows (My card, the menu band), its cups fill.
 */
export function CupStrip({ count, memberId, className }: { count: number; memberId: string; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<number | null>(null);
  const cups = Math.min(Math.max(count, 0), MAX_STAMPS);

  useLayoutEffect(() => {
    const prev = shown.current;
    shown.current = cups;
    const seen = readSeen(memberId);
    writeSeen(memberId, cups);
    // Only a card that has just become full buzzes: once, on whichever page shows it first.
    pourCups(ref.current, prev ?? 0, cups, prev !== null || (seen !== null && seen < cups));
  }, [cups, memberId]);

  return (
    <div ref={ref} className={`cup-strip ${className}`}>
      <img src="/wallet-preview/strip-0.png" alt="" className="cup-strip__base" />
      {CUP_CENTERS.slice(0, cups).map((center, i) => (
        <Fragment key={i}>
          <span className="cup-strip__pour" aria-hidden="true">
            <span className="cup-strip__stream" style={{ left: `${(center * 100 - 0.55).toFixed(2)}%` }} />
            <span className="cup-strip__coffee" style={{ clipPath: insideShape(center) }}>
              <span className="cup-strip__level" style={{ transform: `translateY(${EMPTY})` }} data-full={FULL} />
            </span>
          </span>
          <img src="/wallet-preview/strip-5-plain.png" alt="" className="cup-strip__body" style={{ clipPath: cut(center, 32.5, 20) }} />
          <img src="/wallet-preview/strip-5-plain.png" alt="" className="cup-strip__rim" style={{ clipPath: cut(center, 29, 66.5) }} />
        </Fragment>
      ))}
      {/* Free drink: the full reward strip (its tent gold) over the filled cups. */}
      {cups === MAX_STAMPS && <img src={`/wallet-preview/strip-${MAX_STAMPS}.png`} alt="" className="cup-strip__reward" />}
    </div>
  );
}
