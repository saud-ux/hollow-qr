import { useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { isNative } from "../lib/native";
import { TentArt, Wordmark } from "./Brand";
import { PullToRefresh } from "./PullToRefresh";
import { LangToggle } from "./LangToggle";
import { ThemeToggle } from "./ThemeToggle";
import { tr } from "../lib/i18n";

export function CustomerLayout({
  children,
  hero = false,
  dock,
  onRefresh,
}: {
  children: ReactNode;
  hero?: boolean;
  dock?: ReactNode;
  onRefresh?: () => Promise<unknown>;
}) {
  const mainRef = useRef<HTMLElement>(null);
  return (
    <div className={`customer ${dock ? "customer--docked" : ""}`}>
      <header className="customer__header">
        <Link to="/menu" className="customer__brand" aria-label={tr("HOLLOW Rewards، الصفحة الرئيسية", "HOLLOW Rewards, home")}>
          <Wordmark />
        </Link>
        <ThemeToggle className="customer__theme" />
        {/* No tab bar here (sign in, sign up…), so no way to Settings yet: the language sits in the header. */}
        {!dock && <LangToggle className="customer__lang" />}
        {hero && <TentArt className="customer__tent" />}
      </header>
      {onRefresh && <PullToRefresh onRefresh={onRefresh} target={mainRef} />}
      <main ref={mainRef} className="customer__main">
        {children}
      </main>
      <footer className="customer__footer">
        <span dir="ltr">HOLLOW · Al Zulfi</span>
        {/* The app has these in the card page's settings. */}
        {!isNative && (
          <nav className="customer__links">
            <Link to="/privacy">{tr("الخصوصية", "Privacy")}</Link>
            <Link to="/support">{tr("الدعم", "Support")}</Link>
          </nav>
        )}
      </footer>
      {dock && <div className="shop__dock">{dock}</div>}
    </div>
  );
}
