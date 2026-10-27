import { describe, expect, it } from "vitest";
import { westernDigits } from "../../src/shared/format";

describe("western digits", () => {
  it("turns Arabic-Indic and Persian digits into Western ones, and leaves the rest", () => {
    expect(westernDigits("٠٥١٢٣٤٥٦٧٨")).toBe("0512345678");
    expect(westernDigits("۱۲۳۴")).toBe("1234");
    expect(westernDigits("بيت ٤، الدور ٢ - 7")).toBe("بيت 4، الدور 2 - 7");
  });
});
