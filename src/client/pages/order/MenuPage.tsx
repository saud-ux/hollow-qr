import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { isActiveStatus, isOrderable, type MenuCategory, type MenuItem, type MenuResponse, type Order } from "../../../shared/ordering";
import { categoryLabel, itemDescription, itemName, itemSubName, optionLabel, statusLabel, subNameDir } from "../../lib/menuText";
import { Alert } from "../../components/Field";
import { ProductSheet } from "../../components/ProductSheet";
import { ItemImage, LoyaltyBand, QtyStepper, ShopLayout } from "../../components/Shop";
import { apiGet } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { flyToCart, motionOn } from "../../lib/motion";
import { riyals, useMenu } from "../../lib/menu";
import { closedNote } from "./hours";
import { tr } from "../../lib/i18n";

const CATEGORIES: MenuCategory[] = ["drink", "dessert"];

export function MenuPage() {
  const { me, session, refreshMe } = useAuth();
  const { menu, error, reload } = useMenu();
  // Bumped by pull-to-refresh so the live order reloads too.
  const [refreshes, setRefreshes] = useState(0);
  const refresh = useCallback(() => {
    setRefreshes((n) => n + 1);
    return Promise.all([reload(), session ? refreshMe() : null]);
  }, [reload, refreshMe, session]);
  return (
    <ShopLayout bottom={<CartBar menu={menu} />} onRefresh={refresh}>
      <LiveOrder refreshes={refreshes} />
      <LoyaltyBand card={me?.card ?? null} />
      {error && !menu && <Alert tone="error">{error}</Alert>}
      {!menu && !error && <MenuSkeleton />}
      {menu && !menu.shop.isOpen && (
        <div className="shop-closed" role="status">
          <strong>{tr("لا نستقبل طلبات الآن", "We're not taking orders right now")}</strong>
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
                {categoryLabel(category)}
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
function LiveOrder({ refreshes }: { refreshes: number }) {
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
  }, [session, refreshes]);
  if (!session || !order) return null;
  return (
    <Link to={`/orders/${order.id}`} className="live-order">
      <span className="live-order__dot" aria-hidden="true" />
      <span className="live-order__text">
        <strong>
          {tr("طلبك", "Your order")} <span dir="ltr">#{order.orderNumber}</span>
        </strong>
        <small>{statusLabel(order.status)}</small>
      </span>
      <span className="live-order__go">{tr("تابع الطلب ›", "Track ›")}</span>
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
    <nav className="menu-chips" aria-label={tr("أقسام المنيو", "Menu sections")}>
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
          {categoryLabel(c)}
        </button>
      ))}
    </nav>
  );
}

function MenuSkeleton() {
  return (
    <div className="menu-grid" aria-busy="true" aria-label={tr("جارٍ تحميل المنيو", "Loading the menu")}>
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
  const hasOptions = item.options.length > 0;
  const qty = hasOptions ? cart.totalOf(item.id) : cart.quantityOf(item.id);
  const soldOut = !isOrderable(item);
  const cardRef = useRef<HTMLLIElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <li ref={cardRef} className={`menu-card ${soldOut ? "menu-card--soldout" : ""}`}>
      <button type="button" className="menu-card__photo" onClick={() => setOpen(true)} aria-label={tr(`عرض ${item.nameAr}`, `View ${itemName(item)}`)}>
        <ItemImage item={item} className="menu-card__img" />
        {hasOptions && <span className="menu-card__tag">{tr(`${item.options.length} محاصيل`, `${item.options.length} origins`)}</span>}
      </button>
      <div className="menu-card__body">
        <h3 className="menu-card__name">{itemName(item)}</h3>
        {itemSubName(item) && (
          <span className="pass-label" dir={subNameDir()}>
            {itemSubName(item)}
          </span>
        )}
        {itemDescription(item) && <p className="menu-card__desc">{itemDescription(item)}</p>}
        <div className="menu-card__foot">
          <span className="menu-card__price">
            {riyals(item.priceHalalas)}
            {item.calories !== null && <small className="kcal">{tr(`${item.calories} سعرة`, `${item.calories} kcal`)}</small>}
          </span>
          {soldOut ? (
            <span className="badge badge--muted">{tr("نفد", "Sold out")}</span>
          ) : hasOptions ? (
            // Choosing an origin happens in the sheet.
            <button
              type="button"
              className="add-btn"
              onClick={() => setOpen(true)}
              disabled={!canOrder}
              aria-label={tr(`اختر ${optionLabel(item)} وأضف ${item.nameAr}`, `Choose the ${optionLabel(item)} and add ${itemName(item)}`)}
            >
              {qty > 0 ? <span className="add-btn__count">{qty}</span> : "+"}
            </button>
          ) : qty > 0 ? (
            <QtyStepper quantity={qty} onChange={(q) => cart.setQuantity(item.id, q)} label={itemName(item)} />
          ) : (
            <button
              type="button"
              className="add-btn"
              onClick={() => {
                flyToCart(cardRef.current?.querySelector(".menu-card__img") ?? null);
                cart.add(item.id);
              }}
              disabled={!canOrder}
              aria-label={tr(`إضافة ${item.nameAr} إلى السلة`, `Add ${itemName(item)} to cart`)}
            >
              +
            </button>
          )}
        </div>
      </div>
      {open && <ProductSheet item={item} canOrder={canOrder} onClose={() => setOpen(false)} />}
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
      <span className="cart-bar__label">{tr("عرض السلة", "View cart")}</span>
      <span className="cart-bar__total">{riyals(subtotal)}</span>
    </Link>
  );
}
