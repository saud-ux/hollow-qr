import type { AppRole } from "../../shared/types";

/** A user's landing page is determined by their server-side account role. */
export function roleHomePath(role: AppRole): string {
  switch (role) {
    case "admin":
      return "/staff/admin";
    case "staff":
      return "/staff/orders";
    default:
      return "/menu";
  }
}

/** Preserve checkout/deep-link return paths for customers only. */
export function afterLoginPath(role: AppRole, customerNext: string): string {
  return role === "customer" ? customerNext : roleHomePath(role);
}
