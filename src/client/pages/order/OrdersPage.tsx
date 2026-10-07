import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { isActiveStatus, orderFlow, type Order } from "../../../shared/ordering";
import { Alert } from "../../components/Field";
import { OrdersSkeleton } from "../../components/Skeletons";
import { ShopLayout } from "../../components/Shop";
import { apiGet, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDateTime } from "../../lib/dates";
import { riyals, useMenu } from "../../lib/menu";
import { lineName, lineOptionName, statusLabel } from "../../lib/menuText";
import { tr } from "../../lib/i18n";

/** How far along the order is, for the small progress bar (0–100). */
function progress(o: Order): number {
  const flow = orderFlow(o.fulfillment);
  const i = Math.max(flow.indexOf(o.status), 0);
  return Math.round(((i + 0.5) / flow.length) * 100);
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
                      <span className="order-live__num" dir="ltr">
                        #{o.orderNumber}
                      </span>
                      <span className="order-live__status">{statusLabel(o.status)}</span>
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
                    <span className="order-row__num" dir="ltr">
                      #{o.orderNumber}
                    </span>
                    <span className="order-row__main">
                      <span className="order-row__items">{summary(o)}</span>
                      <small>{formatDateTime(o.createdAt)}</small>
                    </span>
                    <span className="order-row__side">
                      <span className={`status-chip status-chip--${o.status}`}>{statusLabel(o.status)}</span>
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
