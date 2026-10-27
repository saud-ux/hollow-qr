import { z } from "zod";
import { CAR_COLOR_NAME_MAX_LENGTH, CAR_NAME_MAX_LENGTH, normalizeCar, PLATE_LETTERS_RE, PLATE_NUMBERS_RE, type CarDetails } from "../../shared/cars";

/** A car as the app sends it, for a saved car or a curbside order. */
export const carSchema = z
  .object({
    name: z.string().trim().min(1).max(CAR_NAME_MAX_LENGTH),
    color: z.enum(["black", "white", "lead", "gray", "other"]),
    colorName: z.string().trim().max(CAR_COLOR_NAME_MAX_LENGTH).nullish(),
    plateLetters: z.string().regex(PLATE_LETTERS_RE).nullish(),
    plateNumbers: z.string().regex(PLATE_NUMBERS_RE).nullish(),
  })
  .transform((body, ctx): CarDetails => {
    if (!body.plateLetters !== !body.plateNumbers) {
      ctx.addIssue({ code: "custom", path: ["plateNumbers"], message: "a plate needs its letters and its numbers" });
      return z.NEVER;
    }
    const car = normalizeCar({
      name: body.name,
      color: body.color,
      colorName: body.colorName ?? null,
      plateLetters: body.plateLetters ?? null,
      plateNumbers: body.plateNumbers ?? null,
    });
    if (!car) {
      ctx.addIssue({ code: "custom", path: [body.color === "other" ? "colorName" : "name"], message: "the car needs a name and a colour" });
      return z.NEVER;
    }
    return car;
  });
