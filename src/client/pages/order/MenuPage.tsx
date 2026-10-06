import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { CATEGORY_LABELS_AR, isActiveStatus, STATUS_LABELS_AR, type MenuCategory, type MenuItem, type MenuResponse, type Order } from "../../../shared/ordering";
import { Alert } from "../../components/Field";
import { ItemImage, LoyaltyBand, QtyStepper, ShopLayout } from "../../components/Shop";
import { apiGet } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { flyToCart, motionOn } from "../../lib/motion";
import { riyals, useMenu } from "../../lib/menu";
import { closedNote } from "./hours";

const CATEGORIES: MenuCategory[] = ["drink", "dessert"];

export function MenuPage() {
  const { me } = useAuth();
  const { menu, error } = useMenu();
  return (
    <ShopLayout bottom={<CartBar menu={menu} />}>
      <LiveOrder />
      <LoyaltyBand card={me?.card ?? null} />
      {error && !menu && <Alert tone="error">{error}</Alert>}
      {!menu && !error && <MenuSkeleton />}
      {menu && !menu.shop.isOpen && (
        <div className="shop-closed" role="status">
          <strong>لا نستقبل طلبات الآن</strong>
          <span>{closedNote(menu.shop.settings)}</span>
        </div>
      )}
      {menu && <CategoryChips categories={CATEGORIES.filter((c) => menu.items.some((i) => i.category === c))} />}
      {menu &&
        CATEGORIES.map((category) => {
          const items = menu.items.filter((i) => i.category === category);
          if (items.length === 0) return null;
          return (
            <section key={category} id={`section-${category}`} className="menu-section" aria-labelledby={`cat-${category}`}>
              <h2 id={`cat-${category}`} className="menu-section__title">
                {CATEGORY_LABELS_AR[category]}
              </h2>
              <ul className="menu-grid">
                {items.map((item) => (
                  <MenuCard key={item.id} item={item} canOrder={menu.shop.isOpen} />
                ))}
              </ul>
            </section>
          );
        })}
    </ShopLayout>
  );
}

/** An order in progress, pinned on top of the menu so it's one tap away. */
function LiveOrder() {
  const { session } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    apiGet<{ items: Order[] }>("/api/orders")
      .then((r) => alive && setOrder(r.items.find((o) => isActiveStatus(o.status)) ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session]);
  if (!session || !order) return null;
  return (
    <Link to={`/orders/${order.id}`} className="live-order">
      <span className="live-order__dot" aria-hidden="true" />
      <span className="live-order__text">
        <strong>
          طلبك <span dir="ltr">#{order.orderNumber}</span>
        </strong>
        <small>{STATUS_LABELS_AR[order.status]}</small>
      </span>
      <span className="live-order__go">تابع الطلب ›</span>
    </Link>
  );
}

/** Jump between menu sections; the chip of the section in view is highlighted. */
function CategoryChips({ categories }: { categories: MenuCategory[] }) {
  const [active, setActive] = useState<MenuCategory | null>(categories[0] ?? null);
  useEffect(() => {
    const sections = categories.map((c) => document.getElementById(`section-${c}`)).filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id.replace("section-", "") as MenuCategory);
      },
      { rootMargin: "-130px 0px -55% 0px" },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [categories]);
  if (categories.length < 2) return null;
  return (
    <nav className="menu-chips" aria-label="أقسام المنيو">
      {categories.map((c) => (
        <button
          key={c}
          type="button"
          className={`menu-chip ${active === c ? "is-active" : ""}`}
          aria-current={active === c ? "true" : undefined}
          onClick={() => {
            setActive(c);
            document.getElementById(`section-${c}`)?.scrollIntoView({ behavior: motionOn() ? "smooth" : "auto", block: "start" });
          }}
        >
          {CATEGORY_LABELS_AR[c]}
        </button>
      ))}
    </nav>
  );
}

function MenuSkeleton() {
  return (
    <div className="menu-grid" aria-busy="true" aria-label="جارٍ تحميل المنيو">
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

function MenuCard({ item, canOrder }: { item: MenuItem; canOrder: boolean }) {
  const cart = useCart();
  const qty = cart.quantityOf(item.id);
  const soldOut = !item.isAvailable;
  const cardRef = useRef<HTMLLIElement>(null);
  return (
    <li ref={cardRef} className={`menu-card ${soldOut ? "menu-card--soldout" : ""}`}>
      <ItemImage item={item} className="menu-card__img" />
      <div className="menu-card__body">
        <h3 className="menu-card__name">{item.nameAr}</h3>
        {item.nameEn && (
          <span className="pass-label" dir="ltr">
            {item.nameEn}
          </span>
        )}
        {item.descriptionAr && <p className="menu-card__desc">{item.descriptionAr}</p>}
        <div className="menu-card__foot">
          <span className="menu-card__price">{riyals(item.priceHalalas)}</span>
          {soldOut ? (
            <span className="badge badge--muted">نفد</span>
          ) : qty > 0 ? (
            <QtyStepper quantity={qty} onChange={(q) => cart.setQuantity(item.id, q)} label={item.nameAr} />
          ) : (
            <button
              type="button"
              className="add-btn"
              onClick={() => {
                flyToCart(cardRef.current?.querySelector(".menu-card__img") ?? null);
                cart.add(item.id);
              }}
              disabled={!canOrder}
              aria-label={`إضافة ${item.nameAr} إلى السلة`}
            >
              +
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Espresso bar above the tab bar, like the dark strip of the card. */
export function CartBar({ menu }: { menu: MenuResponse | null }) {
  const { lines, count } = useCart();
  if (count === 0 || !menu) return null;
  const subtotal = lines.reduce((sum, l) => {
    const item = menu.items.find((i) => i.id === l.menuItemId);
    return sum + (item ? item.priceHalalas * l.quantity : 0);
  }, 0);
  return (
    <Link to="/cart" className="cart-bar">
      <span className="cart-bar__count">{count}</span>
      <span className="cart-bar__label">عرض السلة</span>
      <span className="cart-bar__total">{riyals(subtotal)}</span>
    </Link>
  );
}
