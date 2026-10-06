import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { isActiveStatus, STATUS_LABELS_AR, type Order } from "../../../shared/ordering";
import { Alert, Spinner } from "../../components/Field";
import { ShopLayout } from "../../components/Shop";
import { apiGet, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDateTime } from "../../lib/dates";
import { riyals } from "../../lib/menu";

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
          <img src="/wallet-preview/cup-empty.png" alt="" className="empty__cup" />
          <p>ما عندك طلبات للحين</p>
          <Link to="/menu" className="btn btn--primary">
            اطلب الآن
          </Link>
        </div>
      )}
      {orders && orders.length > 0 && (
        <ul className="order-list">
          {orders.map((o) => (
            <li key={o.id}>
              <Link to={`/orders/${o.id}`} className={`order-row ${isActiveStatus(o.status) ? "order-row--active" : ""}`}>
                <span className="order-row__num" dir="ltr">
                  #{o.orderNumber}
                </span>
                <span className="order-row__main">
                  <span className="order-row__items">{o.items.map((i) => `${i.quantity}× ${i.nameAr}`).join("، ")}</span>
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
      )}
    </ShopLayout>
  );
}
