import { useEffect, useRef, useState } from "react";
import { isOrderable, MAX_LINE_QUANTITY, type MenuItem } from "../../shared/ordering";
import { useCart } from "../lib/cart";
import { riyals } from "../lib/menu";
import { flyToCart, motionOn } from "../lib/motion";
import { isNative } from "../lib/native";
import { itemDescription, itemName, itemSubName, optionLabel, optionName, optionNote, subNameDir } from "../lib/menuText";
import { stockLeftText, stockRoom } from "../lib/stock";
import { ItemImage } from "./Shop";
import { showToast } from "./Toast";
import { tr } from "../lib/i18n";

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
  const sheetRef = useRef<HTMLDivElement>(null);
  useSheetDrag(sheetRef, photoRef, onClose);

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
  // Few left: the stepper stops at what is left (counting what's already in the cart).
  const room = stockRoom(item, cart.lines);
  const maxHere = Math.min(MAX_LINE_QUANTITY, room);
  const tooMany = () => showToast(stockLeftText(item, item.stockQuantity ?? 0));

  function add() {
    flyToCart(photoRef.current?.querySelector(".item-img") ?? null);
    cart.add(item.id, optionId, quantity);
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={sheetRef}
        className="product-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="product-sheet__close" onClick={onClose} aria-label={tr("إغلاق", "Close")}>
          ×
        </button>
        <div ref={photoRef} className="product-sheet__photo">
          {item.imageUrl ? (
            <button type="button" className="product-sheet__zoom" onClick={() => setZoomed(true)} aria-label={tr("عرض الصورة بحجم الشاشة", "View photo full screen")}>
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
                {itemName(item)}
              </h2>
              {itemSubName(item) && (
                <span className="pass-label" dir={subNameDir()}>
                  {itemSubName(item)}
                </span>
              )}
            </div>
            <span className="product-sheet__price">
              {riyals(item.priceHalalas)}
              {item.calories !== null && <small className="kcal">{tr(`${item.calories} سعرة حرارية`, `${item.calories} kcal`)}</small>}
            </span>
          </div>
          {itemDescription(item) && <p className="product-sheet__desc">{itemDescription(item)}</p>}

          {hasOptions && (
            <fieldset className="origin-picker">
              <legend>{tr(`اختر ${optionLabel(item)}`, `Choose the ${optionLabel(item)}`)}</legend>
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
                    <strong>{optionName(o)}</strong>
                    {optionNote(o) && <small>{optionNote(o)}</small>}
                  </span>
                  {!o.isAvailable && <span className="badge badge--muted">{tr("نفد", "Sold out")}</span>}
                </label>
              ))}
            </fieldset>
          )}

          <div className="product-sheet__actions">
            <div className="stepper" role="group" aria-label={tr(`الكمية: ${item.nameAr}`, `Quantity: ${itemName(item)}`)}>
              <button
                type="button"
                className={`stepper__btn ${quantity >= room ? "is-limit" : ""}`}
                onClick={() => (quantity >= room ? tooMany() : setQuantity((q) => Math.min(q + 1, maxHere)))}
                aria-label={tr("زيادة", "Increase")}
              >
                +
              </button>
              <span className="stepper__value" aria-live="polite">
                {quantity}
              </span>
              <button type="button" className="stepper__btn" onClick={() => setQuantity((q) => Math.max(q - 1, 1))} aria-label={tr("إنقاص", "Decrease")}>
                −
              </button>
            </div>
            <button type="button" className="btn btn--primary btn--lg product-sheet__add" disabled={!orderable} onClick={room < quantity ? tooMany : add}>
              {!canOrder
                ? tr("لا نستقبل طلبات الآن", "Not taking orders now")
                : !isOrderable(item)
                  ? tr("نفد", "Sold out")
                  : tr(`أضف للسلة · ${riyals(item.priceHalalas * quantity)}`, `Add to cart · ${riyals(item.priceHalalas * quantity)}`)}
            </button>
          </div>
          {inCart > 0 && <p className="muted small center">{tr(`في سلتك الآن: ${inCart}`, `In your cart: ${inCart}`)}</p>}
          {isOrderable(item) && item.stockQuantity != null && <p className="product-sheet__low">{stockLeftText(item, item.stockQuantity)}</p>}
        </div>
      </div>

      {zoomed && item.imageUrl && (
        <div
          className="photo-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={itemName(item)}
          onClick={(e) => {
            e.stopPropagation();
            setZoomed(false);
          }}
        >
          <img src={item.imageUrl} alt={itemName(item)} className="photo-viewer__img" />
          <span className="photo-viewer__hint">{tr("اضغط للإغلاق", "Tap to close")}</span>
        </div>
      )}
    </div>
  );
}

/** How far down the sheet must be dragged to close it. */
const DISMISS_PX = 110;

/**
 * iOS app: drag the sheet down from the top to close it; the photo stretches
 * as you pull, and drifts slower than the text as you scroll (parallax).
 */
function useSheetDrag(sheetRef: React.RefObject<HTMLDivElement | null>, photoRef: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!isNative || !sheet) return;
    const img = () => photoRef.current?.querySelector<HTMLElement>(".product-sheet__img") ?? null;
    let startY: number | null = null;
    let drag = 0;

    const onScroll = () => {
      const photo = img();
      if (photo && motionOn() && startY === null) photo.style.transform = sheet.scrollTop > 0 ? `translateY(${sheet.scrollTop * 0.35}px)` : "";
    };
    const onStart = (e: TouchEvent) => {
      startY = sheet.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0]!.clientY : null;
      drag = 0;
      sheet.style.transition = "none";
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0]!.clientY - startY;
      if (dy <= 0) {
        if (drag > 0) sheet.style.transform = "";
        drag = 0;
        return;
      }
      // Pulling down from the top: the sheet follows instead of scrolling.
      e.preventDefault();
      drag = dy;
      sheet.style.transform = `translateY(${dy}px)`;
      const photo = img();
      if (photo && motionOn()) {
        photo.style.transformOrigin = "50% 100%";
        photo.style.transform = `scale(${1 + Math.min(dy / 500, 0.18)})`;
      }
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      const photo = img();
      const smooth = motionOn();
      sheet.style.transition = smooth ? "transform 280ms cubic-bezier(.2,.8,.2,1)" : "none";
      if (photo) {
        photo.style.transition = smooth ? "transform 280ms cubic-bezier(.2,.8,.2,1)" : "none";
        photo.style.transform = "";
      }
      if (drag >= DISMISS_PX) {
        sheet.style.transform = "translateY(100%)";
        if (smooth) window.setTimeout(() => closeRef.current(), 260);
        else closeRef.current();
      } else sheet.style.transform = "";
      drag = 0;
    };

    sheet.addEventListener("scroll", onScroll, { passive: true });
    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", onEnd);
    return () => {
      sheet.removeEventListener("scroll", onScroll);
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", onEnd);
      sheet.removeEventListener("touchcancel", onEnd);
    };
  }, [sheetRef, photoRef]);
}
