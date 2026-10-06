import { useRef } from "react";
import { Link } from "react-router";
import { CATEGORY_LABELS_AR, type MenuCategory, type MenuItem, type MenuResponse } from "../../../shared/ordering";
import { Alert, Spinner } from "../../components/Field";
import { ItemImage, LoyaltyBand, QtyStepper, ShopLayout } from "../../components/Shop";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { flyToCart } from "../../lib/motion";
import { riyals, useMenu } from "../../lib/menu";
import { closedNote } from "./hours";

const CATEGORIES: MenuCategory[] = ["drink", "dessert"];

export function MenuPage() {
  const { me } = useAuth();
  const { menu, error } = useMenu();
  return (
    <ShopLayout bottom={<CartBar menu={menu} />}>
      <LoyaltyBand card={me?.card ?? null} />
      {error && !menu && <Alert tone="error">{error}</Alert>}
      {!menu && !error && <Spinner />}
      {menu && !menu.shop.isOpen && (
        <div className="shop-closed" role="status">
          <strong>لا نستقبل طلبات الآن</strong>
          <span>{closedNote(menu.shop.settings)}</span>
        </div>
      )}
      {menu &&
        CATEGORIES.map((category) => {
          const items = menu.items.filter((i) => i.category === category);
          if (items.length === 0) return null;
          return (
            <section key={category} className="menu-section" aria-labelledby={`cat-${category}`}>
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
