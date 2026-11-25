import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  FULFILLMENT_LABELS_AR,
  isActiveStatus,
  nextStatus,
  ORDER_LATE_MINUTES,
  ORDER_WARN_MINUTES,
  orderUrgency,
  rewardDiscount,
  STATUS_LABELS_AR,
  type Order,
  type OrderStatus,
  type ShopSettings,
} from "../../../shared/ordering";
import { Dialog } from "../../components/Dialog";
import { Alert, Spinner } from "../../components/Field";
import { AvailabilityList } from "../../components/Availability";
import { CarIcon, ScooterIcon, StoreIcon } from "../../components/Shop";
import { CarDescription } from "../../components/CarPlate";
import { StaffLayout } from "../../components/StaffLayout";
import { apiGet, apiPost, errorText } from "../../lib/api";
import { isAudioReady, keepAudioAlive, onAudioChange, orderChime, primeAudio } from "../../lib/feedback";
import { riyals, useMenu } from "../../lib/menu";
import { lineNameEn } from "../../lib/menuText";
import { isNative, keepScreenAwake } from "../../lib/native";
import { installStaffApp, isInstalledApp, useCanInstall } from "../../lib/staffApp";
import { animateBoard, newBoardMemory } from "../../lib/motion";

const POLL_MS = 5_000;
/** The ticket clocks move on even when a poll fails. */
const CLOCK_MS = 15_000;

/** Orders still in the shop's hands: colour them as they wait. Ready ones are waiting on the customer. */
const urgencyOf = (o: Order, now: number) => (o.status === "new" || o.status === "preparing" ? orderUrgency(o.createdAt, now) : "ok");

type Board = { items: Order[]; shop: { isOpen: boolean; settings: ShopSettings } };

const ACTION_LABELS: Record<OrderStatus, string> = {
  new: "",
  preparing: "قبول وبدء التحضير",
  ready: "جاهز",
  out_for_delivery: "خرج للتوصيل",
  completed: "تم التسليم",
  cancelled: "",
};

const COLUMNS: { key: string; title: string; statuses: OrderStatus[] }[] = [
  { key: "new", title: "جديدة", statuses: ["new"] },
  { key: "preparing", title: "قيد التحضير", statuses: ["preparing"] },
  { key: "ready", title: "جاهزة", statuses: ["ready", "out_for_delivery"] },
];

function minutesAgo(iso: string, now: number): string {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  return m === 0 ? "الآن" : `منذ ${m} د`;
}

function mapsUrl(o: Order): string | null {
  if (o.deliveryLat === null || o.deliveryLng === null) return null;
  return `https://maps.google.com/?q=${o.deliveryLat},${o.deliveryLng}`;
}

/**
 * Keeps the screen awake while the board is open, so the device never sleeps
 * and silences the chime: natively in the iOS app, with the Wake Lock API on
 * the website. Chrome (Android) grants the lock straight away; a browser that
 * wants a tap first gets asked again on the next touch.
 */
function useWakeLock() {
  useEffect(() => {
    keepScreenAwake(true);
    return () => keepScreenAwake(false);
  }, []);
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      if (lock && !lock.released) return;
      navigator.wakeLock
        .request("screen")
        .then((l) => (lock = l))
        .catch(() => undefined);
    };
    acquire();
    const onVisible = () => document.visibilityState === "visible" && acquire();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointerdown", acquire, { passive: true });
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", acquire);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

export function StaffOrdersPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The sound is always on: any tap on the page unlocks it (browsers need one),
  // and it comes back by itself after the iPad sleeps.
  const soundOn = useSyncExternalStore(onAudioChange, isAudioReady, () => false);
  const [tab, setTab] = useState("new");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<string> | null>(null);
  const [stockOpen, setStockOpen] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const boardMemory = useRef(newBoardMemory());

  useWakeLock();
  useEffect(() => keepAudioAlive(), []);

  // New orders slide in; a ticket that changes column glides across.
  useLayoutEffect(() => animateBoard(boardRef.current, boardMemory.current), [board]);
  useLayoutEffect(() => animateBoard(boardRef.current, boardMemory.current, true), [tab]);
  useEffect(() => {
    const remeasure = () => animateBoard(boardRef.current, boardMemory.current, true);
    window.addEventListener("resize", remeasure);
    return () => window.removeEventListener("resize", remeasure);
  }, []);

  const load = useCallback(
    () =>
      apiGet<Board>("/api/staff/orders")
        .then((b) => {
          setBoard(b);
          setError(null);
          setNow(Date.now());
          // One chime for each order that wasn't on the board before.
          const firstLoad = seen.current === null;
          const fresh = b.items.some((o) => o.status === "new" && !seen.current?.has(o.id));
          seen.current = new Set([...(seen.current ?? []), ...b.items.map((o) => o.id)]);
          if (fresh && !firstLoad) orderChime();
        })
        .catch((err: unknown) => setError(errorText(err))),
    [],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [load]);

  const newCount = board?.items.filter((o) => o.status === "new").length ?? 0;
  useEffect(() => {
    const base = "طلبات HOLLOW";
    document.title = newCount > 0 ? `(${newCount}) طلب جديد · ${base}` : base;
    return () => {
      document.title = "HOLLOW Rewards";
    };
  }, [newCount]);

  /** Unlocks the sound if needed and plays the alert, to check the volume. */
  function testSound() {
    primeAudio();
    orderChime();
  }

  async function move(order: Order, status: OrderStatus, cancelReason?: string) {
    setBusyId(order.id);
    try {
      const { order: updated } = await apiPost<{ order: Order }>(`/api/staff/orders/${order.id}/status`, { status, cancelReason });
      setBoard((b) => (b ? { ...b, items: b.items.map((o) => (o.id === updated.id ? updated : o)) } : b));
      const lr = updated.loyaltyResult;
      if (status === "completed" && lr && !lr.skipped) {
        const parts: string[] = [];
        if (lr.redeem === "REDEEMED") parts.push("استُخدم المشروب المجاني");
        if (lr.cupsAdded > 0) parts.push(lr.cupsAdded === 1 ? "أضيف كوب لبطاقة العميل" : `أضيف ${lr.cupsAdded} أكواب لبطاقة العميل`);
        if (lr.redeem && lr.redeem !== "REDEEMED") {
          setToast({ tone: "warning", text: `طلب ${updated.orderNumber}: المشروب المجاني كان مستخدمًا من قبل، تحقق من الدفع` });
        } else if (parts.length) {
          setToast({ tone: "success", text: `طلب ${updated.orderNumber}: ${parts.join("، ")}` });
        }
      }
    } catch (err) {
      setToast({ tone: "warning", text: errorText(err) });
      void load();
    } finally {
      setBusyId(null);
    }
  }

  async function togglePause() {
    if (!board) return;
    try {
      const res = await apiPost<{ isOpen: boolean; settings: ShopSettings }>("/api/staff/shop/pause", {
        paused: !board.shop.settings.orderingPaused,
      });
      setBoard({ ...board, shop: { isOpen: res.isOpen, settings: res.settings } });
    } catch (err) {
      setToast({ tone: "warning", text: errorText(err) });
    }
  }

  const active = board?.items.filter((o) => isActiveStatus(o.status)) ?? [];
  const recent = board?.items.filter((o) => !isActiveStatus(o.status)) ?? [];

  return (
    <StaffLayout title="الطلبات" wide>
      <div className="orders-workspace">
      <div className="orders-toolbar">
        <div className="orders-toolbar__status">
          <div className={`shop-state ${board?.shop.isOpen ? "shop-state--open" : ""}`}>
            <span className="shop-state__dot" aria-hidden="true" />
            {board ? (board.shop.isOpen ? "نستقبل الطلبات" : board.shop.settings.orderingPaused ? "الطلبات متوقفة" : "خارج أوقات الدوام") : "…"}
          </div>
          <button type="button" className={`orders-sound ${soundOn ? "is-on" : ""}`} onClick={testSound} aria-label={soundOn ? "الصوت شغّال، اضغط لتجربة التنبيه" : "تشغيل صوت تنبيه الطلبات"}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></svg>
            {soundOn ? <>الصوت شغّال <small>· تجربة</small></> : "تشغيل الصوت"}
          </button>
        </div>
        {board && <div className="orders-toolbar__actions">
          <button type="button" className="btn btn--secondary" onClick={() => setStockOpen(true)}>المتوفر والكميات</button>
          <button type="button" className={`btn ${board.shop.settings.orderingPaused ? "btn--primary" : "btn--secondary"}`} onClick={() => void togglePause()}>
            {board.shop.settings.orderingPaused ? "استئناف الطلبات" : "إيقاف مؤقت"}
          </button>
        </div>}
      </div>

      {!soundOn && <SoundGate onTap={testSound} />}
      {error && <Alert tone="error">{error}</Alert>}
      {toast && (
        <div className={`board-toast board-toast--${toast.tone}`} role="status" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
      {!board && !error && <Spinner />}

      {board && (
        <>
          <div className="board-tabs" role="tablist" aria-label="حالة الطلبات">
            {COLUMNS.map((c) => {
              const inTab = active.filter((o) => c.statuses.includes(o.status));
              const n = inTab.length;
              const late = inTab.filter((o) => urgencyOf(o, now) === "late").length;
              return (
                <button key={c.key} id={`orders-tab-${c.key}`} type="button" role="tab" aria-selected={tab === c.key} aria-controls={`orders-panel-${c.key}`} tabIndex={tab === c.key ? 0 : -1} className={`board-tab ${tab === c.key ? "is-on" : ""}`} onClick={() => setTab(c.key)}
                  onKeyDown={(e) => {
                    const index = COLUMNS.indexOf(c);
                    let next: number;
                    const rtl = document.documentElement.dir !== "ltr";
                    if (e.key === "Home") next = 0;
                    else if (e.key === "End") next = COLUMNS.length - 1;
                    else if (e.key === "ArrowLeft") next = (index + (rtl ? 1 : 2)) % COLUMNS.length;
                    else if (e.key === "ArrowRight") next = (index + (rtl ? 2 : 1)) % COLUMNS.length;
                    else return;
                    e.preventDefault();
                    const key = COLUMNS[next]!.key;
                    setTab(key);
                    document.getElementById(`orders-tab-${key}`)?.focus();
                  }}>
                  {c.title}
                  <span className={`board-tab__count ${late > 0 ? "is-late" : c.key === "new" && n > 0 ? "is-hot" : ""}`}>{n}</span>
                  {late > 0 && <span className="visually-hidden">، {late === 1 ? "طلب متأخر" : `${late} طلبات متأخرة`}</span>}
                </button>
              );
            })}
          </div>
          <div className="board" ref={boardRef}>
            {COLUMNS.map((c) => {
              const list = active.filter((o) => c.statuses.includes(o.status));
              return (
                <section key={c.key} id={`orders-panel-${c.key}`} role="tabpanel" aria-labelledby={`orders-tab-${c.key}`} className={`board__col ${tab === c.key ? "is-on" : ""}`}>
                  <h2 className="board__title">
                    {c.title} <span>{list.length}</span>
                  </h2>
                  {list.length === 0 && <p className="muted board__empty">لا توجد طلبات</p>}
                  {list.map((o) => (
                    <OrderTicket
                      key={o.id}
                      order={o}
                      now={now}
                      busy={busyId === o.id}
                      onNext={(s) => void move(o, s)}
                      onCancel={() => {
                        setReason("");
                        setCancelling(o);
                      }}
                    />
                  ))}
                </section>
              );
            })}
          </div>

          {recent.length > 0 && (
            <details className="panel recent-orders">
              <summary>آخر الطلبات المنتهية ({recent.length})</summary>
              <ul>
                {recent.map((o) => (
                  <li key={o.id}>
                    <span dir="ltr">#{o.orderNumber}</span>
                    <span>{o.customerName}</span>
                    <span className={`status-chip status-chip--${o.status}`}>{STATUS_LABELS_AR[o.status]}</span>
                    <span>{riyals(o.totalHalalas)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      </div>
      {stockOpen && <StockDialog onClose={() => setStockOpen(false)} />}

      <Dialog
        open={cancelling !== null}
        title={cancelling ? `إلغاء الطلب #${cancelling.orderNumber}؟` : ""}
        tone="danger"
        onClose={() => setCancelling(null)}
        actions={
          <>
            <button
              type="button"
              className="btn btn--danger"
              disabled={busyId !== null}
              onClick={() => {
                if (!cancelling) return;
                void move(cancelling, "cancelled", reason.trim() || undefined).then(() => setCancelling(null));
              }}
            >
              نعم، إلغاء الطلب
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setCancelling(null)}>
              الاحتفاظ بالطلب
            </button>
          </>
        }
      >
        <p>هل أنت متأكد أنك تريد إلغاء هذا الطلب؟</p>
        <div className="field">
          <label htmlFor="cancel-reason">السبب (يظهر للعميل)</label>
          <input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="مثال: الصنف نفد" />
        </div>
      </Dialog>
    </StaffLayout>
  );
}

/** Sold out in two taps: a switch per item, and per origin for items like V60. */
function StockDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      title="المتوفر والكميات"
      dismissible
      onClose={onClose}
      actions={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          تم
        </button>
      }
    >
      <AvailabilityList scroll />
    </Dialog>
  );
}

function OrderTicket({
  order: o,
  now,
  busy,
  onNext,
  onCancel,
}: {
  order: Order;
  now: number;
  busy: boolean;
  onNext: (s: OrderStatus) => void;
  onCancel: () => void;
}) {
  const { menu } = useMenu();
  const next = nextStatus(o);
  const Icon = o.fulfillment === "pickup" ? StoreIcon : o.fulfillment === "curbside" ? CarIcon : ScooterIcon;
  const map = mapsUrl(o);
  const arrived = o.fulfillment === "curbside" && o.customerArrivedAt !== null;
  const urgency = urgencyOf(o, now);
  return (
    <article data-ticket={o.id} className={`ticket-card ticket-card--${o.status} ${arrived ? "ticket-card--arrived" : ""} ticket-card--${urgency}`}>
      <header className="ticket-card__head">
        <span className="ticket-card__num" dir="ltr">
          #{o.orderNumber}
        </span>
        <span
          className={`ticket-card__time ticket-card__time--${urgency}`}
          title={urgency === "late" ? `تجاوز ${ORDER_LATE_MINUTES} دقائق` : urgency === "warn" ? `تجاوز ${ORDER_WARN_MINUTES} دقائق` : undefined}
        >
          {urgency !== "ok" && <ClockIcon />}
          {minutesAgo(o.createdAt, now)}
          {urgency === "late" && <span className="ticket-card__late"> · متأخر</span>}
        </span>
      </header>
      <div className="ticket-card__identity">
        <strong className="ticket-card__customer"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="7" r="4" /><path d="M4 22v-3a8 8 0 0 1 16 0v3" /></svg><bdi>{o.customerName}</bdi></strong>
        <span className={`ticket-card__kind ticket-card__kind--${o.fulfillment}`}>
          <Icon />
          {FULFILLMENT_LABELS_AR[o.fulfillment]}
        </span>
      </div>

      {arrived && <div className="ticket-card__arrived">العميل وصل عند الكوفي!</div>}

      <ul className="ticket-card__items">
        {o.items.map((line, i) => (
          <li key={i}>
            <span className="ticket-card__qty">{line.quantity}</span>
            <span>
              {line.nameAr}
              {lineNameEn(line, menu?.items) && <small className="choice-en" dir="ltr">{lineNameEn(line, menu?.items)}</small>}
              {line.optionNameAr && <span className="ticket-card__option">{line.optionNameAr}</span>}
              {line.note && <span className="ticket-card__note">{line.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      {o.note && <p className="ticket-card__note ticket-card__note--order">ملاحظة: {o.note}</p>}

      <dl className="ticket-card__meta">
        <div>
          <dt>التواصل</dt>
          <dd>
            <a href={`tel:${o.customerPhone}`} dir="ltr">{o.customerPhone}</a>
          </dd>
        </div>
        {o.fulfillment === "curbside" && (
          <div>
            <dt>السيارة</dt>
            <dd>
              <CarDescription text={o.carDescription} plate="md" arabic />
            </dd>
          </div>
        )}
        {o.fulfillment === "delivery" && (
          <div>
            <dt>العنوان</dt>
            <dd>
              <span>{o.deliveryAddress}</span>
              {map && (
                <a href={map} target="_blank" rel="noopener noreferrer">
                  الموقع على الخريطة
                </a>
              )}
            </dd>
          </div>
        )}
      </dl>
      <div className="ticket-card__total">
        <span>المتبقي عند الاستلام</span>
        <strong>{riyals(o.totalHalalas-(o.walletHalalas??0))}</strong>
      </div>
      <div className="ticket-card__benefits">
            {(o.walletHalalas??0)>0 && <span className="badge badge--gold">مدفوع بالرصيد {riyals(o.walletHalalas!)}</span>}
            {(o.giftCups??0)>0 && <span className="badge badge--gold">ضيافة {o.giftCups} كوب</span>}
            {(o.couponHalalas??0)>0 && <span className="badge badge--gold">كوبون −{riyals(o.couponHalalas!)}</span>}
            {o.useReward && <span className="badge badge--gold">مشروب مجاني −{riyals(rewardDiscount(o))}</span>}
            {o.promoPercent !== null && <span className="badge badge--gold">خصم {o.promoPercent}%</span>}
      </div>

      <div className="ticket-card__actions">
        {next && (
          <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => onNext(next)}>
            {busy ? "…" : ACTION_LABELS[next]}
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--small" disabled={busy} onClick={onCancel}>
          إلغاء
        </button>
      </div>
    </article>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * Until the sound is unlocked: one tap turns it on. On Android, installing the
 * board as an app removes the tap for good (Chrome lets installed apps play sound).
 */
function SoundGate({ onTap }: { onTap: () => void }) {
  const canInstall = useCanInstall();
  const installable = !isNative && !isInstalledApp();
  return (
    <div className="sound-gate">
      <button type="button" className="sound-gate__tap" onClick={onTap}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></svg>
        <span>
          <strong>المس الشاشة لتشغيل صوت الطلبات</strong>
          <small>
            {installable
              ? "المتصفح يحتاج لمسة بعد فتح الصفحة. ثبّت لوحة الطلبات كتطبيق، ويشتغل الصوت بدون لمس"
              : "الجهاز يحتاج لمسة وحدة بعد فتح الصفحة، وبعدها يبقى الصوت شغّال"}
          </small>
        </span>
      </button>
      {installable && canInstall && (
        <button type="button" className="btn btn--primary btn--small sound-gate__install" onClick={() => void installStaffApp()}>
          تثبيت تطبيق الطلبات
        </button>
      )}
      {installable && !canInstall && (
        <p className="sound-gate__how">للتثبيت من كروم: القائمة ⋮ ← «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق»، ثم افتح «طلبات HOLLOW» من الأيقونة.</p>
      )}
    </div>
  );
}
