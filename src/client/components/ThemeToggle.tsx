import { useEffect, useState } from "react";
import { isNative } from "../lib/native";
import { currentTheme, onThemeChange, toggleTheme } from "../lib/theme";
import { tr } from "../lib/i18n";

/** Sun / moon button in the page header (iOS app only). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => onThemeChange(setTheme), []);
  if (!isNative) return null;
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      onClick={toggleTheme}
      aria-label={dark ? tr("الوضع الفاتح", "Light mode") : tr("الوضع الداكن", "Dark mode")}
      title={dark ? tr("الوضع الفاتح", "Light mode") : tr("الوضع الداكن", "Dark mode")}
    >
      {dark ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        </svg>
      )}
    </button>
  );
}
