import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { isActiveStatus, isOrderable, priceOf, type MenuCategory, type MenuItem, type MenuResponse, type Order } from "../../../shared/ordering";
import { categoryLabel, itemDescription, itemName, itemSubName, optionLabel, statusLabel, subNameDir } from "../../lib/menuText";
import { AddControl } from "../../components/AddControl";
import { Alert } from "../../components/Field";
import { choosesOrigin, OriginSheet } from "../../components/OriginSheet";
import { SearchPill, SearchScreen } from "../../components/MenuSearch";
import { Rolling } from "../../components/Rolling";
import { SalePrice } from "../../components/SalePrice";
import { ProductSheet } from "../../components/ProductSheet";
import { MenuSkeleton } from "../../components/Skeletons";
import { ItemImage, LoyaltyBand, ShopLayout } from "../../components/Shop";
import { apiGet } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { motionOn } from "../../lib/motion";
import { riyals, useMenu } from "../../lib/menu";
import { lowStockBadge } from "../../lib/stock";
import { closedNote } from "./hours";
import { tr } from "../../lib/i18n";
import { drinkTemperature } from "../../../shared/drink-temperature";
import type { TemperatureChoice } from "../../components/DrinkTemperature";

const CATEGORIES: MenuCategory[] = ["drink", "dessert"];

/** A block of the menu: «الأفضل مبيعًا» (the owner's picks), then each category. */
type Section = { key: "best" | MenuCategory; title: string; items: MenuItem[] };

function menuSections(items: MenuItem[]): Section[] {
  const best = items.filter((i) => i.isBestSeller);
  const sections: Section[] = best.length > 0 ? [{ key: "best", title: tr("الأفضل مبيعًا", "Best sellers"), items: best }] : [];
  for (const c of CATEGORIES) {
    const list = items.filter((i) => i.category === c);
    if (list.length > 0) sections.push({ key: c, title: categoryLabel(c), items: list });
  }
  return sections;
}

/** Choosing hot or cold is only worth offering when the menu has both. */
function hasHotAndCold(sections: Section[]): boolean {
  const drinks = sections.find((s) => s.key === "drink")?.items ?? [];
  return drinks.some((item) => drinkTemperature(item) === "hot") && drinks.some((item) => drinkTemperature(item) === "cold");
}

export function MenuPage() {
  const { me, session, refreshMe } = useAuth();
  const { menu, error, reload } = useMenu();
  const sections = menu ? menuSections(menu.items) : [];
  const canChoose = hasHotAndCold(sections);
  // The search page, while open: where the «بحث» button was when it was tapped.
  const [search, setSearch] = useState<{ from: DOMRect } | null>(null);
  const closeSearch = useCallback(() => setSearch(null), []);
  // Bumped by pull-to-refresh so the live order reloads too.
  const [refreshes, setRefreshes] = useState(0);
  const refresh = useCallback(() => {
    setRefreshes((n) => n + 1);
    return Promise.all([reload(), session ? refreshMe() : null]);
  }, [reload, refreshMe, session]);
  // Hot or cold drinks only (null: all), chosen in the search dock at the bottom.
  const [temperature, setTemperature] = useState<TemperatureChoice>(null);
  const chooseTemperature = useCallback((value: TemperatureChoice) => {
    setTemperature(value);
    // The list changes length: show the drinks from the first one.
    requestAnimationFrame(() => {
      const drinks = document.getElementById("section-drink");
      if (drinks) drinks.scrollIntoView({ behavior: motionOn() ? "smooth" : "auto", block: "start" });
    });
  }, []);
  return (
    <ShopLayout
      bottom={
        <>
          {menu && <SearchPill onOpen={(from) => setSearch({ from })} filter={canChoose ? { value: temperature, onChange: chooseTemperature } : undefined} />}
          <CartBar menu={menu} />
        </>
      }
      onRefresh={refresh}
    >
      {search && menu && <SearchScreen menu={menu} from={search.from} onClose={closeSearch} />}
      <FullMenu menu={menu} error={error} sections={sections} refreshes={refreshes} card={me?.card ?? null} temperature={temperature} />
    </ShopLayout>
  );
}

function FullMenu({
  menu,
  error,
  sections,
  refreshes,
  card,
  temperature,
}: {
  menu: MenuResponse | null;
  error: string | null;
  sections: Section[];
  refreshes: number;
  card: Parameters<typeof LoyaltyBand>[0]["card"];
  temperature: TemperatureChoice;
}) {
  const [active, setActive] = useState<Section["key"] | null>(null);
  const currentCategory = active ?? sections[0]?.key ?? null;
  const temperatureLabel = temperature === null ? categoryLabel("drink") : temperature === "hot" ? tr("المشروبات الحارة", "Hot drinks") : tr("المشروبات الباردة", "Cold drinks");
  return (
    <>
      <LiveOrder refreshes={refreshes} />
      <LoyaltyBand card={card} />
      {error && !menu && <Alert tone="error">{error}</Alert>}
      {!menu && !error && <MenuSkeleton />}
      {menu && !menu.shop.isOpen && (
        <div className="shop-closed" role="status">
          <strong>{tr("لا نستقبل طلبات الآن", "We're not taking orders right now")}</strong>
          <span>{closedNote(menu.shop.settings)}</span>
        </div>
      )}
      {sections.length > 0 && <CategoryChips sections={sections} active={currentCategory} onActiveChange={setActive} />}
      {menu &&
        sections.map((section) => (
          <section key={section.key} id={`section-${section.key}`} className="menu-section" aria-labelledby={`cat-${section.key}`}>
            <h2 id={`cat-${section.key}`} className={`menu-section__title ${section.key === "best" ? "menu-section__title--best" : ""}`}>
              {section.key === "drink" ? temperatureLabel : section.title}
            </h2>
            <ul className="menu-grid">
              {section.items.filter(item => section.key !== "drink" || temperature === null || drinkTemperature(item) === temperature).map((item) => (
                <MenuCard key={item.id} item={item} canOrder={menu.shop.isOpen} />
              ))}
            </ul>
            {section.key === "drink" && temperature !== null && !section.items.some(item => drinkTemperature(item) === temperature) && <p className="empty" role="status">{tr("لا توجد مشروبات في هذا القسم حالياً", "No drinks in this section yet")}</p>}
          </section>
        ))}
    </>
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
        <small>{statusLabel(order)}</small>
      </span>
      <span className="live-order__go">{tr("تابع الطلب ›", "Track ›")}</span>
    </Link>
  );
}

/** Jump between menu sections; the chip of the section in view is highlighted. */
function CategoryChips({ sections, active, onActiveChange }: {
  sections: Section[];
  active: Section["key"] | null;
  onActiveChange: (key: Section["key"]) => void;
}) {
  const keys = sections.map((s) => s.key).join(",");
  useEffect(() => {
    const elements = keys
      .split(",")
      .map((k) => document.getElementById(`section-${k}`))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) onActiveChange(visible.target.id.replace("section-", "") as Section["key"]);
      },
      { rootMargin: "-130px 0px -55% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [keys, onActiveChange]);
  function jump(key: Section["key"]) {
    onActiveChange(key);
    requestAnimationFrame(() => document.getElementById(`section-${key}`)?.scrollIntoView({ behavior: motionOn() ? "smooth" : "auto", block: "start" }));
  }
  return (
    <nav className="menu-chips menu-chips--nested" aria-label={tr("أقسام المنيو", "Menu sections")}>
      <div className="menu-chips__categories">
      {sections.map((s) => (
        <button
          key={s.key}
          type="button"
          className={`menu-chip ${active === s.key ? "is-active" : ""} ${s.key === "best" ? "menu-chip--best" : ""}`}
          aria-current={active === s.key ? "true" : undefined}
          onClick={() => {
            jump(s.key);
          }}
        >
          {s.title}
        </button>
      ))}
      </div>
    </nav>
  );
}


function MenuCard({ item, canOrder }: { item: MenuItem; canOrder: boolean }) {
  const soldOut = !isOrderable(item);
  const cardRef = useRef<HTMLLIElement>(null);
  const [open, setOpen] = useState(false);
  // The card the sheet grows out of (and folds back into).
  const [origin, setOrigin] = useState<HTMLElement | null>(null);
  // V60 and the like: the photo opens the small origin sheet, as the + does.
  const quick = choosesOrigin(item, canOrder);
  const [choosing, setChoosing] = useState(false);
  const openSheet = () => {
    if (quick) {
      setChoosing(true);
      return;
    }
    setOrigin(cardRef.current);
    setOpen(true);
  };
  return (
    <li ref={cardRef} className={`menu-card ${soldOut ? "menu-card--soldout" : ""}`}>
      <button
        type="button"
        className="menu-card__photo"
        onClick={openSheet}
        aria-label={
          quick
            ? tr(`اختر ${optionLabel(item)} وأضف ${item.nameAr}`, `Choose the ${optionLabel(item)} and add ${itemName(item)}`)
            : tr(`عرض ${item.nameAr}`, `View ${itemName(item)}`)
        }
      >
        <ItemImage item={item} className="menu-card__img" />
        {item.options.length > 0 && <span className="menu-card__tag">{tr(`${item.options.length} محاصيل`, `${item.options.length} origins`)}</span>}
        {item.isBestSeller && <span className="menu-card__ribbon">{tr("الأفضل مبيعًا", "Best seller")}</span>}
        {!soldOut && item.stockQuantity != null && <span className="menu-card__low">{lowStockBadge(item.stockQuantity)}</span>}
        {item.discountPercent !== null && (
          <span className="menu-card__off">
            <bdi dir="ltr">-{item.discountPercent}%</bdi>
          </span>
        )}
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
            <SalePrice item={item} />
            {item.calories !== null && <small className="kcal">{tr(`${item.calories} سعرة`, `${item.calories} kcal`)}</small>}
          </span>
          <AddControl item={item} canOrder={canOrder} flyFrom={() => cardRef.current?.querySelector(".menu-card__img") ?? null} />
        </div>
      </div>
      {open && <ProductSheet item={item} canOrder={canOrder} origin={origin} onClose={() => setOpen(false)} />}
      {choosing && <OriginSheet item={item} onClose={() => setChoosing(false)} />}
    </li>
  );
}

/** Espresso bar above the tab bar, like the dark strip of the card. */
export function CartBar({ menu }: { menu: MenuResponse | null }) {
  const { lines, count } = useCart();
  if (count === 0 || !menu) return null;
  const subtotal = lines.reduce((sum, l) => {
    const item = menu.items.find((i) => i.id === l.menuItemId);
    return sum + (item ? priceOf(item) * l.quantity : 0);
  }, 0);
  return (
    <Link to="/cart" className="cart-bar">
      <span className="cart-bar__count">{count}</span>
      <span className="cart-bar__label">{tr("عرض السلة", "View cart")}</span>
      <Rolling className="cart-bar__total" text={riyals(subtotal)} />
    </Link>
  );
}
