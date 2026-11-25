import { useCallback, useEffect, useState } from "react";
import { BUSINESS_TIME_ZONE } from "../../../shared/constants";
import { BROADCAST_BODY_MAX, BROADCAST_SCHEDULE_MAX_DAYS, BROADCAST_TITLE_MAX, type Broadcast, type RatingOverview } from "../../../shared/ordering";
import { ConfirmDialog } from "../../components/Dialog";
import { Alert, Field } from "../../components/Field";
import { apiGet, apiPost, errorText } from "../../lib/api";
import { sendBroadcast } from "../../lib/broadcast";
import { formatDateTime } from "../../lib/dates";

// The shop's clock (Riyadh, UTC+3 all year): what the admin types is shop time, whatever the phone's zone.
const SHOP_OFFSET = "+03:00";
const shopClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** "YYYY-MM-DDTHH:MM" on the shop's clock, for a datetime-local input. */
const shopInput = (d: Date) => shopClock.format(d).replace(" ", "T");
/** The next full hour, at least 30 minutes away. */
function defaultSendTime(): string {
  const d = new Date(Date.now() + 90 * 60_000);
  d.setUTCMinutes(0, 0, 0);
  return shopInput(d);
}

function broadcastStatus(b: Broadcast): { text: string; tone: "muted" | "gold" | "danger" } {
  if (b.cancelledAt) return { text: "ملغي", tone: "danger" };
  if (!b.scheduledAt) return { text: `أُرسل ${formatDateTime(b.createdAt)} · وصل لـ ${b.sent}`, tone: "muted" };
  if (b.finishedAt) return { text: `أُرسل ${formatDateTime(b.finishedAt)} · وصل لـ ${b.sent}`, tone: "muted" };
  if (b.startedAt) return { text: `جارٍ الإرسال · ${b.sent} من ${b.recipients}`, tone: "gold" };
  return { text: `مجدول ${formatDateTime(b.scheduledAt)}`, tone: "gold" };
}

/** Offers: a push to everyone who opted in to «العروض والجديد» in the app. */
export function OffersPanel() {
  const [data, setData] = useState<{ items: Broadcast[]; recipients: number } | null>(null);
  const [title, setTitle] = useState("HOLLOW");
  const [body, setBody] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; of: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const [sendAt, setSendAt] = useState(defaultSendTime);
  // When the time was last picked: the limits are checked against it.
  const [now, setNow] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState<Broadcast | null>(null);

  const load = useCallback(() => {
    apiGet<{ items: Broadcast[]; recipients: number }>("/api/admin/broadcasts")
      .then(setData)
      .catch((e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  const scheduledAt = later && sendAt ? `${sendAt}:00${SHOP_OFFSET}` : null;

  async function send() {
    setConfirm(false);
    setError(null);
    setDone(null);
    try {
      if (scheduledAt) {
        await apiPost("/api/admin/broadcasts", { title: title.trim(), body: body.trim(), scheduledAt });
        setDone(`تمت جدولة الإشعار: ${formatDateTime(scheduledAt)}`);
      } else {
        await sendBroadcast(title.trim(), body.trim(), (s, of) => setProgress({ sent: s, of }));
        setDone("انرسل الإشعار");
      }
      setBody("");
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setProgress(null);
    }
  }

  async function cancelScheduled() {
    if (!cancelling) return;
    setError(null);
    setDone(null);
    try {
      await apiPost(`/api/admin/broadcasts/${cancelling.id}/cancel`);
      setDone("انلغى الإشعار المجدول");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setCancelling(null);
      load();
    }
  }

  const sendAtMs = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  const timeError =
    later && (Number.isNaN(sendAtMs) || sendAtMs < now - 60_000 || sendAtMs > now + BROADCAST_SCHEDULE_MAX_DAYS * 86_400_000)
      ? `اختر وقتًا من الآن إلى ${BROADCAST_SCHEDULE_MAX_DAYS} يوم`
      : null;
  const ready = title.trim().length > 0 && body.trim().length > 0 && !progress && !timeError;
  return (
    <section className="panel">
      <h2>إشعار عرض للعملاء</h2>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) setConfirm(true);
        }}
      >
        <Field label="العنوان" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={BROADCAST_TITLE_MAX} />
        <div className="field">
          <label htmlFor="offer-body">نص الإشعار</label>
          <textarea
            id="offer-body"
            rows={3}
            value={body}
            maxLength={BROADCAST_BODY_MAX}
            placeholder="مثال: عرض اليوم، وافل بيكان بـ 12 ريال لين الساعة 6"
            onChange={(e) => setBody(e.target.value)}
          />
          <small className="field__hint" dir="ltr">
            {body.length} / {BROADCAST_BODY_MAX}
          </small>
        </div>
        <div className="field">
          <span className="field__label" id="offer-when">وقت الإرسال</span>
          <div className="theme-switch offer-when" role="radiogroup" aria-labelledby="offer-when">
            {([
              [false, "الحين"],
              [true, "وقت لاحق"],
            ] as const).map(([value, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={later === value}
                className={`theme-switch__opt ${later === value ? "is-on" : ""}`}
                onClick={() => {
                  setNow(Date.now());
                  setLater(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {later && (
          <Field
            label="التاريخ والساعة (بتوقيت الرياض)"
            type="datetime-local"
            dir="ltr"
            value={sendAt}
            min={shopInput(new Date(now))}
            max={shopInput(new Date(now + BROADCAST_SCHEDULE_MAX_DAYS * 86_400_000))}
            onChange={(e) => {
              setNow(Date.now());
              setSendAt(e.target.value);
            }}
            error={timeError}
            hint="يوصل للي مفعّلين إشعارات العروض وقت الإرسال"
          />
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {done && <Alert tone="success">{done}</Alert>}
        <button type="submit" className="btn btn--primary" disabled={!ready || (!later && data?.recipients === 0)}>
          {progress ? "جارٍ الإرسال…" : later ? "جدولة الإشعار" : "إرسال الإشعار"}
        </button>
      </form>
      {data && data.items.length > 0 && (
        <ul className="broadcasts">
          {data.items.map((b) => {
            const status = broadcastStatus(b);
            const canCancel = b.scheduledAt !== null && !b.startedAt && !b.cancelledAt && !b.finishedAt;
            return (
              <li key={b.id} className={b.cancelledAt ? "is-cancelled" : undefined}>
                <strong>{b.title}</strong>
                <span>{b.body}</span>
                <span className="broadcasts__foot">
                  <small className={status.tone === "muted" ? "muted" : `broadcasts__status broadcasts__status--${status.tone}`}>{status.text}</small>
                  {canCancel && (
                    <button type="button" className="btn btn--small btn--ghost" onClick={() => setCancelling(b)}>
                      إلغاء
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={confirm}
        title={scheduledAt ? "جدولة الإشعار؟" : "إرسال الإشعار الحين؟"}
        message={
          scheduledAt ? (
            <p>
              «{body.trim()}» يوصل {formatDateTime(scheduledAt)}. تقدر تلغيه قبل هذا الوقت.
            </p>
          ) : (
            <p>
              «{body.trim()}». ما تقدر تلغيه بعد الإرسال.
            </p>
          )
        }
        confirmLabel={scheduledAt ? "جدولة" : "أرسل"}
        onConfirm={() => void send()}
        onCancel={() => setConfirm(false)}
      />
      <ConfirmDialog
        open={cancelling !== null}
        title="إلغاء الإشعار المجدول؟"
        message={cancelling ? <p>«{cancelling.body}» ما راح يوصل للعملاء.</p> : null}
        confirmLabel="إلغاء الإشعار"
        tone="danger"
        onConfirm={() => void cancelScheduled()}
        onCancel={() => setCancelling(null)}
      />
    </section>
  );
}

/** Average stars and the latest ratings with their comments. */
export function RatingsPanel() {
  const [data, setData] = useState<RatingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<RatingOverview>("/api/admin/ratings")
      .then(setData)
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  return (
    <section className="panel">
      <h2>تقييمات العملاء</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {data && data.count === 0 && <p className="muted">ما فيه تقييمات حتى الآن. تظهر هنا بعد ما يقيّم العملاء طلباتهم.</p>}
      {data && data.count > 0 && (
        <>
          <p className="ratings__summary">
            <span className="ratings__avg">{data.average?.toFixed(1)}</span>
            <span className="ratings__stars" aria-hidden="true">
              {"★".repeat(Math.round(data.average ?? 0))}
              <span className="ratings__dim">{"★".repeat(5 - Math.round(data.average ?? 0))}</span>
            </span>
            <span className="muted">من {data.count} تقييم</span>
          </p>
          <ul className="ratings">
            {data.items.map((r) => (
              <li key={`${r.orderNumber}-${r.ratedAt}`}>
                <div className="ratings__head">
                  <span className="ratings__stars" aria-label={`${r.rating} من 5`}>
                    {"★".repeat(r.rating)}
                    <span className="ratings__dim">{"★".repeat(5 - r.rating)}</span>
                  </span>
                  <small className="muted">
                    {r.customerName} · طلب <span dir="ltr">#{r.orderNumber}</span> · {formatDateTime(r.ratedAt)}
                  </small>
                </div>
                {r.comment && <p>{r.comment}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
