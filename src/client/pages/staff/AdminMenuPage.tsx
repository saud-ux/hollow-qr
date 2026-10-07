import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CATEGORY_LABELS_AR,
  toLatinDigits,
  WEEKDAY_LABELS_AR,
  type DayHours,
  type MenuCategory,
  MAX_MENU_OPTIONS,
  type MenuItem,
  type MenuOption,
  type ShopSettings,
} from "../../../shared/ordering";
import { Dialog } from "../../components/Dialog";
import { Alert, Field, Spinner } from "../../components/Field";
import { ItemImage } from "../../components/Shop";
import { StaffLayout } from "../../components/StaffLayout";
import { apiDelete, apiGet, apiPost, apiSend, apiUpload, errorText } from "../../lib/api";
import { riyals } from "../../lib/menu";

const MAX_IMAGE_SIDE = 1000;

/** Resizes a photo in the browser so uploads stay small (JPEG works on every iPhone). */
async function resizeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85),
  );
}

function toHalalas(input: string): number | null {
  const v = Number.parseFloat(toLatinDigits(input).replace(",", "."));
  return Number.isFinite(v) && v >= 0 && v <= 1000 ? Math.round(v * 100) : null;
}
const sar = (halalas: number) => String(halalas / 100);

export function AdminMenuPage() {
  return (
    <StaffLayout title="المنيو" wide>
      <MenuPanel />
    </StaffLayout>
  );
}

/** أوقات الطلبات والتوصيل: pause, pickup options, delivery fee and the weekly hours. */
export function AdminSettingsPage() {
  return (
    <StaffLayout title="أوقات الطلبات والتوصيل">
      <SettingsPanel />
    </StaffLayout>
  );
}

function SettingsPanel() {
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [fee, setFee] = useState("");
  const [minimum, setMinimum] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((r: { settings: ShopSettings; isOpen: boolean }) => {
    setSettings(r.settings);
    setIsOpen(r.isOpen);
    setFee(sar(r.settings.deliveryFeeHalalas));
    setMinimum(sar(r.settings.deliveryMinOrderHalalas));
  }, []);

  useEffect(() => {
    apiGet<{ settings: ShopSettings; isOpen: boolean }>("/api/admin/settings")
      .then(apply)
      .catch((e: unknown) => setError(errorText(e)));
  }, [apply]);

  if (!settings) return <section className="panel">{error ? <Alert tone="error">{error}</Alert> : <Spinner />}</section>;

  const setDay = (i: number, patch: Partial<DayHours>) =>
    setSettings({ ...settings, weeklyHours: settings.weeklyHours.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const feeH = toHalalas(fee);
    const minH = toHalalas(minimum);
    if (feeH === null || minH === null) {
      setError("اكتب رسوم التوصيل والحد الأدنى بالأرقام");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      apply(
        await apiSend<{ settings: ShopSettings; isOpen: boolean }>("PUT", "/api/admin/settings", {
          ...settings,
          deliveryFeeHalalas: feeH,
          deliveryMinOrderHalalas: minH,
        }),
      );
      setOk("تم حفظ الإعدادات");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>إعدادات الطلبات</h2>
      <p className={`shop-state ${isOpen ? "shop-state--open" : ""}`}>
        <span className="shop-state__dot" aria-hidden="true" />
        {isOpen ? "التطبيق يستقبل الطلبات الآن" : settings.orderingPaused ? "الطلبات متوقفة" : "خارج أوقات الدوام"}
      </p>
      <form className="form" onSubmit={save} noValidate>
        <div className="toggles">
          <Toggle label="إيقاف الطلبات مؤقتًا" checked={settings.orderingPaused} onChange={(v) => setSettings({ ...settings, orderingPaused: v })} />
          <Toggle label="استلام من الكاشير" checked={settings.pickupEnabled} onChange={(v) => setSettings({ ...settings, pickupEnabled: v })} />
          <Toggle label="استلام من السيارة" checked={settings.curbsideEnabled} onChange={(v) => setSettings({ ...settings, curbsideEnabled: v })} />
          <Toggle label="توصيل" checked={settings.deliveryEnabled} onChange={(v) => setSettings({ ...settings, deliveryEnabled: v })} />
        </div>
        <div className="form-row">
          <Field label="رسوم التوصيل (ريال)" inputMode="decimal" dir="ltr" value={fee} onChange={(e) => setFee(e.target.value)} />
          <Field label="الحد الأدنى للتوصيل (ريال)" inputMode="decimal" dir="ltr" value={minimum} onChange={(e) => setMinimum(e.target.value)} hint="0 = بدون حد أدنى" />
        </div>

        <fieldset className="hours">
          <legend>أوقات استقبال الطلبات</legend>
          <p className="muted small">إذا كان وقت الإغلاق قبل وقت الفتح، يمتد الدوام بعد منتصف الليل.</p>
          {settings.weeklyHours.map((d, i) => (
            <div key={i} className={`hours__row ${d.closed ? "is-closed" : ""}`}>
              <span className="hours__day">{WEEKDAY_LABELS_AR[i]}</span>
              <label className="hours__closed">
                <input type="checkbox" checked={!d.closed} onChange={(e) => setDay(i, { closed: !e.target.checked })} />
                مفتوح
              </label>
              <span className="hours__times">
                <input type="time" value={d.open} disabled={d.closed} onChange={(e) => setDay(i, { open: e.target.value })} aria-label={`فتح ${WEEKDAY_LABELS_AR[i]}`} />
                <span aria-hidden="true">إلى</span>
                <input type="time" value={d.close} disabled={d.closed} onChange={(e) => setDay(i, { close: e.target.value })} aria-label={`إغلاق ${WEEKDAY_LABELS_AR[i]}`} />
              </span>
            </div>
          ))}
        </fieldset>
        {error && <Alert tone="error">{error}</Alert>}
        {ok && <Alert tone="success">{ok}</Alert>}
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
        </button>
      </form>
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

type Draft = {
  id: string | null;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  category: MenuCategory;
  price: string;
  sortOrder: string;
  isAvailable: boolean;
  isArchived: boolean;
  optionLabel: string;
  optionLabelEn: string;
  options: MenuOption[];
  calories: string;
  isBestSeller: boolean;
};

const newOptionId = () => `opt-${Math.random().toString(36).slice(2, 8)}`;

const emptyDraft = (category: MenuCategory = "drink"): Draft => ({
  id: null,
  nameAr: "",
  nameEn: "",
  descriptionAr: "",
  descriptionEn: "",
  category,
  price: "",
  sortOrder: "500",
  isAvailable: true,
  isArchived: false,
  optionLabel: "",
  optionLabelEn: "",
  calories: "",
  options: [],
  isBestSeller: false,
});

function MenuPanel() {
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  const load = useCallback(
    () =>
      apiGet<{ items: MenuItem[] }>("/api/admin/menu")
        .then((r) => setItems(r.items))
        .catch((e: unknown) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const replace = (item: MenuItem) => setItems((list) => (list ? list.map((i) => (i.id === item.id ? item : i)) : list));

  async function quickToggle(item: MenuItem) {
    try {
      const { item: updated } = await apiSend<{ item: MenuItem }>("PATCH", `/api/admin/menu/${item.id}`, { isAvailable: !item.isAvailable });
      replace(updated);
    } catch (err) {
      setError(errorText(err));
    }
  }

  // «الأفضل مبيعًا»: shown together at the top of the customer menu.
  async function toggleBestSeller(item: MenuItem) {
    try {
      const { item: updated } = await apiSend<{ item: MenuItem }>("PATCH", `/api/admin/menu/${item.id}`, { isBestSeller: !item.isBestSeller });
      replace(updated);
    } catch (err) {
      setError(errorText(err));
    }
  }

  // Turn one origin on or off without opening the editor.
  async function toggleOption(item: MenuItem, optionId: string) {
    const options = item.options.map((o) => (o.id === optionId ? { ...o, isAvailable: !o.isAvailable } : o));
    try {
      replace((await apiSend<{ item: MenuItem }>("PATCH", `/api/admin/menu/${item.id}`, { options })).item);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function upload(item: MenuItem, file: File | undefined) {
    if (!file) return;
    setUploading(item.id);
    setError(null);
    try {
      const blob = await resizeImage(file);
      const { item: updated } = await apiUpload<{ item: MenuItem }>(`/api/admin/menu/${item.id}/image`, blob);
      replace(updated);
    } catch (err) {
      setError(err instanceof Error && err.message === "encode" ? "تعذّر قراءة الصورة" : errorText(err));
    } finally {
      setUploading(null);
    }
  }

  async function removeImage(item: MenuItem) {
    try {
      replace((await apiDelete<{ item: MenuItem }>(`/api/admin/menu/${item.id}/image`)).item);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const price = toHalalas(draft.price);
    const sortOrder = Number.parseInt(toLatinDigits(draft.sortOrder), 10);
    if (!draft.nameAr.trim()) return setDraftError("اكتب اسم الصنف");
    if (price === null) return setDraftError("اكتب السعر بالأرقام (مثال: 15 أو 15.5)");
    if (!Number.isFinite(sortOrder) || sortOrder < 0) return setDraftError("الترتيب رقم من 0 فأكثر");
    const kcalText = toLatinDigits(draft.calories).trim();
    const calories = kcalText ? Number(kcalText) : null;
    if (calories !== null && (!Number.isInteger(calories) || calories < 0 || calories > 5000)) {
      return setDraftError("السعرات رقم صحيح من 0 إلى 5000، أو اتركها فاضية");
    }
    const options = draft.options
      .map((o) => ({
        ...o,
        nameAr: o.nameAr.trim(),
        nameEn: o.nameEn?.trim() || null,
        noteAr: o.noteAr?.trim() || null,
        noteEn: o.noteEn?.trim() || null,
      }))
      .filter((o) => o.nameAr);
    const body = {
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim() || null,
      descriptionAr: draft.descriptionAr.trim() || null,
      descriptionEn: draft.descriptionEn.trim() || null,
      category: draft.category,
      priceHalalas: price,
      sortOrder,
      isAvailable: draft.isAvailable,
      isArchived: draft.isArchived,
      optionLabel: options.length ? draft.optionLabel.trim() || "النوع" : null,
      optionLabelEn: options.length ? draft.optionLabelEn.trim() || null : null,
      options,
      calories,
      isBestSeller: draft.isBestSeller,
    };
    setBusy(true);
    setDraftError(null);
    try {
      if (draft.id) {
        replace((await apiSend<{ item: MenuItem }>("PATCH", `/api/admin/menu/${draft.id}`, body)).item);
      } else {
        await apiPost<{ item: MenuItem }>("/api/admin/menu", body);
        await load();
      }
      setDraft(null);
    } catch (err) {
      setDraftError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const edit = (i: MenuItem) =>
    setDraft({
      id: i.id,
      nameAr: i.nameAr,
      nameEn: i.nameEn ?? "",
      descriptionAr: i.descriptionAr ?? "",
      descriptionEn: i.descriptionEn ?? "",
      category: i.category,
      price: sar(i.priceHalalas),
      sortOrder: String(i.sortOrder),
      isAvailable: i.isAvailable,
      isArchived: i.isArchived,
      optionLabel: i.optionLabel ?? "",
      optionLabelEn: i.optionLabelEn ?? "",
      options: i.options,
      calories: i.calories === null ? "" : String(i.calories),
      isBestSeller: i.isBestSeller,
    });

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>الأصناف</h2>
        <button type="button" className="btn btn--primary btn--small" onClick={() => setDraft(emptyDraft())}>
          + صنف جديد
        </button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {!items && !error && <Spinner />}
      {items &&
        (["drink", "dessert"] as MenuCategory[]).map((cat) => {
          const list = items.filter((i) => i.category === cat && !i.isArchived);
          return (
            <div key={cat} className="admin-menu">
              <h3 className="pass-label">{CATEGORY_LABELS_AR[cat]}</h3>
              <ul>
                {list.map((i) => (
                  <MenuRow
                    key={i.id}
                    item={i}
                    uploading={uploading === i.id}
                    onToggle={() => void quickToggle(i)}
                    onEdit={() => edit(i)}
                    onUpload={(f) => void upload(i, f)}
                    onRemoveImage={() => void removeImage(i)}
                    onToggleOption={(id) => void toggleOption(i, id)}
                    onToggleBest={() => void toggleBestSeller(i)}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      {items && items.some((i) => i.isArchived) && (
        <details className="admin-menu">
          <summary>أصناف مخفية ({items.filter((i) => i.isArchived).length})</summary>
          <ul>
            {items
              .filter((i) => i.isArchived)
              .map((i) => (
                <MenuRow
                  key={i.id}
                  item={i}
                  uploading={false}
                  onToggle={() => void quickToggle(i)}
                  onEdit={() => edit(i)}
                  onUpload={(f) => void upload(i, f)}
                  onRemoveImage={() => void removeImage(i)}
                  onToggleOption={(id) => void toggleOption(i, id)}
                  onToggleBest={() => void toggleBestSeller(i)}
                />
              ))}
          </ul>
        </details>
      )}

      <Dialog open={draft !== null} title={draft?.id ? "تعديل صنف" : "صنف جديد"} onClose={() => setDraft(null)}>
        {draft && (
          <form className="form" onSubmit={saveDraft} noValidate>
            <Field label="الاسم بالعربي" value={draft.nameAr} onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })} maxLength={60} />
            <Field label="الاسم بالإنجليزي (اختياري)" dir="ltr" value={draft.nameEn} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} maxLength={60} />
            <div className="field">
              <label htmlFor="desc">الوصف (اختياري)</label>
              <textarea id="desc" rows={2} value={draft.descriptionAr} onChange={(e) => setDraft({ ...draft, descriptionAr: e.target.value })} maxLength={200} />
            </div>
            <div className="field">
              <label htmlFor="desc-en">الوصف بالإنجليزي (اختياري)</label>
              <textarea
                id="desc-en"
                dir="ltr"
                rows={2}
                value={draft.descriptionEn}
                onChange={(e) => setDraft({ ...draft, descriptionEn: e.target.value })}
                maxLength={300}
                placeholder="Shown when the app is in English"
              />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="cat">القسم</label>
                <select id="cat" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as MenuCategory })}>
                  <option value="drink">مشروب (يحسب كوب في الولاء)</option>
                  <option value="dessert">حلا</option>
                </select>
              </div>
              <Field label="السعر (ريال)" inputMode="decimal" dir="ltr" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
            </div>
            <Field
              label="السعرات الحرارية (اختياري)"
              inputMode="numeric"
              dir="ltr"
              value={draft.calories}
              onChange={(e) => setDraft({ ...draft, calories: e.target.value })}
              hint="للحصة الواحدة، تظهر تحت السعر في المنيو"
            />
            <Field label="الترتيب" inputMode="numeric" dir="ltr" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} hint="الأصغر يظهر أولًا" />
            <Toggle label="متوفر للطلب" checked={draft.isAvailable} onChange={(v) => setDraft({ ...draft, isAvailable: v })} />
            <Toggle label="الأفضل مبيعًا (يظهر أعلى المنيو)" checked={draft.isBestSeller} onChange={(v) => setDraft({ ...draft, isBestSeller: v })} />
            {draft.id && <Toggle label="إخفاء من المنيو" checked={draft.isArchived} onChange={(v) => setDraft({ ...draft, isArchived: v })} />}
            <fieldset className="options-editor">
              <legend>خيارات يختار منها العميل (مثل المحصول)</legend>
              {draft.options.length > 0 && (
                <div className="form-row">
                  <Field
                    label="عنوان الاختيار"
                    value={draft.optionLabel}
                    onChange={(e) => setDraft({ ...draft, optionLabel: e.target.value })}
                    maxLength={40}
                    placeholder="المحصول"
                  />
                  <Field
                    label="بالإنجليزي"
                    dir="ltr"
                    value={draft.optionLabelEn}
                    onChange={(e) => setDraft({ ...draft, optionLabelEn: e.target.value })}
                    maxLength={40}
                    placeholder="origin"
                  />
                </div>
              )}
              {draft.options.map((o, idx) => (
                <div key={o.id} className="options-editor__row">
                  <input
                    className="options-editor__name"
                    value={o.nameAr}
                    onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === idx ? { ...x, nameAr: e.target.value } : x)) })}
                    placeholder="الاسم، مثل: إثيوبي"
                    maxLength={40}
                    aria-label="اسم الخيار"
                  />
                  <input
                    className="options-editor__note"
                    value={o.noteAr ?? ""}
                    onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === idx ? { ...x, noteAr: e.target.value } : x)) })}
                    placeholder="وصف الطعم، مثل: فواكه وأزهار"
                    maxLength={80}
                    aria-label="وصف الطعم"
                  />
                  <input
                    dir="ltr"
                    value={o.nameEn ?? ""}
                    onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === idx ? { ...x, nameEn: e.target.value } : x)) })}
                    placeholder="English name, e.g. Ethiopian"
                    maxLength={40}
                    aria-label="اسم الخيار بالإنجليزي"
                  />
                  <input
                    dir="ltr"
                    value={o.noteEn ?? ""}
                    onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === idx ? { ...x, noteEn: e.target.value } : x)) })}
                    placeholder="English note, e.g. fruity, floral"
                    maxLength={80}
                    aria-label="وصف الطعم بالإنجليزي"
                  />
                  <Toggle
                    label={o.isAvailable ? "متوفر" : "نفد"}
                    checked={o.isAvailable}
                    onChange={(v) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === idx ? { ...x, isAvailable: v } : x)) })}
                  />
                  <button
                    type="button"
                    className="link-btn link-btn--danger"
                    onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== idx) })}
                  >
                    حذف
                  </button>
                </div>
              ))}
              {draft.options.length < MAX_MENU_OPTIONS && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      optionLabel: draft.optionLabel || "المحصول",
                      options: [...draft.options, { id: newOptionId(), nameAr: "", nameEn: null, noteAr: null, noteEn: null, isAvailable: true }],
                    })
                  }
                >
                  + إضافة خيار
                </button>
              )}
            </fieldset>
            {draftError && <Alert tone="error">{draftError}</Alert>}
            <div className="dialog__actions">
              <button type="submit" className="btn btn--primary" disabled={busy}>
                {busy ? "جارٍ الحفظ…" : "حفظ"}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setDraft(null)}>
                إلغاء
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}

function MenuRow({
  item,
  uploading,
  onToggle,
  onEdit,
  onUpload,
  onRemoveImage,
  onToggleOption,
  onToggleBest,
}: {
  item: MenuItem;
  uploading: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onUpload: (file: File | undefined) => void;
  onRemoveImage: () => void;
  onToggleOption: (optionId: string) => void;
  onToggleBest: () => void;
}) {
  return (
    <li className={`admin-menu__row ${item.isAvailable ? "" : "is-off"}`}>
      <label className="admin-menu__img" title="تغيير الصورة">
        <ItemImage item={item} />
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            onUpload(e.target.files?.[0]);
            e.target.value = "";
          }}
          aria-label={`صورة ${item.nameAr}`}
        />
        <span className="admin-menu__img-label">{uploading ? "جارٍ الرفع…" : item.imageUrl ? "تغيير" : "إضافة صورة"}</span>
      </label>
      <div className="admin-menu__info">
        <strong>{item.nameAr}</strong>
        <span>{riyals(item.priceHalalas)}</span>
        {item.imageUrl && (
          <button type="button" className="link-btn" onClick={onRemoveImage}>
            حذف الصورة
          </button>
        )}
        {item.options.length > 0 && (
          <div className="admin-origins" aria-label={item.optionLabel ?? "الخيارات"}>
            {item.options.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`admin-origin ${o.isAvailable ? "" : "is-out"}`}
                aria-pressed={o.isAvailable}
                onClick={() => onToggleOption(o.id)}
                title={o.isAvailable ? "اضغط إذا نفد" : "اضغط إذا توفر"}
              >
                {o.nameAr} · {o.isAvailable ? "متوفر" : "نفد"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="admin-menu__actions">
        <Toggle label={item.isAvailable ? "متوفر" : "نفد"} checked={item.isAvailable} onChange={onToggle} />
        <button
          type="button"
          className={`best-toggle ${item.isBestSeller ? "is-on" : ""}`}
          aria-pressed={item.isBestSeller}
          onClick={onToggleBest}
          title={item.isBestSeller ? "اضغط لإزالته من الأفضل مبيعًا" : "اضغط لإضافته للأفضل مبيعًا"}
        >
          ★ الأفضل مبيعًا
        </button>
        <button type="button" className="btn btn--small btn--ghost" onClick={onEdit}>
          تعديل
        </button>
      </div>
    </li>
  );
}
