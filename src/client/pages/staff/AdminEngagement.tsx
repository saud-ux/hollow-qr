import { useCallback, useEffect, useState } from "react";
import { BROADCAST_BODY_MAX, BROADCAST_TITLE_MAX, type Broadcast, type RatingOverview } from "../../../shared/ordering";
import { ConfirmDialog } from "../../components/Dialog";
import { Alert, Field } from "../../components/Field";
import { apiGet, apiPost, errorText } from "../../lib/api";
import { formatDateTime } from "../../lib/dates";

/** Offers: a push to everyone who opted in to «العروض والجديد» in the app. */
export function OffersPanel() {
  const [data, setData] = useState<{ items: Broadcast[]; recipients: number } | null>(null);
  const [title, setTitle] = useState("HOLLOW");
  const [body, setBody] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; of: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<{ items: Broadcast[]; recipients: number }>("/api/admin/broadcasts")
      .then(setData)
      .catch((e: unknown) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  async function send() {
    setConfirm(false);
    setError(null);
    setDone(null);
    try {
      const { broadcast } = await apiPost<{ broadcast: Broadcast }>("/api/admin/broadcasts", { title: title.trim(), body: body.trim() });
      setProgress({ sent: 0, of: broadcast.recipients });
      let after: string | null = null;
      let sent = 0;
      // One batch per request; the server says where to continue.
      for (let round = 0; round < 200; round++) {
        const r: { sent: number; next: string | null } = await apiPost(`/api/admin/broadcasts/${broadcast.id}/send`, { after });
        sent = r.sent;
        setProgress({ sent, of: broadcast.recipients });
        if (!r.next) break;
        after = r.next;
      }
      setDone(`وصل الإشعار إلى ${sent} ${sent === 1 ? "جهاز" : "أجهزة"}`);
      setBody("");
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setProgress(null);
    }
  }

  const ready = title.trim().length > 0 && body.trim().length > 0 && !progress;
  return (
    <section className="panel">
      <h2>إشعار عرض للعملاء</h2>
      <p className="muted small">
        يوصل لكل اللي فعّلوا «العروض والجديد» في التطبيق
        {data ? `: ${data.recipients} ${data.recipients === 1 ? "جهاز" : "أجهزة"} الآن` : ""}.
      </p>
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
        {error && <Alert tone="error">{error}</Alert>}
        {done && <Alert tone="success">{done}</Alert>}
        <button type="submit" className="btn btn--primary" disabled={!ready || data?.recipients === 0}>
          {progress ? `جارٍ الإرسال… ${progress.sent} / ${progress.of}` : "إرسال الإشعار"}
        </button>
      </form>
      {data && data.items.length > 0 && (
        <ul className="broadcasts">
          {data.items.map((b) => (
            <li key={b.id}>
              <strong>{b.title}</strong>
              <span>{b.body}</span>
              <small className="muted">
                {formatDateTime(b.createdAt)} · وصل {b.sent} من {b.recipients}
              </small>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirm}
        title="إرسال الإشعار الحين؟"
        message={
          <p>
            «{body.trim()}» بيوصل لـ {data?.recipients ?? 0} {data?.recipients === 1 ? "جهاز" : "أجهزة"}. ما تقدر تلغيه بعد الإرسال.
          </p>
        }
        confirmLabel="أرسل"
        onConfirm={() => void send()}
        onCancel={() => setConfirm(false)}
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
