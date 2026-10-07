/**
 * Menu text in the customer's language. English falls back to the Arabic
 * text wherever the café hasn't written an English one.
 */
import {
  CATEGORY_LABELS_AR,
  CATEGORY_LABELS_EN,
  FULFILLMENT_LABELS_AR,
  FULFILLMENT_LABELS_EN,
  customerStatusLabel,
  type FulfillmentType,
  type MenuCategory,
  type MenuItem,
  type MenuOption,
  type Order,
  type OrderLine,
} from "../../shared/ordering";
import { currentLang } from "./i18n";

const en = () => currentLang() === "en";

export function itemName(item: Pick<MenuItem, "nameAr" | "nameEn">): string {
  return en() ? item.nameEn || item.nameAr : item.nameAr;
}

/** The name in the other language, shown small under the main one. */
export function itemSubName(item: Pick<MenuItem, "nameAr" | "nameEn">): string | null {
  if (en()) return item.nameEn ? item.nameAr : null;
  return item.nameEn;
}

/** The English subtitle reads left-to-right on Arabic screens; the Arabic one follows the English page. */
export function subNameDir(): "ltr" | undefined {
  return en() ? undefined : "ltr";
}

export function itemDescription(item: Pick<MenuItem, "descriptionAr" | "descriptionEn">): string | null {
  return en() ? item.descriptionEn || item.descriptionAr : item.descriptionAr;
}

export function optionLabel(item: Pick<MenuItem, "optionLabel" | "optionLabelEn">): string {
  return en() ? item.optionLabelEn || "option" : item.optionLabel || "النوع";
}

export function optionName(option: Pick<MenuOption, "nameAr" | "nameEn">): string {
  return en() ? option.nameEn || option.nameAr : option.nameAr;
}

export function optionNote(option: Pick<MenuOption, "noteAr" | "noteEn">): string | null {
  return en() ? option.noteEn || option.noteAr : option.noteAr;
}

export function categoryLabel(category: MenuCategory): string {
  return (en() ? CATEGORY_LABELS_EN : CATEGORY_LABELS_AR)[category];
}

/**
 * An order line keeps the Arabic names it was ordered with; English screens
 * look the item and origin up in the current menu.
 */
export function lineName(line: Pick<OrderLine, "menuItemId" | "nameAr">, menu: MenuItem[] | null | undefined): string {
  if (!en()) return line.nameAr;
  return menu?.find((i) => i.id === line.menuItemId)?.nameEn || line.nameAr;
}

export function lineOptionName(
  line: Pick<OrderLine, "menuItemId" | "optionId" | "optionNameAr">,
  menu: MenuItem[] | null | undefined,
): string | null {
  if (!line.optionNameAr) return null;
  if (!en()) return line.optionNameAr;
  const option = menu?.find((i) => i.id === line.menuItemId)?.options.find((o) => o.id === line.optionId);
  return option?.nameEn || line.optionNameAr;
}

/** The order's status in the customer's words: pickup ends "Picked up", delivery "Delivered". */
export function statusLabel(order: Pick<Order, "status" | "fulfillment">): string {
  return customerStatusLabel(order, en() ? "en" : "ar");
}

export function fulfillmentLabel(fulfillment: FulfillmentType): string {
  return (en() ? FULFILLMENT_LABELS_EN : FULFILLMENT_LABELS_AR)[fulfillment];
}
