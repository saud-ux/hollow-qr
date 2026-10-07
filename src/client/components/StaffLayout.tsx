import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { ROLE_LABELS_AR } from "../../shared/messages";
import { useAuth } from "../lib/auth";
import { enterStaffTheme, staffTheme, toggleStaffTheme } from "../lib/staffTheme";
import { Wordmark } from "./Brand";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Line icons for the staff navigation. */
const ICONS = {
  orders: (
    <>
      <path d="M7 3h10v18l-2.5-2-2.5 2-2.5-2L7 21V3Z" />
      <path d="M10 8h4M10 12h4" />
    </>
  ),
  customers: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.5 3.5 5.2" />
    </>
  ),
  stock: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),
  overview: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  menu: (
    <>
      <path d="M5 9h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9Z" />
      <path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M9 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  offers: (
    <>
      <path d="M4 10v4h3l7 4V6L7 10H4Z" />
      <path d="M17.5 9a4 4 0 0 1 0 6M7 14l1.5 5h2.5l-1-4.5" />
    </>
  ),
  team: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <circle cx="12" cy="10" r="2.8" />
      <path d="M7.5 17.5c.7-2 2.4-3.2 4.5-3.2s3.8 1.2 4.5 3.2" />
    </>
  ),
  qr: (
    <>
      <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
      <path d="M8 12h8" />
    </>
  ),
  burger: <path d="M4 7h16M4 12h16M4 17h16" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  signOut: <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 8l-4 4 4 4M5 12h10" />,
} as const;

export type StaffIconName = keyof typeof ICONS;

export function StaffIcon({ name, size = 22 }: { name: StaffIconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...stroke}>
      {ICONS[name]}
    </svg>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: StaffIconName;
  end?: boolean;
}

const DAILY: NavItem[] = [
  { to: "/staff/orders", label: "الطلبات", icon: "orders" },
  { to: "/staff/customers", label: "العملاء", icon: "customers" },
  { to: "/staff/stock", label: "المخزون", icon: "stock" },
];

const ADMIN: NavItem[] = [
  { to: "/staff/admin", label: "المبيعات والإحصاءات", icon: "overview", end: true },
  { to: "/staff/admin/menu", label: "المنيو", icon: "menu" },
  { to: "/staff/admin/settings", label: "أوقات الطلبات والتوصيل", icon: "settings" },
  { to: "/staff/admin/engage", label: "العروض والتقييمات", icon: "offers" },
  { to: "/staff/admin/team", label: "الموظفين", icon: "team" },
];

/**
 * The staff and admin shell: a side menu on the iPad (a drawer on the
 * phone), the page title with a QR button that is always one tap away, and a
 * light / dark switch.
 */
export function StaffLayout({ title, actions, wide, children }: { title?: string; actions?: ReactNode; wide?: boolean; children: ReactNode }) {
  const { me, signOut } = useAuth();
  const isAdmin = me?.user.role === "admin";
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(staffTheme);

  useEffect(() => enterStaffTheme(setTheme), []);

  const link = (item: NavItem) => (
    <NavLink key={item.to} to={item.to} end={item.end} className="staff-side__link" onClick={() => setOpen(false)}>
      <StaffIcon name={item.icon} />
      <span>{item.label}</span>
    </NavLink>
  );

  return (
    <div className={`staff-shell ${open ? "is-open" : ""}`}>
      <aside className="staff-side" aria-label="القائمة">
        <Link to="/staff/orders" className="staff-side__brand" aria-label="لوحة الموظفين">
          <Wordmark variant="cream" />
          <span dir="ltr">Al Zulfi</span>
        </Link>
        <nav className="staff-side__nav">
          {DAILY.map(link)}
          {isAdmin && (
            <>
              <p className="staff-side__group">الإدارة</p>
              {ADMIN.map(link)}
            </>
          )}
        </nav>
        <div className="staff-side__foot">
          {me && (
            <div className="staff-side__who">
              <span className="staff-side__avatar" aria-hidden="true">
                {Array.from(me.user.displayName.trim())[0] ?? "?"}
              </span>
              <span>
                <strong>{me.user.displayName}</strong>
                <small>{ROLE_LABELS_AR[me.user.role]}</small>
              </span>
            </div>
          )}
          <div className="staff-side__tools">
            <button type="button" className="staff-side__tool" onClick={() => setTheme(toggleStaffTheme())}>
              <StaffIcon name={theme === "dark" ? "sun" : "moon"} size={20} />
              {theme === "dark" ? "فاتح" : "داكن"}
            </button>
            <button type="button" className="staff-side__tool" onClick={() => void signOut()}>
              <StaffIcon name="signOut" size={20} />
              خروج
            </button>
          </div>
        </div>
      </aside>
      <button type="button" className="staff-scrim" aria-label="إغلاق القائمة" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} />

      <div className="staff-body">
        <header className="staff-top">
          <button type="button" className="staff-top__icon staff-top__burger" onClick={() => setOpen(true)} aria-label="القائمة" aria-expanded={open}>
            <StaffIcon name="burger" />
          </button>
          <h1 className="staff-top__title">{title}</h1>
          <div className="staff-top__actions">
            {actions}
            <Link to="/staff/customers?scan=1" className="btn btn--small btn--primary staff-top__qr">
              <StaffIcon name="qr" size={18} />
              مسح QR
            </Link>
          </div>
        </header>
        <main className={`staff__main ${wide ? "staff__main--wide" : ""}`}>{children}</main>
      </div>
    </div>
  );
}
