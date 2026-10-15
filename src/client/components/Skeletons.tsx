import { useLayoutEffect, useRef } from "react";
import { tr } from "../lib/i18n";
import { riseInNew } from "../lib/motion";

/**
 * When a placeholder makes way for the data, whatever takes its place rises
 * in, a block at a time, instead of popping in.
 */
function useHandOff(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      // Runs as the placeholder is removed: its parent still shows what was
      // there before, and the new content is in place right after this commit.
      const parent = el?.parentElement;
      if (!parent) return;
      const before = new Set(parent.children);
      queueMicrotask(() => riseInNew(parent, before));
    };
  }, [ref]);
}

/**
 * Shimmering placeholders shaped like the screen that is loading, so the
 * layout doesn't jump when the data arrives.
 */
function Busy({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useHandOff(ref);
  return (
    <div ref={ref} className={`skeleton-group ${className}`} role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

/** The menu: a few cards. */
export function MenuSkeleton() {
  const ref = useRef<HTMLDivElement>(null);
  useHandOff(ref);
  return (
    <div ref={ref} className="menu-grid" aria-busy="true" aria-label={tr("جارٍ تحميل المنيو", "Loading the menu")}>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="menu-card skeleton-card" aria-hidden="true">
          <div className="skeleton skeleton--img" />
          <div className="menu-card__body">
            <div className="skeleton skeleton--line" />
            <div className="skeleton skeleton--line skeleton--short" />
          </div>
        </div>
      ))}
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
