import { useEffect, useRef, useState } from "react";
import { MAX_STOCK, type MenuItem } from "../../shared/ordering";
import { apiPost, errorText } from "../lib/api";

/**
 * How many of an item are left (staff and admin). Orders take from it the
 * moment they are placed; at 0 the item is sold out until more is added.
 * "بدون عدّ" = not counted (unlimited).
 */
export function StockCount({ item, onSaved }: { item: MenuItem; onSaved: (item: MenuItem) => void }) {
  const [value, setValue] = useState<number | null>(item.stockQuantity);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function save(quantity: number | null) {
    setError(null);
    try {
      const { item: saved } = await apiPost<{ item: MenuItem }>(`/api/staff/menu/${item.id}/stock`, { quantity });
      onSaved(saved);
    } catch (e) {
      setError(errorText(e));
      setValue(item.stockQuantity);
    }
  }

  // Taps on − / + are gathered and sent once the count settles.
  function bump(next: number) {
    const q = Math.min(Math.max(next, 0), MAX_STOCK);
    setValue(q);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(q), 500);
  }

  function commitDraft() {
    const n = Number(draft);
    if (!Number.isInteger(n) || n < 0 || n > MAX_STOCK) {
      setError(`اكتب رقم من 0 إلى ${MAX_STOCK}`);
      return;
    }
    setEditing(false);
    setValue(n);
    void save(n);
  }

  if (editing) {
    return (
      <div className="stock-count">
        <input
          className="stock-count__input"
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d٠-٩]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))))}
          onKeyDown={(e) => e.key === "Enter" && commitDraft()}
          placeholder="الكمية"
          aria-label={`كمية ${item.nameAr}`}
          autoFocus
        />
        <button type="button" className="btn btn--small btn--primary" onClick={commitDraft}>
          حفظ
        </button>
        <button type="button" className="btn btn--small btn--ghost" onClick={() => setEditing(false)}>
          إلغاء
        </button>
        {error && <small className="field__error">{error}</small>}
      </div>
    );
  }

  if (value === null) {
    return (
      <div className="stock-count">
        <span className="stock-count__none">بدون عدّ</span>
        <button
          type="button"
          className="btn btn--small btn--ghost"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
        >
          حدّد الكمية
        </button>
        {error && <small className="field__error">{error}</small>}
      </div>
    );
  }

  return (
    <div className="stock-count">
      <div className="stepper stock-count__stepper" role="group" aria-label={`كمية ${item.nameAr}`}>
        <button type="button" className="stepper__btn" onClick={() => bump(value + 1)} aria-label="زيادة">
          +
        </button>
        <button
          type="button"
          className={`stepper__value stock-count__value ${value === 0 ? "is-out" : ""}`}
          onClick={() => {
            setDraft(String(value));
            setEditing(true);
          }}
          aria-label="اكتب الكمية"
        >
          {value}
        </button>
        <button type="button" className="stepper__btn" onClick={() => bump(value - 1)} disabled={value === 0} aria-label="إنقاص">
          −
        </button>
      </div>
      {value === 0 && <span className="badge badge--danger">نفد</span>}
      <button
        type="button"
        className="link-btn stock-count__stop"
        onClick={() => {
          window.clearTimeout(timer.current);
          setValue(null);
          void save(null);
        }}
      >
        إيقاف العدّ
      </button>
      {error && <small className="field__error">{error}</small>}
    </div>
  );
}
