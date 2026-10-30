import { describe, expect, it } from "vitest";
import { afterLoginPath, roleHomePath } from "../../src/client/lib/role-route";

describe("account role routing", () => {
  it("opens the full admin dashboard for admin accounts", () => {
    expect(roleHomePath("admin")).toBe("/staff/admin");
    expect(afterLoginPath("admin", "/wallet")).toBe("/staff/admin");
    expect(afterLoginPath("admin", "/orders/123")).toBe("/staff/admin");
  });

  it("opens staff order management for staff accounts", () => {
    expect(roleHomePath("staff")).toBe("/staff/orders");
    expect(afterLoginPath("staff", "/wallet")).toBe("/staff/orders");
  });

  it("keeps customer routes and return paths for customer accounts", () => {
    expect(roleHomePath("customer")).toBe("/menu");
    expect(afterLoginPath("customer", "/wallet")).toBe("/wallet");
    expect(afterLoginPath("customer", "/orders/123")).toBe("/orders/123");
  });
});
