import { describe, expect, it } from "vitest";
import { matchRanges, normalizeSearch, searchMenu, searchMenuForgiving } from "../../src/shared/menu-search";
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
});

describe("menu search: the words customers use", () => {
  const coffeeDay = item("قهوة اليوم باردة", "Ice Coffee Day");
  const hotDay = item("قهوة اليوم حارة", "Hot Coffee Day");
  const crunchy = item("كرانشي كيك تشوكلت", "Crunchy Chocolate Cake", { category: "dessert" });
  const cheesecake = item("تشيز كيك بيكان", "Pecan Cheesecake", { category: "dessert" });
  const dates = item("وافل دبس التمر", "Date Molasses Waffle", { category: "dessert" });
  const bites = item("تشوكو بايتس", "Choco Bites", { category: "dessert" });
  const juice = item("عصير", "Orange Juice");
  const full = [...menu, coffeeDay, hotDay, crunchy, cheesecake, dates, bites, juice];
  const find = (q: string) => searchMenu(full, q).map((i) => i.nameEn);

  it("matches Arabic and English words for the same thing", () => {
    expect(find("ايس")).toEqual(["Ice V60", "Ice Matcha", "Ice Karkade", "Ice Coffee Day"]);
    expect(find("cold")).toEqual(find("ايس"));
    expect(find("في ستين")).toEqual(["V60", "Ice V60"]);
    expect(find("drip")).toEqual(["V60", "Ice V60"]);
    expect(find("hot coffee")).toEqual(["Hot Coffee Day"]);
    expect(find("قهوه حاره")).toEqual(["Hot Coffee Day"]);
  });

  it("finds chocolate, cheesecake and dates however they're spelled", () => {
    expect(find("شوكلت")).toEqual(["Crunchy Chocolate Cake", "Choco Bites"]);
    expect(find("chocolate")).toEqual(["Crunchy Chocolate Cake", "Choco Bites"]);
    expect(find("تشيزكيك")).toEqual(["Pecan Cheesecake"]);
    expect(find("cheesecake")).toEqual(["Pecan Cheesecake"]);
    expect(find("تمر")).toEqual(["Date Molasses Waffle"]);
    expect(find("dates")).toEqual(["Date Molasses Waffle"]);
  });

  it("only matches a word that means the same at the start of a word", () => {
    // «ice» is in «juice», but «بارد» shouldn't find the juice.
    expect(find("بارد")).not.toContain("Orange Juice");
    expect(find("مشروبات")).toEqual(["V60", "Ice V60", "Ice Matcha", "Ice Karkade", "Ice Coffee Day", "Hot Coffee Day", "Orange Juice"]);
  });

  it("puts names before items that only match in their description", () => {
    const sauce = item("بابكا", "Babka", { category: "dessert", descriptionAr: "بابكا بالبيكان" });
    expect(searchMenu([sauce, cheesecake], "بيكان").map((i) => i.nameEn)).toEqual(["Pecan Cheesecake", "Babka"]);
  });

  it("puts what can be ordered before what has sold out", () => {
    const gone = item("ماتشا حارة", "Hot Matcha", { isAvailable: false });
    expect(searchMenu([gone, matcha], "ماتشا").map((i) => i.nameEn)).toEqual(["Ice Matcha", "Hot Matcha"]);
  });
});

describe("menu search: typos", () => {
  const forgive = (q: string) => searchMenuForgiving(menu, q);

  it("shows the closest items when nothing matches exactly", () => {
    expect(forgive("wafel")).toEqual({ items: [waffle], closest: true });
    expect(forgive("machta").items).toEqual([matcha]);
    expect(forgive("كركاديه").items).toEqual([karkade]);
    expect(forgive("وافيل").items).toEqual([waffle]);
  });

  it("brings the words that mean the same along with a slip", () => {
    const crunchy = item("كرانشي كيك تشوكلت", "Crunchy Chocolate Cake", { category: "dessert" });
    const bites = item("تشوكو بايتس", "Choco Bites", { category: "dessert" });
    expect(searchMenuForgiving([crunchy, bites, waffle], "choclate")).toEqual({ items: [crunchy, bites], closest: true });
    expect(matchRanges("Choco Bites", "choclate", true)).toEqual([[0, 5]]);
  });

  it("keeps exact matches exact, and gives up on what isn't on the menu", () => {
    expect(forgive("matcha")).toEqual({ items: [matcha], closest: false });
    expect(forgive("pizza")).toEqual({ items: [], closest: false });
    expect(forgive("ab")).toEqual({ items: [], closest: false });
  });
});

describe("menu search: highlighting", () => {
  const marks = (text: string, q: string, nearly = false) => matchRanges(text, q, nearly).map(([a, b]) => text.slice(a, b));

  it("marks whole words, whatever the spelling", () => {
    expect(marks("Ice Matcha", "mat")).toEqual(["Matcha"]);
    expect(marks("كركدية بارد", "كركديه")).toEqual(["كركدية"]);
    expect(marks("قهوة مقطرة باردة", "ايس")).toEqual(["باردة"]);
    expect(marks("قهوة مقطرة باردة", "قهوه بارده")).toEqual(["قهوة", "باردة"]);
  });

  it("joins neighbouring words into one mark", () => {
    expect(marks("تشيز كيك بيكان", "تشيزكيك")).toEqual(["تشيز كيك"]);
    expect(marks("Ice V60", "ice v60")).toEqual(["Ice V60"]);
  });

  it("marks near misses only when asked, and nothing for one letter", () => {
    expect(marks("Pecan Waffle", "wafel")).toEqual([]);
    expect(marks("Pecan Waffle", "wafel", true)).toEqual(["Waffle"]);
    expect(marks("Ice Matcha", "m")).toEqual([]);
  });
});
