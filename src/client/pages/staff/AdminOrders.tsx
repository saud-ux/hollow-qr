import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { BUSINESS_TIME_ZONE } from "../../../shared/constants";
import {
  FULFILLMENT_LABELS_AR,
  STATUS_LABELS_AR,
  type AdminOrder,
  type OrderHistoryFilter,
  type OrderHistoryPage,
} from "../../../shared/ordering";
import { Alert, Spinner } from "../../components/Field";
import { CarIcon, ScooterIcon, StoreIcon } from "../../components/Shop";
import { StaffLayout } from "../../components/StaffLayout";
import { apiDownload, apiGet, errorText } from "../../lib/api";
import { formatDateTime } from "../../lib/dates";
import { riyals } from "../../lib/menu";

const PAGE_SIZE = 30;

const STATES: { value: OrderHistoryFilter; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "active", label: "الحالية" },
  { value: "completed", label: "المسلّمة" },
  { value: "cancelled", label: "الملغاة" },
  { value: "ended", label: "المنتهية" },
];

type Period = "today" | "yesterday" | "7d" | "30d" | "all" | "custom";

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "اليوم" },
  { value: "yesterday", label: "أمس" },
  { value: "7d", label: "7 أيام" },
  { value: "30d", label: "30 يوم" },
  { value: "all", label: "كل الوقت" },
  { value: "custom", label: "تاريخ محدد" },
];

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE });
/** YYYY-MM-DD on the shop's clock, `back` days ago. */
const localDay = (back = 0) => dayFormat.format(new Date(Date.now() - back * 864e5));

function periodRange(period: Period, from: string, to: string): { from?: string; to?: string } {
  switch (period) {
    case "today":
      return { from: localDay(), to: localDay() };
    case "yesterday":
      return { from: localDay(1), to: localDay(1) };
    case "7d":
      return { from: localDay(6), to: localDay() };
    case "30d":
      return { from: localDay(29), to: localDay() };
    case "custom":
      return { from: from || undefined, to: to || undefined };
    default:
      return {};
  }
}

function countOf(counts: OrderHistoryPage["counts"], state: OrderHistoryFilter): number {
  if (state === "ended") return counts.completed + counts.cancelled;
  return counts[state];
}

/** "6 د" / "1 س 12 د" between two times. */
function elapsed(fromIso: string, toIso: string): string {
  const mins = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000));
  if (mins < 60) return `${mins} د`;
  const h = Math.floor(mins / 60);
  if (h < 48) return mins % 60 ? `${h} س ${mins % 60} د` : `${h} س`;
  return `${Math.floor(h / 24)} يوم`;
}

const itemCount = (o: AdminOrder) => o.items.reduce((n, l) => n + l.quantity, 0);
const itemsLine = (o: AdminOrder) => o.items.map((l) => `${l.quantity}× ${l.nameAr}${l.optionNameAr ? ` (${l.optionNameAr})` : ""}`).join("، ");

function KindIcon({ order }: { order: AdminOrder }) {
  const Icon = order.fulfillment === "pickup" ? StoreIcon : order.fulfillment === "curbside" ? CarIcon : ScooterIcon;
  return <Icon />;
}

interface Loaded extends OrderHistoryPage {
  key: string;
}

/** Admin: every order, open or finished, searchable, with all its details. */
export function AdminOrdersPage() {
  const [state, setState] = useState<OrderHistoryFilter>("all");
  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState(() => localDay(6));
  const [to, setTo] = useState(() => localDay());
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<AdminOrder | null>(null);

  // Search as you type, once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const range = periodRange(period, from, to);
  const params = new URLSearchParams({ status: state });
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  if (query) params.set("q", query);
  const key = params.toString();

  useEffect(() => {
    let alive = true;
    apiGet<OrderHistoryPage>(`/api/admin/orders?${key}&page=1&pageSize=${PAGE_SIZE}`)
      .then((page) => {
        if (!alive) return;
        setData({ ...page, key });
        setError(null);
      })
      .catch((e: unknown) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [key]);

  const shown = data?.key === key ? data : null;

  async function loadMore() {
    if (!shown) return;
    setMore(true);
    try {
      const next = await apiGet<OrderHistoryPage>(`/api/admin/orders?${key}&page=${shown.page + 1}&pageSize=${PAGE_SIZE}`);
      setData((d) => (d && d.key === key ? { ...next, key, items: [...d.items, ...next.items] } : d));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setMore(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      await apiDownload(`/api/admin/export/orders.csv?${key}`, `hollow-orders-${localDay()}.csv`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <StaffLayout title="كل الطلبات" wide>
      <section className="panel ohist__filters" aria-label="تصفية الطلبات">
        <div className="ohist__chips" role="radiogroup" aria-label="حالة الطلب">
          {STATES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={state === s.value}
              className={`ohist__chip ${state === s.value ? "is-on" : ""}`}
              onClick={() => setState(s.value)}
            >
              {s.label}
              {shown && <span className="ohist__chip-count">{countOf(shown.counts, s.value)}</span>}
            </button>
          ))}
        </div>
        <div className="ohist__row-filters">
          <div className="theme-switch ohist__periods" role="radiogroup" aria-label="الفترة">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={period === p.value}
                className={`theme-switch__opt ${period === p.value ? "is-on" : ""}`}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            className="ohist__search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="رقم الطلب، الاسم، الجوال أو العضوية"
            aria-label="بحث"
            maxLength={80}
          />
        </div>
        {period === "custom" && (
          <div className="ohist__dates">
            <label>
              من
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              إلى
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}
      </section>

      {error && <Alert tone="error">{error}</Alert>}
      {!shown && !error && <Spinner />}

      {shown && (
        <>
          <div className="ohist__summary">
            <p>
              <strong>{shown.total}</strong> {shown.total === 1 ? "طلب" : "طلبات"}
              {shown.revenueHalalas > 0 && (
                <>
                  {" · "}المسلّم منها بقيمة <strong>{riyals(shown.revenueHalalas)}</strong>
                </>
              )}
            </p>
            {shown.total > 0 && (
              <button type="button" className="btn btn--small btn--secondary" onClick={() => void exportCsv()} disabled={exporting}>
                {exporting ? "جارٍ التصدير…" : "تصدير Excel"}
              </button>
            )}
          </div>

          {shown.items.length === 0 ? (
            <p className="panel muted center">لا توجد طلبات بهذا البحث</p>
          ) : (
            <ul className="ohist__list">
              <li className="ohist__head" aria-hidden="true">
                <span>الطلب</span>
                <span>الوقت</span>
                <span>العميل</span>
                <span>الأصناف</span>
                <span>المبلغ</span>
                <span>الحالة</span>
              </li>
              {shown.items.map((o) => (
                <li key={o.id}>
                  <button type="button" className={`ohist__row ohist__row--${o.status}`} onClick={() => setOpen(o)}>
                    <span className="ohist__num">
                      <span dir="ltr">#{o.orderNumber}</span>
                      <span className="ohist__kind" title={FULFILLMENT_LABELS_AR[o.fulfillment]}>
                        <KindIcon order={o} />
                      </span>
                    </span>
                    <span className="ohist__time">{formatDateTime(o.createdAt)}</span>
                    <span className="ohist__customer">
                      <strong>{o.customerName}</strong>
                      <small dir="ltr">{o.customerPhone}</small>
                    </span>
                    <span className="ohist__items">{itemsLine(o)}</span>
                    <span className="ohist__total">{riyals(o.totalHalalas)}</span>
                    <span className={`status-chip status-chip--${o.status}`}>{STATUS_LABELS_AR[o.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {shown.items.length < shown.total && (
            <button type="button" className="btn btn--secondary btn--block ohist__more" onClick={() => void loadMore()} disabled={more}>
              {more ? "جارٍ التحميل…" : `عرض المزيد (${shown.total - shown.items.length} متبقي)`}
            </button>
          )}
        </>
      )}

      <OrderDetail order={open} onClose={() => setOpen(null)} />
    </StaffLayout>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="odet__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Everything about one order, in a side panel (a full sheet on the phone). */
function OrderDetail({ order: o, onClose }: { order: AdminOrder | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (o && !el.open) el.showModal();
    if (!o && el.open) el.close();
  }, [o]);

  const lr = o?.loyaltyResult ?? null;
  const steps: { label: string; at: string | null; extra?: string }[] = o
    ? [
        { label: "وصل الطلب", at: o.createdAt },
        { label: "قُبل وبدأ التحضير", at: o.acceptedAt },
        { label: "جاهز", at: o.readyAt },
        { label: "خرج للتوصيل", at: o.outForDeliveryAt },
        { label: "العميل وصل عند الكوفي", at: o.customerArrivedAt },
        { label: "تم التسليم", at: o.completedAt, extra: o.completedByName ? `بواسطة ${o.completedByName}` : undefined },
        {
          label: "أُلغي",
          at: o.cancelledAt,
          extra: o.cancelledBy ? (o.cancelledBy === "customer" ? "ألغاه العميل" : "ألغاه الموظف") : undefined,
        },
      ].filter((s) => s.at !== null)
    : [];
  const map = o && o.deliveryLat !== null && o.deliveryLng !== null ? `https://maps.google.com/?q=${o.deliveryLat},${o.deliveryLng}` : null;

  return (
    <dialog
      ref={ref}
      className="odet"
      aria-labelledby="odet-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {o && (
        <div className="odet__inner">
          <header className="odet__head">
            <div>
              <h2 id="odet-title" dir="ltr">
                #{o.orderNumber}
              </h2>
              <span className="muted small">{formatDateTime(o.createdAt)}</span>
            </div>
            <span className={`status-chip status-chip--${o.status}`}>{STATUS_LABELS_AR[o.status]}</span>
            <button type="button" className="odet__close" onClick={onClose} aria-label="إغلاق">
              ×
            </button>
          </header>

          <section className="odet__section">
            <h3>العميل</h3>
            <dl>
              <Row label="الاسم">{o.customerName}</Row>
              <Row label="الجوال">
                <a href={`tel:${o.customerPhone}`} dir="ltr">
                  {o.customerPhone}
                </a>
              </Row>
              <Row label="رقم العضوية">
                {o.memberId && o.accountId ? (
                  <Link to={`/staff/customers/${o.accountId}`} dir="ltr">
                    {o.memberId}
                  </Link>
                ) : (
                  (o.memberId ?? "لا يوجد")
                )}
              </Row>
            </dl>
          </section>

          <section className="odet__section">
            <h3>طريقة الاستلام</h3>
            <dl>
              <Row label="الطريقة">{FULFILLMENT_LABELS_AR[o.fulfillment]}</Row>
              {o.carDescription && <Row label="السيارة">{o.carDescription}</Row>}
              {o.deliveryAddress && (
                <Row label="العنوان">
                  {o.deliveryAddress}
                  {map && (
                    <>
                      {" · "}
                      <a href={map} target="_blank" rel="noreferrer">
                        فتح الخريطة
                      </a>
                    </>
                  )}
                </Row>
              )}
            </dl>
          </section>

          <section className="odet__section">
            <h3>الأصناف ({itemCount(o)})</h3>
            <ul className="odet__items">
              {o.items.map((l, i) => (
                <li key={i}>
                  <span className="ticket-card__qty">{l.quantity}</span>
                  <span className="odet__item">
                    <strong>{l.nameAr}</strong>
                    {l.optionNameAr && <span className="ticket-card__option">{l.optionNameAr}</span>}
                    {l.note && <span className="ticket-card__note">{l.note}</span>}
                  </span>
                  <span className="odet__price">{riyals(l.unitPriceHalalas * l.quantity)}</span>
                </li>
              ))}
            </ul>
            {o.note && <p className="ticket-card__note ticket-card__note--order">ملاحظة الطلب: {o.note}</p>}
          </section>

          <section className="odet__section">
            <h3>المبلغ</h3>
            <dl>
              <Row label="المجموع">{riyals(o.subtotalHalalas)}</Row>
              {o.deliveryFeeHalalas > 0 && <Row label="رسوم التوصيل">{riyals(o.deliveryFeeHalalas)}</Row>}
              {o.discountHalalas > 0 && <Row label="خصم المشروب المجاني">− {riyals(o.discountHalalas)}</Row>}
              <Row label="الإجمالي">
                <strong>{riyals(o.totalHalalas)}</strong>
              </Row>
              <Row label="الدفع">عند الاستلام</Row>
            </dl>
          </section>

          {(o.useReward || (lr && !lr.skipped)) && (
            <section className="odet__section">
              <h3>بطاقة الولاء</h3>
              <dl>
                {o.useReward && (
                  <Row label="المشروب المجاني">
                    {lr?.redeem === "REDEEMED" ? "استُخدم" : lr?.redeem ? "كان مستخدمًا من قبل" : "طلبه العميل"}
                  </Row>
                )}
                {lr && !lr.skipped && <Row label="الأكواب المضافة">{lr.cupsAdded}</Row>}
                {lr && lr.cupsNotAdded > 0 && <Row label="أكواب لم تُضف">{lr.cupsNotAdded} (البطاقة ممتلئة)</Row>}
              </dl>
            </section>
          )}

          <section className="odet__section">
            <h3>مراحل الطلب</h3>
            <ol className="odet__steps">
              {steps.map((s) => (
                <li key={s.label} className={s.label === "أُلغي" ? "is-cancelled" : ""}>
                  <span className="odet__step-label">{s.label}</span>
                  <span className="odet__step-time">
                    {formatDateTime(s.at)}
                    {s.at !== o.createdAt && <small> · بعد {elapsed(o.createdAt, s.at!)}</small>}
                  </span>
                  {s.extra && <span className="odet__step-extra">{s.extra}</span>}
                </li>
              ))}
            </ol>
            {o.cancelReason && <p className="odet__reason">سبب الإلغاء: {o.cancelReason}</p>}
          </section>

          {o.rating !== null && (
            <section className="odet__section">
              <h3>التقييم</h3>
              <p className="odet__stars" aria-label={`${o.rating} من 5`}>
                {"★".repeat(o.rating)}
                <span>{"★".repeat(5 - o.rating)}</span>
              </p>
              {o.ratingComment && <p>«{o.ratingComment}»</p>}
              {o.ratedAt && <p className="muted small">{formatDateTime(o.ratedAt)}</p>}
            </section>
          )}
        </div>
      )}
    </dialog>
  );
}
