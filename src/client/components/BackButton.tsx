import { useNavigate } from "react-router";
import { tr } from "../lib/i18n";

/** Back to wherever the page was opened from, or `fallback` when it was opened directly. */
export function BackButton({ fallback = "/account" }: { fallback?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="back-btn"
      onClick={() => {
        if (window.history.state && (window.history.state as { idx?: number }).idx) void navigate(-1);
        else void navigate(fallback);
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m9 6 6 6-6 6" />
      </svg>
      {tr("رجوع", "Back")}
    </button>
  );
}
