import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { ROLE_LABELS_AR } from "../../shared/messages";
import { useAuth } from "../lib/auth";
import { Wordmark } from "./Brand";

export function StaffLayout({ children }: { children: ReactNode }) {
  const { me, signOut } = useAuth();
  const isAdmin = me?.user.role === "admin";
  return (
    <div className="staff">
      <header className="staff__header">
        <Link to="/staff" className="staff__brand" aria-label="لوحة الموظفين">
          <Wordmark variant="cream" />
          <span className="staff__shop" dir="ltr">Rewards · Al Zulfi</span>
        </Link>
        <nav className="staff__nav" aria-label="التنقل">
          <NavLink to="/staff" end>
            الرئيسية
          </NavLink>
          <NavLink to="/staff/orders">الطلبات</NavLink>
          {isAdmin && <NavLink to="/staff/admin/menu">المنيو</NavLink>}
          {isAdmin && (
            <NavLink to="/staff/admin" end>
              الإدارة
            </NavLink>
          )}
        </nav>
        <div className="staff__user">
          {me && (
            <span className="staff__who">
              {me.user.displayName} · {ROLE_LABELS_AR[me.user.role]}
            </span>
          )}
          <button type="button" className="btn btn--small btn--light" onClick={() => void signOut()}>
            خروج
          </button>
        </div>
      </header>
      <main className="staff__main">{children}</main>
    </div>
  );
}
