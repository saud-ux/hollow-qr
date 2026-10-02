import type { ReactNode } from "react";
import { Link } from "react-router";
import { TentArt, Wordmark } from "./Brand";

export function CustomerLayout({ children, hero = false }: { children: ReactNode; hero?: boolean }) {
  return (
    <div className="customer">
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
    </div>
  );
}
