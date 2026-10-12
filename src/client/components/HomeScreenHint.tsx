import { useEffect, useId, useRef } from "react";
import { tr } from "../lib/i18n";
import { markHomeScreenHintSeen } from "../lib/pwa";

/**
 * iPhone Safari: website notifications only work once the site is on the home
 * screen. This card shows how (Share, then Add to Home Screen).
 */
export function HomeScreenHint({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      markHomeScreenHintSeen();
    }
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="home-hint"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="home-hint__card">
        <img src="/brand/icon-192.png" alt="" className="home-hint__icon" width={52} height={52} />
        <div className="home-hint__text">
          <h2 id={titleId}>{tr("ثبّت HOLLOW على شاشتك", "Add HOLLOW to your Home Screen")}</h2>
          <p>{tr("عشان توصلك الإشعارات على الآيفون:", "To get notifications on iPhone:")}</p>
          <ol>
            <li>
              {tr("اضغط زر المشاركة", "Tap the Share button")} <ShareGlyph /> {tr("في سفاري (أو ⋯ ثم «مشاركة»).", "in Safari (or ⋯ then Share).")}
            </li>
            <li>{tr("اختر «إضافة إلى الشاشة الرئيسية».", "Choose “Add to Home Screen”.")}</li>
            <li>{tr("افتح HOLLOW من أيقونته، وفعّل الإشعارات.", "Open HOLLOW from its icon and turn on notifications.")}</li>
          </ol>
        </div>
        <button type="button" className="btn btn--primary btn--block" onClick={onClose} autoFocus>
          {tr("تمام", "Got it")}
        </button>
      </div>
    </dialog>
  );
}

function ShareGlyph() {
  return (
    <svg className="home-hint__share" width="15" height="17" viewBox="0 0 15 19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-label={tr("مشاركة", "Share")}>
      <path d="M7.5 12V1.5M3.8 5 7.5 1.3 11.2 5" />
      <path d="M5 8H2.5A1 1 0 0 0 1.5 9v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H10" />
    </svg>
  );
}
