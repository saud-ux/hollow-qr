import { useEffect, useState } from "react";
import { BUSINESS_TIME_ZONE } from "../../../shared/constants";
import {
  BROADCAST_BODY_MAX,
  BROADCAST_TITLE_MAX,
  CATEGORY_LABELS_AR,
  MAX_DISCOUNT_PERCENT,
  discountedPrice,
  type Broadcast,
  type Discount,
  type MenuItem,
} from "../../../shared/ordering";
import { ConfirmDialog } from "../../components/Dialog";
import { Alert, Spinner } from "../../components/Field";
import { StaffLayout } from "../../components/StaffLayout";
import { apiDelete, apiGet, apiSend, errorText } from "../../lib/api";
import { sendBroadcast } from "../../lib/broadcast";
import { formatDateTime } from "../../lib/dates";
import { riyals } from "../../lib/menu";

const QUICK = [10, 15, 20, 25, 30, 50];

type Saved = { discount: Discount | null; live: boolean };

// The shop's clock: Riyadh is UTC+3 all year (no daylight saving).
const RIYADH_OFFSET = "+03:00";
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE });
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const clockAr = new Intl.DateTimeFormat("ar-SA-u-nu-latn", { timeZone: BUSINESS_TIME_ZONE, hour: "numeric", minute: "2-digit" });
const dayAr = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { timeZone: BUSINESS_TIME_ZONE, weekday: "long", day: "numeric", month: "long" });

/** "YYYY-MM-DDTHH:mm" (a datetime-local value) on the shop's clock. */
const toLocalInput = (iso: string) => `${dayFormat.format(new Date(iso))}T${timeFormat.format(new Date(iso))}`;
const fromLocalInput = (value: string) => new Date(`${value}:00${RIYADH_OFFSET}`).toISOString();
const endOfToday = () => `${dayFormat.format(new Date())}T23:59`;

/** "لين الساعة 11:59 م" today, otherwise "لين الخميس 9 أكتوبر". */
function untilText(iso: string): string {
  const sameDay = dayFormat.format(new Date(iso)) === dayFormat.format(new Date());
  return sameDay ? `لين الساعة ${clockAr.format(new Date(iso))}` : `لين ${dayAr.format(new Date(iso))}`;
}

function scopeText(d: Pick<Discount, "scope" | "itemIds">, items: MenuItem[]): string {
  if (d.scope === "all") return "على كل المنيو";
  const names = items.filter((i) => d.itemIds.includes(i.id)).map((i) => i.nameAr);
  if (names.length <= 3) return `على ${names.join("، ")}`;
  return `على ${names.slice(0, 2).join("، ")} و${names.length - 2} أصناف ثانية`;
}

/** Admin: one percentage off the whole menu or chosen items, on by hand, optionally ending at a set time. */
export function AdminDiscountPage() {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [recipients, setRecipients] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [percent, setPercent] = useState("20");
  const [scope, setScope] = useState<Discount["scope"]>("all");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [ends, setEnds] = useState<"manual" | "at">("manual");
  const [endsAt, setEndsAt] = useState(endOfToday);
  const [notify, setNotify] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  // "Now" for checking the end time, kept fresh while the page is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Promise.all([
      apiGet<Saved>("/api/admin/discount"),
      apiGet<{ items: MenuItem[] }>("/api/admin/menu"),
      apiGet<{ items: Broadcast[]; recipients: number }>("/api/admin/broadcasts").catch(() => null),
    ])
      .then(([s, m, b]) => {
        setSaved(s);
        setItems(m.items.filter((i) => !i.isArchived));
        setRecipients(b?.recipients ?? null);
        // Editing a running discount starts from what it is.
        if (s.live && s.discount) {
          setPercent(String(s.discount.percent));
          setScope(s.discount.scope);
          setChosen(new Set(s.discount.itemIds));
          if (s.discount.endsAt) {
            setEnds("at");
            setEndsAt(toLocalInput(s.discount.endsAt));
          }
        }
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  const pct = Number(percent);
  const pctOk = Number.isInteger(pct) && pct >= 1 && pct <= MAX_DISCOUNT_PERCENT;
  const endsIso = ends === "at" && endsAt ? fromLocalInput(endsAt) : null;
  const endsOk = ends === "manual" || (endsIso !== null && new Date(endsIso).getTime() > now);
  const scopeOk = scope === "all" || chosen.size > 0;
  const ready = pctOk && endsOk && scopeOk && !busy;

  // The push text follows the form until the admin edits it.
  const autoTitle = `خصم ${pctOk ? pct : "…"}% ☕`;
  const autoBody = `${scopeText({ scope, itemIds: [...chosen] }, items ?? [])}${endsIso ? ` ${untilText(endsIso)}` : ""}، اطلب الحين من التطبيق`.slice(0, BROADCAST_BODY_MAX);
  const pushTitle = title ?? autoTitle;
  const pushBody = body ?? autoBody;

  const toggle = (id: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await apiSend<Saved>("PUT", "/api/admin/discount", { percent: pct, scope, itemIds: scope === "items" ? [...chosen] : [], endsAt: endsIso });
      setSaved(result);
      let message = saved?.live ? "تم حفظ التعديل" : `الخصم شغال الحين: ${pct}%`;
      if (notify) {
        try {
          const sent = await sendBroadcast(pushTitle.trim(), pushBody.trim(), (s, of) => setProgress(`جارٍ إرسال الإشعار… ${s} / ${of}`));
          message += ` · وصل الإشعار إلى ${sent} ${sent === 1 ? "جهاز" : "أجهزة"}`;
          setNotify(false);
        } catch (e) {
          setError(`الخصم شغال، لكن الإشعار ما انرسل: ${errorText(e)}`);
        }
      }
      setDone(message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function stop() {
    setConfirmStop(false);
    setBusy(true);
    setError(null);
    try {
      setSaved(await apiDelete<Saved>("/api/admin/discount"));
      setDone("أوقفت الخصم، ورجعت الأسعار مثل ما كانت");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const live = saved?.live && saved.discount ? saved.discount : null;
  const sample = items?.find((i) => scope === "all" || chosen.has(i.id)) ?? null;

  return (
    <StaffLayout title="الخصم">
      {!saved && !error && <Spinner />}

      {saved && (
        <section className={`panel disc-status ${live ? "is-live" : ""}`} aria-live="polite">
          {live ? (
            <>
              <div className="disc-status__head">
                <span className="disc-status__dot" aria-hidden="true" />
                <strong>الخصم شغال الحين</strong>
              </div>
              <p className="disc-status__big">
                <span dir="ltr">{live.percent}%</span> {scopeText(live, items ?? [])}
              </p>
              <p className="muted">
                {live.endsAt ? `ينتهي ${formatDateTime(live.endsAt)}` : "يستمر لين توقفه"}
                {live.startedAt && ` · بدأ ${formatDateTime(live.startedAt)}`}
              </p>
              <button type="button" className="btn btn--danger" onClick={() => setConfirmStop(true)} disabled={busy}>
                إيقاف الخصم
              </button>
            </>
          ) : (
            <>
              <div className="disc-status__head">
                <span className="disc-status__dot" aria-hidden="true" />
                <strong>ما فيه خصم شغال</strong>
              </div>
              {saved.discount?.endsAt && (
                <p className="muted">
                  آخر خصم ({saved.discount.percent}%) انتهى {formatDateTime(saved.discount.endsAt)}
                </p>
              )}
            </>
          )}
        </section>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}

      {saved && items && (
        <form
          className="panel form disc-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2>{live ? "تعديل الخصم" : "خصم جديد"}</h2>

          <fieldset className="disc-field">
            <legend>نسبة الخصم</legend>
            <div className="disc-percent">
              <div className="ohist__chips">
                {QUICK.map((q) => (
                  <button key={q} type="button" className={`ohist__chip ${pct === q ? "is-on" : ""}`} onClick={() => setPercent(String(q))}>
                    <span dir="ltr">{q}%</span>
                  </button>
                ))}
              </div>
              <label className="disc-percent__input">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_DISCOUNT_PERCENT}
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  aria-label="النسبة"
                  aria-invalid={!pctOk}
                />
                <span>%</span>
              </label>
            </div>
            {!pctOk && <small className="field__error">النسبة من 1 إلى {MAX_DISCOUNT_PERCENT}</small>}
          </fieldset>

          <fieldset className="disc-field">
            <legend>يشمل</legend>
            <div className="theme-switch" role="radiogroup" aria-label="يشمل">
              {(
                [
                  ["all", "كل المنيو"],
                  ["items", "أصناف مختارة"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={scope === value} className={`theme-switch__opt ${scope === value ? "is-on" : ""}`} onClick={() => setScope(value)}>
                  {label}
                </button>
              ))}
            </div>
            {scope === "items" && (
              <div className="disc-items">
                {(["drink", "dessert"] as const).map((category) => {
                  const list = items.filter((i) => i.category === category);
                  if (list.length === 0) return null;
                  const all = list.every((i) => chosen.has(i.id));
                  return (
                    <div key={category} className="disc-items__group">
                      <div className="disc-items__head">
                        <strong>{CATEGORY_LABELS_AR[category]}</strong>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() =>
                            setChosen((s) => {
                              const next = new Set(s);
                              for (const i of list) {
                                if (all) next.delete(i.id);
                                else next.add(i.id);
                              }
                              return next;
                            })
                          }
                        >
                          {all ? "إلغاء الكل" : "اختيار الكل"}
                        </button>
                      </div>
                      {list.map((i) => (
                        <label key={i.id} className={`disc-item ${chosen.has(i.id) ? "is-on" : ""}`}>
                          <input type="checkbox" checked={chosen.has(i.id)} onChange={() => toggle(i.id)} />
                          <span className="disc-item__name">{i.nameAr}</span>
                          <span className="sale-price">
                            {chosen.has(i.id) && pctOk ? (
                              <>
                                <span className="price-now price-now--sale">{riyals(discountedPrice(i.priceHalalas, pct))}</span>
                                <s className="price-was">{riyals(i.priceHalalas)}</s>
                              </>
                            ) : (
                              <span className="price-now">{riyals(i.priceHalalas)}</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  );
                })}
                {chosen.size === 0 && <small className="field__error">اختر صنفًا واحدًا على الأقل</small>}
              </div>
            )}
            {scope === "all" && sample && pctOk && (
              <p className="muted small">
                مثال: {sample.nameAr} يصير <strong>{riyals(discountedPrice(sample.priceHalalas, pct))}</strong> بدل {riyals(sample.priceHalalas)}
              </p>
            )}
          </fieldset>

          <fieldset className="disc-field">
            <legend>المدة</legend>
            <div className="theme-switch" role="radiogroup" aria-label="المدة">
              {(
                [
                  ["manual", "لين أوقفه"],
                  ["at", "ينتهي في وقت محدد"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={ends === value} className={`theme-switch__opt ${ends === value ? "is-on" : ""}`} onClick={() => setEnds(value)}>
                  {label}
                </button>
              ))}
            </div>
            {ends === "at" && (
              <div className="disc-ends">
                <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} aria-label="وقت الانتهاء" />
                <button type="button" className="ohist__chip" onClick={() => setEndsAt(endOfToday())}>
                  نهاية اليوم
                </button>
              </div>
            )}
            {ends === "at" && !endsOk && <small className="field__error">اختر وقتًا بعد الحين</small>}
          </fieldset>

          <fieldset className="disc-field">
            <label className="disc-notify">
              <input type="checkbox" role="switch" className="switch" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={recipients === 0} />
              <span>
                <strong>أرسل إشعار للعملاء</strong>
                <small className="muted">
                  {recipients === null
                    ? "للمشتركين في «العروض والجديد»"
                    : recipients === 0
                      ? "ما فيه أحد مشترك في «العروض والجديد» حتى الآن"
                      : `يوصل لـ ${recipients} ${recipients === 1 ? "جهاز" : "أجهزة"} مشتركة في «العروض والجديد»`}
                </small>
              </span>
            </label>
            {notify && (
              <div className="disc-push">
                <div className="field">
                  <label htmlFor="disc-title">عنوان الإشعار</label>
                  <input id="disc-title" value={pushTitle} maxLength={BROADCAST_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="disc-body">نص الإشعار</label>
                  <textarea id="disc-body" rows={2} value={pushBody} maxLength={BROADCAST_BODY_MAX} onChange={(e) => setBody(e.target.value)} />
                </div>
                {(title !== null || body !== null) && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setTitle(null);
                      setBody(null);
                    }}
                  >
                    رجّع النص المقترح
                  </button>
                )}
              </div>
            )}
          </fieldset>

          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={!ready || (notify && (!pushTitle.trim() || !pushBody.trim()))}>
            {progress ?? (busy ? "جارٍ الحفظ…" : live ? "حفظ التعديل" : notify ? "تشغيل الخصم وإرسال الإشعار" : "تشغيل الخصم")}
          </button>
        </form>
      )}

      <ConfirmDialog
        open={confirmStop}
        title="إيقاف الخصم؟"
        message={<p>ترجع الأسعار مثل ما كانت فورًا. الطلبات اللي انطلبت بالخصم تبقى بسعرها.</p>}
        confirmLabel="إيقاف"
        tone="danger"
        onConfirm={() => void stop()}
        onCancel={() => setConfirmStop(false)}
      />
    </StaffLayout>
  );
}
