import type { MenuItem } from "../../shared/ordering";
import type { CartLine } from "./cart";
import { tr } from "./i18n";
import { itemName } from "./menuText";

/** All of the item in the cart, across its origins. */
export function inCart(lines: CartLine[], itemId: string): number {
  return lines.reduce((sum, l) => (l.menuItemId === itemId ? sum + l.quantity : sum), 0);
}

/** How many more fit in the cart; Infinity when the count isn't known (plenty left or not counted). */
export function stockRoom(item: Pick<MenuItem, "id" | "stockQuantity">, lines: CartLine[]): number {
  return item.stockQuantity == null ? Infinity : Math.max(item.stockQuantity - inCart(lines, item.id), 0);
}

/** «باقي حبة وحدة بس من وافل بيكان». */
export function stockLeftText(item: Pick<MenuItem, "nameAr" | "nameEn">, left: number): string {
  const name = itemName(item);
  if (left <= 0) return tr(`خلص ${name}`, `${name} is sold out`);
  if (left === 1) return tr(`باقي حبة وحدة بس من ${name}`, `Only 1 ${name} left`);
  if (left === 2) return tr(`باقي حبتين بس من ${name}`, `Only 2 ${name} left`);
  return tr(`باقي ${left} بس من ${name}`, `Only ${left} ${name} left`);
}

/** The badge on a menu card when few are left. */
export function lowStockBadge(left: number): string {
  return left === 1 ? tr("باقي حبة وحدة", "Only 1 left") : left === 2 ? tr("باقي حبتين", "Only 2 left") : tr(`باقي ${left} فقط`, `Only ${left} left`);
}
