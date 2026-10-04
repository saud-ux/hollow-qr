import { MAX_STAMPS } from "../../shared/constants";

/** Five HOLLOW cup indicators (same artwork as the Wallet strip). */
export function CupRow({ count, size = "md", muted = false }: { count: number; size?: "sm" | "md" | "lg"; muted?: boolean }) {
  return (
    <div className={`cup-row cup-row--${size} ${muted ? "cup-row--muted" : ""}`} role="img" aria-label={`${count} من ${MAX_STAMPS} أكواب`}>
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
