import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Coupon } from "../../../shared/benefits";
import { benefitCall } from "../../lib/benefits";
import { useMenu } from "../../lib/menu";
import { errorText } from "../../lib/api";
import { Alert } from "../../components/Field";

const empty = (): Coupon => ({
  id: "",
  code: "",
  kind: "percent",
  value: 20,
  item_ids: [],
  minimum_halalas: 0,
  maximum_halalas: null,
  per_customer_limit: 1,
  starts_at: null,
  ends_at: null,
  active: true,
});
const localDate = (s: string | null) =>
  s
    ? new Date(new Date(s).getTime() - new Date(s).getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
export function AdminCoupons() {
  const { menu } = useMenu();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [form, setForm] = useState<Coupon>(empty);
  const [gifts, setGifts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (editorOpen) editorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [editorOpen, form.id]);
  useEffect(() => {
    let live = true;
    Promise.all([
      benefitCall<{ items: Coupon[] }>("coupons"),
      benefitCall<{ items: string[] }>("gift_items"),
    ])
      .then(([c, g]) => {
        if (live) {
          setCoupons(c.items);
          setGifts(g.items);
        }
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!form.code.trim()) {
      setError("اكتب كود الكوبون أولًا");
      return;
    }
    if (form.starts_at && form.ends_at && form.ends_at <= form.starts_at) {
      setError("تاريخ النهاية يجب أن يكون بعد تاريخ البداية");
      return;
    }
    if (coupons.some((c) => c.id !== form.id && c.code === form.code.trim().toLowerCase())) {
      setError("هذا الكود موجود مسبقًا، اختر كودًا آخر أو عدّل الكوبون الموجود");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      await benefitCall("save_coupon", { ...form, id: form.id || undefined });
      const c = await benefitCall<{ items: Coupon[] }>("coupons");
      setCoupons(c.items);
      setForm(empty());
      setEditorOpen(false);
      setOk(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function saveGifts() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      await benefitCall("save_gift_items", { items: gifts });
      setOk(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel admin-coupons">
      <h2>الكوبونات وأكواب الضيافة</h2>
      <p className="muted">
        الكوبونات تُدخل عند الدفع في الموقع والتطبيق فقط، ولا تُعرض للعملاء في
        قائمة.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      {ok && <Alert tone="success">تم الحفظ</Alert>}
      <div className="admin-panel-heading">
        <div><h3>كوبونات الخصم</h3><p className="muted">{coupons.length} كوبون · اختر كوبونًا لتعديله</p></div>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => {
          setForm(empty()); setEditorOpen(true); setError(null); setOk(false);
        }}>+ كوبون جديد</button>
      </div>
      <div className="admin-coupon-list">
        {coupons.map((c) => (
          <button
            className={`admin-coupon-card ${editorOpen && form.id === c.id ? "is-selected" : ""}`}
            type="button" disabled={busy}
            key={c.id}
            onClick={() => {
              setForm(c);
              setEditorOpen(true);
              setError(null);
              setOk(false);
            }}
          >
            <span><strong dir="auto">{c.code}</strong><small>{c.kind === "percent" ? `${c.value}% خصم` : `${c.value / 100} ريال خصم`}</small></span>
            <span className={`badge ${c.active ? "badge--gold" : "badge--muted"}`}>{c.active ? "مفعّل" : "متوقف"}</span>
            <span className="admin-coupon-card__edit">تعديل ‹</span>
          </button>
        ))}
        {coupons.length === 0 && <p className="muted">ما عندك كوبونات حتى الآن. ابدأ بإضافة أول كوبون.</p>}
      </div>
      {editorOpen && <form ref={editorRef} className="form admin-coupon-editor" onSubmit={(e) => void save(e)} onInvalidCapture={(e) => {
        const details = (e.target as HTMLElement).closest("details");
        if (details) details.open = true;
      }}>
        <h3>{form.id ? "تعديل الكوبون" : "إضافة كوبون جديد"}</h3>
        <div className="admin-form-grid">
        <label className="field">
          كود الكوبون
          <input
            required
            maxLength={40}
            placeholder="مثال: HOLLOW20"
            dir="ltr" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </label>
        <label className="field">
          نوع الخصم
          <select
            value={form.kind}
            onChange={(e) =>
              setForm({
                ...form,
                kind: e.target.value as Coupon["kind"],
                value: e.target.value === "percent" ? 20 : 500,
              })
            }
          >
            <option value="percent">نسبة مئوية</option>
            <option value="fixed">مبلغ بالريال</option>
          </select>
        </label>
        <label className="field">
          {form.kind === "percent" ? "النسبة %" : "المبلغ بالريال"}
          <input
            type="number"
            required
            min={form.kind === "percent" ? 1 : 0.01}
            max={form.kind === "percent" ? 100 : 10000}
            step={form.kind === "percent" ? 1 : 0.01}
            value={form.kind === "percent" ? form.value : form.value / 100}
            onChange={(e) =>
              setForm({
                ...form,
                value: Math.round(
                  Number(e.target.value) * (form.kind === "fixed" ? 100 : 1),
                ),
              })
            }
          />
        </label>
        </div>
        <details className="admin-disclosure">
          <summary>المنتجات المشمولة <span>{form.item_ids.length ? `${form.item_ids.length} منتجات` : "جميع المنتجات"}</span></summary>
          <fieldset className="benefits-products">
          <legend>اتركها بدون تحديد ليشمل الكوبون جميع المنتجات</legend>
          {menu?.items.map((i) => (
            <label key={i.id}>
              <input
                type="checkbox"
                checked={form.item_ids.includes(i.id)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    item_ids: e.target.checked
                      ? [...form.item_ids, i.id]
                      : form.item_ids.filter((id) => id !== i.id),
                  })
                }
              />
              {i.nameAr}
            </label>
          ))}
          </fieldset>
        </details>
        <details className="admin-disclosure">
          <summary>شروط الاستخدام والمدة <span>اختياري</span></summary>
          <div className="admin-form-grid">
        <label className="field">
          الحد الأدنى للطلب بالريال
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.minimum_halalas / 100}
            onChange={(e) =>
              setForm({
                ...form,
                minimum_halalas: Math.round(Number(e.target.value) * 100),
              })
            }
          />
        </label>
        <label className="field">
          أقصى خصم بالريال (فارغ = بدون سقف)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={
              form.maximum_halalas === null ? "" : form.maximum_halalas / 100
            }
            onChange={(e) =>
              setForm({
                ...form,
                maximum_halalas: e.target.value
                  ? Math.round(Number(e.target.value) * 100)
                  : null,
              })
            }
          />
        </label>
        <label className="field">
          مرات الاستخدام لكل عميل (فارغ = بدون حد)
          <input
            type="number"
            min="1"
            step="1"
            value={form.per_customer_limit ?? ""}
            onChange={(e) =>
              setForm({
                ...form,
                per_customer_limit: e.target.value
                  ? Number(e.target.value)
                  : null,
              })
            }
          />
        </label>
        <label className="field">
          البداية (اختياري)
          <input
            type="datetime-local"
            value={localDate(form.starts_at)}
            onChange={(e) =>
              setForm({
                ...form,
                starts_at: e.target.value
                  ? new Date(e.target.value).toISOString()
                  : null,
              })
            }
          />
        </label>
        <label className="field">
          النهاية (فارغ = بدون انتهاء)
          <input
            type="datetime-local"
            value={localDate(form.ends_at)}
            onChange={(e) =>
              setForm({
                ...form,
                ends_at: e.target.value
                  ? new Date(e.target.value).toISOString()
                  : null,
              })
            }
          />
        </label>
          </div>
        </details>
        <label className="admin-toggle-row">
          <input
            className="switch"
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />{" "}
          الكوبون مفعّل
        </label>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="admin-form-actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "جارٍ الحفظ…" : "حفظ الكوبون"}
          </button>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => { setEditorOpen(false); setError(null); }}>إلغاء</button>
        </div>
      </form>}
      <details className="admin-disclosure admin-gifts">
        <summary>القهوة المشمولة بأكواب الضيافة</summary>
        <p>
          حدّد المشروبات التي يمكن للعميل استخدام أكواب الضيافة عليها.
        </p>
        <div className="benefits-products">
          {menu?.items
            .filter((i) => i.category === "drink")
            .map((i) => (
              <label key={i.id}>
                <input
                  type="checkbox"
                  checked={gifts.includes(i.id)}
                  onChange={(e) =>
                    setGifts(
                      e.target.checked
                        ? [...gifts, i.id]
                        : gifts.filter((id) => id !== i.id),
                    )
                  }
                />
                {i.nameAr}
              </label>
            ))}
        </div>
        <button
          className="btn btn--secondary"
          disabled={busy}
          onClick={() => void saveGifts()}
        >
          {busy ? "جارٍ الحفظ…" : "حفظ مشروبات الضيافة"}
        </button>
      </details>
    </section>
  );
}
