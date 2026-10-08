import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { MAX_STAMPS } from "../../shared/constants";
import type { MenuItem } from "../../shared/ordering";
import type { CustomerCard } from "../../shared/types";
import { useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import { CALM, play } from "../lib/motion";
import { Wordmark } from "./Brand";
import { CupStrip } from "./CupStrip";
import { PullToRefresh } from "./PullToRefresh";
import { Rolling } from "./Rolling";
import { ThemeToggle } from "./ThemeToggle";
import { tr } from "../lib/i18n";

/**
 * Ordering screens share the look of the Wallet card: a cream header with the
 * wordmark and the cups count, the espresso strip, and pass-style labels.
 */
export function ShopLayout({ children, bottom, onRefresh }: { children: ReactNode; bottom?: ReactNode; onRefresh?: () => Promise<unknown> }) {
  const { me } = useAuth();
  const mainRef = useRef<HTMLElement>(null);
  const card = me?.card ?? null;
  return (
    <div className="shop">
      <header className="shop__header">
        <Link to="/menu" className="shop__brand" aria-label={tr("HOLLOW، المنيو", "HOLLOW, menu")}>
          <Wordmark />
        </Link>
        <div className="shop__header-end">
          {card && card.membershipStatus === "active" && (
            <Link to="/wallet" className="shop__cups" dir="ltr" aria-label={tr(`${card.stampCount} من ${MAX_STAMPS} أكواب`, `${card.stampCount} of ${MAX_STAMPS} cups`)}>
              <span className="pass-label shop__cups-label">{tr("أكوابك", "CUPS")}</span>
              <span className="shop__cups-value">
                {/* The count rolls to its new number when a cup is added. */}
                <Rolling text={String(card.stampCount)} /> / {MAX_STAMPS}
              </span>
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>
      {onRefresh && <PullToRefresh onRefresh={onRefresh} target={mainRef} />}
      <main ref={mainRef} className="shop__main">
        {children}
      </main>
      <div className="shop__dock">
        {bottom}
        <TabBar />
      </div>
    </div>
  );
}

/** Which tab a page belongs to (-1: none), for the sliding highlight. */
function tabIndex(pathname: string): number {
  if (/^\/menu(\/|$)/.test(pathname)) return 0;
  if (/^\/cart(\/|$)/.test(pathname)) return 1;
  if (/^\/orders(\/|$)/.test(pathname)) return 2;
  if (/^\/(account|wallet)(\/|$)/.test(pathname)) return 3;
  return -1;
}

export function TabBar() {
  const { count } = useCart();
  const { pathname } = useLocation();
  const index = tabIndex(pathname);
  const navRef = useRef<HTMLElement>(null);
  const lastIndex = useRef(index);
  // The highlight slides to the new tab (CSS) and its icon gives a small nod.
  useEffect(() => {
    if (lastIndex.current === index) return;
    lastIndex.current = index;
    void play(navRef.current?.querySelector(".tabbar__item.active svg"), [{ transform: "scale(1)" }, { transform: "scale(1.12) translateY(-1px)", offset: 0.45 }, { transform: "scale(1)" }], {
      duration: 340,
      easing: CALM.easing,
    });
  }, [index]);
  return (
    <nav ref={navRef} className="tabbar" aria-label={tr("التنقل", "Navigation")}>
      {index >= 0 && <span className="tabbar__pill" aria-hidden="true" style={{ "--tab": index } as CSSProperties} />}
      <NavLink to="/menu" className="tabbar__item">
        <MenuIcon />
        <span>{tr("المنيو", "Menu")}</span>
      </NavLink>
      <NavLink to="/cart" className="tabbar__item">
        <BagIcon />
        <span>{tr("السلة", "Cart")}</span>
        {count > 0 && <span className="tabbar__badge">{count}</span>}
      </NavLink>
      <NavLink to="/orders" className="tabbar__item">
        <ReceiptIcon />
        <span>{tr("طلباتي", "Orders")}</span>
      </NavLink>
      {/* The card and the places live inside Account, so the tab stays lit there. */}
      <NavLink to="/account" className={() => `tabbar__item ${/^\/(account|wallet)(\/|$)/.test(pathname) ? "active" : ""}`}>
        <UserIcon />
        <span>{tr("حسابي", "Account")}</span>
      </NavLink>
    </nav>
  );
}

/** The espresso Wallet strip with the customer's own cups. */
export function LoyaltyBand({ card }: { card: CustomerCard | null }) {
  if (!card || card.membershipStatus !== "active") {
    return (
      <Link to="/register" className="band band--link">
        <img src="/wallet-preview/strip-0.png" alt="" className="band__strip" />
        <span className="band__caption">
          <span className="pass-label pass-label--light">HOLLOW REWARDS</span>
          <span>{tr("سجّل واجمع 5 أكواب، والسادس مجاني", "Sign up, collect 5 cups, the 6th is free")}</span>
        </span>
      </Link>
    );
  }
  const remaining = MAX_STAMPS - card.stampCount;
  return (
    <Link to="/wallet" className="band band--link">
      <CupStrip count={card.stampCount} memberId={card.memberId} stamp="new" className="band__strip" />
      <span className="band__caption">
        <span className="pass-label pass-label--light">{tr("المكافأة", "Reward")}</span>
        <span className={card.rewardAvailable ? "band__reward" : undefined}>
          {card.rewardAvailable
            ? tr("لك مشروب مجاني، استخدمه في طلبك", "You have a free drink, use it in your order")
            : remaining === 1
              ? tr("باقي كوب واحد للمشروب المجاني", "1 more cup to your free drink")
              : tr(`باقي ${remaining} أكواب للمشروب المجاني`, `${remaining} more cups to your free drink`)}
        </span>
      </span>
    </Link>
  );
}

export function ItemImage({ item, className = "" }: { item: Pick<MenuItem, "imageUrl" | "nameAr" | "category">; className?: string }) {
  if (item.imageUrl) {
    return <img src={item.imageUrl} alt="" className={`item-img ${className}`} loading="lazy" decoding="async" />;
  }
  return (
    <span className={`item-img item-img--placeholder ${className}`} aria-hidden="true">
      {item.category === "drink" ? (
        <img src="/wallet-preview/cup-filled.png" alt="" className="item-img__cup" />
      ) : (
        <img src="/brand/wordmark-espresso.png" alt="" className="item-img__mark" />
      )}
    </span>
  );
}

export function QtyStepper({
  quantity,
  onChange,
  max = 20,
  label,
  onLimit,
}: {
  quantity: number;
  onChange: (q: number) => void;
  max?: number;
  label: string;
  /** Called instead of going past `max` (e.g. to say how many are left); without it, + is disabled at max. */
  onLimit?: () => void;
}) {
  return (
    <div className="stepper" role="group" aria-label={tr(`الكمية: ${label}`, `Quantity: ${label}`)}>
      <button
        type="button"
        className={`stepper__btn ${onLimit && quantity >= max ? "is-limit" : ""}`}
        onClick={() => (quantity >= max ? onLimit?.() : onChange(quantity + 1))}
        disabled={quantity >= max && !onLimit}
        aria-label={tr("زيادة", "Increase")}
      >
        +
      </button>
      <span className="stepper__value" aria-live="polite">
        {quantity}
      </span>
      <button type="button" className="stepper__btn" onClick={() => onChange(quantity - 1)} aria-label={quantity === 1 ? tr("حذف", "Remove") : tr("إنقاص", "Decrease")}>
        {quantity === 1 ? <TrashIcon /> : "−"}
      </button>
    </div>
  );
}

const icon = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function MenuIcon() {
  return (
    <svg {...icon} aria-hidden="true">
      <path d="M6 8h10l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8Z" />
      <path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H15.6" />
      <path d="M9 3c0 1.5 1 1.5 1 3M12.5 3c0 1.5 1 1.5 1 3" />
    </svg>
  );
}
export function BagIcon() {
  return (
    <svg {...icon} aria-hidden="true">
      <path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8Z" />
      <path d="M9 10V7a3 3 0 0 1 6 0v3" />
    </svg>
  );
}
export function ReceiptIcon() {
  return (
    <svg {...icon} aria-hidden="true">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}
export function UserIcon() {
  return (
    <svg {...icon} aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5" />
    </svg>
  );
}
export function CardIcon() {
  return (
    <svg {...icon} aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 10h18M7 15h3" />
    </svg>
  );
}
export function StoreIcon() {
  return (
    <svg {...icon} aria-hidden="true">
      <path d="M4 10v10h16V10" />
      <path d="M3 10 5 4h14l2 6a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Z" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}
export function CarIcon() {
  return (
    <svg {...icon} aria-hidden="true">
      <path d="M5 16V12l2-5h10l2 5v4" />
      <path d="M3 16h18v2H3z" />
      <circle cx="7.5" cy="18.5" r="1.5" />
      <circle cx="16.5" cy="18.5" r="1.5" />
      <path d="M5 12h14" />
    </svg>
  );
}
export function ScooterIcon() {
  return (
    <svg {...icon} aria-hidden="true">
      <circle cx="6" cy="17" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
      <path d="M8.5 17h6l2-7h-3M14 6h3l1.5 4" />
      <path d="M4 11h6v3" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg {...icon} width={18} height={18} aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </svg>
  );
}
