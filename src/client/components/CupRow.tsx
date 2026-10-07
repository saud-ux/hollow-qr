import { MAX_STAMPS } from "../../shared/constants";
import { tr } from "../lib/i18n";

/** Five HOLLOW cup indicators (same artwork as the Wallet strip). */
export function CupRow({ count, size = "md", muted = false }: { count: number; size?: "sm" | "md" | "lg"; muted?: boolean }) {
  return (
    <div className={`cup-row cup-row--${size} ${muted ? "cup-row--muted" : ""}`} role="img" aria-label={tr(`${count} من ${MAX_STAMPS} أكواب`, `${count} of ${MAX_STAMPS} cups`)}>
      {Array.from({ length: MAX_STAMPS }, (_, i) => (
        <img
          key={i}
          src={i < count ? "/wallet-preview/cup-filled.png" : "/wallet-preview/cup-empty.png"}
          alt=""
          className={i < count ? "cup cup--filled" : "cup cup--empty"}
        />
      ))}
    </div>
  );
}
