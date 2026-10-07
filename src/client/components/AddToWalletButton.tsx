import { useState } from "react";
import { currentLang, tr } from "../lib/i18n";

const BADGE_AR = "/apple-wallet/add-to-apple-wallet-ar.svg";
const BADGE_EN = "/apple-wallet/add-to-apple-wallet-en.svg";

/**
 * "Add to Apple Wallet" button.
 *
 * Apple requires the official badge artwork instead of a recreation:
 * public/apple-wallet/add-to-apple-wallet-ar.svg is Apple's Arabic RGB badge
 * and add-to-apple-wallet-en.svg the US-UK English one (from the "Add to
 * Apple Wallet" guidelines download). If it fails to load,
 * a neutral black button with the required wording is shown (no imitation of
 * Apple's Wallet glyph).
 */
export function AddToWalletButton({ onClick, disabled, busy }: { onClick: () => void; disabled?: boolean; busy?: boolean }) {
  // English screens use the English badge when it's there, else the Arabic one.
  const badges = currentLang() === "en" ? [BADGE_EN, BADGE_AR] : [BADGE_AR];
  const [failed, setFailed] = useState(0);
  const badge = badges[failed];
  return (
    <button
      type="button"
      className={`wallet-btn ${badge ? "" : "wallet-btn--text"}`}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      aria-label={tr("Add to Apple Wallet، أضف إلى Apple Wallet", "Add to Apple Wallet")}
    >
      {badge ? (
        <img key={badge} src={badge} alt="" className="wallet-btn__badge" onError={() => setFailed((n) => n + 1)} />
      ) : (
        <span className="wallet-btn__fallback" dir="ltr">
          {busy ? "…" : "Add to Apple Wallet"}
        </span>
      )}
    </button>
  );
}
