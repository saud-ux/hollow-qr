import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { MAX_STAMPS } from "../../shared/constants";
import type { MenuItem } from "../../shared/ordering";
import type { CustomerCard } from "../../shared/types";
import { useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import { Wordmark } from "./Brand";

/**
 * Ordering screens share the look of the Wallet card: a cream header with the
 * wordmark and the CUPS field, the espresso strip, and pass-style labels.
 */
export function ShopLayout({ children, bottom }: { children: ReactNode; bottom?: ReactNode }) {
  const { me } = useAuth();
  const card = me?.card ?? null;
  return (
    <div className="shop">
      <header className="shop__header">
        <Link to="/menu" className="shop__brand" aria-label="HOLLOW، المنيو">
          <Wordmark />
        </Link>
        {card && card.membershipStatus === "active" && (
          <Link to="/wallet" className="shop__cups" dir="ltr" aria-label={`${card.stampCount} من ${MAX_STAMPS} أكواب`}>
            <span className="pass-label">CUPS</span>
            <span className="shop__cups-value">
              {card.stampCount} / {MAX_STAMPS}
            </span>
          </Link>
        )}
      </header>
      <main className="shop__main">{children}</main>
      <div className="shop__dock">
        {bottom}
        <TabBar />
      </div>
    </div>
  );
}

export function TabBar() {
  const { count } = useCart();
  return (
    <nav className="tabbar" aria-label="التنقل">
      <NavLink to="/menu" className="tabbar__item">
        <MenuIcon />
        <span>المنيو</span>
      </NavLink>
      <NavLink to="/cart" className="tabbar__item">
        <BagIcon />
        <span>السلة</span>
        {count > 0 && <span className="tabbar__badge">{count}</span>}
      </NavLink>
      <NavLink to="/orders" className="tabbar__item">
        <ReceiptIcon />
        <span>طلباتي</span>
      </NavLink>
      <NavLink to="/wallet" className="tabbar__item">
        <CardIcon />
        <span>بطاقتي</span>
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
          <span>سجّل واجمع 5 أكواب، والسادس مجاني</span>
        </span>
      </Link>
    );
  }
  const remaining = MAX_STAMPS - card.stampCount;
  return (
    <Link to="/wallet" className="band band--link">
      <img src={`/wallet-preview/strip-${Math.min(card.stampCount, MAX_STAMPS)}.png`} alt="" className="band__strip" />
      <span className="band__caption">
        <span className="pass-label pass-label--light">المكافأة</span>
        <span className={card.rewardAvailable ? "band__reward" : undefined}>
          {card.rewardAvailable
            ? "لك مشروب مجاني، استخدمه في طلبك"
            : remaining === 1
              ? "باقي كوب واحد للمشروب المجاني"
              : `باقي ${remaining} أكواب للمشروب المجاني`}
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
        <img src="/brand/wordmark-cream.png" alt="" className="item-img__mark" />
      )}
    </span>
  );
}

export function QtyStepper({
  quantity,
  onChange,
  max = 20,
  label,
}: {
  quantity: number;
  onChange: (q: number) => void;
  max?: number;
  label: string;
}) {
  return (
    <div className="stepper" role="group" aria-label={`الكمية: ${label}`}>
      <button type="button" className="stepper__btn" onClick={() => onChange(quantity + 1)} disabled={quantity >= max} aria-label="زيادة">
        +
      </button>
      <span className="stepper__value" aria-live="polite">
        {quantity}
      </span>
      <button type="button" className="stepper__btn" onClick={() => onChange(quantity - 1)} aria-label={quantity === 1 ? "حذف" : "إنقاص"}>
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
