import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { FULFILLMENT_LABELS_AR, isActiveStatus, MAX_RATING_COMMENT, STATUS_LABELS_AR, type Order, type OrderStatus } from "../../../shared/ordering";
import { ConfirmDialog } from "../../components/Dialog";
import { Alert, Spinner } from "../../components/Field";
import { ShopLayout } from "../../components/Shop";
import { apiGet, apiPost, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { formatDateTime } from "../../lib/dates";
import { riyals } from "../../lib/menu";
import { animateTracker } from "../../lib/motion";

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
  const ticketRef = useRef<HTMLElement>(null);
  const cart = useCart();
  const navigate = useNavigate();
  const shownStep = useRef<{ id: string; index: number } | null>(null);

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

  // Play the tracker in on first open, then each time the café moves the order on.
  const stepIndex = order ? steps(order).findIndex((s) => s.status === order.status) : -1;
  useLayoutEffect(() => {
    if (!order || stepIndex < 0) return;
    const prev = shownStep.current?.id === order.id ? shownStep.current.index : -1;
    shownStep.current = { id: order.id, index: stepIndex };
    if (prev !== stepIndex) animateTracker(ticketRef.current, prev, stepIndex);
  }, [order, stepIndex]);

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
      <section ref={ticketRef} className={`ticket ${cancelled ? "ticket--cancelled" : ""}`} aria-live="polite">
        <div className="ticket__band">
          <span className="ticket__sheen" aria-hidden="true" />
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
                <span className="steps__label">{s.label}</span>
                {i < flow.length - 1 && (
                  <span className="steps__line" aria-hidden="true">
                    <i />
                  </span>
                )}
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

      {order.status === "completed" && <RateOrder order={order} onRated={setOrder} />}

      <section className="sheet">
        <h2 className="pass-label">{FULFILLMENT_LABELS_AR[order.fulfillment]}</h2>
        {order.fulfillment === "delivery" && <p className="muted">{order.deliveryAddress}</p>}
        <ul className="receipt">
          {order.items.map((line, i) => (
            <li key={i}>
              <span>
                {line.quantity} × {line.nameAr}
                {line.optionNameAr && <small className="receipt__option">{line.optionNameAr}</small>}
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
      {!active && order.items.length > 0 && (
        <button
          type="button"
          className="btn btn--primary btn--block btn--lg reorder-btn"
          onClick={() => {
            // Same drinks, same notes; the cart flags anything no longer available.
            for (const line of order.items) {
              cart.add(line.menuItemId, line.optionId, line.quantity);
              if (line.note) cart.setNote(line.menuItemId, line.note, line.optionId);
            }
            void navigate("/cart");
          }}
        >
          <RepeatIcon />
          اطلب نفس الطلب مرة ثانية
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

const STAR_LABELS = ["سيئ", "مقبول", "جيد", "ممتاز", "رائع"];

/** Stars and an optional comment, once the order is completed; read-only after. */
function RateOrder({ order, onRated }: { order: Order; onRated: (o: Order) => void }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (order.rating !== null) {
    return (
      <section className="sheet rate rate--done" aria-label="تقييمك">
        <Stars value={order.rating} />
        <p>شكرًا على تقييمك!</p>
        {order.ratingComment && <p className="muted small">«{order.ratingComment}»</p>}
      </section>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body = { rating: stars, comment: comment.trim() || undefined };
      onRated((await apiPost<{ order: Order }>(`/api/orders/${order.id}/rate`, body)).order);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sheet rate" aria-labelledby="rate-title">
      <h2 id="rate-title" className="rate__title">
        كيف كان طلبك؟
      </h2>
      <div className="rate__stars" role="radiogroup" aria-label="التقييم">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={stars === v}
            aria-label={`${v} من 5، ${STAR_LABELS[v - 1]}`}
            className={`rate__star ${v <= stars ? "is-on" : ""}`}
            onClick={() => setStars(v)}
          >
            <StarIcon />
          </button>
        ))}
      </div>
      {stars > 0 && (
        <>
          <p className="rate__label">{STAR_LABELS[stars - 1]}</p>
          <textarea
            className="rate__comment"
            rows={2}
            maxLength={MAX_RATING_COMMENT}
            placeholder="تبي تضيف ملاحظة؟ (اختياري)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {error && <Alert tone="error">{error}</Alert>}
          <button type="button" className="btn btn--primary btn--block" onClick={() => void submit()} disabled={busy}>
            {busy ? "جارٍ الإرسال…" : "أرسل التقييم"}
          </button>
        </>
      )}
    </section>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <div className="rate__stars rate__stars--static" aria-label={`${value} من 5`}>
      {[1, 2, 3, 4, 5].map((v) => (
        <span key={v} className={`rate__star ${v <= value ? "is-on" : ""}`} aria-hidden="true">
          <StarIcon />
        </span>
      ))}
    </div>
  );
}

function StarIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.8l2.83 5.73 6.32.92-4.58 4.46 1.08 6.3L12 17.2l-5.65 3 1.08-6.3-4.58-4.46 6.32-.92z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 2l3 3-3 3" />
      <path d="M4 11V9a4 4 0 0 1 4-4h12" />
      <path d="M7 22l-3-3 3-3" />
      <path d="M20 13v2a4 4 0 0 1-4 4H4" />
    </svg>
  );
}
