import { useEffect, useRef, useState } from "react";
import { isOrderable, MAX_LINE_QUANTITY, type MenuItem } from "../../shared/ordering";
import { useCart } from "../lib/cart";
import { riyals } from "../lib/menu";
import { flyToCart } from "../lib/motion";
import { ItemImage } from "./Shop";

/**
 * A product up close: a large photo (tap it to see it full screen), the
 * description, and, for items like V60, the origin to choose.
 */
export function ProductSheet({ item, canOrder, onClose }: { item: MenuItem; canOrder: boolean; onClose: () => void }) {
  const cart = useCart();
  const hasOptions = item.options.length > 0;
  const firstAvailable = item.options.find((o) => o.isAvailable)?.id ?? null;
  const [optionId, setOptionId] = useState<string | null>(hasOptions ? firstAvailable : null);
  const [quantity, setQuantity] = useState(1);
  const [zoomed, setZoomed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (zoomed) setZoomed(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("sheet-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("sheet-open");
    };
  }, [onClose, zoomed]);

  const orderable = canOrder && isOrderable(item) && (!hasOptions || optionId !== null);
  const inCart = cart.totalOf(item.id);

  function add() {
    flyToCart(photoRef.current?.querySelector(".item-img") ?? null);
    cart.add(item.id, optionId, quantity);
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="product-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="product-sheet__close" onClick={onClose} aria-label="إغلاق">
          ×
        </button>
        <div ref={photoRef} className="product-sheet__photo">
          {item.imageUrl ? (
            <button type="button" className="product-sheet__zoom" onClick={() => setZoomed(true)} aria-label="عرض الصورة بحجم الشاشة">
              <ItemImage item={item} className="product-sheet__img" />
            </button>
          ) : (
            <ItemImage item={item} className="product-sheet__img" />
          )}
        </div>

        <div className="product-sheet__body">
          <div className="product-sheet__head">
            <div>
              <h2 id="product-sheet-title" className="product-sheet__name">
                {item.nameAr}
              </h2>
              {item.nameEn && (
                <span className="pass-label" dir="ltr">
                  {item.nameEn}
                </span>
              )}
            </div>
            <span className="product-sheet__price">
              {riyals(item.priceHalalas)}
              {item.calories !== null && <small className="kcal">{item.calories} سعرة حرارية</small>}
            </span>
          </div>
          {item.descriptionAr && <p className="product-sheet__desc">{item.descriptionAr}</p>}

          {hasOptions && (
            <fieldset className="origin-picker">
              <legend>اختر {item.optionLabel ?? "النوع"}</legend>
              {item.options.map((o) => (
                <label key={o.id} className={`origin ${optionId === o.id ? "is-on" : ""} ${o.isAvailable ? "" : "is-out"}`}>
                  <input
                    type="radio"
                    name={`origin-${item.id}`}
                    value={o.id}
                    checked={optionId === o.id}
                    disabled={!o.isAvailable}
                    onChange={() => setOptionId(o.id)}
                  />
                  <span className="origin__text">
                    <strong>{o.nameAr}</strong>
                    {o.noteAr && <small>{o.noteAr}</small>}
                  </span>
                  {!o.isAvailable && <span className="badge badge--muted">نفد</span>}
                </label>
              ))}
            </fieldset>
          )}

          <div className="product-sheet__actions">
            <div className="stepper" role="group" aria-label={`الكمية: ${item.nameAr}`}>
              <button type="button" className="stepper__btn" onClick={() => setQuantity((q) => Math.min(q + 1, MAX_LINE_QUANTITY))} aria-label="زيادة">
                +
              </button>
              <span className="stepper__value" aria-live="polite">
                {quantity}
              </span>
              <button type="button" className="stepper__btn" onClick={() => setQuantity((q) => Math.max(q - 1, 1))} aria-label="إنقاص">
                −
              </button>
            </div>
            <button type="button" className="btn btn--primary btn--lg product-sheet__add" disabled={!orderable} onClick={add}>
              {!canOrder ? "لا نستقبل طلبات الآن" : !isOrderable(item) ? "نفد" : `أضف للسلة · ${riyals(item.priceHalalas * quantity)}`}
            </button>
          </div>
          {inCart > 0 && <p className="muted small center">في سلتك الآن: {inCart}</p>}
        </div>
      </div>

      {zoomed && item.imageUrl && (
        <div
          className="photo-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={item.nameAr}
          onClick={(e) => {
            e.stopPropagation();
            setZoomed(false);
          }}
        >
          <img src={item.imageUrl} alt={item.nameAr} className="photo-viewer__img" />
          <span className="photo-viewer__hint">اضغط للإغلاق</span>
        </div>
      )}
    </div>
  );
}
