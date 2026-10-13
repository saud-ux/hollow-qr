import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { isActiveStatus, isOrderable, MAX_LINE_QUANTITY, priceOf, type MenuCategory, type MenuItem, type MenuResponse, type Order } from "../../../shared/ordering";
import { categoryLabel, itemDescription, itemName, itemSubName, optionLabel, statusLabel, subNameDir } from "../../lib/menuText";
import { searchMenuForgiving } from "../../../shared/menu-search";
import { Alert } from "../../components/Field";
import { Highlight, SearchField, SearchPill } from "../../components/MenuSearch";
import { Rolling } from "../../components/Rolling";
import { SalePrice } from "../../components/SalePrice";
import { showToast } from "../../components/Toast";
import { ProductSheet } from "../../components/ProductSheet";
import { ItemImage, LoyaltyBand, QtyStepper, ShopLayout } from "../../components/Shop";
import { apiGet } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { flyToCart, growStepper, motionOn } from "../../lib/motion";
import { riyals, useMenu } from "../../lib/menu";
import { clearRecentSearches, recentSearches, rememberSearch } from "../../lib/recentSearches";
import { lowStockBadge, stockLeftText, stockRoom } from "../../lib/stock";
import { closedNote } from "./hours";
import { tr } from "../../lib/i18n";

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

/**
 * The menu is the page on screen (not a copy drawn under another page while
 * it slides in or out), so it may change the address and take shortcuts.
 */
function onMenuPage(): boolean {
  return window.location.pathname === "/menu";
}

export function MenuPage() {
  const { me, session, refreshMe } = useAuth();
  const { menu, error, reload } = useMenu();
  const sections = menu ? menuSections(menu.items) : [];
  // null while the search is closed; the menu filters as you type.
  // A link like /menu?q=ماتشا opens with the search already done.
  const { search: urlSearch } = useLocation();
  const [search, setSearch] = useState<string | null>(() => new URLSearchParams(urlSearch).get("q"));
  const query = search?.trim() ?? "";
  const found = menu && query ? searchMenuForgiving(menu.items, query) : null;
  const closeSearch = useCallback(() => setSearch(null), []);
  const [recent, setRecent] = useState(recentSearches);
  const remember = useCallback(() => {
    if (query) setRecent(rememberSearch(query));
  }, [query]);
  // New results start from the top.
  useEffect(() => {
    if (query) window.scrollTo({ top: 0 });
  }, [query]);
  // The address keeps the search, so going back to the menu (or sharing it) shows the same results.
  useEffect(() => {
    if (!onMenuPage()) return;
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [query]);
  // On a computer: «/» or Ctrl/⌘ K opens the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      const shortcut = (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey));
      if (!shortcut || typing || !onMenuPage() || document.documentElement.classList.contains("sheet-open")) return;
      e.preventDefault();
      setSearch((s) => s ?? "");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const popular = menu ? menu.items.filter((i) => i.isBestSeller && isOrderable(i)).map(itemName).slice(0, 4) : [];
  // Bumped by pull-to-refresh so the live order reloads too.
  const [refreshes, setRefreshes] = useState(0);
  const refresh = useCallback(() => {
    setRefreshes((n) => n + 1);
    return Promise.all([reload(), session ? refreshMe() : null]);
  }, [reload, refreshMe, session]);
  return (
    <ShopLayout
      bottom={
        <>
          {menu && search === null && <SearchPill onOpen={() => setSearch("")} />}
          <CartBar menu={menu} />
        </>
      }
      onRefresh={refresh}
    >
      {search !== null && (
        <SearchField
          value={search}
          onChange={setSearch}
          onClose={closeSearch}
          onSubmit={() => found && found.items.length > 0 && remember()}
          suggestions={{
            recent,
            popular,
            onClearRecent: () => {
              clearRecentSearches();
              setRecent([]);
            },
          }}
        />
      )}
      {found && menu ? (
        <SearchResults query={query} found={found} menu={menu} onPick={remember} />
      ) : (
        <FullMenu menu={menu} error={error} sections={sections} refreshes={refreshes} card={me?.card ?? null} />
      )}
    </ShopLayout>
  );
}

/**
 * What the search found, in the same cards as the menu, with the matching
 * words marked. A typo still shows the closest items; nothing at all shows
 * the best sellers instead of an empty page.
 */
function SearchResults({
  query,
  found: { items, closest },
  menu,
  onPick,
}: {
  query: string;
  found: { items: MenuItem[]; closest: boolean };
  menu: MenuResponse;
  onPick: () => void;
}) {
  const canOrder = menu.shop.isOpen;
  const best = items.length === 0 ? menu.items.filter((i) => i.isBestSeller) : [];
  return (
    <>
      {/* Opening or adding something it found: worth offering this search again. */}
      <section className="menu-section search-results" aria-live="polite" onClickCapture={items.length > 0 ? onPick : undefined}>
        <h2 className="menu-section__title">
          {items.length === 0
            ? tr(`لا نتائج لـ «${query}»`, `No results for “${query}”`)
            : closest
              ? tr(`أقرب نتائج لـ «${query}»`, `Closest matches for “${query}”`)
              : tr(`${items.length} ${items.length === 1 ? "نتيجة" : "نتائج"} لـ «${query}»`, `${items.length} ${items.length === 1 ? "result" : "results"} for “${query}”`)}
        </h2>
        {items.length === 0 ? (
          <p className="muted search-results__empty">{tr("جرّب اسمًا ثانيًا، مثل «ماتشا» أو «V60».", "Try another name, like “Matcha” or “V60”.")}</p>
        ) : (
          <ul className="menu-grid">
            {items.map((item) => (
              <MenuCard key={item.id} item={item} canOrder={canOrder} highlight={{ query, nearly: closest }} />
            ))}
          </ul>
        )}
      </section>
      {best.length > 0 && (
        <section className="menu-section search-results" aria-labelledby="search-best">
          <h2 id="search-best" className="menu-section__title menu-section__title--best">
            {tr("الأفضل مبيعًا", "Best sellers")}
          </h2>
          <ul className="menu-grid">
            {best.map((item) => (
              <MenuCard key={item.id} item={item} canOrder={canOrder} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function FullMenu({
  menu,
  error,
  sections,
  refreshes,
  card,
}: {
  menu: MenuResponse | null;
  error: string | null;
  sections: Section[];
  refreshes: number;
  card: Parameters<typeof LoyaltyBand>[0]["card"];
}) {
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
      {sections.length > 0 && <CategoryChips sections={sections} />}
      {menu &&
        sections.map((section) => (
          <section key={section.key} id={`section-${section.key}`} className="menu-section" aria-labelledby={`cat-${section.key}`}>
            <h2 id={`cat-${section.key}`} className={`menu-section__title ${section.key === "best" ? "menu-section__title--best" : ""}`}>
              {section.title}
            </h2>
            <ul className="menu-grid">
              {section.items.map((item) => (
                <MenuCard key={item.id} item={item} canOrder={menu.shop.isOpen} />
              ))}
            </ul>
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
function CategoryChips({ sections }: { sections: Section[] }) {
  const keys = sections.map((s) => s.key).join(",");
  const [active, setActive] = useState<Section["key"] | null>(sections[0]?.key ?? null);
  useEffect(() => {
    const elements = keys
      .split(",")
      .map((k) => document.getElementById(`section-${k}`))
      .filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id.replace("section-", "") as Section["key"]);
      },
      { rootMargin: "-130px 0px -55% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [keys]);
  if (sections.length < 2) return null;
  return (
    <nav className="menu-chips" aria-label={tr("أقسام المنيو", "Menu sections")}>
      {sections.map((s) => (
        <button
          key={s.key}
          type="button"
          className={`menu-chip ${active === s.key ? "is-active" : ""} ${s.key === "best" ? "menu-chip--best" : ""}`}
          aria-current={active === s.key ? "true" : undefined}
          onClick={() => {
            setActive(s.key);
            document.getElementById(`section-${s.key}`)?.scrollIntoView({ behavior: motionOn() ? "smooth" : "auto", block: "start" });
          }}
        >
          {s.title}
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

function MenuCard({ item, canOrder, highlight }: { item: MenuItem; canOrder: boolean; highlight?: { query: string; nearly: boolean } }) {
  const cart = useCart();
  const hasOptions = item.options.length > 0;
  const qty = hasOptions ? cart.totalOf(item.id) : cart.quantityOf(item.id);
  const soldOut = !isOrderable(item);
  const room = stockRoom(item, cart.lines);
  const cardRef = useRef<HTMLLIElement>(null);
  const [open, setOpen] = useState(false);
  // The card the sheet grows out of (and folds back into).
  const [origin, setOrigin] = useState<HTMLElement | null>(null);
  const openSheet = () => {
    setOrigin(cardRef.current);
    setOpen(true);
  };
  // + grows into the stepper when the first one goes in the cart.
  const lastQty = useRef(qty);
  const addWidth = useRef(40);
  useLayoutEffect(() => {
    const was = lastQty.current;
    lastQty.current = qty;
    const add = cardRef.current?.querySelector(".menu-card__foot .add-btn");
    if (add) addWidth.current = add.getBoundingClientRect().width || addWidth.current;
    if (was === 0 && qty > 0 && !hasOptions) growStepper(cardRef.current?.querySelector(".menu-card__foot .stepper") ?? null, addWidth.current);
  }, [qty, hasOptions]);
  return (
    <li ref={cardRef} className={`menu-card ${soldOut ? "menu-card--soldout" : ""}`}>
      <button type="button" className="menu-card__photo" onClick={openSheet} aria-label={tr(`عرض ${item.nameAr}`, `View ${itemName(item)}`)}>
        <ItemImage item={item} className="menu-card__img" />
        {hasOptions && <span className="menu-card__tag">{tr(`${item.options.length} محاصيل`, `${item.options.length} origins`)}</span>}
        {item.isBestSeller && <span className="menu-card__ribbon">{tr("الأفضل مبيعًا", "Best seller")}</span>}
        {!soldOut && item.stockQuantity != null && <span className="menu-card__low">{lowStockBadge(item.stockQuantity)}</span>}
        {item.discountPercent !== null && (
          <span className="menu-card__off">
            <bdi dir="ltr">-{item.discountPercent}%</bdi>
          </span>
        )}
      </button>
      <div className="menu-card__body">
        <h3 className="menu-card__name">{highlight ? <Highlight text={itemName(item)} {...highlight} /> : itemName(item)}</h3>
        {itemSubName(item) && (
          <span className="pass-label" dir={subNameDir()}>
            {highlight ? <Highlight text={itemSubName(item)!} {...highlight} /> : itemSubName(item)}
          </span>
        )}
        {itemDescription(item) && <p className="menu-card__desc">{itemDescription(item)}</p>}
        <div className="menu-card__foot">
          <span className="menu-card__price">
            <SalePrice item={item} />
            {item.calories !== null && <small className="kcal">{tr(`${item.calories} سعرة`, `${item.calories} kcal`)}</small>}
          </span>
          {soldOut ? (
            <span className="badge badge--muted">{tr("نفد", "Sold out")}</span>
          ) : hasOptions ? (
            // Choosing an origin happens in the sheet.
            <button
              type="button"
              className="add-btn"
              onClick={openSheet}
              disabled={!canOrder}
              aria-label={tr(`اختر ${optionLabel(item)} وأضف ${item.nameAr}`, `Choose the ${optionLabel(item)} and add ${itemName(item)}`)}
            >
              {qty > 0 ? <span className="add-btn__count">{qty}</span> : "+"}
            </button>
          ) : qty > 0 ? (
            <QtyStepper
              quantity={qty}
              onChange={(q) => cart.setQuantity(item.id, q)}
              max={Math.min(MAX_LINE_QUANTITY, qty + room)}
              onLimit={room === 0 ? () => showToast(stockLeftText(item, item.stockQuantity ?? 0)) : undefined}
              label={itemName(item)}
            />
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
      {open && <ProductSheet item={item} canOrder={canOrder} origin={origin} onClose={() => setOpen(false)} />}
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
