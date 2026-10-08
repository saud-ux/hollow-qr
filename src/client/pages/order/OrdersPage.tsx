import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { flowStep, isActiveStatus, orderFlow, type MenuItem, type Order } from "../../../shared/ordering";
import { Alert } from "../../components/Field";
import { OrdersSkeleton } from "../../components/Skeletons";
import { ItemImage, ShopLayout } from "../../components/Shop";
import { apiGet, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDateTimeShort } from "../../lib/dates";
import { riyals, useMenu } from "../../lib/menu";
import { lineName, lineOptionName, statusLabel } from "../../lib/menuText";
import { tr } from "../../lib/i18n";

/** How far along the order is, for the small progress bar (0–100). */
function progress(o: Order): number {
  const i = Math.max(flowStep(o), 0);
  return Math.round(((i + 0.5) / orderFlow(o.fulfillment).length) * 100);
}

/**
 * Small overlapping photos of what was ordered, the first on top. At most
 * `max` tiles: when there are more items, the last tile is "+N" instead.
 */
function OrderThumbs({ order, items, max }: { order: Order; items: MenuItem[] | undefined; max: number }) {
  const seen = new Set<string>();
  const lines = order.items.filter((l) => !seen.has(l.menuItemId) && seen.add(l.menuItemId));
  const shown = lines.length > max ? lines.slice(0, max - 1) : lines;
  const more = lines.length - shown.length;
  return (
    <span className="order-thumbs" aria-hidden="true">
      {shown.map((l, i) => (
        <span key={l.menuItemId} className="order-thumbs__tile" style={{ zIndex: max - i }}>
          <ItemImage
            item={items?.find((m) => m.id === l.menuItemId) ?? { imageUrl: null, nameAr: l.nameAr, category: l.category }}
            className="order-thumbs__img"
          />
        </span>
      ))}
      {more > 0 && (
        <span className="order-thumbs__tile order-thumbs__more">
          <bdi dir="ltr">+{more}</bdi>
        </span>
      )}
    </span>
  );
}

export function OrdersPage() {
  const { session, loading } = useAuth();
  const { menu } = useMenu();
  const summary = (o: Order) =>
    o.items
      .map((i) => {
        const option = lineOptionName(i, menu?.items);
        return `${i.quantity}× ${lineName(i, menu?.items)}${option ? ` (${option})` : ""}`;
      })
      .join(tr("، ", ", "));
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      apiGet<{ items: Order[] }>("/api/orders")
        .then((r) => {
          setOrders(r.items);
          setError(null);
        })
        .catch((err: unknown) => setError(errorText(err))),
    [],
  );

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  if (loading) {
    return (
      <ShopLayout>
        <h1 className="page-title">{tr("طلباتي", "My orders")}</h1>
        <OrdersSkeleton />
      </ShopLayout>
    );
  }
  if (!session) return <Navigate to="/login?next=%2Forders" replace />;

  return (
    <ShopLayout onRefresh={load}>
      <h1 className="page-title">{tr("طلباتي", "My orders")}</h1>
      {error && <Alert tone="error">{error}</Alert>}
      {!orders && !error && <OrdersSkeleton />}
      {orders && orders.length === 0 && (
        <div className="empty">
          <img src="/brand/tent-espresso.png" alt="" className="empty__art" />
          <h2 className="empty__title">{tr("ما عندك طلبات للحين", "No orders yet")}</h2>
          <p className="empty__sub">{tr("أول طلب يضيف أكواب لبطاقتك.", "Your first order adds cups to your card.")}</p>
          <Link to="/menu" className="btn btn--primary">
            {tr("اطلب الآن", "Order now")}
          </Link>
        </div>
      )}
      {orders && orders.some((o) => isActiveStatus(o.status)) && (
        <section className="orders-group" aria-labelledby="orders-now">
          <h2 id="orders-now" className="orders-group__title">
            {tr("الحالي", "Current")}
          </h2>
          <ul className="order-list">
            {orders
              .filter((o) => isActiveStatus(o.status))
              .map((o) => (
                <li key={o.id}>
                  <Link to={`/orders/${o.id}`} className="order-live">
                    <span className="order-live__top">
                      <span className="order-live__id">
                        <OrderThumbs order={o} items={menu?.items} max={3} />
                        <span className="order-live__num" dir="ltr">
                          #{o.orderNumber}
                        </span>
                      </span>
                      <span className="order-live__status">{statusLabel(o)}</span>
                    </span>
                    <span className="order-live__bar" aria-hidden="true">
                      <i style={{ width: `${progress(o)}%` }} />
                    </span>
                    <span className="order-live__meta">
                      <span>{summary(o)}</span>
                      <span>{riyals(o.totalHalalas)}</span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}
      {orders && orders.some((o) => !isActiveStatus(o.status)) && (
        <section className="orders-group" aria-labelledby="orders-past">
          <h2 id="orders-past" className="orders-group__title">
            {tr("السابقة", "Past")}
          </h2>
          <ul className="order-list">
            {orders
              .filter((o) => !isActiveStatus(o.status))
              .map((o) => (
                <li key={o.id}>
                  <Link to={`/orders/${o.id}`} className="order-row">
                    <OrderThumbs order={o} items={menu?.items} max={2} />
                    <span className="order-row__main">
                      <span className="order-row__items">{summary(o)}</span>
                      <small>
                        <span dir="ltr">#{o.orderNumber}</span> · {formatDateTimeShort(o.createdAt)}
                      </small>
                    </span>
                    <span className="order-row__side">
                      <span className={`status-chip status-chip--${o.status}`}>{statusLabel(o)}</span>
                      <small>{riyals(o.totalHalalas)}</small>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}
    </ShopLayout>
  );
}
