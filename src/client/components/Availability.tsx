import { useEffect, useState } from "react";
import { CATEGORY_LABELS_AR, isOrderable, type MenuItem } from "../../shared/ordering";
import { normalizeSearch } from "../../shared/menu-search";
import { apiGet, apiPost, errorText } from "../lib/api";
import { Alert, Field, Spinner } from "./Field";
import { ItemImage } from "./Shop";
import { StockCount } from "./StockCount";

/** Shared by the stock page and the order board's quick dialog. */
export function AvailabilityList({ scroll = false }: { scroll?: boolean }) {
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | "drink" | "dessert">("all");
  const [status, setStatus] = useState<"all" | "available" | "out">("all");

  useEffect(() => {
    apiGet<{ items: MenuItem[] }>("/api/staff/menu")
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  const saved = (s: MenuItem) => setItems((list) => list?.map((i) => (i.id === s.id ? s : i)) ?? list);

  async function toggle(item: MenuItem, isAvailable: boolean, optionId?: string) {
    if (busy !== null) return;
    setBusy(`${item.id}:${optionId ?? ""}`);
    setError(null);
    try {
      const { item: next } = await apiPost<{ item: MenuItem }>(`/api/staff/menu/${item.id}/availability`, { isAvailable, optionId });
      saved(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const tokens = normalizeSearch(query).split(" ").filter(Boolean);
  const matches = (item: MenuItem) => {
    if (category !== "all" && item.category !== category) return false;
    if (status === "available" && !isOrderable(item)) return false;
    if (status === "out" && isOrderable(item)) return false;
    const text = normalizeSearch([item.nameAr, item.nameEn, ...item.options.map((o) => o.nameAr)].join(" "));
    return tokens.every((word) => text.includes(word));
  };
  const count = items?.filter(matches).length ?? 0;

  return (
    <div className="avail avail--cards">
      {error && <Alert tone="error">{error}</Alert>}
      {!items && !error && <Spinner />}
      {items && <>
        <div className="avail__toolbar">
          <Field label="بحث الأصناف" type="search" placeholder="اسم الصنف أو نوع القهوة" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="field">الحالة
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="all">جميع الحالات</option>
              <option value="available">متوفر</option>
              <option value="out">غير متوفر</option>
            </select>
          </label>
        </div>
        <div className="avail__filters" role="group" aria-label="نوع الأصناف">
          {([ ["all", "الكل"], ["drink", "المشروبات"], ["dessert", "الحلويات"] ] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={category === key} onClick={() => setCategory(key)}>
              {label}<span>{key === "all" ? items.length : items.filter((i) => i.category === key).length}</span>
            </button>
          ))}
        </div>
        <div className="avail__result" aria-live="polite">{count} صنف</div>
        {count === 0 && <div className="avail__empty">
          <p>لا توجد أصناف مطابقة</p>
          <button type="button" className="btn btn--secondary" onClick={() => { setQuery(""); setCategory("all"); setStatus("all"); }}>عرض الكل</button>
        </div>}
        <div className={`avail__groups ${scroll ? "avail__groups--scroll" : ""}`}>
          {(["drink", "dessert"] as const).map((group) => {
            const list = items.filter((i) => i.category === group);
            if (list.length === 0) return null;
            return (
              <section key={group} className="avail__group" hidden={!list.some(matches)}>
                <h2 className="avail__title">{CATEGORY_LABELS_AR[group]}</h2>
                <div className="avail__cards">
                  {/* Keep editors mounted when filtering so pending stock saves aren't cancelled. */}
                  {list.map((item) => {
                    const out = !isOrderable(item);
                    return (
                      <article key={item.id} hidden={!matches(item)} className={`avail__item ${out ? "is-out" : ""}`}>
                        <div className="avail__card-head">
                          <ItemImage item={item} className="avail__photo" />
                          <div className="avail__identity">
                            <h3>{item.nameAr}</h3>
                            <span className={`avail__status ${out ? "is-out" : ""}`}>
                              {!item.isAvailable ? "متوقف" : item.stockQuantity === 0 ? "نفد" : out ? "الخيارات غير متوفرة" : "متوفر"}
                            </span>
                          </div>
                          <label className="avail__switch-target">
                            <input type="checkbox" role="switch" className="switch" checked={item.isAvailable}
                              disabled={busy !== null} onChange={(e) => void toggle(item, e.target.checked)} aria-label={`تفعيل ${item.nameAr}`} />
                          </label>
                        </div>
                        {item.isAvailable && item.options.length > 0 && (
                          <details className="avail__origins">
                            <summary>{item.optionLabel || "خيارات القهوة"}<span>{item.options.filter((o) => o.isAvailable).length}/{item.options.length}</span></summary>
                            <div className="avail__options">
                              {item.options.map((o) => (
                                <label key={o.id} className={`avail__option ${o.isAvailable ? "is-active" : "is-out"}`}>
                                  <input type="checkbox" checked={o.isAvailable} disabled={busy !== null}
                                    onChange={(e) => void toggle(item, e.target.checked, o.id)} />
                                  <span>{o.nameAr}</span>
                                </label>
                              ))}
                            </div>
                          </details>
                        )}
                        {item.isAvailable && <div className="avail__quantity">
                          <span>الكمية</span>
                          <StockCount item={item} onSaved={saved} />
                        </div>}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </>}
    </div>
  );
}
