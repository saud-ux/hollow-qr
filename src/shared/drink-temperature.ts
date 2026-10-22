import type { MenuItem } from "./ordering";

export type DrinkTemperature = "hot" | "cold";

/** The menu's drinks come in this order: the hot ones, then the cold ones. */
export const DRINK_TEMPERATURES = ["hot", "cold"] as const satisfies readonly DrinkTemperature[];

/** Menu items currently have no temperature field. Use their bilingual names,
 * including HOLLOW's iced Cloudy Karkade, which has no "iced" in its name. */
export function drinkTemperature(item: Pick<MenuItem, "nameAr" | "nameEn">): DrinkTemperature {
  const name = `${item.nameAr} ${item.nameEn ?? ""}`.normalize("NFKC");
  return /بارد|مثلج|كلاودي|كلودي|\b(?:ice|iced|cold|cloudy|frappe|frappé)\b/i.test(name) ? "cold" : "hot";
}
