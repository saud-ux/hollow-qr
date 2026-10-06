import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { FULFILLMENT_LABELS_AR, isActiveStatus, STATUS_LABELS_AR, type Order, type OrderStatus } from "../../../shared/ordering";
import { ConfirmDialog } from "../../components/Dialog";
import { Alert, Spinner } from "../../components/Field";
import { ShopLayout } from "../../components/Shop";
import { apiGet, apiPost, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDateTime } from "../../lib/dates";
import { riyals } from "../../lib/menu";

const POLL_MS = 8_000;

function steps(order: Order): { status: OrderStatus; label: string }[] {
  const base: { status: OrderStatus; label: string }[] = [
    { status: "new", label: "استلمنا طلبك" },
    { status: "preparing", label: "قيد التحضير" },
    { status: "ready", label: order.fulfillment === "delivery" ? "جاهز" : order.fulfillment === "curbside" ? "جاهز، نطلعه لك" : "جاهز للاستلام" },
  ];
  if (order.fulfillment === "delivery") base.push({ status: "out_for_delivery", label: "في الطريق إليك" });
  base.push({ status: "completed", label: "تم التسليم" });
  return base;
}

/** What the customer should do / know right now. */
function headline(order: Order): string {
  switch (order.status) {
    case "new":
      return "وصل طلبك للكوفي، بننتظر تأكيده";
    case "preparing":
      return "نحضّر طلبك الآن";
    case "ready":
      return order.fulfillment === "pickup"
        ? "طلبك جاهز، استلمه من الكاشير"
        : order.fulfillment === "curbside"
          ? "طلبك جاهز، اضغط «وصلت» إذا كنت عند الكوفي"
          : "طلبك جاهز وبيطلع مع المندوب";
    case "out_for_delivery":
      return "المندوب في الطريق إليك";
    case "completed":
      return "بالعافية! تم تسليم طلبك";
    case "cancelled":
      return order.cancelledBy === "customer" ? "ألغيت هذا الطلب" : "تم إلغاء الطلب من الكوفي";
  }
}

export function OrderPage() {
  const { id = "" } = useParams();
  const { session, loading, refreshMe } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(
    () =>
      apiGet<{ order: Order }>(`/api/orders/${id}`)
        .then(({ order: o }) => {
          setOrder((prev) => {
            // Cups land on the card when the order is completed.
            if (prev && prev.status !== "completed" && o.status === "completed") void refreshMe();
            return o;
          });
          setError(null);
        })
        .catch((err: unknown) => setError(errorText(err))),
    [id, refreshMe],
  );

  useEffect(() => {
    if (!session) return;
    void load();
  }, [session, load]);

  const active = order ? isActiveStatus(order.status) : false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, load]);

  if (loading) {
    return (
      <ShopLayout>
        <Spinner />
      </ShopLayout>
    );
  }
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(`/orders/${id}`)}`} replace />;

  async function action(kind: "cancel" | "arrived") {
    setBusy(true);
    try {
      const { order: o } = await apiPost<{ order: Order }>(`/api/orders/${id}/${kind}`);
      setOrder(o);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  }

  if (!order) {
    return (
      <ShopLayout>
        {error ? <Alert tone="error">{error}</Alert> : <Spinner />}
      </ShopLayout>
    );
  }

  const flow = steps(order);
  const currentIndex = flow.findIndex((s) => s.status === order.status);
  const cancelled = order.status === "cancelled";

  return (
    <ShopLayout>
      <section className={`ticket ${cancelled ? "ticket--cancelled" : ""}`} aria-live="polite">
        <div className="ticket__band">
          <span className="pass-label pass-label--light">طلب رقم</span>
          <span className="ticket__number" dir="ltr">
            #{order.orderNumber}
          </span>
          <span className="ticket__status">{STATUS_LABELS_AR[order.status]}</span>
        </div>
        <p className="ticket__headline">{headline(order)}</p>
        {!cancelled && (
          <ol className="steps">
            {flow.map((s, i) => (
              <li key={s.status} className={`steps__item ${i < currentIndex ? "is-done" : ""} ${i === currentIndex ? "is-current" : ""}`}>
                <span className="steps__dot" aria-hidden="true" />
                <span>{s.label}</span>
              </li>
            ))}
          </ol>
        )}
        {order.cancelReason && <p className="ticket__note">السبب: {order.cancelReason}</p>}
      </section>

      {error && <Alert tone="error">{error}</Alert>}

      {order.fulfillment === "curbside" && active && (
        <section className="sheet sheet--dark arrive">
          {order.customerArrivedAt ? (
            <p>
              <strong>أبلغنا الموظف بوصولك</strong>
              <small>بنطلع لك الطلب عند السيارة ({order.carDescription})</small>
            </p>
          ) : (
            <>
              <p>
                <strong>وصلت عند الكوفي؟</strong>
                <small>اضغط الزر ونطلع لك الطلب عند السيارة ({order.carDescription})</small>
              </p>
              <button type="button" className="btn btn--reward btn--block btn--lg" onClick={() => void action("arrived")} disabled={busy}>
                وصلت
              </button>
            </>
          )}
        </section>
      )}

      {order.status === "completed" && order.loyaltyResult && order.loyaltyResult.cupsAdded + (order.loyaltyResult.redeem === "REDEEMED" ? 1 : 0) > 0 && (
        <Link to="/wallet" className="sheet loyalty-note">
          <img src="/wallet-preview/cup-filled.png" alt="" />
          <span>
            {order.loyaltyResult.redeem === "REDEEMED" && "استخدمت مشروبك المجاني. "}
            {order.loyaltyResult.cupsAdded > 0 &&
              (order.loyaltyResult.cupsAdded === 1 ? "أضفنا كوبًا لبطاقتك" : `أضفنا ${order.loyaltyResult.cupsAdded} أكواب لبطاقتك`)}
          </span>
        </Link>
      )}

      <section className="sheet">
        <h2 className="pass-label">{FULFILLMENT_LABELS_AR[order.fulfillment]}</h2>
        {order.fulfillment === "delivery" && <p className="muted">{order.deliveryAddress}</p>}
        <ul className="receipt">
          {order.items.map((line, i) => (
            <li key={i}>
              <span>
                {line.quantity} × {line.nameAr}
                {line.note && <small className="receipt__note">{line.note}</small>}
              </span>
              <span>{riyals(line.unitPriceHalalas * line.quantity)}</span>
            </li>
          ))}
        </ul>
        {order.note && <p className="receipt__note">ملاحظة: {order.note}</p>}
        <div className="summary">
          {order.deliveryFeeHalalas > 0 && (
            <div className="summary__row">
              <span>التوصيل</span>
              <span>{riyals(order.deliveryFeeHalalas)}</span>
            </div>
          )}
          {order.discountHalalas > 0 && (
            <div className="summary__row summary__row--reward">
              <span>المشروب المجاني</span>
              <span>− {riyals(order.discountHalalas)}</span>
            </div>
          )}
          <div className="summary__row summary__row--total">
            <span>الإجمالي</span>
            <span>{riyals(order.totalHalalas)}</span>
          </div>
          <p className="summary__pay">الدفع عند الاستلام · {formatDateTime(order.createdAt)}</p>
        </div>
      </section>

      {order.status === "new" && (
        <button type="button" className="btn btn--ghost btn--block" onClick={() => setConfirmCancel(true)} disabled={busy}>
          إلغاء الطلب
        </button>
      )}
      <Link to="/menu" className="btn btn--secondary btn--block">
        طلب جديد
      </Link>

      <ConfirmDialog
        open={confirmCancel}
        tone="danger"
        title="إلغاء الطلب؟"
        message={<p>تقدر تلغي الطلب قبل ما نبدأ تحضيره فقط.</p>}
        confirmLabel="نعم، ألغِ الطلب"
        busy={busy}
        onConfirm={() => void action("cancel")}
        onCancel={() => setConfirmCancel(false)}
      />
    </ShopLayout>
  );
}
