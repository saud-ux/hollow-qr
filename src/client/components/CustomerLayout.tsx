import type { ReactNode } from "react";
import { Link } from "react-router";
import { isNative } from "../lib/native";
import { TentArt, Wordmark } from "./Brand";

export function CustomerLayout({ children, hero = false, dock }: { children: ReactNode; hero?: boolean; dock?: ReactNode }) {
  return (
    <div className={`customer ${dock ? "customer--docked" : ""}`}>
      <header className="customer__header">
        <Link to={isNative ? "/menu" : "/"} className="customer__brand" aria-label="HOLLOW Rewards، الصفحة الرئيسية">
          <Wordmark />
        </Link>
        {hero && <TentArt className="customer__tent" />}
      </header>
      <main className="customer__main">{children}</main>
      <footer className="customer__footer">
        <span dir="ltr">HOLLOW · Al Zulfi</span>
        <nav className="customer__links">
          <Link to="/privacy">الخصوصية</Link>
          <Link to="/support">الدعم</Link>
        </nav>
      </footer>
      {dock && <div className="shop__dock">{dock}</div>}
    </div>
  );
}
