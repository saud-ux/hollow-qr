import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isOrderable, MAX_LINE_QUANTITY, priceOf, type MenuItem } from "../../shared/ordering";
import { SalePrice } from "./SalePrice";
import { useCart } from "../lib/cart";
import { riyals } from "../lib/menu";
import { CALM, dropSheet, flyToCart, morphCardSheet, motionOn, zoomPhoto } from "../lib/motion";
import { itemDescription, itemName, itemSubName, optionLabel, optionName, optionNote, subNameDir } from "../lib/menuText";
import { stockLeftText, stockRoom } from "../lib/stock";
import { ItemImage } from "./Shop";
import { showToast } from "./Toast";
import { tr } from "../lib/i18n";

/**
 * A product up close: a large photo (tap it to see it full screen), the
 * description, and, for items like V60, the origin to choose.
 */
export function ProductSheet({ item, canOrder, origin = null, onClose }: { item: MenuItem; canOrder: boolean; origin?: HTMLElement | null; onClose: () => void }) {
  const cart = useCart();
  const hasOptions = item.options.length > 0;
  const firstAvailable = item.options.find((o) => o.isAvailable)?.id ?? null;
  const [optionId, setOptionId] = useState<string | null>(hasOptions ? firstAvailable : null);
  const [quantity, setQuantity] = useState(1);
  const [zoomed, setZoomed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  useSheetDrag(sheetRef, photoRef, onClose);
  // Opened from a menu card: the card itself grows into the sheet, and closing folds it back.
  const [zoomIn] = useState(() => origin !== null && motionOn());
  const opened = useRef(false);
  useLayoutEffect(() => {
    // Once per sheet (React's dev double-run would measure the half-grown sheet).
    if (opened.current) return;
    opened.current = true;
    if (zoomIn) void morphCardSheet(origin, sheetRef.current, true);
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closing = useRef(false);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    if (zoomIn) void morphCardSheet(origin, sheetRef.current, false).then(onClose);
    else onClose();
  };

  // Full screen: the photo opens out of the sheet, and closing puts it back.
  useLayoutEffect(() => {
    const photo = photoRef.current?.querySelector<HTMLElement>(".product-sheet__img");
    if (!zoomed || !photo) return;
    // Hidden while its copy is on screen, so the photo moves rather than doubles.
    photo.style.visibility = "hidden";
    void zoomPhoto(photo, viewerRef.current, true);
    return () => {
      photo.style.visibility = "";
    };
  }, [zoomed]);
  const unzooming = useRef(false);
  const unzoom = () => {
    if (unzooming.current) return;
    unzooming.current = true;
    const photo = photoRef.current?.querySelector(".product-sheet__img") ?? null;
    void zoomPhoto(photo, viewerRef.current, false).then(() => {
      unzooming.current = false;
      setZoomed(false);
    });
  };

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (zoomed) unzoom();
      else close();
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("sheet-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("sheet-open");
    };
    // close() and unzoom() only read refs and the open-time origin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // The photo flies to the cart while the sheet drops away under it.
    closing.current = true;
    void dropSheet(sheetRef.current).then(onClose);
  }

  // Rendered at the end of <body>: inside the card it would take on the card's
  // look (a sold-out card is faded, which made the whole sheet see-through).
  return createPortal(
    <div className="sheet-backdrop" onClick={close}>
      <div
        ref={sheetRef}
        className={`product-sheet ${zoomIn ? "product-sheet--zoom" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="product-sheet__close" onClick={close} aria-label={tr("إغلاق", "Close")}>
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
              <SalePrice item={item} />
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
                  : tr(`أضف للسلة · ${riyals(priceOf(item) * quantity)}`, `Add to cart · ${riyals(priceOf(item) * quantity)}`)}
            </button>
          </div>
          {inCart > 0 && <p className="muted small center">{tr(`في سلتك الآن: ${inCart}`, `In your cart: ${inCart}`)}</p>}
          {isOrderable(item) && item.stockQuantity != null && <p className="product-sheet__low">{stockLeftText(item, item.stockQuantity)}</p>}
        </div>
      </div>

      {zoomed && item.imageUrl && (
        <div
          ref={viewerRef}
          className="photo-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={itemName(item)}
          onClick={(e) => {
            e.stopPropagation();
            unzoom();
          }}
        >
          <img src={item.imageUrl} alt={itemName(item)} className="photo-viewer__img" />
          <span className="photo-viewer__hint">{tr("اضغط للإغلاق", "Tap to close")}</span>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Dragged this far down, the sheet closes. */
const DISMISS_PX = 110;
/** A flick down faster than this (px per ms) closes it too. */
const FLICK = 0.45;
/** How dark the backdrop is, in % (as in .sheet-backdrop). */
const DIM = 45;

/**
 * On touch screens: drag the sheet down from the top to close it; the photo stretches
 * as you pull, the dimming behind lifts with it, and drifts slower than the text as
 * you scroll (parallax).
 */
function useSheetDrag(sheetRef: React.RefObject<HTMLDivElement | null>, photoRef: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const img = () => photoRef.current?.querySelector<HTMLElement>(".product-sheet__img") ?? null;
    let startY: number | null = null;
    let drag = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    const backdrop = sheet.parentElement;

    const onScroll = () => {
      const photo = img();
      if (photo && motionOn() && startY === null) photo.style.transform = sheet.scrollTop > 0 ? `translateY(${sheet.scrollTop * 0.35}px)` : "";
    };
    const onStart = (e: TouchEvent) => {
      startY = sheet.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0]!.clientY : null;
      drag = 0;
      velocity = 0;
      lastY = startY ?? 0;
      lastT = e.timeStamp;
      sheet.style.transition = "none";
      if (backdrop) backdrop.style.transition = "none";
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const y = e.touches[0]!.clientY;
      const dy = y - startY;
      const dt = e.timeStamp - lastT;
      if (dt > 0) velocity = (y - lastY) / dt;
      lastY = y;
      lastT = e.timeStamp;
      if (dy <= 0) {
        if (drag > 0) {
          sheet.style.transform = "";
          if (backdrop) backdrop.style.backgroundColor = "";
        }
        drag = 0;
        return;
      }
      // Pulling down from the top: the sheet follows instead of scrolling.
      e.preventDefault();
      drag = dy;
      sheet.style.transform = `translateY(${dy}px)`;
      if (backdrop && motionOn()) backdrop.style.backgroundColor = `rgb(20 12 8 / ${(DIM * Math.max(1 - dy / sheet.offsetHeight, 0)).toFixed(1)}%)`;
      const photo = img();
      if (photo && motionOn()) {
        photo.style.transformOrigin = "50% 100%";
        photo.style.transform = `scale(${1 + Math.min(dy / 500, 0.18)})`;
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (startY === null) return;
      startY = null;
      const photo = img();
      const smooth = motionOn();
      const settle = smooth ? `280ms ${CALM.easing}` : "0s";
      if (photo) {
        photo.style.transition = `transform ${settle}`;
        photo.style.transform = "";
      }
      // A finger that stopped before letting go isn't a flick.
      const flick = e.timeStamp - lastT < 80 && velocity > FLICK && drag > 12;
      if (drag >= DISMISS_PX || flick) {
        void dropSheet(sheet, drag).then(() => closeRef.current());
      } else {
        sheet.style.transition = `transform ${settle}`;
        sheet.style.transform = "";
        if (backdrop) {
          backdrop.style.transition = `background-color ${settle}`;
          backdrop.style.backgroundColor = "";
        }
      }
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
