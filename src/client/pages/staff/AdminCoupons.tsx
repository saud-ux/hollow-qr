import { useEffect, useState, type FormEvent } from "react";
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
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      await benefitCall("save_coupon", { ...form, id: form.id || undefined });
      const c = await benefitCall<{ items: Coupon[] }>("coupons");
      setCoupons(c.items);
      setForm(empty());
      setOk(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function saveGifts() {
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
    <section className="panel">
      <h2>الكوبونات وأكواب الضيافة</h2>
      <p className="muted">
        الكوبونات تُدخل عند الدفع في الموقع والتطبيق فقط، ولا تُعرض للعملاء في
        قائمة.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      {ok && <Alert tone="success">تم الحفظ</Alert>}
      <div className="benefits-presets">
        {coupons.map((c) => (
          <button
            className="btn btn--secondary"
            key={c.id}
            onClick={() => {
              setForm(c);
              setOk(false);
            }}
          >
            {c.code} · {c.active ? "مفعّل" : "متوقف"}
          </button>
        ))}
        <button className="btn btn--ghost" onClick={() => setForm(empty())}>
          كوبون جديد
        </button>
      </div>
      <form className="form" onSubmit={(e) => void save(e)}>
        <label className="field">
          الكود
          <input
            required
            maxLength={40}
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
        <fieldset className="benefits-products">
          <legend>المنتجات المشمولة (بدون تحديد = كل المنتجات)</legend>
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
        <label>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
          />{" "}
          الكوبون مفعّل
        </label>
        <button className="btn btn--primary" disabled={busy}>
          حفظ الكوبون
        </button>
      </form>
      <details>
        <summary>القهوة المشمولة بأكواب الضيافة</summary>
        <p>
          اختر قهوة اليوم والمقطرة، الحارة والباردة فقط. هذه الإعدادات مشتركة
          للعشرة أشخاص.
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
          حفظ المشروبات المشمولة
        </button>
      </details>
    </section>
  );
}
