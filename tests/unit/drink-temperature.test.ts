import { expect, it } from "vitest";
import { drinkTemperature } from "../../src/shared/drink-temperature";

it.each([
  ["قهوة مقطرة", "V60", "hot"],
  ["قهوة مقطرة حارة", "V60", "hot"],
  ["قهوة اليوم حارة", "Hot Coffee Day", "hot"],
  ["قهوة مقطرة باردة", "Ice V60", "cold"],
  ["قهوة اليوم باردة", null, "cold"],
  ["ماتشا باردة", "Ice Matcha", "cold"],
  ["كركدية بارد", "Ice Karkade", "cold"],
  ["كلاودي كركدية", "Cloudy Karkade", "cold"],
  ["كلاودي كركدية", null, "cold"],
  ["كولد برو", "Cold Brew", "cold"],
] as const)("classifies %s into the correct drink section", (nameAr, nameEn, expected) => {
  expect(drinkTemperature({ nameAr, nameEn })).toBe(expected);
});
