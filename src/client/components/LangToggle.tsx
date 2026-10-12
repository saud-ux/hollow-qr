import { useLang } from "../lib/i18n";

/**
 * عربي / English in the header of the pages without the tab bar (sign in,
 * sign up…), where Account → Settings can't be reached yet.
 */
export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setChoice } = useLang();
  const other = lang === "ar" ? "en" : "ar";
  return (
    <button type="button" className={`lang-toggle ${className}`} onClick={() => setChoice(other)} lang={other} aria-label={other === "en" ? "English" : "العربية"}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
      </svg>
      {other === "en" ? "EN" : "عربي"}
    </button>
  );
}
