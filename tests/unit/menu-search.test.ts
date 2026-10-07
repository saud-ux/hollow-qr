import { describe, expect, it } from "vitest";
import { normalizeSearch, searchMenu } from "../../src/shared/menu-search";
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
});
