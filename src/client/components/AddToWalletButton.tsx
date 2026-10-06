import { useState } from "react";

/**
 * "Add to Apple Wallet" button.
 *
 * Apple requires the official badge artwork instead of a recreation:
 * public/apple-wallet/add-to-apple-wallet-ar.svg is Apple's Arabic RGB badge
 * (from the "Add to Apple Wallet" guidelines download). If it fails to load,
 * a neutral black button with the required wording is shown (no imitation of
 * Apple's Wallet glyph).
 */
export function AddToWalletButton({ onClick, disabled, busy }: { onClick: () => void; disabled?: boolean; busy?: boolean }) {
  const [badgeFailed, setBadgeFailed] = useState(false);
  return (
    <button
      type="button"
      className={`wallet-btn ${badgeFailed ? "wallet-btn--text" : ""}`}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      aria-label="Add to Apple Wallet، أضف إلى Apple Wallet"
    >
      {!badgeFailed ? (
        <img
          src="/apple-wallet/add-to-apple-wallet-ar.svg"
          alt=""
          className="wallet-btn__badge"
          onError={() => setBadgeFailed(true)}
        />
      ) : (
        <span className="wallet-btn__fallback" dir="ltr">
          {busy ? "…" : "Add to Apple Wallet"}
        </span>
      )}
    </button>
  );
}
