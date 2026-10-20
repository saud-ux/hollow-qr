import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CATEGORY_LABELS_AR,
  isOrderable,
  toLatinDigits,
  WEEKDAY_LABELS_AR,
  type DayHours,
  type MenuCategory,
  MAX_MENU_OPTIONS,
  MENU_CATEGORIES,
  type MenuItem,
  type MenuOption,
  type ShopSettings,
} from "../../../shared/ordering";
import { normalizeSearch } from "../../../shared/menu-search";
import { Dialog } from "../../components/Dialog";
import { Alert, Field, Spinner } from "../../components/Field";
import { ItemImage } from "../../components/Shop";
import { showToast } from "../../components/Toast";
import { StaffIcon, StaffLayout } from "../../components/StaffLayout";
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
  const [storedPaused, setStoredPaused] = useState(false);
  const [fee, setFee] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedDay, setExpandedDay] = useState<number | null>(0);
  const [copyDay, setCopyDay] = useState(0);
  const [saved, setSaved] = useState("");

  const apply = useCallback((r: { settings: ShopSettings; isOpen: boolean }) => {
    setSettings(r.settings);
    setIsOpen(r.isOpen);
    setStoredPaused(r.settings.orderingPaused);
    setFee(sar(r.settings.deliveryFeeHalalas));
    setSaved(JSON.stringify({ settings: r.settings, fee: sar(r.settings.deliveryFeeHalalas) }));
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
    if (!settings || busy) return;
    const invalidDay = settings.weeklyHours.findIndex((d) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.close));
    if (invalidDay !== -1) {
      setExpandedDay(invalidDay);
      setError(`حدّد وقت الفتح والإغلاق ليوم ${WEEKDAY_LABELS_AR[invalidDay]}`);
      return;
    }
    const feeH = toHalalas(fee);
    if (feeH === null) {
      setError("اكتب رسوم التوصيل بالأرقام");
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
          // No minimum order for delivery.
          deliveryMinOrderHalalas: 0,
        }),
      );
      setOk("تم حفظ الإعدادات");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const dirty = JSON.stringify({ settings, fee }) !== saved;
  const timeLabel = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? new Intl.DateTimeFormat("ar-SA", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`2000-01-01T${value}:00Z`))
    : "حدّد الوقت";

  return (
    <form className="ordering-settings" onSubmit={save} noValidate onChangeCapture={() => setOk(null)}>
      <section className="panel ordering-status">
        <div className="ordering-section-title"><span className="ordering-icon"><StaffIcon name="orders" /></span><div><h2>استقبال الطلبات</h2></div></div>
        <p className={`shop-state ${isOpen ? "shop-state--open" : ""}`}>
          <span className="shop-state__dot" aria-hidden="true" />
          {isOpen ? "نستقبل الطلبات الآن" : storedPaused ? "الطلبات متوقفة مؤقتًا" : "خارج أوقات الدوام"}
        </p>
        <label className="ordering-option ordering-option--pause">
          <span><strong>إيقاف الطلبات مؤقتًا</strong></span>
          <input className="switch" type="checkbox" role="switch" aria-label="إيقاف الطلبات مؤقتًا" checked={settings.orderingPaused} disabled={busy} onChange={(e) => setSettings({ ...settings, orderingPaused: e.target.checked })} />
        </label>
      </section>

      <section className="panel">
        <div className="ordering-section-title"><span className="ordering-icon"><StaffIcon name="stock" /></span><div><h2>الاستلام والتوصيل</h2></div></div>
        <div className="ordering-methods">
          {([
            ["pickupEnabled", "استلام من الكاشير"],
            ["curbsideEnabled", "استلام من السيارة"],
            ["deliveryEnabled", "التوصيل"],
          ] as const).map(([key, title]) => (
            <label className="ordering-option" key={key}>
              <span><strong>{title}</strong></span>
              <input className="switch" type="checkbox" role="switch" aria-label={title} checked={settings[key]} disabled={busy} onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })} />
            </label>
          ))}
        </div>
        <div className="ordering-fee">
          <Field label="رسوم التوصيل بالريال" inputMode="decimal" dir="ltr" value={fee} disabled={busy} onChange={(e) => setFee(e.target.value)} />
        </div>
      </section>

      <section className="panel">
        <div className="ordering-section-title"><span className="ordering-icon"><StaffIcon name="settings" /></span><div><h2>جدول استقبال الطلبات</h2></div></div>
        <div className="ordering-copy">
          <label className="field">نسخ وقت يوم للأيام المفتوحة
            <select value={copyDay} disabled={busy} onChange={(e) => setCopyDay(Number(e.target.value))}>
              {settings.weeklyHours.map((_, i) => <option key={i} value={i}>{WEEKDAY_LABELS_AR[i]}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn--secondary" disabled={busy || !settings.weeklyHours[copyDay]?.open || !settings.weeklyHours[copyDay]?.close} onClick={() => {
            const source = settings.weeklyHours[copyDay]!;
            setSettings({ ...settings, weeklyHours: settings.weeklyHours.map((day) => day.closed ? day : { ...day, open: source.open, close: source.close }) });
            setOk(null);
            showToast("تم نسخ الأوقات");
          }}>نسخ الأوقات</button>
        </div>
        <div className="ordering-week">
          {settings.weeklyHours.map((d, i) => (
            <div key={i} className={`ordering-day ${expandedDay === i ? "is-expanded" : ""} ${d.closed ? "is-closed" : ""}`}>
              <div className="ordering-day__head">
                <button className="ordering-day__summary" type="button" aria-expanded={expandedDay === i} aria-controls={`day-times-${i}`} onClick={() => setExpandedDay(expandedDay === i ? null : i)}>
                  <span><strong>{WEEKDAY_LABELS_AR[i]}</strong><small>{d.closed ? "مغلق" : d.open === d.close ? "مفتوح 24 ساعة" : `${timeLabel(d.open)} – ${timeLabel(d.close)}`}</small></span>
                  <span className="ordering-day__chevron" aria-hidden="true">⌄</span>
                </button>
                <input className="switch" type="checkbox" role="switch" aria-label={`فتح ${WEEKDAY_LABELS_AR[i]} للطلبات`} checked={!d.closed} disabled={busy} onChange={(e) => {
                  setDay(i, { closed: !e.target.checked });
                  if (e.target.checked) setExpandedDay(i);
                }} />
              </div>
              <div id={`day-times-${i}`} hidden={expandedDay !== i} className="ordering-day__details">
                {!d.closed && <>
                  <div className="ordering-time-grid">
                    <Field label="من" type="time" dir="ltr" value={d.open} disabled={busy} onChange={(e) => setDay(i, { open: e.target.value })} aria-label={`وقت فتح ${WEEKDAY_LABELS_AR[i]}`} />
                    <Field label="إلى" type="time" dir="ltr" value={d.close} disabled={busy} onChange={(e) => setDay(i, { close: e.target.value })} aria-label={`وقت إغلاق ${WEEKDAY_LABELS_AR[i]}`} />
                  </div>
                </>}
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="ordering-save">
        {error && <Alert tone="error">{error}</Alert>}
        {ok && <Alert tone="success">{ok}</Alert>}
        <div className="ordering-save__row">
          <span aria-live="polite">{dirty ? "عندك تعديلات غير محفوظة" : "الإعدادات محفوظة"}</span>
          <button type="submit" className="btn btn--primary" disabled={busy || !dirty}>{busy ? "جارٍ الحفظ…" : "حفظ التغييرات"}</button>
        </div>
      </div>
    </form>
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

/** The next free position in a section: 1, 2, 3… */
const nextPosition = (items: MenuItem[] | null, category: MenuCategory) =>
  String((items ?? []).filter((i) => i.category === category && !i.isArchived).length + 1);

const emptyDraft = (category: MenuCategory = "drink", position = "1"): Draft => ({
  id: null,
  nameAr: "",
  nameEn: "",
  descriptionAr: "",
  descriptionEn: "",
  category,
  price: "",
  sortOrder: position,
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
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | MenuCategory>("all");
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // «حذف الصنف» asks once more before it deletes.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const closeDraft = () => {
    setDraft(null);
    setConfirmingDelete(false);
  };
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
    if (updating) return;
    setUpdating(true);
    setError(null);
    try {
      const { item: updated } = await apiSend<{ item: MenuItem }>("PATCH", `/api/admin/menu/${item.id}`, { isAvailable: !item.isAvailable });
      replace(updated);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setUpdating(false);
    }
  }

  async function toggleBestSeller(item: MenuItem) {
    if (updating) return;
    setUpdating(true);
    setError(null);
    try {
      const { item: updated } = await apiSend<{ item: MenuItem }>("PATCH", `/api/admin/menu/${item.id}`, { isBestSeller: !item.isBestSeller });
      replace(updated);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setUpdating(false);
    }
  }

  async function upload(item: MenuItem, file: File | undefined) {
    if (!file) return;
    setUploading(item.id);
    setError(null);
    setDraftError(null);
    try {
      const blob = await resizeImage(file);
      const { item: updated } = await apiUpload<{ item: MenuItem }>(`/api/admin/menu/${item.id}/image`, blob);
      replace(updated);
    } catch (err) {
      setDraftError(err instanceof Error && err.message === "encode" ? "تعذّر قراءة الصورة" : errorText(err));
    } finally {
      setUploading(null);
    }
  }

  async function removeImage(item: MenuItem) {
    setUploading(item.id);
    setDraftError(null);
    try {
      replace((await apiDelete<{ item: MenuItem }>(`/api/admin/menu/${item.id}/image`)).item);
    } catch (err) {
      setDraftError(errorText(err));
    } finally {
      setUploading(null);
    }
  }

  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!draft || busy || uploading !== null) return;
    const price = toHalalas(draft.price);
    const sortOrder = Number.parseInt(toLatinDigits(draft.sortOrder), 10);
    if (!draft.nameAr.trim()) return setDraftError("اكتب اسم الصنف");
    if (price === null) return setDraftError("اكتب السعر بالأرقام (مثال: 15 أو 15.5)");
    if (!Number.isFinite(sortOrder) || sortOrder < 1) return setDraftError("الترتيب رقم من 1 فأكثر");
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
      if (draft.id) await apiSend<{ item: MenuItem }>("PATCH", `/api/admin/menu/${draft.id}`, body);
      else await apiPost<{ item: MenuItem }>("/api/admin/menu", body);
      // Positions around the item may have moved, so reload the whole list.
      await load();
      closeDraft();
    } catch (err) {
      setDraftError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft() {
    if (!draft?.id || busy || uploading !== null) return;
    setBusy(true);
    setDraftError(null);
    try {
      await apiDelete<{ ok: true; kept: boolean }>(`/api/admin/menu/${draft.id}`);
      showToast(`انحذف «${draft.nameAr}»`);
      // The others in its section moved up, so reload the whole list.
      await load();
      closeDraft();
    } catch (err) {
      setDraftError(errorText(err));
      setConfirmingDelete(false);
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

  const words = normalizeSearch(query).split(" ").filter(Boolean);
  const matches = (item: MenuItem) => {
    const text = normalizeSearch([item.nameAr, item.nameEn, ...item.options.map((o) => o.nameAr)].join(" "));
    return (category === "all" || item.category === category) && words.every((word) => text.includes(word));
  };
  const draftItem = items?.find((item) => item.id === draft?.id);
  const visibleItems = items?.filter((item) => !item.isArchived && matches(item)) ?? [];
  const hiddenItems = items?.filter((item) => item.isArchived && matches(item)) ?? [];

  return (
    <section className="panel catalog-panel">
      <div className="panel__head catalog-heading">
        <h2>الأصناف</h2>
        <button type="button" className="btn btn--primary" disabled={updating} onClick={() => {
          setDraftError(null); setConfirmingDelete(false);
          // A new item goes in the section on screen (drinks when all are shown).
          const section = category === "all" ? "drink" : category;
          setDraft(emptyDraft(section, nextPosition(items, section)));
        }}>+ صنف جديد</button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {!items && !error && <Spinner />}
      {items && <>
        <div className="catalog-search"><Field label="بحث الأصناف" type="search" placeholder="ابحث عن صنف" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="catalog-tabs" role="group" aria-label="أقسام المنيو">
          {(["all", ...MENU_CATEGORIES] as const).map((key) => (
            <button key={key} type="button" aria-pressed={category === key} onClick={() => setCategory(key)}>{key === "all" ? "الكل" : CATEGORY_LABELS_AR[key]}</button>
          ))}
        </div>
        {visibleItems.length === 0 && <p className="empty">لا توجد أصناف مطابقة</p>}
        {MENU_CATEGORIES.map((cat) => {
          const list = visibleItems.filter((item) => item.category === cat);
          if (!list.length) return null;
          return <div key={cat} className="admin-menu catalog-section">
            <h3 className="pass-label">{CATEGORY_LABELS_AR[cat]} <span className="catalog-count">{list.length}</span></h3>
            <ul className="catalog-grid">
              {list.map((item) => <MenuRow key={item.id} item={item} disabled={updating}
                onToggle={() => void quickToggle(item)} onEdit={() => { setDraftError(null); setConfirmingDelete(false); edit(item); }}
                onToggleBest={() => void toggleBestSeller(item)} />)}
            </ul>
          </div>;
        })}
        {hiddenItems.length > 0 && <details className="admin-menu catalog-section catalog-archived">
          <summary>أصناف مخفية ({hiddenItems.length})</summary>
          <ul className="catalog-grid">
            {hiddenItems.map((item) => <MenuRow key={item.id} item={item} disabled={updating}
              onToggle={() => void quickToggle(item)} onEdit={() => { setDraftError(null); setConfirmingDelete(false); edit(item); }}
              onToggleBest={() => void toggleBestSeller(item)} />)}
          </ul>
        </details>}
      </>}

      <Dialog open={draft !== null} dismissible title={draft?.id ? "تعديل صنف" : "صنف جديد"} onClose={() => { if (!busy && !uploading) closeDraft(); }}>
        {draft && (
          <form className="form" onSubmit={saveDraft} noValidate>
            {draftItem && <div className="catalog-photo-editor">
              <ItemImage item={draftItem} />
              <div className="catalog-photo-editor__actions">
                <label className="btn btn--secondary catalog-upload">
                  {uploading === draftItem.id ? "جارٍ التحديث…" : draftItem.imageUrl ? "تغيير الصورة" : "إضافة صورة"}
                  <input type="file" accept="image/*" disabled={busy || uploading !== null} aria-label={`صورة ${draftItem.nameAr}`} onChange={(e) => {
                    void upload(draftItem, e.target.files?.[0]); e.target.value = "";
                  }} />
                </label>
                {draftItem.imageUrl && <button type="button" className="btn btn--danger-soft" disabled={busy || uploading !== null} onClick={() => void removeImage(draftItem)}>حذف الصورة</button>}
              </div>
            </div>}
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
                <select id="cat" value={draft.category} onChange={(e) => {
                    const category = e.target.value as MenuCategory;
                    // A new item moves to the end of the section it is put in.
                    setDraft({ ...draft, category, sortOrder: draft.id ? draft.sortOrder : nextPosition(items, category) });
                  }}
                >
                  <option value="drink">مشروب (يحسب كوب في الولاء)</option>
                  <option value="dessert">حلا</option>
                  <option value="box">بوكس</option>
                </select>
              </div>
              <Field label="السعر (⃁)" inputMode="decimal" dir="ltr" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
            </div>
            <Field
              label="السعرات الحرارية (اختياري)"
              inputMode="numeric"
              dir="ltr"
              value={draft.calories}
              onChange={(e) => setDraft({ ...draft, calories: e.target.value })}
              hint="للحصة الواحدة، تظهر تحت السعر في المنيو"
            />
            <Field label="الترتيب" inputMode="numeric" dir="ltr" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} hint="1 يظهر أول القسم، والباقي يتأخرون تلقائيًا" />
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
              <button type="submit" className="btn btn--primary" disabled={busy || uploading !== null}>
                {busy ? "جارٍ الحفظ…" : "حفظ"}
              </button>
              <button type="button" className="btn btn--ghost" disabled={busy || uploading !== null} onClick={closeDraft}>
                إلغاء
              </button>
            </div>
            {draft.id && (
              <div className="admin-delete">
                {confirmingDelete ? (
                  <>
                    <p>
                      تحذف «{draft.nameAr}»؟ يختفي من المنيو ومن هذه الصفحة، ولا يرجع. الطلبات السابقة وتقرير المبيعات يبقون مثل ما هم.
                    </p>
                    <div className="dialog__actions">
                      <button type="button" className="btn btn--danger" disabled={busy || uploading !== null} onClick={() => void deleteDraft()}>
                        {busy ? "جارٍ الحذف…" : "احذف نهائيًا"}
                      </button>
                      <button type="button" className="btn btn--ghost" onClick={() => setConfirmingDelete(false)}>
                        تراجع
                      </button>
                    </div>
                  </>
                ) : (
                  <button type="button" className="link-btn link-btn--danger" disabled={busy || uploading !== null} onClick={() => setConfirmingDelete(true)}>
                    حذف الصنف
                  </button>
                )}
              </div>
            )}
          </form>
        )}
      </Dialog>
    </section>
  );
}

function MenuRow({ item, disabled, onToggle, onEdit, onToggleBest }: {
  item: MenuItem;
  disabled: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onToggleBest: () => void;
}) {
  const available = isOrderable(item);
  return (
    <li className={`catalog-card ${item.isAvailable ? "" : "is-off"}`}>
      <div className="catalog-card__photo">
        <ItemImage item={item} />
        <button type="button" className={`catalog-star ${item.isBestSeller ? "is-on" : ""}`} disabled={disabled}
          aria-pressed={item.isBestSeller} aria-label={`الأفضل مبيعًا: ${item.nameAr}`} onClick={onToggleBest} title="الأفضل مبيعًا">★</button>
        {item.isArchived && <span className="catalog-hidden badge badge--muted">مخفي</span>}
      </div>
      <div className="catalog-card__body">
        <h4>{item.nameAr}</h4>
        <p className="catalog-card__price">{riyals(item.priceHalalas)}</p>
        <label className="catalog-card__availability">
          <input type="checkbox" role="switch" className="switch" checked={item.isAvailable} disabled={disabled}
            aria-label={`تفعيل ${item.nameAr}`} onChange={onToggle} />
          <span>{!item.isAvailable ? "متوقف" : available ? "متوفر" : "نفد"}</span>
        </label>
        <button type="button" className="btn btn--secondary catalog-card__edit" disabled={disabled} onClick={onEdit}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z" /></svg>
          تعديل
        </button>
      </div>
    </li>
  );
}
