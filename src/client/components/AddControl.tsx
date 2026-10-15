import { useLayoutEffect, useRef } from "react";
import { isOrderable, MAX_LINE_QUANTITY, type MenuItem } from "../../shared/ordering";
import { useCart } from "../lib/cart";
import { tr } from "../lib/i18n";
import { itemName, optionLabel } from "../lib/menuText";
import { growStepper } from "../lib/motion";
import { stockLeftText, stockRoom } from "../lib/stock";
import { QtyStepper } from "./Shop";
import { showToast } from "./Toast";

/**
 * How a menu item goes in the cart, wherever it is listed (the menu, the
 * search): «+», then the stepper once it's in; items with origins show how
 * many are in and open the sheet to choose; «نفد» when sold out.
 */
export function AddControl({ item, canOrder, onChoose, onAdd }: { item: MenuItem; canOrder: boolean; onChoose: () => void; onAdd?: () => void }) {
  const cart = useCart();
  const hasOptions = item.options.length > 0;
  const qty = hasOptions ? cart.totalOf(item.id) : cart.quantityOf(item.id);
  const room = stockRoom(item, cart.lines);
  const ref = useRef<HTMLSpanElement>(null);
  // + grows into the stepper when the first one goes in the cart.
  const lastQty = useRef(qty);
  const addWidth = useRef(40);
  useLayoutEffect(() => {
    const was = lastQty.current;
    lastQty.current = qty;
    const add = ref.current?.querySelector(".add-btn");
    if (add) addWidth.current = add.getBoundingClientRect().width || addWidth.current;
    if (was === 0 && qty > 0 && !hasOptions) growStepper(ref.current?.querySelector(".stepper") ?? null, addWidth.current);
  }, [qty, hasOptions]);

  return (
    <span ref={ref} className="add-control">
      {!isOrderable(item) ? (
        <span className="badge badge--muted">{tr("نفد", "Sold out")}</span>
      ) : hasOptions ? (
        // Choosing an origin happens in the sheet.
        <button
          type="button"
          className="add-btn"
          onClick={onChoose}
          disabled={!canOrder}
          aria-label={tr(`اختر ${optionLabel(item)} وأضف ${item.nameAr}`, `Choose the ${optionLabel(item)} and add ${itemName(item)}`)}
        >
          {qty > 0 ? <span className="add-btn__count">{qty}</span> : "+"}
        </button>
      ) : qty > 0 ? (
        <QtyStepper
          quantity={qty}
          onChange={(q) => cart.setQuantity(item.id, q)}
          max={Math.min(MAX_LINE_QUANTITY, qty + room)}
          onLimit={room === 0 ? () => showToast(stockLeftText(item, item.stockQuantity ?? 0)) : undefined}
          label={itemName(item)}
        />
      ) : (
        <button
          type="button"
          className="add-btn"
          onClick={() => {
            onAdd?.();
            cart.add(item.id);
          }}
          disabled={!canOrder}
          aria-label={tr(`إضافة ${item.nameAr} إلى السلة`, `Add ${itemName(item)} to cart`)}
        >
          +
        </button>
      )}
    </span>
  );
}
