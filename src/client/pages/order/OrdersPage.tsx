import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { isActiveStatus, STATUS_LABELS_AR, type Order, type OrderStatus } from "../../../shared/ordering";
import { Alert, Spinner } from "../../components/Field";
import { ShopLayout } from "../../components/Shop";
import { apiGet, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDateTime } from "../../lib/dates";
import { riyals } from "../../lib/menu";

const FLOW: Record<"pickup" | "curbside" | "delivery", OrderStatus[]> = {
  pickup: ["new", "preparing", "ready", "completed"],
  curbside: ["new", "preparing", "ready", "completed"],
  delivery: ["new", "preparing", "ready", "out_for_delivery", "completed"],
};

/** How far along the order is, for the small progress bar (0–100). */
function progress(o: Order): number {
  const flow = FLOW[o.fulfillment];
  const i = Math.max(flow.indexOf(o.status), 0);
  return Math.round(((i + 0.5) / flow.length) * 100);
}

export function OrdersPage() {
  const { session, loading } = useAuth();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    apiGet<{ items: Order[] }>("/api/orders")
      .then((r) => setOrders(r.items))
      .catch((err: unknown) => setError(errorText(err)));
  }, [session]);

  if (loading) {
    return (
      <ShopLayout>
        <Spinner />
      </ShopLayout>
    );
  }
  if (!session) return <Navigate to="/login?next=%2Forders" replace />;

  return (
    <ShopLayout>
      <h1 className="page-title">طلباتي</h1>
      {error && <Alert tone="error">{error}</Alert>}
      {!orders && !error && <Spinner />}
      {orders && orders.length === 0 && (
        <div className="empty">
          <img src="/brand/tent-espresso.png" alt="" className="empty__art" />
          <h2 className="empty__title">ما عندك طلبات للحين</h2>
          <p className="empty__sub">أول طلب يضيف أكواب لبطاقتك.</p>
          <Link to="/menu" className="btn btn--primary">
            اطلب الآن
          </Link>
        </div>
      )}
      {orders && orders.some((o) => isActiveStatus(o.status)) && (
        <section className="orders-group" aria-labelledby="orders-now">
          <h2 id="orders-now" className="orders-group__title">
            الحالي
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
                      <span className="order-live__status">{STATUS_LABELS_AR[o.status]}</span>
                    </span>
                    <span className="order-live__bar" aria-hidden="true">
                      <i style={{ width: `${progress(o)}%` }} />
                    </span>
                    <span className="order-live__meta">
                      <span>{o.items.map((i) => `${i.quantity}× ${i.nameAr}${i.optionNameAr ? ` (${i.optionNameAr})` : ""}`).join("، ")}</span>
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
            السابقة
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
                      <span className="order-row__items">{o.items.map((i) => `${i.quantity}× ${i.nameAr}${i.optionNameAr ? ` (${i.optionNameAr})` : ""}`).join("، ")}</span>
                      <small>{formatDateTime(o.createdAt)}</small>
                    </span>
                    <span className="order-row__side">
                      <span className={`status-chip status-chip--${o.status}`}>{STATUS_LABELS_AR[o.status]}</span>
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
