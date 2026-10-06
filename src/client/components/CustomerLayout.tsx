import type { ReactNode } from "react";
import { Link } from "react-router";
import { TentArt, Wordmark } from "./Brand";

export function CustomerLayout({ children, hero = false, dock }: { children: ReactNode; hero?: boolean; dock?: ReactNode }) {
  return (
    <div className={`customer ${dock ? "customer--docked" : ""}`}>
      <header className="customer__header">
        <Link to="/" className="customer__brand" aria-label="HOLLOW Rewards، الصفحة الرئيسية">
          <Wordmark />
        </Link>
        {hero && <TentArt className="customer__tent" />}
      </header>
      <main className="customer__main">{children}</main>
      <footer className="customer__footer">
        <span dir="ltr">HOLLOW · Al Zulfi</span>
      </footer>
      {dock && <div className="shop__dock">{dock}</div>}
    </div>
  );
}
