import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { flowStep, isActiveStatus, MAX_RATING_COMMENT, orderFlow, type Order, type OrderStatus } from "../../../shared/ordering";
import { ConfirmDialog } from "../../components/Dialog";
import { OffersPrompt } from "../../components/OffersPrompt";
import { Alert } from "../../components/Field";
import { TicketSkeleton } from "../../components/Skeletons";
import { ShopLayout } from "../../components/Shop";
import { apiGet, apiPost, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { formatDateTime } from "../../lib/dates";
import { riyals, useMenu } from "../../lib/menu";
import { fulfillmentLabel, lineName, lineOptionName, statusLabel } from "../../lib/menuText";
import { animateTracker, serveCup } from "../../lib/motion";
import { successFeedback } from "../../lib/native";
import { endOrderOnLockScreen, refreshWidget, trackOrderOnLockScreen } from "../../lib/widget";
import { tr } from "../../lib/i18n";

const POLL_MS = 8_000;

/** The tracker's steps: pickup ends "Picked up"; delivery goes received, preparing, out for delivery, delivered. */
function steps(order: Order): { status: OrderStatus; label: string }[] {
  return orderFlow(order.fulfillment).map((status) => ({ status, label: statusLabel({ status, fulfillment: order.fulfillment }) }));
}

/** The ready moment (steaming cup) is for orders the customer collects. */
const isCollectReady = (order: Order) => order.status === "ready" && order.fulfillment !== "delivery";

/** What the customer should do / know right now. */
function headline(order: Order): string {
  switch (order.status) {
    case "new":
      return tr("وصل طلبك للكوفي، بننتظر تأكيده", "Your order reached the café, waiting for them to confirm");
    case "preparing":
      return tr("نحضّر طلبك الآن", "We're preparing your order");
    case "ready":
      return order.fulfillment === "pickup"
        ? tr("طلبك جاهز، استلمه من الكاشير", "Your order is ready, pick it up at the counter")
        : order.fulfillment === "curbside"
          ? tr("طلبك جاهز، اضغط «وصلت» إذا كنت عند الكوفي", "Your order is ready. Tap \"I'm here\" when you're outside")
          : tr("نجهّز طلبك للمندوب، وبيطلع لك قريبًا", "Getting your order ready for the driver, it'll be on its way soon");
    case "out_for_delivery":
      return tr("المندوب في الطريق إليك", "The driver is on the way");
    case "completed":
      return tr("بالعافية! تم تسليم طلبك", "Enjoy! Your order is complete");
    case "cancelled":
      return order.cancelledBy === "customer" ? tr("ألغيت هذا الطلب", "You cancelled this order") : tr("تم إلغاء الطلب من الكوفي", "The café cancelled this order");
  }
}

/** The HOLLOW cup, steaming, on a ready order. */
function ReadyCup() {
  return (
    <div className="ready-cup" aria-hidden="true">
      <svg className="ready-cup__steam" viewBox="0 0 70 38">
        <path d="M23 36 C17 28 29 20 23 8" />
        <path d="M35 34 C29 24 41 16 35 2" />
        <path d="M47 36 C41 28 53 20 47 8" />
      </svg>
      <img className="ready-cup__img" src="/wallet-preview/cup-open.png" alt="" width={66} height={78} />
      <svg className="ready-cup__badge" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="14" />
        <path d="M10 16.5 L14.2 20.5 L22 12" pathLength={1} />
      </svg>
    </div>
  );
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
  const { menu } = useMenu();
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
  const stepIndex = order ? flowStep(order) : -1;
  useLayoutEffect(() => {
    if (!order || stepIndex < 0) return;
    const prev = shownStep.current?.id === order.id ? shownStep.current.index : -1;
    shownStep.current = { id: order.id, index: stepIndex };
    if (prev === stepIndex) return;
    animateTracker(ticketRef.current, prev, stepIndex);
    if (isCollectReady(order)) {
      serveCup(ticketRef.current);
      // Turned ready while the customer is watching: a tap they can feel.
      if (prev >= 0) successFeedback();
    }
  }, [order, stepIndex]);

  // iOS app: the order on the lock screen and on the home-screen widget.
  const orderStatus = order?.status;
  useEffect(() => {
    if (!order || !orderStatus) return;
    if (isActiveStatus(orderStatus)) void trackOrderOnLockScreen(order);
    else endOrderOnLockScreen(order.id);
    void refreshWidget();
    // Only when the order or its status changes, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, orderStatus]);

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
        <TicketSkeleton />
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
        {error ? <Alert tone="error">{error}</Alert> : <TicketSkeleton />}
      </ShopLayout>
    );
  }

  const flow = steps(order);
  const currentIndex = flowStep(order);
  const cancelled = order.status === "cancelled";

  return (
    <ShopLayout onRefresh={load}>
      <section ref={ticketRef} className={`ticket ${cancelled ? "ticket--cancelled" : ""}`} aria-live="polite">
        <div className="ticket__band">
          <span className="ticket__sheen" aria-hidden="true" />
          <span className="pass-label pass-label--light">{tr("طلب رقم", "Order")}</span>
          <span className="ticket__number" dir="ltr">
            #{order.orderNumber}
          </span>
          <span className="ticket__status">{statusLabel(order)}</span>
        </div>
        {isCollectReady(order) && <ReadyCup />}
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
        {order.cancelReason && <p className="ticket__note">{tr(`السبب: ${order.cancelReason}`, `Reason: ${order.cancelReason}`)}</p>}
      </section>

      {error && <Alert tone="error">{error}</Alert>}

      {order.fulfillment === "curbside" && active && (
        <section className="sheet sheet--dark arrive">
          {order.customerArrivedAt ? (
            <p>
              <strong>{tr("أبلغنا الموظف بوصولك", "We told the staff you're here")}</strong>
              <small>{tr(`بنطلع لك الطلب عند السيارة (${order.carDescription})`, `We'll bring it to your car (${order.carDescription})`)}</small>
            </p>
          ) : (
            <>
              <p>
                <strong>{tr("وصلت عند الكوفي؟", "Outside the café?")}</strong>
                <small>{tr(`اضغط الزر ونطلع لك الطلب عند السيارة (${order.carDescription})`, `Tap the button and we'll bring it to your car (${order.carDescription})`)}</small>
              </p>
              <button type="button" className="btn btn--reward btn--block btn--lg" onClick={() => void action("arrived")} disabled={busy}>
                {tr("وصلت", "I'm here")}
              </button>
            </>
          )}
        </section>
      )}

      {order.status === "completed" && order.loyaltyResult && order.loyaltyResult.cupsAdded + (order.loyaltyResult.redeem === "REDEEMED" ? 1 : 0) > 0 && (
        <Link to="/wallet" className="sheet loyalty-note">
          <img src="/wallet-preview/cup-filled.png" alt="" />
          <span>
            {order.loyaltyResult.redeem === "REDEEMED" && tr("استخدمت مشروبك المجاني. ", "You used your free drink. ")}
            {order.loyaltyResult.cupsAdded > 0 &&
              (order.loyaltyResult.cupsAdded === 1
                ? tr("أضفنا كوبًا لبطاقتك", "We added a cup to your card")
                : tr(`أضفنا ${order.loyaltyResult.cupsAdded} أكواب لبطاقتك`, `We added ${order.loyaltyResult.cupsAdded} cups to your card`))}
          </span>
        </Link>
      )}

      {order.status === "completed" && <RateOrder order={order} onRated={setOrder} />}
      {order.status !== "cancelled" && <OffersPrompt />}

      <section className="sheet">
        <h2 className="pass-label">{fulfillmentLabel(order.fulfillment)}</h2>
        {order.fulfillment === "delivery" && <p className="muted">{order.deliveryAddress}</p>}
        <ul className="receipt">
          {order.items.map((line, i) => (
            <li key={i}>
              <span>
                {line.quantity} × {lineName(line, menu?.items)}
                {line.optionNameAr && <small className="receipt__option">{lineOptionName(line, menu?.items)}</small>}
                {line.note && <small className="receipt__note">{line.note}</small>}
              </span>
              <span className="sale-price">
                <span className={line.listPriceHalalas !== null ? "price-now price-now--sale" : "price-now"}>{riyals(line.unitPriceHalalas * line.quantity)}</span>
                {line.listPriceHalalas !== null && <s className="price-was">{riyals(line.listPriceHalalas * line.quantity)}</s>}
              </span>
            </li>
          ))}
        </ul>
        {order.note && <p className="receipt__note">{tr(`ملاحظة: ${order.note}`, `Note: ${order.note}`)}</p>}
        <div className="summary">
          {order.deliveryFeeHalalas > 0 && (
            <div className="summary__row">
              <span>{tr("التوصيل", "Delivery")}</span>
              <span>{riyals(order.deliveryFeeHalalas)}</span>
            </div>
          )}
          {order.discountHalalas > 0 && (
            <div className="summary__row summary__row--reward">
              <span>{tr("المشروب المجاني", "Free drink")}</span>
              <span>− {riyals(order.discountHalalas)}</span>
            </div>
          )}
          <div className="summary__row summary__row--total">
            <span>{tr("الإجمالي", "Total")}</span>
            <span>{riyals(order.totalHalalas)}</span>
          </div>
          {order.promoSavingsHalalas > 0 && (
            <p className="summary__saved">
              {tr(`وفّرت ${riyals(order.promoSavingsHalalas)} مع خصم ${order.promoPercent}%`, `You saved ${riyals(order.promoSavingsHalalas)} with ${order.promoPercent}% off`)}
            </p>
          )}
          <p className="summary__pay">{tr("الدفع عند الاستلام", "Pay on pickup")} · {formatDateTime(order.createdAt)}</p>
        </div>
      </section>

      {order.status === "new" && (
        <button type="button" className="btn btn--ghost btn--block" onClick={() => setConfirmCancel(true)} disabled={busy}>
          {tr("إلغاء الطلب", "Cancel order")}
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
          {tr("اطلب نفس الطلب مرة ثانية", "Order this again")}
        </button>
      )}
      <Link to="/menu" className="btn btn--secondary btn--block">
        {tr("طلب جديد", "New order")}
      </Link>

      <ConfirmDialog
        open={confirmCancel}
        tone="danger"
        title={tr("إلغاء الطلب؟", "Cancel this order?")}
        message={<p>{tr("تقدر تلغي الطلب قبل ما نبدأ تحضيره فقط.", "You can cancel only before we start preparing it.")}</p>}
        confirmLabel={tr("نعم، ألغِ الطلب", "Yes, cancel it")}
        busy={busy}
        onConfirm={() => void action("cancel")}
        onCancel={() => setConfirmCancel(false)}
      />
    </ShopLayout>
  );
}

const STAR_LABELS_AR = ["سيئ", "مقبول", "جيد", "ممتاز", "رائع"];
const STAR_LABELS_EN = ["Bad", "Okay", "Good", "Great", "Amazing"];
const starLabel = (v: number) => tr(STAR_LABELS_AR[v - 1] ?? "", STAR_LABELS_EN[v - 1] ?? "");

/** Stars and an optional comment, once the order is completed; read-only after. */
function RateOrder({ order, onRated }: { order: Order; onRated: (o: Order) => void }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (order.rating !== null) {
    return (
      <section className="sheet rate rate--done" aria-label={tr("تقييمك", "Your rating")}>
        <Stars value={order.rating} />
        <p>{tr("شكرًا على تقييمك!", "Thanks for your rating!")}</p>
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
        {tr("كيف كان طلبك؟", "How was your order?")}
      </h2>
      <div className="rate__stars" role="radiogroup" aria-label={tr("التقييم", "Rating")}>
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={stars === v}
            aria-label={tr(`${v} من 5، ${starLabel(v)}`, `${v} of 5, ${starLabel(v)}`)}
            className={`rate__star ${v <= stars ? "is-on" : ""}`}
            onClick={() => setStars(v)}
          >
            <StarIcon />
          </button>
        ))}
      </div>
      {stars > 0 && (
        <>
          <p className="rate__label">{starLabel(stars)}</p>
          <textarea
            className="rate__comment"
            rows={2}
            maxLength={MAX_RATING_COMMENT}
            placeholder={tr("تبي تضيف ملاحظة؟ (اختياري)", "Anything to add? (optional)")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {error && <Alert tone="error">{error}</Alert>}
          <button type="button" className="btn btn--primary btn--block" onClick={() => void submit()} disabled={busy}>
            {busy ? tr("جارٍ الإرسال…", "Sending…") : tr("أرسل التقييم", "Send rating")}
          </button>
        </>
      )}
    </section>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <div className="rate__stars rate__stars--static" aria-label={tr(`${value} من 5`, `${value} of 5`)}>
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
