import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isOrderable, type MenuItem } from "../../shared/ordering";
import { useCart } from "../lib/cart";
import { tr } from "../lib/i18n";
import { itemName, optionLabel, optionName, optionNote } from "../lib/menuText";
import { dropSheet, flyToCart } from "../lib/motion";
import { stockLeftText, stockRoom } from "../lib/stock";
import { useSheetDrag } from "./ProductSheet";
import { ItemImage } from "./Shop";
import { showToast } from "./Toast";

/**
 * An item with origins that can be ordered now opens the small origin sheet,
 * from its + and from its photo, on the menu and in search. Sold out, or the
 * café closed: the full product sheet says so instead.
 */
export const choosesOrigin = (item: MenuItem, canOrder: boolean) => canOrder && isOrderable(item) && item.options.length > 0;

/**
 * An item with origins (V60) on the menu: a small sheet with the origins and
 * their notes, and one tap adds the one chosen. Its ring fills, the cup flies
 * to the cart and the sheet drops away.
 */
export function OriginSheet({ item, onClose, onAdded }: { item: MenuItem; onClose: () => void; onAdded?: () => void }) {
  const cart = useCart();
  const [chosen, setChosen] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const closing = useRef(false);
  useSheetDrag(sheetRef, null, onClose);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    void dropSheet(sheetRef.current).then(onClose);
  };

  useEffect(() => {
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("sheet-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("sheet-open");
    };
    // close() only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = (optionId: string) => {
    if (closing.current) return;
    // Few left: say how many instead of going past them.
    if (stockRoom(item, cart.lines) < 1) {
      showToast(stockLeftText(item, item.stockQuantity ?? 0));
      return;
    }
    setChosen(optionId);
    flyToCart(thumbRef.current?.querySelector(".item-img") ?? null);
    cart.add(item.id, optionId);
    onAdded?.();
    close();
  };

  const title = tr(`اختر ${optionLabel(item)}`, `Choose the ${optionLabel(item)}`);
  return createPortal(
    <div className="sheet-backdrop" onClick={close}>
      <div ref={sheetRef} className="origin-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <span className="origin-sheet__grabber" aria-hidden="true" />
        <div className="origin-sheet__head">
          <span ref={thumbRef} className="origin-sheet__thumb">
            <ItemImage item={item} className="origin-sheet__img" />
          </span>
          <span className="origin-sheet__title">
            <strong>{title}</strong>
            <span>{itemName(item)}</span>
          </span>
        </div>
        <ul className="origin-sheet__list">
          {item.options.map((o) => {
            const inCart = cart.quantityOf(item.id, o.id);
            return (
              <li key={o.id}>
                <button
                  type="button"
                  className={`origin-choice ${chosen === o.id ? "is-on" : ""}`}
                  disabled={!o.isAvailable}
                  onClick={() => add(o.id)}
                  aria-label={tr(`أضف ${item.nameAr}، ${o.nameAr}`, `Add ${itemName(item)}, ${optionName(o)}`)}
                >
                  <span className="origin-choice__text">
                    <strong>{optionName(o)}</strong>
                    <small>
                      {o.isAvailable ? optionNote(o) : tr("نفد", "Sold out")}
                      {inCart > 0 && <span className="origin-choice__count">{tr(` · في سلتك ${inCart}`, ` · ${inCart} in your cart`)}</span>}
                    </small>
                  </span>
                  <span className="origin-choice__ring" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="visually-hidden" onClick={close}>
          {tr("إغلاق", "Close")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
