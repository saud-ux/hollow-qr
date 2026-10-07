import { useEffect, useState } from "react";
import { CATEGORY_LABELS_AR, type MenuItem } from "../../shared/ordering";
import { apiGet, apiPost, errorText } from "../lib/api";
import { Alert, Spinner } from "./Field";
import { StockCount } from "./StockCount";

/**
 * Every item on the menu with its on / off switch (and one per origin) and its
 * stock count. Used on the Stock page and in the order board's quick dialog.
 */
export function AvailabilityList({ scroll = false }: { scroll?: boolean }) {
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ items: MenuItem[] }>("/api/staff/menu")
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  const saved = (s: MenuItem) => setItems((list) => list?.map((i) => (i.id === s.id ? s : i)) ?? list);

  async function toggle(item: MenuItem, isAvailable: boolean, optionId?: string) {
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

  return (
    <div className="avail">
      <p className="muted small">
        أطفئ الصنف إذا نفد، ويظهر للعملاء «نفد» فورًا. ولو حددت كمية، كل طلب ينقص منها وقت ما يوصل، والطلب الملغي يرجع لها، ولما توصل صفر يتقفل الصنف لين تضيف كمية.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      {!items && !error && <Spinner />}
      {items && (
        <div className={`avail__groups ${scroll ? "avail__groups--scroll" : ""}`}>
          {(["drink", "dessert"] as const).map((category) => {
            const list = items.filter((i) => i.category === category);
            if (list.length === 0) return null;
            return (
              <section key={category} className="avail__group">
                <h2 className="avail__title">{CATEGORY_LABELS_AR[category]}</h2>
                {list.map((item) => {
                  const out = !item.isAvailable || item.stockQuantity === 0;
                  return (
                    <div key={item.id} className={`avail__item ${out ? "is-out" : ""}`}>
                      <div className="avail__row">
                        <label className="avail__name">
                          <input
                            type="checkbox"
                            role="switch"
                            className="switch"
                            checked={item.isAvailable}
                            disabled={busy === `${item.id}:`}
                            onChange={(e) => void toggle(item, e.target.checked)}
                            aria-label={`${item.nameAr} متوفر`}
                          />
                          <span>{item.nameAr}</span>
                        </label>
                        {item.isAvailable ? <StockCount item={item} onSaved={saved} /> : <span className="badge badge--muted">مطفي</span>}
                      </div>
                      {item.isAvailable && item.options.length > 0 && (
                        <div className="avail__options">
                          {item.options.map((o) => (
                            <label key={o.id} className={`avail__option ${o.isAvailable ? "" : "is-out"}`}>
                              <input
                                type="checkbox"
                                role="switch"
                                className="switch switch--small"
                                checked={o.isAvailable}
                                disabled={busy === `${item.id}:${o.id}`}
                                onChange={(e) => void toggle(item, e.target.checked, o.id)}
                              />
                              <span>{o.nameAr}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
