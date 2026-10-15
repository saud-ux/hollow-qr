import { describe, expect, it } from "vitest";
import { editDistance, findInMenu, highlight, normalizeSearch, searchMenu } from "../../src/shared/menu-search";
import type { MenuItem } from "../../src/shared/ordering";

const item = (nameAr: string, nameEn: string | null, extra: Partial<MenuItem> = {}): MenuItem => ({
  id: nameAr,
  nameAr,
  nameEn,
  descriptionAr: null,
  descriptionEn: null,
  category: "drink",
  priceHalalas: 1500,
  imageUrl: null,
  isAvailable: true,
  isArchived: false,
  sortOrder: 0,
  optionLabel: null,
  optionLabelEn: null,
  options: [],
  calories: null,
  isBestSeller: false,
  stockQuantity: null,
  discountPercent: null,
  salePriceHalalas: null,
  ...extra,
});

const v60 = item("قهوة مقطرة", "V60", {
  options: [{ id: "ethiopia", nameAr: "إثيوبي", nameEn: "Ethiopian", noteAr: null, noteEn: null, isAvailable: true }],
});
const iceV60 = item("قهوة مقطرة باردة", "Ice V60");
const matcha = item("ماتشا باردة", "Ice Matcha");
const karkade = item("كركدية بارد", "Ice Karkade");
const waffle = item("وافل بيكان", "Pecan Waffle", { category: "dessert", descriptionAr: "وافل طازج مع صوص البيكان" });
const menu = [v60, iceV60, matcha, karkade, waffle];
const names = (q: string) => searchMenu(menu, q).map((i) => i.nameEn);

describe("menu search", () => {
  it("finds items by English or Arabic name, ignoring case", () => {
    expect(names("matcha")).toEqual(["Ice Matcha"]);
    expect(names("MAT")).toEqual(["Ice Matcha"]);
    expect(names("ماتشا")).toEqual(["Ice Matcha"]);
  });

  it("forgives Arabic spelling variants", () => {
    expect(normalizeSearch("إثيوبيّ")).toBe("اثيوبي");
    expect(names("اثيوبي")).toEqual(["V60"]);
    expect(names("كركديه")).toEqual(["Ice Karkade"]);
  });

  it("searches origins, descriptions and categories", () => {
    expect(names("ethiopian")).toEqual(["V60"]);
    expect(names("صوص")).toEqual(["Pecan Waffle"]);
    expect(names("حلويات")).toEqual(["Pecan Waffle"]);
  });

  it("needs every word, and puts names that start with the query first", () => {
    expect(names("ice v60")).toEqual(["Ice V60"]);
    expect(names("v60")).toEqual(["V60", "Ice V60"]);
    expect(names("بارد")).toEqual(["Ice V60", "Ice Matcha", "Ice Karkade"]);
  });

  it("shows everything for an empty query and nothing for no match", () => {
    expect(searchMenu(menu, "  ")).toHaveLength(5);
    expect(names("pizza")).toEqual([]);
  });

  it("knows everyday words for the same thing", () => {
    expect(names("آيس")).toEqual(["Ice V60", "Ice Matcha", "Ice Karkade"]);
    expect(names("cold")).toEqual(["Ice V60", "Ice Matcha", "Ice Karkade"]);
    expect(names("حلا")).toEqual(["Pecan Waffle"]);
    expect(names("فلتر")).toEqual(["V60", "Ice V60"]);
  });

  it("looks past «ال» and the letter before it", () => {
    expect(names("القهوة المقطرة")).toEqual(["V60", "Ice V60"]);
    expect(names("بالبيكان")).toEqual(["Pecan Waffle"]);
  });

  it("puts what can be ordered before what's sold out", () => {
    const soldOut = { ...matcha, stockQuantity: 0 };
    expect(searchMenu([v60, iceV60, soldOut, karkade], "بارد").map((i) => i.nameEn)).toEqual(["Ice V60", "Ice Karkade", "Ice Matcha"]);
  });

  it("forgives a slip and offers the menu's spelling", () => {
    expect(findInMenu(menu, "ماتشه")).toMatchObject({ suggestion: "ماتشا", items: [matcha] });
    expect(findInMenu(menu, "waffel")).toMatchObject({ suggestion: "Waffle", items: [waffle] });
    expect(findInMenu(menu, "بارد ماتشه")).toMatchObject({ suggestion: "بارد ماتشا", items: [matcha] });
    // Spelled right: no suggestion.
    expect(findInMenu(menu, "matcha").suggestion).toBeNull();
  });

  it("doesn't find a short word inside another, but finds a name typed as one word", () => {
    const juice = item("عصير برتقال", "Orange Juice");
    const cheesecake = item("تشيز كيك بيكان", "Pecan Cheesecake", { category: "dessert" });
    expect(searchMenu([juice, matcha], "ice").map((i) => i.nameEn)).toEqual(["Ice Matcha"]);
    expect(searchMenu([juice, cheesecake], "cake").map((i) => i.nameEn)).toEqual(["Pecan Cheesecake"]);
    expect(findInMenu([juice, cheesecake], "تشيزكيك").items).toEqual([cheesecake]);
  });

  it("counts typing slips", () => {
    expect(editDistance("ماتشه", "ماتشا", 1)).toBe(1);
    expect(editDistance("waffel", "waffle", 1)).toBe(1);
    expect(editDistance("كابتشينو", "كابوتشينو", 2)).toBe(1);
    expect(editDistance("pizza", "pecan", 1)).toBe(2);
  });

  it("marks what matched", () => {
    expect(highlight("Ice Matcha", ["mat"])).toEqual([
      { text: "Ice ", hit: false },
      { text: "Mat", hit: true },
      { text: "cha", hit: false },
    ]);
    // An Arabic word is marked whole, harakat and all.
    expect(highlight("ماتشا باردة", ["بارد"])).toEqual([
      { text: "ماتشا ", hit: false },
      { text: "باردة", hit: true },
    ]);
    expect(highlight("إثيوبيّ", ["اثيوبي"])).toEqual([{ text: "إثيوبيّ", hit: true }]);
    // A short term inside a word isn't marked (it didn't match there).
    expect(highlight("Orange Juice", ["ice"])).toEqual([{ text: "Orange Juice", hit: false }]);
    expect(highlight("V60", [])).toEqual([{ text: "V60", hit: false }]);
  });
});
