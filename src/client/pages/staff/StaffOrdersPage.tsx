import { useCallback, useEffect, useRef, useState } from "react";
import {
  FULFILLMENT_LABELS_AR,
  isActiveStatus,
  nextStatus,
  STATUS_LABELS_AR,
  type Order,
  type OrderStatus,
  type ShopSettings,
} from "../../../shared/ordering";
import { Dialog } from "../../components/Dialog";
import { Alert, Spinner } from "../../components/Field";
import { CarIcon, ScooterIcon, StoreIcon } from "../../components/Shop";
import { StaffLayout } from "../../components/StaffLayout";
import { apiGet, apiPost, errorText } from "../../lib/api";
import { isAudioReady, orderChime, primeAudio } from "../../lib/feedback";
import { riyals } from "../../lib/menu";

const POLL_MS = 5_000;
/** Keep ringing while a new order waits, so it is never missed. */
const REMIND_MS = 15_000;

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

/** Keeps the iPad screen awake while the board is open (where supported). */
function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      navigator.wakeLock
        .request("screen")
        .then((l) => (lock = l))
        .catch(() => undefined);
    };
    acquire();
    const onVisible = () => document.visibilityState === "visible" && acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [enabled]);
}

export function StaffOrdersPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(isAudioReady);
  const [tab, setTab] = useState("new");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<string> | null>(null);
  const lastRing = useRef(0);

  useWakeLock(soundOn);

  const load = useCallback(
    () =>
      apiGet<Board>("/api/staff/orders")
        .then((b) => {
          setBoard(b);
          setError(null);
          setNow(Date.now());
          const newIds = b.items.filter((o) => o.status === "new").map((o) => o.id);
          const firstLoad = seen.current === null;
          const fresh = newIds.some((id) => !seen.current?.has(id));
          seen.current = new Set([...(seen.current ?? []), ...b.items.map((o) => o.id)]);
          const waiting = newIds.length > 0 && Date.now() - lastRing.current > REMIND_MS;
          if ((fresh && !firstLoad) || waiting) {
            lastRing.current = Date.now();
            orderChime();
          }
        })
        .catch((err: unknown) => setError(errorText(err))),
    [],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const newCount = board?.items.filter((o) => o.status === "new").length ?? 0;
  useEffect(() => {
    const base = "طلبات HOLLOW";
    document.title = newCount > 0 ? `(${newCount}) طلب جديد · ${base}` : base;
    return () => {
      document.title = "HOLLOW Rewards";
    };
  }, [newCount]);

  function enableSound() {
    primeAudio();
    setSoundOn(true);
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
    <StaffLayout>
      <div className="board-bar">
        <div className={`shop-state ${board?.shop.isOpen ? "shop-state--open" : ""}`}>
          <span className="shop-state__dot" aria-hidden="true" />
          {board ? (board.shop.isOpen ? "نستقبل الطلبات" : board.shop.settings.orderingPaused ? "الطلبات متوقفة" : "خارج أوقات الدوام") : "…"}
        </div>
        {board && (
          <button type="button" className={`btn btn--small ${board.shop.settings.orderingPaused ? "btn--primary" : "btn--secondary"}`} onClick={() => void togglePause()}>
            {board.shop.settings.orderingPaused ? "استئناف الطلبات" : "إيقاف مؤقت"}
          </button>
        )}
      </div>

      {!soundOn && (
        <button type="button" className="sound-gate" onClick={enableSound}>
          <strong>اضغط لتشغيل تنبيه الطلبات</strong>
          <span>يرن الجهاز مع كل طلب جديد، ويبقى يذكّر حتى يُقبل الطلب</span>
        </button>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {toast && (
        <div className={`board-toast board-toast--${toast.tone}`} role="status" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
      {!board && !error && <Spinner />}

      {board && (
        <>
          <div className="board-tabs" role="tablist">
            {COLUMNS.map((c) => {
              const n = active.filter((o) => c.statuses.includes(o.status)).length;
              return (
                <button key={c.key} type="button" role="tab" aria-selected={tab === c.key} className={`board-tab ${tab === c.key ? "is-on" : ""}`} onClick={() => setTab(c.key)}>
                  {c.title}
                  <span className={`board-tab__count ${c.key === "new" && n > 0 ? "is-hot" : ""}`}>{n}</span>
                </button>
              );
            })}
          </div>
          <div className="board">
            {COLUMNS.map((c) => {
              const list = active.filter((o) => c.statuses.includes(o.status));
              return (
                <section key={c.key} className={`board__col ${tab === c.key ? "is-on" : ""}`} aria-label={c.title}>
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
              إلغاء الطلب
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setCancelling(null)}>
              رجوع
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="cancel-reason">السبب (يظهر للعميل)</label>
          <input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="مثال: الصنف نفد" />
        </div>
      </Dialog>
    </StaffLayout>
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
  const next = nextStatus(o);
  const Icon = o.fulfillment === "pickup" ? StoreIcon : o.fulfillment === "curbside" ? CarIcon : ScooterIcon;
  const map = mapsUrl(o);
  const arrived = o.fulfillment === "curbside" && o.customerArrivedAt !== null;
  return (
    <article className={`ticket-card ticket-card--${o.status} ${arrived ? "ticket-card--arrived" : ""}`}>
      <header className="ticket-card__head">
        <span className="ticket-card__num" dir="ltr">
          #{o.orderNumber}
        </span>
        <span className="ticket-card__time">{minutesAgo(o.createdAt, now)}</span>
        <span className={`ticket-card__kind ticket-card__kind--${o.fulfillment}`}>
          <Icon />
          {FULFILLMENT_LABELS_AR[o.fulfillment]}
        </span>
      </header>

      {arrived && <div className="ticket-card__arrived">العميل وصل عند الكوفي!</div>}

      <ul className="ticket-card__items">
        {o.items.map((line, i) => (
          <li key={i}>
            <span className="ticket-card__qty">{line.quantity}</span>
            <span>
              {line.nameAr}
              {line.note && <span className="ticket-card__note">{line.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      {o.note && <p className="ticket-card__note ticket-card__note--order">ملاحظة: {o.note}</p>}

      <dl className="ticket-card__meta">
        <div>
          <dt>العميل</dt>
          <dd>
            {o.customerName} · <a href={`tel:${o.customerPhone}`} dir="ltr">{o.customerPhone}</a>
          </dd>
        </div>
        {o.fulfillment === "curbside" && (
          <div>
            <dt>السيارة</dt>
            <dd>{o.carDescription}</dd>
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
        <div>
          <dt>المبلغ</dt>
          <dd>
            <strong>{riyals(o.totalHalalas)}</strong> · الدفع عند الاستلام
            {o.useReward && <span className="badge badge--gold">مشروب مجاني −{riyals(o.discountHalalas)}</span>}
          </dd>
        </div>
      </dl>

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
