import { priceOf, type MenuItem } from "../../shared/ordering";
import { riyals } from "../lib/menu";
import { Rolling } from "./Rolling";

/**
 * An item's price for `quantity`: while a discount covers it, the new price
 * in red with the menu price struck through beside it.
 */
export function SalePrice({ item, quantity = 1, rolling = false }: { item: Pick<MenuItem, "priceHalalas" | "salePriceHalalas">; quantity?: number; rolling?: boolean }) {
  const sale = item.salePriceHalalas !== null;
  const text = riyals(priceOf(item) * quantity);
  const cls = sale ? "price-now price-now--sale" : "price-now";
  return (
    <span className="sale-price">
      {rolling ? <Rolling className={cls} text={text} /> : <span className={cls}>{text}</span>}
      {sale && <s className="price-was">{riyals(item.priceHalalas * quantity)}</s>}
    </span>
  );
}
