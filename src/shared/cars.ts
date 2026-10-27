/**
 * The customer's car for curbside pickup: its name (as people call it: كامري،
 * سوناتا، جمس), its colour and, optionally, its Saudi plate.
 *
 * A plate is up to 3 letters and up to 4 digits. The letters are kept in their
 * Latin form (the bottom row of a real plate); each has one Arabic twin (the top row).
 */

export const MAX_CARS = 5;
export const CAR_NAME_MAX_LENGTH = 30;
export const CAR_COLOR_NAME_MAX_LENGTH = 20;

/** The 17 letters used on Saudi plates: Latin → Arabic. */
export const PLATE_LETTERS = {
  A: "ا",
  B: "ب",
  J: "ح",
  D: "د",
  R: "ر",
  S: "س",
  X: "ص",
  T: "ط",
  E: "ع",
  G: "ق",
  K: "ك",
  L: "ل",
  Z: "م",
  N: "ن",
  H: "ه",
  U: "و",
  V: "ى",
} as const;
export type PlateLetter = keyof typeof PLATE_LETTERS;

export const PLATE_LETTERS_RE = /^[ABJDRSXTEGKLZNHUV]{1,3}$/;
export const PLATE_NUMBERS_RE = /^[0-9]{1,4}$/;

/** What people type for each Arabic plate letter, spelling variants included. */
const FROM_ARABIC: Record<string, PlateLetter> = {
  ...(Object.fromEntries(Object.entries(PLATE_LETTERS).map(([latin, arabic]) => [arabic, latin])) as Record<string, PlateLetter>),
  أ: "A",
  إ: "A",
  آ: "A",
  ٱ: "A",
  ة: "H",
  ي: "V",
};

/** Spaces, the tatweel and joiners carry no letter. */
const SILENT = /[\sـ‌‍]/;

export function plateLetterOf(char: string): PlateLetter | null {
  const upper = char.toUpperCase();
  if (upper in PLATE_LETTERS && /[A-Z]/.test(upper)) return upper as PlateLetter;
  return FROM_ARABIC[char] ?? null;
}

/** «ه» as the plate writes it: joined to nothing, without the tatweel. */
const arabicOnPlate = (letter: PlateLetter) => (letter === "H" ? "ه‍" : PLATE_LETTERS[letter]);

/**
 * Reads what the customer typed in the letters box, in Arabic or English.
 * letters: the plate letters (Latin), at most 3; shown: the same letters, spaced,
 * in the script they were typed in; rejected: the first character that is not a plate letter.
 */
export function readPlateLetters(typed: string): { letters: string; shown: string; rejected: string | null } {
  let letters = "";
  const shown: string[] = [];
  let rejected: string | null = null;
  for (const char of typed) {
    if (SILENT.test(char)) continue;
    const letter = plateLetterOf(char);
    if (!letter) {
      rejected ??= char;
      continue;
    }
    if (letters.length === 3) continue;
    letters += letter;
    shown.push(/[A-Za-z]/.test(char) ? letter : arabicOnPlate(letter));
  }
  return { letters, shown: shown.join(" "), rejected };
}

/** The digits typed in the numbers box (Arabic-Indic digits too), at most 4. */
export function readPlateNumbers(typed: string): string {
  return typed
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "")
    .slice(0, 4);
}

/** The letters as the plate's top row writes them, spaced. */
export function plateArabic(letters: string): string {
  return Array.from(letters, (l) => (l in PLATE_LETTERS ? arabicOnPlate(l as PlateLetter) : "")).join(" ");
}

export const plateLatin = (letters: string) => Array.from(letters).join(" ");

export const arabicDigits = (digits: string) => digits.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));

export type CarColor = "black" | "white" | "lead" | "gray" | "other";

export const CAR_COLORS: readonly { key: Exclude<CarColor, "other">; ar: string; en: string; hex: string }[] = [
  { key: "black", ar: "أسود", en: "Black", hex: "#1c1c1e" },
  { key: "white", ar: "أبيض", en: "White", hex: "#ffffff" },
  { key: "lead", ar: "رصاصي", en: "Silver", hex: "#a9adb3" },
  { key: "gray", ar: "رمادي", en: "Gray", hex: "#6e7278" },
];

export interface CarDetails {
  /** As the customer calls it: «كامري», «جمس». */
  name: string;
  color: CarColor;
  /** The customer's own colour, only when color is "other". */
  colorName: string | null;
  /** Both set, or both null. */
  plateLetters: string | null;
  plateNumbers: string | null;
}

export interface SavedCar extends CarDetails {
  id: string;
}

export function carColorName(car: Pick<CarDetails, "color" | "colorName">, en = false): string {
  if (car.color === "other") return car.colorName ?? "";
  const known = CAR_COLORS.find((c) => c.key === car.color);
  return known ? (en ? known.en : known.ar) : "";
}

export const carColorHex = (color: CarColor): string | null => CAR_COLORS.find((c) => c.key === color)?.hex ?? null;

/** The separator in a car's description; never part of what the customer wrote. */
const SEP = " · ";
const clean = (text: string) => text.replace(/[·•|]/g, " ").replace(/\s+/g, " ").trim();

/** Trims what was typed and leaves out a half plate; null when the name or colour is missing. */
export function normalizeCar(car: CarDetails): CarDetails | null {
  const name = clean(car.name).slice(0, CAR_NAME_MAX_LENGTH);
  const colorName = car.color === "other" ? clean(car.colorName ?? "").slice(0, CAR_COLOR_NAME_MAX_LENGTH) : "";
  if (!name || (car.color === "other" && !colorName)) return null;
  const letters = car.plateLetters ?? "";
  const numbers = car.plateNumbers ?? "";
  const plate = PLATE_LETTERS_RE.test(letters) && PLATE_NUMBERS_RE.test(numbers);
  return { name, color: car.color, colorName: car.color === "other" ? colorName : null, plateLetters: plate ? letters : null, plateNumbers: plate ? numbers : null };
}

/**
 * The car in one line, as stored on the order and read by the staff:
 * «كامري · أبيض · ه و ل 462». parseCarDescription reads it back.
 */
export function carDescription(car: CarDetails): string {
  const parts = [clean(car.name), clean(carColorName(car))];
  if (car.plateLetters && car.plateNumbers) {
    parts.push(`${Array.from(car.plateLetters, (l) => PLATE_LETTERS[l as PlateLetter]).join(" ")} ${car.plateNumbers}`);
  }
  return parts.join(SEP);
}

const PLATE_TEXT = /^((?:[ابحدرسصطعقكلمنهوى] ){1,3})([0-9]{1,4})$/;

/** A description written by carDescription, read back; null for an order's free text from before. */
export function parseCarDescription(text: string | null | undefined): CarDetails | null {
  if (!text) return null;
  const parts = text.split(SEP);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !p.trim())) return null;
  const [name, colorText, plateText] = parts as [string, string, string | undefined];
  const known = CAR_COLORS.find((c) => c.ar === colorText);
  let plateLetters: string | null = null;
  let plateNumbers: string | null = null;
  if (plateText !== undefined) {
    const m = PLATE_TEXT.exec(plateText);
    if (!m) return null;
    plateLetters = m[1]!.trim().split(" ").map((a) => FROM_ARABIC[a]!).join("");
    plateNumbers = m[2]!;
  }
  return { name, color: known?.key ?? "other", colorName: known ? null : colorText, plateLetters, plateNumbers };
}

/** Cars by the names people call them in Saudi Arabia, the most common first: [Arabic, English]. */
export const CAR_NAMES: readonly (readonly [string, string])[] = [
  ["كامري", "Camry"],
  ["سوناتا", "Sonata"],
  ["لكزس", "Lexus"],
  ["جمس", "GMC"],
  ["لاندكروزر", "Land Cruiser"],
  ["النترا", "Elantra"],
  ["يوكن", "Yukon"],
  ["أكسنت", "Accent"],
  ["كورولا", "Corolla"],
  ["يارس", "Yaris"],
  ["هايلكس", "Hilux"],
  ["برادو", "Prado"],
  ["أفالون", "Avalon"],
  ["راف فور", "RAV4"],
  ["فورتشنر", "Fortuner"],
  ["توسان", "Tucson"],
  ["سنتافي", "Santa Fe"],
  ["أزيرا", "Azera"],
  ["كريتا", "Creta"],
  ["ألتيما", "Altima"],
  ["صني", "Sunny"],
  ["باترول", "Patrol"],
  ["ماكسيما", "Maxima"],
  ["إكس تريل", "X-Trail"],
  ["تاهو", "Tahoe"],
  ["سوبربان", "Suburban"],
  ["كابرس", "Caprice"],
  ["ماليبو", "Malibu"],
  ["سييرا", "Sierra"],
  ["تشارجر", "Charger"],
  ["دورانجو", "Durango"],
  ["تورس", "Taurus"],
  ["إكسبلورر", "Explorer"],
  ["إكسبدشن", "Expedition"],
  ["أكورد", "Accord"],
  ["سيفيك", "Civic"],
  ["سبورتاج", "Sportage"],
  ["سيراتو", "Cerato"],
  ["سورينتو", "Sorento"],
  ["باجيرو", "Pajero"],
  ["رنج روفر", "Range Rover"],
  ["مرسيدس", "Mercedes"],
  ["بي إم دبليو", "BMW"],
  ["جيلي", "Geely"],
  ["إم جي", "MG"],
  ["شانجان", "Changan"],
  ["هافال", "Haval"],
  ["تانك", "Tank"],
  ["جيتور", "Jetour"],
];

const fold = (text: string) =>
  text
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\s\-ـ]/g, "");

/** The car names matching what was typed (Arabic or English); the most common ones when nothing is typed. */
export function searchCarNames(query: string, limit = 8): (readonly [string, string])[] {
  const q = fold(query.trim());
  if (!q) return CAR_NAMES.slice(0, limit);
  const starts = CAR_NAMES.filter(([ar, en]) => fold(ar).startsWith(q) || fold(en).startsWith(q));
  const contains = CAR_NAMES.filter(([ar, en]) => !starts.some((s) => s[0] === ar) && (fold(ar).includes(q) || fold(en).includes(q)));
  return [...starts, ...contains].slice(0, limit);
}

/** A name from the list in the reader's language; the customer's own name as written. */
export function carNameText(name: string, en = false): string {
  if (!en) return name;
  return CAR_NAMES.find(([ar]) => ar === name)?.[1] ?? name;
}
