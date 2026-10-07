import { useLayoutEffect, useRef } from "react";
import { MAX_STAMPS } from "../../shared/constants";
import { stampCups } from "../lib/motion";
import { isNative } from "../lib/native";

/** Horizontal centre of each cup in the strip artwork (fraction of the width). */
const CUP_CENTERS = [0.143, 0.321, 0.5, 0.679, 0.857];
const HALF_WIDTH = 0.08;

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
    // storage blocked: cups simply don't replay
  }
}

/**
 * The Wallet strip with the customer's cups. In the iOS app each filled cup
 * is its own layer (cut from a plain five-cup strip) so it can stamp onto the
 * card; a full card then glows gold as the reward strip fades in:
 *   - "all": every cup stamps in when the card opens (My card).
 *   - "new": only cups earned since this phone last showed the card (menu band).
 */
export function CupStrip({
  count,
  memberId,
  stamp,
  className,
}: {
  count: number;
  memberId: string;
  stamp: "all" | "new";
  className: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<number | null>(null);
  const cups = Math.min(Math.max(count, 0), MAX_STAMPS);

  useLayoutEffect(() => {
    if (!isNative) return;
    const prev = shown.current;
    shown.current = cups;
    let from: number;
    if (prev !== null) from = prev;
    else if (stamp === "all") from = 0;
    else from = Math.min(readSeen(memberId) ?? cups, cups);
    writeSeen(memberId, cups);
    // Opening My card replays the cups quietly; only newly earned ones tap the phone.
    stampCups(ref.current, from, cups, prev !== null || stamp === "new");
  }, [cups, memberId, stamp]);

  if (!isNative) return <img src={`/wallet-preview/strip-${cups}.png`} alt="" className={className} />;
  return (
    <div ref={ref} className={`cup-strip ${className}`}>
      <img src="/wallet-preview/strip-0.png" alt="" className="cup-strip__base" />
      {CUP_CENTERS.slice(0, cups).map((center, i) => (
        <img
          key={i}
          src="/wallet-preview/strip-5-plain.png"
          alt=""
          className="cup-strip__cup"
          style={{
            clipPath: `inset(22% ${((1 - center - HALF_WIDTH) * 100).toFixed(2)}% 16% ${((center - HALF_WIDTH) * 100).toFixed(2)}%)`,
            transformOrigin: `${(center * 100).toFixed(1)}% 52%`,
          }}
        />
      ))}
      {/* Free drink: the full reward strip (gold glow, sparkles) over the stamped cups. */}
      {cups === MAX_STAMPS && <img src={`/wallet-preview/strip-${MAX_STAMPS}.png`} alt="" className="cup-strip__reward" />}
      {cups === MAX_STAMPS && <span className="cup-strip__sheen" aria-hidden="true" />}
    </div>
  );
}
