import type { z } from "zod";
import { ApiError } from "./errors";
import type { AppContext } from "./context";

export async function parseJsonBody<T extends z.ZodType>(c: AppContext, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "INVALID_REQUEST");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "INVALID_REQUEST", {
      issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return parsed.data;
}

export function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "INVALID_REQUEST");
  return parsed.data;
}
