import { tr } from "../lib/i18n";

/**
 * Shimmering placeholders shaped like the screen that is loading, so the
 * layout doesn't jump when the data arrives.
 */
function Busy({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`skeleton-group ${className}`} role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

/** My orders: a few order rows. */
export function OrdersSkeleton() {
  return (
    <Busy label={tr("جارٍ تحميل طلباتك", "Loading your orders")} className="order-list">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="order-row skeleton-row" aria-hidden="true">
          <span className="skeleton skeleton--num" />
          <span className="skeleton-row__main">
            <span className="skeleton skeleton--line" />
            <span className="skeleton skeleton--line skeleton--short" />
          </span>
          <span className="skeleton skeleton--chip" />
        </div>
      ))}
    </Busy>
  );
}

/** An order: the ticket with its dark band and the steps. */
export function TicketSkeleton() {
  return (
    <Busy label={tr("جارٍ تحميل الطلب", "Loading the order")}>
      <div className="ticket skeleton-ticket" aria-hidden="true">
        <div className="skeleton skeleton--band" />
        <div className="skeleton-ticket__steps">
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="skeleton-ticket__step">
              <span className="skeleton skeleton--dot" />
              <span className="skeleton skeleton--line" />
            </span>
          ))}
        </div>
      </div>
      <div className="sheet skeleton-sheet" aria-hidden="true">
        <span className="skeleton skeleton--line skeleton--short" />
        <span className="skeleton skeleton--line" />
        <span className="skeleton skeleton--line" />
      </div>
    </Busy>
  );
}

/** My card: the Wallet pass and the button under it. */
export function CardSkeleton() {
  return (
    <Busy label={tr("جارٍ تحميل بطاقتك", "Loading your card")}>
      <div className="skeleton skeleton--pass" aria-hidden="true" />
      <div className="skeleton skeleton--button" aria-hidden="true" />
    </Busy>
  );
}

/** The cart while the menu loads: a few lines and the total. */
export function CartSkeleton() {
  return (
    <Busy label={tr("جارٍ تحميل السلة", "Loading your cart")}>
      <div className="sheet skeleton-sheet" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className="skeleton-cart-line">
            <span className="skeleton skeleton--thumb" />
            <span className="skeleton-row__main">
              <span className="skeleton skeleton--line" />
              <span className="skeleton skeleton--line skeleton--short" />
            </span>
          </span>
        ))}
      </div>
      <div className="skeleton skeleton--button" aria-hidden="true" />
    </Busy>
  );
}
