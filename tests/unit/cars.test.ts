import { describe, expect, it } from "vitest";
import {
  arabicDigits,
  carDescription,
  normalizeCar,
  parseCarDescription,
  plateArabic,
  readPlateLetters,
  readPlateNumbers,
  searchCarNames,
  type CarDetails,
} from "../../src/shared/cars";

const camry: CarDetails = { name: "كامري", color: "white", colorName: null, plateLetters: "HUL", plateNumbers: "462" };

describe("plate letters", () => {
  it("reads Arabic or English, up to three letters, in the script typed", () => {
    expect(readPlateLetters("هول")).toEqual({ letters: "HUL", shown: "ه‍ و ل", rejected: null });
    expect(readPlateLetters("h u l")).toEqual({ letters: "HUL", shown: "H U L", rejected: null });
    expect(readPlateLetters("أبيس").letters).toBe("ABV");
    expect(readPlateLetters("ة").letters).toBe("H");
    expect(readPlateLetters("كلمن").letters).toBe("KLZ");
  });

  it("names the first character that isn't on Saudi plates", () => {
    expect(readPlateLetters("كثل")).toEqual({ letters: "KL", shown: "ك ل", rejected: "ث" });
    expect(readPlateLetters("ACB").rejected).toBe("C");
  });

  it("reads back what it showed", () => {
    const shown = readPlateLetters("هول").shown;
    expect(readPlateLetters(shown).letters).toBe("HUL");
    expect(readPlateLetters(`${shown}ب`).letters).toBe("HUL");
  });

  it("writes «ه» joined, without the tatweel", () => {
    expect(plateArabic("HUL")).toBe("ه‍ و ل");
    expect(plateArabic("KLZ")).toBe("ك ل م");
  });
});

describe("plate numbers", () => {
  it("keeps up to four digits, Arabic-Indic ones too", () => {
    expect(readPlateNumbers("٤٦٢")).toBe("462");
    expect(readPlateNumbers("12a345")).toBe("1234");
    expect(arabicDigits("462")).toBe("٤٦٢");
  });
});

describe("a car's description", () => {
  it("is one line the staff read, and reads back", () => {
    expect(carDescription(camry)).toBe("كامري · أبيض · ه و ل 462");
    expect(parseCarDescription(carDescription(camry))).toEqual(camry);
    const own: CarDetails = { name: "جمس", color: "other", colorName: "عنابي", plateLetters: null, plateNumbers: null };
    expect(carDescription(own)).toBe("جمس · عنابي");
    expect(parseCarDescription("جمس · عنابي")).toEqual(own);
  });

  it("leaves the free text of older orders as it is", () => {
    expect(parseCarDescription("كامري بيضاء")).toBeNull();
    expect(parseCarDescription("كامري · أبيض · لوحتي")).toBeNull();
    expect(parseCarDescription(null)).toBeNull();
  });

  it("keeps the separator out of what the customer wrote", () => {
    const car = normalizeCar({ name: "  كامري · ٢٠٢٤ ", color: "other", colorName: "أزرق|فاتح", plateLetters: "HU", plateNumbers: null })!;
    expect(car).toEqual({ name: "كامري ٢٠٢٤", color: "other", colorName: "أزرق فاتح", plateLetters: null, plateNumbers: null });
    expect(parseCarDescription(carDescription(car))).toEqual(car);
  });

  it("needs a name, and a written colour for «لون آخر»", () => {
    expect(normalizeCar({ ...camry, name: " · " })).toBeNull();
    expect(normalizeCar({ ...camry, color: "other", colorName: "  " })).toBeNull();
    expect(normalizeCar({ ...camry, colorName: "ignored" })!.colorName).toBeNull();
  });
});

describe("car names", () => {
  it("shows the most common first, and finds Arabic and English spellings", () => {
    expect(searchCarNames("").slice(0, 4).map(([ar]) => ar)).toEqual(["كامري", "سوناتا", "لكزس", "جمس"]);
    expect(searchCarNames("كامرى")[0]?.[0]).toBe("كامري");
    expect(searchCarNames("land")[0]?.[0]).toBe("لاندكروزر");
    expect(searchCarNames("اكسنت")[0]?.[0]).toBe("أكسنت");
    expect(searchCarNames("زززز")).toEqual([]);
  });
});
